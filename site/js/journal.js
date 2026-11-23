// The list of journals (#/journal): what each row shows. Pure, no DOM, for tests.

// The rows of journal.list the active role works with. The teacher role: their own subjects and those where they
// taught single pairs (covers); the office roles (deanery, admin, vice-rector): every subject the server sent.
export function listRows(subjects, role) {
  const rows = Array.isArray(subjects) ? subjects : [];
  return role === 'teacher' ? rows.filter((row) => row.own === true || row.covers === true) : rows.slice();
}

// The marks of the column «не заполнено»: the pairs still open for marks, then those past their deadline.
// -> [{ tone, key, params }]; nothing when every held pair is filled in.
export function listBadges(row) {
  const unfilled = Number(row.unfilled) || 0;
  const overdue = Number(row.overdue) || 0;
  const badges = [];
  if (unfilled > overdue) badges.push({ tone: 'warning', key: 'journal.list.unfilled', params: { n: unfilled - overdue } });
  if (overdue > 0) badges.push({ tone: 'danger', key: 'journal.list.overdue', params: { n: overdue } });
  return badges;
}

// ---- The grid of a subject (#/journal/<subjectId>): the columns, the cells and the heads, from journal.get ----

const UNIT_FIELDS = ['current', 'self', 'control', 'total'];
const SUMMARY_FIELDS = ['absences', 'percent', 'preliminary'];
const HELD = ['running', 'closed'];

// The columns of the grid, left to right: the pairs in the order of the answer; right after the last pair of a unit its
// four columns (current control, self-work, unit control, total); units without pairs after all pairs; «outside» when
// held pairs have no unit; at the end the three summary columns. A partial journal (single pairs) shows only the pairs.
export function journalColumns(journal) {
  const pairs = Array.isArray(journal.pairs) ? journal.pairs : [];
  const columns = pairs.map((pair) => ({ type: 'pair', pair }));
  if (journal.partial) return columns;
  const units = (Array.isArray(journal.units) ? journal.units : []).map((u) => u.unit);
  const last = new Map();
  pairs.forEach((pair, index) => { if (Number.isInteger(pair.unit)) last.set(pair.unit, index); });
  const block = (unit) => UNIT_FIELDS.map((field) => ({ type: 'unit', unit, field }));
  const result = [];
  pairs.forEach((pair, index) => {
    result.push(columns[index]);
    if (Number.isInteger(pair.unit) && last.get(pair.unit) === index && units.includes(pair.unit)) result.push(...block(pair.unit));
  });
  for (const unit of units.filter((u) => !last.has(u)).sort((a, b) => a - b)) result.push(...block(unit));
  if (pairs.some((pair) => HELD.includes(pair.status) && !Number.isInteger(pair.unit))) result.push({ type: 'outside' });
  for (const field of SUMMARY_FIELDS) result.push({ type: 'summary', field });
  return result;
}

const TONES = { present: 'neutral', late: 'warning', absent: 'danger', excused: 'info', madeup: 'success' };

// What a cell shows for a mark of a student on a pair; null when there is no mark.
export function cellView(mark) {
  if (!mark || typeof mark.status !== 'string') return null;
  return { key: 'journal.short.' + mark.status, tone: TONES[mark.status] || 'neutral', activity: mark.activity ?? null, noCoat: mark.noCoat === true };
}

const KINDS = ['lecture', 'practice', 'control'];
const STATES = { cancelled: 'journal.state.cancelled', missed: 'journal.state.missed', future: 'journal.state.future' };

// The head of a pair: the kind of the lesson and the state label (null when nothing needs saying).
export function pairHead(pair) {
  const kindKey = 'journal.kind.' + (KINDS.includes(pair.lessonType) ? pair.lessonType : 'none');
  let stateKey = null;
  if (pair.status === 'cancelled' || pair.status === 'missed') stateKey = STATES[pair.status];
  else if (pair.status === 'running') stateKey = 'journal.state.running';
  else if (pair.status === 'planned') stateKey = pair.state === 'late' ? 'journal.state.overdue' : pair.state === 'future' ? STATES.future : 'journal.state.unfilled';
  return { kindKey, stateKey };
}

// The deanery actions on a pair (the menu «…» of its head): «not held» for a pair that may still be missed, «back to the
// schedule» for a missed one, «reset the marks» for a held one. Nothing for the roles that only fill in or look.
export function pairActions(pair, can) {
  if (!can || can.manage !== true) return [];
  if (pair.status === 'planned' && (pair.state === 'open' || pair.state === 'late')) return ['miss'];
  if (pair.status === 'missed') return ['reopen'];
  if (pair.status === 'closed') return ['clear'];
  return [];
}

// ---- The marks of a pair (the window «Отметки пары») ----

const NO_ACTIVITY = ['absent', 'excused'];

// Whether the head of a pair opens the window: only the pairs the person may fill in freely or with a reason.
export const canMark = (pair) => pair.mode === 'free' || pair.mode === 'reason';

// The hint of a head that does not open: the pair has not begun; the term has passed (only a teacher is sent to the deanery).
export function pairHint(pair, role) {
  if (canMark(pair)) return null;
  if (pair.state === 'future') return 'journal.marks.notBegun';
  if (pair.status === 'planned' && pair.state === 'late' && pair.mode === 'none' && role === 'teacher') return 'journal.marks.termPassed';
  return null;
}

// No points for activity: for those who were not there, on the first pair of the subject and on a unit control pair.
export function activityAllowed(status, pair) {
  return !!status && !NO_ACTIVITY.includes(status) && !(pair && (pair.first === true || pair.lessonType === 'control'));
}

// The lab coat is asked only on practice pairs and pairs without a topic.
export function coatAllowed(pair) {
  return !pair || pair.lessonType === 'practice' || !pair.lessonType;
}

// The list of the window: the active students with their marks. A student without a mark starts «present» on a pair not
// held yet; on a held pair (he joined later) he has no status (null) until the teacher sets one.
export function draftMarks(journal, pairId) {
  const pair = journal.pairs && journal.pairs.find((p) => p.id === pairId);
  const held = !!pair && (pair.status === 'running' || pair.status === 'closed');
  const saved = (journal.marks && journal.marks[pairId]) || {};
  return journal.students.filter((student) => !student.left).map((student) => {
    const mark = saved[student.id];
    return {
      studentId: student.id, fullName: student.fullName,
      status: mark ? mark.status : (held ? null : 'present'), noCoat: mark ? mark.noCoat === true : false, activity: mark && mark.activity !== undefined ? mark.activity : null,
    };
  });
}

// The marks for journal.savePair: every mark of a pair not yet held; of a held one only those that differ from the saved.
// A student still without a status (null) is not sent.
export function changedMarks(draft, journal, pairId) {
  const pair = journal.pairs.find((p) => p.id === pairId);
  const held = pair && (pair.status === 'running' || pair.status === 'closed');
  const saved = (journal.marks && journal.marks[pairId]) || {};
  const base = new Map(Object.keys(saved).map((id) => [id, { status: saved[id].status, noCoat: saved[id].noCoat === true, activity: saved[id].activity !== undefined ? saved[id].activity : null }]));
  return draft
    .filter((m) => {
      if (m.status === null) return false;
      const old = base.get(m.studentId);
      return !held || !old || old.status !== m.status || old.noCoat !== m.noCoat || old.activity !== m.activity;
    })
    .map((m) => ({ studentId: m.studentId, status: m.status, noCoat: m.noCoat === true, activity: m.activity }));
}

// ---- The window of a cell (a student on a pair): late correction and the history of changes ----

// After the term a teacher may only move «absent» to «excused» or «madeup», and «excused» to «madeup» (mode `limited`).
export function lateOptions(mark) {
  if (!mark) return [];
  if (mark.status === 'absent') return ['excused', 'madeup'];
  if (mark.status === 'excused') return ['madeup'];
  return [];
}

// The points of a student for a pair, as the server counts them (core/grades.js pairPoints; the site cannot load core/).
// null: no mark, the pair is not held, a control pair, or an excused student: the pair does not count.
export function pairScore(mark, pair, scheme) {
  if (!mark || !HELD.includes(pair.status) || pair.lessonType === 'control' || mark.status === 'excused') return null;
  const possible = pair.first ? scheme.attendance : scheme.attendance + scheme.activity;
  if (mark.status === 'absent') return { earned: 0, possible };
  const activity = pair.first ? 0 : Math.min(Math.max(Number(mark.activity) || 0, 0), scheme.activity);
  return { earned: scheme.attendance + activity, possible };
}

const STATUS_VALUES = ['present', 'late', 'absent', 'excused', 'madeup'];
const PAIR_STATUS_VALUES = ['planned', 'running', 'closed', 'missed', 'cancelled'];
const RESULT_VALUES = ['control', 'self', 'current'];
const WORK_FIELDS = ['points', 'status', 'maxPoints', 'dueAt'];
const WORK_STATES = ['submitted', 'checked', 'returned'];
// 'YYYY-MM-DD HH:MM:SS' -> 'DD.MM.YYYY HH:MM'; anything else stays as it is.
const dueText = (text) => { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(text); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : text; };

// One line of the history (a row of journal.log) -> { key, params, keyParams }. keyParams names the params whose
// value is a dictionary key; the screen translates them before filling the text in.
export function logLine(row) {
  const r = row || {};
  const before = r.before === undefined || r.before === null ? '' : String(r.before);
  const after = r.after === undefined || r.after === null ? '' : String(r.after);
  const line = (key, params = {}, keyParams = []) => ({ key, params, keyParams });
  const value = (text, known, prefix) => (known.includes(text) ? prefix + text : text);
  const keyed = (params) => Object.keys(params).filter((name) => typeof params[name] === 'string' && (params[name].startsWith('journal.') || params[name].startsWith('work.')));
  if (r.entity === 'mark') {
    if (r.field === 'status') {
      const p = { before: value(before, STATUS_VALUES, 'journal.marks.status.'), after: value(after, STATUS_VALUES, 'journal.marks.status.') };
      if (before === '') return line('journal.log.mark.statusSet', { after: p.after }, keyed({ after: p.after }));
      if (after === '') return line('journal.log.mark.cleared', { what: 'journal.log.field.status' }, ['what']);
      return line('journal.log.mark.status', p, keyed(p));
    }
    if (r.field === 'noCoat') {
      if (after === '') return line('journal.log.mark.cleared', { what: 'journal.log.field.noCoat' }, ['what']);
      return line(after === 'yes' ? 'journal.log.mark.noCoatOn' : 'journal.log.mark.noCoatOff');
    }
    if (r.field === 'activity') {
      if (after === '') return line('journal.log.mark.cleared', { what: 'journal.log.field.activity' }, ['what']);
      if (before === '') return line('journal.log.mark.activitySet', { after });
      return line('journal.log.mark.activity', { before, after });
    }
  }
  if (r.entity === 'unit' && RESULT_VALUES.includes(r.field)) {
    return line('journal.log.unit', { what: 'journal.log.field.' + r.field, unit: r.unit, before: before === '' ? '—' : before, after: after === '' ? '—' : after }, ['what']);
  }
  if (r.entity === 'work' && WORK_FIELDS.includes(r.field)) {
    const dash = (text) => (text === '' ? '—' : text);
    const title = typeof r.assignmentTitle === 'string' && r.assignmentTitle !== '' ? r.assignmentTitle : '—';
    let p;
    if (r.field === 'status') p = { title, before: before === '' ? '—' : value(before, WORK_STATES, 'work.state.'), after: after === '' ? '—' : value(after, WORK_STATES, 'work.state.') };
    else if (r.field === 'dueAt') p = { title, before: dash(dueText(before)), after: dash(dueText(after)) };
    else p = { title, before: dash(before), after: dash(after) };
    return line('journal.log.work.' + r.field, p, keyed(p));
  }
  if (r.entity === 'pair' && r.field === 'status') {
    const p = { before: value(before, PAIR_STATUS_VALUES, 'journal.log.pairStatus.'), after: value(after, PAIR_STATUS_VALUES, 'journal.log.pairStatus.') };
    return line('journal.log.pair.status', p, keyed(p));
  }
  return line('journal.log.other', { field: r.field || '', before, after });
}

// ---- The self-work cell of a unit: counted by the assignments or entered by hand ----

// -> { value, key, params }. A unit without assignments: the value as entered (no key). With assignments: the counted
// value with the key «по заданиям»; while some are waiting (checking, or not yet due) there is no total, only the
// provisional value of what is checked and the key with the number of those waiting.
export function selfCell(unitResult) {
  const u = unitResult || {};
  const sw = u.selfWork;
  if (!sw) return { value: u.self ?? null, key: null, params: {} };
  if (sw.pending > 0) return { value: sw.value ?? null, key: 'journal.self.pending', params: { n: sw.pending } };
  return { value: u.self ?? sw.value ?? null, key: 'journal.self.byWork', params: {} };
}

// ---- The results of a unit (windows «Рубежный контроль», «СРС», «Текущий контроль») ----

const RESULT_COLUMN = { control: 'control', self: 'self', current: 'manual' };

// The value saved now in the field of one student for a unit: control, self-work or the manual current points; null when none.
export function savedResult(journal, studentId, unit, field) {
  const result = journal.results && journal.results[studentId];
  const row = result && result.units.find((u) => u.unit === unit);
  const value = row ? row[RESULT_COLUMN[field]] : null;
  return value === undefined ? null : value;
}

// '' -> null (not set); '30' -> 30; above max, a comma, a sign or letters -> undefined (an error at the field).
export function parsePoints(text, max) {
  const clean = String(text === null || text === undefined ? '' : text).trim();
  if (clean === '') return null;
  if (!/^\d{1,3}$/.test(clean)) return undefined;
  const value = Number(clean);
  return value <= max ? value : undefined;
}

// The items for journal.saveResults: only the students whose value differs from the saved one.
// draft: Map(studentId -> number | null) -> [{ studentId, value }]
export function resultItems(draft, journal, unit, field) {
  const items = [];
  for (const [studentId, value] of draft) {
    if (value !== savedResult(journal, studentId, unit, field)) items.push({ studentId, value });
  }
  return items;
}

// The reason is needed as on the server: always for the manual current points and for the office; for the own teacher
// only when a value that was already set is changed (the first value needs none).
export function needsReason(items, journal, unit, field, isOwnTeacher) {
  if (field === 'current' || !isOwnTeacher) return true;
  return items.some((item) => savedResult(journal, item.studentId, unit, field) !== null);
}

// ---- The student's «Оценки» (#/grades): the lines of the screen, from student.grades ----

const ABSENCE_STATUSES = ['absent', 'excused', 'madeup'];

// The line of a unit: all three results and the total; otherwise every part that exists (`parts`), or nothing yet.
export function unitLine(unit) {
  const { current, self, control, total } = unit;
  const has = (v) => v !== null && v !== undefined;
  if (unit.selfWork) {
    // self-work counted by assignments: its own wording («по заданиям», or provisional while some wait), always in parts
    const cell = selfCell(unit);
    const parts = [];
    if (has(current)) parts.push({ key: 'grades.unit.part.current', params: { current } });
    parts.push({ key: cell.key === 'journal.self.pending' ? 'grades.unit.part.selfPending' : 'grades.unit.part.selfByWork', params: { self: has(cell.value) ? cell.value : '—', n: cell.params.n } });
    if (has(control)) parts.push({ key: 'grades.unit.part.control', params: { control } });
    if (has(total)) parts.push({ key: 'grades.unit.part.total', params: { total } });
    return { key: 'grades.unit.parts', params: {}, parts };
  }
  if (has(current) && has(self) && has(control)) return { key: 'grades.unit.full', params: { current, self, control, total } };
  const parts = [];
  if (has(current)) parts.push({ key: 'grades.unit.part.current', params: { current } });
  if (has(self)) parts.push({ key: 'grades.unit.part.self', params: { self } });
  if (has(control)) parts.push({ key: 'grades.unit.part.control', params: { control } });
  if (!parts.length) return { key: 'grades.unit.empty', params: {} };
  return { key: 'grades.unit.parts', params: {}, parts };
}

// The pairs the student was away from (or made up for), the newest first.
export function absenceList(pairs) {
  const list = Array.isArray(pairs) ? pairs.filter((pair) => ABSENCE_STATUSES.includes(pair.status)) : [];
  return list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.slot || 0) - (a.slot || 0)));
}

// «27 из 30», or «не входит в расчёт» for a pair that gives no points (a control pair, an excused absence).
export function pointsText(pair) {
  if (pair.earned === null || pair.earned === undefined) return { key: 'grades.notCounted', params: {} };
  return { key: 'grades.points', params: { earned: pair.earned, possible: pair.possible } };
}

// ---- The views of the grid: a day, a week, a unit or the whole term (the switch above the grid) ----

export const VIEWS = ['day', 'week', 'unit', 'all'];
export const DEFAULT_VIEW = 'week';

const DAY_MS = 86400000;
const toMs = (date) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10);

// 'YYYY-MM-DD' plus n days (negative: back); plain calendar days, the clock of the device is never read.
export function addDays(date, n) {
  return fromMs(toMs(date) + n * DAY_MS);
}

// 1 = Monday ... 7 = Sunday.
export function isoWeekday(date) {
  const day = new Date(toMs(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

// The calendar week (Monday to Sunday) that holds the date.
export function weekRange(date) {
  const from = addDays(date, 1 - isoWeekday(date));
  return { from, to: addDays(from, 6) };
}

const list = (pairs) => (Array.isArray(pairs) ? pairs : []);

export const pairsOfDay = (pairs, date) => list(pairs).filter((pair) => pair.date === date);
export const pairsOfWeek = (pairs, date) => {
  const { from, to } = weekRange(date);
  return list(pairs).filter((pair) => pair.date >= from && pair.date <= to);
};
export const pairsOfUnit = (pairs, unit) => list(pairs).filter((pair) => pair.unit === unit);

// The dates that have a pair of this subject, oldest first, each once.
export function pairDates(pairs) {
  return [...new Set(list(pairs).map((pair) => pair.date))].sort();
}

// The date to open on: today if it has a pair, else the next pair date, else (all pairs are past) the last one.
// -> { date, exact }, or null when there are no pairs at all.
export function nearestPairDate(pairs, today) {
  const dates = pairDates(pairs);
  if (dates.length === 0) return null;
  if (dates.includes(today)) return { date: today, exact: true };
  return { date: dates.find((date) => date > today) || dates[dates.length - 1], exact: false };
}

// The previous (dir -1) or next (dir 1) date that has a pair; null at the end of the term.
export function stepPairDate(pairs, date, dir) {
  const dates = pairDates(pairs);
  return (dir < 0 ? dates.filter((d) => d < date).pop() : dates.find((d) => d > date)) || null;
}

// The units of the syllabus half (those of the answer, then any unit only the pairs mention), numbers ascending.
export function unitOptions(journal) {
  const numbers = new Set((Array.isArray(journal.units) ? journal.units : []).map((u) => u.unit));
  for (const pair of list(journal.pairs)) if (Number.isInteger(pair.unit)) numbers.add(pair.unit);
  return [...numbers].sort((a, b) => a - b);
}

// The unit that goes now: the one of the pair of the nearest date; null when that date has no pair with a unit.
// `running` is true when today lies between the first and the last pair of that unit.
export function currentUnit(pairs, today) {
  const near = nearestPairDate(pairs, today);
  if (!near) return null;
  const pair = list(pairs).find((p) => p.date === near.date && Number.isInteger(p.unit));
  if (!pair) return null;
  const dates = pairsOfUnit(pairs, pair.unit).map((p) => p.date).sort();
  return { unit: pair.unit, running: dates[0] <= today && today <= dates[dates.length - 1] };
}

// What the grid shows in a mode. view: { mode, day, week (any date inside the week), unit }.
// -> { pairs, columns }: the pairs in view and the columns for them. After the last visible pair of a unit stand its
// four total columns, so «day» and «week» show the totals of the units of the visible pairs, «unit» those of that unit
// (even one without pairs), «all» everything as before. The summary columns stay in every mode.
export function viewColumns(journal, view) {
  const all = list(journal.pairs);
  let pairs = all;
  let units = Array.isArray(journal.units) ? journal.units : [];
  if (view.mode !== 'all') {
    pairs = view.mode === 'day' ? pairsOfDay(all, view.day) : view.mode === 'week' ? pairsOfWeek(all, view.week) : pairsOfUnit(all, view.unit);
    const shown = new Set(view.mode === 'unit' ? [view.unit] : pairs.map((pair) => pair.unit));
    units = units.filter((u) => shown.has(u.unit));
  }
  return { pairs, columns: journalColumns({ ...journal, pairs, units }) };
}

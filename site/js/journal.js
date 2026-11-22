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
  else if (pair.status === 'planned') stateKey = pair.state === 'late' ? 'journal.state.overdue' : pair.state === 'future' ? STATES.future : 'journal.state.unfilled';
  return { kindKey, stateKey };
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
  return !NO_ACTIVITY.includes(status) && !(pair && (pair.first === true || pair.lessonType === 'control'));
}

// The lab coat is asked only on practice pairs and pairs without a topic.
export function coatAllowed(pair) {
  return !pair || pair.lessonType === 'practice' || !pair.lessonType;
}

// The list of the window: the active students with their marks; a student without a mark is «present».
export function draftMarks(journal, pairId) {
  const saved = (journal.marks && journal.marks[pairId]) || {};
  return journal.students.filter((student) => !student.left).map((student) => {
    const mark = saved[student.id];
    return {
      studentId: student.id, fullName: student.fullName,
      status: mark ? mark.status : 'present', noCoat: mark ? mark.noCoat === true : false, activity: mark && mark.activity !== undefined ? mark.activity : null,
    };
  });
}

// The marks for journal.savePair: every mark of a pair not yet held; of a held one only those that differ from the saved.
export function changedMarks(draft, journal, pairId) {
  const pair = journal.pairs.find((p) => p.id === pairId);
  const held = pair && (pair.status === 'running' || pair.status === 'closed');
  const base = new Map(draftMarks(journal, pairId).map((m) => [m.studentId, m]));
  return draft
    .filter((m) => {
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

// One line of the history (a row of journal.log) -> { key, params, keyParams }. keyParams names the params whose
// value is a dictionary key; the screen translates them before filling the text in.
export function logLine(row) {
  const r = row || {};
  const before = r.before === undefined || r.before === null ? '' : String(r.before);
  const after = r.after === undefined || r.after === null ? '' : String(r.after);
  const line = (key, params = {}, keyParams = []) => ({ key, params, keyParams });
  const value = (text, known, prefix) => (known.includes(text) ? prefix + text : text);
  const keyed = (params) => Object.keys(params).filter((name) => typeof params[name] === 'string' && params[name].startsWith('journal.'));
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
  if (r.entity === 'pair' && r.field === 'status') {
    const p = { before: value(before, PAIR_STATUS_VALUES, 'journal.log.pairStatus.'), after: value(after, PAIR_STATUS_VALUES, 'journal.log.pairStatus.') };
    return line('journal.log.pair.status', p, keyed(p));
  }
  return line('journal.log.other', { field: r.field || '', before, after });
}

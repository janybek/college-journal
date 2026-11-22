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

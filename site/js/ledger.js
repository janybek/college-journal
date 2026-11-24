// The ledger screens (#/ledger, #/ledger/<subjectId>): what each column and cell shows. Pure, no DOM, for tests.
// The numbers are the server's (ledger.get): the screen has no formula of its own; it chooses words, tones and notes.

const UNIT_FIELDS = ['current', 'self', 'control', 'total'];
const WORD_TONES = { excellent: 'success', good: 'primary', fair: 'warning', fail: 'danger' };
const DASH = '—';

export const wordTone = (word) => WORD_TONES[word] ?? 'neutral';

// The columns of the ledger, left to right: four per unit, then the semester, the admission, the exam, the total and the grade.
export function ledgerColumns(view) {
  const units = Array.isArray(view.units) ? view.units : [];
  return [
    ...units.map((u) => ({ type: 'unit', unit: u.unit, title: u.title || '', closed: u.closed === true, fields: UNIT_FIELDS.slice() })),
    { type: 'semester' }, { type: 'admission' }, { type: 'exam' }, { type: 'final' }, { type: 'word' },
  ];
}

// A number of a unit as the cell shows it. The self-work counted by the assignments, while some still wait for a check, is preliminary: «5*».
export function unitCellText(unitRow, field) {
  const value = unitRow[field];
  if (value === null || value === undefined) return DASH;
  if (field === 'self' && unitRow.selfPending > 0) return value + '*';
  return String(value);
}

// The cell is under the pass mark: red.
export function isLow(unitRow, field) {
  if (field === 'current') return unitRow.currentLow === true;
  if (field === 'control') return unitRow.controlLow === true;
  if (field === 'total') return unitRow.word === 'fail';
  return false;
}

// «Допуск»: nothing until every unit is closed (ready), then admitted or the reason why not.
export function admissionCell(student, ready, split) {
  if (!ready) return { key: null, params: {}, tone: 'neutral' };
  if (student.admitted === true) return { key: 'ledger.admission.yes', params: {}, tone: 'success' };
  if (student.complete !== true) return { key: 'ledger.admission.noUnit', params: {}, tone: 'danger' };
  return { key: 'ledger.admission.low', params: { need: split.admission }, tone: 'danger' };
}

// «Экзамен»: the points of the last try, «не явился(ась)» or «I»; nothing for those who have not taken it.
export function examCell(student) {
  if (student.status === 'done') return { text: String(student.exam), key: null };
  if (student.status === 'absent') return { text: '', key: 'ledger.exam.absent' };
  if (student.status === 'incomplete') return { text: '', key: 'ledger.exam.incomplete' };
  return { text: DASH, key: null };
}

// «Итог» and «Оценка». draft: the final sheet is still open, so the screen adds «предварительно».
export function finalCell(student, { ready, closed }) {
  const none = { text: DASH, key: null, tone: 'neutral', draft: false };
  if (!ready) return none;
  switch (student.status) {
    case 'done': return { text: String(student.total), key: 'journal.grade.' + student.word, tone: wordTone(student.word), draft: !closed };
    case 'not_admitted': return { text: DASH, key: 'ledger.final.notAdmitted', tone: 'danger', draft: false };
    case 'absent': return { text: DASH, key: 'ledger.final.absent', tone: 'danger', draft: !closed };
    case 'incomplete': return { text: DASH, key: 'ledger.final.incomplete', tone: 'warning', draft: !closed };
    default: return none;
  }
}

const dayOf = (at) => (typeof at === 'string' && at.length >= 10 ? `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}` : '');

// The line under the head of a unit instead of the button: when it was closed, what stops the closing, or how many have no result.
export function closeNote(unit) {
  if (unit.closed) return { key: 'ledger.unit.closedAt', params: { date: dayOf(unit.closedAt), name: unit.closedByName || DASH }, tone: 'success' };
  const [first] = Array.isArray(unit.blocking) ? unit.blocking : [];
  if (first) return { key: 'ledger.block.' + first.code, params: { n: first.n }, tone: 'warning' };
  if (unit.missing > 0) return { key: 'ledger.missing', params: { n: unit.missing }, tone: 'neutral' };
  return null;
}

export function canCloseUnit(unit, can) {
  return can.close === true && !unit.closed && unit.blocking.length === 0;
}

// How many students ended with each word, and how many with no grade; those who left do not count.
export function wordCounts(students) {
  const counts = { excellent: 0, good: 0, fair: 0, fail: 0, absent: 0, incomplete: 0, notAdmitted: 0, none: 0 };
  for (const s of students) {
    if (s.left) continue;
    if (s.status === 'done') { if (s.word in counts) counts[s.word] += 1; } else if (s.status === 'absent') counts.absent += 1;
    else if (s.status === 'incomplete') counts.incomplete += 1;
    else if (s.status === 'not_admitted') counts.notAdmitted += 1;
    else counts.none += 1;
  }
  return counts;
}

// The line about the credit week: now, or when it begins; nothing without dates, after it, or once the final sheet is closed.
export function examNote(examWeek, today, final) {
  if (!examWeek || !examWeek.start || !examWeek.end) return null;
  if (final && final.closed) return null;
  if (today > examWeek.end) return null;
  if (today < examWeek.start) return { key: 'ledger.exam.from', params: { date: dayOf(examWeek.start) } };
  return { key: 'ledger.exam.now', params: { date: dayOf(examWeek.end) } };
}

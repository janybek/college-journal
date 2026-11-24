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

// ---- The exam: the head, the results of the first sitting, the history of the tries ----

// «07» is 7: a digits-only field is compared and sent as the number it holds.
const normalNumber = (text) => (/^\d{1,3}$/.test(text) ? String(Number(text)) : text);

const ABSENT = 'absent';
const INCOMPLETE = 'incomplete';
const firstTry = (student) => student.attempts.find((a) => a.no === 1);
const textOfTry = (attempt) => {
  if (!attempt || !attempt.outcome) return '';
  return attempt.outcome === 'score' ? String(attempt.score) : attempt.outcome;
};
const canEnter = (student) => student.admitted === true && !student.left;

// What a field of the exam column holds: «score» (digits), «absent» or «incomplete». The field shows what the draft holds, which is what goes to the server.
export const examModeOf = (text) => (text === ABSENT || text === INCOMPLETE ? text : 'score');

// Which control carries the error of a field: the box of digits while it is shown, otherwise the list of words.
export const examFieldTarget = (text) => (examModeOf(text) === 'score' ? 'input' : 'select');

// The fields of the exam column: the first try of those who may sit it. A score as digits, «absent», «incomplete» or ''.
export function examDraft(students) {
  const draft = new Map();
  for (const s of students) if (canEnter(s)) draft.set(s.id, textOfTry(firstTry(s)));
  return draft;
}

// What goes to the server: only the changed fields. bad: whose field is neither a whole number up to the exam maximum of the answer nor a word.
export function examItems(draft, students, split) {
  const items = [];
  const bad = [];
  for (const s of students) {
    if (!canEnter(s) || !draft.has(s.id)) continue;
    const text = normalNumber(String(draft.get(s.id)).trim());
    if (text === textOfTry(firstTry(s))) continue;
    if (text === '') items.push({ studentId: s.id, outcome: null, score: null });
    else if (text === ABSENT || text === INCOMPLETE) items.push({ studentId: s.id, outcome: text, score: null });
    else if (/^\d{1,3}$/.test(text) && Number(text) <= split.exam) items.push({ studentId: s.id, outcome: 'score', score: Number(text) });
    else bad.push(s.id);
  }
  return { items, bad };
}

// A result that was already there is changed: a reason is needed.
export function examNeedsReason(items, students) {
  const byId = new Map(students.map((s) => [s.id, s]));
  return items.some((item) => {
    const student = byId.get(item.studentId);
    return student ? textOfTry(firstTry(student)) !== '' : false;
  });
}

// What stops the closing of the final sheet: the first reason of the server.
export function finalNote(final) {
  const [first] = final && Array.isArray(final.blocking) ? final.blocking : [];
  return first ? { key: 'ledger.final.block.' + first.code, params: { n: first.n } } : null;
}

// Above the exam part: nothing, the reason the final sheet cannot be closed yet (also while units are still open: how many), or the button.
export function closeFinalState(view) {
  const { final } = view;
  if (final.closed || !view.can.close) return { kind: 'none' };
  const stop = finalNote(final);
  if (stop) return { kind: 'stop', note: stop };
  return view.exam.ready ? { kind: 'button' } : { kind: 'none' };
}

// The title of a try in the history. index: how many sittings (a score or «did not come») came before it; «I» is not a sitting.
export function attemptLabel(attempt, index) {
  if (index === 0) return { key: 'ledger.attempt.first', params: {} };
  if (attempt.commission) return { key: 'ledger.attempt.commission', params: { n: index } };
  return { key: 'ledger.attempt.retake', params: { n: index } };
}

export function attemptLines(attempts) {
  let sittings = 0;
  return attempts.map((attempt) => {
    const label = attemptLabel(attempt, sittings);
    if (attempt.outcome === 'score' || attempt.outcome === ABSENT) sittings += 1;
    const result = examCell({ status: attempt.outcome === 'score' ? 'done' : attempt.outcome, exam: attempt.score });
    return { no: attempt.no, date: attempt.date, label, result, commission: attempt.commission || '' };
  });
}

// The button under a student after the final sheet is closed: the first sitting after «I», a retake, or a retake by a commission.
export function nextLabel(next) {
  if (!next) return null;
  if (!next.retake) return { key: 'ledger.attempt.addFirst' };
  return { key: next.commission ? 'ledger.attempt.addCommission' : 'ledger.attempt.addRetake' };
}

// The server refuses to close a unit with a code and no number; the screen knows the number from the unit it shows.
export function unitBlockNote(error, units, unitNumber) {
  if (!error || error.code !== 'invalid' || !Array.isArray(error.fields) || !error.fields[0]) return null;
  const { field, code } = error.fields[0];
  if (field !== 'unit' || (code !== 'pairs_not_held' && code !== 'self_pending')) return null;
  const unit = units.find((u) => u.unit === unitNumber);
  const entry = unit && Array.isArray(unit.blocking) ? unit.blocking.find((b) => b.code === code) : undefined;
  return entry ? { key: 'ledger.block.' + code, params: { n: entry.n } } : null;
}

// ---- The state exams: the scores of a group ----

export const SCORE_MAX = 100;   // the top of the scale of a state exam (the server checks it again)
const SCORE_WORDS = ['excellent', 'good', 'fair', 'fail'];
const scoreText = (student) => (student.score === null || student.score === undefined ? '' : String(student.score));

// The word of a score by the thresholds of the answer (scheme: { fair, good, excellent }); null without a score.
export function scoreWord(score, scheme) {
  if (score === null || score === undefined) return null;
  if (score >= scheme.excellent) return 'excellent';
  if (score >= scheme.good) return 'good';
  if (score >= scheme.fair) return 'fair';
  return 'fail';
}

// The fields of the scores: what each student has now (a score or ''). Those who left are shown, not entered.
export function scoreDraft(students) {
  const draft = new Map();
  for (const s of students) if (!s.left) draft.set(s.id, scoreText(s));
  return draft;
}

// What goes to the server: only the changed fields ('' clears the score). bad: whose field is not a whole number from 0 to 100.
export function scoreItems(draft, students) {
  const items = [];
  const bad = [];
  for (const s of students) {
    if (s.left || !draft.has(s.id)) continue;
    const text = normalNumber(String(draft.get(s.id)).trim());
    if (text === scoreText(s)) continue;
    if (text === '') items.push({ studentId: s.id, score: null });
    else if (/^\d{1,3}$/.test(text) && Number(text) <= SCORE_MAX) items.push({ studentId: s.id, score: Number(text) });
    else bad.push(s.id);
  }
  return { items, bad };
}

// A score that was already there is changed or erased: a reason is needed.
export function scoresNeedReason(items, students) {
  const had = new Set(students.filter((s) => s.score !== null && s.score !== undefined).map((s) => s.id));
  return items.some((item) => had.has(item.studentId));
}

// The chips under the table: how many students have each word, those without a score, the average. The numbers are the server's.
export function examSummary(stats) {
  const parts = SCORE_WORDS.map((word) => ({ key: 'journal.grade.' + word, n: stats[word], tone: wordTone(word) }));
  return { words: stats.entered > 0 ? parts : [], missing: stats.total - stats.entered, average: stats.average };
}

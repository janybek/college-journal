import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ledgerColumns, unitCellText, isLow, admissionCell, examCell, finalCell, closeNote, canCloseUnit, wordCounts, examNote,
  examDraft, examItems, examNeedsReason, finalNote, attemptLabel, attemptLines, nextLabel, unitBlockNote,
} from '../site/js/ledger.js';

const U = (over) => ({ unit: 1, current: 38, manual: false, self: 16, selfPending: 0, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false, ...over });
const SP = { semester: 60, exam: 40, admission: 30 };
const St = (over) => ({ left: false, semester: 47, complete: true, admitted: true, status: 'done', exam: 35, total: 82, word: 'good', ...over });

test('the cells of a unit: a number, a dash, and a preliminary self-work with a star', () => {
  assert.deepEqual([unitCellText(U(), 'current'), unitCellText(U({ control: null }), 'control'), unitCellText(U({ self: 5, selfPending: 2 }), 'self')], ['38', '—', '5*']);
  assert.deepEqual([isLow(U({ currentLow: true }), 'current'), isLow(U({ controlLow: true }), 'control'), isLow(U({ word: 'fail' }), 'total'), isLow(U(), 'self')], [true, true, true, false]);
});

test('the admission cell: nothing before every unit is closed, then admitted or the reason; the minimum comes from the answer', () => {
  assert.deepEqual([admissionCell(St(), false, SP), admissionCell(St(), true, SP), admissionCell(St({ complete: false, admitted: false }), true, SP), admissionCell(St({ semester: 29, admitted: false }), true, SP)],
    [{ key: null, params: {}, tone: 'neutral' }, { key: 'ledger.admission.yes', params: {}, tone: 'success' }, { key: 'ledger.admission.noUnit', params: {}, tone: 'danger' }, { key: 'ledger.admission.low', params: { need: 30 }, tone: 'danger' }]);
  assert.deepEqual(admissionCell(St({ semester: 24, admitted: false }), true, { semester: 50, exam: 50, admission: 25 }).params, { need: 25 });
});

test('the exam cell and the final cell', () => {
  assert.deepEqual([examCell(St()), examCell(St({ status: 'absent', exam: null })), examCell(St({ status: 'incomplete', exam: null })), examCell(St({ status: 'none', exam: null })), examCell(St({ status: 'not_admitted', exam: null }))],
    [{ text: '35', key: null }, { text: '', key: 'ledger.exam.absent' }, { text: '', key: 'ledger.exam.incomplete' }, { text: '—', key: null }, { text: '—', key: null }]);
  assert.deepEqual(finalCell(St(), { ready: true, closed: true }), { text: '82', key: 'journal.grade.good', tone: 'primary', draft: false });
  assert.deepEqual(finalCell(St(), { ready: true, closed: false }), { text: '82', key: 'journal.grade.good', tone: 'primary', draft: true });
  assert.deepEqual(finalCell(St({ total: 58, word: 'fail' }), { ready: true, closed: true }), { text: '58', key: 'journal.grade.fail', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'not_admitted', total: null, word: null }), { ready: true, closed: true }), { text: '—', key: 'ledger.final.notAdmitted', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'absent', total: null, word: null }), { ready: true, closed: true }), { text: '—', key: 'ledger.final.absent', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'incomplete', total: null, word: null }), { ready: true, closed: false }), { text: '—', key: 'ledger.final.incomplete', tone: 'warning', draft: true });
  assert.deepEqual([finalCell(St({ status: 'none', total: null, word: null }), { ready: true, closed: false }), finalCell(St({ status: 'not_admitted', total: null, word: null }), { ready: false, closed: false })],
    [{ text: '—', key: null, tone: 'neutral', draft: false }, { text: '—', key: null, tone: 'neutral', draft: false }]);
  assert.equal(finalCell(St({ total: 95, word: 'excellent' }), { ready: true, closed: true }).tone, 'success');
  assert.equal(finalCell(St({ total: 65, word: 'fair' }), { ready: true, closed: true }).tone, 'warning');
});

test('closing a unit: the note instead of the button, and who may close', () => {
  assert.deepEqual(closeNote({ closed: false, blocking: [{ code: 'pairs_not_held', n: 3 }], missing: 3 }), { key: 'ledger.block.pairs_not_held', params: { n: 3 }, tone: 'warning' });
  assert.deepEqual(closeNote({ closed: false, blocking: [], missing: 1 }), { key: 'ledger.missing', params: { n: 1 }, tone: 'neutral' });
  assert.equal(closeNote({ closed: false, blocking: [], missing: 0 }), null);
  assert.deepEqual(closeNote({ closed: true, closedAt: '2026-11-20 10:05:00', closedByName: 'Иванов И.', blocking: [], missing: 0 }),
    { key: 'ledger.unit.closedAt', params: { date: '20.11.2026', name: 'Иванов И.' }, tone: 'success' });
  assert.deepEqual([canCloseUnit({ closed: false, blocking: [] }, { close: true }), canCloseUnit({ closed: true, blocking: [] }, { close: true }), canCloseUnit({ closed: false, blocking: [{ code: 'self_pending', n: 1 }] }, { close: true }), canCloseUnit({ closed: false, blocking: [] }, { close: false })], [true, false, false, false]);
});

test('the counts of words skip those who left', () => {
  assert.deepEqual(wordCounts([St(), St({ total: 58, word: 'fail' }), St({ status: 'absent', word: null }), St({ status: 'incomplete', word: null }), St({ status: 'not_admitted', word: null }), St({ status: 'none', word: null }), St({ left: true, total: 95, word: 'excellent' })]),
    { excellent: 0, good: 1, fair: 0, fail: 1, absent: 1, incomplete: 1, notAdmitted: 1, none: 1 });
});

test('the line about the credit week', () => {
  const week = { start: '2026-12-14', end: '2026-12-20' };
  assert.deepEqual([examNote(week, '2026-12-15', { closed: false }).key, examNote(week, '2026-12-01', { closed: false }).key,
    examNote({ start: '', end: '' }, '2026-12-15', { closed: false }), examNote(week, '2026-12-15', { closed: true }), examNote(week, '2026-12-21', { closed: false })], ['ledger.exam.now', 'ledger.exam.from', null, null, null]);
  assert.deepEqual(examNote(week, '2026-12-01', { closed: false }).params, { date: '14.12.2026' });
  assert.equal(examNote(week, '2026-12-15').key, 'ledger.exam.now');
});

test('the columns: a group per unit, then the semester, the admission, the exam, the total and the grade', () => {
  const columns = ledgerColumns({ units: [{ unit: 1, title: 'Основы', closed: true }, { unit: 2, title: '', closed: false }] });
  assert.deepEqual(columns.map((c) => c.type), ['unit', 'unit', 'semester', 'admission', 'exam', 'final', 'word']);
  assert.deepEqual(columns[0], { type: 'unit', unit: 1, title: 'Основы', closed: true, fields: ['current', 'self', 'control', 'total'] });
  assert.equal(columns[1].closed, false);
});

const A = (no, outcome, score = null, date = '2026-12-15', commission = '') => ({ id: 'xa_' + no, no, date, outcome, score, commission });
const P = (id, over = {}) => ({ id, left: false, admitted: true, attempts: [], ...over });
const list = [P('a1', { attempts: [A(1, 'score', 35)] }), P('a2', { attempts: [A(1, 'absent')] }), P('a3', { admitted: false }), P('a4'), P('a5', { left: true })];

test('the exam draft holds the first try of those admitted who have not left; the changed ones go to the server', () => {
  assert.deepEqual([...examDraft(list)], [['a1', '35'], ['a2', 'absent'], ['a4', '']]);
  const draft = new Map([['a1', '33'], ['a2', 'absent'], ['a4', 'incomplete']]);
  assert.deepEqual(examItems(draft, list, SP), { items: [{ studentId: 'a1', outcome: 'score', score: 33 }, { studentId: 'a4', outcome: 'incomplete', score: null }], bad: [] });
  assert.deepEqual(examItems(new Map([['a1', ''], ['a2', '41'], ['a4', '3.5']]), list, SP), { items: [{ studentId: 'a1', outcome: null, score: null }], bad: ['a2', 'a4'] });
  assert.deepEqual(examItems(new Map([['a2', '45']]), list, { semester: 50, exam: 50, admission: 25 }).bad, []);
  assert.deepEqual([examNeedsReason([{ studentId: 'a4', outcome: 'score', score: 30 }], list), examNeedsReason([{ studentId: 'a1', outcome: 'score', score: 33 }], list)], [false, true]);
});

test('what stops the closing of the final sheet, and the history of the tries', () => {
  assert.deepEqual([finalNote({ blocking: [{ code: 'units_open', n: 1 }, { code: 'no_date', n: 0 }] }), finalNote({ blocking: [{ code: 'exam_missing', n: 2 }] }), finalNote({ blocking: [] })],
    [{ key: 'ledger.final.block.units_open', params: { n: 1 } }, { key: 'ledger.final.block.exam_missing', params: { n: 2 } }, null]);
  const history = attemptLines([A(1, 'score', 20), A(2, 'score', 21, '2027-01-12'), A(3, 'score', 25, '2027-01-19', 'Член комиссии Первый')]);
  assert.deepEqual(history.map((x) => [x.date, x.label.key, x.label.params, x.result.text]),
    [['2026-12-15', 'ledger.attempt.first', {}, '20'], ['2027-01-12', 'ledger.attempt.retake', { n: 1 }, '21'], ['2027-01-19', 'ledger.attempt.commission', { n: 2 }, '25']]);
  assert.deepEqual(attemptLines([A(1, 'incomplete'), A(2, 'absent', null, '2026-12-18')]).map((x) => [x.label.key, x.result.key]),
    [['ledger.attempt.first', 'ledger.exam.incomplete'], ['ledger.attempt.first', 'ledger.exam.absent']]);
  assert.deepEqual(attemptLabel(A(2, 'score', 5), 1), { key: 'ledger.attempt.retake', params: { n: 1 } });
});

test('the button of the next try', () => {
  assert.deepEqual([nextLabel(null), nextLabel({ no: 2, retake: false, commission: false }), nextLabel({ no: 2, retake: true, commission: false }), nextLabel({ no: 3, retake: true, commission: true })],
    [null, { key: 'ledger.attempt.addFirst' }, { key: 'ledger.attempt.addRetake' }, { key: 'ledger.attempt.addCommission' }]);
});

test('a refused closing of a unit is told with the number from the screen', () => {
  const units = [{ unit: 1, blocking: [{ code: 'pairs_not_held', n: 3 }] }, { unit: 2, blocking: [] }];
  const error = (code) => ({ code: 'invalid', fields: [{ field: 'unit', code }] });
  assert.deepEqual(unitBlockNote(error('pairs_not_held'), units, 1), { key: 'ledger.block.pairs_not_held', params: { n: 3 } });
  assert.equal(unitBlockNote(error('self_pending'), units, 2), null);   // the screen is stale: no number to tell
  assert.equal(unitBlockNote(error('bad_value'), units, 1), null);
  assert.equal(unitBlockNote({ code: 'forbidden' }, units, 1), null);
});

// ---- Task 20: print and files ----

const { translate } = await import('../site/js/i18n.js');
const { default: ruDict } = await import('../site/js/i18n/ru.js');
const { pageRule, ledgerOrientation } = await import('../site/js/print.js');
const { safeFilePart, ledgerFileName, ledgerRows, examHeadLines, examSheetRows, examSheetFileName } = await import('../site/js/ledgerFile.js');
const labels = { t: (key, params) => translate({ ru: ruDict }, 'ru', key, params), sheet: 'Ведомость' };

test('the page rule and the orientation: one unit stands upright, more lie down', () => {
  assert.equal(pageRule('landscape'), '@page { size: A4 landscape; margin: 12mm; }');
  assert.equal(pageRule('x'), '@page { size: A4 portrait; margin: 12mm; }');
  assert.deepEqual([1, 2, 3, 4].map(ledgerOrientation), ['portrait', 'landscape', 'landscape', 'landscape']);
});

test('a part of a file name: bad signs, an empty text and a long text', () => {
  assert.equal(safeFilePart('Анатомия: часть 1/2'), 'Анатомия_ часть 1_2');
  assert.equal(safeFilePart('  '), '_');
  assert.equal(safeFilePart('я'.repeat(60)).length, 40);
  assert.equal(safeFilePart('a\u0001b'), 'a_b');
});

const UNITS = [{ unit: 1, title: 'Основы', closed: true }, { unit: 2, title: '', closed: true }];
const SR = (id, name, over = {}) => ({
  id, fullName: name, left: false, semester: 47, complete: true, admitted: true, status: 'done', exam: 35, total: 82, word: 'good', attempts: [],
  units: [{ unit: 1, current: 38, self: 16, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false, selfPending: 0, manual: false },
    { unit: 2, current: 20, self: null, control: 12, total: 40, word: 'fail', currentLow: true, controlLow: true, selfPending: 0, manual: false }],
  ...over,
});
const TA = (no, outcome, score, date, commission = '') => ({ id: 'x' + no, no, date, outcome, score, commission });
const VIEW = (over = {}) => ({
  today: '2026-12-15', collegeName: 'Колледж Вымышленный', examWeek: { start: '', end: '' },
  subject: { id: 's1', name: 'Информатика', groupName: '02-1', course: 1, teacherName: 'Преподаватель Первый', semester: 1, planSemester: 1 },
  scheme: { current: 40, self: 20, control: 40, minimum: 60, fair: 60, good: 80, excellent: 90 }, split: SP,
  units: UNITS.map((u) => ({ ...u, blocking: [], missing: 0 })),
  exam: { ready: true, date: '2026-12-15', examiner: '', assistants: 'Ассистент Первый', strict: false },
  final: { closed: true, blocking: [] },
  students: [
    SR('a', 'Студент Первый'),
    SR('b', 'Студент Второй', { admitted: false, semester: 25, status: 'not_admitted', exam: null, total: null, word: null }),
    SR('c', 'Студент Третий', { status: 'absent', exam: null, total: null, word: null, attempts: [TA(1, 'absent', null, '2026-12-15')] }),
    SR('d', 'Студент Четвёртый', { status: 'incomplete', exam: null, total: null, word: null, attempts: [TA(1, 'incomplete', null, '2026-12-15')] }),
    SR('e', 'Студент Пятый', { exam: 30, total: 77, word: 'fair', attempts: [TA(1, 'score', 10, '2026-12-15'), TA(2, 'score', 30, '2027-01-12')] }),
    SR('f', 'Студент Выбывший', { left: true }),
  ],
  ...over,
});

test('the rows of the ledger: numbers are numbers, a dash is an empty cell, those who left are not there', () => {
  const rows = ledgerRows(VIEW(), labels);
  assert.equal(rows[0][0], 'Колледж Вымышленный');
  assert.equal(rows[1][0], 'ВЕДОМОСТЬ');
  assert.ok(rows.some((r) => r[1] === 'Дисциплина' && r[2] === 'Информатика'));
  const first = rows.find((r) => r[1] === 'Студент Первый');
  assert.deepEqual(first, [1, 'Студент Первый', 38, 16, 30, 84, 20, '', 12, 40, 47, 'допущен', 35, 82, 'хорошо']);
  const rejected = rows.find((r) => r[1] === 'Студент Второй');
  assert.deepEqual(rejected.slice(-5), [25, 'не допущен: за семестр нужно больше 30', '', '', 'не допущен']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Третий').slice(-3), ['не явился(ась)', '', 'не явился(ась)']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Четвёртый').slice(-3), ['I', '', 'I']);
  assert.ok(!rows.some((r) => r.includes('Студент Выбывший')));
  const counts = rows.find((r) => typeof r[0] === 'string' && r[0].startsWith('отлично: '));
  assert.equal(counts[0], 'отлично: 0 · хорошо: 1 · удовлетворительно: 1 · неудовлетворительно: 0 · не явилось: 1 · I: 1 · не допущено: 1');
  assert.ok(rows.some((r) => r[0] === 'Преподаватель ____________ / Преподаватель Первый'));
  assert.ok(rows.some((r) => r[0] === 'Деканат ____________'));
  assert.ok(!rows.some((r) => r[0] === 'Предварительная'));
  assert.ok(ledgerRows(VIEW({ final: { closed: false, blocking: [] } }), labels).some((r) => r[0] === 'Предварительная'));
  assert.equal(ledgerRows(VIEW({ collegeName: '' }), labels)[0][0], 'ВЕДОМОСТЬ');
});

test('file names: the subject, the group and the date, no name of a student', () => {
  const view = VIEW({ subject: { ...VIEW().subject, name: 'Информатика', groupName: '01-1' } });
  assert.equal(ledgerFileName(view, 'Ведомость'), 'Ведомость_Информатика_01-1_2026-12-15.xlsx');
  assert.equal(examSheetFileName(VIEW(), 'Экзамен'), 'Экзамен_Информатика_02-1_2026-12-15.xlsx');
  assert.equal(examSheetFileName(VIEW({ exam: { ...VIEW().exam, date: '' } }), 'Экзамен').endsWith('_2026-12-15.xlsx'), true);
  assert.ok(!ledgerFileName(VIEW(), 'Ведомость').includes('Студент'));
});

test('the head of the exam sheet: eight lines, seven without a college name; the examiner is the teacher of the subject by default', () => {
  const lines = examHeadLines(VIEW(), labels);
  assert.deepEqual(lines.map((l) => l[0]), ['Колледж', 'Дисциплина', 'Курс', 'Группа', 'Семестр', 'Дата экзамена', 'Экзаменатор', 'Ассистенты']);
  assert.deepEqual(lines.map((l) => l[1]), ['Колледж Вымышленный', 'Информатика', '1', '02-1', '1', '15.12.2026', 'Преподаватель Первый', 'Ассистент Первый']);
  assert.equal(examHeadLines(VIEW({ collegeName: '' }), labels).length, 7);
  assert.equal(examHeadLines(VIEW({ exam: { ...VIEW().exam, examiner: 'Другой Экзаменатор', assistants: '', date: '' } }), labels).slice(-3).map((l) => l[1]).join('|'), '|Другой Экзаменатор|');
});

test('the rows of the exam sheet: the last try in the table, the retakes under it, empty cells before the exam', () => {
  const rows = examSheetRows(VIEW(), labels);
  assert.equal(rows[0][0], 'Экзаменационная ведомость');
  assert.deepEqual(rows.find((r) => r[0] === '№'), ['№', 'ФИО', 'Семестр (из 60)', 'Экзамен (из 40)', 'Итог (из 100)', 'Оценка']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Пятый' && r.length === 6), [5, 'Студент Пятый', 47, 30, 77, 'удовлетворительно']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Второй'), [2, 'Студент Второй', 25, '', '', 'не допущен']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Третий').slice(3), ['', '', 'не явился(ась)']);
  assert.deepEqual(rows.find((r) => r[1] === 'Студент Четвёртый').slice(3), ['', '', 'I']);
  const at = rows.findIndex((r) => r[0] === 'Пересдачи');
  assert.ok(at > 0);
  assert.deepEqual(rows[at + 1], ['', 'Студент Пятый', '12.01.2027', 'пересдача 1', 30, '']);
  assert.ok(rows.some((r) => r[0] === 'Директор / заместитель директора по учебной работе ____________'));
  assert.ok(rows.some((r) => r[0] === 'Экзаменатор ____________ / Преподаватель Первый'));
  const before = VIEW({
    students: [SR('a', 'Студент Первый', { status: 'none', exam: null, total: null, word: null }), VIEW().students[1]],
    final: { closed: false, blocking: [] },
  });
  const empty = examSheetRows(before, labels);
  assert.deepEqual(empty.find((r) => r[1] === 'Студент Первый'), [1, 'Студент Первый', 47, '', '', '']);
  assert.ok(empty.some((r) => r[0] === 'не допущено: 1'));   // nothing to count before the exam but those who are not admitted
  assert.ok(!empty.some((r) => r[0] === 'Пересдачи'));
});

const { closeFinalState, examModeOf, examFieldTarget } = await import('../site/js/ledger.js');

test('above the exam part: with open units the button is replaced by the number of units that are not closed', () => {
  const view = (over) => ({ final: { closed: false, blocking: [{ code: 'units_open', n: 2 }, { code: 'no_date', n: 0 }] }, can: { close: true }, exam: { ready: false }, ...over });
  assert.deepEqual(closeFinalState(view()), { kind: 'stop', note: { key: 'ledger.final.block.units_open', params: { n: 2 } } });
  assert.deepEqual(closeFinalState(view({ final: { closed: false, blocking: [{ code: 'exam_missing', n: 1 }] }, exam: { ready: true } })).kind, 'stop');
  assert.equal(closeFinalState(view({ final: { closed: false, blocking: [] }, exam: { ready: true } })).kind, 'button');
  assert.equal(closeFinalState(view({ final: { closed: false, blocking: [] } })).kind, 'none');
  assert.equal(closeFinalState(view({ can: { close: false } })).kind, 'none');
  assert.equal(closeFinalState(view({ final: { closed: true, blocking: [] } })).kind, 'none');
});

test('a field of the exam column is shown as its draft says; its error sits on the control that is shown', () => {
  assert.deepEqual(['', '35', 'absent', 'incomplete'].map(examModeOf), ['score', 'score', 'absent', 'incomplete']);
  assert.deepEqual(['', '35', 'x1', 'absent', 'incomplete'].map(examFieldTarget), ['input', 'input', 'input', 'select', 'select']);
});

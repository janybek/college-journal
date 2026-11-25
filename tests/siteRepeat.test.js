import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_STATES, EXAM_TRIES_MAX, stateOf, stateBadge, filterOptions, filterRepeats, prevLine, totalLine, enrolDraft, retakesLeft, orderLine,
  worksState, admissionLine, attemptForm, fixTarget, closeNote, canClose, homeRepeats, studentCard, finalWithRepeat, homeRepeat } from '../site/js/repeat.js';
import { EXAM } from '../core/exam.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';

const ROWS = [
  { id: 'a', status: 'open', overdue: false, groupName: '02-1', subjectName: 'Информатика', own: true },
  { id: 'b', status: 'open', overdue: true, groupName: '02-1', subjectName: 'Информатика', own: false },
  { id: 'c', status: 'passed', overdue: false, groupName: '03-2', subjectName: 'Физика', own: false },
  { id: 'd', status: 'failed', overdue: false, groupName: '03-2', subjectName: 'Информатика', own: true },
  { id: 'e', status: 'cancelled', overdue: false, groupName: '02-1', subjectName: 'Физика', own: false },
];
const ids = (list) => list.map((r) => r.id).join('');

test('stateOf and stateBadge: the five states', () => {
  assert.deepEqual(ROWS.map(stateOf), ['open', 'overdue', 'passed', 'failed', 'cancelled']);
  assert.deepEqual(ROWS.map(stateBadge), [
    { key: 'repeat.state.open', tone: 'primary' }, { key: 'repeat.state.overdue', tone: 'warning' }, { key: 'repeat.state.passed', tone: 'success' },
    { key: 'repeat.state.failed', tone: 'danger' }, { key: 'repeat.state.cancelled', tone: 'neutral' }]);
  assert.equal(stateOf({ status: 'passed', overdue: true }), 'passed');
});

test('filterRepeats: by group, subject, overdue and own; filterOptions without repeats', () => {
  assert.equal(ids(filterRepeats(ROWS, {})), 'abcde');
  assert.equal(ids(filterRepeats(ROWS, { group: '03-2' })), 'cd');
  assert.equal(ids(filterRepeats(ROWS, { subject: 'Физика' })), 'ce');
  assert.equal(ids(filterRepeats(ROWS, { state: 'overdue' })), 'b');
  assert.equal(ids(filterRepeats(ROWS, { state: 'open' })), 'a');
  assert.equal(ids(filterRepeats(ROWS, { own: true })), 'ad');
  assert.equal(ids(filterRepeats(ROWS, { group: '02-1', subject: 'Информатика', state: 'overdue', own: true })), '');
  assert.deepEqual(filterOptions(ROWS), { groups: ['02-1', '03-2'], subjects: ['Информатика', 'Физика'] });
  assert.deepEqual(REPEAT_STATES, ['all', 'open', 'overdue', 'passed', 'failed', 'cancelled']);
});

test('prevLine: the four statuses, the maximum from split', () => {
  const split = { semester: 60, exam: 40 };
  assert.deepEqual(prevLine({ status: 'done', semester: 40, exam: 12, total: 52 }, split), { key: 'repeat.prev.done', params: { total: 52, max: 100, semester: 40, exam: 12 } });
  assert.equal(prevLine({ status: 'done', semester: 20, exam: 20, total: 40 }, { semester: 50, exam: 50 }).params.max, 100);
  assert.deepEqual(prevLine({ status: 'not_admitted', semester: 25 }, split), { key: 'repeat.prev.notAdmitted', params: { semester: 25 } });
  assert.deepEqual(prevLine({ status: 'absent', semester: 45 }, split), { key: 'repeat.prev.absent', params: { semester: 45 } });
  assert.deepEqual(prevLine({ status: 'incomplete', semester: 45 }, split), { key: 'repeat.prev.incomplete', params: { semester: 45 } });
  assert.equal(prevLine({ status: 'absent', semester: null }, split).params.semester, '—');
});

test('totalLine: preliminary, closed, not admitted, nothing', () => {
  const split = { semester: 60, exam: 40 };
  const open = { status: 'open', split, result: { status: 'done', total: 75, word: 'fair' } };
  assert.deepEqual(totalLine(open), { key: 'repeat.total.preliminary', params: { total: 75, max: 100 }, tone: 'warning', word: 'fair' });
  const passed = { status: 'passed', split, result: { status: 'done', total: 80, word: 'good' } };
  assert.deepEqual(totalLine(passed), { key: 'repeat.total', params: { total: 80, max: 100 }, tone: 'primary', word: 'good' });
  assert.equal(totalLine({ status: 'open', split, result: { status: 'not_admitted', total: null, word: null } }).key, 'repeat.total.notAdmitted');
  assert.equal(totalLine({ status: 'open', split, result: { status: 'none', total: null, word: null } }), null);
  assert.equal(totalLine({ ...open, split: { semester: 50, exam: 50 } }).params.max, 100);
});

test('enrolDraft: the suggested kind, the date of today, the teacher of the subject', () => {
  const subject = { teacherId: 'st_1' };
  assert.deepEqual(enrolDraft({ suggest: 'full' }, subject, '2026-11-25'), { kind: 'full', orderNo: '', orderDate: '2026-11-25', deadline: '', teacherId: 'st_1' });
  assert.equal(enrolDraft({ suggest: null }, subject, '2026-11-25').kind, 'full');
});

test('retakesLeft and orderLine; the number of sittings is the one of the server', () => {
  assert.equal(EXAM_TRIES_MAX, EXAM.triesMax);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 0 }), 2);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 1 }), 2);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 2 }), 1);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 3 }), 0);
  assert.equal(retakesLeft({ retakesLeft: false, tries: 1 }), 0);
  assert.deepEqual(orderLine('45-А', '2026-11-20'), { key: 'repeat.order', params: { no: '45-А', date: '20.11.2026' } });
  assert.equal(orderLine('', ''), null);
});

test('every text the repeat screens ask for exists in the three dictionaries', () => {
  for (const state of REPEAT_STATES) for (const dict of [ru, ky, en]) assert.ok(dict['repeat.state.' + state], state);
  for (const key of ['repeat.title', 'repeat.mine.title', 'repeat.hint', 'repeat.empty', 'repeat.enrol', 'repeat.order', 'repeat.prev.done', 'repeat.prev.notAdmitted', 'repeat.prev.absent', 'repeat.prev.incomplete',
    'repeat.total', 'repeat.total.preliminary', 'repeat.total.notAdmitted', 'error.repeat_closed', 'error.deadline_passed']) {
    for (const dict of [ru, ky, en]) assert.ok(dict[key], key);
  }
  assert.equal(ru['error.repeat_closed'], 'Повторный курс закрыт или отменён: изменить нельзя.');
  assert.equal(ru['error.deadline_passed'], 'Срок повтора вышел: баллы не ставятся, пока деканат не продлит срок.');
});

// ---- The card of the teacher of the repeat ----

const SPLIT = { semester: 60, exam: 40, admission: 30 };
const card = (over = {}) => ({
  status: 'open', overdue: false, kind: 'full', split: SPLIT, closedAt: '', closedByName: '',
  works: { value: null, note: '' }, attempts: [],
  result: { semester: null, admitted: false, status: 'not_admitted', tries: 0, exam: null, total: null, word: null, next: null },
  close: { blocking: [{ code: 'no_works' }], outcome: 'failed', retakesLeft: false },
  can: { works: true, attempt: false, commission: false, close: true, force: false, reopen: false, edit: false, cancel: false },
  ...over,
});
const admitted = (next, over = {}) => card({
  works: { value: 45, note: 'done' }, close: { blocking: [{ code: 'exam_missing' }], outcome: 'failed', retakesLeft: false },
  result: { semester: 45, admitted: true, status: 'none', tries: 0, exam: null, total: null, word: null, next }, ...over,
});

test('worksState: whole subject without and with a number, only the exam, the maximum of the answer', () => {
  assert.deepEqual(worksState(card()), { show: true, value: null, note: '', max: 60, edit: true, needReason: false });
  assert.equal(worksState(card({ works: { value: 0, note: 'x' } })).needReason, true);
  assert.equal(worksState(card({ kind: 'exam' })).show, false);
  assert.equal(worksState(card({ split: { semester: 50, exam: 50, admission: 25 } })).max, 50);
  assert.equal(worksState(card({ can: { works: false } })).edit, false);
});

test('admissionLine: admitted, below the line, nothing', () => {
  const ok = card({ works: { value: 31, note: 'x' }, result: { admitted: true } });
  assert.deepEqual(admissionLine(ok), { key: 'repeat.admission.yes', params: {}, tone: 'success' });
  const low = card({ works: { value: 30, note: 'x' }, result: { admitted: false } });
  assert.deepEqual(admissionLine(low), { key: 'repeat.admission.low', params: { need: 30 }, tone: 'danger' });
  assert.equal(admissionLine(card()), null);
  assert.equal(admissionLine(card({ kind: 'exam', works: { value: 40, note: '' } })), null);
});

test('attemptForm: the first sitting, a retake, a commission by the teacher and by the deanery, nothing to enter', () => {
  const can = (attempt, commission) => ({ works: true, attempt, commission, close: true });
  assert.deepEqual(attemptForm(admitted({ no: 1, retake: false, commission: false }, { can: can(true, false) })), { no: 1, retake: false, commission: false, canEnter: true });
  assert.deepEqual(attemptForm(admitted({ no: 2, retake: true, commission: false }, { can: can(true, false) })), { no: 2, retake: true, commission: false, canEnter: true });
  assert.equal(attemptForm(admitted({ no: 3, retake: true, commission: true }, { can: can(true, false) })).canEnter, false);
  assert.equal(attemptForm(admitted({ no: 3, retake: true, commission: true }, { can: can(true, true) })).canEnter, true);
  assert.equal(attemptForm(admitted(null)), null);
  assert.equal(attemptForm(card()), null);
  assert.equal(attemptForm(admitted({ no: 1, retake: false, commission: false }, { overdue: true, can: can(false, false) })).canEnter, false);
});

test('fixTarget: the last sitting; a commission one only for the deanery; nothing when closed, overdue or without sittings', () => {
  const a1 = { no: 1, date: '2026-11-20', outcome: 'score', score: 10, commission: '' };
  const a2 = { no: 2, date: '2026-11-22', outcome: 'score', score: 12, commission: '' };
  const a3 = { no: 3, date: '2026-11-24', outcome: 'score', score: 30, commission: 'A, B' };
  const open = (attempts, can = {}) => admitted(null, { attempts, can: { works: true, attempt: false, commission: false, close: true, ...can } });
  assert.equal(fixTarget(open([a1, a2])), a2);
  assert.equal(fixTarget(open([a1, a2, a3])), null);
  assert.equal(fixTarget(open([a1, a2, a3], { commission: true })), a3);
  assert.equal(fixTarget(open([])), null);
  assert.equal(fixTarget({ ...open([a1]), overdue: true }), null);
  assert.equal(fixTarget(open([a1], { close: false })), null);
});

test('closeNote: closed, blocked, retakes left, ready', () => {
  const closed = card({ status: 'passed', closedAt: '2026-01-20 10:00:00', closedByName: 'Иванов И.' });
  assert.deepEqual(closeNote(closed), { key: 'repeat.closed.passed', params: { date: '20.01.2026', name: 'Иванов И.' }, tone: 'success' });
  assert.equal(closeNote({ ...closed, status: 'failed' }).tone, 'danger');
  assert.deepEqual(closeNote(card()), { key: 'repeat.block.no_works', params: {}, tone: 'warning' });
  assert.equal(closeNote(admitted(null)).key, 'repeat.block.exam_missing');
  const left = card({ close: { blocking: [], outcome: 'failed', retakesLeft: true } });
  assert.deepEqual(closeNote(left), { key: 'repeat.close.retakesLeft', params: {}, tone: 'warning' });
  const ready = card({ close: { blocking: [], outcome: 'passed', retakesLeft: false } });
  assert.deepEqual(closeNote(ready), { key: 'repeat.close.ready.passed', params: {}, tone: 'neutral' });
  assert.equal(closeNote(card({ status: 'cancelled' })), null);
});

test('canClose: a block stops it, the force of the deanery lifts it', () => {
  assert.equal(canClose(card()), false);
  assert.equal(canClose(card({ can: { close: true, force: true } })), true);
  assert.equal(canClose(card({ close: { blocking: [], outcome: 'passed', retakesLeft: false } })), true);
  assert.equal(canClose(card({ close: { blocking: [], outcome: 'passed', retakesLeft: false }, can: { close: false } })), false);
});

test('homeRepeats: only own open cards, the overdue ones counted apart', () => {
  const rows = [
    { own: true, status: 'open', overdue: false }, { own: true, status: 'open', overdue: true }, { own: true, status: 'passed', overdue: false },
    { own: true, status: 'cancelled', overdue: false }, { own: false, status: 'open', overdue: true },
  ];
  assert.deepEqual(homeRepeats(rows), { open: 2, overdue: 1 });
  assert.deepEqual(homeRepeats([]), { open: 0, overdue: 0 });
});

test('the texts of the card of the teacher: three dictionaries, the maxima are placeholders, no 60, 40 or 30', () => {
  const keys = Object.keys(ru).filter((k) => /^(repeat\.(card|block|admission|works|exam|attempt|close|closed|finish|reopen|leave|total)\.|home\.repeat\.)/.test(k));
  assert.ok(keys.length > 30);
  for (const key of keys) {
    for (const [name, dict] of [['ru', ru], ['ky', ky], ['en', en]]) {
      assert.ok(dict[key], `${name} has ${key}`);
      assert.ok(!/(^|\D)(60|40|30)(\D|$)/.test(dict[key]), `${name} ${key} has a number of the scheme`);
    }
  }
  for (const key of ['repeat.admission.low', 'repeat.works.value', 'repeat.error.works.bad_value', 'repeat.error.score.bad_value']) {
    for (const dict of [ru, ky, en]) assert.ok(/\{(max|need)\}/.test(dict[key]), key);
  }
});

// ---- Task 11: the sheet of a repeat course ----

import { repeatSheet } from '../site/js/repeat.js';
import { translate } from '../site/js/i18n.js';
import { ledgerSheet, examSheet } from '../site/js/ledgerFile.js';

const sheetT = (key, params) => translate({ ru }, 'ru', key, params);
const sheetLabels = { t: sheetT, title: sheetT('repeat.print.title'), draft: sheetT('repeat.print.draft') };
const cardView = (over = {}) => ({
  id: 'r1', status: 'passed', kind: 'full', overdue: false, collegeName: 'Колледж Вымышленный',
  student: { id: 's', fullName: 'Студент Вымышленный', groupName: '02-1', course: 2 },
  subject: { id: 'sb', name: 'Информатика', planSemester: 3 }, teacher: { id: 't', fullName: 'Преподаватель Третий' },
  order: { no: '45-к', date: '2026-11-10' }, deadline: '2027-02-01',
  prev: { semester: 38, admitted: true, status: 'done', exam: 20, total: 58, word: 'fail', tries: 3, attempts: [], fromRepeat: false },
  works: { value: 45, note: 'Сдал проект' },
  attempts: [{ id: 'a', no: 1, date: '2026-12-01', outcome: 'score', score: 30, commission: '' }],
  result: { semester: 45, admitted: true, status: 'done', tries: 1, exam: 30, total: 75, word: 'fair', next: null },
  split: { semester: 60, exam: 40, admission: 30 },
  ...over,
});

test('repeatSheet: a closed repeat of the whole subject: 13 facts in order, the points are numbers, the sign of the teacher of the repeat', () => {
  const sheet = repeatSheet(cardView(), sheetLabels);
  assert.equal(sheet.draft, '');
  assert.equal(sheet.college, 'Колледж Вымышленный');
  assert.equal(sheet.title, 'ЛИСТ ПОВТОРНОГО КУРСА');
  assert.equal(sheet.facts.length, 13);
  assert.deepEqual(sheet.facts.map(([label]) => label), [
    ru['repeat.fact.student'], ru['repeat.fact.group'], ru['repeat.print.course'], ru['repeat.fact.subject'], ru['repeat.fact.semester'], ru['repeat.fact.kind'],
    ru['repeat.fact.order'], ru['repeat.fact.deadline'], ru['repeat.fact.teacher'], ru['repeat.prev.title'], ru['repeat.works.title'], ru['repeat.print.total'], ru['repeat.print.result']]);
  assert.deepEqual(sheet.facts.slice(0, 5).map(([, value]) => value), ['Студент Вымышленный', '02-1', '2', 'Информатика', '3']);
  assert.equal(sheet.facts[5][1], 'Весь предмет');
  assert.equal(sheet.facts[6][1], '№ 45-к от 10.11.2026');
  assert.equal(sheet.facts[7][1], '01.02.2027');
  assert.equal(sheet.facts[8][1], 'Преподаватель Третий');
  assert.match(sheet.facts[9][1], /58 из 100/);
  assert.equal(sheet.facts[10][1], '45 из 60. Сдал проект');
  assert.equal(sheet.facts[11][1], '75 из 100 · ' + ru['journal.grade.fair']);
  assert.equal(sheet.facts[12][1], 'сдал');
  assert.deepEqual(sheet.body, [[1, '01.12.2026', 30, '']]);
  assert.equal(typeof sheet.body[0][2], 'number');
  assert.equal(sheet.head[0].length, 4);
  assert.equal(sheet.counts, null);
  assert.equal(sheet.retakes, null);
  assert.deepEqual(sheet.merges, []);
  assert.equal(sheet.signs[0], 'Преподаватель ____________ / Преподаватель Третий');
  assert.equal(sheet.signs[1], 'Декан ____________');
});

test('repeatSheet: an open repeat is preliminary, without sittings one empty row; the result is empty', () => {
  const sheet = repeatSheet(cardView({ status: 'open', attempts: [], result: { semester: 45, admitted: true, status: 'incomplete', tries: 0, exam: null, total: null, word: null, next: { no: 1 } } }), sheetLabels);
  assert.equal(sheet.draft, 'Предварительный');
  assert.deepEqual(sheet.body, [['', '', '', '']]);
  assert.equal(sheet.facts[11][1], '');
  assert.equal(sheet.facts[12][1], '');
});

test('repeatSheet: «только экзамен» has the previous semester instead of the works; a failed one says so; words stay words', () => {
  const sheet = repeatSheet(cardView({
    kind: 'exam', status: 'failed', works: { value: null, note: '' },
    attempts: [{ no: 1, date: '2026-12-01', outcome: 'absent', score: null, commission: '' }, { no: 2, date: '2026-12-10', outcome: 'incomplete', score: null, commission: '' },
      { no: 3, date: '2026-12-20', outcome: 'score', score: 12, commission: 'Комиссия из трёх' }],
    result: { semester: 38, admitted: true, status: 'done', tries: 3, exam: 12, total: 50, word: 'fail', next: null },
  }), sheetLabels);
  assert.deepEqual(sheet.facts[10], ['Баллы за семестр (прежние)', '38 из 60']);
  assert.equal(sheet.facts[12][1], 'не сдал');
  assert.deepEqual(sheet.body.map((row) => row[2]), ['не явился(ась)', 'I', 12]);
  assert.equal(sheet.body[2][3], 'Комиссия из трёх');
});

test('repeatSheet: no college name is an empty line; a name like a formula or a tag stays a text; not admitted', () => {
  const view = cardView({
    collegeName: '', student: { fullName: '=СУММ(A1)', groupName: '<script>', course: null }, teacher: { fullName: '<script>alert(1)</script>' },
    result: { semester: 20, admitted: false, status: 'not_admitted', tries: 0, exam: null, total: null, word: null, next: null },
  });
  const sheet = repeatSheet(view, sheetLabels);
  assert.equal(sheet.college, '');
  assert.equal(sheet.facts[0][1], '=СУММ(A1)');
  assert.equal(sheet.facts[1][1], '<script>');
  assert.equal(sheet.facts[2][1], '');
  assert.equal(sheet.facts[11][1], 'не допущен');
  assert.match(sheet.signs[0], /<script>alert\(1\)<\/script>/);
  for (const [, value] of sheet.facts) assert.equal(typeof value, 'string');
});

test('the dictionaries have the keys of the sheet, the badge and the change log in three languages', () => {
  for (const dict of [ru, ky, en]) {
    for (const key of ['title', 'draft', 'button', 'course', 'prevSemester', 'worksOf', 'total', 'totalOf', 'result', 'passed', 'failed', 'signDean']) assert.ok(dict['repeat.print.' + key], key);
    for (const key of ['open', 'passed', 'failed']) assert.ok(dict['ledger.repeat.' + key], key);
    for (const field of ['enrol', 'orderNo', 'orderDate', 'deadline', 'teacher', 'works', 'try', 'status']) assert.ok(dict['journal.log.repeat.' + field], field);
    for (const kind of ['full', 'exam']) assert.ok(dict['journal.log.repeat.kind.' + kind], kind);
    for (const st of ['open', 'passed', 'failed', 'cancelled']) assert.ok(dict['journal.log.repeat.state.' + st], st);
  }
});

test('the print and the Excel sheet of the ledger do not change when a student has a repeat', () => {
  const base = {
    today: '2026-12-15', collegeName: 'Колледж', subject: { id: 's1', name: 'Информатика', groupName: '02-1', course: 1, teacherName: 'П', semester: 1, planSemester: 1 },
    split: { semester: 60, exam: 40, admission: 30 }, units: [{ unit: 1, title: '', closed: true, blocking: [], missing: 0 }],
    exam: { ready: true, date: '2026-12-15', examiner: '', assistants: '' }, final: { closed: true, blocking: [] },
  };
  const student = {
    id: 'a', fullName: 'Студент', left: false, semester: 47, complete: true, admitted: true, status: 'done', exam: 20, total: 67, word: 'fair',
    units: [{ unit: 1, current: 38, self: 16, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false, selfPending: 0 }], attempts: [],
  };
  const plain = { ...base, students: [student] };
  const marked = { ...base, students: [{ ...student, repeat: { kind: 'full', status: 'passed', total: 80, word: 'good', main: true } }] };
  const labels = { t: sheetT, sheet: 'Ведомость' };
  assert.deepEqual(ledgerSheet(marked, labels), ledgerSheet(plain, labels));
  assert.deepEqual(examSheet(marked, labels), examSheet(plain, labels));
});

// ---- The student: the card on the home screen and in «Оценки» ----

const item = (over = {}) => ({
  subjectName: 'Информатика', planSemester: 1, kind: 'full', orderNo: '12-с', orderDate: '2026-11-24', deadline: '2027-02-01', overdue: false, status: 'open',
  teacherName: 'Иванов И.', works: { value: 45, note: '', max: 60 }, attempts: [{ no: 1, date: '2026-12-01', outcome: 'score', score: 30 }],
  exam: 30, total: 75, word: 'good', preliminary: true, prev: { semester: 40, status: 'done', exam: 18, total: 58, word: 'fail' }, ...over,
});
const keysOf = (card) => card.lines.map((l) => l.key);

test('studentCard: the whole subject, open: the lines in order, the preliminary total, the previous total last', () => {
  const card = studentCard(item(), SPLIT);
  assert.equal(card.title, 'Информатика');
  assert.deepEqual(keysOf(card), ['grades.repeat.kind.full', 'grades.repeat.order', 'grades.repeat.deadline', 'grades.repeat.teacher', 'grades.repeat.works',
    'grades.repeat.totalPreliminary', 'grades.repeat.prev']);
  assert.deepEqual(card.lines[1].params, { no: '12-с', date: '24.11.2026' });
  assert.deepEqual(card.lines[2].params, { date: '01.02.2027' });
  assert.deepEqual(card.lines[3].params, { name: 'Иванов И.' });
  assert.deepEqual(card.lines[4].params, { value: 45, max: 60 });
  const total = card.lines[5];
  assert.deepEqual(total.params, { total: 75, max: 100 });
  assert.equal(total.word, 'good');
  assert.equal(total.tone, 'primary');
  assert.deepEqual(card.lines[6].params, { total: 58, max: 100 });
});

test('studentCard: works with a note, no works yet, no try yet', () => {
  assert.ok(keysOf(studentCard(item({ works: { value: 45, note: 'Три работы', max: 60 } }), SPLIT)).includes('grades.repeat.worksNote'));
  const bare = studentCard(item({ works: { value: null, note: '', max: 60 }, attempts: [], exam: null, total: null, word: null }), SPLIT);
  assert.ok(keysOf(bare).includes('grades.repeat.worksNone'));
  assert.ok(keysOf(bare).includes('grades.repeat.examNone'));
  assert.ok(!keysOf(bare).includes('grades.repeat.totalPreliminary'));
});

test('studentCard: failed without a total, passed with a total, no previous total', () => {
  const failed = studentCard(item({ status: 'failed', preliminary: false, total: null, word: null, exam: null, attempts: [] }), SPLIT);
  assert.ok(keysOf(failed).includes('grades.repeat.failedNoTotal'));
  assert.ok(!keysOf(failed).includes('grades.repeat.examNone'));
  const passed = studentCard(item({ status: 'passed', preliminary: false, total: 80, word: 'good' }), SPLIT);
  const line = passed.lines.find((l) => l.key === 'grades.repeat.total');
  assert.deepEqual(line.params, { total: 80, max: 100 });
  assert.equal(line.word, 'good');
  const none = studentCard(item({ prev: { semester: null, status: 'incomplete', exam: null, total: null, word: null } }), SPLIT);
  assert.equal(keysOf(none).at(-1), 'grades.repeat.prevNone');
});

test('studentCard: exam only shows the previous semester, no works; overdue is a warning', () => {
  const card = studentCard(item({ kind: 'exam', works: { value: null, note: '', max: 60 }, overdue: true }), SPLIT);
  const keys = keysOf(card);
  assert.equal(keys[0], 'grades.repeat.kind.exam');
  assert.ok(!keys.includes('grades.repeat.works') && !keys.includes('grades.repeat.worksNone'));
  const prevSemester = card.lines.find((l) => l.key === 'grades.repeat.prevSemester');
  assert.deepEqual(prevSemester.params, { value: 40, max: 60 });
  const late = card.lines.find((l) => l.key === 'grades.repeat.overdue');
  assert.equal(late.tone, 'warning');
  assert.ok(!keys.includes('grades.repeat.deadline'));
  assert.equal(studentCard(item({ overdue: true, status: 'passed' }), SPLIT).lines.some((l) => l.key === 'grades.repeat.overdue'), false);
});

test('studentCard: the maxima come from split', () => {
  const card = studentCard(item(), { semester: 50, exam: 50, admission: 25 });
  assert.equal(card.lines.find((l) => l.key === 'grades.repeat.works').params.max, 50);
  assert.equal(card.lines.find((l) => l.key === 'grades.repeat.totalPreliminary').params.max, 100);
});

test('finalWithRepeat: no card is null, main and pending', () => {
  assert.equal(finalWithRepeat({}, SPLIT), null);
  const main = finalWithRepeat({ repeat: { kind: 'full', status: 'passed', total: 80, word: 'good', main: true } }, SPLIT);
  assert.deepEqual(main, { key: 'grades.repeat.main', params: { total: 80, max: 100 }, tone: 'primary', word: 'good' });
  const pending = finalWithRepeat({ repeat: { kind: 'full', status: 'open', total: 75, word: 'good', main: false } }, SPLIT);
  assert.equal(pending.key, 'grades.repeat.pending');
  assert.deepEqual(pending.params, { total: 75, max: 100 });
  const failed = finalWithRepeat({ repeat: { kind: 'full', status: 'failed', total: null, word: null, main: true } }, SPLIT);
  assert.equal(failed.key, 'grades.repeat.mainNone');
});

test('homeRepeat: closed do not count, the nearest deadline first', () => {
  assert.equal(homeRepeat([]), null);
  assert.equal(homeRepeat([item({ status: 'passed' }), item({ status: 'failed' })]), null);
  const home = homeRepeat([item({ subjectName: 'Физика', deadline: '2027-03-01' }), item({ status: 'passed' }),
    item({ subjectName: 'Химия', deadline: '2027-02-01', overdue: true })]);
  assert.deepEqual(home, { count: 2, nearest: { subjectName: 'Химия', deadline: '2027-02-01', overdue: true } });
});

test('the dictionaries have the grades.repeat.* and home.repeat.* keys in three languages, with no scale numbers in the texts', () => {
  const keys = ['grades.repeat.title', 'grades.repeat.kind.full', 'grades.repeat.kind.exam', 'grades.repeat.order', 'grades.repeat.deadline', 'grades.repeat.overdue',
    'grades.repeat.teacher', 'grades.repeat.works', 'grades.repeat.worksNote', 'grades.repeat.worksNone', 'grades.repeat.prevSemester', 'grades.repeat.examNone',
    'grades.repeat.totalPreliminary', 'grades.repeat.total', 'grades.repeat.failedNoTotal', 'grades.repeat.prev', 'grades.repeat.prevNone', 'grades.repeat.attempts',
    'grades.repeat.main', 'grades.repeat.mainNone', 'grades.repeat.pending', 'grades.repeat.tag', 'grades.repeat.before',
    'home.repeat.title', 'home.repeat.until', 'home.repeat.late', 'home.repeat.more', 'home.repeat.others'];
  for (const dict of [ru, ky, en]) {
    for (const key of keys) {
      assert.ok(dict[key], key);
      assert.doesNotMatch(dict[key], /\b(60|40|100)\b/, key);
    }
  }
});

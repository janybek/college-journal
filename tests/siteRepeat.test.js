import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_STATES, EXAM_TRIES_MAX, stateOf, stateBadge, filterOptions, filterRepeats, prevLine, totalLine, enrolDraft, retakesLeft, orderLine,
  worksState, admissionLine, attemptForm, fixTarget, closeNote, canClose, homeRepeats } from '../site/js/repeat.js';
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

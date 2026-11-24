import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import {
  REPEAT, attemptsText, parseAttemptsText, snapshotOf, prevOf, canRepeat, suggestKind, enrolProblem,
  checkOrder, repeatResult, checkWorks, checkRepeatAttempt, closeState, isOverdue, shownCard, isMain,
} from '../core/repeat.js';

const S = DEFAULT_SCHEME, SP = DEFAULT_SPLIT;
const A = (no, outcome, score = null, date = '2027-01-15') => ({ no, outcome, score, date });
const full = (works, over = {}) => ({ kind: 'full', works, prevSemester: 38, prevAdmitted: true, orderDate: '2026-12-20', deadline: '2027-02-01', status: 'open', ...over });
const exam = (over = {}) => full(null, { kind: 'exam', ...over });
const res = (card, attempts = [], split = SP) => repeatResult({ card, attempts, scheme: S, split });
const pick = ({ semester, admitted, status, exam: e, total, word }) => ({ semester, admitted, status, exam: e, total, word });
const prev = { semester: 38, admitted: true, status: 'done', exam: 20, total: 58, word: 'fail', attempts: [A(1, 'score', 20, '2026-12-15')] };

test('REPEAT constants', () => {
  assert.deepEqual({ ...REPEAT }, { orderMax: 40, noteMax: 300, deadlineDaysMax: 366 });
});

test('repeatResult: full and exam', () => {
  assert.deepEqual(pick(res(full(45), [A(1, 'score', 30)])), { semester: 45, admitted: true, status: 'done', exam: 30, total: 75, word: 'fair' });
  assert.deepEqual([res(full(null)).status, res(full(30)).status, res(full(31)).status], ['not_admitted', 'not_admitted', 'none']);
  assert.deepEqual(pick(res(exam(), [A(1, 'score', 22)])), { semester: 38, admitted: true, status: 'done', exam: 22, total: 60, word: 'fair' });
  assert.equal(res(exam(), [A(1, 'score', 21)]).word, 'fail');
  assert.equal(res(exam({ prevAdmitted: false, prevSemester: 25 })).status, 'not_admitted');
  assert.equal(res(exam({ prevSemester: null })).status, 'not_admitted');
  assert.equal(res(full(26), [A(1, 'score', 50)], { semester: 50, exam: 50, admission: 25 }).total, 76);
  assert.equal(res(full(25), [], { semester: 50, exam: 50, admission: 25 }).status, 'not_admitted');
  assert.deepEqual(Object.keys(res(full(45))).sort(), ['admitted', 'exam', 'next', 'semester', 'status', 'total', 'tries', 'word']);
});

test('closeState', () => {
  const cs = (card, attempts = []) => closeState({ card, result: res(card, attempts) });
  assert.deepEqual(cs(full(null)), { blocking: [{ code: 'no_works' }], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(full(30)), { blocking: [], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(full(31)), { blocking: [{ code: 'exam_missing' }], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(full(45), [A(1, 'incomplete')]), { blocking: [{ code: 'exam_incomplete' }], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(full(45), [A(1, 'score', 30)]), { blocking: [], outcome: 'passed', retakesLeft: false });
  assert.deepEqual(cs(full(45), [A(1, 'score', 10)]), { blocking: [], outcome: 'failed', retakesLeft: true });
  assert.deepEqual(cs(full(45), [A(1, 'score', 10), A(2, 'absent', null, '2027-01-20'), A(3, 'score', 5, '2027-01-25')]), { blocking: [], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(full(45), [A(1, 'absent')]), { blocking: [], outcome: 'failed', retakesLeft: true });
  assert.deepEqual(cs(exam()), { blocking: [{ code: 'exam_missing' }], outcome: 'failed', retakesLeft: false });
  assert.deepEqual(cs(exam({ prevAdmitted: false })), { blocking: [], outcome: 'failed', retakesLeft: false });
  // boundary 60 passes, 59 fails
  assert.equal(cs(exam(), [A(1, 'score', 22)]).outcome, 'passed');
  assert.equal(cs(exam(), [A(1, 'score', 21)]).outcome, 'failed');
});

test('snapshot and attempts text', () => {
  assert.deepEqual(snapshotOf(prev), { prevSemester: 38, prevAdmitted: true, prevStatus: 'done', prevExam: 20, prevTotal: 58, prevWord: 'fail', prevAttempts: '1|2026-12-15|20' });
  assert.deepEqual(prevOf(snapshotOf(prev)), prev);
  const none = { semester: 25, admitted: false, status: 'not_admitted', exam: null, total: null, word: null, attempts: [] };
  const snap = snapshotOf(none);
  assert.equal(snap.prevWord, '');
  assert.equal(snap.prevAttempts, '');
  assert.deepEqual(prevOf(snap), none);
  assert.equal(attemptsText([A(1, 'score', 20, '2026-12-15'), A(2, 'absent', null, '2027-01-12')]), '1|2026-12-15|20;2|2027-01-12|absent');
  assert.equal(attemptsText([]), '');
  assert.deepEqual(parseAttemptsText('1|2026-12-15|20;2|2027-01-12|absent'), [A(1, 'score', 20, '2026-12-15'), A(2, 'absent', null, '2027-01-12')]);
  assert.deepEqual([parseAttemptsText('мусор'), parseAttemptsText(7), parseAttemptsText(''), parseAttemptsText('1|2026-12-15|20;x')], [[], [], [], []]);
});

test('canRepeat and suggestKind', () => {
  assert.equal(canRepeat({ status: 'not_admitted' }), true);
  assert.equal(canRepeat({ status: 'absent' }), true);
  assert.equal(canRepeat({ status: 'incomplete' }), true);
  assert.equal(canRepeat({ status: 'done', word: 'fail' }), true);
  assert.equal(canRepeat({ status: 'done', word: 'fair' }), false);
  assert.equal(canRepeat({ status: 'none', word: null }), false);
  assert.equal(suggestKind({ admitted: true }), null);
  assert.equal(suggestKind({ admitted: false }), 'full');
});

test('enrolProblem', () => {
  const ep = (over) => enrolProblem({ prev, kind: 'full', cards: [], fromRepeat: false, ...over });
  assert.deepEqual([ep({}), ep({ kind: 'exam' }), ep({ cards: [{ status: 'failed', closedAt: 'x' }] }), ep({ cards: [{ status: 'cancelled' }] })], [null, null, null, null]);
  assert.deepEqual(ep({ kind: 'half' }), { field: 'kind', code: 'bad_value' });
  assert.deepEqual(ep({ cards: [{ status: 'open' }] }), { field: 'studentId', code: 'has_open' });
  assert.deepEqual(ep({ cards: [{ status: 'passed', closedAt: '2027-01-20 10:00:00' }] }), { field: 'studentId', code: 'passed' });
  assert.deepEqual(ep({ prev: { ...prev, total: 60, word: 'fair' } }), { field: 'studentId', code: 'not_failed' });
  assert.deepEqual(ep({ kind: 'exam', prev: { ...prev, admitted: false, status: 'not_admitted' } }), { field: 'kind', code: 'not_admitted' });
  assert.equal(ep({ prev: { ...prev, status: 'none', total: null, word: null }, fromRepeat: true }), null);
  assert.deepEqual(ep({ prev: { ...prev, status: 'none', total: null, word: null } }), { field: 'studentId', code: 'not_failed' });
  // the latest closed card decides: passed after an older failed one blocks, failed after an older passed does not
  assert.deepEqual(ep({ cards: [{ id: 'a', status: 'failed', closedAt: '2027-01-01 10:00:00' }, { id: 'b', status: 'passed', closedAt: '2027-02-01 10:00:00' }] }), { field: 'studentId', code: 'passed' });
  assert.equal(ep({ cards: [{ id: 'a', status: 'passed', closedAt: '2027-01-01 10:00:00' }, { id: 'b', status: 'failed', closedAt: '2027-02-01 10:00:00' }] }), null);
  // same closedAt: the larger id decides
  assert.deepEqual(ep({ cards: [{ id: 'a', status: 'failed', closedAt: 't' }, { id: 'b', status: 'passed', closedAt: 't' }] }), { field: 'studentId', code: 'passed' });
  // the first problem wins: open before passed
  assert.deepEqual(ep({ cards: [{ status: 'open' }, { status: 'passed', closedAt: 't' }] }), { field: 'studentId', code: 'has_open' });
  // a kind problem is reported before the others
  assert.deepEqual(ep({ kind: 'x', cards: [{ status: 'open' }] }), { field: 'kind', code: 'bad_value' });
});

test('checkOrder', () => {
  const ok = { orderNo: ' 15-с ', orderDate: '2026-12-20', deadline: '2026-12-21' };
  const co = (over) => checkOrder({ ...ok, ...over }, { today: '2026-12-21' });
  const r = co({});
  assert.equal(r.value.orderNo, '15-с');
  assert.deepEqual(r.problems, []);
  assert.deepEqual(co({ orderNo: '' }).problems, [{ field: 'orderNo', code: 'required' }]);
  assert.deepEqual(co({ orderNo: '   ' }).problems, [{ field: 'orderNo', code: 'required' }]);
  assert.deepEqual(co({ orderNo: 'x'.repeat(41) }).problems, [{ field: 'orderNo', code: 'too_long' }]);
  assert.equal(co({ orderNo: 'x'.repeat(40) }).problems.length, 0);
  assert.deepEqual(co({ orderNo: 15 }).problems, [{ field: 'orderNo', code: 'bad_value' }]);
  assert.deepEqual(co({ orderDate: '2026-12-22' }).problems, [{ field: 'orderDate', code: 'in_future' }]);
  assert.deepEqual(co({ orderDate: 'вчера' }).problems, [{ field: 'orderDate', code: 'bad_value' }]);
  assert.deepEqual(co({ deadline: '2026-12-20' }).problems, [{ field: 'deadline', code: 'in_past' }]);
  assert.deepEqual(co({ deadline: '2028-01-01' }).problems, [{ field: 'deadline', code: 'too_far' }]);
  assert.equal(co({ deadline: '2027-12-22' }).problems.length, 0);
  assert.deepEqual(co({ deadline: '2027-12-23' }).problems, [{ field: 'deadline', code: 'too_far' }]);
  assert.deepEqual(co({ deadline: 5 }).problems, [{ field: 'deadline', code: 'bad_value' }]);
  assert.equal(co({ orderNo: '' }).value, null);
});

test('checkWorks', () => {
  const cw = (input, opts = {}) => checkWorks(input, { card: full(null), split: SP, hasAttempts: false, ...opts });
  assert.deepEqual(cw({ works: 45, note: ' Реферат ' }), { value: { works: 45, note: 'Реферат' }, problems: [] });
  assert.equal(cw({ works: 60, note: 'a' }).value.works, 60);
  assert.equal(cw({ works: 0, note: 'a' }).value.works, 0);
  for (const w of [61, -1, 3.5, '45', null, undefined]) {
    assert.deepEqual(cw({ works: w, note: 'a' }).problems, [{ field: 'works', code: 'bad_value' }], String(w));
  }
  const sp50 = { semester: 50, exam: 50, admission: 25 };
  assert.equal(cw({ works: 50, note: 'a' }, { split: sp50 }).value.works, 50);
  assert.deepEqual(cw({ works: 51, note: 'a' }, { split: sp50 }).problems, [{ field: 'works', code: 'bad_value' }]);
  assert.deepEqual(cw({ works: 45, note: '' }).problems, [{ field: 'note', code: 'required' }]);
  assert.deepEqual(cw({ works: 45, note: 'x'.repeat(301) }).problems, [{ field: 'note', code: 'too_long' }]);
  assert.deepEqual(cw({ works: 45, note: 7 }).problems, [{ field: 'note', code: 'bad_value' }]);
  assert.deepEqual(cw({ works: 45, note: 'a' }, { card: exam() }).problems, [{ field: 'works', code: 'not_needed' }]);
  assert.deepEqual(cw({ works: 30, note: 'a' }, { hasAttempts: true }).problems, [{ field: 'works', code: 'has_attempts' }]);
  assert.deepEqual(cw({ works: 31, note: 'a' }, { hasAttempts: true }).problems, []);
  assert.equal(cw({ works: 30, note: 'a' }).value.works, 30);
});

test('checkRepeatAttempt', () => {
  const next = { no: 1, retake: false, commission: false };
  const cra = (input, over = {}) => checkRepeatAttempt(input, { card: full(45), next, last: null, today: '2027-01-20', split: SP, ...over });
  assert.deepEqual(cra({ date: '2027-01-15', outcome: 'score', score: 30 }), { value: { date: '2027-01-15', outcome: 'score', score: 30, commission: '' }, problems: [] });
  assert.deepEqual(cra({ date: '2026-12-19', outcome: 'score', score: 30 }).problems, [{ field: 'date', code: 'before_order' }]);
  assert.equal(cra({ date: '2026-12-20', outcome: 'score', score: 30 }).problems.length, 0);
  const late = { today: '2027-02-05' };
  assert.deepEqual(cra({ date: '2027-02-02', outcome: 'score', score: 30 }, late).problems, [{ field: 'date', code: 'after_deadline' }]);
  assert.equal(cra({ date: '2027-02-01', outcome: 'score', score: 30 }, late).problems.length, 0);
  assert.deepEqual(cra({ date: '2027-02-06', outcome: 'score', score: 30 }, late).problems, [{ field: 'date', code: 'in_future' }]);
  assert.deepEqual(cra({ date: '2027-01-15', outcome: 'score', score: 41 }).problems, [{ field: 'score', code: 'bad_value' }]);
  assert.deepEqual(cra({ date: '2027-01-15', outcome: 'score', score: 40 }).problems, []);
  assert.deepEqual(cra({ date: '2027-01-15', outcome: 'score', score: 30 }, { next: { no: 3, retake: true, commission: true } }).problems, [{ field: 'commission', code: 'required' }]);
  assert.equal(cra({ date: '2027-01-15', outcome: 'score', score: 30, commission: 'Комиссия' }, { next: { no: 3, retake: true, commission: true } }).value.commission, 'Комиссия');
  assert.deepEqual(cra({ date: '2027-01-15', outcome: 'absent', score: null }, { next: { no: 2, retake: true, commission: false }, last: { date: '2027-01-15' } }).problems, [{ field: 'date', code: 'order' }]);
  // the exam-session window is not applied to a repeat course
  assert.deepEqual(cra({ date: '2027-01-16', outcome: 'absent', score: null }, { next: { no: 2, retake: true, commission: false }, last: { date: '2027-01-15' } }).problems, []);
});

test('isOverdue, shownCard, isMain', () => {
  assert.equal(isOverdue({ status: 'open', deadline: '2027-02-01' }, '2027-02-01'), false);
  assert.equal(isOverdue({ status: 'open', deadline: '2027-02-01' }, '2027-02-02'), true);
  assert.equal(isOverdue({ status: 'passed', deadline: '2027-02-01' }, '2027-02-02'), false);
  assert.equal(isOverdue({ status: 'failed', deadline: '2027-02-01' }, '2027-02-02'), false);
  assert.equal(shownCard([]), null);
  assert.equal(shownCard([{ id: 'a', status: 'cancelled', createdAt: '2027-03-01 10:00:00' }]), null);
  const c1 = { id: 'a', status: 'failed', createdAt: '2027-01-01 10:00:00' };
  const c2 = { id: 'b', status: 'open', createdAt: '2027-02-01 10:00:00' };
  const c3 = { id: 'c', status: 'cancelled', createdAt: '2027-03-01 10:00:00' };
  assert.equal(shownCard([c1, c3, c2]), c2);
  assert.equal(shownCard([{ id: 'a', status: 'open', createdAt: 't' }, { id: 'b', status: 'open', createdAt: 't' }]).id, 'b');
  assert.deepEqual(['open', 'passed', 'failed', 'cancelled'].map((status) => isMain({ status })), [false, true, true, false]);
});

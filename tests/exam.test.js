import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import {
  EXAM, examText, parseExamText, checkResult, checkHead, liveAttempts, subjectResult, checkAttempt, finalProblems,
} from '../core/exam.js';

const S = DEFAULT_SCHEME, SP = DEFAULT_SPLIT;
const A = (no, outcome, score = null, date = '2026-12-15') => ({ no, outcome, score, date });
const N = (no, retake, commission) => ({ no, retake, commission });
const res = (attempts, over = {}) => subjectResult({ semester: 47, admitted: true, attempts, scheme: S, ...over });
const a2 = (attempts) => res(attempts, { semester: 38 });
const exam = { examStart: '2026-12-14', examEnd: '2026-12-20' };
const H = { date: '2026-12-15', examiner: ' Экзаменатор Первый ', assistants: ' Ассистент Первый, Ассистент Второй ' };

test('the limits of an exam are fixed', () => {
  assert.deepEqual({ ...EXAM }, { triesMax: 3, rowsMax: 6, examinerMax: 120, textMax: 300, itemsMax: 200 });
  assert.ok(Object.isFrozen(EXAM));
});

test('result text: to text and back', () => {
  assert.deepEqual([examText(null), examText(undefined), examText({ outcome: '', score: null }), examText(A(1, 'score', 32)), examText(A(1, 'score', 0)), examText(A(1, 'absent')), examText(A(1, 'incomplete'))],
    ['', '', '', '32', '0', 'absent', 'incomplete']);
  assert.deepEqual([parseExamText(''), parseExamText('32'), parseExamText('absent'), parseExamText('incomplete')],
    [null, { outcome: 'score', score: 32 }, { outcome: 'absent', score: null }, { outcome: 'incomplete', score: null }]);
  for (const bad of ['3.5', '-1', ' 32', 'passed', 'I', 32, null, ['32'], '1000']) assert.equal(parseExamText(bad), undefined, String(bad));
});

test('checkResult', () => {
  for (const ok of [A(1, 'score', 0), A(1, 'score', 40), A(1, 'absent'), A(1, 'incomplete')]) assert.equal(checkResult(ok, SP), null);
  for (const score of [41, -1, 3.5, '35', null, undefined]) assert.deepEqual(checkResult({ outcome: 'score', score }, SP), { field: 'score', code: 'bad_value' });
  assert.deepEqual([checkResult({ outcome: 'absent', score: 0 }, SP), checkResult({ outcome: 'passed', score: null }, SP), checkResult(null, SP), checkResult('absent', SP)],
    [{ field: 'score', code: 'bad_value' }, { field: 'outcome', code: 'bad_value' }, { field: 'outcome', code: 'bad_value' }, { field: 'outcome', code: 'bad_value' }]);
  assert.equal(checkResult({ outcome: 'score', score: 45 }, { semester: 50, exam: 50, admission: 25 }), null);
});

test('subjectResult: totals, words, retakes', () => {
  assert.deepEqual(res([]), { status: 'none', tries: 0, exam: null, total: null, word: null, next: N(1, false, false) });
  assert.deepEqual(res([A(1, 'score', 35)]), { status: 'done', tries: 1, exam: 35, total: 82, word: 'good', next: null });
  assert.deepEqual([32, 33].map((x) => [res([A(1, 'score', x)]).total, res([A(1, 'score', x)]).word]), [[79, 'fair'], [80, 'good']]);
  assert.deepEqual([32, 33].map((x) => res([A(1, 'score', x)], { semester: 57 }).word), ['good', 'excellent']);
  assert.deepEqual(res([A(1, 'absent')]), { status: 'absent', tries: 1, exam: null, total: null, word: null, next: N(2, true, false) });
  assert.deepEqual(res([A(1, 'incomplete')]), { status: 'incomplete', tries: 0, exam: null, total: null, word: null, next: N(2, false, false) });
  assert.deepEqual(res([A(1, 'incomplete'), A(2, 'score', 35, '2027-01-12')]), { status: 'done', tries: 1, exam: 35, total: 82, word: 'good', next: null });
  assert.deepEqual(a2([A(1, 'score', 20)]), { status: 'done', tries: 1, exam: 20, total: 58, word: 'fail', next: N(2, true, false) });
  assert.deepEqual(a2([A(1, 'score', 20), A(2, 'score', 22, '2027-01-12')]), { status: 'done', tries: 2, exam: 22, total: 60, word: 'fair', next: null });
  assert.deepEqual(a2([A(1, 'score', 20), A(2, 'score', 21, '2027-01-12')]).next, N(3, true, true));
  assert.deepEqual(a2([A(1, 'score', 20), A(2, 'absent', null, '2027-01-12'), A(3, 'score', 10, '2027-02-02')]), { status: 'done', tries: 3, exam: 10, total: 48, word: 'fail', next: null });
  assert.deepEqual(a2([A(2, 'score', 25, '2027-01-12'), A(1, 'score', 20)]).total, 63);
  assert.equal(res([1, 2, 3, 4, 5, 6].map((no) => A(no, 'incomplete'))).next, null);
});

test('subjectResult: not admitted, penalty, other thresholds', () => {
  assert.deepEqual(subjectResult({ semester: 29, admitted: false, attempts: [A(1, 'score', 40)], scheme: S }), { status: 'not_admitted', tries: 0, exam: null, total: null, word: null, next: null });
  assert.equal(subjectResult({ semester: null, admitted: false, attempts: [], scheme: S }).status, 'not_admitted');
  assert.deepEqual([res([A(1, 'score', 35)], { penalty: 10 }).total, res([A(1, 'score', 35)], { penalty: 10 }).word, res([A(1, 'score', 0)], { semester: 5, penalty: 10 }).total], [72, 'fair', 0]);
  assert.equal(res([A(1, 'score', 31)], { scheme: { ...S, good: 76 } }).word, 'good');
});

test('liveAttempts', () => {
  const row = (id, no, outcome, score, updatedAt) => ({ id, no, date: '2026-12-15', outcome, score, commission: '', updatedAt });
  assert.deepEqual(liveAttempts([row('xa_2', 1, 'score', 22, '2026-12-16 10:00:00'), row('xa_1', 1, 'score', 20, '2026-12-15 10:00:00'), row('xa_3', 2, '', null, '2027-01-12 10:00:00')]).map((x) => [x.id, x.no, x.score]), [['xa_2', 1, 22]]);
  assert.deepEqual(liveAttempts([]), []);
  // a newer erased row hides the older one; the id breaks a tie in time
  assert.deepEqual(liveAttempts([row('xa_1', 1, 'score', 20, '2026-12-15 10:00:00'), row('xa_2', 1, '', null, '2026-12-16 10:00:00')]), []);
  assert.equal(liveAttempts([row('xa_9', 1, 'score', 20, '2026-12-15 10:00:00'), row('xa_10', 1, 'score', 21, '2026-12-15 10:00:00')])[0].id, 'xa_9');
});

test('checkHead', () => {
  assert.deepEqual(checkHead(H, { exam, strict: true }), { value: { date: '2026-12-15', examiner: 'Экзаменатор Первый', assistants: 'Ассистент Первый, Ассистент Второй' }, problems: [] });
  assert.deepEqual(checkHead({ date: '2026-12-10' }, { exam, strict: true }).problems, [{ field: 'date', code: 'out_of_exam' }]);
  assert.deepEqual(checkHead({ date: '2026-12-10' }, { exam, strict: false }).value, { date: '2026-12-10', examiner: '', assistants: '' });
  assert.deepEqual(checkHead({ date: '2026-12-10' }, { exam: { examStart: '', examEnd: '' }, strict: true }).problems, []);
  const bad = checkHead({ date: '15.12.2026', examiner: 'я'.repeat(121), assistants: 5 }, { exam, strict: true });
  assert.deepEqual(bad.problems, [{ field: 'date', code: 'bad_value' }, { field: 'examiner', code: 'too_long' }, { field: 'assistants', code: 'bad_value' }]);
  assert.equal(bad.value, null);
  assert.deepEqual(checkHead({ ...H, assistants: 'я'.repeat(301) }, { exam, strict: true }).problems, [{ field: 'assistants', code: 'too_long' }]);
});

test('checkAttempt', () => {
  const ctx = (over = {}) => ({ next: N(2, true, false), last: A(1, 'score', 20), exam, today: '2027-01-20', split: SP, ...over });
  const T = { date: '2027-01-12', outcome: 'score', score: 22, commission: 'лишнее' };
  assert.deepEqual(checkAttempt(T, ctx()), { value: { date: '2027-01-12', outcome: 'score', score: 22, commission: '' }, problems: [] });
  assert.deepEqual(['2026-12-18', '2026-12-15', '2026-12-01', '2027-01-21', '12.01.2027'].map((date) => checkAttempt({ ...T, date }, ctx()).problems[0].code),
    ['in_session', 'order', 'order', 'in_future', 'bad_value']);
  assert.deepEqual(checkAttempt({ ...T, date: '2026-12-18' }, ctx({ next: N(2, false, false), last: A(1, 'incomplete') })).problems, []);
  assert.deepEqual(checkAttempt({ ...T, date: '2026-12-18' }, ctx({ exam: { examStart: '', examEnd: '' } })).problems, []);
  assert.deepEqual([checkAttempt({ ...T, score: 41 }, ctx()).problems, checkAttempt({ ...T, outcome: 'passed' }, ctx()).problems], [[{ field: 'score', code: 'bad_value' }], [{ field: 'outcome', code: 'bad_value' }]]);
  const third = ctx({ next: N(3, true, true), last: A(2, 'score', 21, '2027-01-12') });
  assert.deepEqual([checkAttempt({ ...T, date: '2027-01-19', commission: '  ' }, third).problems, checkAttempt({ ...T, date: '2027-01-19', commission: 5 }, third).problems, checkAttempt({ ...T, date: '2027-01-19', commission: 'я'.repeat(301) }, third).problems],
    [[{ field: 'commission', code: 'required' }], [{ field: 'commission', code: 'required' }], [{ field: 'commission', code: 'too_long' }]]);
  assert.equal(checkAttempt({ ...T, date: '2027-01-19', commission: ' Член комиссии Первый, Член комиссии Второй ' }, third).value.commission, 'Член комиссии Первый, Член комиссии Второй');
  assert.equal(checkAttempt({ ...T, score: 41 }, ctx()).value, null);
});

test('finalProblems', () => {
  const rows = [{ left: false, admitted: true, attempts: [A(1, 'score', 35)] }, { left: false, admitted: true, attempts: [] }, { left: false, admitted: false, attempts: [] }, { left: true, admitted: true, attempts: [] }];
  assert.deepEqual(finalProblems({ units: [1, 2], closed: [1], head: null, rows }), [{ code: 'units_open', n: 1 }, { code: 'no_date', n: 0 }, { code: 'exam_missing', n: 1 }]);
  assert.deepEqual(finalProblems({ units: [1, 2], closed: [1, 2], head: { date: '' }, rows: rows.slice(0, 1) }), [{ code: 'no_date', n: 0 }]);
  assert.deepEqual(finalProblems({ units: [1, 2], closed: [1, 2], head: { date: '2026-12-15' }, rows: [rows[0], { left: false, admitted: true, attempts: [A(1, 'absent')] }, rows[2], rows[3]] }), []);
  assert.deepEqual(finalProblems({ units: [], closed: [], head: { date: '2026-12-15' }, rows: [] }), [{ code: 'no_units', n: 0 }]);
});

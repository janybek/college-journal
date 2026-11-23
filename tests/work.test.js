import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDateTime } from '../core/dates.js';
import { WORK, checkAssignment, currentAttempt, workState, checkGrade, selfByWork, taskCounts } from '../core/work.js';

const B = (dt) => parseLocalDateTime(dt);
const now = B('2026-09-24 12:00:00');
const ok = { kind: 'srs', unit: 2, topicId: '', title: ' СРС А ', description: '', dueDate: '2026-09-27', dueTime: '23:59', maxPoints: 20 };
const ctx = { units: [1, 2], topics: [{ id: 't3', unit: 2 }, { id: 't1', unit: 1 }], nowMs: now };
const bad = (over, extra = {}) => checkAssignment({ ...ok, ...over }, { ...ctx, ...extra }).problems;

test('limits of work', () => {
  assert.equal(WORK.titleMax, 200);
  assert.equal(WORK.soonMs, 172800000);
  assert.equal(WORK.farMs, 366 * 86400000);
});

test('assignment: a good one is cleaned and its due moment is built', () => {
  assert.deepEqual(checkAssignment(ok, ctx), { value: { kind: 'srs', unit: 2, topicId: '', title: 'СРС А', description: '', dueAt: '2026-09-27 23:59:00', maxPoints: 20 }, problems: [] });
});

test('assignment: kind, unit and topic', () => {
  assert.deepEqual(bad({ kind: 'exam' }), [{ field: 'kind', code: 'bad_value' }]);
  assert.deepEqual(bad({ unit: null }), [{ field: 'unit', code: 'bad_value' }]);
  assert.deepEqual(bad({ unit: 3 }), [{ field: 'unit', code: 'bad_value' }]);
  assert.equal(checkAssignment({ ...ok, kind: 'hw', unit: null, topicId: 't3' }, ctx).value.unit, 2);
  assert.equal(checkAssignment({ ...ok, kind: 'hw', unit: null, topicId: '' }, ctx).value.unit, null);
  assert.deepEqual(bad({ topicId: 't1' }), [{ field: 'topicId', code: 'bad_ref' }]);
  assert.deepEqual(bad({ topicId: 'nope' }), [{ field: 'topicId', code: 'bad_ref' }]);
  for (const topicId of [['t3'], 3, {}, true]) assert.deepEqual(bad({ topicId }), [{ field: 'topicId', code: 'bad_ref' }], JSON.stringify(topicId));
  for (const topicId of [undefined, null, '']) assert.deepEqual(bad({ topicId }), [], String(topicId));
});

test('assignment: title, description, due and points', () => {
  assert.deepEqual(bad({ title: '   ' }), [{ field: 'title', code: 'empty' }]);
  assert.deepEqual(bad({ title: 'x'.repeat(201) }), [{ field: 'title', code: 'too_long' }]);
  assert.deepEqual(bad({ description: 'x'.repeat(5001) }), [{ field: 'description', code: 'too_long' }]);
  assert.deepEqual(bad({ dueDate: '2026-09-24', dueTime: '12:00' }), [{ field: 'due', code: 'due_past' }]);
  assert.deepEqual(bad({ dueDate: '2027-09-25', dueTime: '12:00' }), []);
  assert.deepEqual(bad({ dueDate: '2027-09-25', dueTime: '12:01' }), [{ field: 'due', code: 'too_far' }]);
  assert.deepEqual(bad({ dueTime: '7:00' }), [{ field: 'due', code: 'bad_value' }]);
  assert.deepEqual(bad({ maxPoints: 0 }).concat(bad({ maxPoints: 101 }), bad({ maxPoints: 2.5 }), bad({ maxPoints: '10' })).map((p) => p.code), ['bad_value', 'bad_value', 'bad_value', 'bad_value']);
});

test('assignment: changing an existing one', () => {
  const old = { kind: 'srs', unit: 2, topicId: '', dueAt: '2026-09-20 23:59:00' };
  assert.deepEqual(bad({ dueDate: '2026-09-20', dueTime: '23:59' }, { old }), []);
  assert.deepEqual(bad({ unit: 1 }, { old, locked: true }), [{ field: 'unit', code: 'locked' }]);
  assert.deepEqual(bad({ kind: 'hw' }, { old, locked: true }), [{ field: 'kind', code: 'locked' }]);
  assert.deepEqual(bad({ topicId: 't3' }, { old, locked: true }), [{ field: 'topicId', code: 'locked' }]);
  assert.deepEqual(bad({ maxPoints: 12 }, { old, locked: true, maxGiven: 15 }), [{ field: 'maxPoints', code: 'below_points' }]);
  assert.deepEqual(bad({ title: 'Новое' }, { units: [], topics: [], old: { ...old, dueAt: '2026-09-27 23:59:00' } }), []);
});

test('attempts and state', () => {
  const A = { dueAt: '2026-09-20 23:59:00' };
  assert.equal(currentAttempt([{ id: 'x1', n: 1 }, { id: 'x3', n: 2 }, { id: 'x2', n: 2 }]).id, 'x3');
  assert.equal(currentAttempt([]), null);
  assert.deepEqual(workState(A, null, B('2026-09-20 23:59:00')), { state: 'none', late: false, overdue: false });
  assert.deepEqual(workState(A, null, B('2026-09-20 23:59:01')), { state: 'none', late: false, overdue: true });
  assert.deepEqual(workState(A, { status: 'checked', paper: false, submittedAt: '2026-09-21 09:00:00' }, now), { state: 'checked', late: true, overdue: false });
  assert.equal(workState(A, { status: 'checked', paper: true, submittedAt: '2026-09-25 09:00:00' }, now).late, false);
});

test('grade of a work', () => {
  assert.deepEqual(checkGrade({ verdict: 'checked', points: 21 }, { maxPoints: 20 }), [{ field: 'points', code: 'bad_value' }]);
  assert.deepEqual(checkGrade({ verdict: 'returned', points: null, comment: ' ' }, { maxPoints: 20 }), [{ field: 'comment', code: 'empty' }]);
  assert.deepEqual(checkGrade({ verdict: 'returned', points: 5, comment: 'x' }, { maxPoints: 20 }), [{ field: 'points', code: 'bad_value' }]);
  assert.deepEqual(checkGrade({ verdict: 'checked', points: 0, comment: '' }, { maxPoints: 20 }), []);
  assert.deepEqual(checkGrade({ verdict: 'done', points: 1 }, { maxPoints: 20 }), [{ field: 'verdict', code: 'bad_value' }]);
  assert.deepEqual(checkGrade({ verdict: 'checked', points: 1, comment: 'x'.repeat(2001) }, { maxPoints: 20 }), [{ field: 'comment', code: 'too_long' }]);
});

test('self-work from assignments: the numbers of the plan', () => {
  const TA = { id: 'A', maxPoints: 10, dueAt: '2026-09-20 23:59:00' };
  const TB = { id: 'Б', maxPoints: 20, dueAt: '2026-09-27 23:59:00' };
  const sw = (a, b, at) => selfByWork({ assignments: [TA, TB], attemptOf: new Map([['A', a], ['Б', b]]), nowMs: B(at), self: 20 });
  const C = (points) => ({ status: 'checked', points });
  assert.deepEqual(sw(C(8), { status: 'submitted' }, '2026-09-24 12:00:00'), { earned: 8, max: 30, pending: 1, value: 5 });
  assert.deepEqual(sw(C(10), null, '2026-09-24 12:00:00'), { earned: 10, max: 30, pending: 1, value: 7 });
  assert.deepEqual(sw(null, { status: 'returned' }, '2026-09-24 12:00:00'), { earned: 0, max: 30, pending: 1, value: 0 });
  assert.deepEqual([sw(C(8), C(15), '2026-09-28 12:00:00'), sw(C(10), null, '2026-09-28 12:00:00')].map((r) => [r.value, r.pending]), [[15, 0], [7, 0]]);
  assert.equal(sw(C(0), C(12), '2026-09-28 12:00:00').value, 8);
  assert.equal(selfByWork({ assignments: [{ id: 'X', maxPoints: 40, dueAt: '2026-09-01 00:00:00' }], attemptOf: new Map([['X', C(3)]]), nowMs: now, self: 20 }).value, 2);
  assert.equal(selfByWork({ assignments: [TA, TB], attemptOf: new Map([['A', C(8)], ['Б', C(15)]]), nowMs: now, self: 30 }).value, 23);
  assert.equal(selfByWork({ assignments: [], attemptOf: new Map(), nowMs: now, self: 20 }), null);
});

test('counts of tasks', () => {
  assert.deepEqual(taskCounts([{ dueAt: '2026-09-25 10:00:00', state: 'none' }, { dueAt: '2026-10-10 10:00:00', state: 'none' },
    { dueAt: '2026-09-20 10:00:00', state: 'none' }, { dueAt: '2026-09-20 10:00:00', state: 'returned' }, { dueAt: '2026-09-20 10:00:00', state: 'checked' }], now),
  { fresh: 2, soon: 1, overdue: 1, returned: 1 });
});

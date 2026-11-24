import test from 'node:test';
import assert from 'node:assert/strict';
import { FINAL_UNIT, activeClosure, closedUnitsOf, closeProblems } from '../core/ledger.js';

const C = (id, subjectId, planSemester, unit, closedAt, reopenedAt = '') => ({ id, subjectId, planSemester, unit, closedAt, reopenedAt });
const rows = [C('c1', 'sb1', 1, 1, '2026-09-30 12:00:00'), C('c2', 'sb1', 1, 2, '2026-10-30 12:00:00', '2026-11-01 09:00:00'),
  C('c3', 'sb1', 1, 0, '2026-12-15 12:00:00'), C('c4', 'sb1', 2, 1, '2027-03-01 12:00:00'), C('c5', 'sb2', null, 1, '2026-10-01 12:00:00')];

test('closedUnitsOf and activeClosure', () => {
  assert.equal(FINAL_UNIT, 0);
  assert.deepEqual(closedUnitsOf(rows, 'sb1', 1), { units: [1], final: true });
  assert.deepEqual(closedUnitsOf(rows, 'sb1', 2), { units: [1], final: false });
  assert.deepEqual(closedUnitsOf(rows, 'sb2', null), { units: [1], final: false });
  assert.deepEqual(closedUnitsOf(rows, 'sb2', undefined), { units: [1], final: false });
  assert.deepEqual([closedUnitsOf([], 'sb1', 1), closedUnitsOf(null, 'sb1', 1)], [{ units: [], final: false }, { units: [], final: false }]);
  assert.equal(activeClosure(rows, 'sb1', 1, 2), null);
  assert.equal(activeClosure([...rows, C('c6', 'sb1', 1, 2, '2026-11-20 12:00:00')], 'sb1', 1, 2).id, 'c6');
  assert.equal(activeClosure(rows, 'sb1', 1, '1'), null);
  assert.equal(activeClosure(null, 'sb1', 1, 1), null);
});

test('activeClosure picks the latest closedAt, then id', () => {
  const same = [C('a', 'sb', 1, 1, '2026-10-01 10:00:00'), C('b', 'sb', 1, 1, '2026-10-01 10:00:00'), C('0', 'sb', 1, 1, '2026-09-01 10:00:00')];
  assert.equal(activeClosure(same, 'sb', 1, 1).id, 'b');
});

test('closeProblems', () => {
  const pairs = [{ unit: 1, status: 'closed' }, { unit: 1, status: 'missed' }, { unit: 2, status: 'planned' }, { unit: 2, status: 'running' }, { unit: 2, status: 'cancelled' }, { unit: null, status: 'planned' }];
  const students = [{ id: 'a1', left: false }, { id: 'a2', left: false }, { id: 'a4', left: true }];
  const U = (unit, total, selfWork) => ({ unit, total, ...(selfWork ? { selfWork } : {}) });
  const results = { a1: { units: [U(1, 84), U(2, null, { pending: 1 })] }, a2: { units: [U(1, null), U(2, null)] }, a4: { units: [U(1, null), U(2, null, { pending: 2 })] } };
  assert.deepEqual(closeProblems({ unit: 1, pairs, students, results }), { blocking: [], missing: 1 });
  assert.deepEqual(closeProblems({ unit: 2, pairs, students, results }), { blocking: [{ code: 'pairs_not_held', n: 2 }, { code: 'self_pending', n: 1 }], missing: 2 });
  assert.deepEqual(closeProblems({ unit: 3, pairs, students, results }), { blocking: [], missing: 2 });
});

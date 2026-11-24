import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import { checkStateExam, checkScore, examStats } from '../core/stateExam.js';

const groups = [{ id: 'g1' }, { id: 'g2' }];
const E = { groupId: 'g1', name: ' Гос. экзамен по специальности ', date: '2027-06-10' };

test('checkStateExam', () => {
  assert.deepEqual(checkStateExam(E, { groups }), { value: { groupId: 'g1', name: 'Гос. экзамен по специальности', date: '2027-06-10' }, problems: [] });
  assert.deepEqual(checkStateExam({ ...E, groupId: 'g2' }, { groups, old: { groupId: 'g1' }, hasScores: true }).problems, [{ field: 'groupId', code: 'locked' }]);
  assert.deepEqual(checkStateExam({ groupId: ['g1'], name: ' ', date: '10.06.2027' }, { groups }).problems,
    [{ field: 'groupId', code: 'bad_ref' }, { field: 'name', code: 'empty' }, { field: 'date', code: 'bad_value' }]);
  assert.equal(checkStateExam({ ...E, name: 'я'.repeat(201) }, { groups }).problems[0].code, 'too_long');
});

test('checkScore', () => {
  assert.deepEqual([null, 0, 100, 101, -1, 90.5, '90', undefined].map(checkScore), [null, null, null, 'bad_value', 'bad_value', 'bad_value', 'bad_value', 'bad_value']);
});

test('examStats', () => {
  assert.deepEqual(examStats([59, 60, 80, 90, null, 100], DEFAULT_SCHEME), { total: 6, entered: 5, fail: 1, fair: 1, good: 1, excellent: 2, average: 78 });
  assert.deepEqual(examStats([79, 89], DEFAULT_SCHEME), { total: 2, entered: 2, fail: 0, fair: 1, good: 1, excellent: 0, average: 84 });
  assert.equal(examStats([79], { ...DEFAULT_SCHEME, good: 76 }).good, 1);
  assert.equal(examStats([null], DEFAULT_SCHEME).average, null);
});

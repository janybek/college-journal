import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionsOf } from '../core/syllabusFlow.js';

const key = { disciplineId: 'ds_1', teacherId: 'sf_t', semester: 1 };
const v = (status, version = 1) => ({ id: 'sy_' + status, ...key, status, version });

test('versionsOf: the approved version, the open one and the last number of a key', () => {
  assert.deepEqual(versionsOf([v('archived'), v('approved', 2), v('returned', 3), { ...v('draft'), semester: 2 }], key), { approved: v('approved', 2), open: v('returned', 3), last: 3 });
  assert.deepEqual(versionsOf([], key), { approved: null, open: null, last: 0 });
  // another discipline or another teacher is another key
  assert.deepEqual(versionsOf([{ ...v('approved'), disciplineId: 'ds_2' }, { ...v('draft'), teacherId: 'sf_x' }], key), { approved: null, open: null, last: 0 });
  // every open status counts as open
  assert.deepEqual(['draft', 'review', 'returned'].map((status) => versionsOf([v(status)], key).open.status), ['draft', 'review', 'returned']);
});

test('versionsOf: two matching rows (two simultaneous «Fill») give one answer, whatever their order', () => {
  // выбор однозначный — больший номер, затем больший id
  assert.deepEqual([versionsOf([{ ...v('draft', 2), id: 'sy_a' }, { ...v('draft', 3), id: 'sy_b' }], key).open.id, versionsOf([{ ...v('draft', 2), id: 'sy_b' }, { ...v('draft', 2), id: 'sy_a' }], key).open.id],
    ['sy_b', 'sy_b']);
  assert.deepEqual([[{ ...v('approved', 1), id: 'sy_z' }, { ...v('approved', 2), id: 'sy_a' }], [{ ...v('approved', 2), id: 'sy_a' }, { ...v('approved', 1), id: 'sy_z' }]]
    .map((rows) => versionsOf(rows, key).approved.id), ['sy_a', 'sy_a']);
});

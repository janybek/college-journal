import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, pairFlags, canEditPair, canRestorePair } from '../site/js/pairs.js';
import { pairLock } from '../core/schedule.js';

const p = (id, date, slot, extra = {}) => ({ id, date, slot, status: 'planned', substitution: false, moved: false, ...extra });

test('groupByDay: every day in a row from `from`, pairs ordered by slot', () => {
  assert.deepEqual(groupByDay([p('b', '2026-09-08', 2), p('a', '2026-09-08', 1), p('c', '2026-09-10', 1)], '2026-09-07', 4).map(d => [d.date, d.pairs.map(x => x.id)]),
    [['2026-09-07', []], ['2026-09-08', ['a', 'b']], ['2026-09-09', []], ['2026-09-10', ['c']]]);
  assert.equal(groupByDay([], '2026-09-07').length, 7);
});

test('pairFlags: cancelled, substitution, moved in this order', () => {
  assert.deepEqual(pairFlags(p('a', '2026-09-08', 1, { status: 'cancelled', substitution: true, moved: true })), ['cancelled', 'substitution', 'moved']);
  assert.deepEqual(pairFlags(p('a', '2026-09-08', 1)), []);
});

test('canEditPair: a planned pair of today or later', () => {
  assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-08'), true);
  assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-09'), false);
  assert.equal(canEditPair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01'), false);
});

test('canRestorePair: a cancelled pair of today or later', () => {
  assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-08'), true);
  assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-09'), false);   // прошедший день
  assert.equal(canRestorePair(p('a', '2026-09-08', 1), '2026-09-01'), false);                             // не отменена
});

test('canEditPair is the copy of pairLock(pair, today) === null from core', () => {
  for (const [pair, today] of [[p('a', '2026-09-08', 1), '2026-09-08'], [p('a', '2026-09-08', 1), '2026-09-09'],
    [p('a', '2026-09-08', 1, { status: 'closed' }), '2026-09-01'], [p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01']])
    assert.equal(canEditPair(pair, today), pairLock(pair, today) === null);
});

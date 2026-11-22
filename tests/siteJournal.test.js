import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRows, listBadges } from '../site/js/journal.js';

test('listRows: a teacher sees only their own subjects and those where they covered pairs; the office sees all', () => {
  assert.deepEqual(listRows([{ own: true }, { own: false, covers: true }, { own: false, covers: false }], 'teacher').length, 2);
  assert.deepEqual(listRows([{ own: true }, { own: false, covers: false }], 'dean').length, 2);
  assert.deepEqual(listRows([{ own: false, covers: false }], 'prorector').length, 1);
  assert.deepEqual(listRows(undefined, 'teacher'), []);
});

test('listBadges: the pairs not filled in yet, then the overdue ones; nothing when all is filled in', () => {
  assert.deepEqual(listBadges({ unfilled: 3, overdue: 1 }), [
    { tone: 'warning', key: 'journal.list.unfilled', params: { n: 2 } },
    { tone: 'danger', key: 'journal.list.overdue', params: { n: 1 } },
  ]);
  assert.deepEqual([listBadges({ unfilled: 0, overdue: 0 }), listBadges({ unfilled: 1, overdue: 1 }).map((b) => b.tone)], [[], ['danger']]);
  assert.deepEqual(listBadges({ unfilled: 2, overdue: 0 }), [{ tone: 'warning', key: 'journal.list.unfilled', params: { n: 2 } }]);
});

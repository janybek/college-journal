import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRows, listBadges, journalColumns, cellView, pairHead } from '../site/js/journal.js';

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

const P = (id, unit, status = 'closed') => ({ id, unit, status, date: '2026-09-0' + id.slice(1), lessonType: 'lecture', state: 'late' });
const J = { partial: false, pairs: [P('p1', 1), P('p2', 1), P('p3', 2), P('p4', null)], units: [{ unit: 1, title: '' }, { unit: 2, title: '' }, { unit: 3, title: '' }] };
const name = (c) => (c.type === 'pair' ? c.pair.id : c.type === 'unit' ? `u${c.unit}.${c.field}` : c.type === 'summary' ? c.field : c.type);

test('journalColumns: the four columns of a unit stand after its last pair; units without pairs, «outside» and the summary at the end', () => {
  assert.deepEqual(journalColumns(J).map(name),
    ['p1', 'p2', 'u1.current', 'u1.self', 'u1.control', 'u1.total', 'p3', 'u2.current', 'u2.self', 'u2.control', 'u2.total', 'p4',
      'u3.current', 'u3.self', 'u3.control', 'u3.total', 'outside', 'absences', 'percent', 'preliminary']);
});

test('journalColumns: a partial journal has only pairs; no «outside» column without held pairs outside units', () => {
  assert.deepEqual(journalColumns({ ...J, partial: true, units: [] }).map((c) => c.type), ['pair', 'pair', 'pair', 'pair']);
  assert.ok(!journalColumns({ ...J, pairs: [P('p4', null, 'planned')] }).some((c) => c.type === 'outside'));
});

test('cellView and pairHead: the mark of a cell and the head of a pair', () => {
  assert.deepEqual(cellView({ status: 'late', noCoat: true, activity: 5 }, {}), { key: 'journal.short.late', tone: 'warning', activity: 5, noCoat: true });
  assert.equal(cellView(null, {}), null);
  assert.equal(cellView({ status: 'absent' }, {}).tone, 'danger');
  assert.deepEqual(pairHead({ lessonType: 'control', status: 'planned', state: 'late' }), { kindKey: 'journal.kind.control', stateKey: 'journal.state.overdue' });
  assert.deepEqual(pairHead({ lessonType: 'practice', status: 'planned', state: 'open' }), { kindKey: 'journal.kind.practice', stateKey: 'journal.state.unfilled' });
  assert.deepEqual(pairHead({ lessonType: '', status: 'closed', state: 'open' }), { kindKey: 'journal.kind.none', stateKey: null });
  assert.equal(pairHead({ lessonType: 'lecture', status: 'cancelled', state: 'cancelled' }).stateKey, 'journal.state.cancelled');
  assert.equal(pairHead({ lessonType: 'lecture', status: 'missed', state: 'missed' }).stateKey, 'journal.state.missed');
  assert.equal(pairHead({ lessonType: 'lecture', status: 'planned', state: 'future' }).stateKey, 'journal.state.future');
});

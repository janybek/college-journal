import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRows, listBadges, journalColumns, cellView, pairHead, draftMarks, changedMarks, activityAllowed, coatAllowed, canMark, pairHint } from '../site/js/journal.js';

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

// ---- Task 19: the marks of a pair ----

const MJ = {
  pairs: [{ id: 'a', status: 'planned' }, { id: 'b', status: 'closed' }],
  students: [{ id: 's1', fullName: 'Асанов Аман', left: false }, { id: 's2', fullName: 'Бекова Бермет', left: false }, { id: 's3', fullName: 'Выбыл Студент', left: true }],
  marks: { b: { s1: { status: 'late', noCoat: true, activity: 3 }, s2: { status: 'absent', noCoat: false, activity: null }, s3: { status: 'present', noCoat: false, activity: null } } },
};

test('draftMarks: an unfilled pair starts with everybody present; a held pair with the saved marks; students who left are not on the list', () => {
  assert.deepEqual(draftMarks(MJ, 'a'), [
    { studentId: 's1', fullName: 'Асанов Аман', status: 'present', noCoat: false, activity: null },
    { studentId: 's2', fullName: 'Бекова Бермет', status: 'present', noCoat: false, activity: null },
  ]);
  assert.deepEqual(draftMarks(MJ, 'b').map((m) => [m.studentId, m.status, m.noCoat, m.activity]), [['s1', 'late', true, 3], ['s2', 'absent', false, null]]);
});

test('changedMarks: all marks of an unfilled pair; only the changed ones of a held pair', () => {
  assert.equal(changedMarks(draftMarks(MJ, 'a'), MJ, 'a').length, 2);
  assert.deepEqual(changedMarks(draftMarks(MJ, 'b'), MJ, 'b'), []);
  const draft = draftMarks(MJ, 'b');
  draft[0].activity = 5;
  assert.deepEqual(changedMarks(draft, MJ, 'b'), [{ studentId: 's1', status: 'late', noCoat: true, activity: 5 }]);
});

test('activityAllowed and coatAllowed follow the rules of the server', () => {
  assert.equal(activityAllowed('absent', {}), false);
  assert.equal(activityAllowed('excused', {}), false);
  assert.equal(activityAllowed('present', { first: true }), false);
  assert.equal(activityAllowed('present', { lessonType: 'control' }), false);
  assert.equal(activityAllowed('late', { lessonType: 'practice' }), true);
  assert.equal(activityAllowed('madeup', {}), true);
  assert.equal(coatAllowed({ lessonType: 'lecture' }), false);
  assert.equal(coatAllowed({ lessonType: 'practice' }), true);
  assert.equal(coatAllowed({ lessonType: '' }), true);
});

test('canMark and pairHint: only free and reason heads open; the others say why', () => {
  assert.equal(canMark({ mode: 'free' }), true);
  assert.equal(canMark({ mode: 'reason' }), true);
  assert.equal(canMark({ mode: 'limited' }), false);
  assert.equal(canMark({ mode: 'none' }), false);
  assert.equal(pairHint({ mode: 'none', state: 'future', status: 'planned' }), 'journal.marks.notBegun');
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'teacher'), 'journal.marks.termPassed');
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'prorector'), null);
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'dean'), null);
  assert.equal(pairHint({ mode: 'none', state: 'future', status: 'planned' }, 'prorector'), 'journal.marks.notBegun');
  assert.equal(pairHint({ mode: 'limited', state: 'late', status: 'closed' }), null);
  assert.equal(pairHint({ mode: 'free', state: 'open', status: 'planned' }), null);
});

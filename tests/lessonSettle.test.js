import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDateTime } from '../core/dates.js';
import { LESSON_CLEAR, settlePlan } from '../core/lesson.js';

const B = (time) => parseLocalDateTime(`2026-09-22 ${time}`);
const st = (id, groupId, active = true) => ({ id, groupId, active, fullName: id });
const S = [st('a1', 'g1'), st('a2', 'g1'), st('a3', 'g1'), st('a4', 'g1', false), st('b1', 'g2')];
const R = { id: 'p1', groupId: 'g1', status: 'running', startedAt: '2026-09-22 07:58:00', checkinUntil: '2026-09-22 08:03:00', checkinClosed: false, finishedAt: '', finishedBy: '' };
const A = [{ pairId: 'p1', studentId: 'a1', status: 'present' }, { pairId: 'p9', studentId: 'a2', status: 'present' }]; // a2 is marked on another pair
const plan = (extra) => settlePlan({ pairs: [R], students: S, attendance: A, ...extra });
const CLOSED = { ...R, checkinClosed: true };

test('settlePlan: the end of the check-in window writes "absent" to the unmarked', () => {
  assert.deepEqual(plan({ nowMs: B('08:02:59') }), { marks: [], patches: [] });
  const end = plan({ nowMs: B('08:03:00') });
  assert.deepEqual(end.marks.map((m) => [m.studentId, m.status, m.source, m.markedBy, m.markedAt, m.activity, m.noCoat]),
    [['a2', 'absent', 'auto', '', '2026-09-22 08:03:00', null, false], ['a3', 'absent', 'auto', '', '2026-09-22 08:03:00', null, false]]);
  assert.equal(end.marks[0].pairId, 'p1');
  assert.deepEqual(end.patches, [{ id: 'p1', patch: { checkinClosed: true } }]);
  assert.deepEqual(plan({ nowMs: B('08:30:00') }).marks[0].markedAt, '2026-09-22 08:03:00');
  assert.deepEqual(settlePlan({ pairs: [R], students: S, attendance: [], nowMs: B('08:10:00') }), { marks: [], patches: [{ id: 'p1', patch: { checkinClosed: true } }] });
  assert.deepEqual(plan({ nowMs: B('08:10:00'), pairs: [CLOSED] }), { marks: [], patches: [] });
});

test('settlePlan: ending the check-in early', () => {
  const early = plan({ nowMs: B('08:01:30'), endCheckin: ['p1'] });
  assert.deepEqual([early.patches[0].patch, early.marks[0].markedAt], [{ checkinClosed: true, checkinUntil: '2026-09-22 08:01:30' }, '2026-09-22 08:01:30']);
});

test('settlePlan: closing the pair', () => {
  assert.deepEqual(plan({ nowMs: B('09:28:00'), pairs: [CLOSED] }).patches, [{ id: 'p1', patch: { status: 'closed', finishedAt: '2026-09-22 09:28:00', finishedBy: '' } }]);
  assert.deepEqual(plan({ nowMs: B('09:27:59'), pairs: [CLOSED] }).patches, []);
  assert.deepEqual(plan({ nowMs: B('09:40:00'), pairs: [CLOSED], finish: ['p1'], actorId: 't1' }).patches, [{ id: 'p1', patch: { status: 'closed', finishedAt: '2026-09-22 09:28:00', finishedBy: '' } }]);
  const late = plan({ nowMs: B('11:00:00') });
  assert.deepEqual([late.marks.length, late.patches], [2, [{ id: 'p1', patch: { checkinClosed: true, status: 'closed', finishedAt: '2026-09-22 09:28:00', finishedBy: '' } }]]);
  const fin = plan({ nowMs: B('08:01:00'), finish: ['p1'], actorId: 't1' });
  assert.deepEqual(fin.patches[0].patch, { checkinClosed: true, checkinUntil: '2026-09-22 08:01:00', status: 'closed', finishedAt: '2026-09-22 08:01:00', finishedBy: 't1' });
  assert.equal(fin.marks.length, 2);
  assert.deepEqual(settlePlan({ pairs: [R], students: S, attendance: [], nowMs: B('09:28:00') }).patches, [{ id: 'p1', patch: { status: 'planned', ...LESSON_CLEAR } }]);
});

test('settlePlan: other statuses, moved and late students, repeat call', () => {
  assert.deepEqual(settlePlan({ pairs: [{ ...R, status: 'closed' }, { ...R, id: 'p2', status: 'planned' }], students: S, attendance: [], nowMs: B('11:00:00') }), { marks: [], patches: [] });
  assert.deepEqual(settlePlan({ pairs: [R], students: [...S.slice(0, 2), st('a3', 'g2'), ...S.slice(3)], attendance: A, nowMs: B('08:03:00') }).marks.map((m) => m.studentId), ['a2']);
  assert.deepEqual(settlePlan({ pairs: [CLOSED], students: [...S, st('a5', 'g1')], attendance: A, nowMs: B('08:40:00') }).marks, []);
  const first = plan({ nowMs: B('11:00:00') });
  const after = { ...R, ...first.patches[0].patch };
  assert.deepEqual(plan({ nowMs: B('11:00:00'), pairs: [after], attendance: [...A, ...first.marks] }), { marks: [], patches: [] });
});

test('settlePlan: students in id order, pairs in input order', () => {
  const students = [st('z', 'g1'), st('c', 'g1'), st('m', 'g1')];
  const other = { ...R, id: 'p2' };
  const out = settlePlan({ pairs: [R, other], students, attendance: [{ pairId: 'p1', studentId: 'x', status: 'present' }, { pairId: 'p2', studentId: 'x', status: 'present' }], nowMs: B('08:03:00') });
  assert.deepEqual(out.marks.map((m) => m.pairId + m.studentId), ['p1c', 'p1m', 'p1z', 'p2c', 'p2m', 'p2z']);
  assert.deepEqual(out.patches.map((p) => p.id), ['p1', 'p2']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';

test('journal.log: groupId filters by the group of the subject before the limit', () => {
  const s = setup();
  const { call, t, at, store, ids, sb1, sb2, p0908, q0911, a1, b1, g1, g2 } = s;
  at('2026-09-30', '12:00');
  const row = (n, subjectId, pairId, studentId, day) => ({
    at: `2026-09-${day} 08:${String(n).padStart(2, '0')}:00`, actorId: ids.dean, entity: 'mark', subjectId, pairId, studentId, unit: null, field: 'activity', before: String(n), after: String(n + 1), reason: 'r', late: true,
  });
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row(i, sb2, q0911, b1, 12));
  for (let i = 0; i < 10; i++) rows.push(row(i, sb1, p0908, a1, 13));
  store.insertMany('changeLog', rows);

  const r2 = call('journal.log', { limit: 10, groupId: g2 }, t.dean).data;
  assert.equal(r2.rows.length, 5);
  assert.equal(r2.rows.every((x) => x.subjectId === sb2 && x.groupName === '02-1'), true);
  assert.equal(r2.more, false);
  const r1 = call('journal.log', { limit: 4, groupId: g1 }, t.dean).data;
  assert.equal(r1.rows.length, 4);
  assert.equal(r1.rows.every((x) => x.subjectId === sb1), true);
  assert.equal(r1.more, true);
  // without a group nothing changes: the newest 10 are all of 01-1
  assert.equal(call('journal.log', { limit: 10 }, t.dean).data.rows.every((x) => x.subjectId === sb1), true);
  // an unknown group: no rows
  assert.deepEqual(call('journal.log', { groupId: 'g_nope' }, t.dean).data.rows, []);
  // null counts as not given
  assert.equal(call('journal.log', { groupId: null, limit: 10 }, t.dean).ok, true);
  // a bad type
  for (const bad of [5, true, ['x'], {}]) assert.equal(call('journal.log', { groupId: bad }, t.dean).error.code, 'bad_request');
  // the teacher: own subject rule stays; the group of another subject gives nothing
  assert.equal(call('journal.log', { subjectId: sb1, groupId: g1 }, t.teacher1).data.rows.length, 10);
  assert.equal(call('journal.log', { subjectId: sb1, groupId: g2 }, t.teacher1).data.rows.length, 0);
  assert.equal(call('journal.log', { groupId: g1 }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('journal.log', { subjectId: sb2, groupId: g2 }, t.teacher1).error.code, 'forbidden');
});

test('student.grades: a transferred student sees only the current group; a disabled student is refused', () => {
  const s = setup();
  const { call, t, at, store, a1, b1, g1, g2, sb1, sb2 } = s;
  at('2026-09-30', '12:00');
  assert.deepEqual(call('student.grades', {}, t.a1).data.subjects.map((x) => x.name), ['Информатика']);
  // a1 moves to 02-1: his old marks in sb1 stay in the base
  store.update('students', a1, { groupId: g2 });
  const moved = call('student.grades', {}, t.a1).data;
  assert.deepEqual(moved.subjects.map((x) => x.name), ['Анатомия']);
  const text = JSON.stringify(moved);
  assert.equal(text.includes('Информатика'), false);
  assert.equal(text.includes('"activity":7'), false);
  assert.equal(text.includes(sb1), false);
  // the pairs of the new group carry no marks of his, and none of the old group's marks appear
  assert.deepEqual(moved.subjects[0].pairs, []);
  // the other student of 02-1 is not affected
  assert.deepEqual(call('student.grades', {}, t.b1).data.subjects.map((x) => x.name), ['Анатомия']);
  assert.ok(g1 && sb2 && b1);

  // disabled after sign-in: the old token stops working
  store.update('students', a1, { active: false });
  const gone = call('student.grades', {}, t.a1);
  assert.equal(gone.ok, false);
  assert.equal(gone.error.code, 'unauthorized');
});

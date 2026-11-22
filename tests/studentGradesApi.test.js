import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

test('student.grades: a student reads only their own points and absences', () => {
  const s = setup();
  const { call, t, at, spy, store, ids, a1, a2, a3, b1, g1, g2, sb1, sb2, ds1 } = s;
  at('2026-09-30', '12:00');
  // the control and the self-work of a1 in unit 1
  store.insert('unitResults', { subjectId: sb1, studentId: a1, planSemester: 1, unit: 1, control: 30, self: 16, currentManual: null, updatedBy: ids.teacher1, updatedAt: '2026-09-20 10:00:00' });

  const g = call('student.grades', {}, t.a1).data;
  assert.deepEqual(g.subjects.map((x) => x.name), ['Информатика']);
  assert.deepEqual(g.subjects[0].units[0], { unit: 1, title: '', current: 38, manual: false, self: 16, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false });
  assert.deepEqual(g.subjects[0].pairs.map((p) => [p.date, p.status, p.activity, p.earned, p.possible]), [['2026-09-01', 'present', null, 20, 20], ['2026-09-08', 'present', 7, 27, 30]]);
  assert.deepEqual(g.subjects[0].attendance, { marked: 2, attended: 2, late: 0, absent: 0, excused: 0, madeup: 0, noCoat: 0, percent: 100 });
  assert.equal(g.subjects[0].teacherName, 'Иванова Нургуль');
  assert.deepEqual(Object.keys(g.scheme).sort(), ['activity', 'attendance', 'control', 'current', 'excellent', 'fair', 'good', 'minimum', 'self']);

  // Review Focus 2: foreign ids in the request change nothing; nothing foreign in the answer
  assert.deepEqual(call('student.grades', { studentId: a2, groupId: g2, subjectId: sb2 }, t.a1).data, g);
  assert.deepEqual(call('student.grades', [a2], t.a1).data, g);
  const text = JSON.stringify(g);
  for (const word of [a2, a3, b1, 'Ёлкин', 'Өмүров', 'Беков', 'markedBy', 'markedAt', 'actorId', 'passwordHash', 'cardNo']) assert.equal(text.includes(word), false, word);
  assert.equal(JSON.stringify(call('student.grades', {}, t.a3).data).includes('"activity":7'), false);

  // a student of another group, with two subjects
  store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g2, teacherId: ids.teacher1, scheme: 'A' });
  assert.deepEqual(call('student.grades', {}, t.b1).data.subjects.map((x) => [x.name, x.hasSyllabus]), [['Анатомия', false], ['Информатика', true]]);

  for (const token of [t.teacher1, t.dean, t.admin, t.prorector]) assert.equal(call('student.grades', {}, token).error.code, 'forbidden');
  assert.equal(call('student.grades', {}, undefined).error.code, 'unauthorized');

  spy.reset();
  call('student.grades', {}, t.a1);
  for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, table);
  assert.deepEqual(spy.writes, {});
  assert.ok(g1);
});

test('student.grades: manual current points, a student without a group', () => {
  const s = setup();
  const { call, t, at, store, ids, a1, sb1 } = s;
  at('2026-09-30', '12:00');
  store.insert('unitResults', { subjectId: sb1, studentId: a1, planSemester: 1, unit: 1, control: 30, self: 16, currentManual: 36, updatedBy: ids.teacher1, updatedAt: '2026-09-20 10:00:00' });
  store.insert('changeLog', { at: '2026-09-20 10:00:00', actorId: ids.teacher1, entity: 'unit', subjectId: sb1, studentId: a1, unit: 1, field: 'currentManual', before: '', after: '36', reason: 'секретная причина', late: false });
  const g = call('student.grades', {}, t.a1).data;
  assert.deepEqual([g.subjects[0].units[0].manual, g.subjects[0].units[0].current], [true, 36]);
  assert.equal(JSON.stringify(g).includes('секретная'), false);
  store.update('students', a1, { groupId: '' });
  at('2026-09-30', '12:00');
  assert.deepEqual(call('student.grades', {}, t.a1).data.subjects, []);
});

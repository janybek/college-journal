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

// Unit 6: the lines of requests, closings and exams.
function logWorld() {
  const s = setup();
  const { store, ids, sb1, g1, g2, at, request } = s;
  at('2026-12-20', '12:00');
  const requestId = request({ status: 'applied', deanBy: ids.dean, deanAt: '2026-10-02 10:00:00', finalBy: ids.prorector, finalAt: '2026-10-03 10:00:00', closedAt: '2026-10-03 10:00:00' });
  const lone = request({ unit: 2, studentId: ids.a3, status: 'prorector', deanBy: ids.dean, deanAt: '2026-10-02 10:00:00' });
  const exam = store.insert('stateExams', { groupId: g2, name: 'Государственный экзамен по специальности', date: '2026-12-10', createdBy: ids.dean, createdAt: '2026-12-01 10:00:00', updatedBy: '', updatedAt: '' });
  const base = { actorId: ids.dean, studentId: '', pairId: '', unit: null, before: '', after: '', reason: '', late: false };
  store.insertMany('changeLog', [
    { ...base, at: '2026-12-11 10:00:00', entity: 'unit', subjectId: sb1, studentId: ids.a1, unit: 1, field: 'control', before: '30', after: '33', reason: 'r', requestId },
    { ...base, at: '2026-12-11 10:00:01', entity: 'mark', subjectId: sb1, studentId: ids.a1, field: 'status', before: 'absent', after: 'excused', reason: 'r' },
    { ...base, at: '2026-12-11 10:00:02', entity: 'unit', subjectId: sb1, studentId: ids.a1, unit: 1, field: 'self', before: '10', after: '12', reason: 'r' },
    { ...base, at: '2026-12-11 10:00:03', entity: 'ledger', subjectId: sb1, unit: 1, field: 'closed', before: 'open', after: 'closed' },
    { ...base, at: '2026-12-11 10:00:04', entity: 'exam', examId: exam.id, studentId: ids.b1, field: 'score', before: '60', after: '64', reason: 'r' },
    { ...base, at: '2026-12-11 10:00:05', entity: 'subjectExam', subjectId: sb1, studentId: ids.a2, field: 'try1', before: '', after: '31' },
    { ...base, at: '2026-12-11 10:00:06', entity: 'subjectExam', subjectId: sb1, studentId: ids.a2, field: 'try1', before: '31', after: '33', reason: 'опечатка', requestId: lone },
  ]);
  return { ...s, requestId, lone, examId: exam.id };
}

test('journal.log: a line of a request carries the request and the two who approved it; the other lines have no new keys', () => {
  const { call, t, ids, requestId, lone } = logWorld();
  const rows = call('journal.log', {}, t.dean).data.rows;
  const byRequest = rows.find((r) => r.requestId === requestId);
  assert.equal(byRequest.entity, 'unit');
  assert.deepEqual(byRequest.approvedBy, ['Деканова Айгуль', 'Проректоров Талант']);
  const half = rows.find((r) => r.requestId === lone);
  assert.deepEqual(half.approvedBy, ['Деканова Айгуль', '']);
  const mark = rows.find((r) => r.entity === 'mark');
  assert.deepEqual(Object.keys(mark).sort(), ['actorName', 'after', 'at', 'before', 'entity', 'field', 'groupName', 'id', 'late', 'pairDate', 'pairId', 'pairSlot', 'reason', 'studentId', 'studentName', 'subjectId', 'subjectName', 'unit'].sort());
  const plain = rows.find((r) => r.entity === 'unit' && !r.requestId);
  assert.equal('requestId' in plain || 'approvedBy' in plain || 'examId' in plain, false);
  const ledger = rows.find((r) => r.entity === 'ledger');
  assert.equal(ledger.field, 'closed');
  assert.equal(ledger.unit, 1);
  assert.equal('requestId' in ledger, false);
  assert.ok(ids.dean);
});

test('journal.log: a line of a state exam has the name and the group; the group filter uses the group of the exam', () => {
  const { call, t, g1, g2, examId } = logWorld();
  const rows = call('journal.log', {}, t.dean).data.rows;
  const line = rows.find((r) => r.entity === 'exam');
  assert.equal(line.examId, examId);
  assert.equal(line.examName, 'Государственный экзамен по специальности');
  assert.equal(line.groupName, '02-1');
  assert.equal(line.subjectId, '');
  assert.equal(call('journal.log', { groupId: g2 }, t.dean).data.rows.some((r) => r.entity === 'exam'), true);
  assert.equal(call('journal.log', { groupId: g1 }, t.dean).data.rows.some((r) => r.entity === 'exam'), false);
  assert.equal(call('journal.log', { groupId: g2 }, t.prorector).data.rows.some((r) => r.entity === 'exam'), true);
});

test('journal.log: the teacher reads the requests, closings and exam of his subject, not the state exams', () => {
  const { call, t, sb1, requestId } = logWorld();
  const rows = call('journal.log', { subjectId: sb1 }, t.teacher1).data.rows;
  assert.equal(rows.some((r) => r.requestId === requestId), true);
  assert.equal(rows.some((r) => r.entity === 'ledger'), true);
  assert.equal(rows.some((r) => r.entity === 'exam'), false);
  assert.equal(rows.filter((r) => r.entity === 'subjectExam').length, 2);
  assert.equal(JSON.stringify(rows).includes('Государственный'), false);
  assert.equal(call('journal.log', {}, t.teacher1).error.code, 'forbidden');
});

test('journal.log: the retake line of the exam of a subject: field try1, the result as text; seen by the deanery and the own teacher, not by another teacher', () => {
  const { call, t, sb1 } = logWorld();
  const line = call('journal.log', { subjectId: sb1 }, t.dean).data.rows.find((r) => r.entity === 'subjectExam' && r.before === '31');
  assert.deepEqual([line.field, line.before, line.after, line.reason], ['try1', '31', '33', 'опечатка']);
  assert.equal(line.subjectName, 'Информатика');
  assert.equal(call('journal.log', { subjectId: sb1 }, t.teacher1).data.rows.some((r) => r.entity === 'subjectExam'), true);
  assert.equal(call('journal.log', { subjectId: sb1 }, t.teacher2).error.code, 'forbidden');
});

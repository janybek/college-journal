import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { WORK_TABLES } from '../backend/workData.js';

// Assignments of the staff: overview, list, give, change, remove, read. Fictional people only.
const saver = (s) => (data, token = s.t.teacher1) => s.call('work.save', {
  subjectId: s.sb1, kind: 'srs', unit: 2, topicId: '', title: 'СРС А', description: 'Эссе', dueDate: '2026-09-27', dueTime: '23:59', maxPoints: 20, ...data,
}, token);
const file = (s, over) => s.store.insert('files', {
  assignmentId: '', submissionId: '', ownerId: s.a1, state: 'pending', name: 'работа.pdf', kind: 'pdf', size: 100, stored: 'a'.repeat(32) + '.bin', at: '2026-09-22 09:00:00', ...over,
}).id;

test('work.save: rights, bad subjects, the first assignment, the pair gives the topic', () => {
  const s = setup();
  const { call, t, at, store, ids, sb1, p0915, snapshot } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  const before = snapshot();
  for (const token of [t.teacher2, t.teacher3, t.dean, t.prorector, t.admin, t.a1]) assert.notEqual(save({}, token).ok, true);
  assert.equal(save({}, t.dean).error.code, 'forbidden');
  assert.equal(save({}, t.a1).error.code, 'forbidden');
  for (const bad of [[sb1], 7, ` ${sb1} `, null, 'nope']) assert.equal(save({ subjectId: bad }).error.code, 'not_found');
  assert.deepEqual(save({ unit: 9 }).error, { code: 'invalid', fields: [{ field: 'unit', code: 'bad_value' }] });
  assert.equal(save({ pairId: 7 }).error.code, 'not_found');
  assert.equal(save({ pairId: s.q0904 }).error.code, 'not_found');
  assert.equal(save({ pairId: 'pr_nope' }).error.code, 'not_found');
  assert.deepEqual(snapshot(), before);

  const id = save({}).data.assignment.id;
  assert.deepEqual((({ kind, unit, planSemester, dueAt, maxPoints, createdBy, updatedBy, updatedAt, pairId }) => ({ kind, unit, planSemester, dueAt, maxPoints, createdBy, updatedBy, updatedAt, pairId }))(store.get('assignments', id)),
    { kind: 'srs', unit: 2, planSemester: 1, dueAt: '2026-09-27 23:59:00', maxPoints: 20, createdBy: ids.teacher1, updatedBy: '', updatedAt: '', pairId: '' });
  assert.equal(store.get('assignments', id).createdAt, '2026-09-22 10:00:00');

  const fromPair = save({ pairId: p0915, unit: 1, topicId: 'tp_x', kind: 'hw' }).data.assignment.id;
  const row = store.get('assignments', fromPair);
  assert.deepEqual([row.unit, row.topicId, row.pairId], [2, store.get('pairs', p0915).topicId, p0915]);
  assert.notEqual(row.topicId, '');
  assert.equal(save({ title: '   ' }).error.fields[0].field, 'title');
  assert.equal(save({ description: 'x'.repeat(5001) }).error.fields[0].code, 'too_long');
});

test('work.get, work.list, work.overview: who reads what', () => {
  const s = setup();
  const { call, t, at, ids, sb1, sb2 } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  const id = save({}).data.assignment.id;
  save({ kind: 'hw', unit: 1, title: 'ДЗ', topicId: '' });
  for (const token of [t.dean, t.prorector, t.admin, t.teacher1]) assert.equal(call('work.get', { assignmentId: id }, token).ok, true);
  assert.equal(call('work.get', { assignmentId: id }, t.teacher2).error.code, 'forbidden');
  assert.equal(call('work.get', { assignmentId: id }, t.teacher3).error.code, 'forbidden');
  assert.equal(call('work.get', { assignmentId: id }, t.a1).ok, true);          // the student of the group reads his own view
  assert.equal(call('work.get', { assignmentId: id }, t.b1).error.code, 'not_found');
  for (const bad of [[id], 5, null, 'as_nope', ` ${id} `]) assert.equal(call('work.get', { assignmentId: bad }, t.teacher1).error.code, 'not_found');

  const list = call('work.list', { subjectId: sb1 }, t.teacher1).data;
  assert.deepEqual([list.can.manage, list.units.map((u) => u.unit), list.assignments.find((a) => a.id === id).counts],
    [true, [1, 2], { total: 3, none: 3, submitted: 0, checked: 0, returned: 0 }]);
  assert.deepEqual([list.today, list.now], ['2026-09-22', '2026-09-22 10:00:00']);
  assert.deepEqual(list.subject, { id: sb1, name: 'Информатика', groupName: '01-1', teacherName: 'Иванова Нургуль', planSemester: 1, hasSyllabus: true });
  assert.deepEqual(list.topics.map((x) => [x.unit, x.name, x.number]), [[1, 'Тема 1', 'Л1'], [1, 'Тема 2', 'П1'], [2, 'Тема 3', 'Л2'], [2, 'Тема 4', 'П2'], [2, 'Тема 5', 'М1']]);
  assert.deepEqual(Object.keys(list.assignments[0]), ['id', 'kind', 'unit', 'topicId', 'topicName', 'pairId', 'title', 'dueAt', 'maxPoints', 'current', 'locked', 'counts']);
  assert.equal(call('work.list', { subjectId: sb1 }, t.dean).data.can.manage, false);
  for (const token of [t.dean, t.prorector, t.admin]) assert.equal(call('work.list', { subjectId: sb1 }, token).ok, true);
  assert.equal(call('work.list', { subjectId: sb1 }, t.teacher2).error.code, 'forbidden');
  assert.equal(call('work.list', { subjectId: sb1 }, t.a1).error.code, 'forbidden');
  for (const bad of [[sb1], 7, null, 'sb_nope']) assert.equal(call('work.list', { subjectId: bad }, t.dean).error.code, 'not_found');

  assert.deepEqual(call('work.overview', {}, t.teacher1).data.subjects.map((x) => [x.name, x.assignments]), [['Информатика', 2]]);
  assert.equal(call('work.overview', {}, t.teacher2).data.subjects.some((x) => x.subjectId === sb1), false);
  assert.deepEqual(call('work.overview', {}, t.teacher2).data.subjects.map((x) => [x.subjectId, x.own, x.assignments, x.toCheck]), [[sb2, true, 0, 0]]);
  const all = call('work.overview', {}, t.prorector).data;
  assert.deepEqual(all.subjects.map((x) => [x.groupName, x.name, x.own]), [['01-1', 'Информатика', false], ['02-1', 'Анатомия', false]]);
  assert.deepEqual(Object.keys(all.subjects[0]), ['subjectId', 'name', 'groupName', 'teacherName', 'own', 'assignments', 'toCheck']);
  assert.equal(all.today, '2026-09-22');
  // the dean who also teaches: all subjects, own only for his own
  s.store.update('subjects', sb2, { teacherId: ids.dean });
  assert.deepEqual(call('work.overview', {}, t.dean).data.subjects.map((x) => [x.subjectId, x.own]), [[sb1, false], [sb2, true]]);
  assert.equal(call('work.overview', {}, t.a1).error.code, 'forbidden');
  for (const data of [call('work.overview', {}, t.admin).data, list, call('work.get', { assignmentId: id }, t.admin).data]) assert.equal(JSON.stringify(data).includes('passwordHash'), false);
});

test('work.save: a given assignment keeps its type and unit, the maximum stays above the points, the log gets the changes', () => {
  const s = setup();
  const { call, t, at, store, snapshot, sb1, sb2, ids } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  const id = save({}).data.assignment.id;
  // a given assignment of another subject: the subject does not change, the foreign subject is forbidden
  const foreign = s.task({ subjectId: sb2, createdBy: ids.teacher2 });
  const before0 = snapshot();
  assert.equal(save({ id: foreign }).error.code, 'bad_request');
  assert.equal(save({ id: foreign, subjectId: sb2 }).error.code, 'forbidden');
  assert.equal(save({ id: [id] }).error.code, 'not_found');
  assert.equal(save({ id: 'as_nope' }).error.code, 'not_found');
  assert.deepEqual(snapshot(), before0);

  s.attempt(id, 'a1', { status: 'checked', points: 15 });
  const before = snapshot();
  assert.deepEqual(save({ id, unit: 1 }).error.fields, [{ field: 'unit', code: 'locked' }]);
  assert.deepEqual(save({ id, kind: 'hw' }).error.fields, [{ field: 'kind', code: 'locked' }]);
  assert.deepEqual(save({ id, maxPoints: 12 }).error.fields, [{ field: 'maxPoints', code: 'below_points' }]);
  assert.equal(save({ id, subjectId: sb2 }).error.code, 'forbidden');
  assert.equal(save({ id }, t.teacher2).error.code, 'forbidden');
  assert.deepEqual(snapshot(), before);

  assert.equal(save({ id, title: 'СРС А (эссе)', maxPoints: 15 }).ok, true);
  const log = () => store.list('changeLog').filter((r) => r.entity === 'work');
  assert.deepEqual(log().map((r) => [r.assignmentId, r.field, r.before, r.after, r.studentId, r.reason]), [[id, 'maxPoints', '20', '15', '', '']]);
  assert.deepEqual([log()[0].subjectId, log()[0].unit, log()[0].late, log()[0].pairId, log()[0].actorId, log()[0].at], [sb1, 2, false, '', ids.teacher1, '2026-09-22 10:00:00']);
  assert.deepEqual([store.get('assignments', id).updatedBy, store.get('assignments', id).updatedAt, store.get('assignments', id).title], [ids.teacher1, '2026-09-22 10:00:00', 'СРС А (эссе)']);
  assert.equal(save({ id, title: 'СРС А (эссе)', maxPoints: 15, dueDate: '2026-09-28' }).ok, true);
  assert.deepEqual(log().filter((r) => r.field === 'dueAt').map((r) => [r.before, r.after, r.reason]), [['2026-09-27 23:59:00', '2026-09-28 23:59:00', '']]);
  assert.equal(save({ id, title: 'Только название', maxPoints: 15, dueDate: '2026-09-28' }).ok, true);
  assert.equal(log().length, 2);
  // a due date and a maximum together: two lines in one write
  assert.equal(save({ id, title: 'Только название', maxPoints: 18, dueDate: '2026-09-29' }).ok, true);
  assert.deepEqual(log().slice(2).map((r) => r.field).sort(), ['dueAt', 'maxPoints']);
  assert.equal(call('work.remove', { assignmentId: id }, t.teacher1).error.code, 'in_use');
  // without attempts the maximum and the due date change without a line in the log
  const free = save({ title: 'Свободное' }).data.assignment.id;
  assert.equal(save({ id: free, title: 'Свободное', maxPoints: 30, dueDate: '2026-09-30' }).ok, true);
  assert.equal(log().length, 4);
});

test('work.save: a change that changes nothing writes nothing; one write per table', () => {
  const s = setup();
  const { at, spy, snapshot, store } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  spy.reset();
  const id = save({}).data.assignment.id;
  assert.deepEqual(spy.writes, { 'insertMany:assignments': 1 });
  assert.deepEqual(Object.keys(spy.lists).sort(), [...WORK_TABLES].sort());
  assert.ok(WORK_TABLES.every((table) => spy.lists[table] === 1));
  const before = snapshot();
  spy.reset();
  assert.equal(save({ id }).data.assignment.id, id);
  assert.deepEqual(spy.writes, {});
  assert.deepEqual(snapshot(), before);
  spy.reset();
  save({ id, title: 'Новое' });
  assert.deepEqual(spy.writes, { 'updateMany:assignments': 1 });
  s.attempt(id, 'a1');
  spy.reset();
  save({ id, title: 'Новое', maxPoints: 25, dueDate: '2026-09-29' });
  assert.deepEqual(spy.writes, { 'updateMany:assignments': 1, 'insertMany:changeLog': 1 });
  assert.equal(store.list('changeLog').length, 2);
});

test('work.remove: only the teacher of the subject, nothing with attempts, pending files are dropped', () => {
  const s = setup();
  const { call, t, at, store, snapshot, files } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  const id = save({}).data.assignment.id;
  const other = save({ title: 'Другое' }).data.assignment.id;
  const mine = file(s, { assignmentId: id, stored: 'b'.repeat(32) + '.bin' });
  const stay = file(s, { assignmentId: other, stored: 'c'.repeat(32) + '.bin' });
  files.put('b'.repeat(32) + '.bin', [1, 2]);
  files.put('c'.repeat(32) + '.bin', [3]);
  const before = snapshot();
  for (const token of [t.teacher2, t.teacher3, t.dean, t.prorector, t.admin, t.a1]) assert.notEqual(call('work.remove', { assignmentId: id }, token).ok, true);
  assert.equal(call('work.remove', { assignmentId: id }, t.dean).error.code, 'forbidden');
  for (const bad of [[id], 4, null, 'as_nope']) assert.equal(call('work.remove', { assignmentId: bad }, t.teacher1).error.code, 'not_found');
  assert.deepEqual(snapshot(), before);

  s.spy.reset();
  assert.deepEqual(call('work.remove', { assignmentId: id }, t.teacher1).data, {});
  assert.deepEqual(s.spy.writes, { 'removeMany:assignments': 1, 'updateMany:files': 1 });
  assert.equal(store.get('assignments', id), null);
  assert.deepEqual([store.get('files', mine).state, store.get('files', stay).state], ['dropped', 'pending']);
  assert.deepEqual(files.names(), before.disk);

  // an assignment with an attempt (any student) stays
  const kept = save({ title: 'С попыткой' }).data.assignment.id;
  s.attempt(kept, 'a2', { status: 'returned', comment: 'ещё раз' });
  const again = snapshot();
  assert.equal(call('work.remove', { assignmentId: kept }, t.teacher1).error.code, 'in_use');
  assert.deepEqual(snapshot(), again);
});

test('the teacher of the subject changes: the new one works, the old one does not', () => {
  const s = setup();
  const { call, t, at, store, ids, sb1, snapshot } = s;
  at('2026-09-22', '10:00');
  const save = saver(s);
  const id = save({}).data.assignment.id;
  store.update('subjects', sb1, { teacherId: ids.teacher2 });
  const before = snapshot();
  assert.equal(save({ id }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('work.remove', { assignmentId: id }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('work.list', { subjectId: sb1 }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('work.get', { assignmentId: id }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('work.overview', {}, t.teacher1).data.subjects.some((x) => x.subjectId === sb1), false);
  assert.deepEqual(snapshot(), before);
  // teacher2 has no syllabus of this discipline: units and topics are empty; a given type and unit stay untouched
  const list = call('work.list', { subjectId: sb1 }, t.teacher2).data;
  assert.deepEqual([list.can.manage, list.units, list.topics, list.subject.hasSyllabus, list.subject.planSemester, list.subject.teacherName], [true, [], [], false, null, 'Петров Эрмек']);
  assert.equal(save({ id, title: 'Новое имя', dueDate: '2026-09-28' }, t.teacher2).ok, true);
  assert.equal(store.get('assignments', id).title, 'Новое имя');
  assert.equal(store.get('assignments', id).updatedBy, ids.teacher2);
  assert.deepEqual(save({ title: 'Своё' }, t.teacher2).error.fields, [{ field: 'unit', code: 'bad_value' }]);
  assert.equal(call('work.remove', { assignmentId: id }, t.teacher2).ok, true);
});

test('work.get of the staff: students, attempts, files, the left ones; pending files stay hidden', () => {
  const s = setup();
  const { call, t, at, store, ids, a1, a2, a3, g2, sb1 } = s;
  at('2026-09-22', '10:00');
  const id = s.task({ dueAt: '2026-09-20 23:59:00', maxPoints: 10, description: 'Описание' });
  const first = s.attempt(id, 'a1', { n: 1, status: 'returned', comment: 'доработать', checkedBy: ids.teacher1, checkedAt: '2026-09-19 09:00:00', submittedAt: '2026-09-18 10:00:00' });
  const second = s.attempt(id, 'a1', { n: 2, status: 'submitted', submittedAt: '2026-09-21 10:00:00', text: 'новый ответ' });
  const checked = s.attempt(id, 'a2', { status: 'checked', points: 7, checkedBy: ids.teacher1, checkedAt: '2026-09-19 12:00:00', paper: true, submittedAt: '2026-09-21 12:00:00' });
  const f1 = file(s, { assignmentId: id, submissionId: second, state: 'attached', name: 'ответ.pdf', size: 321 });
  const hidden = [
    file(s, { assignmentId: id, submissionId: '', state: 'pending', name: 'ждёт.pdf', stored: 'd'.repeat(32) + '.bin' }),
    file(s, { assignmentId: id, submissionId: second, state: 'dropped', name: 'убран.pdf', stored: 'e'.repeat(32) + '.bin' }),
  ];
  store.update('students', a2, { groupId: g2 });
  const view = call('work.get', { assignmentId: id }, t.teacher1).data;
  assert.deepEqual(Object.keys(view), ['now', 'assignment', 'can', 'students']);
  assert.equal(view.now, '2026-09-22 10:00:00');
  assert.deepEqual(view.assignment, {
    id, subjectId: sb1, subjectName: 'Информатика', groupName: '01-1', teacherName: 'Иванова Нургуль', kind: 'srs', unit: 2, unitTitle: '', topicId: '', topicName: '',
    title: 'СРС А', description: 'Описание', dueAt: '2026-09-20 23:59:00', maxPoints: 10, createdAt: '2026-09-10 12:00:00', locked: true,
  });
  assert.deepEqual(view.can, { manage: true, grade: true });
  assert.deepEqual(call('work.get', { assignmentId: id }, t.dean).data.can, { manage: false, grade: false });
  assert.deepEqual(view.students.map((x) => [x.id, x.left, x.state, x.late, x.overdue, x.points]), [
    [a1, false, 'submitted', true, false, null], [a3, false, 'none', false, true, null], [a2, true, 'checked', false, false, 7],
  ]);
  assert.deepEqual(view.students[0].attempts.map((a) => a.n), [2, 1]);
  assert.deepEqual(view.students[0].attempts[0], {
    id: second, n: 2, text: 'новый ответ', paper: false, submittedAt: '2026-09-21 10:00:00', late: true, status: 'submitted', points: null, comment: '',
    checkedAt: '', checkedByName: '', files: [{ id: f1, name: 'ответ.pdf', kind: 'pdf', size: 321 }],
  });
  assert.deepEqual([view.students[0].attempts[1].id, view.students[0].attempts[1].checkedByName, view.students[0].attempts[1].files, view.students[0].attempts[1].late], [first, 'Иванова Нургуль', [], false]);
  assert.deepEqual([view.students[2].attempts[0].id, view.students[2].attempts[0].paper, view.students[2].attempts[0].late], [checked, true, false]);
  assert.deepEqual(view.students[1].attempts, []);
  const json = JSON.stringify(view);
  for (const hide of [...hidden, 'ждёт.pdf', 'убран.pdf', 'stored', '.bin', 'passwordHash', 'cardNo']) assert.equal(json.includes(hide), false, hide);
  // before the deadline nobody is overdue
  const soon = s.task({ dueAt: '2026-09-25 23:59:00' });
  assert.equal(call('work.get', { assignmentId: soon }, t.teacher1).data.students.every((x) => x.overdue === false), true);
  s.spy.reset();
  call('work.get', { assignmentId: id }, t.teacher1);
  assert.ok(Object.keys(s.spy.lists).every((table) => WORK_TABLES.includes(table)));
  assert.ok(WORK_TABLES.every((table) => s.spy.lists[table] === 1));
  s.spy.reset();
  call('work.list', { subjectId: sb1 }, t.teacher1);
  assert.ok(WORK_TABLES.every((table) => s.spy.lists[table] === 1));
  assert.deepEqual(s.spy.writes, {});
  s.spy.reset();
  call('work.overview', {}, t.teacher1);
  assert.ok(WORK_TABLES.every((table) => s.spy.lists[table] === 1));
});

test('work.list counts the current attempt of every active student of the group', () => {
  const s = setup();
  const { call, t, at, sb1 } = s;
  at('2026-09-22', '10:00');
  const id = s.task({ dueAt: '2026-09-25 23:59:00' });
  s.attempt(id, 'a1', { n: 1, status: 'returned', comment: 'x' });
  s.attempt(id, 'a1', { n: 2, status: 'submitted' });
  s.attempt(id, 'a2', { status: 'checked', points: 5 });
  s.attempt(id, 'a4', { status: 'submitted' });
  const old = s.task({ dueAt: '2026-08-20 23:59:00', title: 'Старое' });
  s.attempt(old, 'a1', { status: 'submitted' });
  const list = call('work.list', { subjectId: sb1 }, t.teacher1).data;
  assert.deepEqual(list.assignments.map((a) => [a.title, a.current, a.locked]), [['СРС А', true, true], ['Старое', false, true]]);
  assert.deepEqual(list.assignments[0].counts, { total: 3, none: 1, submitted: 1, checked: 1, returned: 0 });
  const over = call('work.overview', {}, t.teacher1).data.subjects[0];
  assert.deepEqual([over.assignments, over.toCheck], [1, 2]);
});

test('lesson.get tells whether the teacher of the subject may give a task, and the unit of the pair', () => {
  const s = setup();
  const { call, t, at, p0922, p0915, store } = s;
  at('2026-09-22', '07:58');
  assert.equal(call('lesson.start', { pairId: p0922 }, t.teacher1).ok, true);
  const mine = call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual(Object.keys(mine).slice(-2), ['scheme', 'assign']);
  assert.deepEqual([mine.assign, mine.pair.unit, mine.pair.topicId], [true, 2, store.get('pairs', p0922).topicId]);
  const sub = call('lesson.get', { pairId: p0915 }, t.teacher3).data.lesson;
  assert.deepEqual([sub.assign, sub.pair.unit], [false, 2]);
  // the office and the students do not lead the pair: the answer is a refusal, there is no button to give a task
  assert.equal(call('lesson.get', { pairId: p0922 }, t.dean).error.code, 'forbidden');
  assert.equal(call('lesson.get', { pairId: p0922 }, t.prorector).error.code, 'forbidden');
  assert.equal(call('lesson.get', { pairId: p0922 }, t.a1).error.code, 'forbidden');
});

test('without a file box the assignments still work', () => {
  const s = setup({ files: null });
  const { call, t, at, sb1 } = s;
  at('2026-09-22', '10:00');
  const id = saver(s)({}).data.assignment.id;
  assert.equal(call('work.list', { subjectId: sb1 }, t.teacher1).ok, true);
  assert.equal(call('work.get', { assignmentId: id }, t.admin).ok, true);
  assert.equal(call('work.remove', { assignmentId: id }, t.teacher1).ok, true);
  assert.deepEqual(s.snapshot().disk, []);
});

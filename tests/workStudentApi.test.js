import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { WORK_TABLES } from '../backend/workData.js';
import { SAMPLE, b64 } from './fakes/sampleFiles.js';

// Work of a student: my tasks, hand in, read the own work. Fictional people only.
const prepare = (options) => {
  const s = setup(options);
  s.at('2026-09-22', '10:00');
  const id = s.task({ dueAt: '2026-09-27 23:59:00' });
  const upload = (n, token = s.t.a1, assignmentId = id) => s.call('work.upload', { assignmentId, name: `p${n}.jpg`, data: b64(SAMPLE.jpg) }, token).data.file.id;
  const submit = (data, token = s.t.a1) => s.call('work.submit', { assignmentId: id, text: '', fileIds: [], ...data }, token);
  return { s, id, upload, submit };
};
const TASK_KEYS = ['id', 'subjectId', 'subjectName', 'kind', 'unit', 'title', 'dueAt', 'maxPoints', 'state', 'late', 'overdue', 'points'];

test('work.submit: refusals write nothing', () => {
  const { s, id, upload, submit } = prepare();
  const { t, store, snapshot, call } = s;
  const f1 = upload(1);
  assert.deepEqual(submit({}).error.fields, [{ field: 'text', code: 'empty' }]);
  assert.deepEqual(submit({ text: '   ' }).error.fields, [{ field: 'text', code: 'empty' }]);
  const f9 = upload(9, t.a2);
  assert.deepEqual(submit({ fileIds: [f1, f9] }).error, { code: 'invalid', fields: [{ field: 'fileIds', index: 1, code: 'bad_ref' }] });
  assert.deepEqual(submit({ fileIds: ['fl_nope'] }).error.fields, [{ field: 'fileIds', index: 0, code: 'bad_ref' }]);
  // a file of another assignment, an attached one, a dropped one, a pending one older than 24 hours
  const other = s.task({ title: 'другое', dueAt: '2026-09-28 23:59:00' });
  const fOther = upload(3, t.a1, other);
  const mk = (over) => store.insert('files', {
    assignmentId: id, submissionId: '', ownerId: s.a1, state: 'pending', name: 'x.jpg', kind: 'jpg', size: 10, stored: 'a'.repeat(32) + '.bin', at: '2026-09-22 09:00:00', ...over,
  }).id;
  const fAttached = mk({ state: 'attached', submissionId: 'su_x' });
  const fDropped = mk({ state: 'dropped' });
  const fOld = mk({ at: '2026-09-21 09:59:59' });
  const fEdge = mk({ at: '2026-09-21 10:00:00' });
  for (const bad of [fOther, fAttached, fDropped, fOld]) {
    assert.deepEqual(submit({ fileIds: [f1, bad] }).error.fields, [{ field: 'fileIds', index: 1, code: 'bad_ref' }], bad);
  }
  assert.equal(submit({ fileIds: [fEdge] }).ok, true);          // exactly 24 hours is still young
  const sub = snapshot();
  assert.equal(sub.submissions.length, 1);
  store.remove('submissions', sub.submissions[0].id);
  store.update('files', fEdge, { state: 'pending', submissionId: '' });
  const again = snapshot();
  for (const bad of [[f1, f1], 'f1', [f1, 2], Array(6).fill(f1), null, 7, { 0: f1 }]) assert.equal(submit({ fileIds: bad }).error.code, 'bad_request');
  assert.equal(submit({ fileIds: undefined, text: 'x' }).error.code, 'bad_request');
  for (const text of [7, null, ['x'], 'a'.repeat(5001), ` ${'a'.repeat(5001)} `]) assert.equal(submit({ text, fileIds: [f1] }).error.code, 'bad_request');
  assert.equal(call('work.submit', { assignmentId: id, fileIds: [] }, t.a1).error.code, 'bad_request');
  assert.equal(call('work.submit', { assignmentId: id, text: 'x' }, t.a1).error.code, 'bad_request');
  assert.deepEqual(snapshot(), again);
  assert.equal(submit({ text: 'a'.repeat(5000) }, t.a2).ok, true);

  // the wrong person or the wrong assignment
  const base = snapshot();
  for (const token of [t.b1, t.teacher1, t.dean, t.admin, null]) assert.notEqual(submit({ text: 'x' }, token).ok, true);
  assert.equal(submit({ text: 'x' }, t.b1).error.code, 'not_found');
  assert.equal(submit({ text: 'x' }, t.teacher1).error.code, 'forbidden');
  for (const bad of [[id], 5, null, ` ${id} `, 'as_nope']) assert.equal(call('work.submit', { assignmentId: bad, text: 'x', fileIds: [] }, t.a1).error.code, 'not_found');
  assert.deepEqual(snapshot(), base);
});

test('work.submit: the first hand-in, a re-hand-in before checking, a returned one, a checked one', () => {
  const { s, id, upload, submit } = prepare();
  const { t, store, call, spy } = s;
  const [f1, f2] = [upload(1), upload(2)];
  spy.reset();
  const w = submit({ text: '  Ответ  ', fileIds: [f1, f2] }).data.work;
  assert.deepEqual(spy.writes, { 'insertMany:submissions': 1, 'updateMany:files': 1 });
  assert.ok(Object.values(spy.lists).every((n) => n === 1));
  assert.deepEqual(Object.keys(spy.lists).sort(), [...WORK_TABLES].sort());
  assert.deepEqual([w.mine.state, w.mine.attempts[0].text, w.mine.attempts[0].files.map((x) => x.id).sort(), w.mine.pending],
    ['submitted', 'Ответ', [f1, f2].sort(), []]);
  assert.deepEqual([w.mine.attempts[0].n, w.mine.attempts[0].status, w.mine.attempts[0].paper, w.mine.attempts[0].late, w.canSubmit],
    [1, 'submitted', false, false, true]);
  assert.equal(w.mine.attempts[0].submittedAt, '2026-09-22 10:00:00');
  assert.deepEqual(store.list('files').map((f) => [f.state, f.submissionId === w.mine.attempts[0].id]), [['attached', true], ['attached', true]]);
  // the answer is the same as work.get gives afterwards
  assert.deepEqual(call('work.get', { assignmentId: id }, t.a1).data.mine, w.mine);

  // a re-hand-in before checking: the old attempt is replaced, the new one starts with no files
  const f3 = upload(3);
  spy.reset();
  const w2 = submit({ text: 'Новый', fileIds: [f3] }).data.work;
  assert.deepEqual(spy.writes, { 'updateMany:submissions': 1, 'insertMany:submissions': 1, 'updateMany:files': 1 });
  assert.deepEqual(w2.mine.attempts.map((a) => [a.n, a.status, a.files.length]), [[2, 'submitted', 1], [1, 'replaced', 2]]);
  const w3 = submit({ text: 'Только текст' }).data.work;
  assert.deepEqual(w3.mine.attempts.map((a) => [a.n, a.status, a.files.length]), [[3, 'submitted', 0], [2, 'replaced', 1], [1, 'replaced', 2]]);
  assert.equal(store.list('submissions').length, 3);

  // returned: a new attempt, the returned one stays with its comment
  const last = store.list('submissions').find((r) => r.n === 3);
  store.update('submissions', last.id, { status: 'returned', comment: 'Дополни', checkedBy: s.ids.teacher1, checkedAt: '2026-09-22 11:00:00' });
  const w4 = submit({ text: 'Дополнено' }).data.work;
  assert.deepEqual(w4.mine.attempts.map((a) => [a.n, a.status]), [[4, 'submitted'], [3, 'returned'], [2, 'replaced'], [1, 'replaced']]);
  assert.equal(w4.mine.attempts[1].comment, 'Дополни');

  // checked: nothing more, neither text nor files
  const spare = upload(4, t.a1);
  const current = store.list('submissions').find((r) => r.n === 4);
  store.update('submissions', current.id, { status: 'checked', points: 8, comment: 'Хорошо', checkedBy: s.ids.teacher1, checkedAt: '2026-09-22 12:00:00' });
  const before = s.snapshot();
  assert.equal(submit({ text: 'ещё' }).error.code, 'already_checked');
  assert.equal(submit({ fileIds: [spare] }).error.code, 'already_checked');
  assert.equal(submit({ fileIds: 'bad' }).error.code, 'bad_request');
  assert.equal(call('work.upload', { assignmentId: id, name: 'a.jpg', data: b64(SAMPLE.jpg) }, t.a1).error.code, 'already_checked');
  assert.deepEqual(s.snapshot(), before);
  const view = call('work.get', { assignmentId: id }, t.a1).data;
  assert.deepEqual([view.mine.state, view.mine.points, view.canSubmit, view.mine.pending.map((f) => f.id)], ['checked', 8, false, [spare]]);
});

test('work.submit: after the due date the attempt is late; text only works without the box', () => {
  const { s, submit } = prepare();
  s.at('2026-09-28', '09:00');
  const w = submit({ text: 'Поздно' }).data.work;
  assert.deepEqual([w.mine.late, w.mine.attempts[0].late, w.mine.overdue], [true, true, false]);

  const bare = prepare({ files: null });
  const done = bare.submit({ text: 'Только текст' });
  assert.equal(done.ok, true);
  assert.deepEqual(done.data.work.mine.attempts[0].files, []);
  assert.equal(bare.s.call('work.upload', { assignmentId: bare.id, name: 'a.jpg', data: b64(SAMPLE.jpg) }, bare.s.t.a1).error.code, 'files_unavailable');
  assert.equal(bare.submit({ fileIds: ['fl_x'], text: 'x' }).error.code, 'invalid');
});

test('work.mine: my tasks of the current subjects, in order, with the counts', () => {
  const s = setup();
  const { t, call, store, sb2 } = s;
  s.at('2026-09-22', '10:00');
  const A = s.task({ title: 'A', dueAt: '2026-09-23 23:59:00' });
  const B = s.task({ title: 'B', dueAt: '2026-09-30 23:59:00', kind: 'hw', unit: 1 });
  const C = s.task({ title: 'C', dueAt: '2026-09-20 23:59:00' });
  const D = s.task({ title: 'D', dueAt: '2026-09-25 23:59:00' });
  const E = s.task({ title: 'E', dueAt: '2026-09-26 23:59:00' });
  const F = s.task({ title: 'F', dueAt: '2026-09-24 23:59:00', maxPoints: 20 });
  const old = s.task({ title: 'Старое', dueAt: '2026-08-20 23:59:00' });
  const other = s.task({ title: 'Чужое', subjectId: sb2, dueAt: '2026-09-25 23:59:00' });
  s.attempt(D, 'a1', { status: 'returned', comment: 'ещё' });
  s.attempt(E, 'a1', { status: 'submitted' });
  s.attempt(F, 'a1', { status: 'checked', points: 15, comment: 'ok' });
  s.attempt(old, 'a1', { status: 'submitted' });
  s.attempt(A, 'a2', { status: 'checked', points: 3 });
  s.attempt(other, 'b1', { status: 'submitted' });

  const mine = call('work.mine', {}, t.a1).data;
  assert.deepEqual(Object.keys(mine), ['today', 'now', 'counts', 'tasks']);
  assert.deepEqual([mine.today, mine.now], ['2026-09-22', '2026-09-22 10:00:00']);
  assert.deepEqual(mine.counts, { fresh: 2, soon: 1, overdue: 1, returned: 1 });
  assert.deepEqual(mine.tasks.map((x) => [x.title, x.state]), [['D', 'returned'], ['C', 'none'], ['A', 'none'], ['B', 'none'], ['E', 'submitted'], ['F', 'checked']]);
  for (const task of mine.tasks) assert.deepEqual(Object.keys(task), TASK_KEYS);
  const byTitle = Object.fromEntries(mine.tasks.map((x) => [x.title, x]));
  assert.deepEqual([byTitle.C.overdue, byTitle.A.overdue, byTitle.F.points, byTitle.E.points, byTitle.D.points], [true, false, 15, null, null]);
  assert.deepEqual([byTitle.A.subjectName, byTitle.B.kind, byTitle.B.unit, byTitle.F.maxPoints, byTitle.A.subjectId], ['Информатика', 'hw', 1, 20, s.sb1]);

  // the student of the other group sees his own group only; nothing of the first group
  const theirs = call('work.mine', {}, t.b1).data;
  assert.deepEqual(theirs.tasks.map((x) => x.title), ['Чужое']);
  assert.deepEqual(theirs.counts, { fresh: 0, soon: 0, overdue: 0, returned: 0 });
  // a late hand-in shows as late
  s.attempt(C, 'a3', { status: 'submitted', submittedAt: '2026-09-21 10:00:00' });
  assert.deepEqual(call('work.mine', {}, t.a3).data.tasks.find((x) => x.title === 'C'), { ...byTitle.C, state: 'submitted', late: true, overdue: false });

  // staff and no token do not read it; a student who moved takes the tasks of the new group
  for (const token of [t.teacher1, t.dean, t.admin, t.prorector]) assert.equal(call('work.mine', {}, token).error.code, 'forbidden');
  assert.equal(call('work.mine', {}, undefined).error.code, 'unauthorized');
  store.update('students', s.a1, { groupId: s.g2 });
  assert.deepEqual(call('work.mine', {}, t.a1).data.tasks.map((x) => x.title), ['Чужое']);

  // each table once
  s.spy.reset();
  call('work.mine', {}, t.a2);
  assert.ok(Object.values(s.spy.lists).every((n) => n === 1));
  assert.deepEqual(s.spy.writes, {});
});

test('work.mine and work.get show a student only his own', () => {
  const { s, id, upload, submit } = prepare();
  const { t, call, ids, store, sb1 } = s;
  const f = upload(1);
  assert.equal(submit({ text: 'Мой ответ', fileIds: [f] }).ok, true);
  const f2 = upload(2, t.a2);
  assert.equal(submit({ text: 'Чужой ответ', fileIds: [f2] }, t.a2).ok, true);
  s.attempt(id, 'a3', { status: 'checked', points: 4, comment: 'секрет а3', checkedBy: ids.teacher1, checkedAt: '2026-09-22 09:00:00' });
  upload(3, t.a2);                                                         // a pending file of a2
  const other = s.task({ subjectId: s.sb2, title: 'Чужое', dueAt: '2026-09-28 23:59:00' });
  s.attempt(other, 'b1', { text: 'ответ беков' });

  const mine = call('work.mine', {}, t.a1);
  const got = call('work.get', { assignmentId: id }, t.a1);
  assert.equal(mine.ok && got.ok, true);
  const text = JSON.stringify([mine, got]);
  for (const key of ['a2', 'a3', 'a4', 'b1']) {
    assert.equal(text.includes(ids[key]), false, key);
    assert.equal(text.includes(store.get('students', ids[key]).fullName), false, key);
  }
  for (const word of ['Чужой ответ', 'секрет а3', 'ответ беков', f2, 'Чужое', '"students"', '"counts":{"total"', 'checkedBy', 'checkedByName', 'passwordHash', 'cardNo', '"stored"']) {
    assert.equal(text.includes(word), false, word);
  }
  assert.equal(JSON.stringify(got.data).includes('"counts"'), false);
  // the teacher is named by teacherName only, with no id
  assert.equal(text.includes(ids.teacher1), false);
  assert.deepEqual(Object.keys(got.data), ['now', 'assignment', 'mine', 'canSubmit']);
  assert.deepEqual(Object.keys(got.data.assignment), ['id', 'subjectId', 'subjectName', 'teacherName', 'kind', 'unit', 'unitTitle', 'topicName', 'title', 'description', 'dueAt', 'maxPoints']);
  assert.deepEqual(Object.keys(got.data.mine), ['state', 'late', 'overdue', 'points', 'attempts', 'pending']);
  assert.deepEqual(Object.keys(got.data.mine.attempts[0]), ['id', 'n', 'text', 'paper', 'submittedAt', 'late', 'status', 'points', 'comment', 'checkedAt', 'files']);
  assert.deepEqual(Object.keys(got.data.mine.attempts[0].files[0]), ['id', 'name', 'kind', 'size']);
  assert.deepEqual([got.data.assignment.teacherName, got.data.assignment.subjectName, got.data.assignment.subjectId], ['Иванова Нургуль', 'Информатика', sb1]);
  // the pending file of a2 shows to a2 only
  const seen = call('work.get', { assignmentId: id }, t.a2).data.mine;
  assert.equal(seen.pending.length, 1);
  assert.equal(got.data.mine.pending.length, 0);
  assert.equal(JSON.stringify(call('work.get', { assignmentId: id }, t.a3)).includes(f), false);
  // a student of another group: not found, and the same answer for an id that does not exist
  const foreign = call('work.get', { assignmentId: id }, t.b1);
  const missing = call('work.get', { assignmentId: 'as_nope' }, t.b1);
  assert.deepEqual([foreign.ok, foreign.error], [false, { code: 'not_found' }]);
  assert.deepEqual(foreign.error, missing.error);
  for (const bad of [[id], 5, null, undefined, ` ${id} `]) assert.equal(call('work.get', { assignmentId: bad }, t.a1).error.code, 'not_found');
  assert.deepEqual(call('work.mine', {}, t.b1).data.tasks.map((x) => x.title), ['Чужое']);
  // a student who moved to another group loses the assignment
  store.update('students', s.a1, { groupId: s.g2 });
  assert.equal(call('work.get', { assignmentId: id }, t.a1).error.code, 'not_found');
  assert.equal(call('work.submit', { assignmentId: id, text: 'x', fileIds: [] }, t.a1).error.code, 'not_found');
});

test('a removed assignment is gone for the student', () => {
  const { s, id, upload } = prepare();
  const { call, t } = s;
  const f = upload(1);
  assert.equal(call('work.remove', { assignmentId: id }, t.teacher1).ok, true);
  const before = s.snapshot();
  assert.equal(call('work.get', { assignmentId: id }, t.a1).error.code, 'not_found');
  assert.equal(call('work.upload', { assignmentId: id, name: 'a.jpg', data: b64(SAMPLE.jpg) }, t.a1).error.code, 'not_found');
  assert.equal(call('work.submit', { assignmentId: id, text: 'x', fileIds: [f] }, t.a1).error.code, 'not_found');
  assert.equal(call('work.file', { fileId: f }, t.a1).error.code, 'not_found');
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual(call('work.mine', {}, t.a1).data.tasks, []);
});

test('work.get of the student names the topic and the unit of the assignment', () => {
  const s = setup();
  s.at('2026-09-22', '10:00');
  const topic = s.store.list('topics').find((x) => x.unit === 2 && x.lessonKind === 'practice');
  const id = s.task({ kind: 'hw', unit: topic.unit, topicId: topic.id, description: 'Прочитать' });
  const view = s.call('work.get', { assignmentId: id }, s.t.a1).data;
  assert.deepEqual([view.assignment.topicName, view.assignment.unit, view.assignment.description, view.now], [topic.name, 2, 'Прочитать', '2026-09-22 10:00:00']);
  assert.deepEqual([view.mine.state, view.mine.attempts, view.mine.pending, view.canSubmit], ['none', [], [], true]);
});

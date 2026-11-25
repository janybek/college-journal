import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, A } from './syllabusSetup.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';
import { SAMPLE, FAKE, b64 } from './fakes/sampleFiles.js';
import { FILE_LIMITS } from '../core/files.js';

const code = (r) => r.error && r.error.code;
const env = () => {
  const s = setup({ files: createMemoryFiles() });
  const { call, store, files, draft, sb1, teacher1 } = s;
  const id = draft(sb1, 1, teacher1);
  const attach = (data, token = teacher1) => call('syllabus.attachFile', { syllabusId: id, name: 'Силлабус.pdf', data: b64(SAMPLE.pdf), ...data }, token);
  const state = () => JSON.stringify([store.list('syllabi'), store.list('files'), files.names()]);
  const read = (token, syllabusId = id) => call('syllabus.file', { syllabusId }, token);
  return { ...s, id, attach, state, read };
};

test('attach: every refusal writes nothing, the good one writes the row, the box and the version', () => {
  const { call, store, files, staff, id, attach, state, teacher1, teacher2, prorector, s1 } = env();
  const before = state();
  assert.equal(attach({}, teacher2).error.code, 'forbidden');
  for (const [token, c] of [[prorector, 'forbidden'], [s1, 'forbidden'], [null, 'unauthorized']]) assert.equal(code(attach({}, token)), c);
  for (const bad of [[id], 7, ` ${id} `, null]) assert.equal(attach({ syllabusId: bad }).error.code, 'bad_request');
  assert.equal(attach({ syllabusId: 'sy_missing' }).error.code, 'not_found');
  for (const [name, bytes, c] of [['a.xlsx', SAMPLE.xlsx, 'bad_type'], ['a.pptx', SAMPLE.pptx, 'bad_type'], ['a.jpg', SAMPLE.jpg, 'bad_type'], ['a.exe', FAKE.exe, 'bad_type'],
    ['a.pdf', FAKE.exe, 'bad_file'], ['a.pdf', FAKE.html, 'bad_file'], ['a.pdf', SAMPLE.docx, 'bad_file'], ['a.docx', SAMPLE.xlsx, 'bad_file'],
    ['a.docx', FAKE.zip, 'bad_file'], ['a.docx', FAKE.docm, 'bad_file'], ['a.doc', FAKE.docMacro, 'bad_file']]) {
    assert.equal(attach({ name, data: b64(bytes) }).error.fields[0].code, c, name);
  }
  assert.equal(attach({ data: 'QUJD\n' }).error.code, 'bad_request');
  assert.deepEqual(attach({ data: '' }).error.fields, [{ field: 'data', code: 'empty' }]);
  assert.deepEqual(attach({ data: 'A'.repeat(13981016) }).error.fields, [{ field: 'data', code: 'too_big' }]);
  assert.equal(state(), before);
  const file = attach({ name: '..\\..\\x/Силлабус‮.pdf', fileId: 'fl_any' }).data.file;
  assert.deepEqual(file, { name: 'Силлабус.pdf', kind: 'pdf', size: SAMPLE.pdf.length, at: '2026-08-31 12:00:00' });
  const version = store.get('syllabi', id);
  const row = store.get('files', version.fileId);
  assert.deepEqual([row.state, row.assignmentId, row.submissionId, row.ownerId, version.editedBy, version.updated, files.names()],
    ['syllabus', '', '', staff.teacher1, staff.teacher1, '2026-08-31', [row.stored]]);
  assert.deepEqual(call('syllabus.form', { syllabusId: id }, teacher1).data.syllabus.file, file);
});

test('read: who reads a draft, the bytes, the answer shape', () => {
  const { state, attach, read, teacher1, teacher2, dean, prorector, s1, s2 } = env();
  assert.equal(attach({}).ok, true);
  const before = state();
  for (const token of [teacher1, dean]) {
    const file = read(token).data.file;
    assert.deepEqual(Object.keys(file), ['name', 'kind', 'size', 'data']);
    assert.deepEqual(Buffer.from(file.data, 'base64'), Buffer.from(SAMPLE.pdf));
  }
  assert.equal(code(read(prorector)), 'forbidden');
  assert.equal(code(read(s1)), 'not_found');
  assert.equal(code(read(s2)), 'not_found');
  assert.equal(code(read(teacher2)), 'forbidden');
  assert.equal(state(), before);
});

test('replace and drop in a draft', () => {
  const { call, store, files, attach, read, reset, writes, id, teacher1 } = env();
  assert.equal(attach({}).ok, true);
  const firstId = store.get('syllabi', id).fileId;
  assert.equal(attach({ name: 'a.docx', data: b64(SAMPLE.docx) }).ok, true);
  const secondId = store.get('syllabi', id).fileId;
  assert.notEqual(secondId, firstId);
  assert.equal(store.get('files', firstId).state, 'syllabus');
  assert.equal(files.names().length, 2);
  const rows = JSON.stringify(store.list('files'));
  assert.deepEqual(call('syllabus.dropFile', { syllabusId: id }, teacher1).data, { file: null });
  assert.equal(store.get('syllabi', id).fileId, '');
  assert.deepEqual([JSON.stringify(store.list('files')), files.names().length], [rows, 2]);
  reset();
  assert.deepEqual(call('syllabus.dropFile', { syllabusId: id }, teacher1).data, { file: null });
  assert.deepEqual(writes, {});
  assert.equal(code(read(teacher1)), 'not_found');
});

test('statuses: submitted is locked, returned is open again, approved is locked', () => {
  const { call, state, attach, read, fill, id, store, dean, teacher1, prorector } = env();
  attach({});
  const fileId = store.get('syllabi', id).fileId;
  fill(id);
  assert.equal(call('syllabus.submit', { syllabusId: id }, teacher1).ok, true);
  const before = state();
  for (const token of [teacher1, dean]) {
    assert.equal(code(attach({}, token)), 'syllabus_locked');
    assert.equal(code(call('syllabus.dropFile', { syllabusId: id }, token)), 'syllabus_locked');
  }
  assert.equal(state(), before);
  assert.equal(read(prorector).ok, true);
  assert.equal(call('syllabus.return', { syllabusId: id, remark: 'Доработать' }, dean).ok, true);
  assert.equal(store.get('syllabi', id).fileId, fileId);
  assert.equal(attach({ name: 'b.pdf' }).ok, true);
  assert.equal(call('syllabus.submit', { syllabusId: id }, teacher1).ok, true);
  const second = store.get('syllabi', id).fileId;
  assert.equal(call('syllabus.approve', { syllabusId: id }, dean).ok, true);
  assert.equal(store.get('syllabi', id).fileId, second);
  assert.equal(code(attach({})), 'syllabus_locked');
});

test('who reads an approved version', () => {
  const { call, store, id, attach, read, fill, sb1, sb2, draft, pairOf, dean, teacher1, teacher2, prorector, s1, s2 } = env();
  attach({});
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  for (const token of [dean, prorector, teacher1, s1, s2]) assert.equal(read(token).ok, true);
  assert.equal(code(read(teacher2)), 'forbidden');
  const pair = pairOf(sb1, '2026-09-08');
  assert.equal(call('schedule.changePair', { id: pair.id, teacherId: store.list('staff').find((x) => x.login === 'teacher2').id }, dean).ok, true);
  assert.equal(read(teacher2).ok, true);

  const own = draft(sb2, 1, teacher2);
  call('syllabus.attachFile', { syllabusId: own, name: 'a.pdf', data: b64(SAMPLE.pdf) }, teacher2);
  fill(own);
  call('syllabus.submit', { syllabusId: own }, teacher2);
  call('syllabus.approve', { syllabusId: own }, dean);
  assert.equal(read(s2, own).ok, true);
  assert.equal(code(read(s1, own)), 'not_found');
});

test('the new draft copies the file, review hides the approved one from students, archive is closed', () => {
  const { call, store, id, attach, read, fill, sb1, draft, dean, teacher1, s1 } = env();
  attach({});
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  const approvedFile = store.get('syllabi', id).fileId;
  const next = draft(sb1, 1, teacher1);
  assert.notEqual(next, id);
  assert.equal(store.get('syllabi', next).fileId, approvedFile);
  assert.equal(call('syllabus.attachFile', { syllabusId: next, name: 'n.docx', data: b64(SAMPLE.docx) }, teacher1).ok, true);
  assert.equal(store.get('syllabi', id).fileId, approvedFile);
  assert.equal(call('syllabus.dropFile', { syllabusId: next }, teacher1).ok, true);
  assert.equal(store.get('syllabi', next).fileId, '');
  assert.equal(store.get('syllabi', id).fileId, approvedFile);
  assert.deepEqual(Buffer.from(read(s1).data.file.data, 'base64'), Buffer.from(SAMPLE.pdf));
  assert.equal(call('syllabus.attachFile', { syllabusId: next, name: 'n.docx', data: b64(SAMPLE.docx) }, teacher1).ok, true);
  const newFile = store.get('syllabi', next).fileId;
  fill(next);
  call('syllabus.submit', { syllabusId: next }, teacher1);
  assert.equal(code(read(s1)), 'not_found');
  assert.equal(read(dean).ok, true);
  assert.equal(read(dean, next).ok, true);
  assert.equal(call('syllabus.approve', { syllabusId: next }, dean).ok, true);
  assert.equal(store.get('syllabi', id).status, 'archived');
  assert.equal(store.get('syllabi', id).fileId, approvedFile);
  assert.equal(code(read(dean)), 'forbidden');
  assert.equal(store.get('syllabi', next).fileId, newFile);
  assert.equal(read(dean, next).ok, true);
});

test('«fill from a file» does not touch the file id; a key with only an approved version gets a draft with the same file', () => {
  const { call, store, id, attach, fill, send, sb1, sb3, dean, teacher1 } = env();
  attach({});
  const fileId = store.get('syllabi', id).fileId;
  assert.equal(send('syllabus.apply', sb1, A, teacher1).ok, true);
  assert.equal(store.get('syllabi', id).fileId, fileId);
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  assert.equal(send('syllabus.apply', sb3, A, teacher1).ok, true);
  const draftRow = store.list('syllabi').find((v) => v.status === 'draft');
  assert.ok(draftRow);
  assert.equal(draftRow.fileId, fileId);
});

test('the number does not move: work.file and work.dropFile do not see it; broken links are file_missing', () => {
  const { call, store, id, attach, read, dean, teacher1, s1 } = env();
  attach({});
  const fileId = store.get('syllabi', id).fileId;
  for (const token of [teacher1, dean, s1]) assert.equal(code(call('work.file', { fileId }, token)), 'not_found');
  assert.equal(code(call('work.dropFile', { fileId }, s1)), 'not_found');
  const row = store.get('files', fileId);
  store.update('files', fileId, { state: 'attached' });
  assert.equal(code(read(teacher1)), 'file_missing');
  store.update('files', fileId, { state: 'syllabus' });
  store.update('syllabi', id, { fileId: 'fl_nowhere' });
  assert.equal(code(read(teacher1)), 'file_missing');
  store.update('syllabi', id, { fileId });
  assert.equal(read(teacher1).ok, true);
  store.update('files', fileId, { stored: '0'.repeat(32) + '.bin' });
  assert.equal(code(read(teacher1)), 'file_missing');
  store.update('files', fileId, { stored: row.stored });
  assert.equal(read(teacher1).ok, true);
});

test('the daily limit counts the rows of every state of the person', () => {
  const { store, staff, state, attach, dean } = env();
  const row = (over) => store.insert('files', { assignmentId: '', submissionId: '', ownerId: staff.teacher1, state: 'syllabus', name: 'x.pdf', kind: 'pdf', size: 1, stored: '', at: '2026-08-31 09:00:00', ...over });
  for (let i = 0; i < FILE_LIMITS.perDayCount; i++) row({});
  const before = state();
  assert.equal(code(attach({})), 'upload_limit');
  assert.equal(state(), before);
  assert.equal(attach({}, dean).ok, true);

  const t = env();
  const big = (over) => t.store.insert('files', { assignmentId: '', submissionId: '', ownerId: t.staff.teacher1, state: 'syllabus', name: 'x.pdf', kind: 'pdf', size: 100 * 1024 * 1024, stored: '', at: '2026-08-31 09:00:00', ...over });
  const ten = { name: 'big.pdf', data: b64(Buffer.concat([Buffer.from(SAMPLE.pdf), Buffer.alloc(FILE_LIMITS.maxBytes - SAMPLE.pdf.length, 0x20)])) };
  big({});
  big({ at: '2026-08-30 09:00:00' });
  assert.equal(t.attach(ten).ok, true);
  const u = env();
  for (let i = 0; i < 3; i++) u.store.insert('files', { assignmentId: '', submissionId: '', ownerId: u.staff.teacher1, state: i === 0 ? 'attached' : 'syllabus', name: 'x.pdf', kind: 'pdf', size: 100 * 1024 * 1024, stored: '', at: '2026-08-31 09:00:00' });
  const rows = u.state();
  assert.equal(code(u.attach(ten)), 'upload_limit');
  assert.equal(u.state(), rows);
});

test('without a file box the three actions answer files_unavailable; the form and the page work', () => {
  const s = setup();
  const { call, draft, sb1, teacher1, s1, dean, fill } = s;
  const id = draft(sb1, 1, teacher1);
  for (const [action, token] of [['syllabus.attachFile', teacher1], ['syllabus.dropFile', teacher1], ['syllabus.file', teacher1], ['syllabus.file', s1]]) {
    assert.equal(code(call(action, { syllabusId: id, name: 'a.pdf', data: b64(SAMPLE.pdf) }, token)), 'files_unavailable', action);
  }
  assert.equal(call('syllabus.form', { syllabusId: id }, teacher1).data.syllabus.file, null);
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  assert.equal(call('syllabus.get', { subjectId: sb1 }, s1).data.syllabus.file, null);
});

test('the page: id and file for the student; no stored name or owner in the answers', () => {
  const { call, id, attach, fill, store, sb1, dean, teacher1, s1 } = env();
  const attached = attach({});
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  const page = call('syllabus.get', { subjectId: sb1 }, s1);
  assert.equal(page.data.syllabus.id, id);
  assert.deepEqual(page.data.syllabus.file, attached.data.file);
  assert.equal(Object.keys(page.data.syllabus)[0], 'id');
  assert.equal(Object.keys(page.data.syllabus).at(-1), 'file');
  const stored = store.get('files', store.get('syllabi', id).fileId).stored;
  const form = call('syllabus.form', { syllabusId: id }, dean);
  assert.equal(Object.keys(form.data.syllabus).at(-1), 'file');
  for (const answer of [page, form, attached]) {
    const text = JSON.stringify(answer);
    assert.equal(text.includes(stored), false);
    assert.equal(text.includes('"ownerId"'), false);
    assert.equal(text.includes('"stored"'), false);
  }
});

test('reads and writes', () => {
  const { call, store, id, attach, read, fill, reset, lists, writes, sb1, pairOf, dean, teacher1, teacher2, s1 } = env();
  reset();
  assert.equal(attach({}).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1, files: 1 });
  assert.deepEqual(writes, { 'insertMany:files': 1, 'updateMany:syllabi': 1 });
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  reset();
  assert.equal(read(s1).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1, files: 1 });
  assert.deepEqual(writes, {});
  reset();
  assert.equal(read(teacher1).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1, files: 1 });
  const teacherId = store.list('staff').find((x) => x.login === 'teacher2').id;
  assert.equal(call('schedule.changePair', { id: pairOf(sb1, '2026-09-08').id, teacherId }, dean).ok, true);
  reset();
  assert.equal(read(teacher2).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1, pairs: 1, files: 1 });
  assert.deepEqual(writes, {});
});

test('reads of the form and the page grow only by files, and only with a file', () => {
  const { call, id, attach, fill, reset, lists, sb1, dean, teacher1, s1 } = env();
  fill(id);
  reset();
  call('syllabus.form', { syllabusId: id }, teacher1);
  const without = { ...lists };
  assert.equal(without.files, undefined);
  attach({});
  reset();
  call('syllabus.form', { syllabusId: id }, teacher1);
  assert.deepEqual(lists, { ...without, files: 1 });
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);
  reset();
  call('syllabus.get', { subjectId: sb1 }, s1);
  assert.equal(lists.files, 1);
});

test('rights on a returned version, an archived one and the version of another teacher of the discipline', () => {
  const { call, store, state, id, attach, read, fill, sb1, draft, dean, teacher1, teacher2, s1 } = env();
  // returned: the student does not read it
  attach({});
  fill(id);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  assert.equal(call('syllabus.return', { syllabusId: id, remark: 'Доработать' }, dean).ok, true);
  let before = state();
  assert.equal(code(read(s1)), 'not_found');
  assert.equal(state(), before);
  call('syllabus.submit', { syllabusId: id }, teacher1);
  call('syllabus.approve', { syllabusId: id }, dean);

  // archived: attach, drop and read are refused
  const next = draft(sb1, 1, teacher1);
  fill(next);
  call('syllabus.submit', { syllabusId: next }, teacher1);
  assert.equal(call('syllabus.approve', { syllabusId: next }, dean).ok, true);
  assert.equal(store.get('syllabi', id).status, 'archived');
  before = state();
  for (const token of [teacher1, dean]) {
    assert.equal(code(attach({ syllabusId: id }, token)), 'forbidden');
    assert.equal(code(call('syllabus.dropFile', { syllabusId: id }, token)), 'forbidden');
    assert.equal(code(read(token, id)), 'forbidden');
  }
  assert.equal(state(), before);

  // another teacher of the same discipline: a student of a group led by the other one does not read this file
  const ds1 = store.get('syllabi', id).disciplineId;
  const g3 = store.insert('groups', { name: '03-1', course: 1 }).id;
  const t2 = store.list('staff').find((x) => x.login === 'teacher2').id;
  const sb4 = store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g3, teacherId: t2, scheme: 'A' }).id;
  store.insert('students', { fullName: 's3', groupId: g3, cardNo: 's3', passwordHash: store.get('students', store.list('students')[0].id).passwordHash, lang: 'ky', mustChangePassword: false, active: true });
  const s3 = call('auth.login', { login: 's3', password: 'secret12' }, undefined).data.token;
  const other = draft(sb4, 1, teacher2);
  call('syllabus.attachFile', { syllabusId: other, name: 'o.pdf', data: b64(SAMPLE.pdf) }, teacher2);
  fill(other);
  call('syllabus.submit', { syllabusId: other }, teacher2);
  assert.equal(call('syllabus.approve', { syllabusId: other }, dean).ok, true);
  before = state();
  assert.equal(read(s3, other).ok, true);
  assert.equal(code(read(s3, next)), 'not_found');
  assert.equal(code(read(s1, other)), 'not_found');
  assert.equal(state(), before);
});

test('a student cannot hand in the id of a syllabus file as a work file; dropFile reads each table at most once', () => {
  const { call, store, id, attach, state, reset, lists, writes, sb1, teacher1, s1 } = env();
  attach({});
  const fileId = store.get('syllabi', id).fileId;
  const assignment = store.insert('assignments', { subjectId: sb1, kind: 'hw', title: 'Task', dueAt: '2026-12-01 23:59:00', maxPoints: 5 });
  const before = state();
  const rows = JSON.stringify(store.list('submissions'));
  const answer = call('work.submit', { assignmentId: assignment.id, text: 'done', fileIds: [fileId] }, s1);
  assert.equal(code(answer), 'invalid');
  assert.deepEqual(answer.error.fields, [{ field: 'fileIds', index: 0, code: 'bad_ref' }]);
  assert.equal(state(), before);
  assert.equal(JSON.stringify(store.list('submissions')), rows);

  reset();
  assert.equal(call('syllabus.dropFile', { syllabusId: id }, teacher1).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1 });
  assert.deepEqual(writes, { 'updateMany:syllabi': 1 });
  reset();
  assert.equal(call('syllabus.dropFile', { syllabusId: id }, teacher1).ok, true);
  assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, syllabusMembers: 1 });
  assert.deepEqual(writes, {});
});

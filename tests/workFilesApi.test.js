import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { WORK_TABLES } from '../backend/workData.js';
import { FILE_LIMITS } from '../core/files.js';
import { SAMPLE, FAKE, b64 } from './fakes/sampleFiles.js';

// Files of a student: upload, drop, read. Fictional people only.
const prepare = (options) => {
  const s = setup(options);
  s.at('2026-09-22', '10:00');
  const id = s.task({ dueAt: '2026-09-27 23:59:00' });
  const up = (data, token = s.t.a1) => s.call('work.upload', { assignmentId: id, name: 'scan.pdf', data: b64(SAMPLE.pdf), ...data }, token);
  return { s, id, up };
};
// a row of "Files" written straight into the store
const row = (s, over) => s.store.insert('files', {
  assignmentId: '', submissionId: '', ownerId: s.a1, state: 'dropped', name: 'старый.pdf', kind: 'pdf', size: 100, stored: 'a'.repeat(32) + '.bin', at: '2026-09-22 09:00:00', ...over,
}).id;

test('work.upload: every refusal writes nothing, neither in the tables nor on the disk', () => {
  const { s, id, up } = prepare();
  const { t, store, files, snapshot, call } = s;
  const before = snapshot();
  assert.equal(up({}, t.b1).error.code, 'not_found');                         // another group
  for (const bad of [[id], 5, null, undefined, ` ${id} `, 'as_nope']) assert.equal(up({ assignmentId: bad }).error.code, 'not_found');
  for (const [name, data, code] of [['evil.exe', SAMPLE.pdf, 'bad_type'], ['photo.jpg', FAKE.exe, 'bad_file'], ['pic.png', FAKE.svg, 'bad_file'],
    ['page.pdf', FAKE.html, 'bad_file'], ['a.docx', FAKE.zip, 'bad_file'], ['a.docx', FAKE.docm, 'bad_file'], ['a.doc', FAKE.docMacro, 'bad_file'], ['a.png', SAMPLE.jpg, 'bad_file']]) {
    const answer = up({ name, data: b64(data) });
    assert.equal(answer.error.code, 'invalid', name);
    assert.equal(answer.error.fields[0].code, code, name);
  }
  assert.deepEqual(up({ name: 'evil.exe' }).error.fields, [{ field: 'name', code: 'bad_type' }]);
  assert.deepEqual(up({ name: 'noext' }).error.fields, [{ field: 'name', code: 'bad_type' }]);
  assert.deepEqual(up({ name: 7 }).error.fields, [{ field: 'name', code: 'bad_type' }]);
  assert.equal(up({ data: 'QUJD\n' }).error.code, 'bad_request');
  assert.equal(up({ data: 5 }).error.code, 'bad_request');
  assert.equal(up({ data: undefined }).error.code, 'bad_request');
  assert.deepEqual(up({ data: '' }).error.fields, [{ field: 'data', code: 'empty' }]);
  assert.deepEqual(up({ data: 'A'.repeat(13981016) }).error.fields, [{ field: 'data', code: 'too_big' }]);
  for (const token of [t.teacher1, t.dean, t.admin, null]) assert.notEqual(up({}, token).ok, true);
  assert.equal(up({}, t.dean).error.code, 'forbidden');
  assert.equal(up({}, null).error.code, 'unauthorized');
  assert.deepEqual(snapshot(), before);

  // a checked work takes nothing more, before any other check of the file
  s.attempt(id, 'a2', { status: 'checked', points: 7 });
  const checked = snapshot();
  assert.equal(up({}, t.a2).error.code, 'already_checked');
  assert.equal(up({ name: 'evil.exe' }, t.a2).error.code, 'already_checked');
  assert.deepEqual(snapshot(), checked);
  // a student of another group is not told anything about this assignment
  assert.equal(call('work.upload', { assignmentId: id, name: 'a.pdf', data: b64(SAMPLE.pdf) }, t.b1).error.code, 'not_found');
  assert.equal(files.names().length, 0);
  assert.equal(store.list('files').length, 0);
});

test('work.upload: a clean file is stored under a random name, the name of the student only as text', () => {
  const { s, id, up } = prepare();
  const { store, files, a1, spy } = s;
  spy.reset();
  const answer = up({ name: '..\\..\\x/Скан‮.pdf' });
  assert.equal(answer.ok, true);
  const f = answer.data.file;
  assert.deepEqual(Object.keys(f).sort(), ['id', 'kind', 'name', 'size']);
  assert.deepEqual([f.name, f.kind, f.size], ['Скан.pdf', 'pdf', SAMPLE.pdf.length]);
  const stored = store.get('files', f.id);
  assert.match(stored.stored, /^[0-9a-f]{32}\.bin$/);
  assert.equal(stored.stored.includes('Скан'), false);
  assert.deepEqual([stored.state, stored.ownerId, stored.assignmentId, stored.submissionId, stored.at, files.names()],
    ['pending', a1, id, '', '2026-09-22 10:00:00', [stored.stored]]);
  assert.deepEqual(Object.values(files.read(stored.stored)), Object.values(SAMPLE.pdf));
  assert.deepEqual(spy.writes, { 'insertMany:files': 1 });
  assert.deepEqual(Object.keys(spy.lists).sort(), [...WORK_TABLES].sort());
  assert.ok(Object.values(spy.lists).every((n) => n === 1));
  // every kind goes in under its own name; a second file gets a second name
  for (const [kind, ext] of [['jpg', 'jpg'], ['jpg', 'JPEG'], ['png', 'png']]) {
    const next = up({ name: `p.${ext}`, data: b64(SAMPLE[kind]) }, s.t.a2);
    assert.equal(next.data.file.kind, kind);
  }
  assert.equal(new Set(files.names()).size, 4);
});

test('work.upload: five files at most; an old pending file does not count; no box -> files_unavailable', () => {
  const { s, id, up } = prepare();
  const { store, files, a1, snapshot, tick } = s;
  row(s, { state: 'pending', assignmentId: id, at: '2026-09-20 09:00:00', stored: 'b'.repeat(32) + '.bin' });          // older than 24 h
  row(s, { state: 'pending', assignmentId: id, ownerId: s.a2, stored: 'c'.repeat(32) + '.bin' });                      // another student
  row(s, { state: 'pending', assignmentId: s.task({ title: 'другое' }), stored: 'd'.repeat(32) + '.bin' });          // another assignment
  row(s, { state: 'attached', assignmentId: id, stored: 'e'.repeat(32) + '.bin' });
  for (let i = 0; i < 5; i += 1) assert.equal(up({ name: `f${i}.pdf` }).ok, true, `file ${i}`);
  const before = snapshot();
  assert.deepEqual(up({ name: 'sixth.pdf' }).error, { code: 'invalid', fields: [{ field: 'files', code: 'too_many' }] });
  assert.deepEqual(snapshot(), before);
  // a day later the first ones are old: room again
  tick(25 * 3600000);
  assert.equal(up({ name: 'again.pdf' }).ok, true);
  assert.equal(store.list('files').filter((f) => f.ownerId === a1 && f.state === 'pending' && f.assignmentId === id).length, 7);
  assert.ok(files.names().length >= 6);

  const none = prepare({ files: null });
  const wasted = none.s.snapshot();
  assert.equal(none.up({}).error.code, 'files_unavailable');
  assert.equal(none.up({ name: 'evil.exe' }).error.code, 'files_unavailable');
  assert.equal(none.up({}, none.s.t.b1).error.code, 'files_unavailable');
  assert.deepEqual(none.s.snapshot(), wasted);
});

test('work.upload: 60 files or 200 MiB a day by Bishkek time, then again tomorrow', () => {
  const { s, up } = prepare();
  const { snapshot, at, a2 } = s;
  for (let i = 0; i < 59; i += 1) row(s, { at: '2026-09-22 00:00:01' });
  row(s, { at: '2026-09-21 23:59:59' });                      // yesterday: not counted
  row(s, { ownerId: a2 });                                    // someone else: not counted
  assert.equal(up({}).ok, true);                              // the 60th
  const before = snapshot();
  assert.equal(up({}).error.code, 'upload_limit');
  assert.deepEqual(snapshot(), before);
  at('2026-09-23', '10:00');
  assert.equal(up({}).ok, true);

  const big = prepare();
  const room = FILE_LIMITS.perDayBytes - SAMPLE.pdf.length;
  const heavy = row(big.s, { size: room });                  // dropped, but it still counts for the day
  assert.equal(big.up({}).ok, true);                         // exactly 200 MiB: allowed
  const full = big.s.snapshot();
  assert.equal(big.up({}).error.code, 'upload_limit');
  assert.deepEqual(big.s.snapshot(), full);
  big.s.store.update('files', heavy, { size: room + 1 });
  const over = big.s.store.list('files').length;
  assert.equal(big.up({ name: 'b.pdf' }).error.code, 'upload_limit');
  assert.equal(big.s.store.list('files').length, over);
  big.s.at('2026-09-23', '10:00');
  assert.equal(big.up({}).ok, true);
});

test('work.file: who reads which file', () => {
  const { s, id, up } = prepare();
  const { call, t, store, files, a1, g2 } = s;
  const mine = up({}).data.file;
  const bytes = Array.from(SAMPLE.pdf);
  const read = (fileId, token) => call('work.file', { fileId }, token);
  // the owner reads the pending file; the content is the same bytes in base64
  const own = read(mine.id, t.a1);
  assert.deepEqual(own.data, { file: { id: mine.id, name: 'scan.pdf', kind: 'pdf', size: SAMPLE.pdf.length, data: b64(SAMPLE.pdf) } });
  assert.deepEqual(Array.from(Buffer.from(own.data.file.data, 'base64')), bytes);
  const before = s.snapshot();
  // the others: another student of the group, another group, the staff while it is pending, no token
  assert.equal(read(mine.id, t.a2).error.code, 'not_found');
  assert.equal(read(mine.id, t.b1).error.code, 'not_found');
  for (const token of [t.teacher1, t.dean, t.prorector, t.admin, t.teacher2]) assert.equal(read(mine.id, token).error.code, 'not_found');
  assert.equal(read(mine.id, undefined).error.code, 'unauthorized');
  for (const bad of [[mine.id], 5, null, undefined, 'fl_nope', ` ${mine.id} `]) {
    assert.equal(read(bad, t.a1).error.code, 'not_found');
    assert.equal(read(bad, t.teacher1).error.code, 'not_found');
  }
  assert.deepEqual(s.snapshot(), before);

  // after the work is handed in: the teacher of the subject and the office read it, the other teacher does not, the other students do not
  assert.equal(call('work.submit', { assignmentId: id, text: 'ответ', fileIds: [mine.id] }, t.a1).ok, true);
  for (const token of [t.teacher1, t.dean, t.prorector, t.admin]) assert.equal(read(mine.id, token).data.file.data, b64(SAMPLE.pdf));
  assert.equal(read(mine.id, t.teacher2).error.code, 'forbidden');
  assert.equal(read(mine.id, t.teacher3).error.code, 'forbidden');
  assert.equal(read(mine.id, t.a2).error.code, 'not_found');
  assert.equal(read(mine.id, t.b1).error.code, 'not_found');
  assert.equal(read(mine.id, t.a1).ok, true);

  // a dropped file is nobody's, not even the owner's
  const spare = up({ name: 'spare.pdf' }).data.file;
  assert.equal(call('work.dropFile', { fileId: spare.id }, t.a1).ok, true);
  for (const token of [t.a1, t.teacher1, t.dean, t.admin]) assert.equal(read(spare.id, token).error.code, 'not_found');

  // a student who moved to another group loses the file
  store.update('students', a1, { groupId: g2 });
  assert.equal(read(mine.id, t.a1).error.code, 'not_found');
  store.update('students', a1, { groupId: s.g1 });
  assert.equal(read(mine.id, t.a1).ok, true);

  // the file is gone from the disk, or the row is not what it claims
  const stored = store.get('files', mine.id).stored;
  const kept = files.read(stored);
  files.put(stored, new Uint8Array([1]));
  assert.equal(read(mine.id, t.a1).ok, true);
  store.update('files', mine.id, { stored: 'f'.repeat(32) + '.bin' });
  assert.equal(read(mine.id, t.a1).error.code, 'file_missing');
  assert.equal(read(mine.id, t.teacher1).error.code, 'file_missing');
  store.update('files', mine.id, { stored: '../../secret.key' });
  assert.equal(read(mine.id, t.a1).error.code, 'file_missing');
  store.update('files', mine.id, { stored, kind: 'exe' });
  assert.equal(read(mine.id, t.a1).error.code, 'file_missing');
  store.update('files', mine.id, { kind: 'pdf' });
  files.put(stored, kept);
  assert.equal(read(mine.id, t.a1).data.file.data, b64(SAMPLE.pdf));
});

test('work.file: without the box -> files_unavailable', () => {
  const { s, id } = prepare({ files: null });
  const fileId = row(s, { state: 'attached', assignmentId: id });
  for (const token of [s.t.a1, s.t.teacher1, s.t.dean]) assert.equal(s.call('work.file', { fileId }, token).error.code, 'files_unavailable');
  assert.equal(s.call('work.file', { fileId: 'fl_nope' }, s.t.a1).error.code, 'files_unavailable');
});

test('work.dropFile: only the own pending file; the disk keeps it', () => {
  const { s, id, up } = prepare();
  const { call, t, store, files, snapshot } = s;
  const f = up({}).data.file;
  const attachedRow = row(s, { state: 'attached', assignmentId: id, stored: 'a'.repeat(32) + '.bin' });
  const droppedRow = row(s, { state: 'dropped', assignmentId: id, stored: 'b'.repeat(32) + '.bin' });
  const before = snapshot();
  for (const [fileId, token] of [[f.id, t.a2], [f.id, t.b1], [f.id, t.teacher1], [f.id, t.dean], [attachedRow, t.a1], [droppedRow, t.a1], ['fl_nope', t.a1], [[f.id], t.a1], [5, t.a1], [undefined, t.a1]]) {
    const answer = call('work.dropFile', { fileId }, token);
    assert.notEqual(answer.ok, true);
  }
  assert.equal(call('work.dropFile', { fileId: f.id }, t.a2).error.code, 'not_found');
  assert.equal(call('work.dropFile', { fileId: f.id }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('work.dropFile', { fileId: attachedRow }, t.a1).error.code, 'not_found');
  assert.equal(call('work.dropFile', { fileId: [f.id] }, t.a1).error.code, 'not_found');
  assert.deepEqual(snapshot(), before);

  s.spy.reset();
  assert.deepEqual(call('work.dropFile', { fileId: f.id }, t.a1).data, {});
  assert.deepEqual(s.spy.writes, { 'updateMany:files': 1 });
  assert.equal(store.get('files', f.id).state, 'dropped');
  assert.deepEqual(files.names(), before.disk);
  assert.equal(call('work.dropFile', { fileId: f.id }, t.a1).error.code, 'not_found');
});

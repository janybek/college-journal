import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const ctx = { store, platform };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const addStaff = (login, roles) => store.insert('staff', {
    fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
    roles, lang: 'ky', mustChangePassword: false, active: true,
  });
  const tokenOf = (login) => call('auth.login', { login, password: 'secret12' }).data.token;
  const adminRow = addStaff('admin', 'admin');
  const deanRow = addStaff('dean', 'dean,teacher');
  const teacherRow = addStaff('teacher', 'teacher');
  const group = store.insert('groups', { name: '01-1', course: 1 });
  return {
    store, call, group, adminRow, deanRow, teacherRow,
    admin: tokenOf('admin'), dean: tokenOf('dean'), teacher: tokenOf('teacher'),
  };
}

test('students: create, duplicate card, edit keeps the hash', () => {
  const { call, group, dean } = setup();
  const groupId = group.id;
  const made = call('dir.save', { table: 'students', row: { fullName: 'Асанов Азамат', cardNo: 'S2001', groupId } }, dean).data;
  assert.match(made.tempPassword, /^[a-z2-9]{8}$/);
  assert.equal('passwordHash' in made.row, false);
  assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).data.user.mustChangePassword, true);
  assert.deepEqual(call('dir.save', { table: 'students', row: { fullName: 'Б', cardNo: 's2001', groupId } }, dean).error,
    { code: 'invalid', fields: [{ field: 'cardNo', code: 'duplicate' }] });
  const edited = call('dir.save', { table: 'students', row: { id: made.row.id, fullName: 'Асанов А.', passwordHash: 'взлом' } }, dean).data;
  assert.equal(edited.tempPassword, undefined);
  assert.equal(edited.row.fullName, 'Асанов А.');
  assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).ok, true);
});

test('save: unknown id, forbidden tables, incoming id ignored on create', () => {
  const { call, dean, admin } = setup();
  assert.deepEqual(call('dir.save', { table: 'rooms', row: { id: 'nope', name: 'A1' } }, dean).error, { code: 'not_found' });
  assert.deepEqual(call('dir.save', { table: 'staff', row: { fullName: 'В', login: 'vvv', roles: 'teacher' } }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.list', { table: 'settings' }, admin).error, { code: 'forbidden' });
  const room = call('dir.save', { table: 'rooms', row: { name: 'A1' } }, dean).data.row;
  assert.deepEqual(call('dir.save', { table: 'rooms', row: { name: 'A1' } }, dean).error,
    { code: 'invalid', fields: [{ field: 'name', code: 'duplicate' }] });
  assert.equal(call('dir.save', { table: 'rooms', row: { id: room.id, name: 'A2' } }, dean).data.row.name, 'A2');
});

test('staff: admin creates, last admin cannot be demoted', () => {
  const { call, admin, adminRow } = setup();
  const made = call('dir.save', { table: 'staff', row: { fullName: 'В', login: 'vvv', roles: 'teacher' } }, admin).data;
  assert.match(made.tempPassword, /^[a-z2-9]{8}$/);
  assert.equal(made.row.mustChangePassword, true);
  assert.equal(call('auth.login', { login: 'vvv', password: made.tempPassword }).ok, true);
  assert.deepEqual(call('dir.save', { table: 'staff', row: { id: adminRow.id, roles: 'teacher' } }, admin).error,
    { code: 'invalid', fields: [{ field: 'roles', code: 'last_admin' }] });
});

test('remove: in_use, self, unknown, ok', () => {
  const { call, store, group, admin, dean, adminRow, teacherRow } = setup();
  const student = store.insert('students', { fullName: 'a', cardNo: 'c1', groupId: group.id, passwordHash: 'x', active: true });
  assert.deepEqual(call('dir.remove', { table: 'groups', id: group.id }, dean).error, { code: 'in_use' });
  store.remove('students', student.id);
  assert.deepEqual(call('dir.remove', { table: 'staff', id: adminRow.id }, admin).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.remove', { table: 'rooms', id: 'nope' }, dean).error, { code: 'not_found' });
  store.insert('subjects', { name: 'Math', teacherId: teacherRow.id, groupId: group.id, scheme: 'A' });
  assert.deepEqual(call('dir.remove', { table: 'groups', id: group.id }, dean).error, { code: 'in_use' });
  assert.deepEqual(call('dir.remove', { table: 'staff', id: teacherRow.id }, admin).error, { code: 'in_use' });
  const room = call('dir.save', { table: 'rooms', row: { name: 'A1' } }, dean).data.row;
  assert.deepEqual(call('dir.remove', { table: 'rooms', id: room.id }, dean).data, {});
  assert.equal(store.get('rooms', room.id), null);
});

test('resetPassword', () => {
  const { call, group, dean, teacherRow } = setup();
  const made = call('dir.save', { table: 'students', row: { fullName: 'А', cardNo: 'S2001', groupId: group.id } }, dean).data;
  const reset = call('dir.resetPassword', { table: 'students', id: made.row.id }, dean).data;
  assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).ok, false);
  assert.equal(call('auth.login', { login: 'S2001', password: reset.tempPassword }).data.user.mustChangePassword, true);
  assert.deepEqual(call('dir.resetPassword', { table: 'staff', id: teacherRow.id }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.resetPassword', { table: 'students', id: 'nope' }, dean).error, { code: 'not_found' });
});

test('resetPassword by admin for staff', () => {
  const { call, admin, teacherRow } = setup();
  const reset = call('dir.resetPassword', { table: 'staff', id: teacherRow.id }, admin).data;
  assert.equal(call('auth.login', { login: 'teacher', password: reset.tempPassword }).data.user.mustChangePassword, true);
  assert.deepEqual(call('dir.resetPassword', { table: 'rooms', id: 'x' }, admin).error, { code: 'forbidden' });
});

test('temporary passwords are stored with the temporary scrypt strength, a changed password with the own one', () => {
  const { call, store, admin, teacherRow } = setup();
  const reset = call('dir.resetPassword', { table: 'staff', id: teacherRow.id }, admin).data;
  assert.match(store.get('staff', teacherRow.id).passwordHash, /^v2\$12\$8\$1\$/);
  const token = call('auth.login', { login: 'teacher', password: reset.tempPassword }).data.token;
  const changed = call('auth.changePassword', { oldPassword: reset.tempPassword, newPassword: 'new-secret-1' }, token);
  assert.equal(changed.ok, true);
  assert.match(store.get('staff', teacherRow.id).passwordHash, /^v2\$14\$8\$1\$/);
});

test('list never exposes passwordHash', () => {
  const { call, teacher, admin } = setup();
  const rows = call('dir.list', { table: 'staff' }, admin).data.rows;
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => !('passwordHash' in r)), true);
  assert.deepEqual(call('dir.list', { table: 'staff' }, teacher).error, { code: 'forbidden' });
});

test('teacher.mySubjects counts active students only', () => {
  const { call, store, group, teacher, dean, teacherRow } = setup();
  store.insert('subjects', { name: 'Math', teacherId: teacherRow.id, groupId: group.id, scheme: 'A' });
  store.insert('students', { fullName: 'a', cardNo: 'c1', groupId: group.id, passwordHash: 'x', active: true });
  store.insert('students', { fullName: 'b', cardNo: 'c2', groupId: group.id, passwordHash: 'x', active: false });
  const subjects = call('teacher.mySubjects', {}, teacher).data.subjects;
  assert.equal(subjects.length, 1);
  assert.deepEqual({ ...subjects[0], id: undefined },
    { id: undefined, name: 'Math', groupId: group.id, groupName: '01-1', studentCount: 1, syllabus: { approved: false, open: null } });
  assert.deepEqual(call('teacher.mySubjects', {}, dean).data.subjects, []);
});

test('i18n.overrides is public and returns key/ky/ru/en', () => {
  const { call, store } = setup();
  assert.deepEqual(call('i18n.overrides', {}).data, { rows: [] });
  store.insert('translations', { key: 'k', ky: 'a', ru: 'b', en: 'c' });
  assert.deepEqual(call('i18n.overrides', {}).data, { rows: [{ key: 'k', ky: 'a', ru: 'b', en: 'c' }] });
});

test('remove: marks, unit results and the change log keep students, staff and subjects', () => {
  const { call, store, group, admin, teacherRow } = setup();
  const mk = (n) => store.insert('students', { fullName: n, cardNo: n, groupId: group.id, passwordHash: 'x', active: true });
  const mkStaff = (n) => store.insert('staff', { fullName: n, login: n, passwordHash: 'x', roles: 'dean', active: true });
  const st = mk('c1');
  const st2 = mk('c2');
  const free = store.insert('subjects', { name: 'Free', teacherId: 'nobody', groupId: 'nogroup', scheme: 'A' });
  store.insert('attendance', { pairId: 'p_x', studentId: st.id, status: 'present', markedBy: teacherRow.id });
  assert.equal(call('dir.remove', { table: 'students', id: st.id }, admin).error.code, 'in_use');
  assert.equal(call('dir.remove', { table: 'staff', id: teacherRow.id }, admin).error.code, 'in_use');
  const dean2 = mkStaff('d2');
  const dean3 = mkStaff('d3');
  store.insert('changeLog', { actorId: dean2.id, entity: 'unit', field: 'control', studentId: st2.id });
  assert.equal(call('dir.remove', { table: 'staff', id: dean2.id }, admin).error.code, 'in_use');
  assert.equal(call('dir.remove', { table: 'students', id: st2.id }, admin).error.code, 'in_use');
  store.insert('unitResults', { subjectId: free.id, studentId: 'st_x', unit: 1, control: 30, updatedBy: dean3.id });
  assert.equal(call('dir.remove', { table: 'subjects', id: free.id }, admin).error.code, 'in_use');
  assert.equal(call('dir.remove', { table: 'staff', id: dean3.id }, admin).error.code, 'in_use');
  const st3 = mk('c3');
  store.insert('checkins', { pairId: 'p_x', studentId: st3.id, device: 'a'.repeat(32), way: 'code', result: 'wrong', at: '2026-09-22 07:58:00' });
  assert.equal(call('dir.remove', { table: 'students', id: st3.id }, admin).error.code, 'in_use');
  const clean = mk('c3');
  assert.deepEqual(call('dir.remove', { table: 'students', id: clean.id }, admin).data, {});
});

test('remove: assignments, submissions and files keep students, staff and subjects', () => {
  const { call, store, group, admin, teacherRow } = setup();
  const mkStudent = (n) => store.insert('students', { fullName: n, cardNo: n, groupId: group.id, passwordHash: 'x', active: true });
  const mkStaff = (n) => store.insert('staff', { fullName: n, login: n, passwordHash: 'x', roles: 'dean', active: true });
  const gone = (table, row) => call('dir.remove', { table, id: row.id }, admin);
  const bySubmission = mkStudent('w1');
  store.insert('submissions', { assignmentId: 'as_x', studentId: bySubmission.id, n: 1, status: 'submitted' });
  assert.equal(gone('students', bySubmission).error.code, 'in_use');
  const byFile = mkStudent('w2');
  store.insert('files', { assignmentId: 'as_x', ownerId: byFile.id, state: 'pending', name: 'a.pdf', kind: 'pdf', size: 1, stored: 'a'.repeat(32) + '.bin' });
  assert.equal(gone('students', byFile).error.code, 'in_use');
  const author = mkStaff('w3');
  store.insert('assignments', { subjectId: 'sb_x', kind: 'hw', title: 'T', dueAt: '2026-09-20 23:59:00', maxPoints: 5, createdBy: author.id });
  assert.equal(gone('staff', author).error.code, 'in_use');
  const editor = mkStaff('w4');
  store.insert('assignments', { subjectId: 'sb_x', kind: 'hw', title: 'T', dueAt: '2026-09-20 23:59:00', maxPoints: 5, createdBy: teacherRow.id, updatedBy: editor.id });
  assert.equal(gone('staff', editor).error.code, 'in_use');
  const checker = mkStaff('w5');
  store.insert('submissions', { assignmentId: 'as_x', studentId: 'st_x', n: 1, status: 'checked', checkedBy: checker.id });
  assert.equal(gone('staff', checker).error.code, 'in_use');
  const subject = store.insert('subjects', { name: 'Free', teacherId: 'nobody', groupId: 'nogroup', scheme: 'A' });
  store.insert('assignments', { subjectId: subject.id, kind: 'srs', title: 'T', dueAt: '2026-09-20 23:59:00', maxPoints: 5, createdBy: 'st_y' });
  assert.equal(gone('subjects', subject).error.code, 'in_use');
});

// Unit 6: the new tables keep the people, subjects and groups they point to.
test('remove: requests, state exam results and exam attempts keep students', () => {
  const { call, store, group, admin } = setup();
  const mk = (n) => store.insert('students', { fullName: n, cardNo: n, groupId: group.id, passwordHash: 'x', active: true });
  const withRequest = mk('u1');
  store.insert('requests', { kind: 'control', subjectId: 'sb_x', studentId: withRequest.id, authorId: 'st_x', status: 'dean' });
  assert.equal(call('dir.remove', { table: 'students', id: withRequest.id }, admin).error.code, 'in_use');
  const withState = mk('u2');
  store.insert('stateExamResults', { examId: 'se_x', studentId: withState.id, score: 70, updatedBy: 'st_x' });
  assert.equal(call('dir.remove', { table: 'students', id: withState.id }, admin).error.code, 'in_use');
  const withAttempt = mk('u3');
  store.insert('examAttempts', { subjectId: 'sb_x', studentId: withAttempt.id, no: 1, outcome: 'score', score: 30, updatedBy: 'st_x' });
  assert.equal(call('dir.remove', { table: 'students', id: withAttempt.id }, admin).error.code, 'in_use');
  const clean = mk('u4');
  assert.deepEqual(call('dir.remove', { table: 'students', id: clean.id }, admin).data, {});
});

test('remove: closings, requests, announcements, state exams and exam rows keep staff', () => {
  const { call, store, admin } = setup();
  const mk = (n) => store.insert('staff', { fullName: n, login: n, passwordHash: 'x', roles: 'teacher', active: true });
  const cases = [
    ['closures', { subjectId: 'sb_x', unit: 1, closedBy: '$' }],
    ['closures', { subjectId: 'sb_x', unit: 1, closedBy: 'st_x', reopenedBy: '$' }],
    ['requests', { kind: 'control', subjectId: 'sb_x', authorId: '$' }],
    ['requests', { kind: 'control', subjectId: 'sb_x', authorId: 'st_x', deanBy: '$' }],
    ['requests', { kind: 'control', subjectId: 'sb_x', authorId: 'st_x', finalBy: '$' }],
    ['announcements', { authorId: '$', audience: 'all', title: 'T' }],
    ['announcements', { authorId: 'st_x', audience: 'all', title: 'T', removedBy: '$' }],
    ['stateExams', { groupId: 'g_x', name: 'E', createdBy: '$' }],
    ['stateExams', { groupId: 'g_x', name: 'E', createdBy: 'st_x', updatedBy: '$' }],
    ['stateExamResults', { examId: 'se_x', studentId: 'st_y', updatedBy: '$' }],
    ['subjectExams', { subjectId: 'sb_x', updatedBy: '$' }],
    ['examAttempts', { subjectId: 'sb_x', studentId: 'st_y', no: 1, updatedBy: '$' }],
  ];
  cases.forEach(([table, row], i) => {
    const person = mk(`w${i}`);
    store.insert(table, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === '$' ? person.id : v])));
    assert.equal(call('dir.remove', { table: 'staff', id: person.id }, admin).error.code, 'in_use', `${table} ${i}`);
  });
  const clean = mk('w_clean');
  assert.deepEqual(call('dir.remove', { table: 'staff', id: clean.id }, admin).data, {});
});

test('remove: closed units, requests and exam rows keep subjects; state exams and announcements keep groups', () => {
  const { call, store, admin } = setup();
  const subject = () => store.insert('subjects', { name: 'Free', teacherId: 'nobody', groupId: 'nogroup', scheme: 'A' });
  const owned = [
    ['closures', (id) => ({ subjectId: id, unit: 1 })],
    ['requests', (id) => ({ kind: 'control', subjectId: id })],
    ['subjectExams', (id) => ({ subjectId: id })],
    ['examAttempts', (id) => ({ subjectId: id, studentId: 'st_y', no: 1 })],
  ];
  for (const [table, row] of owned) {
    const s = subject();
    store.insert(table, row(s.id));
    assert.equal(call('dir.remove', { table: 'subjects', id: s.id }, admin).error.code, 'in_use', table);
  }
  const free = subject();
  assert.deepEqual(call('dir.remove', { table: 'subjects', id: free.id }, admin).data, {});

  const withExam = store.insert('groups', { name: '77-1', course: 1 });
  store.insert('stateExams', { groupId: withExam.id, name: 'E', date: '2026-11-01' });
  assert.equal(call('dir.remove', { table: 'groups', id: withExam.id }, admin).error.code, 'in_use');
  const withNote = store.insert('groups', { name: '78-1', course: 1 });
  store.insert('announcements', { authorId: 'st_x', audience: 'group', groupId: withNote.id, title: 'T' });
  assert.equal(call('dir.remove', { table: 'groups', id: withNote.id }, admin).error.code, 'in_use');
  const clean = store.insert('groups', { name: '79-1', course: 1 });
  assert.deepEqual(call('dir.remove', { table: 'groups', id: clean.id }, admin).data, {});
});

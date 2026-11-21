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

test('temporary passwords are stored with 20 rounds, a changed password with 100', () => {
  const { call, store, admin, teacherRow } = setup();
  const reset = call('dir.resetPassword', { table: 'staff', id: teacherRow.id }, admin).data;
  assert.match(store.get('staff', teacherRow.id).passwordHash, /^v1\$20\$/);
  const token = call('auth.login', { login: 'teacher', password: reset.tempPassword }).data.token;
  const changed = call('auth.changePassword', { oldPassword: reset.tempPassword, newPassword: 'new-secret-1' }, token);
  assert.equal(changed.ok, true);
  assert.match(store.get('staff', teacherRow.id).passwordHash, /^v1\$100\$/);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest, withHandlers, publicUser } from '../backend/api.js';

const STUDENT_TEMP = 'temp4567';

function setup() {
  const clock = { t: 1_000_000 };
  const platform = createNodePlatform({ now: () => clock.t, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const admin = store.insert('staff', {
    fullName: 'Admin', login: 'admin', passwordHash: hashPassword(platform, 'secret12'),
    roles: 'admin', lang: 'ru', mustChangePassword: false, active: true,
  });
  const student = store.insert('students', {
    fullName: 'Student', groupId: 'g_1', cardNo: 'S1001', passwordHash: hashPassword(platform, STUDENT_TEMP),
    lang: '', mustChangePassword: true, active: true,
  });
  const logged = [];
  const ctx = { store, platform, log: (e) => logged.push(e) };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const addStaff = (login, roles, mustChangePassword) => store.insert('staff', {
    fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
    roles, lang: 'ky', mustChangePassword, active: true,
  });
  return { clock, platform, store, admin, student, ctx, call, logged, addStaff };
}

test('request validation and envelope', () => {
  const { ctx, call } = setup();
  assert.deepEqual(handleRequest('не json', ctx).error, { code: 'bad_request' });
  assert.deepEqual(handleRequest('{"action":5}', ctx).error, { code: 'bad_request' });
  assert.deepEqual(handleRequest(null, ctx).error, { code: 'bad_request' });
  assert.deepEqual(call('нет.такого').error, { code: 'bad_request' });
  assert.deepEqual(call('auth.me').error, { code: 'unauthorized' });
  assert.deepEqual(call('auth.me', {}, 'мусор').error, { code: 'unauthorized' });
  assert.equal(typeof call('auth.me').serverTime, 'number');
  assert.equal(handleRequest('не json', ctx).ok, false);
  assert.equal(typeof handleRequest('не json', ctx).serverTime, 'number');
  const viaObject = handleRequest({ action: 'auth.login', data: { login: 'x', password: 'y' } }, ctx);
  assert.equal(viaObject.error.code, 'bad_credentials');
});

test('login', () => {
  const { call, student } = setup();
  assert.deepEqual(call('auth.login', { login: 'admin', password: 'wrong' }).error, { code: 'bad_credentials' });
  assert.deepEqual(call('auth.login', { login: 'nobody', password: 'x' }).error, { code: 'bad_credentials' });
  assert.deepEqual(call('auth.login', 'oops').error, { code: 'bad_credentials' });
  const a = call('auth.login', { login: '  ADMIN ', password: 'secret12' }).data;
  assert.equal(a.user.kind, 'staff');
  assert.deepEqual(a.user.roles, ['admin']);
  assert.equal(a.user.groupId, null);
  assert.equal('passwordHash' in a.user, false);
  assert.ok(a.user.permissions.includes('dir.save:staff'));
  assert.equal(JSON.stringify(a).includes('v1$'), false);
  const st = call('auth.login', { login: 's1001', password: STUDENT_TEMP }).data;
  assert.deepEqual(st.user.roles, ['student']);
  assert.equal(st.user.id, student.id);
  assert.equal(st.user.groupId, 'g_1');
  assert.equal(st.user.groupName, null);
  assert.equal(a.user.groupName, null);
  assert.equal(st.user.lang, 'ky');
  assert.equal(st.user.mustChangePassword, true);
});

test('user object carries the group name for students, null for staff and for a missing group', () => {
  const { call, store, student } = setup();
  const group = store.insert('groups', { name: '01-1', course: 1 });
  store.update('students', student.id, { groupId: group.id });
  const st = call('auth.login', { login: 'S1001', password: STUDENT_TEMP }).data;
  assert.equal(st.user.groupId, group.id);
  assert.equal(st.user.groupName, '01-1');
  assert.equal(call('auth.me', {}, st.token).data.user.groupName, '01-1');
  assert.equal(call('user.setLang', { lang: 'ru' }, st.token).data.user.groupName, '01-1');
  const changed = call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: 'kitep-42' }, st.token).data;
  assert.equal(changed.user.groupName, '01-1');
  store.remove('groups', group.id);
  const me = call('auth.me', {}, changed.token).data.user;
  assert.equal(me.groupId, group.id);
  assert.equal(me.groupName, null);
  const a = call('auth.login', { login: 'admin', password: 'secret12' }).data;
  assert.equal(a.user.groupName, null);
  assert.equal(call('auth.me', {}, a.token).data.user.groupName, null);
  assert.equal(call('user.setLang', { lang: 'en' }, a.token).data.user.groupName, null);
});

test('student flow: forbidden, setLang, changePassword, old token dies', () => {
  const { call } = setup();
  const st = call('auth.login', { login: 's1001', password: STUDENT_TEMP }).data;
  assert.deepEqual(call('teacher.mySubjects', {}, st.token).error, { code: 'forbidden' });
  assert.equal(call('user.setLang', { lang: 'xx' }, st.token).error.code, 'invalid');
  assert.deepEqual(call('auth.changePassword', { oldPassword: 'nope', newPassword: 'kitep-42' }, st.token).error,
    { code: 'bad_credentials' });
  assert.deepEqual(call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: '123' }, st.token).error,
    { code: 'invalid', fields: [{ field: 'newPassword', code: 'too_short' }] });
  assert.deepEqual(call('auth.changePassword', { oldPassword: STUDENT_TEMP }, st.token).error.code, 'invalid');
  const changed = call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: 'kitep-42' }, st.token).data;
  assert.equal(changed.user.mustChangePassword, false);
  assert.deepEqual(call('auth.me', {}, st.token).error, { code: 'unauthorized' });
  assert.equal(call('auth.me', {}, changed.token).ok, true);
  assert.equal(call('user.setLang', { lang: 'en' }, changed.token).data.user.lang, 'en');
  assert.equal(call('auth.login', { login: 'S1001', password: 'kitep-42' }).ok, true);
  assert.equal(call('auth.login', { login: 'S1001', password: STUDENT_TEMP }).ok, false);
});

test('changePassword rejects password equal to login', () => {
  const { call, addStaff } = setup();
  addStaff('director', 'admin', false);
  const d = call('auth.login', { login: 'director', password: 'secret12' }).data;
  assert.deepEqual(call('auth.changePassword', { oldPassword: 'secret12', newPassword: 'DIRECTOR' }, d.token).error,
    { code: 'invalid', fields: [{ field: 'newPassword', code: 'same_as_login' }] });
  assert.equal(call('auth.changePassword', { oldPassword: 'secret12', newPassword: 'director-1' }, d.token).ok, true);
});

test('changePassword rejects the same password and a non-string one, and keeps the old password', () => {
  const { call } = setup();
  const st = call('auth.login', { login: 'S1001', password: STUDENT_TEMP }).data;
  assert.deepEqual(call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: STUDENT_TEMP }, st.token).error,
    { code: 'invalid', fields: [{ field: 'newPassword', code: 'same_as_old' }] });
  for (const newPassword of [12345678, { a: 1 }, ['kitep-42'], null]) {
    assert.deepEqual(call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword }, st.token).error,
      { code: 'invalid', fields: [{ field: 'newPassword', code: 'invalid' }] }, JSON.stringify(newPassword));
  }
  const me = call('auth.me', {}, st.token).data.user;
  assert.equal(me.mustChangePassword, true);
  assert.equal(call('auth.login', { login: 'S1001', password: STUDENT_TEMP }).ok, true);
});

test('disabled, expired and password-less users are unauthorized', () => {
  const { call, store, admin, clock } = setup();
  const a = call('auth.login', { login: 'admin', password: 'secret12' }).data;
  assert.equal(call('auth.me', {}, a.token).ok, true);
  clock.t += 8 * 86400000;
  assert.deepEqual(call('auth.me', {}, a.token).error, { code: 'unauthorized' });
  clock.t -= 8 * 86400000;
  store.update('staff', admin.id, { active: false });
  assert.deepEqual(call('auth.me', {}, a.token).error, { code: 'unauthorized' });
  assert.deepEqual(call('auth.login', { login: 'admin', password: 'secret12' }).error, { code: 'bad_credentials' });
  store.update('staff', admin.id, { active: true, passwordHash: '' });
  assert.deepEqual(call('auth.me', {}, a.token).error, { code: 'unauthorized' });
  assert.deepEqual(call('auth.login', { login: 'admin', password: '' }).error, { code: 'bad_credentials' });
});

test('must_change_password blocks everything except the allowed actions', () => {
  const { call, addStaff } = setup();
  addStaff('dean', ' dean , teacher,', true);
  const d = call('auth.login', { login: 'dean', password: 'secret12' }).data;
  assert.deepEqual(d.user.roles, ['dean', 'teacher']);
  assert.deepEqual(call('dir.list', { table: 'groups' }, d.token).error, { code: 'must_change_password' });
  assert.equal(call('auth.me', {}, d.token).ok, true);
  assert.equal(call('user.setLang', { lang: 'ru' }, d.token).data.user.lang, 'ru');
});

test('role check uses data.table; missing handler is bad_request after the checks', () => {
  const { call, addStaff } = setup();
  addStaff('dean', 'dean', false);
  const d = call('auth.login', { login: 'dean', password: 'secret12' }).data;
  assert.deepEqual(call('dir.save', { table: 'staff' }, d.token).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.save', null, d.token).error, { code: 'forbidden' });
  withHandlers({ 'dir.list': null }, () => {
    assert.deepEqual(call('dir.list', { table: 'groups' }, d.token).error, { code: 'bad_request' });
  });
  assert.equal(call('dir.list', { table: 'groups' }, d.token).ok, true);
});

test('handlers: AppError passes through, other errors become internal', () => {
  const { call, logged } = setup();
  const a = call('auth.login', { login: 'admin', password: 'secret12' }).data;
  withHandlers({
    'dir.list': () => { throw new Error('boom'); },
    'dir.save': (data, ctx, user) => ({ echo: data, uid: user.id, kind: user.kind }),
  }, () => {
    assert.deepEqual(call('dir.list', { table: 'groups' }, a.token).error, { code: 'internal' });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].message, 'boom');
    const saved = call('dir.save', { table: 'groups', x: 1 }, a.token).data;
    assert.equal(saved.kind, 'staff');
    assert.equal(saved.echo.x, 1);
  });
  assert.equal(call('dir.list', { table: 'groups' }, a.token).ok, true);
});

test('publicUser', () => {
  const row = { id: 'sf_1', fullName: 'A', roles: 'teacher', lang: 'en', mustChangePassword: false, passwordHash: 'x' };
  assert.deepEqual(publicUser(row, 'staff'), {
    id: 'sf_1', kind: 'staff', fullName: 'A', roles: ['teacher'], lang: 'en', mustChangePassword: false,
    groupId: null, groupName: null, permissions: ['schedule.mine', 'syllabus.get', 'teacher.mySubjects'],
  });
  const studentRow = { id: 'st_1', fullName: 'S', groupId: 'g_1', cardNo: 'S1', lang: 'ky', mustChangePassword: false };
  const student = publicUser(studentRow, 'student');
  assert.equal(student.groupId, 'g_1');
  assert.equal(student.groupName, null);
});

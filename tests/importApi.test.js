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
  const ctx = { store, platform, log: () => {} };
  store.insert('staff', {
    fullName: 'dean', login: 'dean', passwordHash: hashPassword(platform, 'secret12'),
    roles: 'dean', lang: 'ky', mustChangePassword: false, active: true,
  });
  store.insert('groups', { name: '01-1', course: 1 });
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const dean = call('auth.login', { login: 'dean', password: 'secret12' }).data.token;
  return { store, call, dean };
}

const cells = [['ФИО', 'Группа', '№ студ. билета'], ['Асанов Азамат', '01-1', 2001], ['Бекова Бегимай', '01-1', 2002], ['Кривой', '99-9', 2003]];

test('preview writes nothing, apply imports once and never re-issues passwords', () => {
  const { store, call, dean } = setup();
  const pre = call('import.preview', { table: 'students', cells }, dean).data;
  assert.deepEqual([pre.total, pre.valid, pre.newCount, pre.updateCount], [3, 2, 2, 0]);
  assert.equal(store.list('students').length, 0);
  const first = call('import.apply', { table: 'students', cells }, dean).data;
  assert.deepEqual([first.inserted, first.updated, first.skipped, first.passwords.length], [2, 0, 1, 2]);
  assert.deepEqual(first.errors, [{ row: 4, field: 'groupId', code: 'bad_ref' }]);
  assert.equal(first.passwords[0].login, '2001');
  assert.equal(JSON.stringify(first).includes('v1$'), false);
  assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);
  const second = call('import.apply', { table: 'students', cells }, dean).data;
  assert.deepEqual([second.inserted, second.updated, second.passwords.length], [0, 2, 0]);
  assert.equal(store.list('students').length, 2);
  assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);
  assert.deepEqual(call('import.apply', { table: 'staff', cells: [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'admin']] }, dean).error, { code: 'forbidden' });
});

test('bad requests and files that cannot be applied', () => {
  const { store, call, dean } = setup();
  assert.deepEqual(call('import.preview', { table: 'translations', cells }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('import.preview', { table: 'students', cells: 'x' }, dean).error, { code: 'bad_request' });
  assert.deepEqual(call('import.apply', { table: 'students', cells: [['ФИО'], 'x'] }, dean).error, { code: 'bad_request' });
  const noCol = call('import.apply', { table: 'students', cells: [['ФИО', 'Группа'], ['А', '01-1']] }, dean).data;
  assert.deepEqual([noCol.inserted, noCol.updated, noCol.passwords], [0, 0, []]);
  assert.deepEqual(noCol.missingColumns, ['cardNo']);
  const many = [cells[0], ...Array.from({ length: 2001 }, (_, i) => ['N', '01-1', 5000 + i])];
  const tooMany = call('import.apply', { table: 'students', cells: many }, dean).data;
  assert.deepEqual([tooMany.inserted, tooMany.skipped], [0, 1]);
  assert.equal(store.list('students').length, 0);
});

test('groups import needs no passwords; a row with two errors is skipped once', () => {
  const { store, call, dean } = setup();
  const g = [['Название', 'Курс'], ['02-1', 2], ['', '']];
  const r = call('import.apply', { table: 'groups', cells: g }, dean).data;
  assert.deepEqual([r.inserted, r.passwords], [1, []]);
  assert.equal(store.list('groups').length, 2);
  const bad = call('import.preview', { table: 'students', cells: [cells[0], ['', 'zz', '']] }, dean).data;
  assert.deepEqual([bad.total, bad.valid], [1, 0]);
  assert.ok(bad.errors.length >= 2);
});

test('re-importing identical rows writes nothing but still counts them as updated', () => {
  const { store, call, dean } = setup();
  const good = cells.slice(0, 3);
  call('import.apply', { table: 'students', cells: good }, dean);
  const updates = [];
  const update = store.updateMany;
  store.updateMany = (...args) => { updates.push(args); return update(...args); };
  const pre = call('import.preview', { table: 'students', cells: good }, dean).data;
  assert.deepEqual([pre.newCount, pre.updateCount], [0, 2]);
  const again = call('import.apply', { table: 'students', cells: good }, dean).data;
  assert.deepEqual([again.inserted, again.updated, again.passwords.length], [0, 2, 0]);
  assert.deepEqual(updates, []);
  const renamed = [good[0], ['Асанов Азамат Бекович', '01-1', 2001], good[2]];
  const changed = call('import.apply', { table: 'students', cells: renamed }, dean).data;
  assert.deepEqual([changed.inserted, changed.updated], [0, 2]);
  assert.equal(updates.length, 1);
  assert.equal(store.list('students').find((s) => s.cardNo === '2001').fullName, 'Асанов Азамат Бекович');
});

test('updates run before inserts: a failing update leaves no new people behind', () => {
  const { store, call, dean } = setup();
  call('import.apply', { table: 'students', cells: cells.slice(0, 2) }, dean);
  store.updateMany = () => { throw new Error('sheet write failed'); };
  const mixed = [cells[0], ['Асанов Азамат Бекович', '01-1', 2001], ['Бекова Бегимай', '01-1', 2002]];
  assert.deepEqual(call('import.apply', { table: 'students', cells: mixed }, dean).error, { code: 'internal' });
  assert.deepEqual(store.list('students').map((s) => s.cardNo), ['2001']);
});

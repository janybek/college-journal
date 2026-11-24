import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const ctx = { store, platform };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const tokens = {};
  for (const [login, roles] of [['dean', 'dean'], ['prorector', 'prorector'], ['teacher1', 'teacher']]) {
    store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
      roles, lang: 'ky', mustChangePassword: false, active: true });
    tokens[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  return { store, platform, call, ...tokens };
}

test('settings: get defaults, save normalises, repeat save updates rows', () => {
  const { store, call, dean, prorector, teacher1 } = setup();
  assert.deepEqual(call('settings.get', {}, prorector).data,
    { settings: { semesterStart: '', semesterEnd: '', holidays: [], bells: DEFAULT_BELLS, semester: 1 }, defaultBells: DEFAULT_BELLS, pairMinutes: 90, extra: { examStart: '', examEnd: '', collegeName: '' } });
  const input = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: ['2026-11-07', '2026-09-07', '2026-11-07'], bells: ['08:00', '09:40'] };
  assert.deepEqual(call('settings.save', { settings: input }, dean).data.settings.holidays, ['2026-09-07', '2026-11-07']);
  assert.equal(store.list('settings').length, 4);
  assert.equal(call('settings.get', {}, prorector).data.settings.semester, 1);
  assert.equal(call('settings.save', { settings: { ...input, semester: 2 } }, dean).data.settings.semester, 2);
  assert.equal(store.list('settings').length, 5);
  assert.equal(call('settings.save', { settings: input }, dean).data.settings.semester, 2);
  assert.equal(call('settings.get', {}, dean).data.settings.semester, 2);
  assert.deepEqual(call('settings.save', { settings: { ...input, semester: 3 } }, dean).error, { code: 'invalid', fields: [{ field: 'semester', code: 'bad_value' }] });
  call('settings.save', { settings: { ...input, bells: ['08:00', '09:40', '11:20'] } }, dean);
  assert.equal(store.list('settings').length, 5);
  assert.deepEqual(call('settings.get', {}, dean).data.settings.bells, ['08:00', '09:40', '11:20']);
  assert.deepEqual(call('settings.save', { settings: { ...input, semesterEnd: '2026-08-01', bells: ['08:00', '09:00'] } }, dean).error,
    { code: 'invalid', fields: [{ field: 'semesterEnd', code: 'bad_value' }, { field: 'bells', code: 'bad_value' }] });
  assert.deepEqual(call('settings.save', { settings: input }, prorector).error, { code: 'forbidden' });
  assert.deepEqual(call('settings.get', {}, teacher1).error, { code: 'forbidden' });
  assert.equal(call('settings.save', {}, dean).error.code, 'invalid');
});

test('settings: an unchanged key is not written again', () => {
  const { store, platform, call, dean } = setup();
  const input = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: ['08:00', '09:40'] };
  call('settings.save', { settings: input }, dean);
  const writes = [];
  const spy = {
    ...store,
    updateMany: (table, items) => { writes.push(['updateMany', items.length]); return store.updateMany(table, items); },
    insertMany: (table, rows) => { writes.push(['insertMany', rows.length]); return store.insertMany(table, rows); },
  };
  const ctx = { store: spy, platform };
  const send = (settings) => handleRequest(JSON.stringify({ action: 'settings.save', data: { settings }, token: dean }), ctx);
  assert.equal(send(input).ok, true);
  assert.deepEqual(writes, []);
  assert.equal(send({ ...input, semesterEnd: '2026-12-26' }).ok, true);
  assert.deepEqual(writes, [['updateMany', 1]]);
});

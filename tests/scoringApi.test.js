import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const spy = { writes: {}, reset() { this.writes = {}; } };
  const watched = { ...store };
  for (const name of ['updateMany', 'insertMany']) {
    watched[name] = (table, items) => {
      spy.writes[`${name}:${table}`] = (spy.writes[`${name}:${table}`] || 0) + 1;
      return store[name](table, items);
    };
  }
  const ctx = { store: watched, platform };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const t = {};
  for (const [login, roles] of [['admin', 'admin'], ['dean', 'dean'], ['prorector', 'prorector'], ['teacher1', 'teacher']]) {
    store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
      roles, lang: 'ky', mustChangePassword: false, active: true });
    t[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  store.insert('students', { fullName: 'S1', cardNo: 'S1', passwordHash: hashPassword(platform, 'secret12'),
    lang: 'ky', mustChangePassword: false, active: true });
  t.S1 = call('auth.login', { login: 'S1', password: 'secret12' }).data.token;
  return { store, call, spy, t };
}

test('scoring: get, save, repeat save writes nothing, bad scheme writes nothing, rights', () => {
  const { store, call, spy, t } = setup();
  assert.deepEqual(call('scoring.get', {}, t.dean).data, { scheme: { ...DEFAULT_SCHEME }, defaults: { ...DEFAULT_SCHEME }, split: { ...DEFAULT_SPLIT }, splitDefaults: { ...DEFAULT_SPLIT } });
  const next = { ...DEFAULT_SCHEME, activity: 5, editDays: 7 };
  assert.deepEqual(call('scoring.save', { scheme: next }, t.dean).data.scheme, next);
  assert.deepEqual(call('scoring.get', {}, t.prorector).data.scheme, next);
  assert.equal(store.list('settings').filter((r) => r.key === 'scoreActivity').length, 1);
  spy.reset();
  call('scoring.save', { scheme: next }, t.admin);
  assert.deepEqual([spy.writes['updateMany:settings'], spy.writes['insertMany:settings']], [undefined, undefined]);
  const bad = call('scoring.save', { scheme: { ...next, control: 30 } }, t.dean);
  assert.deepEqual([bad.ok, bad.error.code, bad.error.fields], [false, 'invalid', [{ field: 'control', code: 'sum' }]]);
  assert.deepEqual(call('scoring.get', {}, t.dean).data.scheme, next);
  for (const token of [t.prorector, t.teacher1, t.S1]) assert.equal(call('scoring.save', { scheme: next }, token).error.code, 'forbidden');
  for (const token of [t.teacher1, t.S1]) assert.equal(call('scoring.get', {}, token).error.code, 'forbidden');
  const S = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: ['08:00', '09:40'] };
  call('settings.save', { settings: S }, t.dean);
  assert.deepEqual(call('scoring.get', {}, t.dean).data.scheme, next);
  assert.equal(call('settings.get', {}, t.dean).data.settings.semesterStart, S.semesterStart);
  assert.equal(call('scoring.save', { scheme: [20] }, t.dean).error.code, 'invalid');
});

test('scoring: the 60/40 split is saved with the scheme, an old site without split leaves it, bad values write nothing', () => {
  const { store, call, spy, t } = setup();
  const next = { ...DEFAULT_SCHEME, activity: 5, editDays: 7 };
  const half = { semester: 50, exam: 50, admission: 25 };
  assert.deepEqual(call('scoring.save', { scheme: next, split: half }, t.dean).data, { scheme: next, split: half });
  assert.deepEqual(call('scoring.get', {}, t.prorector).data.split, half);
  assert.deepEqual(call('scoring.save', { scheme: next }, t.dean).data.split, half);
  assert.deepEqual(call('scoring.save', { scheme: next, split: undefined }, t.dean).data.split, half);
  spy.reset();
  call('scoring.save', { scheme: next, split: half }, t.admin);
  assert.deepEqual([spy.writes['updateMany:settings'], spy.writes['insertMany:settings']], [undefined, undefined]);
  const before = JSON.stringify(store.list('settings'));
  assert.deepEqual(call('scoring.save', { scheme: { ...next, control: 30 }, split: { semester: 60, exam: 30, admission: 70 } }, t.dean).error,
    { code: 'invalid', fields: [{ field: 'control', code: 'sum' }, { field: 'exam', code: 'sum' }, { field: 'admission', code: 'too_big' }] });
  for (const split of [[60], 'x', 5, null]) assert.equal(call('scoring.save', { scheme: next, split }, t.dean).error.fields.length, 3);
  for (const token of [t.prorector, t.teacher1, t.S1]) assert.equal(call('scoring.save', { scheme: next, split: DEFAULT_SPLIT }, token).error.code, 'forbidden');
  assert.equal(JSON.stringify(store.list('settings')), before);
  // the first save of a new base writes the split rows once each
  const fresh = setup();
  fresh.spy.reset();
  fresh.call('scoring.save', { scheme: DEFAULT_SCHEME, split: half }, fresh.t.dean);
  assert.deepEqual([fresh.spy.writes['updateMany:settings'], fresh.spy.writes['insertMany:settings']], [undefined, 1]);
  assert.deepEqual(fresh.store.list('settings').filter((r) => ['scoreSemester', 'scoreExam', 'scoreAdmission'].includes(r.key)).map((r) => [r.key, r.value]).sort(),
    [['scoreAdmission', '25'], ['scoreExam', '50'], ['scoreSemester', '50']]);
});

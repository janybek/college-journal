import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT, readScheme, readSplit, schemeToRows } from '../core/scoring.js';
import { applySchemeUpgrade } from '../backend/schemeUpgrade.js';
import { handleRequest } from '../backend/api.js';
import { hashPassword } from '../core/auth.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const writes = [];
  const watched = { ...store };
  for (const name of ['updateMany', 'insertMany']) {
    watched[name] = (table, items) => { writes.push(`${name}:${table}`); return store[name](table, items); };
  }
  return { platform, store, watched, writes };
}

const OTHERS = [{ key: 'semesterStart', value: '2026-09-01' }, { key: 'examStart', value: '2026-12-01' }, { key: 'collegeName', value: 'Колледж' }];

test('upgrade: empty settings stay empty', () => {
  const { store, watched, writes } = setup();
  assert.deepEqual(applySchemeUpgrade(watched), { moved: [] });
  assert.deepEqual([store.list('settings').length, writes], [0, []]);
});

test('upgrade: a saved scheme with the threshold 76 moves to 80 and gets the split; the other rows stay; the second run writes nothing', () => {
  const { store, watched, writes } = setup();
  store.insertMany('settings', [...schemeToRows({ ...DEFAULT_SCHEME, good: 76 }), ...OTHERS]);
  const before = store.list('settings');
  assert.deepEqual(applySchemeUpgrade(watched), { moved: ['scoreGood', 'scoreSemester', 'scoreExam', 'scoreAdmission'] });
  assert.deepEqual(writes, ['updateMany:settings', 'insertMany:settings']);
  const after = store.list('settings');
  assert.equal(readScheme(after).good, 80);
  assert.deepEqual(readSplit(after), DEFAULT_SPLIT);
  for (const row of before) {
    if (row.key === 'scoreGood') continue;
    assert.deepEqual(after.find((r) => r.id === row.id), row, row.key);
  }
  assert.equal(after.find((r) => r.id === before.find((x) => x.key === 'scoreGood').id).key, 'scoreGood');
  writes.length = 0;
  assert.deepEqual(applySchemeUpgrade(watched), { moved: [] });
  assert.deepEqual(writes, []);
});

test('upgrade: a threshold set by a person (75) stays, the split rows are added', () => {
  const { store, watched } = setup();
  store.insertMany('settings', schemeToRows({ ...DEFAULT_SCHEME, good: 75 }));
  assert.deepEqual(applySchemeUpgrade(watched), { moved: ['scoreSemester', 'scoreExam', 'scoreAdmission'] });
  assert.equal(store.list('settings').find((r) => r.key === 'scoreGood').value, '75');
});

test('upgrade: after the move the dean may return 76 and the next start leaves it', () => {
  const { platform, store, watched } = setup();
  store.insertMany('settings', schemeToRows({ ...DEFAULT_SCHEME, good: 76 }));
  applySchemeUpgrade(watched);
  store.insert('staff', { fullName: 'dean', login: 'dean', passwordHash: hashPassword(platform, 'secret12'), roles: 'dean', lang: 'ky', mustChangePassword: false, active: true });
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store, platform });
  const token = call('auth.login', { login: 'dean', password: 'secret12' }).data.token;
  assert.equal(call('scoring.save', { scheme: { ...DEFAULT_SCHEME, good: 76 } }, token).ok, true);
  assert.deepEqual(applySchemeUpgrade(watched), { moved: [] });
  assert.equal(readScheme(store.list('settings')).good, 76);
});

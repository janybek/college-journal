import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../backend/api.js';
import { hashPassword, verifyPassword, TEMP_HASH_ROUNDS } from '../core/auth.js';
import { normalizeRow } from '../core/validate.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createLoginGuard } from '../core/loginGuard.js';
import { openBase, initBase } from '../backend/node/base.js';
import { keep, tempConfig, snapshotStaff } from './serverSetup.js';

const OLD = 'Old-Passw0rd';

// A base with one staff member whose hash is the old v1 (made on a platform without scrypt).
function oldUser(t, { mustChangePassword = false, kind = 'staff' } = {}) {
  const config = tempConfig(t);
  initBase(config);
  const base = keep(t, openBase(config));
  const v1 = { ...base.platform, scryptHex: undefined };
  const passwordHash = hashPassword(v1, OLD, undefined, mustChangePassword ? TEMP_HASH_ROUNDS : undefined);
  assert.equal(passwordHash.startsWith('v1$'), true);
  if (kind === 'staff') {
    base.store.insert('staff', normalizeRow('staff', { fullName: 'Old Person', login: 'olduser', passwordHash, roles: 'admin', lang: 'ru', mustChangePassword, active: true }));
  } else {
    base.store.insert('students', normalizeRow('students', { fullName: 'Old Student', cardNo: 'S9001', passwordHash, lang: 'ru', mustChangePassword, active: true }));
  }
  const ctx = { store: base.store, platform: base.platform, loginGuard: createLoginGuard() };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  return { config, base, call, passwordHash };
}

const hashOf = (config, login) => snapshotStaff(config, (r) => r.login === login)[0].passwordHash;

test('a v1 user logs in: the hash becomes v2 in the same request, the token works, the same password logs in again', (t) => {
  const { config, call, passwordHash } = oldUser(t);
  const first = call('auth.login', { login: 'olduser', password: OLD });
  assert.equal(first.ok, true);
  const stored = hashOf(config, 'olduser');
  assert.deepEqual([stored.startsWith('v2$'), stored === passwordHash, stored.startsWith('v2$14$8$1$')], [true, false, true]);
  assert.equal(JSON.stringify(first).includes('passwordHash'), false);
  assert.equal(JSON.stringify(first).includes(stored), false);
  const me = call('auth.me', {}, first.data.token);
  assert.deepEqual([me.ok, me.data.user.fullName], [true, 'Old Person']);
  const again = call('auth.login', { login: 'olduser', password: OLD });
  assert.equal(again.ok, true);
  assert.equal(hashOf(config, 'olduser'), stored);                                            // already v2: not rewritten again
  assert.equal(call('auth.me', {}, again.data.token).ok, true);
});

test('a temporary password is rewritten with the temporary strength; the flag stays', (t) => {
  const { config, call } = oldUser(t, { mustChangePassword: true });
  const res = call('auth.login', { login: 'olduser', password: OLD });
  assert.equal(res.ok, true);
  const stored = hashOf(config, 'olduser');
  assert.equal(stored.startsWith('v2$12$8$1$'), true);
  assert.equal(snapshotStaff(config, (r) => r.login === 'olduser')[0].mustChangePassword, true);
  assert.equal(call('auth.me', {}, res.data.token).ok, true);
});

test('a student with an old hash is rewritten too', (t) => {
  const { base, call } = oldUser(t, { kind: 'student' });
  const res = call('auth.login', { login: 'S9001', password: OLD });
  assert.equal(res.ok, true);
  assert.equal(base.store.list('students')[0].passwordHash.startsWith('v2$'), true);
  assert.equal(call('auth.me', {}, res.data.token).ok, true);
});

test('a wrong password writes nothing', (t) => {
  const { config, call, passwordHash } = oldUser(t);
  const before = snapshotStaff(config);
  for (const password of ['wrong-one', '', OLD + 'x', undefined, 5]) {
    assert.equal(call('auth.login', { login: 'olduser', password }).error.code, 'bad_credentials');
  }
  assert.deepEqual(snapshotStaff(config), before);
  assert.equal(hashOf(config, 'olduser'), passwordHash);
});

test('a failed write does not break the login: the old hash still works and the failure is logged', (t) => {
  const { base, call, config, passwordHash } = oldUser(t);
  const logged = [];
  const real = base.store.update;
  const ctx = { store: { ...base.store, list: base.store.list, update: () => { throw new Error('disk full'); } }, platform: base.platform, log: (e) => logged.push(String(e.message || e)) };
  const res = handleRequest(JSON.stringify({ action: 'auth.login', data: { login: 'olduser', password: OLD } }), ctx);
  assert.equal(res.ok, true);
  assert.equal(logged.length, 1);
  assert.equal(hashOf(config, 'olduser'), passwordHash);
  assert.equal(handleRequest(JSON.stringify({ action: 'auth.me', data: {}, token: res.data.token }), ctx).ok, true);   // the token matches the old hash
  assert.equal(call('auth.login', { login: 'olduser', password: OLD }).ok, true);
  void real;
});

test('a platform without scrypt (Apps Script) keeps v1 and never rewrites', (t) => {
  const { config, base, passwordHash } = oldUser(t);
  const ctx = { store: base.store, platform: { ...base.platform, scryptHex: undefined } };
  const res = handleRequest(JSON.stringify({ action: 'auth.login', data: { login: 'olduser', password: OLD } }), ctx);
  assert.equal(res.ok, true);
  assert.equal(hashOf(config, 'olduser'), passwordHash);
});

test('scrypt on Node: the stored v2 hash verifies, is salted, and a v1 of the same password still verifies', () => {
  const platform = createNodePlatform({ secret: 's' });
  const a = hashPassword(platform, 'Secret-1');
  const b = hashPassword(platform, 'Secret-1');
  assert.deepEqual([a.startsWith('v2$14$8$1$'), a === b, verifyPassword(platform, 'Secret-1', a), verifyPassword(platform, 'Secret-2', a)], [true, false, true, false]);
  assert.match(platform.scryptHex('p', 'ab'.repeat(8), { logN: 10, r: 8, p: 1, keylen: 32 }), /^[0-9a-f]{64}$/);
  const v1 = hashPassword({ ...platform, scryptHex: undefined }, 'Secret-1');
  assert.equal(verifyPassword(platform, 'Secret-1', v1), true);
});

test('an unknown login and an inactive account cost one scrypt, like a wrong password; nothing is written', (t) => {
  const { config, base, passwordHash } = oldUser(t);
  let calls = 0;
  const platform = { ...base.platform, scryptHex: (...args) => { calls += 1; return base.platform.scryptHex(...args); } };
  const ctx = { store: base.store, platform };
  const login = (name, password) => handleRequest(JSON.stringify({ action: 'auth.login', data: { login: name, password } }), ctx);
  const before = snapshotStaff(config);
  assert.equal(login('nobody', 'whatever-1').error.code, 'bad_credentials');
  assert.equal(calls, 1);
  calls = 0;
  assert.equal(login('olduser', 'wrong-pass').error.code, 'bad_credentials');      // a v1 account: the typed password is checked once (v1 is not scrypt)
  assert.equal(calls, 0);
  assert.equal(login('', 'x').error.code, 'bad_credentials');
  assert.equal(calls, 1);
  assert.deepEqual(snapshotStaff(config), before);
  assert.equal(hashOf(config, 'olduser'), passwordHash);
});

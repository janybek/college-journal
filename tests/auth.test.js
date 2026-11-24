import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import {
  HASH_ROUNDS, TEMP_HASH_ROUNDS, MIN_PASSWORD, TOKEN_TTL_MS, hashPassword, verifyPassword, passwordVersion,
  passwordProblem, generateTempPassword, issueToken, readToken, needsRehash, SCRYPT,
} from '../core/auth.js';

// The Node platform now has scrypt; `p` is the platform of Apps Script (no scryptHex), `ps` below adds scrypt.
const p = { ...createNodePlatform({ now: () => 1000, secret: 's' }), scryptHex: undefined };

test('constants', () => {
  assert.equal(HASH_ROUNDS, 100);
  assert.equal(TEMP_HASH_ROUNDS, 20);
  assert.equal(MIN_PASSWORD, 6);
  assert.deepEqual(TOKEN_TTL_MS, { staff: 7 * 86400000, student: 30 * 86400000 });
});

test('hashPassword is repeatable and has the v1 format', () => {
  const h = hashPassword(p, 'secret12', 'aabbccdd11223344');
  assert.match(h, /^v1\$100\$aabbccdd11223344\$[0-9a-f]{64}$/);
  assert.equal(hashPassword(p, 'secret12', 'aabbccdd11223344'), h);
  assert.equal(hashPassword(p, 'a', 'ab', 1), 'v1$1$ab$' + p.sha256Hex('ab:a'));
  assert.match(hashPassword(p, 'secret12'), /^v1\$100\$[0-9a-f]{16}\$[0-9a-f]{64}$/);
});

test('a hash stored with 500 rounds (older passwords) still verifies', () => {
  const old = hashPassword(p, 'secret12', 'aabbccdd11223344', 500);
  assert.match(old, /^v1\$500\$/);
  assert.equal(verifyPassword(p, 'secret12', old), true);
  assert.equal(verifyPassword(p, 'wrong-pass', old), false);
});

test('hashPassword chains rounds as specified', () => {
  let h = p.sha256Hex('ab:a');
  h = p.sha256Hex(h + ':ab');
  assert.equal(hashPassword(p, 'a', 'ab', 2), 'v1$2$ab$' + h);
});

test('verifyPassword', () => {
  const h = hashPassword(p, 'secret12', 'aabbccdd11223344');
  assert.equal(verifyPassword(p, 'secret12', h), true);
  assert.equal(verifyPassword(p, 'Secret12', h), false);
  assert.equal(verifyPassword(p, 'x', 'мусор'), false);
  for (const bad of ['', null, undefined, 42, 'v1$x$ab$cd', 'v1$0$ab$cd', 'v1$1$ab', 'v2$1$ab$cd']) {
    assert.equal(verifyPassword(p, 'x', bad), false);
  }
  const one = hashPassword(p, 'pw', 'ab', 1);
  assert.equal(verifyPassword(p, 'pw', one), true);
});

test('passwordVersion is the last 8 chars', () => {
  assert.equal(passwordVersion('v1$1$ab$0123456789abcdef'), '89abcdef');
});

test('passwordProblem', () => {
  assert.equal(passwordProblem('12345', 'u'), 'too_short');
  assert.equal(passwordProblem('S1001x'.slice(0, 6), 's1001x'), 'same_as_login');
  assert.equal(passwordProblem('aaaaaaa', 'u'), 'too_simple');
  assert.equal(passwordProblem('123456', 'u'), 'too_simple');
  assert.equal(passwordProblem('Пароль', 'u'), 'too_simple');
  assert.equal(passwordProblem('kитеп-42', 'u'), null);
});

test('generateTempPassword', () => {
  for (let i = 0; i < 20; i++) {
    assert.match(generateTempPassword(p), /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);
  }
});

test('tokens', () => {
  const t = issueToken(p, { uid: 'st_1', kind: 'student', pv: 'abcd1234' });
  assert.deepEqual(readToken(p, t), { uid: 'st_1', kind: 'student', pv: 'abcd1234', exp: 1000 + 30 * 86400000 });
  assert.equal(readToken(p, t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null);
  assert.equal(readToken(createNodePlatform({ now: () => 1000 + 31 * 86400000, secret: 's' }), t), null);
  assert.equal(readToken(createNodePlatform({ now: () => 1000, secret: 'other' }), t), null);
  for (const bad of ['', 'abc', '.', null, undefined, 42, {}, [], 'a.b', '%E0%A4%A.00']) {
    assert.equal(readToken(p, bad), null);
  }
  const staff = issueToken(p, { uid: 'u_1', kind: 'staff', pv: 'x' });
  assert.equal(readToken(p, staff).exp, 1000 + 7 * 86400000);
});

test('readToken rejects a valid signature over non-JSON or wrong shape', () => {
  const sign = (body) => body + '.' + p.hmacSha256Hex(p.secret(), body);
  assert.equal(readToken(p, sign(encodeURIComponent('not json'))), null);
  assert.equal(readToken(p, sign('%E0%A4%A')), null);
  assert.equal(readToken(p, sign(encodeURIComponent('null'))), null);
  assert.equal(readToken(p, sign(encodeURIComponent(JSON.stringify({ uid: 'a', kind: 'root', pv: 'x', exp: 5000 })))), null);
  assert.equal(readToken(p, sign(encodeURIComponent(JSON.stringify({ uid: 'a', kind: 'staff', pv: 'x', exp: 'soon' })))), null);
});

// ---- scrypt (v2) ----
const scryptHex = (password, salt, { logN, r, p: par, keylen }) =>
  scryptSync(password, salt, keylen, { N: 2 ** logN, r, p: par, maxmem: 64 * 1024 * 1024 }).toString('hex');
const ps = { ...p, scryptHex };
const SALT = '00112233445566778899aabbccddeeff';

test('SCRYPT constants', () => {
  assert.deepEqual(SCRYPT, { own: { logN: 14, r: 8, p: 1, keylen: 32 }, temp: { logN: 12, r: 8, p: 1, keylen: 32 } });
});

test('scrypt platform: v2 format and verify', () => {
  const h = hashPassword(ps, 'secret1');
  assert.match(h, /^v2\$14\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  const t = hashPassword(ps, 'tmp12345', undefined, TEMP_HASH_ROUNDS);
  assert.match(t, /^v2\$12\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.equal(verifyPassword(ps, 'secret1', h), true);
  assert.equal(verifyPassword(ps, 'secret2', h), false);
  assert.equal(verifyPassword(ps, 'tmp12345', t), true);
});

test('scrypt known vector', () => {
  const h = hashPassword(ps, 'test-pass', SALT);
  const expected = scryptSync('test-pass', SALT, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  assert.equal(h, 'v2$14$8$1$' + SALT + '$' + expected);
});

test('without scryptHex: still v1, v2 is rejected', () => {
  assert.match(hashPassword(p, 'abc123'), /^v1\$100\$/);
  assert.match(hashPassword(p, 'abc123', undefined, TEMP_HASH_ROUNDS), /^v1\$20\$/);
  assert.equal(verifyPassword(p, 'test-pass', hashPassword(ps, 'test-pass', SALT)), false);
});

test('v1 hash verifies on the scrypt platform too', () => {
  assert.equal(verifyPassword(ps, 'abc123', hashPassword(p, 'abc123')), true);
});

test('broken v2 strings give false and never throw', () => {
  const good = hashPassword(ps, 'x-pass1', SALT);
  const hash = good.split('$')[5];
  const mk = (logN, r, par, salt, h) => ['v2', logN, r, par, salt, h].join('$');
  const bad = [
    good + '$extra', ['v2', 14, 8, 1, SALT].join('$'),
    mk(9, 8, 1, SALT, hash), mk(17, 8, 1, SALT, hash), mk('14a', 8, 1, SALT, hash),
    mk(14, 0, 1, SALT, hash), mk(14, 17, 1, SALT, hash), mk(14, 8, 0, SALT, hash), mk(14, 8, 5, SALT, hash),
    mk(14, 8, 1, 'AABBCCDDEEFF00112233445566778899', hash), mk(14, 8, 1, 'abcdef', hash),
    mk(14, 8, 1, SALT, hash.slice(1)),
  ];
  for (const s of bad) assert.equal(verifyPassword(ps, 'x-pass1', s), false, s);
  assert.equal(verifyPassword(ps, 'x-pass1', 12345), false);
  assert.equal(verifyPassword(ps, 'x-pass1', null), false);
  assert.equal(verifyPassword(ps, 'x-pass1', good), true);
  const boom = { ...p, scryptHex() { throw new Error('boom'); } };
  assert.equal(verifyPassword(boom, 'x-pass1', good), false);
});

test('needsRehash', () => {
  assert.equal(needsRehash(ps, hashPassword(p, 'abc123')), true);
  assert.equal(needsRehash(ps, hashPassword(ps, 'abc123')), false);
  assert.equal(needsRehash(p, hashPassword(p, 'abc123')), false);
});

test('passwordVersion of a v2 hash is its last 8 chars', () => {
  const h = hashPassword(ps, 'abc123', SALT);
  assert.equal(passwordVersion(h), h.slice(-8));
});

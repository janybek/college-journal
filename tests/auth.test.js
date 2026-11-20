import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import {
  HASH_ROUNDS, MIN_PASSWORD, TOKEN_TTL_MS, hashPassword, verifyPassword, passwordVersion,
  passwordProblem, generateTempPassword, issueToken, readToken,
} from '../core/auth.js';

const p = createNodePlatform({ now: () => 1000, secret: 's' });

test('constants', () => {
  assert.equal(HASH_ROUNDS, 500);
  assert.equal(MIN_PASSWORD, 6);
  assert.deepEqual(TOKEN_TTL_MS, { staff: 7 * 86400000, student: 30 * 86400000 });
});

test('hashPassword is repeatable and has the v1 format', () => {
  const h = hashPassword(p, 'secret12', 'aabbccdd11223344');
  assert.match(h, /^v1\$500\$aabbccdd11223344\$[0-9a-f]{64}$/);
  assert.equal(hashPassword(p, 'secret12', 'aabbccdd11223344'), h);
  assert.equal(hashPassword(p, 'a', 'ab', 1), 'v1$1$ab$' + p.sha256Hex('ab:a'));
  assert.match(hashPassword(p, 'secret12'), /^v1\$500\$[0-9a-f]{16}\$[0-9a-f]{64}$/);
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

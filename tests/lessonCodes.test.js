import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { parseLocalDateTime } from '../core/dates.js';
import { issueToken, readToken } from '../core/auth.js';
import { pairKey, codeAt, qrAt, matchCode, issuePass, readPass, isDevice } from '../core/lesson.js';

const platform = createNodePlatform({ secret: 'test-secret', now: () => 0 });
const B = (time) => parseLocalDateTime(`2026-09-22 ${time}`);
const R = { id: 'p1', date: '2026-09-22', startTime: '08:00', status: 'running', startedAt: '2026-09-22 07:58:00', checkinUntil: '2026-09-22 08:03:00', checkinClosed: false };

test('pairKey, codeAt, qrAt: derived from the server secret', () => {
  const key = pairKey(platform, R);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.notEqual(pairKey(platform, { ...R, startedAt: '2026-09-22 07:58:01' }), key);
  assert.notEqual(pairKey(createNodePlatform({ secret: 'other' }), R), key);
  assert.match(codeAt(platform, key, 0), /^\d{4}$/);
  assert.match(qrAt(platform, key, 0), /^[0-9a-f]{16}$/);
  assert.equal(codeAt(platform, key, 3), codeAt(platform, key, 3));
});

test('matchCode: ok, expired, wrong', () => {
  const key = pairKey(platform, R);
  const now = B('07:59:15');
  assert.deepEqual([5, 4, 3, 2, 1, 0, 6].map((s) => matchCode(platform, R, 'code', codeAt(platform, key, s), now)), ['ok', 'ok', 'expired', 'expired', 'expired', 'wrong', 'wrong']);
  assert.deepEqual([5, 3, 0].map((s) => matchCode(platform, R, 'qr', qrAt(platform, key, s), now)), ['ok', 'expired', 'wrong']);
  assert.equal(matchCode(platform, R, 'code', codeAt(platform, key, 0), B('07:58:05')), 'ok');
  assert.equal(matchCode(platform, R, 'code', codeAt(platform, pairKey(platform, { ...R, id: 'p2' }), 5), now), 'wrong');
  for (const bad of [Number(codeAt(platform, key, 5)), ' ' + codeAt(platform, key, 5), '12345', '', null, [codeAt(platform, key, 5)]]) assert.equal(matchCode(platform, R, 'code', bad, now), 'wrong');
  assert.equal(matchCode(platform, R, 'qr', qrAt(platform, key, 5).toUpperCase(), now), 'wrong');
  assert.equal(matchCode(platform, { ...R, status: 'closed' }, 'code', codeAt(platform, key, 5), now), 'wrong');
  assert.equal(matchCode(platform, R, 'other', codeAt(platform, key, 5), now), 'wrong');
});

test('pass: issue, read, forge, and isDevice', () => {
  const device = 'a'.repeat(32);
  const exp = B('08:03:00');
  const pass = issuePass(platform, { pairId: 'p1', device, exp });
  assert.ok(pass.startsWith('pass1.'));
  assert.deepEqual(readPass(platform, pass, exp - 1), { pairId: 'p1', device, exp });
  assert.equal(readPass(platform, pass, exp), null);
  const [, body, sig] = pass.split('.');
  const forged = 'pass1.' + encodeURIComponent(JSON.stringify({ pid: 'p1', dev: device, exp: exp + 3600000 })) + '.' + sig;
  assert.equal(readPass(platform, forged, exp - 1), null);
  assert.equal(readPass(createNodePlatform({ secret: 'other' }), pass, exp - 1), null);
  const auth = issueToken(platform, { uid: 'st_1', kind: 'student', pv: 'abcdefgh' });
  assert.deepEqual([readPass(platform, auth, 0), readToken(platform, pass)], [null, null]);
  for (const bad of [null, 5, '', 'pass1.', 'pass1.x.y', body, {}, [], undefined]) assert.equal(readPass(platform, bad, 0), null);
  assert.deepEqual([isDevice(device), isDevice('A'.repeat(32)), isDevice('a'.repeat(31)), isDevice('g'.repeat(32)), isDevice(null)], [true, false, false, false, false]);
});

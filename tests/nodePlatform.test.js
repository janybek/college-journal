import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';

const p = createNodePlatform({ now: () => 5, secret: 's' });

test('now and secret come from options', () => {
  assert.equal(p.now(), 5);
  assert.equal(p.secret(), 's');
});

test('sha256Hex matches the known vector', () => {
  assert.equal(p.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('randomHex returns 2 hex chars per byte', () => {
  assert.match(p.randomHex(4), /^[0-9a-f]{8}$/);
});

test('hmacSha256Hex matches the known vector', () => {
  assert.equal(p.hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
});

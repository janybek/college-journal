import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVersion } from '../backend/node/version.js';
import { start } from './serverSetup.js';

const HASH = 'a1b2c3d';
const gitSays = (text) => () => text;
const gitFails = () => { throw new Error('git: not found'); };

test('JOURNAL_VERSION beats git; git is not even run', () => {
  let ran = 0;
  const run = () => { ran += 1; return 'ffffff0\n'; };
  assert.equal(readVersion({ env: { JOURNAL_VERSION: HASH }, run }), HASH);
  assert.equal(ran, 0);
});

test('without the variable the short hash comes from git (the line end is cut)', () => {
  const calls = [];
  const run = (...args) => { calls.push(args); return `${HASH}\n`; };
  assert.equal(readVersion({ env: {}, root: '/some/root', run }), HASH);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['git', ['rev-parse', '--short=7', 'HEAD']]);
  assert.equal(calls[0][2].cwd, '/some/root');
  assert.equal(calls[0][2].timeout, 2000);
});

test('a junk JOURNAL_VERSION is ignored: git is asked, and when git fails too the answer is "unknown"', () => {
  const junk = ['abc; rm', '', ' ', 'ABCDEF1', 'a'.repeat(41), 'abc', 'xyz1234', `${HASH}\n; ls`];
  for (const value of junk) {
    assert.equal(readVersion({ env: { JOURNAL_VERSION: value }, run: gitSays(`${HASH}\n`) }), HASH, JSON.stringify(value));
    assert.equal(readVersion({ env: { JOURNAL_VERSION: value }, run: gitFails }), 'unknown', JSON.stringify(value));
  }
  assert.equal(readVersion({ env: { JOURNAL_VERSION: 'a'.repeat(40) }, run: gitFails }), 'a'.repeat(40));
  assert.equal(readVersion({ env: { JOURNAL_VERSION: 'a'.repeat(7) }, run: gitFails }), 'a'.repeat(7));
});

test('git error, timeout, empty or junk output: "unknown", never an exception', () => {
  const timeout = () => { const e = new Error('spawnSync git ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; };
  for (const run of [gitFails, timeout, gitSays(''), gitSays('fatal: not a git repository'), gitSays('ABCDEF1'), gitSays(undefined), gitSays(null), gitSays(42)]) {
    assert.equal(readVersion({ env: {}, run }), 'unknown');
  }
});

test('the real git of this repository (if there is one) gives a hash or "unknown", nothing else', () => {
  assert.match(readVersion({ env: {} }), /^([0-9a-f]{7,40}|unknown)$/);
});

test('/health tells the version it was given; POST is 404; without a version it says "unknown"', async (t) => {
  const { raw } = await start(t, { version: HASH });
  assert.deepEqual(JSON.parse((await raw('GET', '/health')).body), { ok: true, data: 'journal', version: HASH });
  assert.equal((await raw('POST', '/health')).status, 404);
});

test('startServer without a version: "unknown"', async (t) => {
  const { raw } = await start(t);
  assert.deepEqual(JSON.parse((await raw('GET', '/health')).body), { ok: true, data: 'journal', version: 'unknown' });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.location = { hostname: 'localhost' };
const { call, failureCode, RETRYABLE } = await import('../site/js/api.js');

// navigator is read-only in Node: it is replaced as a whole.
const setOnLine = (value) => Object.defineProperty(globalThis, 'navigator', { value: { onLine: value }, configurable: true });
const codeOf = async (fetchImpl, onLine) => {
  globalThis.fetch = fetchImpl;
  setOnLine(onLine);
  try { await call('auth.me'); return 'ok'; } catch (e) { return e.code; }
};

test('no answer: «server down» when the device is online, «network» when it is not', async () => {
  const refused = async () => { throw new TypeError('Failed to fetch'); };
  const gateway = async () => ({ status: 502, json: async () => { throw new SyntaxError('not json'); } });       // the tunnel is alive, the server is off
  const strange = async () => ({ json: async () => ({ hello: 1 }) });
  assert.deepEqual([await codeOf(refused, true), await codeOf(gateway, true), await codeOf(strange, true), await codeOf(refused, false), await codeOf(refused, undefined)],
    ['server_down', 'server_down', 'server_down', 'network', 'server_down']);
  assert.deepEqual([failureCode(false), failureCode(true), RETRYABLE], ['network', 'server_down', ['network', 'server_down', 'internal']]);
});

test('an answer of the server keeps its code: too_many_attempts, bad_credentials', async () => {
  const answer = (code) => async () => ({ json: async () => ({ ok: false, error: { code } }) });
  assert.deepEqual([await codeOf(answer('too_many_attempts'), true), await codeOf(answer('bad_credentials'), true)], ['too_many_attempts', 'bad_credentials']);
});

test('the six screens take the list of retryable errors from api.js', () => {
  for (const name of ['directory', 'schedule', 'subjects', 'syllabusUpload', 'weekTemplate', 'import']) {
    const text = fs.readFileSync(new URL(`../site/js/views/${name}.js`, import.meta.url), 'utf8');
    assert.match(text, /\bRETRYABLE\b/, name);
    assert.doesNotMatch(text, /\['network', 'internal'\]|=== 'network' \|\|/, name);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.location = { hostname: 'localhost' };
const { call, upload, onSessionEnd, failureCode, RETRYABLE } = await import('../site/js/api.js');
const { setSession, getToken } = await import('../site/js/session.js');

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

// A fake XMLHttpRequest: the test decides how it ends.
function fakeXhr(end) {
  return {
    upload: {}, sent: null, headers: {}, opened: null, status: 0, responseText: '',
    open(method, url) { this.opened = [method, url]; },
    setRequestHeader(name, value) { this.headers[name] = value; },
    send(body) { this.sent = body; queueMicrotask(() => end(this)); },
  };
}

test('upload sends what call sends, reports the progress and returns the data of the answer', async () => {
  setOnLine(true);
  let made = null;
  const progress = [];
  const result = await upload('work.upload', { name: 'a.pdf', data: 'QUJD' }, {
    onProgress: (share) => progress.push(share),
    makeXhr: () => (made = fakeXhr((x) => {
      x.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      x.upload.onprogress({ lengthComputable: false, loaded: 5, total: 0 });
      x.status = 200;
      x.responseText = JSON.stringify({ ok: true, data: { file: { id: 'f1' } } });
      x.onload();
    })),
  });
  assert.deepEqual(result, { file: { id: 'f1' } });
  assert.deepEqual(progress, [0.5]);
  assert.equal(made.opened[0], 'POST');
  assert.equal(made.headers['Content-Type'], 'text/plain;charset=utf-8');
  const sent = JSON.parse(made.sent);
  assert.deepEqual(Object.keys(sent).sort(), ['action', 'data', 'token']);
  assert.deepEqual([sent.action, sent.data], ['work.upload', { name: 'a.pdf', data: 'QUJD' }]);
});

test('upload: an error answer keeps its code and fields; unauthorized ends the session; 413 is too_big; a broken connection is network or server_down', async () => {
  const run = (end, onLine = true) => { setOnLine(onLine); return upload('work.upload', {}, { makeXhr: () => fakeXhr(end) }).then(() => 'ok', (e) => e); };
  const answer = (status, body) => (x) => { x.status = status; x.responseText = typeof body === 'string' ? body : JSON.stringify(body); x.onload(); };
  const invalid = await run(answer(200, { ok: false, error: { code: 'invalid', fields: [{ field: 'data', code: 'bad_file' }] } }));
  assert.deepEqual([invalid.name, invalid.code, invalid.fields], ['ApiError', 'invalid', [{ field: 'data', code: 'bad_file' }]]);
  assert.equal((await run(answer(413, '<html>too large</html>'))).code, 'too_big');
  assert.equal((await run(answer(502, '<html>bad gateway</html>'))).code, 'server_down');
  assert.equal((await run(answer(200, { hello: 1 }))).code, 'server_down');
  assert.equal((await run((x) => x.onerror())).code, 'server_down');
  assert.equal((await run((x) => x.onerror(), false)).code, 'network');
  assert.equal((await run((x) => x.ontimeout())).code, 'upload_slow');
  assert.equal((await run((x) => x.ontimeout(), false)).code, 'upload_slow');
  let seen;
  await upload('work.upload', {}, { makeXhr: () => { const x = fakeXhr((y) => { seen = y.timeout; y.status = 200; y.responseText = '{"ok":true,"data":{}}'; y.onload(); }); return x; } });
  assert.ok(seen >= 300000);
  assert.equal((await run((x) => x.onabort(), false)).code, 'network');
  let ended = 0;
  onSessionEnd(() => { ended += 1; });
  setSession({ token: 'token-1', user: { id: 'u1' } });
  assert.equal(getToken(), 'token-1');
  assert.equal((await run(answer(200, { ok: false, error: { code: 'unauthorized' } }))).code, 'unauthorized');
  assert.deepEqual([getToken(), ended], [null, 1]);
});

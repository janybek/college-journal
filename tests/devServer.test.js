import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { startDevServer } from '../dev/server.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';

function tempDirs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const siteDir = path.join(dir, 'site');
  fs.mkdirSync(siteDir);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<p>HELLO</p>');
  fs.writeFileSync(path.join(siteDir, 'app.js'), 'export const a = 1;');
  return { dir, siteDir, dataFile: path.join(dir, 'data', 'db.json') };
}

async function start(t, options) {
  const srv = await startDevServer({ port: 0, ...options });
  t.after(() => srv.close());
  const post = (body) => fetch(srv.url + '/api', {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body,
  }).then((r) => r.json());
  return { srv, post };
}

test('POST /api logs in a seeded user and rejects garbage', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { post } = await start(t, { dataFile, siteDir });
  const login = await post(JSON.stringify({ action: 'auth.login', data: { login: 'admin', password: DEV_PASSWORD } }));
  assert.equal(login.ok, true);
  assert.equal((await post('мусор')).error.code, 'bad_request');
});

test('GET serves site files and keeps them inside siteDir', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir });
  assert.match(await (await fetch(srv.url + '/')).text(), /HELLO/);
  const js = await fetch(srv.url + '/app.js');
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  assert.equal((await fetch(srv.url + '/nope.html')).status, 404);
  assert.equal((await fetch(srv.url + '/..%2Fpackage.json')).status, 404);
  assert.equal((await fetch(srv.url + '/%2e%2e/%2e%2e/package.json')).status, 404);
});

test('the server starts without a site folder and answers 404', async (t) => {
  const { dir, dataFile } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir: path.join(dir, 'missing') });
  assert.equal((await fetch(srv.url + '/')).status, 404);
});

test('the seed is written once and kept across restarts', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const first = await startDevServer({ port: 0, dataFile, siteDir });
  await first.close();
  const saved = fs.readFileSync(dataFile, 'utf8');
  const second = await startDevServer({ port: 0, dataFile, siteDir });
  await second.close();
  assert.equal(fs.readFileSync(dataFile, 'utf8'), saved);
});

test('seed creates the documented data set and is a no-op when staff exist', () => {
  const platform = createNodePlatform({ now: () => 1 });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  assert.equal(store.list('students').length, 66);
  assert.equal(store.list('groups').length, 3);
  assert.equal(store.list('subjects').length, 3);
  assert.equal(store.list('rooms').length, 3);
  assert.equal(store.list('staff').length, 6);
  assert.equal(store.list('students').filter((s) => s.mustChangePassword).map((s) => s.cardNo).join(), 'S1002');
  assert.equal(store.list('staff').some((s) => s.mustChangePassword), false);
  seed(store, platform);
  assert.equal(store.list('students').length, 66);
});

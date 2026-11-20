import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import http from 'node:http';
import { startDevServer, MAX_BODY_BYTES } from '../dev/server.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { readSettings, DEFAULT_BELLS } from '../core/settings.js';

function tempDirs(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-dev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const siteDir = path.join(dir, 'site');
  fs.mkdirSync(siteDir);
  fs.writeFileSync(path.join(siteDir, 'index.html'), '<p>HELLO</p>');
  fs.writeFileSync(path.join(siteDir, 'app.js'), 'export const a = 1;');
  fs.mkdirSync(path.join(siteDir, 'empty'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'TOP-SECRET');
  fs.mkdirSync(path.join(dir, 'site-secret'));
  fs.writeFileSync(path.join(dir, 'site-secret', 's.txt'), 'TOP-SECRET');
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

const rawGet = (srv, rawPath, method = 'GET') => new Promise((resolve, reject) => {
  const { port } = new URL(srv.url);
  const req = http.request({ host: '127.0.0.1', port, path: rawPath, method }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.end();
});

test('GET serves site files and keeps them inside siteDir', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir });
  assert.match(await (await fetch(srv.url + '/')).text(), /HELLO/);
  assert.match(await (await fetch(srv.url + '/app.js')).text(), /export const a/);
  const js = await fetch(srv.url + '/app.js');
  assert.match(js.headers.get('content-type'), /^text\/javascript/);
  assert.equal((await fetch(srv.url + '/nope.html')).status, 404);
  for (const p of ['/..%2fsecret.txt', '/..%5csecret.txt', '/..%5csite-secret%5cs.txt', '/%2e%2e/secret.txt', '/C:/Windows/win.ini']) {
    const res = await fetch(srv.url + p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /TOP-SECRET/);
  }
  for (const p of ['/../secret.txt', '/../site-secret/s.txt']) {
    const res = await rawGet(srv, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.body, /TOP-SECRET/);
  }
});

test('HEAD, cache header and directories without index.html', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir });
  const head = await rawGet(srv, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await fetch(srv.url + '/')).headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(srv.url + '/empty')).status, 404);
  assert.equal((await fetch(srv.url + '/empty/')).status, 404);
});

test('/api answers 405 to other methods', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir });
  const res = await fetch(srv.url + '/api');
  assert.equal(res.status, 405);
  assert.equal((await res.json()).error.code, 'method_not_allowed');
});

test('an oversized body gets 413 and the default limit is 20 MB', async (t) => {
  assert.equal(MAX_BODY_BYTES, 20 * 1024 * 1024);
  const { dataFile, siteDir } = tempDirs(t);
  const { srv } = await start(t, { dataFile, siteDir, maxBodyBytes: 1024 });
  const res = await fetch(srv.url + '/api', { method: 'POST', body: 'x'.repeat(1025) });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'payload_too_large');
  const ok = await fetch(srv.url + '/api', { method: 'POST', body: JSON.stringify({ action: 'nope' }) });
  assert.equal(ok.status, 200);
});

test('relative dataFile and siteDir resolve against the repository root', async (t) => {
  const root = path.resolve(import.meta.dirname, '..');
  const rel = path.join('dev', 'data', `test-${process.pid}-${Date.now()}`);
  t.after(() => fs.rmSync(path.join(root, rel), { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, rel, 'site'), { recursive: true });
  fs.writeFileSync(path.join(root, rel, 'site', 'index.html'), 'REL-SITE');
  const { srv } = await start(t, { dataFile: path.join(rel, 'db.json'), siteDir: path.join(rel, 'site') });
  assert.match(await (await fetch(srv.url + '/')).text(), /REL-SITE/);
  assert.equal(fs.existsSync(path.join(root, rel, 'db.json')), true);
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
  const platform = createNodePlatform({ now: () => Date.UTC(2026, 10, 21, 6) });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  assert.equal(store.list('students').length, 66);
  assert.equal(store.list('groups').length, 3);
  assert.equal(store.list('rooms').length, 3);
  assert.equal(store.list('staff').length, 6);
  assert.equal(store.list('students').filter((s) => s.mustChangePassword).map((s) => s.cardNo).join(), 'S1002');
  assert.equal(store.list('staff').some((s) => s.mustChangePassword), false);
  assert.deepEqual(readSettings(store.list('settings')),
    { semesterStart: '2026-10-19', semesterEnd: '2027-02-19', holidays: ['2026-11-25'], bells: DEFAULT_BELLS, semester: 1 });
  assert.deepEqual([store.list('subjects').length, store.list('weekTemplate').length, store.list('topics').length, store.list('pairs').length], [6, 9, 54, 159]);
  const pairs = store.list('pairs');
  assert.equal(pairs.filter((p) => p.status === 'cancelled').length, 1);
  assert.deepEqual(pairs.filter((p) => p.note === 'Замена').map((p) => p.date), ['2026-11-26']);

  const groupByName = new Map(store.list('groups').map((g) => [g.name, g.id]));
  const subjects = store.list('subjects');
  for (const [group, planned] of [['01-1', 18], ['02-1', 17]]) {
    const subject = subjects.find((s) => s.name === 'Информатика' && s.groupId === groupByName.get(group));
    const mine = pairs.filter((p) => p.subjectId === subject.id);
    assert.equal(mine.length, 18, group);
    const withTopic = mine.filter((p) => p.topicId !== '');
    assert.equal(withTopic.length, planned, group);
    assert.equal(new Set(withTopic.map((p) => p.topicId)).size, planned, group);
  }
  assert.equal(subjects.filter((s) => s.name === 'Анатомия').every((s) => store.list('topics').every((t) => t.subjectId !== s.id)), true);

  seed(store, platform);
  assert.equal(store.list('students').length, 66);
  assert.equal(store.list('pairs').length, 159);
});

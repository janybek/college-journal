import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { startDevServer, MAX_BODY_BYTES, DATA_FILES, standArgs, seederFor } from '../dev/server.js';
import { seed, seedAdmin, DEV_PASSWORD } from '../dev/seed.js';
import { createFileStore } from '../backend/store/fileStore.js';
import { pairViews } from '../backend/scheduleData.js';
import { verifyPassword } from '../core/auth.js';
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
  assert.deepEqual(store.list('disciplines').map((x) => x.name).sort(), ['Анатомия', 'Информатика']);
  assert.equal(store.list('subjects').every((s) => s.disciplineId !== '' && s.name !== ''), true);
  const staffLogin = new Map(store.list('staff').map((s) => [s.id, s.login]));
  const groupName = new Map(store.list('groups').map((g) => [g.id, g.name]));
  assert.deepEqual(store.list('subjects').map((s) => `${s.name}:${groupName.get(s.groupId)}:${staffLogin.get(s.teacherId)}`).sort(),
    ['Анатомия:01-1:teacher2', 'Анатомия:02-1:teacher2', 'Анатомия:03-1:teacher2',
      'Информатика:01-1:teacher1', 'Информатика:02-1:teacher1', 'Информатика:03-1:teacher3']);
  assert.deepEqual([store.list('subjects').length, store.list('weekTemplate').length, store.list('disciplines').length, store.list('syllabi').length,
    store.list('topics').length, store.list('pairs').length], [6, 9, 2, 2, 17, 159]);
  const groupByName = new Map(store.list('groups').map((g) => [g.name, g.id]));
  const subjectOf = (name, group) => store.list('subjects').find((s) => s.name === name && s.groupId === groupByName.get(group));
  const pairsOf = (subject) => store.list('pairs').filter((p) => p.subjectId === subject.id).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  const labelOf = new Map(store.list('topics').map((t) => [t.id, t.label]));
  // lessonsOfGroup(group): the pairs of the group's «Информатика» that carry a lesson, by date -> [row label, type, part]
  const lessonsOfGroup = (group) => pairsOf(subjectOf('Информатика', group)).filter((p) => p.topicId !== '').map((p) => [labelOf.get(p.topicId), p.lessonType, p.part]);
  assert.deepEqual(lessonsOfGroup('01-1').slice(0, 3), [['1.1', 'lecture', 1], ['1.2', 'lecture', 1], ['1.2', 'practice', 1]]);
  assert.deepEqual([lessonsOfGroup('01-1').length, new Set(lessonsOfGroup('01-1').map(String)).size, lessonsOfGroup('01-1')[17]], [18, 18, ['2.5', 'practice', 1]]);
  // the last pair of 01-1 (2.5, practice) carries the mark of the module
  const last = pairsOf(subjectOf('Информатика', '01-1')).at(-1);
  assert.deepEqual(pairViews(store, (p) => p.id === last.id)[0].topic.controls, [{ name: 'Модуль 2 (рубежный контроль)', unit: 2 }]);
  // 02-1 (same teacher, same syllabus): one pair is cancelled — 17 lessons stand on their dates, the last one (2.5, practice) did not fit
  const of02 = pairsOf(subjectOf('Информатика', '02-1'));
  assert.deepEqual([of02.length, of02.filter((p) => p.status === 'cancelled').length, lessonsOfGroup('02-1')], [18, 1, lessonsOfGroup('01-1').slice(0, 17)]);
  // 03-1 (teacher3, no syllabus) and «Анатомия»: no pair has a lesson
  const bare = new Set([subjectOf('Информатика', '03-1').id, ...store.list('subjects').filter((s) => s.name === 'Анатомия').map((s) => s.id)]);
  assert.equal(store.list('pairs').filter((p) => bare.has(p.subjectId)).every((p) => p.topicId === '' && p.lessonType === '' && p.part === null), true);
  // no pair holds a topic of the second-semester syllabus
  const spring = new Set(store.list('syllabi').filter((s) => s.semester === 2).map((s) => s.id));
  const springTopics = new Set(store.list('topics').filter((t) => spring.has(t.syllabusId)).map((t) => t.id));
  assert.deepEqual([spring.size, store.list('pairs').some((p) => springTopics.has(p.topicId))], [1, false]);
  const pairs = store.list('pairs');
  assert.equal(pairs.filter((p) => p.status === 'cancelled').length, 1);
  assert.deepEqual(pairs.filter((p) => p.note === 'Замена').map((p) => p.date), ['2026-11-26']);
  assert.equal(readSettings(store.list('settings')).semester, 1);

  seed(store, platform);
  assert.equal(store.list('students').length, 66);
  assert.equal(store.list('pairs').length, 159);
});

test('the real-data stand: its own file, one admin, never seeded with fictional people', async (t) => {
  const { dir, siteDir } = tempDirs(t);
  const dataFile = path.join(dir, 'data', 'real.json');
  const first = await startDevServer({ port: 0, dataFile, siteDir, mode: 'real' });
  const login = await fetch(first.url + '/api', { method: 'POST', body: JSON.stringify({ action: 'auth.login', data: { login: 'admin', password: DEV_PASSWORD } }) }).then((r) => r.json());
  await first.close();
  assert.equal(login.ok, true);
  const platform = createNodePlatform();
  const saved = createFileStore(SCHEMA, platform, dataFile);
  assert.deepEqual(saved.list('staff').map((s) => [s.login, s.roles, s.mustChangePassword]), [['admin', 'admin', false]]);
  for (const table of ['groups', 'students', 'disciplines', 'subjects', 'syllabi', 'topics', 'weekTemplate', 'settings', 'pairs']) assert.equal(saved.list(table).length, 0, table);
  // a real group entered by hand survives a restart; the seed is not called on the restart either
  saved.insert('groups', { name: 'СД-11', course: 1 });
  const again = await startDevServer({ port: 0, dataFile, siteDir, mode: 'real' });
  await again.close();
  const reopened = createFileStore(SCHEMA, platform, dataFile);
  assert.deepEqual([reopened.list('groups').map((g) => g.name), reopened.list('staff').length, reopened.list('students').length], [['СД-11'], 1, 0]);
});

test('the fictional seed is never used for the real data file, whatever the mode', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const real = path.resolve(root, DATA_FILES.real);
  assert.equal(seederFor(real, 'demo'), seedAdmin);
  assert.equal(seederFor(real, 'real'), seedAdmin);
  assert.equal(seederFor(path.join(root, 'dev', 'data', '..', 'data', 'real.json'), 'demo'), seedAdmin);       // the same file by another spelling
  assert.equal(seederFor(path.resolve(root, DATA_FILES.demo), 'demo'), seed);
  assert.equal(seederFor(path.join(os.tmpdir(), 'other.json'), 'real'), seedAdmin);
});

test('--reset deletes only the fictional data file; with --real it is refused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-args-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'dev', 'data');
  fs.mkdirSync(data, { recursive: true });
  const exists = () => ['db.json', 'real.json'].map((name) => fs.existsSync(path.join(data, name)));
  for (const name of ['db.json', 'real.json']) fs.writeFileSync(path.join(data, name), '{}');
  assert.deepEqual(DATA_FILES, { demo: 'dev/data/db.json', real: 'dev/data/real.json' });
  assert.deepEqual(standArgs(['--real', '--reset'], root), { error: 'reset_refused' });
  assert.deepEqual(standArgs(['--reset', '--real'], root), { error: 'reset_refused' });
  assert.deepEqual(exists(), [true, true]);                                        // the refusal deleted nothing
  assert.deepEqual(standArgs(['--real'], root), { mode: 'real', dataFile: DATA_FILES.real });
  assert.deepEqual(standArgs([], root), { mode: 'demo', dataFile: DATA_FILES.demo });
  assert.deepEqual(exists(), [true, true]);
  assert.deepEqual(standArgs(['--reset'], root), { mode: 'demo', dataFile: DATA_FILES.demo });
  assert.deepEqual(exists(), [false, true]);                                       // --reset does not touch real.json
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const launch = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '.claude', 'launch.json'), 'utf8'));
  assert.equal(pkg.scripts['dev:real'], 'node dev/server.js --real');
  assert.deepEqual(launch.configurations.find((c) => c.name === 'journal-dev-real'),
    { name: 'journal-dev-real', runtimeExecutable: 'node', runtimeArgs: ['dev/server.js', '--real'], port: 5273 });
});

test('seedAdmin: one admin on an empty store, nothing when staff exist', () => {
  const platform = createNodePlatform({ now: () => Date.UTC(2026, 10, 21, 6) });
  const store = createMemoryStore(SCHEMA, platform);
  seedAdmin(store, platform);
  seedAdmin(store, platform);
  assert.deepEqual(store.list('staff').map((s) => [s.login, s.fullName, s.roles, s.active, s.mustChangePassword]), [['admin', 'Admin Demo', 'admin', true, false]]);
  assert.equal(verifyPassword(platform, DEV_PASSWORD, store.list('staff')[0].passwordHash), true);
});

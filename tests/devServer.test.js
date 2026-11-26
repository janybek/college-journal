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
import { seed, seedAdmin, prepareLessonNow, DEV_PASSWORD } from '../dev/seed.js';
import { createFileStore } from '../backend/store/fileStore.js';
import { pairViews } from '../backend/scheduleData.js';
import { verifyPassword } from '../core/auth.js';
import { readSettings, DEFAULT_BELLS } from '../core/settings.js';
import { LOGIN_LIMIT } from '../core/loginGuard.js';
import { handleRequest } from '../backend/api.js';
import { bishkek, dev } from './journalSetup.js';

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
    { semesterStart: '2026-09-14', semesterEnd: '2027-01-15', holidays: ['2026-11-25'], bells: DEFAULT_BELLS, semester: 1 });
  assert.deepEqual(store.list('disciplines').map((x) => x.name).sort(), ['Анатомия', 'Информатика']);
  assert.equal(store.list('subjects').every((s) => s.disciplineId !== '' && s.name !== ''), true);
  const staffLogin = new Map(store.list('staff').map((s) => [s.id, s.login]));
  const groupName = new Map(store.list('groups').map((g) => [g.id, g.name]));
  assert.deepEqual(store.list('subjects').map((s) => `${s.name}:${groupName.get(s.groupId)}:${staffLogin.get(s.teacherId)}`).sort(),
    ['Анатомия:01-1:teacher2', 'Анатомия:02-1:teacher2', 'Анатомия:03-1:teacher2',
      'Информатика:01-1:teacher1', 'Информатика:02-1:teacher1', 'Информатика:03-1:teacher3']);
  // one syllabus of the 1st semester serves both groups of teacher1, so both are on the 1st course (M6); the student numbers keep their prefixes
  assert.deepEqual(store.list('groups').map((g) => [g.name, g.course, store.list('students').find((s) => s.groupId === g.id).cardNo]),
    [['01-1', 1, 'S1001'], ['02-1', 1, 'S2001'], ['03-1', 2, 'S3001']]);
  assert.deepEqual([store.list('subjects').length, store.list('weekTemplate').length, store.list('disciplines').length], [6, 9, 2]);
  const login = new Map(store.list('staff').map((s) => [s.id, s.login]));
  const discipline = new Map(store.list('disciplines').map((d) => [d.id, d.name]));
  assert.deepEqual(store.list('syllabi').map((s) => [discipline.get(s.disciplineId), login.get(s.teacherId), s.semester, s.version, s.status]).sort(),
    [['Анатомия', 'teacher2', 1, 1, 'review'], ['Информатика', 'teacher1', 1, 1, 'archived'], ['Информатика', 'teacher1', 1, 2, 'approved'], ['Информатика', 'teacher1', 1, 3, 'returned'],
      ['Информатика', 'teacher1', 2, 2, 'approved'], ['Информатика', 'teacher1', 2, 3, 'returned']]);   // a new version covers both halves: one number in both
  const informatics1 = store.list('syllabi').find((s) => login.get(s.teacherId) === 'teacher1' && s.semester === 1 && s.status === 'approved').id;
  for (const table of ['units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules']) {
    assert.equal(store.list(table).some((r) => r.syllabusId === informatics1), true, table);
  }
  // topic rows 80: «Информатика» has the rows of both halves of three versions (the first archived, the second approved, the third returned), «Анатомия» 6
  assert.deepEqual([store.list('topics').length, store.list('pairs').length], [80, 159]);
  const returned = store.list('syllabi').find((s) => s.status === 'returned');
  assert.deepEqual([returned.remark, store.list('topics').filter((t) => t.syllabusId === returned.id).length], ['Добавьте литературу к юниту 2', 20]);
  const anatomy = store.list('syllabi').find((s) => discipline.get(s.disciplineId) === 'Анатомия');
  const anatomyRows = store.list('topics').filter((t) => t.syllabusId === anatomy.id).sort((a, b) => a.order - b.order);
  assert.deepEqual([anatomyRows.length, anatomyRows[0].name, anatomyRows.some((t) => t.lessonKind === 'control'), new Set(anatomyRows.map((t) => t.unit)).size],
    [6, 'Жалпы анатомия', false, 2]);
  assert.equal(store.list('literature').some((b) => b.syllabusId === anatomy.id), false);
  const groupByName = new Map(store.list('groups').map((g) => [g.name, g.id]));
  const subjectOf = (name, group) => store.list('subjects').find((s) => s.name === name && s.groupId === groupByName.get(group));
  const pairsOf = (subject) => store.list('pairs').filter((p) => p.subjectId === subject.id).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  // the pairs of 01-1, 02-1 and 03-1 carry the lessons of the approved version 1 (one syllabus of the discipline); «Анатомия» has no approved one, so no pair with a lesson
  const approvedRows = new Set(store.list('topics').filter((t) => t.syllabusId === informatics1).map((t) => t.id));
  const withTopic = (name, group) => pairsOf(subjectOf(name, group)).filter((p) => p.topicId !== '');
  assert.equal(['01-1', '02-1', '03-1'].every((g) => withTopic('Информатика', g).length > 0 && withTopic('Информатика', g).every((p) => approvedRows.has(p.topicId))), true);
  assert.deepEqual([withTopic('Информатика', '03-1').length, ...['01-1', '02-1', '03-1'].map((g) => withTopic('Анатомия', g).length)], [18, 0, 0, 0]);
  const INTRO = 'Цифровой пост медсестры: введение в IT';
  const PROGRAMS = 'Рабочие программы: Windows, МИС и утилиты';
  const TABLES = 'Электронные таблицы: учёт лекарств и расчёт доз';
  const nameOf = new Map(store.list('topics').map((t) => [t.id, t.name]));
  // lessonsOfGroup(group): the pairs of the group's «Информатика» that carry a lesson, by date -> [topic name, type, part]
  const lessonsOfGroup = (group) => pairsOf(subjectOf('Информатика', group)).filter((p) => p.topicId !== '').map((p) => [nameOf.get(p.topicId), p.lessonType, p.part]);
  assert.deepEqual(lessonsOfGroup('01-1').slice(0, 3), [[INTRO, 'lecture', 1], [PROGRAMS, 'lecture', 1], [PROGRAMS, 'practice', 1]]);
  assert.deepEqual([lessonsOfGroup('01-1').length, new Set(lessonsOfGroup('01-1').map(String)).size, lessonsOfGroup('01-1')[17]], [18, 18, [TABLES, 'practice', 1]]);
  // the last pair of 01-1 (the tables topic, practice) carries the mark of the module
  const last = pairsOf(subjectOf('Информатика', '01-1')).at(-1);
  assert.deepEqual(pairViews(store, (p) => p.id === last.id)[0].topic.controls, [{ name: 'Модуль 2 (рубежный контроль)', unit: 2 }]);
  // 02-1 (same teacher, same syllabus): one pair is cancelled — 17 lessons stand on their dates, the last one (the tables topic, practice) did not fit
  const of02 = pairsOf(subjectOf('Информатика', '02-1'));
  assert.deepEqual([of02.length, of02.filter((p) => p.status === 'cancelled').length, lessonsOfGroup('02-1')], [18, 1, lessonsOfGroup('01-1').slice(0, 17)]);
  // «Анатомия» (only a version under review): no pair has a lesson
  const bare = new Set(store.list('subjects').filter((s) => s.name === 'Анатомия').map((s) => s.id));
  assert.equal(store.list('pairs').filter((p) => bare.has(p.subjectId)).every((p) => p.topicId === '' && p.lessonType === '' && p.part === null), true);
  // no pair holds a topic of the second-semester syllabus
  const spring = new Set(store.list('syllabi').filter((s) => s.semester === 2).map((s) => s.id));
  const springTopics = new Set(store.list('topics').filter((t) => spring.has(t.syllabusId)).map((t) => t.id));
  assert.deepEqual([spring.size, store.list('pairs').some((p) => springTopics.has(p.topicId))], [2, false]);
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

test('a freshly seeded stand is not upgraded on the second start: same bytes, no copy', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  await (await startDevServer({ port: 0, dataFile, siteDir })).close();
  const saved = fs.readFileSync(dataFile, 'utf8');
  await (await startDevServer({ port: 0, dataFile, siteDir })).close();
  assert.deepEqual([fs.readFileSync(dataFile, 'utf8'), fs.existsSync(dataFile + '.before-addendum-3.bak')], [saved, false]);
});

test('the stand limits login attempts by the same rule; a restart clears the count', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const { post, srv } = await start(t, { dataFile, siteDir });
  const wrong = JSON.stringify({ action: 'auth.login', data: { login: 'teacher1', password: 'x' } });
  for (let i = 0; i < LOGIN_LIMIT.attempts; i++) assert.equal((await post(wrong)).error.code, 'bad_credentials');
  const right = JSON.stringify({ action: 'auth.login', data: { login: 'teacher1', password: DEV_PASSWORD } });
  assert.deepEqual([(await post(right)).error.code, (await post(JSON.stringify({ action: 'auth.login', data: { login: 'dean', password: DEV_PASSWORD } }))).ok], ['too_many_attempts', true]);
  await srv.close();
  const again = await start(t, { dataFile, siteDir });
  assert.equal((await again.post(right)).ok, true);
});

// A stand of the fictional people with a clock that stands where the test puts it (Bishkek time).
function lessonStand(date, time) {
  const now = bishkek(date, time);
  const platform = createNodePlatform({ now: () => now, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store, platform, log: () => {} });
  const login = (name) => call('auth.login', { login: name, password: DEV_PASSWORD }).data.token;
  const pairsOf = () => store.list('pairs');
  const subject = store.list('subjects').find((x) => x.name === 'Информатика' && x.groupId === store.list('groups').find((g) => g.name === '01-1').id);
  const ownPairs = () => pairsOf().filter((x) => x.subjectId === subject.id);
  return { store, platform, call, login, pairsOf, ownPairs };
}

test('--lesson-now: the flag is read, the key appears only with it, the real stand refuses it', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-args-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'dev', 'data');
  fs.mkdirSync(data, { recursive: true });
  for (const name of ['db.json', 'real.json']) fs.writeFileSync(path.join(data, name), '{"keep":1}');
  assert.deepEqual(standArgs(['--real', '--lesson-now'], root), { error: 'lesson_refused' });
  assert.deepEqual(standArgs(['--lesson-now', '--real'], root), { error: 'lesson_refused' });
  assert.deepEqual(['db.json', 'real.json'].map((name) => fs.readFileSync(path.join(data, name), 'utf8')), ['{"keep":1}', '{"keep":1}']);
  assert.deepEqual(standArgs(['--lesson-now'], root), { mode: 'demo', dataFile: DATA_FILES.demo, lessonNow: true });
  assert.equal(fs.existsSync(path.join(data, 'db.json')), true);
  assert.deepEqual(standArgs(['--reset', '--lesson-now'], root), { mode: 'demo', dataFile: DATA_FILES.demo, lessonNow: true });
  assert.equal(fs.existsSync(path.join(data, 'db.json')), false);
  assert.deepEqual(standArgs([], root), { mode: 'demo', dataFile: DATA_FILES.demo });
  assert.deepEqual(standArgs(['--real'], root), { mode: 'real', dataFile: DATA_FILES.real });
  assert.equal(fs.readFileSync(path.join(data, 'real.json'), 'utf8'), '{"keep":1}');
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const launch = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '.claude', 'launch.json'), 'utf8'));
  assert.equal(pkg.scripts['dev:lesson'], 'node dev/server.js --reset --lesson-now');
  assert.deepEqual(launch.configurations.find((c) => c.name === 'journal-dev-lesson'),
    { name: 'journal-dev-lesson', runtimeExecutable: 'node', runtimeArgs: ['dev/server.js', '--reset', '--lesson-now'], port: 5273 });
});

test('prepareLessonNow: Wednesday 12:03 - the nearest informatics pair of 01-1 comes to today at 12:00 and works end to end', () => {
  const s = lessonStand('2026-11-18', '12:03');
  const before = s.pairsOf();
  assert.equal(s.ownPairs().some((x) => x.date === '2026-11-18'), false);
  const nearest = s.ownPairs().filter((x) => x.date > '2026-11-18' && x.status === 'planned').sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot)[0];
  const id = prepareLessonNow(s.store, s.platform);
  assert.equal(id, nearest.id);
  const moved = s.store.get('pairs', id);
  assert.deepEqual([moved.date, moved.startTime, moved.changed, moved.slot, moved.topicId, moved.status], ['2026-11-18', '12:00', true, nearest.slot, nearest.topicId, 'planned']);
  assert.deepEqual(s.pairsOf().filter((x) => x.id !== id), before.filter((x) => x.id !== id));
  const teacher = s.login('teacher1');
  const mine = s.call('lesson.mine', {}, teacher).data.pairs;
  assert.deepEqual(mine.map((x) => [x.id, x.lesson, x.startTime, x.problem]), [[id, 'start', '12:00', null]]);
  assert.equal(s.call('lesson.start', { pairId: id }, teacher).ok, true);
  const code = s.call('lesson.get', { pairId: id }, teacher).data.lesson.code.now;
  const marked = s.call('checkin.mark', { pairId: id, device: dev(1), code }, s.login('S1001'));
  assert.deepEqual([marked.ok, marked.data.result], [true, 'ok']);
});

test('prepareLessonNow: Monday - the informatics pair of today is taken, only its time changes, no other pair moves', () => {
  const s = lessonStand('2026-11-16', '12:03');
  const before = s.pairsOf();
  const today = s.ownPairs().filter((x) => x.date === '2026-11-16');
  assert.equal(today.length, 1);
  const id = prepareLessonNow(s.store, s.platform);
  assert.equal(id, today[0].id);
  assert.deepEqual(s.pairsOf().filter((x) => x.id !== id), before.filter((x) => x.id !== id));
  assert.deepEqual(s.store.get('pairs', id), { ...today[0], startTime: '12:00' });
  assert.equal(s.call('lesson.start', { pairId: id }, s.login('teacher1')).ok, true);
});

test('prepareLessonNow: the time is rounded down to 5 minutes; after 22:00 it is now minus 10 minutes, not later than 22:25; after 23:30 nothing', () => {
  const timeAt = (clock) => {
    const s = lessonStand('2026-11-18', clock);
    const id = prepareLessonNow(s.store, s.platform);
    return id === null ? null : s.store.get('pairs', id).startTime;
  };
  assert.equal(timeAt('09:59'), '09:55');
  assert.equal(timeAt('21:59'), '21:55');
  assert.equal(timeAt('22:05'), '21:55');
  assert.equal(timeAt('22:40'), '22:25');
  assert.equal(timeAt('23:29'), '22:25');
  const late = lessonStand('2026-11-18', '23:30');
  const before = late.pairsOf();
  const logged = [];
  const log = console.log;
  console.log = (...args) => logged.push(args.join(' '));
  try { assert.equal(prepareLessonNow(late.store, late.platform), null); } finally { console.log = log; }
  assert.equal(logged.length, 1);
  assert.deepEqual(late.pairsOf(), before);
});

test('the stand moves a pair with --lesson-now only: without the flag every pair keeps its bell time', async (t) => {
  const { dataFile, siteDir } = tempDirs(t);
  const plain = await startDevServer({ port: 0, dataFile, siteDir });
  await plain.close();
  const platform = createNodePlatform();
  const bells = new Set(DEFAULT_BELLS);
  assert.equal(createFileStore(SCHEMA, platform, dataFile).list('pairs').every((x) => bells.has(x.startTime)), true);
  const minutes = new Date(platform.now() + 6 * 3600000).toISOString().slice(11, 16).split(':').reduce((h, m) => h * 60 + Number(m));
  if (minutes >= 23 * 60 + 30) return;       // after 23:30 the stand prepares no pair (checked above with a fixed clock)
  const other = tempDirs(t);
  const lesson = await startDevServer({ port: 0, dataFile: other.dataFile, siteDir: other.siteDir, lessonNow: true });
  await lesson.close();
  const store = createFileStore(SCHEMA, platform, other.dataFile);
  assert.equal(store.list('pairs').filter((x) => !bells.has(x.startTime)).length <= 1, true);
  assert.equal(store.list('pairs').some((x) => x.startedAt !== ''), false);
});

test('--reset clears the box of the fictional stand and never real-files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-args-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'dev', 'data');
  for (const dir of ['files', 'real-files']) {
    fs.mkdirSync(path.join(data, dir), { recursive: true });
    fs.writeFileSync(path.join(data, dir, 'ab'.repeat(16) + '.bin'), 'x');
  }
  standArgs(['--real'], root);
  assert.deepEqual([fs.readdirSync(path.join(data, 'files')).length, fs.readdirSync(path.join(data, 'real-files')).length], [1, 1]);
  assert.deepEqual(standArgs(['--real', '--reset'], root), { error: 'reset_refused' });
  assert.deepEqual([fs.readdirSync(path.join(data, 'files')).length, fs.readdirSync(path.join(data, 'real-files')).length], [1, 1]);
  standArgs(['--reset'], root);
  assert.deepEqual([fs.existsSync(path.join(data, 'files')), fs.readdirSync(path.join(data, 'real-files')).length], [false, 1]);
});

test('the stand keeps its box beside the data file (files for the fictional, real-files for the real one) and sweeps an old orphan at the start', async (t) => {
  for (const [mode, folder] of [['demo', 'files'], ['real', 'real-files']]) {
    const { dataFile, siteDir } = tempDirs(t);
    const box = path.join(path.dirname(dataFile), folder);
    fs.mkdirSync(box, { recursive: true });
    const orphan = path.join(box, 'ab'.repeat(16) + '.bin');
    fs.writeFileSync(orphan, 'x');
    const old = new Date(Date.now() - 5 * 3600000);
    fs.utimesSync(orphan, old, old);
    const { srv } = await start(t, { dataFile, siteDir, mode });
    assert.deepEqual([path.dirname(srv.filesDir), path.basename(srv.filesDir), fs.existsSync(orphan)], [path.dirname(dataFile), folder, false], mode);
  }
});

test('a fresh fictional stand has the assignments of «Информатика» 01-1 and two files in its box; the real one has neither', async (t) => {
  for (const mode of ['demo', 'real']) {
    const { dataFile, siteDir } = tempDirs(t);
    const { srv } = await start(t, { dataFile, siteDir, mode });
    const saved = createFileStore(SCHEMA, createNodePlatform(), dataFile);
    const names = fs.existsSync(srv.filesDir) ? fs.readdirSync(srv.filesDir) : [];
    if (mode === 'demo') {
      assert.deepEqual([saved.list('assignments').length, saved.list('files').length, saved.list('files').map((f) => f.stored).sort()], [3, 2, [...names].sort()], mode);
    } else {
      assert.deepEqual([saved.list('assignments').length, saved.list('files').length, names.length], [0, 0, 0], mode);
    }
  }
});

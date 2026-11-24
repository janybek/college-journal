import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../backend/api.js';
import { main, EXIT } from '../backend/node/server.js';
import { PASSWORD_FILE } from '../backend/node/demo.js';
import { initBase, restoreBase } from '../backend/node/base.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { envOf, open, snapshotStaff, tempBase, tempConfig } from './serverSetup.js';

const NOW = () => Date.UTC(2026, 10, 22, 6);
const run = (config, out) => main(['--demo'], { env: envOf(config), root: config.root, out: (line) => out.push(line), now: NOW });
const passwordFile = (config) => path.join(config.alertDir, PASSWORD_FILE);
const passwordOf = (config) => /Пароль у всех один: (\S+)/.exec(fs.readFileSync(passwordFile(config), 'utf8'))[1];
const loginOf = (base, login, password) => handleRequest({ action: 'auth.login', data: { login, password } }, { store: base.store, platform: base.platform });
const copies = (config) => (fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir).filter((n) => /^journal-before-demo-/.test(n)) : []);

function emptyBase(t) {
  const config = tempConfig(t);
  initBase(config);
  return config;
}

test('--demo on an empty base: the administrator is kept, 5 staff and 66 students with Cyrillic names, the password only in the file', async (t) => {
  const config = emptyBase(t);
  const adminBefore = snapshotStaff(config)[0];
  const out = [];
  assert.equal((await run(config, out)).code, EXIT.ok);
  const base = open(t, config);
  const staff = base.store.list('staff');
  assert.deepEqual(staff.map((s) => s.login), ['admin', 'dean', 'prorector', 'teacher1', 'teacher2', 'teacher3']);
  assert.deepEqual(staff[0], adminBefore);                                           // the row of the administrator is the same, field for field
  assert.deepEqual(staff.slice(1).map((s) => s.fullName), ['Деканат Демо', 'Проректор Демо', 'Преподаватель Один', 'Преподаватель Два', 'Преподаватель Три']);
  const students = base.store.list('students');
  assert.equal(students.length, 66);
  assert.equal(students.every((s) => /^[А-ЯЁӨҮҢ][а-яёөүң]+ [А-ЯЁӨҮҢ][а-яёөүң]+$/.test(s.fullName) && !s.mustChangePassword), true);
  assert.equal(base.store.list('groups').length, 3);
  assert.equal(base.store.list('pairs').length > 0, true);
  assert.equal(base.store.list('syllabi').length > 0, true);
  // the password: from the file, one for everybody; the stand password does not work
  const password = passwordOf(config);
  assert.equal(password.length >= 16, true);
  for (const who of ['dean', 'prorector', 'teacher1', 'teacher3', 'S1001', 'S1002', 'S3022']) assert.equal(loginOf(base, who, password).ok, true, who);
  assert.deepEqual([loginOf(base, 'dean', DEV_PASSWORD).error.code, loginOf(base, 'S1001', DEV_PASSWORD).error.code], ['bad_credentials', 'bad_credentials']);
  assert.equal(loginOf(base, 'dean', password).data.user.mustChangePassword, false);
  // the password is neither in the output nor in the log nor in the base files
  assert.equal(out.join('\n').includes(password), false);
  assert.match(out.join('\n'), /Пробные данные залиты; пароль записан в файл /);
  const log = fs.readFileSync(config.logFile, 'utf8');
  assert.equal(log.includes(password), false);
  assert.match(log, /demo data added/);
  base.close();
  for (const entry of fs.readdirSync(config.dataDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) assert.equal(fs.readFileSync(path.join(entry.parentPath, entry.name)).includes(password), false, entry.name);
  }
  assert.match(fs.readFileSync(passwordFile(config), 'utf8'), /удалите файл после очистки базы/);
});

test('--demo: a copy of the base is made before the change, under a name the daily copy does not touch, and it has the empty base', async (t) => {
  const config = emptyBase(t);
  assert.equal((await run(config, [])).code, EXIT.ok);
  assert.equal(copies(config).length, 1);
  const db = new DatabaseSync(path.join(config.backupDir, copies(config)[0]), { readOnly: true });
  try {
    assert.deepEqual([db.prepare('SELECT count(*) AS n FROM "staff"').get().n, db.prepare('SELECT count(*) AS n FROM "students"').get().n], [1, 0]);
  } finally {
    db.close();
  }
});

test('--demo twice: the second run refuses and changes nothing', async (t) => {
  const config = emptyBase(t);
  await run(config, []);
  const password = passwordOf(config);
  const before = snapshotStaff(config);
  const out = [];
  assert.equal((await run(config, out)).code, EXIT.config);
  assert.match(out.join('\n'), /Файл .* уже есть|уже есть данные/);
  assert.deepEqual(snapshotStaff(config), before);
  assert.equal(passwordOf(config), password);
  assert.equal(copies(config).length, 1);
  fs.rmSync(passwordFile(config));                                           // without the file the refusal is by the data
  const again = [];
  assert.equal((await run(config, again)).code, EXIT.config);
  assert.match(again.join('\n'), /только в пустую базу/);
  assert.equal(fs.existsSync(passwordFile(config)), false);
  assert.deepEqual(snapshotStaff(config), before);
});

test('--demo on a base with one more person or any data: refused, nothing changes, no file, no copy', async (t) => {
  const { config } = tempBase(t);                                            // the administrator and one more person
  const before = snapshotStaff(config);
  const out = [];
  assert.equal((await run(config, out)).code, EXIT.config);
  assert.match(out.join('\n'), /только в пустую базу/);
  assert.deepEqual([snapshotStaff(config), fs.existsSync(passwordFile(config)), copies(config).length], [before, false, 0]);
  // a base with the administrator alone but with a room
  const other = emptyBase(t);
  const base = open(t, other);
  base.store.insert('rooms', { name: '1' });
  base.close();
  const said = [];
  assert.equal((await run(other, said)).code, EXIT.config);
  assert.match(said.join('\n'), /только в пустую базу/);
  assert.equal(fs.existsSync(passwordFile(other)), false);
});

test('--demo without alertDir: refused with a phrase, nothing is made', async (t) => {
  const config = emptyBase(t);
  const env = { ...envOf(config) };
  delete env.JOURNAL_ALERT_DIR;
  const out = [];
  const result = await main(['--demo'], { env, root: config.root, out: (line) => out.push(line), now: NOW });
  assert.equal(result.code, EXIT.config);
  assert.match(out.join('\n'), /alertDir/);
  assert.deepEqual([snapshotStaff(config).length, copies(config).length], [1, 0]);
});

test('--demo while the supervisor of the server is alive: refused', async (t) => {
  const config = emptyBase(t);
  fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: process.pid, startedAt: NOW(), seenAt: Date.now() }));
  const out = [];
  assert.equal((await run(config, out)).code, EXIT.config);
  assert.match(out.join('\n'), /npm run serve:stop/);
  assert.deepEqual([snapshotStaff(config).length, fs.existsSync(passwordFile(config))], [1, false]);
});

test('--demo with a copy that cannot be made: refused, nothing changes', async (t) => {
  const config = emptyBase(t);
  fs.writeFileSync(config.backupDir, 'a file instead of the folder');          // the folder of copies cannot be made
  const out = [];
  assert.equal((await run(config, out)).code, EXIT.crash);
  assert.match(out.join('\n'), /Копия базы не сделана/);
  assert.deepEqual([snapshotStaff(config).length, fs.existsSync(passwordFile(config))], [1, false]);
});

test('the stand is as before: Latin names and the stand password', () => {
  const platform = createNodePlatform({ now: NOW });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  assert.deepEqual(store.list('staff').map((s) => s.fullName), ['Admin Demo', 'Dean Demo', 'Prorector Demo', 'Teacher One', 'Teacher Two', 'Teacher Three']);
  assert.equal(handleRequest({ action: 'auth.login', data: { login: 'dean', password: DEV_PASSWORD } }, { store, platform }).ok, true);
});

// the real process: the entry point with its top-level await, not main() called from a test
function spawnDemo(config, args = ['--demo']) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'backend', 'node', 'server.js'), ...args], { env: { ...process.env, ...envOf(config) }, windowsHide: true });
    let text = '';
    child.stdout.on('data', (c) => { text += c; });
    child.stderr.on('data', (c) => { text += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('the process did not finish: ' + text)); }, 20000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, text }); });
  });
}

test('the real process: node server.js --demo finishes with 0, writes the file, prints no password; a second run ends with 2', async (t) => {
  const config = emptyBase(t);
  const first = await spawnDemo(config);
  assert.equal(first.code, 0, first.text);
  assert.match(first.text, /Пробные данные залиты/);
  assert.equal(first.text.includes(passwordOf(config)), false);
  const second = await spawnDemo(config);
  assert.equal(second.code, 2, second.text);
  assert.equal(second.text.includes(passwordOf(config)), false);
  const { config: other } = tempBase(t);
  const third = await spawnDemo(other);
  assert.equal(third.code, 2, third.text);
  assert.match(third.text, /только в пустую базу/);
});

// --wipe: the owner's own test records are erased, the administrator stays, the demo data come
const runWipe = (config, out) => main(['--demo', '--wipe'], { env: envOf(config), root: config.root, out: (line) => out.push(line), now: NOW });

function withOldRecords(t) {
  const config = emptyBase(t);
  const base = open(t, config);
  const { store } = base;
  const group = store.insert('groups', { name: 'OLD-1', course: 1 });
  store.insert('students', { fullName: 'Старый Студент', groupId: group.id, cardNo: 'X1', passwordHash: 'x', mustChangePassword: false, active: true, lang: 'ru' });
  const teacher = store.insert('staff', { login: 'old', fullName: 'Старый Преподаватель', roles: 'teacher', passwordHash: 'x', mustChangePassword: false, active: true, lang: 'ru' });
  const discipline = store.insert('disciplines', { name: 'Старая дисциплина' });
  const room = store.insert('rooms', { name: 'OLD' });
  const subject = store.insert('subjects', { name: 'Старая дисциплина', disciplineId: discipline.id, teacherId: teacher.id, groupId: group.id, scheme: 'A' });
  store.insert('weekTemplate', { weekday: 1, slot: 1, subjectId: subject.id, roomId: room.id });
  store.insert('settings', { key: 'semester', value: '1' });
  const syllabus = store.insert('syllabi', { disciplineId: discipline.id, teacherId: teacher.id, semester: 1, version: 1 });
  store.insert('topics', { syllabusId: syllabus.id, order: 1, unit: 1, name: 'Старая тема', hours: 2 });
  base.close();
  return config;
}

const countIn = (file, table) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n; } finally { db.close(); }
};

test('--demo --wipe: old records are erased, the administrator is the same, demo data are in, the copy keeps the old ones and restores them', async (t) => {
  const config = withOldRecords(t);
  const adminBefore = snapshotStaff(config)[0];
  const out = [];
  assert.equal((await runWipe(config, out)).code, EXIT.ok, out.join('\n'));
  assert.match(out.join('\n'), /Стёрто строк: \d+/);
  assert.equal(out.join('\n').includes('Старый'), false);
  assert.match(fs.readFileSync(config.logFile, 'utf8'), /demo data added \(wiped \d+ rows\)/);
  const base = open(t, config);
  assert.equal(base.store.list('groups').some((g) => g.name === 'OLD-1'), false);
  assert.equal(base.store.list('rooms').some((r) => r.name === 'OLD'), false);
  assert.equal(base.store.list('staff').some((s) => s.login === 'old'), false);
  assert.deepEqual(base.store.list('staff')[0], adminBefore);
  assert.deepEqual([base.store.list('staff').length, base.store.list('students').length, base.store.list('groups').length], [6, 66, 3]);
  assert.equal(loginOf(base, 'dean', passwordOf(config)).ok, true);
  base.close();
  const copy = path.join(config.backupDir, copies(config)[0]);
  assert.deepEqual([countIn(copy, 'groups'), countIn(copy, 'students'), countIn(copy, 'syllabi'), countIn(copy, 'staff')], [1, 1, 1, 2]);
  restoreBase(config, copy);
  const back = open(t, config);
  assert.deepEqual([back.store.list('groups').map((g) => g.name), back.store.list('staff').map((s) => s.login)], [['OLD-1'], ['admin', 'old']]);
});

test('--demo without --wipe on a base with old records still refuses; --wipe refuses without alertDir, with the file, or while the supervisor lives', async (t) => {
  const config = withOldRecords(t);
  const before = JSON.stringify(snapshotStaff(config));
  assert.equal((await run(config, [])).code, EXIT.config);
  const env = { ...envOf(config) };
  delete env.JOURNAL_ALERT_DIR;
  assert.equal((await main(['--demo', '--wipe'], { env, root: config.root, out: () => {}, now: NOW })).code, EXIT.config);
  fs.writeFileSync(passwordFile(config), 'old file');
  assert.equal((await runWipe(config, [])).code, EXIT.config);
  fs.rmSync(passwordFile(config));
  fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: process.pid, startedAt: NOW(), seenAt: Date.now() }));
  assert.equal((await runWipe(config, [])).code, EXIT.config);
  fs.rmSync(config.supervisorFile);
  assert.deepEqual([JSON.stringify(snapshotStaff(config)), copies(config).length, fs.existsSync(passwordFile(config))], [before, 0, false]);
  const base = open(t, config);
  assert.equal(base.store.list('groups').length, 1);
});

test('--demo --wipe without the administrator: refused, nothing changes', async (t) => {
  const config = withOldRecords(t);
  const base = open(t, config);
  base.db.exec(`DELETE FROM "staff" WHERE "login" = 'admin'`);
  base.close();
  const out = [];
  assert.equal((await runWipe(config, out)).code, EXIT.config);
  assert.match(out.join('\n'), /нет администратора/);
  assert.equal(open(t, config).store.list('groups').length, 1);
});

test('the real process: node server.js --demo --wipe ends with 0', async (t) => {
  const config = withOldRecords(t);
  const result = await spawnDemo(config, ['--demo', '--wipe']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /Пробные данные залиты/);
  assert.equal(result.text.includes(passwordOf(config)), false);
});

test('--demo: the assignments, their works and one picture come with the people; --wipe erases them with everything else and keeps the old picture in the mirror', async (t) => {
  const config = emptyBase(t);
  assert.equal((await run(config, [])).code, EXIT.ok);
  const first = open(t, config);
  assert.deepEqual([first.store.list('assignments').length, first.store.list('submissions').length, first.store.list('files').length], [3, 7, 1]);
  const logRows = first.store.list('changeLog').length;
  const oldName = first.store.list('files')[0].stored;
  first.close();
  assert.deepEqual(fs.readdirSync(config.filesDir), [oldName]);
  fs.rmSync(passwordFile(config));
  assert.equal((await runWipe(config, [])).code, EXIT.ok);
  const second = open(t, config);
  assert.deepEqual([second.store.list('assignments').length, second.store.list('submissions').length, second.store.list('files').length, second.store.list('changeLog').length], [3, 7, 1, logRows]);
  const newName = second.store.list('files')[0].stored;
  second.close();
  assert.notEqual(newName, oldName);
  assert.equal(fs.existsSync(path.join(config.backupDir, 'files', oldName)), true);
  assert.equal(fs.existsSync(path.join(config.filesDir, newName)), true);
});

test('--demo: the ledger, the requests, the announcements and the exams come with the people; --wipe erases them and writes them again, the same count', async (t) => {
  const config = emptyBase(t);
  assert.equal((await run(config, [])).code, EXIT.ok);
  const tables = ['closures', 'requests', 'announcements', 'stateExams', 'stateExamResults', 'subjectExams', 'examAttempts'];
  const first = open(t, config);
  const counts = tables.map((name) => first.store.list(name).length);
  assert.deepEqual(counts.slice(0, 4), [3, 4, 3, 1]);
  assert.equal(counts.every((n) => n > 0), true);
  // an old record of the owner in a new table must go with the wipe
  first.store.insert('announcements', { authorId: 'st_old', audience: 'all', title: 'Старое объявление', createdAt: '2026-01-01 10:00:00' });
  first.close();
  fs.rmSync(passwordFile(config));
  assert.equal((await runWipe(config, [])).code, EXIT.ok);
  const second = open(t, config);
  assert.deepEqual(tables.map((name) => second.store.list(name).length), counts);
  assert.equal(second.store.list('announcements').some((r) => r.title === 'Старое объявление'), false);
  second.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handleRequest } from '../backend/api.js';
import { main, EXIT } from '../backend/node/server.js';
import { PASSWORD_FILE } from '../backend/node/demo.js';
import { initBase } from '../backend/node/base.js';
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
  for (const name of fs.readdirSync(config.dataDir)) assert.equal(fs.readFileSync(path.join(config.dataDir, name)).includes(password), false, name);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from '../core/schema.js';
import { handleRequest } from '../backend/api.js';
import { openDatabase } from '../backend/store/sqliteStore.js';
import { ALERT_FILE, backupNow, startBackups, verifyCopy } from '../backend/node/backup.js';
import { main } from '../backend/node/server.js';
import { ORIGIN, PERSON, envOf, keep, login, open, quiet, roomsIn, sleep, start, tempBase, tempConfig, until } from './serverSetup.js';

const at = (day, hour = 6) => () => Date.UTC(2026, 10, day, hour);                // 12:00 по Бишкеку того же дня

test('a copy is a whole base in one file: it opens, is intact and holds the same rows; it can stand in for the base', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  base.store.insertMany('rooms', [{ name: 'Ауд. 1' }, { name: 'Ауд. 2' }]);
  const res = await backupNow({ db: base.db, config, now: at(22), logger: quiet() });
  assert.deepEqual([res.ok, path.basename(res.file), fs.readdirSync(config.backupDir)], [true, 'journal-2026-11-22.sqlite', ['journal-2026-11-22.sqlite', 'secret.key']]);
  assert.equal(fs.readFileSync(path.join(config.backupDir, 'secret.key'), 'utf8'), fs.readFileSync(config.secretFile, 'utf8'));      // the secret is kept beside the copies: with the disk of the base it would be lost too
  // учение восстановления: копию кладём на место базы в новой папке данных вместе с secret.key — администратор входит, строки на месте
  const restored = tempConfig(t);
  fs.mkdirSync(restored.dataDir, { recursive: true });
  fs.copyFileSync(res.file, restored.dbFile);
  fs.copyFileSync(config.secretFile, restored.secretFile);
  const again = open(t, restored);
  assert.deepEqual([again.store.list('rooms').map((r) => r.name), handleRequest({ action: 'auth.login', data: { login: PERSON.login, password: PERSON.password } }, again).ok],
    [['Ауд. 1', 'Ауд. 2'], true]);
});

test('one copy a day: the same day replaces its file, restarts in a loop push nothing out, 31 days keep the last 30, foreign files stay', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  fs.mkdirSync(config.backupDir, { recursive: true });
  for (const name of ['notes.txt', 'journal.sqlite', 'journal-old.sqlite', 'journal-2026-11-01.sqlite.bak']) fs.writeFileSync(path.join(config.backupDir, name), 'чужое');
  for (let i = 0; i < 40; i++) await backupNow({ db: base.db, config, now: at(1, 6), logger: quiet() });        // сорок перезапусков за день
  const copies = () => fs.readdirSync(config.backupDir).filter((n) => /^journal-\d{4}-\d\d-\d\d\.sqlite$/.test(n)).sort();
  assert.deepEqual(copies(), ['journal-2026-11-01.sqlite']);
  let removed = [];
  for (let day = 2; day <= 31; day++) removed = (await backupNow({ db: base.db, config, now: at(day), logger: quiet() })).removed;      // 31 ноября = 1 декабря
  assert.deepEqual([copies().length, copies()[0], copies().at(-1), removed], [30, 'journal-2026-11-02.sqlite', 'journal-2026-12-01.sqlite', ['journal-2026-11-01.sqlite']]);
  for (const name of ['notes.txt', 'journal.sqlite', 'journal-old.sqlite', 'journal-2026-11-01.sqlite.bak']) assert.equal(fs.readFileSync(path.join(config.backupDir, name), 'utf8'), 'чужое', name);
});

test('the date of a copy is the Bishkek date: 18:30 UTC is already tomorrow', async (t) => {
  const { config } = tempBase(t);
  const res = await backupNow({ db: open(t, config).db, config, now: () => Date.UTC(2026, 10, 22, 18, 30), logger: quiet() });
  assert.equal(path.basename(res.file), 'journal-2026-11-23.sqlite');
});

test('a failed copy is loud and harmless: BACKUP FAILED in the log, the alert file, no .tmp, earlier copies whole; the next good copy removes the alert', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  const good = await backupNow({ db: base.db, config, now: at(21), logger: quiet() });
  const bytes = fs.readFileSync(good.file);
  const log = quiet();
  const blocked = { ...config, backupDir: path.join(good.file, 'sub') };                                      // папка копий — внутри файла: создать нельзя
  const res = await backupNow({ db: base.db, config: blocked, now: at(22), logger: log });
  const alert = path.join(config.alertDir, ALERT_FILE);
  assert.deepEqual([res.ok, typeof res.error, log.lines.some((l) => /ERROR BACKUP FAILED/.test(l)), fs.existsSync(alert), fs.readFileSync(good.file).equals(bytes)],
    [false, 'string', true, true, true]);
  assert.equal(fs.readFileSync(alert, 'utf8').includes(PERSON.fullName), false);
  await backupNow({ db: base.db, config, now: at(22), logger: quiet() });
  assert.deepEqual([fs.existsSync(alert), fs.readdirSync(config.backupDir).filter((n) => n.endsWith('.tmp'))], [false, []]);
});

test('a copy that does not pass the check is not kept and replaces nothing', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  const good = await backupNow({ db: base.db, config, now: at(22, 1), logger: quiet() });
  const bytes = fs.readFileSync(good.file);
  base.store.removeMany('staff', base.store.list('staff').map((r) => r.id));                                   // база без единого сотрудника — не копия
  const log = quiet();
  const res = await backupNow({ db: base.db, config, now: at(22, 6), logger: log });
  assert.deepEqual([res.ok, fs.readFileSync(good.file).equals(bytes), fs.readdirSync(config.backupDir), log.lines.some((l) => /BACKUP FAILED/.test(l))],
    [false, true, ['journal-2026-11-22.sqlite', 'secret.key'], true]);
});

test('verifyCopy refuses a cut file, a text file, a base without a sheet and a base without staff; a good copy leaves no -wal or -shm beside it', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  const tables = Object.keys(SCHEMA);
  const { file: good } = await backupNow({ db: base.db, config, now: at(22), logger: quiet() });
  const dir = path.join(path.dirname(good), 'cases');
  fs.mkdirSync(dir);
  const cut = path.join(dir, 'cut.sqlite');
  fs.writeFileSync(cut, fs.readFileSync(good).subarray(0, 2000));
  const text = path.join(dir, 'text.sqlite');
  fs.writeFileSync(text, 'не база');
  const variant = (name, sql) => {
    const file = path.join(dir, name);
    fs.copyFileSync(good, file);
    const own = new DatabaseSync(file);
    own.exec(sql);
    own.close();
    return file;
  };
  const noSheet = variant('noSheet.sqlite', 'DROP TABLE "rooms"');
  const noStaff = variant('noStaff.sqlite', 'DELETE FROM "staff"');
  assert.doesNotThrow(() => verifyCopy(good, tables));
  for (const [name, file] of [['cut', cut], ['text', text], ['noSheet', noSheet], ['noStaff', noStaff]]) assert.throws(() => verifyCopy(file, tables), Error, name);
  assert.deepEqual(fs.readdirSync(path.dirname(good)).filter((n) => /-(wal|shm)$/.test(n) && n.startsWith(path.basename(good))), []);
});

test('startBackups: a copy at once, the next one when the day changes, none in between; stop ends it', async (t) => {
  const { config } = tempBase(t);
  const clock = { t: Date.UTC(2026, 10, 22, 6) };
  const log = quiet();
  const backups = keep(t, startBackups({ db: open(t, config).db, config, now: () => clock.t, logger: log, everyMs: 20 }));
  assert.equal((await backups.first).ok, true);
  await sleep(100);
  assert.equal(log.lines.filter((l) => /backup ok/.test(l)).length, 1);
  clock.t += 86400000;
  await until(() => fs.existsSync(path.join(config.backupDir, 'journal-2026-11-23.sqlite')));
  backups.stop();
});

test('a copy made while requests are being served never fails: no BACKUP FAILED, and the new day gets its copy', async (t) => {
  const clock = { t: Date.UTC(2026, 10, 22, 6) };
  const { config, base, logger, post } = await start(t, { now: () => clock.t });                    // сервер на порту 0; logger пишет в config.logFile
  const backups = keep(t, startBackups({ db: base.db, config, now: () => clock.t, logger, everyMs: 5 }));
  assert.equal((await backups.first).ok, true);
  const token = (await (await post(login(PERSON.password), { Origin: ORIGIN })).json()).data.token;
  for (let i = 0; i < 60; i++) {
    if (i === 20) clock.t += 86400000;                                                              // посреди серии запросов наступил новый день
    assert.equal((await (await post({ action: 'dir.list', token, data: { table: 'rooms' } }, { Origin: ORIGIN })).json()).ok, true);
  }
  await until(() => fs.existsSync(path.join(config.backupDir, 'journal-2026-11-23.sqlite')));
  backups.stop();
  const text = fs.readFileSync(config.logFile, 'utf8');
  assert.deepEqual([/BACKUP FAILED/.test(text), fs.existsSync(path.join(config.alertDir, ALERT_FILE)), (text.match(/backup ok/g) ?? []).length], [false, false, 2]);
});

test('a leftover temporary file neither breaks the next copy nor lives for ever', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  fs.mkdirSync(config.backupDir, { recursive: true });
  const own = path.join(config.backupDir, `journal-2026-11-22.sqlite.${process.pid}.tmp`);                  // остался от упавшей копии того же процесса
  const oldOther = path.join(config.backupDir, 'journal-2026-11-01.sqlite.99999.tmp');
  const freshOther = path.join(config.backupDir, 'journal-2026-11-22.sqlite.88888.tmp');
  for (const file of [own, oldOther, freshOther]) fs.writeFileSync(file, 'мусор');
  const twoDaysAgo = new Date(Date.UTC(2026, 10, 20, 6));
  const anHourAgo = new Date(Date.UTC(2026, 10, 22, 5));                                                // «сейчас» теста — at(22): 22.11 06:00 UTC
  fs.utimesSync(oldOther, twoDaysAgo, twoDaysAgo);
  fs.utimesSync(freshOther, anHourAgo, anHourAgo);
  const res = await backupNow({ db: base.db, config, now: at(22), logger: quiet() });
  assert.deepEqual([res.ok, fs.existsSync(own), fs.existsSync(oldOther), fs.existsSync(freshOther)], [true, false, false, true]);
});

test('the start of the server copies the base before new sheets are added to it', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config); base.db.exec('DROP TABLE "rooms"'); base.close();
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, now: at(22) }));
  const copy = keep(t, openDatabase(path.join(config.backupDir, 'journal-2026-11-22.sqlite'), { readOnly: true }));
  const has = (db) => db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'rooms'`).get().n;
  assert.deepEqual([has(copy), has(run.base.db)], [0, 1]);
});

test('main --backup makes a copy while the server is running', async (t) => {
  const { config } = tempBase(t);
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, now: at(22) }));
  run.base.store.insert('rooms', { name: 'Новая' });                                                                    // после копии запуска
  const said = [];
  assert.equal((await main(['--backup'], { env: envOf(config), root: config.root, out: (line) => said.push(line), now: at(22) })).code, 0);
  const copy = path.join(config.backupDir, 'journal-2026-11-22.sqlite');
  assert.deepEqual([said.some((line) => line.startsWith('Копия сделана: ')), roomsIn({ ...config, dbFile: copy }).length], [true, 1]);
});

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDate } from '../../core/dates.js';

// A checked daily copy of the base. Node only: this file is not bundled for Apps Script.
// The copy is made by VACUUM INTO: one synchronous statement, so it never meets a request half way,
// and its result is one ordinary file (journal mode delete), without -wal and -shm.
export const KEEP_DAYS = 30;
export const CHECK_EVERY_MS = 30 * 60000;
export const ALERT_FILE = 'Журнал — копия не сделана.txt';
export const copyName = (date) => `journal-${date}.sqlite`;

const COPY_PATTERN = /^journal-\d{4}-\d\d-\d\d\.sqlite$/;
const TEMP_PATTERN = /^journal-\d{4}-\d\d-\d\d\.sqlite\.\d+\.tmp$/;
const DAY_MS = 86400000;
const clock = () => new Date().getTime();
const reason = (error) => String(error?.message || error).replace(/[\r\n]+/g, ' ');

export function verifyCopy(file, tables) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('the copy fails the integrity check');
    const have = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
    for (const table of tables) {
      if (!have.has(table)) throw new Error(`the copy has no table ${table}`);
    }
    if (db.prepare('SELECT count(*) AS n FROM "staff"').get().n < 1) throw new Error('the copy has no staff');
  } finally {
    db.close();
  }
}

export function pruneCopies(backupDir, keep = KEEP_DAYS, now = clock) {
  const names = fs.readdirSync(backupDir);
  const copies = names.filter((n) => COPY_PATTERN.test(n)).sort();
  const removed = copies.slice(0, Math.max(0, copies.length - keep));
  for (const name of removed) fs.rmSync(path.join(backupDir, name), { force: true });
  for (const name of names.filter((n) => TEMP_PATTERN.test(n))) {
    const file = path.join(backupDir, name);
    try {
      if (now() - fs.statSync(file).mtimeMs > DAY_MS) fs.rmSync(file, { force: true });
    } catch (error) { /* the file is gone or busy: the next pass sees it again */ }
  }
  return removed;
}

function raiseAlert(config, date, why) {
  if (!config.alertDir) return;
  try {
    const text = [
      `Дата: ${date}`,
      `Причина: ${why}`,
      'Откройте проект „Журнал колледжа“ в Claude и скажите: копия базы не сделалась',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(config.alertDir, ALERT_FILE), text);
  } catch (error) { /* no folder for the alert: the work log has the line anyway */ }
}

export async function backupNow({ db, config, now = clock, logger }) {
  const date = localDate(now());
  let tmp = null;
  try {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const file = path.join(config.backupDir, copyName(date));
    tmp = `${file}.${process.pid}.tmp`;
    fs.rmSync(tmp, { force: true });
    db.prepare('VACUUM INTO ?').run(tmp);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map((r) => r.name);
    verifyCopy(tmp, tables);
    fs.renameSync(tmp, file);
    tmp = null;
    let removed = [];
    try {
      removed = pruneCopies(config.backupDir, KEEP_DAYS, now);
    } catch (error) {
      logger.error(`backup pruning failed: ${reason(error)}`);
    }
    logger.info(`backup ok ${path.basename(file)} ${fs.statSync(file).size}`);
    if (config.alertDir) fs.rmSync(path.join(config.alertDir, ALERT_FILE), { force: true });
    return { ok: true, file, removed };
  } catch (error) {
    if (tmp) {
      try { fs.rmSync(tmp, { force: true }); } catch (rmError) { /* left for pruneCopies */ }
    }
    const why = reason(error);
    logger.error(`BACKUP FAILED: ${why}`);
    raiseAlert(config, date, why);
    return { ok: false, error: why };
  }
}

export function startBackups({ db, config, now = clock, logger, everyMs = CHECK_EVERY_MS }) {
  let running = null;
  let lastFailed = false;
  const run = () => {
    running ??= backupNow({ db, config, now, logger })
      .then((result) => {
        lastFailed = !result.ok;
        return result;
      })
      .finally(() => { running = null; });
    return running;
  };
  const first = run();
  const timer = setInterval(() => {
    if (running) return;
    if (lastFailed || !fs.existsSync(path.join(config.backupDir, copyName(localDate(now()))))) run();
  }, everyMs);
  timer.unref();
  return { first, stop: () => clearInterval(timer) };
}

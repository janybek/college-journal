import fs from 'node:fs';
import path from 'node:path';
import { FILE_LIMITS, isStoredName } from '../../core/files.js';
import { parseLocalDateTime, localDate } from '../../core/dates.js';

// The file box on disk: uploaded files by a random name, the sweep, the daily mirror, the restore, the low-space alarm.
// Node only: this file is not bundled for Apps Script. The path is built only from a name that passed isStoredName.
export const FILES_DIR = 'files';
export const SPACE_ALERT_FILE = 'Журнал — мало места на диске.txt';
export const MIN_FREE_BYTES = 5 * 1024 ** 3;

const TEMP_PATTERN = /^[0-9a-f]{32}\.bin\.tmp$/;
const reason = (error) => String(error?.message || error).replace(/[\r\n]+/g, ' ');

function checked(stored) {
  if (!isStoredName(stored)) throw new Error('bad stored name');
  return stored;
}

function writeWhole(file, bytes) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, file);
}

function namesIn(dir) {
  try {
    return fs.readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function createDiskFiles(dir) {
  return {
    put(stored, bytes) {
      checked(stored);
      fs.mkdirSync(dir, { recursive: true });
      writeWhole(path.join(dir, stored), bytes);
    },
    read(stored) {
      checked(stored);
      try {
        return new Uint8Array(fs.readFileSync(path.join(dir, stored)));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    decode: (base64) => new Uint8Array(Buffer.from(base64, 'base64')),
    encode: (bytes) => Buffer.from(bytes).toString('base64'),
  };
}

// Only the sweep takes files off the disk: a request that fails after the file is written leaves it for the next pass.
export function sweepFiles({ store, dir, nowMs, keepMs = FILE_LIMITS.keepPendingMs, graceMs = 3600000 }) {
  const rows = store.list('files');
  const dead = rows.filter((r) => (r.state === 'pending' || r.state === 'dropped') && nowMs - parseLocalDateTime(r.at) > keepMs);
  if (dead.length > 0) store.removeMany('files', dead.map((r) => r.id));
  const gone = new Set(dead.map((r) => r.id));
  const live = new Set(rows.filter((r) => !gone.has(r.id) && (r.state === 'pending' || r.state === 'attached')).map((r) => r.stored));
  let files = 0;
  for (const name of namesIn(dir)) {
    if (!(isStoredName(name) && !live.has(name)) && !TEMP_PATTERN.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (nowMs - fs.statSync(file).mtimeMs <= graceMs) continue;
      fs.rmSync(file, { force: true });
      files += 1;
    } catch (error) { /* busy or gone: the next pass sees it again */ }
  }
  return { rows: dead.length, files };
}

function isFileAt(file) {
  try { return fs.statSync(file).isFile(); } catch (error) { return false; }
}

function copyMissing(from, to) {
  let copied = 0;
  const names = namesIn(from).filter((n) => isStoredName(n) && isFileAt(path.join(from, n)));
  if (names.length === 0) return { copied };
  fs.mkdirSync(to, { recursive: true });
  const have = new Set(fs.readdirSync(to));
  for (const name of names) {
    if (have.has(name)) continue;
    const target = path.join(to, name);
    fs.copyFileSync(path.join(from, name), target + '.tmp');
    fs.renameSync(target + '.tmp', target);
    copied += 1;
  }
  return { copied };
}

// Copies what is not yet in the mirror; nothing is deleted there. A file name is never rewritten: the content of a name does not change.
export function mirrorFiles(dir, mirrorDir) {
  return copyMissing(dir, mirrorDir);
}

export function restoreFiles(mirrorDir, dir) {
  return copyMissing(mirrorDir, dir);
}

export function spaceAlarm({ config, logger, now = () => new Date().getTime(), minFreeBytes = MIN_FREE_BYTES, statfs = fs.statfsSync }) {
  const low = [];
  const free = {};
  let failed = false;
  for (const [label, dir] of [['data', config.dataDir], ['backup', config.backupDir]]) {
    try {
      const info = statfs(dir);
      free[label] = Number(info.bavail) * Number(info.bsize);
      if (free[label] < minFreeBytes) low.push(label);
    } catch (error) {
      failed = true;
      logger.error(`space check failed (${label}): ${reason(error)}`);
    }
  }
  if (!config.alertDir) return { low };
  const file = path.join(config.alertDir, SPACE_ALERT_FILE);
  try {
    if (low.length === 0) {
      if (!failed) fs.rmSync(file, { force: true });
    } else {
      const gib = (n) => (n / 1024 ** 3).toFixed(1);
      const words = { data: 'диск базы и файлов', backup: 'диск копий' };
      fs.writeFileSync(file, [
        `Дата: ${localDate(now())}`,
        ...low.map((label) => `Мало места: ${words[label]}, свободно ${gib(free[label])} ГиБ`),
        'Откройте проект „Журнал колледжа“ в Claude и скажите: мало места на диске',
        '',
      ].join('\r\n'));
    }
  } catch (error) {
    logger.error(`space alert not written: ${reason(error)}`);
  }
  return { low };
}

import fs from 'node:fs';
import path from 'node:path';
import { TZ_OFFSET_MS } from '../../core/dates.js';
import { verifyCopy, SECRET_COPY } from './backup.js';
import { FILES_DIR, restoreFiles } from './files.js';
import { SCHEMA } from '../../core/schema.js';
import { hashPassword, generateTempPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { normalizeRow } from '../../core/validate.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
import { applySchemeUpgrade } from '../schemeUpgrade.js';
import { applyLinesUpgrade } from '../linesUpgrade.js';
import { createSqliteStore, ensureTables, openDatabase } from '../store/sqliteStore.js';

// Opening and first run of the working base. Node only: this file is not bundled for Apps Script.
// The base is made only by initBase; openBase never creates anything.

const MIN_SECRET = 32;
const ADMIN_LOGIN = 'admin';

export class BaseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'BaseError';
    this.code = code;
  }
}

function adminRow(platform) {
  const adminTempPassword = generateTempPassword(platform);
  const row = normalizeRow('staff', {
    fullName: 'Администратор',
    login: ADMIN_LOGIN,
    passwordHash: hashPassword(platform, adminTempPassword, undefined, TEMP_HASH_ROUNDS),
    roles: 'admin',
    lang: 'ru',
    mustChangePassword: true,
    active: true,
  });
  return { row, adminTempPassword };
}

export function initBase(config) {
  if (fs.existsSync(config.dbFile)) throw new BaseError('exists');
  const platform = createNodePlatform();
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(config.secretFile)) fs.writeFileSync(config.secretFile, platform.randomHex(32), { flag: 'wx', mode: 0o600 });
  let db;
  try {
    db = openDatabase(config.dbFile);
    ensureTables(SCHEMA, db);
    const { row, adminTempPassword } = adminRow(platform);
    createSqliteStore(SCHEMA, platform, db).insert('staff', row);
    db.close();
    db = null;
    return { adminLogin: ADMIN_LOGIN, adminTempPassword };
  } catch (error) {
    // a half-made base must not make the next first run answer "exists"
    if (db) db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(config.dbFile + suffix, { force: true });
    throw error;
  }
}

function readSecret(config) {
  let secret = '';
  try {
    secret = fs.readFileSync(config.secretFile, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (secret.length < MIN_SECRET) throw new BaseError('no_secret');
  return secret;
}

export function openBase(config, { now } = {}) {
  if (!fs.existsSync(config.dbFile)) throw new BaseError('no_base');
  const secret = readSecret(config);
  const db = openDatabase(config.dbFile);
  try {
    const platform = createNodePlatform({ now, secret });
    const store = createSqliteStore(SCHEMA, platform, db);
    let closed = false;
    return {
      db, store, platform,
      upgrade: () => ({ ...ensureTables(SCHEMA, db), ...applySchemeUpgrade(store), ...applyLinesUpgrade(store, platform) }),
      close() {
        if (closed) return;
        closed = true;
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function resetAdminPassword(config) {
  if (!fs.existsSync(config.dbFile)) throw new BaseError('no_base');
  const platform = createNodePlatform();
  const db = openDatabase(config.dbFile);
  try {
    const store = createSqliteStore(SCHEMA, platform, db);
    const { row, adminTempPassword } = adminRow(platform);
    const admin = store.list('staff').find((r) => r.login === ADMIN_LOGIN);
    if (admin) {
      store.updateMany('staff', [{ id: admin.id, patch: { passwordHash: row.passwordHash, mustChangePassword: true, active: true } }]);
    } else {
      store.insert('staff', row);
    }
    return { adminLogin: ADMIN_LOGIN, adminTempPassword };
  } finally {
    db.close();
  }
}

const COPY_TABLES = ['staff'];
const clock = () => new Date().getTime();

// A folder name for what the restore moves aside: the Bishkek date and time, one digit group.
function stampOf(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 19).replace(/\D/g, '').replace(/^(\d{8})/, '$1-');
}

function secretIsGood(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().length >= MIN_SECRET;
  } catch (error) {
    return false;
  }
}

// Puts a checked copy in the place of the working base. The caller has made sure that no server runs.
// -wal and -shm of the old base go away with it: left in place they would be replayed over the copy.
// The old files are kept in a folder beside the base, nothing is deleted. The secret stays, or comes from the folder of copies,
// or is made anew (then only the open sessions end).
export function restoreBase(config, copyFile, { now = clock } = {}) {
  if (!fs.existsSync(copyFile)) throw new BaseError('no_copy');
  try {
    verifyCopy(copyFile, COPY_TABLES);
  } catch (error) {
    throw new BaseError('bad_copy', String(error?.message || error).replace(/[\r\n]+/g, ' '));
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = config.dbFile + '.restore.tmp';
  const old = ['', '-wal', '-shm'].map((suffix) => config.dbFile + suffix).filter((file) => fs.existsSync(file));
  let before = null;
  const moved = [];
  try {
    fs.rmSync(tmp, { force: true });
    fs.copyFileSync(copyFile, tmp);
    verifyCopy(tmp, COPY_TABLES);
    for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(tmp + suffix, { force: true });
    if (old.length > 0) {
      const stamp = `before-restore-${stampOf(now())}`;
      for (let n = 1; before === null; n += 1) {
        const folder = path.join(config.dataDir, n === 1 ? stamp : `${stamp}-${n}`);
        if (!fs.existsSync(folder)) { fs.mkdirSync(folder); before = folder; }
      }
      for (const file of old) {
        fs.renameSync(file, path.join(before, path.basename(file)));
        moved.push(file);
      }
    }
    fs.renameSync(tmp, config.dbFile);
  } catch (error) {
    for (const file of moved) {
      try { fs.renameSync(path.join(before, path.basename(file)), file); } catch (backError) { /* the folder keeps it */ }
    }
    fs.rmSync(tmp, { force: true });
    throw new BaseError('cannot_replace', String(error?.message || error));
  }
  let secret = 'kept';
  if (!secretIsGood(config.secretFile)) {
    const spare = path.join(config.backupDir, SECRET_COPY);
    if (secretIsGood(spare)) {
      fs.copyFileSync(spare, config.secretFile);
      secret = 'copies';
    } else {
      fs.writeFileSync(config.secretFile, createNodePlatform().randomHex(32), { mode: 0o600 });
      secret = 'new';
    }
  }
  // the files of students come back beside the base; what is already on disk is not overwritten
  let files = 0;
  if (config.filesDir) {
    try {
      files = restoreFiles(path.join(config.backupDir, FILES_DIR), config.filesDir).copied;
    } catch (error) {
      throw new BaseError('cannot_restore_files', String(error?.message || error));
    }
  }
  return { before, secret, files };
}

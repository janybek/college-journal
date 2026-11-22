import fs from 'node:fs';
import { SCHEMA } from '../../core/schema.js';
import { hashPassword, generateTempPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { normalizeRow } from '../../core/validate.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
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
      upgrade: () => ensureTables(SCHEMA, db),
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

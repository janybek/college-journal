import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { normalizeRow } from '../core/validate.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createSqliteStore, openDatabase } from '../backend/store/sqliteStore.js';
import { initBase, openBase } from '../backend/node/base.js';

// Helpers of the server tests. Everything lives in a temporary folder that the test removes.

export const ORIGIN = 'https://janybek.github.io';
export const PERSON = { login: 'zebra', fullName: 'Zebra Person', password: 'Passw0rd-zebra' };

const registry = new Map();

// One t.after per test: closes everything that was kept (last opened first), then removes the folders.
function entry(t) {
  if (!registry.has(t)) {
    const own = { items: [], dirs: [] };
    registry.set(t, own);
    t.after(async () => {
      for (const item of own.items.reverse()) {
        for (const name of ['close', 'stop']) {
          try { await item[name]?.(); } catch (error) { /* already closed by the test */ }
        }
      }
      for (const dir of own.dirs) fs.rmSync(dir, { recursive: true, force: true });
      registry.delete(t);
    });
  }
  return registry.get(t);
}

export function keep(t, item) {
  entry(t).items.push(item);
  return item;
}

export function open(t, config, options) {
  return keep(t, openBase(config, options));
}

export function tempDir(t) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'journal-server-')));
  entry(t).dirs.push(dir);
  return dir;
}

// root imitates the repository, outside is its neighbour.
export function tempRoot(t) {
  const base = tempDir(t);
  const root = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  return { root, outside };
}

// Only root and alertDir exist: the tests expect dataDir and backupDir to be missing.
export function tempConfig(t, extra = {}) {
  const base = tempDir(t);
  const dataDir = path.join(base, 'data');
  const config = {
    root: path.join(base, 'repo'),
    dataDir,
    backupDir: path.join(base, 'copies'),
    alertDir: path.join(base, 'alert'),
    port: 0,
    origins: [ORIGIN],
    dbFile: path.join(dataDir, 'journal.sqlite'),
    secretFile: path.join(dataDir, 'secret.key'),
    logFile: path.join(dataDir, 'server.log'),
    stateFile: path.join(dataDir, 'server.state.json'),
    stopFile: path.join(dataDir, 'stop.request'),
    supervisorFile: path.join(dataDir, 'supervisor.state.json'),
    ...extra,
  };
  fs.mkdirSync(config.root);
  fs.mkdirSync(config.alertDir);
  return config;
}

export function envOf(config) {
  return {
    JOURNAL_DATA_DIR: config.dataDir,
    JOURNAL_BACKUP_DIR: config.backupDir,
    JOURNAL_ALERT_DIR: config.alertDir,
    JOURNAL_PORT: String(config.port),
    JOURNAL_ORIGINS: config.origins.join(','),
  };
}

// The first run plus one more administrator, PERSON, with his own password.
export function tempBase(t, extra) {
  const config = tempConfig(t, extra);
  const { adminTempPassword } = initBase(config);
  const base = openBase(config);
  try {
    base.store.insert('staff', normalizeRow('staff', {
      fullName: PERSON.fullName,
      login: PERSON.login,
      passwordHash: hashPassword(base.platform, PERSON.password),
      roles: 'admin',
      lang: 'ru',
      mustChangePassword: false,
      active: true,
    }));
  } finally {
    base.close();
  }
  return { config, tempPassword: adminTempPassword };
}

// A short look into the base with its own connection.
function withStore(config, fn) {
  const db = openDatabase(config.dbFile);
  try {
    return fn(createSqliteStore(SCHEMA, createNodePlatform(), db), db);
  } finally {
    db.close();
  }
}

export const snapshotStaff = (config, filter = () => true) => withStore(config, (store) => store.list('staff').filter(filter));
export const roomsIn = (config) => withStore(config, (store) => store.list('rooms'));
export const dropTable = (config, name) => withStore(config, (store, db) => db.exec(`DROP TABLE "${name}"`));

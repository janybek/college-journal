import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { normalizeRow } from '../core/validate.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createSqliteStore, openDatabase } from '../backend/store/sqliteStore.js';
import http from 'node:http';
import { initBase, openBase } from '../backend/node/base.js';
import { createLogger } from '../backend/node/log.js';
import { startServer } from '../backend/node/server.js';

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
    filesDir: path.join(dataDir, 'files'),
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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until fn() returns something non-empty.
export async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error('until: timed out');
    await sleep(20);
  }
}

// A log in memory: lines look like 'INFO ...' and 'ERROR ...'.
export function quiet() {
  const lines = [];
  return { lines, info: (text) => lines.push('INFO ' + text), error: (text) => lines.push('ERROR ' + text) };
}

export const login = (password, name = PERSON.login) => ({ action: 'auth.login', data: { login: name, password } });

// A real working server on port 0 over a temporary base; post and raw send headers and path exactly as given.
export async function start(t, options = {}) {
  const { config } = tempBase(t, options.config);
  const base = open(t, config, { now: options.now });
  base.upgrade();
  const logger = createLogger(config.logFile, { now: base.platform.now });
  const srv = keep(t, await startServer({ config, base, logger, guard: options.guard, maxBodyBytes: options.maxBodyBytes, version: options.version }));
  const send = (method, requestPath, headers, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: requestPath, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const post = async (request, headers = {}) => {
    const res = await send('POST', '/api', { 'Content-Type': 'text/plain;charset=utf-8', ...headers }, JSON.stringify(request));
    return { status: res.status, headers: { get: (name) => res.headers[name.toLowerCase()] ?? null }, json: async () => JSON.parse(res.body) };
  };
  const raw = (method, requestPath, headers = {}) => send(method, requestPath, headers);
  return { srv, config, base, logger, post, raw };
}

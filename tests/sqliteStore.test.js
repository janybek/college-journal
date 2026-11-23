import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SCHEMA } from '../core/schema.js';
import { AppError } from '../core/errors.js';
import { hashPassword } from '../core/auth.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createSqliteStore, ensureTables, openDatabase } from '../backend/store/sqliteStore.js';
import { handleRequest, withHandlers } from '../backend/api.js';
import { setup, A } from './syllabusSetup.js';

const platform = createNodePlatform({ now: () => 1000, secret: 's' });
const tableNames = () => Object.keys(SCHEMA);
const repoUrl = (file) => pathToFileURL(path.join(import.meta.dirname, '..', file)).href;

test('ensureTables adds the phone check-in table and the six lesson columns to an old base; old pairs read as not started', (t) => {
  const { db } = tmpBase(t, { empty: true });
  const oldColumns = SCHEMA.pairs.columns.slice(0, -6);
  db.exec(`CREATE TABLE "pairs" (${oldColumns.map((c) => `"${c.key}" TEXT`).join(', ')}); INSERT INTO "pairs" ("id", "status") VALUES ('p_1', 'planned')`);
  const result = ensureTables(SCHEMA, db);
  assert.ok(result.created.includes('checkins'));
  assert.deepEqual(result.added.map(([table, key]) => table + '.' + key),
    ['startedAt', 'startedBy', 'checkinUntil', 'checkinClosed', 'finishedAt', 'finishedBy'].map((k) => 'pairs.' + k));
  const store = createSqliteStore(SCHEMA, platform, db);
  assert.deepEqual(store.list('checkins'), []);
  const pair = store.get('pairs', 'p_1');
  assert.deepEqual([pair.startedAt, pair.startedBy, pair.checkinUntil, pair.checkinClosed, pair.finishedAt, pair.finishedBy], ['', '', '', false, '', '']);
  assert.deepEqual(ensureTables(SCHEMA, db), { created: [], added: [] });
});

// A file base in a temporary folder. One t.after per test: it closes every base still open (db and what the test gave to keep), then removes the folder.
function tmpBase(t, { empty = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-sqlite-'));
  const file = path.join(dir, 'journal.sqlite');
  const open = [];
  const keep = (db) => { open.push(db); return db; };
  const db = keep(openDatabase(file));
  if (!empty) ensureTables(SCHEMA, db);
  t.after(() => {
    for (const d of open.reverse()) {
      try { d.close(); } catch (error) { /* already closed by the test */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { file, db, s: createSqliteStore(SCHEMA, platform, db), keep, dir };
}

// An in-memory base: the process ends with it, nothing to close on disk.
function memoryBase(schema, platform2) {
  const db = openDatabase(':memory:');
  ensureTables(schema, db);
  return createSqliteStore(schema, platform2, db);
}

// plan.at = k: the k-th write of the request throws; plan.at = 0 breaks nothing; plan.seen counts the writes. transaction and reads pass as they are.
function breakable(store, plan) {
  const out = { ...store };
  for (const name of ['insert', 'insertMany', 'update', 'updateMany', 'remove', 'removeMany']) {
    out[name] = (...args) => {
      plan.seen += 1;
      if (plan.at === plan.seen) throw new Error('disk full');
      return store[name](...args);
    };
  }
  return out;
}

function killedInTheMiddle(file, dir) {
  const script = path.join(dir, 'kill.mjs');
  fs.writeFileSync(script, `
import { createSqliteStore, openDatabase } from '${repoUrl('backend/store/sqliteStore.js')}';
import { SCHEMA } from '${repoUrl('core/schema.js')}';
import { createNodePlatform } from '${repoUrl('backend/platform/nodePlatform.js')}';
const store = createSqliteStore(SCHEMA, createNodePlatform({ now: () => 1, secret: 's' }), openDatabase(${JSON.stringify(file)}));
store.transaction(() => {
  store.insert('rooms', { name: 'in the middle' });
  store.insert('groups', { name: 'X' });
  process.exit(1);
});
`);
  return spawnSync(process.execPath, [script]);
}

test('a file base: WAL, full sync; rows survive reopening in the order of insertion and in the shared shape', (t) => {
  const { file, db, s, keep } = tmpBase(t);
  assert.deepEqual([db.prepare('PRAGMA journal_mode').get().journal_mode, db.prepare('PRAGMA synchronous').get().synchronous], ['wal', 2]);
  const [b, a] = s.insertMany('rooms', [{ name: 'Б' }, { name: 'А' }]);
  const g = s.insert('groups', { name: '01-1', course: '' });
  const st = s.insert('students', { fullName: "О'Нил\"; DROP TABLE students;--", cardNo: 'S1', active: 'да', junk: 1 });
  db.close();
  const again = createSqliteStore(SCHEMA, platform, keep(openDatabase(file)));
  assert.deepEqual(again.list('rooms'), [b, a]);
  assert.deepEqual([again.get('groups', g.id).course, again.get('students', st.id), again.list('students').length], [null, st, 1]);
  assert.deepEqual([st.active, st.mustChangePassword, 'junk' in st], [true, false, false]);
});

test('every sheet of the schema is a table with the columns of the schema, SQL words included', (t) => {
  const { db, s } = tmpBase(t);
  for (const name of tableNames()) {
    assert.deepEqual(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name), SCHEMA[name].columns.map((c) => c.key), name);
    const row = s.insert(name, {});
    assert.deepEqual(s.get(name, row.id), row, name);
    assert.deepEqual(s.updateMany(name, [{ id: row.id, patch: {} }]), [row], name);
  }
});

test('ensureTables adds a missing table and a missing column, keeps rows and foreign columns, and changes nothing the second time', (t) => {
  const { db } = tmpBase(t, { empty: true });
  db.exec(`CREATE TABLE "groups" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL DEFAULT '', "legacy" TEXT);
           INSERT INTO "groups" ("id", "name", "legacy") VALUES ('g_1', '01-1', 'x'); CREATE TABLE "foreign_table" ("a" TEXT)`);
  const first = ensureTables(SCHEMA, db);
  assert.deepEqual([first.created, first.added], [tableNames().filter((n) => n !== 'groups'), [['groups', 'course']]]);
  assert.deepEqual(createSqliteStore(SCHEMA, platform, db).get('groups', 'g_1'), { id: 'g_1', name: '01-1', course: null });
  assert.deepEqual([db.prepare('SELECT "legacy" FROM "groups"').get().legacy, db.prepare('SELECT count(*) AS n FROM "foreign_table"').get().n], ['x', 0]);
  assert.deepEqual(ensureTables(SCHEMA, db), { created: [], added: [] });
});

test('transaction: an error rolls every sheet back and is thrown on; a nested call joins the outer one; a result is returned', (t) => {
  const { s } = tmpBase(t);
  const kept = s.insert('rooms', { name: 'до' });
  assert.throws(() => s.transaction(() => {
    s.insert('rooms', { name: 'A' });
    s.transaction(() => s.insertMany('groups', [{ name: '01-1' }, { name: '01-2' }]));
    s.removeMany('rooms', [kept.id]);
    throw new AppError('invalid');
  }), (e) => e.code === 'invalid');
  assert.deepEqual([s.list('rooms'), s.list('groups')], [[kept], []]);
  assert.equal(s.transaction(() => s.insert('rooms', { name: 'B' }).name), 'B');
  assert.equal(s.list('rooms').length, 2);
});

test('batch writes are atomic on their own', (t) => {
  const { s } = tmpBase(t);
  assert.throws(() => s.insertMany('rooms', [{ id: 'r_1', name: 'A' }, { id: 'r_1', name: 'B' }]), (e) => e.code === 'bad_request');
  assert.equal(s.list('rooms').length, 0);
});

test('handleRequest over SQLite: a handler that fails after writing two sheets leaves nothing; a good request is kept', (t) => {
  const { s } = tmpBase(t);
  const admin = s.insert('staff', { fullName: 'Admin', login: 'admin', passwordHash: hashPassword(platform, 'secret12'), roles: 'admin', lang: 'ru', mustChangePassword: false, active: true });
  const ctx = { store: s, platform, log: () => {} };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const token = call('auth.login', { login: 'admin', password: 'secret12' }).data.token;
  for (const [thrown, code] of [[new AppError('invalid'), 'invalid'], [new Error('disk full'), 'internal']]) {
    const res = withHandlers({
      'dir.list': (data, c) => {
        c.store.insert('rooms', { name: 'X' });
        c.store.updateMany('staff', [{ id: admin.id, patch: { fullName: 'changed' } }]);
        throw thrown;
      },
    }, () => call('dir.list', { table: 'rooms' }, token));
    assert.deepEqual([res.error.code, s.list('rooms'), s.get('staff', admin.id).fullName], [code, [], 'Admin']);
  }
  assert.equal(call('dir.save', { table: 'rooms', row: { name: 'Ауд. 1' } }, token).ok, true);
  assert.equal(s.list('rooms').length, 1);
});

test('a request broken at any of its writes leaves every sheet as before: «Изменить» (M6) and «Утвердить» (N1) of addendum 3', () => {
  const plan = { at: 0, seen: 0 };
  const x = setup({ makeStore: (schema, platform2) => breakable(memoryBase(schema, platform2), plan) });
  x.publish(x.sb1, A);
  const broken = (request) => {
    for (let k = 1; ; k++) {
      const before = x.snapshotAll();
      Object.assign(plan, { at: k, seen: 0 });
      const res = request();
      plan.at = 0;
      if (res.ok) return { writes: k - 1, data: res.data };
      assert.deepEqual([res.error.code, x.snapshotAll() === before], ['internal', true], `write ${k}`);
    }
  };
  const started = broken(() => x.call('syllabus.startDraft', { subjectId: x.sb1, semester: 1 }, x.teacher1));
  assert.equal(started.writes >= 2, true);
  x.fill(started.data.syllabusId);
  x.call('syllabus.submit', { syllabusId: started.data.syllabusId }, x.teacher1);
  const approved = broken(() => x.call('syllabus.approve', { syllabusId: started.data.syllabusId }, x.dean));
  assert.deepEqual([approved.writes >= 2, approved.data.approved], [true, true]);
});

test('a process killed in the middle of a request: the base opens, is whole and has nothing of that request', (t) => {
  const { file, db, s, keep, dir } = tmpBase(t);
  s.insert('rooms', { name: 'до' });
  db.close();
  assert.equal(killedInTheMiddle(file, dir).status, 1);
  const after = keep(openDatabase(file));
  const store = createSqliteStore(SCHEMA, platform, after);
  assert.deepEqual([store.list('rooms').map((r) => r.name), store.list('groups'), after.prepare('PRAGMA integrity_check').get().integrity_check], [['до'], [], 'ok']);
});

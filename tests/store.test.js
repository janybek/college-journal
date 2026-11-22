import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { createFileStore } from '../backend/store/fileStore.js';
import { createSheetsStore, ensureSheets } from '../backend/store/sheetsStore.js';
import { createSqliteStore, ensureTables, openDatabase } from '../backend/store/sqliteStore.js';
import { createFakeSpreadsheet } from './fakes/fakeSpreadsheet.js';
import { storeContract } from './storeContract.js';

const platform = createNodePlatform({ now: () => 1000, secret: 's' });

storeContract('memoryStore', () => createMemoryStore(SCHEMA, platform));

storeContract('sqliteStore', () => {
  const db = openDatabase(':memory:');
  ensureTables(SCHEMA, db);
  return createSqliteStore(SCHEMA, platform, db);
});

storeContract('sheetsStore', () => {
  const ss = createFakeSpreadsheet();
  ensureSheets(SCHEMA, ss);
  return createSheetsStore(SCHEMA, platform, ss);
});

test('memoryStore: regenerates id on collision', () => {
  const seq = ['aaaaaaaa', 'aaaaaaaa', 'bbbbbbbb'];
  const p = { ...platform, randomHex: () => seq.shift() };
  const s = createMemoryStore(SCHEMA, p);
  assert.equal(s.insert('rooms', { name: 'A' }).id, 'r_aaaaaaaa');
  assert.equal(s.insert('rooms', { name: 'B' }).id, 'r_bbbbbbbb');
});

test('memoryStore: initial data is used', () => {
  const s = createMemoryStore(SCHEMA, platform, { rooms: [{ id: 'r_1', name: 'A' }] });
  assert.deepEqual(s.list('rooms'), [{ id: 'r_1', name: 'A' }]);
});

test('memoryStore: an old row with missing fields reads in the full shape', () => {
  const s = createMemoryStore(SCHEMA, platform, { groups: [{ id: 'g_1', name: '01-1', old: 1 }] });
  assert.deepEqual(s.get('groups', 'g_1'), { id: 'g_1', name: '01-1', course: null });
  assert.deepEqual(s.update('groups', 'g_1', { course: 2 }), { id: 'g_1', name: '01-1', course: 2 });
});

const tmpDirs = [];
function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-store-'));
  tmpDirs.push(dir);
  return path.join(dir, 'sub', 'data.json');
}
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

storeContract('fileStore', () => createFileStore(SCHEMA, platform, tmpFile()));

test('fileStore: second store on the same path sees written data', () => {
  const file = tmpFile();
  const a = createFileStore(SCHEMA, platform, file);
  const g = a.insert('groups', { name: '01-1', course: 1 });
  a.update('groups', g.id, { course: 3 });
  const b = createFileStore(SCHEMA, platform, file);
  assert.deepEqual(b.get('groups', g.id), { id: g.id, name: '01-1', course: 3 });
  b.remove('groups', g.id);
  assert.equal(createFileStore(SCHEMA, platform, file).list('groups').length, 0);
});

test('fileStore: updateMany and removeMany are written to the file', () => {
  const file = tmpFile();
  const a = createFileStore(SCHEMA, platform, file);
  const [x, y] = a.insertMany('rooms', [{ name: 'X' }, { name: 'Y' }, { name: 'Z' }]);
  a.updateMany('rooms', [{ id: y.id, patch: { name: 'Y2' } }]);
  a.removeMany('rooms', [x.id, x.id]);
  assert.deepEqual(createFileStore(SCHEMA, platform, file).list('rooms').map((r) => r.name), ['Y2', 'Z']);
});

test('fileStore: a stand file without the tables of unit 3 opens; the new tables are empty and take rows', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = { groups: [{ id: 'g_1', name: '01-1', course: 1 }], pairs: [{ id: 'p_1', date: '2026-09-01', slot: 1, groupId: 'g_1', status: 'planned' }] };
  fs.writeFileSync(file, JSON.stringify(old), 'utf8');
  const s = createFileStore(SCHEMA, platform, file);
  for (const table of ['attendance', 'unitResults', 'changeLog']) assert.deepEqual(s.list(table), [], table);
  assert.equal(s.get('pairs', 'p_1').substitute, false);
  const row = s.insert('attendance', { pairId: 'p_1', studentId: 'st_1', status: 'present' });
  assert.deepEqual(createFileStore(SCHEMA, platform, file).list('attendance').map((r) => r.id), [row.id]);
  assert.equal(createFileStore(SCHEMA, platform, file).insert('changeLog', { entity: 'mark' }).entity, 'mark');
});

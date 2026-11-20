import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { createFileStore } from '../backend/store/fileStore.js';

const platform = createNodePlatform({ now: () => 1000, secret: 's' });

function storeContract(name, makeStore) {
  test(`${name}: basic contract`, () => {
    const s = makeStore();
    const g = s.insert('groups', { name: '01-1', course: 1 });
    assert.match(g.id, /^g_[0-9a-f]{8}$/);
    assert.deepEqual(s.get('groups', g.id), g);
    s.list('groups')[0].name = 'x';
    assert.equal(s.get('groups', g.id).name, '01-1');
    assert.equal(s.update('groups', g.id, { course: 2 }).course, 2);
    s.remove('groups', g.id);
    assert.equal(s.get('groups', g.id), null);
    assert.throws(() => s.update('groups', 'g_nope', {}), e => e.code === 'not_found');
    assert.throws(() => s.remove('groups', 'g_nope'), e => e.code === 'not_found');
    assert.throws(() => s.list('nope'), e => e.code === 'bad_request');
  });

  test(`${name}: insertMany, caller ids, collisions`, () => {
    const s = makeStore();
    const rows = s.insertMany('rooms', [{ name: 'A' }, { name: 'B' }]);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(s.insert('rooms', { id: 'r_custom', name: 'C' }).id, 'r_custom');
    assert.throws(() => s.insert('rooms', { id: 'r_custom', name: 'D' }), e => e.code === 'bad_request');
    assert.equal(s.list('rooms').length, 3);
  });

  test(`${name}: insert copies the input and update keeps id`, () => {
    const s = makeStore();
    const input = { name: 'A' };
    const r = s.insert('rooms', input);
    input.name = 'changed';
    assert.equal(s.get('rooms', r.id).name, 'A');
    assert.equal(s.update('rooms', r.id, { id: 'other', name: 'B' }).id, r.id);
  });
}

storeContract('memoryStore', () => createMemoryStore(SCHEMA, platform));

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

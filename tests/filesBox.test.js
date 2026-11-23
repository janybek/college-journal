import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDiskFiles, sweepFiles, mirrorFiles, restoreFiles, spaceAlarm, SPACE_ALERT_FILE, MIN_FREE_BYTES, FILES_DIR } from '../backend/node/files.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { SCHEMA } from '../core/schema.js';
import { localDateTime } from '../core/dates.js';
import { SAMPLE } from './fakes/sampleFiles.js';
import { quiet } from './serverSetup.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const NOW = Date.UTC(2026, 10, 23, 6);
const HOUR = 3600000;

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-box-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const stored = (ch) => ch.repeat(32) + '.bin';
function age(file, ms) {
  const when = new Date(NOW - ms);
  fs.utimesSync(file, when, when);
}

test('the disk box writes and reads by a random name only and leaves no temporary file', (t) => {
  const dir = path.join(tempDir(t), 'files');
  const box = createDiskFiles(dir);
  const name = 'ab'.repeat(16) + '.bin';
  box.put(name, SAMPLE.pdf);
  assert.deepEqual([...box.read(name)], [...SAMPLE.pdf]);
  assert.equal(box.read('cd'.repeat(16) + '.bin'), null);
  for (const bad of ['../x.bin', 'AB'.repeat(16) + '.bin', 'ab'.repeat(16), '..\\' + 'ab'.repeat(15) + '.bin']) {
    assert.throws(() => box.put(bad, SAMPLE.pdf), /bad stored name/);
    assert.throws(() => box.read(bad), /bad stored name/);
  }
  assert.deepEqual(fs.readdirSync(dir), [name]);
  assert.equal(box.encode(box.decode(b64(SAMPLE.jpg))), b64(SAMPLE.jpg));
  assert.equal(FILES_DIR, 'files');
});

test('the memory box has the same device as the disk box', () => {
  const box = createMemoryFiles();
  const name = 'ab'.repeat(16) + '.bin';
  box.put(name, SAMPLE.png);
  assert.deepEqual([[...box.read(name)], box.read('cd'.repeat(16) + '.bin'), box.names()], [[...SAMPLE.png], null, [name]]);
  assert.throws(() => box.put('../x.bin', SAMPLE.png), /bad stored name/);
  assert.equal(box.encode(box.decode(b64(SAMPLE.jpg))), b64(SAMPLE.jpg));
});

test('the sweep removes old unpinned rows and orphan files, and only those', (t) => {
  const dir = tempDir(t);
  const store = createMemoryStore(SCHEMA, createNodePlatform());
  const mk = (state, ch, hoursAgo) => ({ state, stored: stored(ch), name: 'f.pdf', kind: 'pdf', size: 3, ownerId: 's', at: localDateTime(NOW - hoursAgo * HOUR) });
  store.insertMany('files', [mk('attached', 'a', 100), mk('pending', 'b', 1), mk('pending', 'c', 25), mk('dropped', 'd', 25)]);
  const box = createDiskFiles(dir);
  for (const ch of 'abcde') box.put(stored(ch), SAMPLE.pdf);       // e: orphan 2 h
  box.put(stored('f'), SAMPLE.pdf);                                // f: orphan 10 min
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(dir, stored('7') + '.tmp'), 'x');     // own temp, old
  fs.writeFileSync(path.join(dir, stored('8') + '.tmp'), 'x');     // own temp, fresh
  for (const ch of 'abcde') age(path.join(dir, stored(ch)), 2 * HOUR);
  age(path.join(dir, stored('f')), 10 * 60000);
  age(path.join(dir, 'notes.txt'), 50 * HOUR);
  age(path.join(dir, stored('7') + '.tmp'), 2 * HOUR);
  age(path.join(dir, stored('8') + '.tmp'), 60000);
  assert.deepEqual(sweepFiles({ store, dir, nowMs: NOW }), { rows: 2, files: 4 });
  assert.deepEqual(store.list('files').map((r) => r.stored).sort(), [stored('a'), stored('b')]);
  // gone: c (old pending), d (dropped), e (orphan 2 h), 7.tmp
  assert.deepEqual(fs.readdirSync(dir).sort(), [stored('a'), stored('b'), stored('f'), stored('8') + '.tmp', 'notes.txt'].sort());
});

test('the sweep, the mirror and the restore with a missing folder do nothing', (t) => {
  const dir = path.join(tempDir(t), 'none');
  const store = createMemoryStore(SCHEMA, createNodePlatform());
  assert.deepEqual(sweepFiles({ store, dir, nowMs: NOW }), { rows: 0, files: 0 });
  assert.deepEqual(mirrorFiles(dir, path.join(dir, 'mirror')), { copied: 0 });
  assert.deepEqual(restoreFiles(dir, path.join(dir, 'back')), { copied: 0 });
});

test('the mirror copies what is new, removes nothing; the restore brings back only what is missing', (t) => {
  const root = tempDir(t);
  const dir = path.join(root, 'files');
  const mirror = path.join(root, 'copies', 'files');
  const box = createDiskFiles(dir);
  box.put(stored('a'), SAMPLE.pdf);
  box.put(stored('b'), SAMPLE.png);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'foreign');
  assert.deepEqual(mirrorFiles(dir, mirror), { copied: 2 });
  assert.deepEqual(mirrorFiles(dir, mirror), { copied: 0 });
  assert.deepEqual(fs.readdirSync(mirror).sort(), [stored('a'), stored('b')]);
  fs.rmSync(path.join(dir, stored('a')));
  assert.deepEqual(mirrorFiles(dir, mirror), { copied: 0 });
  assert.equal(fs.existsSync(path.join(mirror, stored('a'))), true);
  fs.writeFileSync(path.join(dir, stored('b')), 'changed');
  assert.deepEqual(restoreFiles(mirror, dir), { copied: 1 });
  assert.deepEqual([[...box.read(stored('a'))], fs.readFileSync(path.join(dir, stored('b')), 'utf8')], [[...SAMPLE.pdf], 'changed']);
  assert.deepEqual(fs.readdirSync(dir).sort(), [stored('a'), stored('b'), 'notes.txt']);
});

test('the mirror skips a folder that is named like a stored file', (t) => {
  const root = tempDir(t);
  const dir = path.join(root, 'files');
  const mirror = path.join(root, 'copies', 'files');
  createDiskFiles(dir).put(stored('a'), SAMPLE.pdf);
  fs.mkdirSync(path.join(dir, stored('f')));
  fs.writeFileSync(path.join(dir, stored('f'), 'inner.txt'), 'x');
  assert.deepEqual(mirrorFiles(dir, mirror), { copied: 1 });
  assert.deepEqual(fs.readdirSync(mirror), [stored('a')]);
  assert.deepEqual(restoreFiles(mirror, path.join(root, 'back')), { copied: 1 });
});

test('the low-space alarm keeps an existing alarm file when the check of a disk fails', (t) => {
  const root = tempDir(t);
  const config = { dataDir: path.join(root, 'data'), backupDir: path.join(root, 'copies'), alertDir: path.join(root, 'alert') };
  fs.mkdirSync(config.alertDir);
  const alert = path.join(config.alertDir, SPACE_ALERT_FILE);
  fs.writeFileSync(alert, 'old alarm');
  const log = quiet();
  assert.deepEqual(spaceAlarm({ config, logger: log, statfs: () => { throw new Error('no disk'); } }), { low: [] });
  assert.equal(fs.readFileSync(alert, 'utf8'), 'old alarm');
  assert.equal(log.lines.filter((l) => l.startsWith('ERROR')).length, 2);
  const GB = 1024 ** 3;
  const oneFails = (dir) => {
    if (dir === config.backupDir) throw new Error('no disk');
    return { bsize: 4096, bavail: (6 * GB) / 4096 };
  };
  assert.deepEqual(spaceAlarm({ config, logger: quiet(), statfs: oneFails }), { low: [] });
  assert.equal(fs.readFileSync(alert, 'utf8'), 'old alarm');
  // both disks answer and have room: the alarm goes
  assert.deepEqual(spaceAlarm({ config, logger: quiet(), statfs: () => ({ bsize: 4096, bavail: (6 * GB) / 4096 }) }), { low: [] });
  assert.equal(fs.existsSync(alert), false);
});

test('the low-space alarm: under 5 GiB on either disk writes the file, enough removes it, no alertDir writes nothing, a statfs error is only logged', (t) => {
  const root = tempDir(t);
  const config = { dataDir: path.join(root, 'data'), backupDir: path.join(root, 'copies'), alertDir: path.join(root, 'alert') };
  fs.mkdirSync(config.alertDir);
  const alert = path.join(config.alertDir, SPACE_ALERT_FILE);
  const free = (data, backup) => (dir) => ({ bsize: 4096, bavail: (dir === config.dataDir ? data : backup) / 4096 });
  const GB = 1024 ** 3;
  assert.equal(MIN_FREE_BYTES, 5 * GB);
  const log = quiet();
  assert.deepEqual(spaceAlarm({ config, logger: log, statfs: free(4 * GB, 90 * GB) }), { low: ['data'] });
  const text = fs.readFileSync(alert, 'utf8');
  assert.match(text, /мало места/);
  assert.match(text, /Журнал колледжа/);
  assert.deepEqual(spaceAlarm({ config, logger: log, statfs: free(4 * GB, 1 * GB) }), { low: ['data', 'backup'] });
  assert.deepEqual(spaceAlarm({ config, logger: log, statfs: free(6 * GB, 6 * GB) }), { low: [] });
  assert.equal(fs.existsSync(alert), false);
  assert.deepEqual(spaceAlarm({ config: { ...config, alertDir: '' }, logger: log, statfs: free(1 * GB, 1 * GB) }), { low: ['data', 'backup'] });
  assert.deepEqual(fs.readdirSync(config.alertDir), []);
  const failing = quiet();
  assert.doesNotThrow(() => spaceAlarm({ config, logger: failing }));       // the real statfs on folders that do not exist
  assert.equal(failing.lines.some((l) => l.startsWith('ERROR')), true);
  assert.equal(fs.existsSync(alert), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../backend/api.js';
import { backupNow, SECRET_COPY } from '../backend/node/backup.js';
import { openBase, restoreBase, BaseError } from '../backend/node/base.js';
import { main } from '../backend/node/server.js';
import { cli } from '../backend/node/supervisor.js';
import { PERSON, envOf, keep, open, quiet, roomsIn, tempBase, tempConfig } from './serverSetup.js';

const at = (day, hour = 6) => () => Date.UTC(2026, 10, day, hour);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof BaseError ? e.code : 'other'; } };
const names = (config) => roomsIn(config).map((r) => r.name).sort();

// A base with 3 rooms in a copy and 40 more rooms after it. Returns the copy, the secret and the base as it would stay after a hard stop.
async function crashedBase(t) {
  const { config } = tempBase(t);
  const base = open(t, config);
  base.store.insertMany('rooms', [{ name: 'Ауд. 1' }, { name: 'Ауд. 2' }, { name: 'Ауд. 3' }]);
  const { file } = await backupNow({ db: base.db, config, now: at(22), logger: quiet() });
  base.store.insertMany('rooms', Array.from({ length: 40 }, (_, i) => ({ name: `После ${i}` })));
  // the files as a stopped-by-force process leaves them: the base with a -wal that holds the newest rows
  const crashed = tempConfig(t);
  fs.mkdirSync(crashed.dataDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) fs.copyFileSync(config.dbFile + suffix, crashed.dbFile + suffix);
  fs.copyFileSync(config.secretFile, crashed.secretFile);
  return { config, crashed, copy: file };
}

test('the copy on top of a base that still has its -wal gives exactly the rows of the copy; the old base is kept aside', async (t) => {
  const { crashed, copy } = await crashedBase(t);
  assert.equal(fs.statSync(crashed.dbFile + '-wal').size > 0, true);
  const oldBytes = fs.readFileSync(crashed.dbFile);
  const naive = tempConfig(t);                                                         // proof that the trap is real: the copy put over the base alone is mixed with the old -wal
  fs.mkdirSync(naive.dataDir, { recursive: true });
  for (const suffix of ['-wal', '-shm']) fs.copyFileSync(crashed.dbFile + suffix, naive.dbFile + suffix);
  fs.copyFileSync(copy, naive.dbFile);
  assert.equal(names(naive).length > 3, true);
  const made = restoreBase(crashed, copy, { now: at(23, 8) });
  assert.deepEqual(names(crashed), ['Ауд. 1', 'Ауд. 2', 'Ауд. 3']);
  assert.deepEqual([fs.existsSync(crashed.dbFile + '-wal'), fs.existsSync(crashed.dbFile + '-shm'), fs.existsSync(crashed.dbFile + '.restore.tmp')], [false, false, false]);
  assert.deepEqual([path.basename(made.before), made.secret, fs.readdirSync(made.before).sort(), fs.readFileSync(path.join(made.before, 'journal.sqlite')).equals(oldBytes)],
    ['before-restore-20261123-140000', 'kept', ['journal.sqlite', 'journal.sqlite-shm', 'journal.sqlite-wal'], true]);
  const again = open(t, crashed);                                                      // the restored base works: the administrator logs in, rows are there
  assert.equal(handleRequest({ action: 'auth.login', data: { login: PERSON.login, password: PERSON.password } }, again).ok, true);
});

test('restore refuses a missing file and a copy that fails the check, and then touches nothing', async (t) => {
  const { crashed, copy } = await crashedBase(t);
  const cut = path.join(path.dirname(copy), 'cut.sqlite');
  fs.writeFileSync(cut, fs.readFileSync(copy).subarray(0, 2000));
  const text = path.join(path.dirname(copy), 'text.sqlite');
  fs.writeFileSync(text, 'не база');
  const before = fs.readdirSync(crashed.dataDir).sort();
  const dbBytes = fs.readFileSync(crashed.dbFile);
  assert.deepEqual([codeOf(() => restoreBase(crashed, path.join(path.dirname(copy), 'нет.sqlite'))), codeOf(() => restoreBase(crashed, cut)), codeOf(() => restoreBase(crashed, text))],
    ['no_copy', 'bad_copy', 'bad_copy']);
  assert.deepEqual([fs.readdirSync(crashed.dataDir).sort(), fs.readFileSync(crashed.dbFile).equals(dbBytes)], [before, true]);
});

test('the secret: the one in the folder of data stays; a lost one comes from the folder of copies; with none anywhere a new one is made', async (t) => {
  const { config, copy } = await crashedBase(t);
  const fresh = (secretText) => {
    const c = tempConfig(t, { backupDir: config.backupDir });
    fs.mkdirSync(c.dataDir, { recursive: true });
    if (secretText !== undefined) fs.writeFileSync(c.secretFile, secretText);
    return c;
  };
  const original = fs.readFileSync(config.secretFile, 'utf8');
  assert.equal(fs.readFileSync(path.join(config.backupDir, SECRET_COPY), 'utf8'), original);      // the copy of the secret lies beside the copies
  const own = fresh('x'.repeat(40));
  assert.deepEqual([restoreBase(own, copy).secret, fs.readFileSync(own.secretFile, 'utf8')], ['kept', 'x'.repeat(40)]);
  const lost = fresh();
  assert.deepEqual([restoreBase(lost, copy).secret, fs.readFileSync(lost.secretFile, 'utf8')], ['copies', original]);
  assert.equal(handleRequest({ action: 'auth.login', data: { login: PERSON.login, password: PERSON.password } }, open(t, lost)).ok, true);   // a new disk: the base and the secret from the copies only
  fs.rmSync(path.join(config.backupDir, SECRET_COPY));
  const none = fresh('короткий');
  const made = restoreBase(none, copy);
  assert.deepEqual([made.secret, fs.readFileSync(none.secretFile, 'utf8').trim().length >= 32, fs.readFileSync(none.secretFile, 'utf8') !== original, openBase(none).close()], ['new', true, true, undefined]);
});

test('serve:restore refuses while the server runs, works when it is stopped, says what it did, and the server starts on the restored base', async (t) => {
  const { config } = tempBase(t);
  const base = open(t, config);
  base.store.insert('rooms', { name: 'Ауд. 1' });
  const { file } = await backupNow({ db: base.db, config, now: at(10), logger: quiet() });       // not today: the start of the server makes today's copy over
  base.store.insert('rooms', { name: 'Потом' });
  base.close();
  const env = envOf(config);
  const said = [];
  const out = (line) => said.push(line);
  const run = await main([], { env, root: config.root, out: () => {}, stopCheckMs: 60000 });
  keep(t, run);
  assert.deepEqual([(await cli(['--restore', file], { env, root: config.root, out })).code, said.length, said[0].startsWith('Сервер работает')], [2, 1, true]);
  assert.deepEqual(run.base.store.list('rooms').map((r) => r.name).sort(), ['Потом', 'Ауд. 1'].sort());          // nothing changed
  await run.stop();
  said.length = 0;
  assert.deepEqual([(await cli(['--restore', file], { env, root: config.root, out })).code, said.some((l) => l.startsWith('База возвращена из копии')), said.some((l) => l.includes('before-restore-'))], [0, true, true]);
  assert.deepEqual(names(config), ['Ауд. 1']);
  assert.deepEqual([(await cli(['--restore', path.join(config.dataDir, 'нет.sqlite')], { env, root: config.root, out })).code, (await cli(['--restore'], { env, root: config.root, out })).code], [2, 2]);
  const again = keep(t, await main([], { env, root: config.root, out: () => {}, stopCheckMs: 60000 }));
  assert.deepEqual(again.base.store.list('rooms').map((r) => r.name), ['Ауд. 1']);
});

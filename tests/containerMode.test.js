import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { readConfig } from '../backend/node/config.js';
import { resetAdminPassword } from '../backend/node/base.js';
import { main, installSignalHandlers, EXIT } from '../backend/node/server.js';
import { ORIGIN, envOf, keep, snapshotStaff, start, tempConfig, tempRoot } from './serverSetup.js';

const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const post = async (url, body) => {
  const res = await fetch(url + '/api', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  return res.json();
};

test('JOURNAL_HOST: 0.0.0.0 in the environment mode, 127.0.0.1 in the settings file; only an IPv4 address, :: or ::1', (t) => {
  const { root, outside } = tempRoot(t);
  const ok = { dataDir: path.join(outside, 'data'), backupDir: path.join(outside, 'copies') };
  const env = { JOURNAL_DATA_DIR: ok.dataDir, JOURNAL_BACKUP_DIR: ok.backupDir };
  const fromFile = (extra) => { fs.writeFileSync(path.join(root, 'serve.local.json'), JSON.stringify({ ...ok, ...extra })); return readConfig({ root, env: {} }); };
  assert.deepEqual([readConfig({ root, env }).host, readConfig({ root, env: { ...env, JOURNAL_HOST: '10.1.2.3' } }).host, readConfig({ root, env: { ...env, JOURNAL_HOST: '::' } }).host,
    readConfig({ root, env: { ...env, JOURNAL_HOST: '::1' } }).host], ['0.0.0.0', '10.1.2.3', '::', '::1']);
  assert.deepEqual([fromFile({}).host, fromFile({ host: '0.0.0.0' }).host, fromFile({ host: '::1' }).host], ['127.0.0.1', '0.0.0.0', '::1']);
  for (const host of ['', 'localhost', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '1.2.3.-4', '::2', ':::', '1.2.3.4 ', '0x7f.0.0.1', 'example.com', '1.2.3.4:80']) {
    assert.equal(codeOf(() => readConfig({ root, env: { ...env, JOURNAL_HOST: host } })), 'bad_host', JSON.stringify(host));
    assert.equal(codeOf(() => fromFile({ host })), 'bad_host', JSON.stringify(host));
  }
  for (const host of [5, null, ['127.0.0.1'], {}]) assert.equal(codeOf(() => fromFile({ host })), host === null ? null : 'bad_host');
});

test('the server listens where the settings say; url stays usable for 0.0.0.0', async (t) => {
  const plain = await start(t);
  assert.deepEqual([plain.srv.address, plain.srv.url], ['127.0.0.1', `http://127.0.0.1:${plain.srv.port}`]);
  const open = await start(t, { config: { host: '0.0.0.0' } });
  assert.deepEqual([open.srv.address, open.srv.url], ['0.0.0.0', `http://127.0.0.1:${open.srv.port}`]);
  assert.equal((await open.raw('GET', '/health')).status, 200);
});

test('JOURNAL_AUTO_INIT=1: the first plain start makes the base, throws the password away, says how to get it', async (t) => {
  const config = tempConfig(t);
  const env = { ...envOf(config), JOURNAL_AUTO_INIT: '1' };
  const said = [];
  const run = keep(t, await main([], { env, root: config.root, out: (line) => said.push(line), stopCheckMs: 60000 }));
  assert.equal(run.code, EXIT.ok);
  assert.deepEqual([fs.existsSync(config.dbFile), /^[0-9a-f]{64}$/.test(fs.readFileSync(config.secretFile, 'utf8').trim())], [true, true]);
  const admins = snapshotStaff(config, (r) => r.login === 'admin');
  assert.deepEqual([admins.length, admins[0].mustChangePassword, admins[0].roles], [1, true, 'admin']);
  const log = fs.readFileSync(config.logFile, 'utf8');
  assert.match(log, /base created automatically; set the admin password with --admin-password/);
  assert.equal(said.some((l) => /--admin-password/.test(l)), true);
  assert.equal(said.some((l) => /Временный пароль|Администратор:/.test(l)), false);
  // the temporary password is not in the output, the log or the base file; the hash is stored, not the password
  const all = said.join('\n') + log;
  assert.equal(/Временный пароль/.test(all), false);
  assert.equal(admins[0].passwordHash.startsWith('v2$'), true);
  await run.stop();
  // the second start does not touch the base: the same admin row
  const before = snapshotStaff(config, (r) => r.login === 'admin')[0].passwordHash;
  const second = keep(t, await main([], { env, root: config.root, out: () => {}, stopCheckMs: 60000 }));
  assert.equal(second.code, EXIT.ok);
  assert.equal(snapshotStaff(config, (r) => r.login === 'admin')[0].passwordHash, before);
  assert.equal(fs.readFileSync(config.logFile, 'utf8').match(/base created automatically/g).length, 1);
});

test('without JOURNAL_AUTO_INIT=1 a missing base stays the error; --init keeps working and prints the password', async (t) => {
  for (const flag of [undefined, '0', 'true', '', 'yes']) {
    const config = tempConfig(t);
    const env = { ...envOf(config), ...(flag === undefined ? {} : { JOURNAL_AUTO_INIT: flag }) };
    const said = [];
    assert.equal((await main([], { env, root: config.root, out: (l) => said.push(l) })).code, EXIT.config, String(flag));
    assert.equal(fs.existsSync(config.dbFile), false);
    assert.equal(said.some((l) => /no_base/.test(l)), true);
  }
  const config = tempConfig(t);
  const env = { ...envOf(config), JOURNAL_AUTO_INIT: '1' };
  const said = [];
  assert.equal((await main(['--init'], { env, root: config.root, out: (l) => said.push(l) })).code, EXIT.ok);
  assert.equal(said.some((l) => /Временный пароль: [a-z2-9]{8}/.test(l)), true);
  assert.equal((await main(['--init'], { env, root: config.root, out: () => {} })).code, EXIT.config);          // the base is there: "exists"
  assert.equal((await main(['--admin-password'], { env, root: config.root, out: () => {} })).code, EXIT.ok);
});

test('the settings file never makes the base by itself, whatever the environment says elsewhere', async (t) => {
  const config = tempConfig(t);
  const { root } = config;
  fs.writeFileSync(path.join(root, 'serve.local.json'), JSON.stringify({ dataDir: config.dataDir, backupDir: config.backupDir, port: 0 }));
  const said = [];
  assert.equal((await main([], { env: { JOURNAL_AUTO_INIT: '1' }, root, out: (l) => said.push(l) })).code, EXIT.config);
  assert.equal(fs.existsSync(config.dbFile), false);
  assert.equal(said.some((l) => /no_base/.test(l)), true);
});

test('--admin-password works while the server runs on the same base: the new password logs in through the running server', async (t) => {
  const config = tempConfig(t);
  const env = { ...envOf(config), JOURNAL_AUTO_INIT: '1' };
  const run = keep(t, await main([], { env, root: config.root, out: () => {}, stopCheckMs: 60000 }));
  assert.equal(run.code, EXIT.ok);
  const wrong = await post(run.server.url, { action: 'auth.login', data: { login: 'admin', password: 'whatever1' } });
  assert.equal(wrong.error.code, 'bad_credentials');
  const made = resetAdminPassword(readConfig({ env, root: config.root }));
  const good = await post(run.server.url, { action: 'auth.login', data: { login: 'admin', password: made.adminTempPassword } });
  assert.equal(good.ok, true);
  assert.equal(good.data.user.mustChangePassword, true);
  assert.equal(JSON.stringify(good).includes('passwordHash'), false);
  // the same through the command itself, with the running server
  const said = [];
  assert.equal((await main(['--admin-password'], { env, root: config.root, out: (l) => said.push(l) })).code, EXIT.ok);
  const typed = said.join('\n').match(/Временный пароль: ([a-z2-9]{8})/)[1];
  assert.equal((await post(run.server.url, { action: 'auth.login', data: { login: 'admin', password: typed } })).ok, true);
  assert.equal((await post(run.server.url, { action: 'auth.login', data: { login: 'admin', password: made.adminTempPassword } })).ok, false);
});

test('in the environment mode the work log goes to the console too; the settings-file mode keeps it quiet', async (t) => {
  const config = tempConfig(t);
  const lines = [];
  const env = { ...envOf(config), JOURNAL_AUTO_INIT: '1' };
  const run = keep(t, await main([], { env, root: config.root, out: () => {}, echo: (l) => lines.push(l), stopCheckMs: 60000 }));
  await run.stop();
  assert.equal(lines.some((l) => /INFO server started on port/.test(l)), true);
  assert.equal(lines.some((l) => /INFO server stopped/.test(l)), true);
  const file = tempConfig(t);
  fs.writeFileSync(path.join(file.root, 'serve.local.json'), JSON.stringify({ dataDir: file.dataDir, backupDir: file.backupDir, port: 0 }));
  const first = await main(['--init'], { env: { }, root: file.root, out: () => {}, echo: (l) => lines.push('FILE ' + l) });
  assert.equal(first.code, EXIT.ok);
  assert.equal(lines.some((l) => l.startsWith('FILE')), false);
});

test('SIGTERM and SIGINT stop the server like the stop file and the program exits with 0', async () => {
  const proc = new EventEmitter();
  proc.exit = (code) => { proc.exited = code; };
  let stops = 0;
  const run = { stop: () => { stops += 1; return Promise.resolve(); }, done: Promise.resolve(0) };
  installSignalHandlers(run, proc);
  assert.deepEqual([proc.listenerCount('SIGTERM'), proc.listenerCount('SIGINT')], [1, 1]);
  proc.emit('SIGTERM');
  proc.emit('SIGINT');
  assert.equal(stops >= 1, true);
  installSignalHandlers({ code: 1 }, new EventEmitter());                                     // a run without stop(): nothing is installed, nothing breaks
});

test('main called from a test installs no signal handlers', async (t) => {
  const config = tempConfig(t);
  const before = [process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')];
  const run = keep(t, await main([], { env: { ...envOf(config), JOURNAL_AUTO_INIT: '1' }, root: config.root, out: () => {}, stopCheckMs: 60000 }));
  assert.deepEqual([process.listenerCount('SIGTERM'), process.listenerCount('SIGINT')], before);
  await run.stop();
});

test('the folders of the container pass the checks: the app in /app-like folder, data and backup beside it, the site inside the app', (t) => {
  const { root, outside } = tempRoot(t);                                                      // root plays the part of /app
  fs.mkdirSync(path.join(root, 'site'));
  const env = { JOURNAL_DATA_DIR: path.join(outside, 'data'), JOURNAL_BACKUP_DIR: path.join(outside, 'backup'), JOURNAL_HOST: '0.0.0.0', JOURNAL_PORT: '5373',
    JOURNAL_SITE_DIR: path.join(root, 'site'), JOURNAL_AUTO_INIT: '1' };
  const config = readConfig({ root, env });
  assert.deepEqual([config.host, config.port, config.siteDir, config.autoInit, config.origins], ['0.0.0.0', 5373, path.join(root, 'site'), true, ['https://janybek.github.io']]);
});

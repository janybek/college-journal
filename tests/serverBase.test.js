import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleRequest } from '../backend/api.js';
import { readConfig } from '../backend/node/config.js';
import { initBase, openBase, resetAdminPassword } from '../backend/node/base.js';
import { PERSON, open, snapshotStaff, tempBase, tempConfig, tempRoot } from './serverSetup.js';

const read = (root, fileData, env = {}) => { if (fileData !== undefined) fs.writeFileSync(path.join(root, 'serve.local.json'), typeof fileData === 'string' ? fileData : JSON.stringify(fileData)); return readConfig({ env, root }); };
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

test('readConfig: the file with the defaults, the environment alone, the derived paths', (t) => {
  const { root, outside } = tempRoot(t);                                  // outside — соседняя папка вне root
  const c = read(root, { dataDir: path.join(outside, 'data'), backupDir: path.join(outside, 'copies') });
  assert.deepEqual([c.port, c.origins, c.alertDir, path.relative(c.dataDir, c.dbFile), path.relative(c.dataDir, c.secretFile), path.relative(c.dataDir, c.logFile),
    path.relative(c.dataDir, c.stateFile), path.relative(c.dataDir, c.stopFile), path.relative(c.dataDir, c.supervisorFile)],
    [5373, ['https://janybek.github.io'], '', 'journal.sqlite', 'secret.key', 'server.log', 'server.state.json', 'stop.request', 'supervisor.state.json']);
  const e = readConfig({ root, env: { JOURNAL_DATA_DIR: path.join(outside, 'other'), JOURNAL_BACKUP_DIR: path.join(outside, 'other-copies'), JOURNAL_PORT: '6001',
    JOURNAL_ORIGINS: 'https://a.example, https://b.example' } });          // файл в root при этом лежит и не читается
  assert.deepEqual([path.basename(e.dataDir), path.basename(e.backupDir), e.port, e.origins], ['other', 'other-copies', 6001, ['https://a.example', 'https://b.example']]);
});
test('readConfig: with JOURNAL_DATA_DIR the settings file is not read at all; without it the JOURNAL_* variables are not read', (t) => {
  const { root, outside } = tempRoot(t);
  const files = { dataDir: path.join(outside, 'from-file'), backupDir: path.join(outside, 'file-copies'), alertDir: path.join(outside, 'file-alert'), port: 6002 };
  fs.writeFileSync(path.join(root, 'serve.local.json'), JSON.stringify(files));
  assert.equal(codeOf(() => readConfig({ root, env: { JOURNAL_DATA_DIR: path.join(outside, 'x') } })), 'no_backup_dir');     // обратная папка не берётся из файла
  const only = readConfig({ root, env: { JOURNAL_DATA_DIR: path.join(outside, 'x'), JOURNAL_BACKUP_DIR: path.join(outside, 'y') } });
  assert.deepEqual([only.alertDir, only.port], ['', 5373]);                                                                 // ни тревога, ни порт не из файла
  fs.writeFileSync(path.join(root, 'serve.local.json'), 'не json');
  assert.equal(readConfig({ root, env: { JOURNAL_DATA_DIR: path.join(outside, 'x'), JOURNAL_BACKUP_DIR: path.join(outside, 'y') } }).port, 5373);   // битый файл не мешает
  fs.writeFileSync(path.join(root, 'serve.local.json'), JSON.stringify(files));
  assert.deepEqual([readConfig({ root, env: { JOURNAL_PORT: '6003', JOURNAL_BACKUP_DIR: path.join(outside, 'z') } }).port, path.basename(readConfig({ root, env: {} }).dataDir)], [6002, 'from-file']);
});
test('readConfig refuses: nothing set, a broken file, folders inside the repository by any spelling, the stand ports, a wildcard origin', (t) => {
  const { root, outside } = tempRoot(t);
  const ok = { dataDir: path.join(outside, 'data'), backupDir: path.join(outside, 'copies') };
  assert.deepEqual([codeOf(() => readConfig({ env: {}, root })), codeOf(() => read(root, { dataDir: ok.dataDir })), codeOf(() => read(root, 'не json')), codeOf(() => read(root, '[]'))],
    ['no_data_dir', 'no_backup_dir', 'bad_config', 'bad_config']);
  for (const inside of [root, path.join(root, 'dev', 'data'), 'dev/data', path.join(outside, '..', path.basename(root), 'x'), root.toUpperCase() + path.sep + 'x', root + path.sep]) {
    assert.equal(codeOf(() => read(root, { ...ok, dataDir: inside })), 'inside_repo', inside);
    assert.equal(codeOf(() => read(root, { ...ok, backupDir: inside })), 'inside_repo', inside);
  }
  assert.equal(codeOf(() => read(root, { ...ok, alertDir: path.join(root, 'site') })), 'inside_repo');
  assert.equal(codeOf(() => read(root, { ...ok, dataDir: root + ' — данные' })), null);                      // сосед с тем же началом имени (как «Журнал колледжа — данные») — не внутри
  assert.equal(codeOf(() => read(root, '﻿' + JSON.stringify(ok))), null);                                 // файл с BOM читается
  for (const port of [5173, 5273, 80, 70000, '5373x', 1.5]) assert.equal(codeOf(() => read(root, { ...ok, port })), 'bad_port', String(port));
  for (const origins of [[], ['*'], ['https://janybek.github.io', '*'], ['http://janybek.github.io'], ['https://janybek.github.io/college-journal'], 'https://janybek.github.io'])
    assert.equal(codeOf(() => read(root, { ...ok, origins })), 'bad_origin', JSON.stringify(origins));
});
test('the repository ignores the local settings and any base file', () => {
  const lines = fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  for (const line of ['serve.local.json', 'secret.key', '*.sqlite*', 'server.state.json', 'supervisor.state.json', 'stop.request', 'server.log*']) assert.equal(lines.includes(line), true, line);
});
test('initBase: the base, the secret and one admin who must change the temporary password; the password is in no file', (t) => {
  const config = tempConfig(t);
  const made = initBase(config);
  assert.deepEqual([made.adminLogin, /^[a-z2-9]{8}$/.test(made.adminTempPassword), /^[0-9a-f]{64}$/.test(fs.readFileSync(config.secretFile, 'utf8').trim())], ['admin', true, true]);
  const base = open(t, config);
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store: base.store, platform: base.platform });
  const session = call('auth.login', { login: 'admin', password: made.adminTempPassword }).data;
  assert.deepEqual([session.user.roles, session.user.mustChangePassword, base.store.list('staff').length, call('dir.list', { table: 'rooms' }, session.token).error.code],
    [['admin'], true, 1, 'must_change_password']);
  assert.equal(base.platform.secret(), fs.readFileSync(config.secretFile, 'utf8').trim());
  for (const name of fs.readdirSync(config.dataDir)) assert.equal(fs.readFileSync(path.join(config.dataDir, name)).includes(made.adminTempPassword), false, name);
  // второй первый запуск: отказ, администратор и секрет прежние
  const secret = fs.readFileSync(config.secretFile, 'utf8');
  assert.equal(codeOf(() => initBase(config)), 'exists');
  assert.deepEqual([fs.readFileSync(config.secretFile, 'utf8'), call('auth.login', { login: 'admin', password: made.adminTempPassword }).ok], [secret, true]);
});
test('openBase never makes a base: a missing folder, a missing file, a missing or short secret', (t) => {
  const config = tempConfig(t);
  assert.deepEqual([codeOf(() => openBase(config)), fs.existsSync(config.dataDir)], ['no_base', false]);
  initBase(config);
  fs.writeFileSync(config.secretFile, 'short');
  assert.equal(codeOf(() => openBase(config)), 'no_secret');
  fs.rmSync(config.secretFile);
  assert.equal(codeOf(() => openBase(config)), 'no_secret');
  fs.rmSync(config.dbFile);
  assert.deepEqual([codeOf(() => openBase(config)), fs.existsSync(config.dbFile)], ['no_base', false]);
});
test('a token lives through a restart; upgrade adds a new sheet and keeps the rows', (t) => {
  const { config } = tempBase(t);
  let base = open(t, config);
  const token = handleRequest({ action: 'auth.login', data: { login: PERSON.login, password: PERSON.password } }, base).data.token;
  base.db.exec('DROP TABLE "rooms"');
  base.close();
  base = open(t, config);
  assert.deepEqual(base.upgrade(), { created: ['rooms'], added: [] });
  assert.equal(handleRequest({ action: 'auth.me', token }, base).data.user.fullName, PERSON.fullName);
});
test('resetAdminPassword: the old password dies, the new one works and must be changed; other people are untouched; a lost admin row comes back', (t) => {
  const { config, tempPassword } = tempBase(t);
  const before = snapshotStaff(config, (row) => row.login !== 'admin');   // строки остальных сотрудников целиком
  const made = resetAdminPassword(config);
  const base = open(t, config);
  const call = (action, data, token) => handleRequest({ action, data, token }, base);
  assert.deepEqual([made.adminTempPassword !== tempPassword, call('auth.login', { login: 'admin', password: tempPassword }).error.code,
    call('auth.login', { login: 'admin', password: made.adminTempPassword }).data.user.mustChangePassword], [true, 'bad_credentials', true]);
  assert.deepEqual(snapshotStaff(config, (row) => row.login !== 'admin'), before);
  base.store.removeMany('staff', base.store.list('staff').filter((r) => r.login === 'admin').map((r) => r.id));
  const again = resetAdminPassword(config);
  assert.equal(call('auth.login', { login: 'admin', password: again.adminTempPassword }).ok, true);
});

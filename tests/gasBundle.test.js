import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildGas } from '../scripts/build-gas.js';
import { createFakeGas } from './fakes/fakeGas.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { hashPassword } from '../core/auth.js';

let codeFile;
let code;

before(() => {
  codeFile = buildGas();
  code = fs.readFileSync(codeFile, 'utf8');
});

// Runs the built bundle in a fresh context holding only the fake Apps Script globals.
function load() {
  const gas = createFakeGas();
  const sandbox = vm.createContext({ ...gas.globals, console: { error() {}, log() {} } });
  vm.runInContext(code, sandbox, { filename: 'Code.js' });
  const post = (body) => JSON.parse(sandbox.doPost({ postData: { contents: body } }).getContent());
  const call = (action, data, token) => post(JSON.stringify({ action, data, token }));
  return { gas, sandbox, post, call };
}

test('bundle has no Node-only references and carries the three entry points', () => {
  assert.doesNotMatch(code, /require\(/);
  assert.doesNotMatch(code, /node:/);
  assert.doesNotMatch(code, /\bprocess\b/);
  assert.match(code, /function doPost\(e\) \{ return App\.doPost\(e\); \}/);
  assert.match(code, /function doGet\(e\) \{ return App\.doGet\(e\); \}/);
  assert.match(code, /function setup\(\) \{ return App\.setup\(\); \}/);
  const manifest = JSON.parse(fs.readFileSync(codeFile.replace('Code.js', 'appsscript.json'), 'utf8'));
  assert.equal(manifest.timeZone, 'Asia/Bishkek');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.exceptionLogging, 'STACKDRIVER');
  assert.deepEqual(manifest.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('setup creates the admin once, doPost logs in', () => {
  const { gas, sandbox, post, call } = load();
  const first = sandbox.setup();
  assert.equal(first.adminLogin, 'admin');
  assert.match(first.adminTempPassword, /^[a-z2-9]{8}$/);
  assert.match(first.spreadsheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\//);
  assert.equal(gas.logs.length, 1);
  assert.equal(JSON.parse(gas.logs[0]).adminTempPassword, first.adminTempPassword);

  assert.equal(sandbox.setup().adminTempPassword, null);

  const login = call('auth.login', { login: 'admin', password: first.adminTempPassword });
  assert.equal(login.ok, true);
  assert.equal(login.data.user.mustChangePassword, true);
  assert.equal(JSON.stringify(login).includes('passwordHash'), false);
  assert.equal(post('мусор').error.code, 'bad_request');
});

test('doPost answers not_configured before setup, and a missing postData is a bad_request', () => {
  const { sandbox, post } = load();
  const res = post('{}');
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'not_configured');
  assert.equal(typeof res.serverTime, 'number');
  sandbox.setup();
  assert.equal(JSON.parse(sandbox.doPost({}).getContent()).error.code, 'bad_request');
  assert.equal(JSON.parse(sandbox.doPost().getContent()).error.code, 'bad_request');
});

test('doGet answers with the journal marker as JSON', () => {
  const { sandbox } = load();
  const out = sandbox.doGet();
  assert.deepEqual(JSON.parse(out.getContent()), { ok: true, data: 'journal' });
  assert.equal(out.getMimeType(), 'JSON');
});

test('a Cyrillic password works after changing the admin password', () => {
  const { sandbox, call } = load();
  const { adminTempPassword } = sandbox.setup();
  const session = call('auth.login', { login: 'admin', password: adminTempPassword });
  const changed = call('auth.changePassword', { oldPassword: adminTempPassword, newPassword: 'Новый-пароль-42' }, session.data.token);
  assert.equal(changed.ok, true);
  const again = call('auth.login', { login: 'admin', password: 'Новый-пароль-42' });
  assert.equal(again.ok, true);
  assert.equal(again.data.user.mustChangePassword, false);
  assert.equal(call('auth.me', {}, again.data.token).ok, true);
  assert.equal(call('auth.login', { login: 'admin', password: 'новый-пароль-42' }).ok, false);
});

test('setup is idempotent: default sheet gone once, same spreadsheet, one admin row', () => {
  const { gas, sandbox } = load();
  assert.equal(gas.spreadsheets.size, 0);
  const first = sandbox.setup();
  const [spreadsheet] = gas.spreadsheets.values();
  assert.equal(spreadsheet.getSheetByName('Лист1'), null);
  assert.notEqual(spreadsheet.getSheetByName('Сотрудники'), null);
  for (const name of ['Шаблон недели', 'Темы', 'Пары']) assert.ok(spreadsheet.getSheetByName(name), name);
  const secret = gas.properties.get('SECRET');
  assert.match(secret, /^[0-9a-f]{64}$/);

  assert.equal(spreadsheet.getSpreadsheetTimeZone(), 'Asia/Bishkek');
  assert.equal(spreadsheet.getSpreadsheetLocale(), 'ru_RU');

  const second = sandbox.setup();
  assert.equal(gas.spreadsheets.size, 1);
  assert.equal(second.spreadsheetUrl, first.spreadsheetUrl);
  assert.equal(gas.properties.get('SECRET'), secret);
  assert.equal(spreadsheet.dump('Сотрудники').length, 2);
});

test('every waitLock has a matching releaseLock, also when the store throws', () => {
  const { gas, sandbox, call } = load();
  const { adminTempPassword } = sandbox.setup();
  const session = call('auth.login', { login: 'admin', password: adminTempPassword });
  call('auth.changePassword', { oldPassword: adminTempPassword, newPassword: 'journal-2026' }, session.data.token);
  assert.ok(gas.lockCalls.waits.length > 0);
  assert.ok(gas.lockCalls.waits.every((ms) => ms === 10000));
  assert.equal(gas.lockCalls.releases, gas.lockCalls.waits.length);

  // A write failing inside the lock still releases it and still gives a JSON answer.
  const [spreadsheet] = gas.spreadsheets.values();
  const sheet = spreadsheet.getSheetByName('Сотрудники');
  sheet.getRange = () => { throw new Error('boom'); };
  const res = call('auth.changePassword', { oldPassword: 'journal-2026', newPassword: 'journal-2027' }, session.data.token);
  assert.equal(res.ok, false);
  assert.equal(gas.lockCalls.releases, gas.lockCalls.waits.length);
});

test('doPost never throws: a broken environment still gives a JSON internal error', () => {
  const { gas, sandbox } = load();
  sandbox.setup();
  gas.globals.SpreadsheetApp.openById = () => { throw new Error('no access'); };
  const res = JSON.parse(sandbox.doPost({ postData: { contents: '{}' } }).getContent());
  assert.deepEqual(res, { ok: false, error: { code: 'internal' } });
});

test('hashes made inside the Apps Script bundle verify with the Node platform', () => {
  const { gas, sandbox, call } = load();
  const { adminTempPassword } = sandbox.setup();
  const [spreadsheet] = gas.spreadsheets.values();
  const header = spreadsheet.dump('Сотрудники')[0];
  const hashIndex = header.indexOf('хэш пароля');
  const node = createNodePlatform({ now: () => 0, secret: 's' });
  const storedHash = () => spreadsheet.dump('Сотрудники')[1][hashIndex];
  const sameHash = (password) => {
    const [, rounds, salt] = storedHash().split('$');
    return hashPassword(node, password, salt, Number(rounds)) === storedHash();
  };

  assert.match(storedHash(), /^v1\$20\$/);
  assert.equal(sameHash(adminTempPassword), true);

  const session = call('auth.login', { login: 'admin', password: adminTempPassword });
  call('auth.changePassword', { oldPassword: adminTempPassword, newPassword: 'Пароль-Ёж-2026' }, session.data.token);
  assert.equal(sameHash('Пароль-Ёж-2026'), true);
  assert.equal(sameHash('Пароль-Еж-2026'), false);
});

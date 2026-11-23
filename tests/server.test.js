import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createLoginGuard, LOGIN_LIMIT } from '../core/loginGuard.js';
import { createLogger } from '../backend/node/log.js';
import { main, EXIT } from '../backend/node/server.js';
import { ORIGIN, PERSON, dropTable, keep, login, roomsIn, sleep, start, tempConfig, tempDir } from './serverSetup.js';

test('the site gets its answer with its own origin in the header and never a wildcard; the server listens on 127.0.0.1 only', async (t) => {
  const { srv, post, raw } = await start(t);
  const res = await post(login(PERSON.password), { Origin: ORIGIN });
  assert.deepEqual([res.status, res.headers.get('access-control-allow-origin'), res.headers.get('vary'), res.headers.get('cache-control'), res.headers.get('x-content-type-options'), (await res.json()).ok],
    [200, ORIGIN, 'Origin', 'no-store', 'nosniff', true]);
  assert.equal(srv.address, '127.0.0.1');
  const health = await raw('GET', '/health');
  assert.deepEqual([health.status, JSON.parse(health.body), health.headers['access-control-allow-origin']], [200, { ok: true, data: 'journal' }, undefined]);
});

test('a foreign, look-alike, null or missing Origin: 403, nothing is run, nothing is written and a login attempt is not counted', async (t) => {
  const { post, raw, config } = await start(t, { guard: createLoginGuard({ ...LOGIN_LIMIT, attempts: 2 }) });
  const token = (await (await post(login(PERSON.password), { Origin: ORIGIN })).json()).data.token;
  const strangers = ['https://evil.example', 'https://janybek.github.io.evil.example', 'https://evil.example/https://janybek.github.io', 'http://janybek.github.io',
    'https://JANYBEK.github.io', 'https://janybek.github.io/', 'https://janybek.github.io:444', 'https://janybek.github.io, https://evil.example', 'null', '*', undefined];
  for (const origin of strangers) {
    const headers = origin === undefined ? {} : { Origin: origin };
    const res = await post({ action: 'dir.save', token, data: { table: 'rooms', row: { name: 'Чужая' } } }, headers);
    assert.deepEqual([res.status, res.headers.get('access-control-allow-origin'), (await res.json()).error.code], [403, null, 'forbidden_origin'], String(origin));
    assert.equal((await post(login('wrong'), headers)).status, 403, String(origin));
  }
  assert.equal((await raw('GET', '/health')).status, 200);                                         // the server is alive after all the foreign requests
  assert.equal(roomsIn(config).length, 0);                                                         // read through a separate connection
  assert.equal((await (await post(login(PERSON.password), { Origin: ORIGIN })).json()).ok, true);  // foreign "failures" did not close the login
});

test('password guessing over the network: the limit holds whatever the headers and the spelling of the login', async (t) => {
  const { post } = await start(t, { guard: createLoginGuard({ ...LOGIN_LIMIT, attempts: 3 }) });
  const tries = [['zebra', {}], ['ZEBRA', { 'X-Forwarded-For': '10.0.0.1' }], [' zebra ', { 'X-Forwarded-For': '10.0.0.2', 'User-Agent': 'other', 'X-Real-IP': '10.0.0.3' }]];
  for (const [name, extra] of tries) assert.equal((await (await post(login('wrong', name), { Origin: ORIGIN, ...extra })).json()).error.code, 'bad_credentials');
  for (const extra of [{}, { 'X-Forwarded-For': '10.9.9.9' }, { Forwarded: 'for=10.8.8.8' }])
    assert.equal((await (await post(login(PERSON.password), { Origin: ORIGIN, ...extra })).json()).error.code, 'too_many_attempts');
});

test('nothing is served from the disk, by any path', async (t) => {
  const { raw, config } = await start(t);
  fs.writeFileSync(path.join(config.dataDir, 'note.txt'), 'TOP-SECRET');
  const paths = ['/', '/index.html', '/journal.sqlite', '/secret.key', '/server.log', '/note.txt', '/../note.txt', '/api/../note.txt', '/api/', '/api/note.txt', '/%2e%2e/note.txt',
    '/..%2fnote.txt', '/api%2f..%2fsecret.key', '/..\\secret.key', '//note.txt', '/health/../secret.key', '/' + encodeURIComponent(config.secretFile),
    '//', '///', '/\\', '//[', '//@/api', '//:80/api', '//%00/api'];                                  // on some of these the path parser throws: the answer is 404, not a crash
  const secret = fs.readFileSync(config.secretFile, 'utf8').trim();
  for (const p of paths) for (const method of ['GET', 'HEAD', 'POST']) {
    const res = await raw(method, p, { Origin: ORIGIN });
    assert.deepEqual([res.status, res.body.includes('TOP-SECRET'), res.body.includes(secret), res.body.includes('SQLite format')], [404, false, false, false], `${method} ${p}`);
  }
  assert.equal((await raw('GET', '/health')).status, 200);                                            // alive after all of them
});

test('a client that hangs up in the middle of a request does not stop the server', async (t) => {
  const { srv, post, raw } = await start(t);
  for (const head of ['POST /api HTTP/1.1\r\nHost: x\r\nOrigin: ' + ORIGIN + '\r\nContent-Length: 1000\r\n\r\n{"action":"auth', 'POST /api HTTP/1.1\r\nHost: x\r\nOrigin: ' + ORIGIN + '\r\nContent-Le']) {
    const socket = net.connect(srv.port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(head);
    socket.destroy();                                                                                 // the client left without the rest of the body
  }
  await sleep(100);
  assert.deepEqual([(await raw('GET', '/health')).status, (await (await post(login(PERSON.password), { Origin: ORIGIN })).json()).ok], [200, true]);
});

test('a huge body and a broken request are answered and the process lives on', async (t) => {
  const { srv, post, raw } = await start(t, { maxBodyBytes: 100000 });
  const big = await post({ action: 'auth.login', data: { login: 'x', password: 'y'.repeat(3 * 1024 * 1024) } }, { Origin: ORIGIN });
  assert.equal(big.status, 413);
  const garbage = net.connect(srv.port, '127.0.0.1');
  garbage.on('error', () => {});
  await new Promise((resolve) => garbage.once('connect', resolve));
  garbage.write('\x00\x01 not http at all\r\n\r\n');
  await new Promise((resolve) => { garbage.once('close', resolve); setTimeout(resolve, 500); });
  garbage.destroy();
  assert.equal((await raw('GET', '/health')).status, 200);
  assert.equal((await post({ action: 'auth.me' }, { Origin: ORIGIN })).status, 200);
});

test('/api answers 405 to other methods and 413 to an oversized body, as the stand does', async (t) => {
  const { raw, post } = await start(t, { maxBodyBytes: 1000 });
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await raw(method, '/api', { Origin: ORIGIN });
    assert.deepEqual([res.status, res.headers.allow, res.headers['access-control-allow-origin']], [405, 'POST', undefined], method);
  }
  assert.equal((await post({ action: 'auth.me', data: { pad: 'x'.repeat(2000) } }, { Origin: ORIGIN })).status, 413);
});

test('the work log: one line a request, by Bishkek time, and no password, token, login, name or body in it - also when the store breaks under a handler', async (t) => {
  const { post, config } = await start(t, { now: () => Date.UTC(2026, 10, 22, 20, 30, 5) });           // 23.11.2026 02:30:05 Bishkek
  const token = (await (await post(login(PERSON.password), { Origin: ORIGIN })).json()).data.token;
  await post(login('Wrong-pass-77'), { Origin: ORIGIN });
  await post({ action: 'нет.такого\nERROR подделка', token, data: { note: 'body-marker-42' } }, { Origin: ORIGIN });
  dropTable(config, 'rooms');                                                                           // a real breakage: the sheet is gone
  await post({ action: 'dir.list', token, data: { table: 'rooms', note: 'body-marker-42' } }, { Origin: ORIGIN });
  const text = fs.readFileSync(config.logFile, 'utf8');
  for (const secret of [PERSON.password, 'Wrong-pass-77', token, PERSON.login, PERSON.fullName, 'body-marker-42', 'подделка'])
    assert.equal(text.includes(secret), false, secret);
  const lines = text.trim().split('\n');
  assert.deepEqual(lines.filter((l) => / api /.test(l)).map((l) => l.replace(/\d+ms$/, 'Nms')),
    ['2026-11-23 02:30:05 INFO api auth.login ok Nms', '2026-11-23 02:30:05 INFO api auth.login bad_credentials Nms',
      '2026-11-23 02:30:05 INFO api ? bad_request Nms', '2026-11-23 02:30:05 INFO api dir.list internal Nms']);
  assert.equal(lines.some((l) => /^2026-11-23 02:30:05 ERROR handler/.test(l)), true);
  assert.equal(/no such table/.test(text), true);
});

test('createLogger: a file over the limit moves to .1 and the log starts again; a line break cannot make a second line; a log that cannot be written breaks nothing', (t) => {
  const file = path.join(tempDir(t), 'server.log');
  const log = createLogger(file, { now: () => Date.UTC(2026, 10, 22, 6), maxBytes: 200 });
  for (let i = 0; i < 10; i++) log.info(`строка ${i} ${'x'.repeat(30)}`);
  const last = () => fs.readFileSync(file, 'utf8').trim().split('\n').at(-1);
  assert.deepEqual([fs.existsSync(file + '.1'), fs.statSync(file).size < 400, last().startsWith('2026-11-22 12:00:00 INFO строка 9 ')], [true, true, true]);
  log.info('две\nстроки');
  assert.equal(last(), '2026-11-22 12:00:00 INFO две строки');
  const lost = createLogger(path.join(file, 'нет', 'server.log'), { now: () => 0 });          // the folder is inside a file: nowhere to write
  assert.doesNotThrow(() => { lost.info('x'); lost.error('y', new Error('z')); });
});

test('main: a plain start never makes a base; the stand words --reset, --real and --seed are refused; a start outside settings is refused', async (t) => {
  const config = tempConfig(t);
  const env = { JOURNAL_DATA_DIR: config.dataDir, JOURNAL_BACKUP_DIR: config.backupDir, JOURNAL_PORT: '0' };
  const said = [];
  for (const argv of [[], ['--reset'], ['--real'], ['--seed'], ['--init', '--reset']])
    assert.deepEqual([(await main(argv, { env, root: config.root, out: (line) => said.push(line) })).code, fs.existsSync(config.dbFile), fs.existsSync(config.dataDir)], [EXIT.config, false, false], argv.join(' '));
  assert.equal((await main([], { env: {}, root: config.root, out: () => {} })).code, EXIT.config);
  said.length = 0;
  assert.deepEqual([(await main(['--init'], { env, root: config.root, out: (line) => said.push(line), nodeVersion: '22.1.0' })).code, fs.existsSync(config.dataDir), said.some((l) => /Node 24/.test(l))],
    [EXIT.config, false, true]);                                                                      // an old Node: a clear phrase, nothing is made
});

test('main --init shows the temporary password in the window only; then the server starts, answers and writes its state file; --admin-password gives a new one', async (t) => {
  const config = tempConfig(t);
  const env = { JOURNAL_DATA_DIR: config.dataDir, JOURNAL_BACKUP_DIR: config.backupDir, JOURNAL_PORT: '0' };
  const said = [];
  const out = (line) => said.push(line);
  assert.equal((await main(['--init'], { env, root: config.root, out })).code, 0);
  const password = said.find((l) => l.startsWith('Временный пароль: ')).slice('Временный пароль: '.length);
  assert.equal(/^[a-z2-9]{8}$/.test(password), true);
  const run = keep(t, await main([], { env, root: config.root, out }));
  assert.deepEqual([run.code, JSON.parse(fs.readFileSync(config.stateFile, 'utf8')).port, fs.readFileSync(config.logFile, 'utf8').includes(password)], [0, run.server.port, false]);
  const res = await fetch(run.server.url + '/api', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'auth.login', data: { login: 'admin', password } }) });
  assert.equal((await res.json()).data.user.mustChangePassword, true);
  assert.equal((await main([], { env: { ...env, JOURNAL_PORT: String(run.server.port) }, root: config.root, out })).code, EXIT.portBusy);     // a second server on the same port
  assert.equal((await main(['--init'], { env, root: config.root, out })).code, EXIT.config);                                               // the base already exists
  await run.stop();
  assert.equal(fs.existsSync(config.stateFile), false);
  said.length = 0;
  assert.equal((await main(['--admin-password'], { env, root: config.root, out })).code, 0);
  assert.equal(said.some((l) => l.startsWith('Временный пароль: ') && !l.endsWith(password)), true);
  assert.equal(fs.readFileSync(config.logFile, 'utf8').includes(said.find((l) => l.startsWith('Временный пароль: ')).slice(18)), false);
});

test('OPTIONS /api: our own site gets 204 and the CORS headers, a stranger or no Origin gets 403, GET is still 405', async (t) => {
  const { raw } = await start(t);
  const ok = await raw('OPTIONS', '/api', { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' });
  assert.deepEqual([ok.status, ok.body, ok.headers['access-control-allow-origin'], ok.headers['access-control-allow-methods'], ok.headers['access-control-allow-headers'],
    ok.headers['access-control-max-age'], ok.headers.vary], [204, '', ORIGIN, 'POST', 'Content-Type', '600', 'Origin']);
  for (const origin of ['https://evil.example', 'https://janybek.github.io.evil.example', 'null', undefined]) {
    const res = await raw('OPTIONS', '/api', origin === undefined ? {} : { Origin: origin });
    assert.deepEqual([res.status, res.headers['access-control-allow-origin'], JSON.parse(res.body).error.code], [403, undefined, 'forbidden_origin'], String(origin));
  }
  const get = await raw('GET', '/api', { Origin: ORIGIN });
  assert.deepEqual([get.status, get.headers.allow], [405, 'POST']);
});

test('main: at the start the sweep removes an old orphan file, also on a base of unit 4 that has no table of files', async (t) => {
  const config = tempConfig(t);
  const env = { JOURNAL_DATA_DIR: config.dataDir, JOURNAL_BACKUP_DIR: config.backupDir, JOURNAL_ALERT_DIR: config.alertDir, JOURNAL_PORT: '0' };
  assert.equal((await main(['--init'], { env, root: config.root, out: () => {} })).code, 0);
  dropTable(config, 'files');
  const orphan = path.join(config.filesDir, 'ab'.repeat(16) + '.bin');
  const fresh = path.join(config.filesDir, 'cd'.repeat(16) + '.bin');
  fs.mkdirSync(config.filesDir, { recursive: true });
  for (const file of [orphan, fresh]) fs.writeFileSync(file, 'x');
  const old = new Date(Date.now() - 5 * 3600000);
  fs.utimesSync(orphan, old, old);
  const run = keep(t, await main([], { env, root: config.root, out: () => {} }));
  assert.deepEqual([run.code, fs.existsSync(orphan), fs.existsSync(fresh), run.base.store.list('files')], [0, false, true, []]);
  assert.match(fs.readFileSync(config.logFile, 'utf8'), /files swept: 0 rows, 1 files/);
});

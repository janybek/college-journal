import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createLogger } from '../backend/node/log.js';
import { main, EXIT } from '../backend/node/server.js';
import { nextDelay, isAlive, isOurSupervisor, runSupervised, requestStop, readStatus, cli } from '../backend/node/supervisor.js';
import { START_ALERT_FILE } from '../backend/node/config.js';
import { PERSON, envOf, keep, quiet, sleep, tempBase, tempConfig, tempDir, until } from './serverSetup.js';

const LIMITS = { firstMs: 10, maxMs: 40, stableMs: 60000 };
const fileLog = (config) => createLogger(config.logFile, { now: () => new Date().getTime() });
const stateOf = (config) => {
  try { return JSON.parse(fs.readFileSync(config.stateFile, 'utf8')); } catch (error) { return null; }
};

// A small script that appends a line to runs-<code>.txt and exits with the code.
function exitWith(dir, code) {
  const file = path.join(dir, `exit-${code}.mjs`);
  fs.writeFileSync(file, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(path.join(dir, `runs-${code}.txt`))}, 'run\\n');\nprocess.exit(${code});\n`);
  return file;
}
const runsOf = (dir, code = 'crash') => {
  try { return fs.readFileSync(path.join(dir, `runs-${code}.txt`), 'utf8').trim().split('\n').length; } catch (error) { return 0; }
};

test('nextDelay: 1 s first, doubles up to a minute, starts over after a stable minute', () => {
  assert.deepEqual([nextDelay(0, 0), nextDelay(1000, 10), nextDelay(2000, 10), nextDelay(32000, 10), nextDelay(60000, 10), nextDelay(60000, 60000), nextDelay(8000, 59999)],
    [1000, 2000, 4000, 60000, 60000, 1000, 16000]);
});

test('a crashed server is started again and the log says so; an exit by settings or a busy port is not', async (t) => {
  const config = tempConfig(t);
  const dir = tempDir(t);
  const crashOnce = path.join(dir, 'crash-once.mjs');
  fs.writeFileSync(crashOnce, `import fs from 'node:fs';
const runs = ${JSON.stringify(path.join(dir, 'runs-crash.txt'))};
const first = !fs.existsSync(runs);
fs.appendFileSync(runs, 'run\\n');
process.exit(first ? 1 : ${EXIT.ok});
`);
  const log = quiet();
  const sup = runSupervised({ config, logger: log, command: process.execPath, args: [crashOnce], limits: LIMITS });
  assert.equal(await sup.done, EXIT.ok);
  assert.deepEqual([runsOf(dir), log.lines.some((l) => /ERROR server exited with 1, restart in 10 ms/.test(l))], [2, true]);
  for (const code of [EXIT.config, EXIT.portBusy]) {
    const once = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, code)], limits: LIMITS });
    assert.deepEqual([await once.done, runsOf(dir, code)], [code, 1], String(code));
  }
});

test('the real server under supervision: killed, it comes back by itself; a stop request ends both and nothing restarts', async (t) => {
  const { config } = tempBase(t);
  const log = fileLog(config);
  const sup = keep(t, runSupervised({ config, logger: log, limits: { firstMs: 50, maxMs: 200, stableMs: 60000 }, env: envOf(config) }));
  const first = await until(() => stateOf(config));
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/health`)).status, 200);
  const supervisor = JSON.parse(fs.readFileSync(config.supervisorFile, 'utf8'));
  assert.deepEqual([supervisor.pid, isAlive(supervisor.pid), supervisor.pid !== first.pid], [process.pid, true, true]);
  process.kill(first.pid);
  const second = await until(() => { const s = stateOf(config); return s && s.pid !== first.pid ? s : null; });
  assert.equal((await fetch(`http://127.0.0.1:${second.port}/health`)).status, 200);
  assert.deepEqual((await readStatus(config)).supervisor, { running: true, pid: process.pid });
  assert.deepEqual(await requestStop(config, { waitMs: 10000 }), { stopped: true });
  assert.deepEqual([await sup.done, fs.existsSync(config.stateFile), fs.existsSync(config.stopFile), fs.existsSync(config.supervisorFile), isAlive(second.pid)], [EXIT.ok, false, false, false, false]);
  await assert.rejects(fetch(`http://127.0.0.1:${second.port}/health`));
  assert.equal(fs.readFileSync(config.logFile, 'utf8').includes(' restart in '), true);
});

test('a stop request that comes in the pause before a restart ends the supervision: nothing starts again', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const log = quiet();
  const sup = keep(t, runSupervised({ config, logger: log, command: process.execPath, args: [exitWith(dir, 1)], limits: { firstMs: 5000, maxMs: 5000, stableMs: 60000, pollMs: 20 } }));
  await until(() => log.lines.some((l) => /ERROR server exited with 1, restart in 5000 ms/.test(l)));
  assert.deepEqual(await requestStop(config, { waitMs: 3000 }), { stopped: true });
  assert.deepEqual([await sup.done, runsOf(dir, 1), fs.existsSync(config.supervisorFile), fs.existsSync(config.stopFile)], [EXIT.ok, 1, false, false]);
});

test('a second start beside a running server exits with the port code, leaves the first one answering and does not loop', async (t) => {
  const { config } = tempBase(t);
  const first = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, stopCheckMs: 60000 }));
  const second = runSupervised({ config, logger: quiet(), env: { ...envOf(config), JOURNAL_PORT: String(first.server.port) }, limits: LIMITS });
  assert.equal(await second.done, EXIT.portBusy);
  assert.deepEqual([(await fetch(first.server.url + '/health')).status, stateOf(config).port], [200, first.server.port]);
  fs.writeFileSync(config.stopFile, '');
  const third = await main([], { env: { ...envOf(config), JOURNAL_PORT: String(first.server.port) }, root: config.root, out: () => {} });
  assert.deepEqual([third.code, fs.existsSync(config.stopFile)], [EXIT.portBusy, true]);
});

test('requestStop without a running server says so and leaves no request file; a dead supervisor file is cleared; a stale request file does not stop the next start', async (t) => {
  const { config } = tempBase(t);
  assert.deepEqual([await requestStop(config, { waitMs: 200 }), fs.existsSync(config.stopFile)], [{ stopped: false, reason: 'not_running' }, false]);
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: dead, startedAt: 0 }));
  assert.deepEqual([await requestStop(config, { waitMs: 200 }), fs.existsSync(config.supervisorFile), fs.existsSync(config.stopFile)], [{ stopped: false, reason: 'not_running' }, false, false]);
  fs.writeFileSync(config.stopFile, '');
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, stopCheckMs: 30 }));
  await sleep(200);
  assert.deepEqual([(await fetch(run.server.url + '/health')).status, fs.existsSync(config.stopFile)], [200, false]);
});

test('a server started directly is stopped by the request too; a foreign program on the port is not taken for the journal', async (t) => {
  const { config } = tempBase(t);
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, stopCheckMs: 30 }));
  assert.deepEqual(await requestStop(config, { waitMs: 5000 }), { stopped: true });
  assert.deepEqual([await run.done, fs.existsSync(config.stateFile), fs.existsSync(config.stopFile)], [EXIT.ok, false, false]);
  const foreign = keep(t, http.createServer((req, res) => res.end('hello')));
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(config.stateFile, JSON.stringify({ pid: process.pid, port: foreign.address().port, startedAt: 0 }));
  assert.deepEqual([await requestStop(config, { waitMs: 200 }), fs.existsSync(config.stopFile)], [{ stopped: false, reason: 'not_running' }, false]);
});

test('readStatus: running, the port, the last copy, the count of copies, of ERROR lines and of failed logins of today; no names in it', async (t) => {
  const { config } = tempBase(t);
  const noon = () => Date.UTC(2026, 10, 22, 6);
  assert.deepEqual(await readStatus(config, { now: noon }), { running: false, port: null, startedAt: null, supervisor: { running: false, pid: null }, lastCopy: null, copies: 0, errorsToday: 0, failedLoginsToday: 0 });
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, now: noon }));
  createLogger(config.logFile, { now: noon }).error('проба');
  createLogger(config.logFile, { now: () => noon() - 86400000 }).error('вчерашняя');
  for (const [at, text] of [[noon, 'api auth.login bad_credentials 3ms'], [noon, 'api auth.login bad_credentials 4ms'], [noon, 'api auth.login ok 5ms'], [() => noon() - 86400000, 'api auth.login bad_credentials 3ms']])
    createLogger(config.logFile, { now: at }).info(text);
  const status = await readStatus(config, { now: noon });
  assert.deepEqual([status.running, status.port, status.lastCopy, status.copies, status.errorsToday, status.failedLoginsToday], [true, run.server.port, 'journal-2026-11-22.sqlite', 1, 1, 2]);
  assert.equal(JSON.stringify(status).includes(PERSON.fullName), false);
});

test('a second supervisor beside a living one does not start a server and leaves the first one its file', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => other.kill());     // stands for the first supervisor; the test ends it by its own handle
  const note = JSON.stringify({ pid: other.pid, startedAt: new Date().getTime() });
  fs.writeFileSync(config.supervisorFile, note);
  const second = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, 8)], limits: LIMITS });
  assert.deepEqual([await second.done, runsOf(dir, 8), fs.readFileSync(config.supervisorFile, 'utf8')], [EXIT.portBusy, 0, note]);
});

test('a stop request that nobody carried out is taken back after the timeout, and the next supervisor starts', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => other.kill());     // stands for a supervisor that is alive but does not carry out requests
  fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: other.pid, startedAt: new Date().getTime() }));
  assert.deepEqual([await requestStop(config, { waitMs: 200 }), fs.existsSync(config.stopFile)], [{ stopped: false, reason: 'timeout' }, false]);
  fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: other.pid, startedAt: 0 }));        // the note grew old: the number is not a supervisor any more
  const next = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, 0)], limits: LIMITS });
  assert.deepEqual([await next.done, runsOf(dir, 0)], [EXIT.ok, 1]);
});

test('a number in supervisor.state.json that went to a foreign program: the supervisor starts, --status says it is not ours, --stop clears the file and kills nobody', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => foreign.kill());
  const old = JSON.stringify({ pid: foreign.pid, startedAt: new Date().getTime() - 3600000, seenAt: new Date().getTime() - 60000 });
  fs.writeFileSync(config.supervisorFile, old);
  const env = envOf(config);
  const lines = [];
  await cli(['--status'], { env, root: config.root, out: (l) => lines.push(l) });
  assert.deepEqual([lines.some((l) => /Процесс присмотра: \d+ \(не работает: .*чужой\)/.test(l)), (await readStatus(config)).supervisor], [true, { running: false, pid: null }]);
  const out = [];
  assert.deepEqual([(await cli(['--stop'], { env, root: config.root, out: (l) => out.push(l) })).code, out, fs.existsSync(config.supervisorFile), fs.existsSync(config.stopFile), isAlive(foreign.pid)],
    [EXIT.ok, ['Сервер не запущен'], false, false, true]);
  fs.writeFileSync(config.supervisorFile, old);
  const sup = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, 0)], limits: LIMITS });
  assert.deepEqual([await sup.done, runsOf(dir, 0), isAlive(foreign.pid)], [EXIT.ok, 1, true]);
});

test('the supervisor renews seenAt in its file while it works, so that a living supervisor is told from a number left behind', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const hang = path.join(dir, 'hang.mjs');
  fs.writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
  const sup = keep(t, runSupervised({ config, logger: quiet(), command: process.execPath, args: [hang], limits: { ...LIMITS, heartbeatMs: 20 } }));
  const note = () => JSON.parse(fs.readFileSync(config.supervisorFile, 'utf8'));
  const first = await until(() => (fs.existsSync(config.supervisorFile) ? note() : null));
  const later = await until(() => { const n = note(); return n.seenAt > first.seenAt ? n : null; });
  assert.deepEqual([later.pid, later.startedAt, isOurSupervisor(later)], [process.pid, first.startedAt, true]);
  assert.equal(isOurSupervisor({ ...later, seenAt: later.seenAt - 31000 }), false);
  assert.equal(isOurSupervisor({ pid: later.pid }), false);
  await sup.stop();
});

test('a stop request left from before the start does not stop the new supervisor', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  fs.writeFileSync(config.stopFile, '');
  const sup = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, 0)], limits: LIMITS });
  assert.deepEqual([await sup.done, runsOf(dir, 0), fs.existsSync(config.stopFile)], [EXIT.ok, 1, false]);       // the child ran once and ended by itself
});

test('a server that cannot start leaves the alarm file on the desktop; a server that does start removes it; a second start beside a running journal leaves none', async (t) => {
  const { config } = tempBase(t);
  const dir = tempDir(t);
  const alarm = path.join(config.alertDir, START_ALERT_FILE);
  const gone = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, EXIT.config)], limits: LIMITS });
  assert.deepEqual([await gone.done, fs.existsSync(alarm)], [EXIT.config, true]);
  assert.equal(fs.readFileSync(alarm, 'utf8').includes(PERSON.fullName), false);
  const run = keep(t, await main([], { env: envOf(config), root: config.root, out: () => {}, stopCheckMs: 60000 }));
  assert.equal(fs.existsSync(alarm), false);
  const second = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, EXIT.portBusy)], limits: LIMITS });
  assert.deepEqual([await second.done, fs.existsSync(alarm), (await fetch(run.server.url + '/health')).status], [EXIT.portBusy, false, 200]);
  fs.rmSync(config.stateFile, { force: true });                                                            // nothing answers now: the port is held by something else
  const busy = runSupervised({ config, logger: quiet(), command: process.execPath, args: [exitWith(dir, EXIT.portBusy)], limits: LIMITS });
  assert.deepEqual([await busy.done, fs.existsSync(alarm)], [EXIT.portBusy, true]);
});

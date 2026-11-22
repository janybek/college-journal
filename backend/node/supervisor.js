import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localDate } from '../../core/dates.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
import { readConfig, ConfigError } from './config.js';
import { createLogger } from './log.js';
import { EXIT } from './server.js';

// Start, restart after a crash, stop and state of the working server. Node only: this file is not bundled for Apps Script.
// stateFile belongs to the server that wrote it, supervisorFile to the supervisor. A process is never ended by its number here:
// a stop is a request file that the server (or the supervisor in its pause) finds and carries out itself.
export const RESTART = { firstMs: 1000, maxMs: 60000, stableMs: 60000, pollMs: 200 };

const SERVER_FILE = path.join(import.meta.dirname, 'server.js');
const clock = () => new Date().getTime();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COPY_PATTERN = /^journal-\d{4}-\d\d-\d\d\.sqlite$/;
const STOP_WORDS = { [EXIT.ok]: 'stop requested', [EXIT.config]: 'settings are wrong', [EXIT.portBusy]: 'port is busy' };

export function nextDelay(previousMs, ranMs, limits = RESTART) {
  if (ranMs >= limits.stableMs || previousMs === 0) return limits.firstMs;
  return Math.min(previousMs * 2, limits.maxMs);
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

export function runSupervised({ config, logger, command = process.execPath, args = [SERVER_FILE], env, limits = RESTART, now = clock }) {
  const lim = { pollMs: RESTART.pollMs, ...limits };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let child = null;
  let stopped = false;
  let ownsFile = false;

  const removeOwnFile = () => {
    if (!ownsFile) return;
    ownsFile = false;
    if (readJson(config.supervisorFile)?.pid === process.pid) fs.rmSync(config.supervisorFile, { force: true });
  };
  process.once('exit', removeOwnFile);
  const end = (code) => {
    removeOwnFile();
    process.removeListener('exit', removeOwnFile);
    finish(code);
  };
  const stopAsked = () => {
    if (!fs.existsSync(config.stopFile)) return false;
    fs.rmSync(config.stopFile, { force: true });
    logger.info('stop requested');
    return true;
  };

  async function loop() {
    // another supervisor that is really alive keeps its file; one left from before the computer was switched off does not count
    const other = readJson(config.supervisorFile);
    if (other && other.pid !== process.pid && isAlive(other.pid) && other.startedAt >= now() - os.uptime() * 1000) {
      logger.error('server stopped: another supervisor is running');
      return EXIT.portBusy;
    }
    try {
      fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: process.pid, startedAt: now() }));
      ownsFile = true;
    } catch (error) {
      logger.error('cannot write the supervisor file');
    }
    let delay = 0;
    for (;;) {
      if (stopped || stopAsked()) return EXIT.ok;
      const startedAt = now();
      const result = await new Promise((resolve) => {
        child = spawn(command, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: 'ignore' });
        child.once('error', (error) => resolve({ code: EXIT.crash, error }));
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      child = null;
      const code = result.code;
      if (stopped) return EXIT.ok;
      if (code === EXIT.ok || code === EXIT.config || code === EXIT.portBusy) {
        (code === EXIT.ok ? logger.info : logger.error)(`server stopped: ${STOP_WORDS[code]}`);
        return code;
      }
      delay = nextDelay(delay, now() - startedAt, lim);
      logger.error(`server exited with ${code ?? result.signal}, restart in ${delay} ms`);
      for (let left = delay; left > 0; left -= lim.pollMs) {
        if (stopped || stopAsked()) return EXIT.ok;
        await sleep(Math.min(lim.pollMs, left));
      }
    }
  }

  loop().then(end, (error) => {
    logger.error('supervisor failed', error);
    end(EXIT.crash);
  });
  return {
    done,
    stop() {
      stopped = true;
      if (child) child.kill();
      return done;
    },
  };
}

async function answers(port) {
  if (!Number.isInteger(port)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return (await res.json())?.data === 'journal';
  } catch (error) {
    return false;
  }
}

export async function requestStop(config, { waitMs = 15000 } = {}) {
  let supervisor = readJson(config.supervisorFile);
  if (supervisor && !isAlive(supervisor.pid)) {
    fs.rmSync(config.supervisorFile, { force: true });
    supervisor = null;
  }
  const port = readJson(config.stateFile)?.port;
  if (!supervisor && !(await answers(port))) return { stopped: false, reason: 'not_running' };

  fs.writeFileSync(config.stopFile, '');
  const give = clock() + waitMs;
  for (;;) {
    const gone = supervisor ? !fs.existsSync(config.supervisorFile) : !fs.existsSync(config.stateFile);
    if (gone && !(await answers(port))) return { stopped: true };
    if (clock() > give) {
      fs.rmSync(config.stopFile, { force: true });                       // a request nobody carried out must not stop the next start
      return { stopped: false, reason: 'timeout' };
    }
    await sleep(50);
  }
}

export async function readStatus(config, { now = clock } = {}) {
  const state = readJson(config.stateFile);
  const supervisor = readJson(config.supervisorFile);
  let copies = [];
  try {
    copies = fs.readdirSync(config.backupDir).filter((name) => COPY_PATTERN.test(name)).sort();
  } catch (error) { /* no folder of copies yet */ }
  const today = localDate(now());
  let errorsToday = 0;
  let failedLoginsToday = 0;
  try {
    for (const line of fs.readFileSync(config.logFile, 'utf8').split('\n')) {
      if (!line.startsWith(today + ' ')) continue;
      if (/^\S+ \S+ ERROR /.test(line)) errorsToday += 1;
      else if (/^\S+ \S+ INFO api auth\.login bad_credentials( |$)/.test(line)) failedLoginsToday += 1;
    }
  } catch (error) { /* no log yet */ }
  return {
    running: await answers(state?.port),
    port: Number.isInteger(state?.port) ? state.port : null,
    startedAt: state?.startedAt ?? null,
    supervisor: supervisor && isAlive(supervisor.pid) ? { running: true, pid: supervisor.pid } : { running: false, pid: null },
    lastCopy: copies.length > 0 ? copies[copies.length - 1] : null,
    copies: copies.length,
    errorsToday,
    failedLoginsToday,
  };
}

export async function cli(argv, { env = process.env, root, out = console.log } = {}) {
  if (argv.length > 1 || (argv[0] !== undefined && argv[0] !== '--stop' && argv[0] !== '--status')) {
    out(`Неизвестный параметр: ${argv.join(' ')}`);
    return { code: EXIT.config };
  }
  let config;
  try {
    config = readConfig({ env, root });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    out(`Настройки не читаются (${error.code})`);
    return { code: EXIT.config };
  }
  if (argv[0] === '--stop') {
    const result = await requestStop(config);
    out(result.stopped ? 'Сервер остановлен'
      : result.reason === 'not_running' ? 'Сервер не запущен'
        : 'Сервер не остановился за 15 секунд: смотрите журнал работы server.log');
    return { code: result.stopped || result.reason === 'not_running' ? EXIT.ok : EXIT.crash };
  }
  if (argv[0] === '--status') {
    const s = await readStatus(config);
    out(s.running ? `Сервер работает на порту ${s.port}` : 'Сервер не отвечает');
    const state = readJson(config.stateFile);
    const foreign = !s.running && isAlive(state?.pid);
    out(`Процесс сервера: ${state?.pid ?? 'нет'}${foreign ? ' (процесс с этим номером жив, но порт не отвечает: это не наш процесс)' : ''}`);
    out(`Процесс присмотра: ${s.supervisor.pid ?? 'нет'}${s.supervisor.running ? '' : ' (не работает)'}`);
    out(`Последняя копия: ${s.lastCopy ?? 'нет'}; всего копий: ${s.copies}`);
    out(`Ошибок в журнале за сегодня: ${s.errorsToday}; неверных входов за сегодня: ${s.failedLoginsToday}`);
    return { code: EXIT.ok };
  }
  const logger = createLogger(config.logFile, { now: createNodePlatform().now });
  const sup = runSupervised({ config, logger });
  return { code: EXIT.ok, done: sup.done };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await cli(process.argv.slice(2));
    process.exit(result.done ? await result.done : result.code);
  } catch (error) {
    console.error(error);
    process.exit(EXIT.crash);
  }
}

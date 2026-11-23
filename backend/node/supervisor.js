import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { localDate } from '../../core/dates.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
import { readConfig, ConfigError, START_ALERT_FILE } from './config.js';
import { restoreBase, BaseError } from './base.js';
import { createLogger } from './log.js';
import { EXIT } from './exit.js';

// Start, restart after a crash, stop and state of the working server. Node only: this file is not bundled for Apps Script.
// stateFile belongs to the server that wrote it, supervisorFile to the supervisor. A process is never ended by its number here:
// a stop is a request file that the server (or the supervisor in its pause) finds and carries out itself.
export const RESTART = { firstMs: 1000, maxMs: 60000, stableMs: 60000, pollMs: 200, heartbeatMs: 10000 };
// the supervisor rewrites seenAt in its file every heartbeat; a file that is older is not a living supervisor, whatever process has its number now
export const SUPERVISOR_FRESH_MS = 30000;

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

export function isOurSupervisor(note, now = clock) {
  if (!note || !isAlive(note.pid)) return false;
  const seen = Number.isFinite(note.seenAt) ? note.seenAt : note.startedAt;
  return Number.isFinite(seen) && now() - seen < SUPERVISOR_FRESH_MS;
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

function raiseStartAlert(config, now, why) {
  if (!config.alertDir) return;
  try {
    const text = [
      `Дата: ${localDate(now())}`,
      `Причина: ${why}`,
      'Откройте проект „Журнал колледжа“ в Claude и скажите: журнал не запустился',
      '',
    ].join('\r\n');
    fs.writeFileSync(path.join(config.alertDir, START_ALERT_FILE), text);
  } catch (error) { /* no folder for the alert: the work log has the line, if its folder is there */ }
}

export function runSupervised({ config, logger, command = process.execPath, args = [SERVER_FILE], env, limits = RESTART, now = clock }) {
  const lim = { pollMs: RESTART.pollMs, ...limits };
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let child = null;
  let stopped = false;
  let ownsFile = false;
  let heartbeat = null;
  const startedAt0 = now();

  const removeOwnFile = () => {
    if (!ownsFile) return;
    ownsFile = false;
    if (readJson(config.supervisorFile)?.pid === process.pid) fs.rmSync(config.supervisorFile, { force: true });
  };
  const writeNote = () => {
    fs.writeFileSync(config.supervisorFile, JSON.stringify({ pid: process.pid, startedAt: startedAt0, seenAt: now() }));
  };
  process.once('exit', removeOwnFile);
  const end = (code) => {
    clearInterval(heartbeat);
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
    // another supervisor that is really alive (its number is alive and its file was rewritten a moment ago) keeps its file;
    // a file left from an earlier run does not count, even when a foreign program has got the number since
    const other = readJson(config.supervisorFile);
    if (other && other.pid !== process.pid && isOurSupervisor(other, now)) {
      logger.error('server stopped: another supervisor is running');
      return EXIT.portBusy;
    }
    fs.rmSync(config.stopFile, { force: true });                     // a request cannot be older than this start: it was left by a stop that nobody carried out
    try {
      writeNote();
      ownsFile = true;
      heartbeat = setInterval(() => {
        const note = readJson(config.supervisorFile);
        if (note && note.pid !== process.pid) return;               // the file belongs to another supervisor now
        try { writeNote(); } catch (error) { /* the next beat tries again */ }
      }, lim.heartbeatMs);
      heartbeat.unref();
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
        // the log may lie in the very folder that is gone: the owner learns it from a file on the desktop
        if (code === EXIT.config) raiseStartAlert(config, now, 'настройки неверны или нет базы или secret.key (папка данных могла пропасть или переименоваться)');
        else if (code === EXIT.portBusy && !(await answers(readJson(config.stateFile)?.port))) raiseStartAlert(config, now, 'порт занят другой программой');
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

export async function answers(port) {
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
  if (supervisor && !isOurSupervisor(supervisor)) {
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
    supervisor: isOurSupervisor(supervisor, now) ? { running: true, pid: supervisor.pid } : { running: false, pid: null },
    lastCopy: copies.length > 0 ? copies[copies.length - 1] : null,
    copies: copies.length,
    errorsToday,
    failedLoginsToday,
  };
}

const RESTORE_WORDS = {
  no_copy: 'Файла копии нет по этому пути',
  bad_copy: 'Копия не прошла проверку, база не тронута',
  cannot_restore_files: 'База возвращена, но файлы из копии вернуть не удалось: повторите команду',
  cannot_replace: 'Не удалось заменить базу (файл занят другой программой?), всё осталось как было',
};

// Puts a copy in the place of the working base. Only while nothing runs: a supervisor would start the server again in the middle of it.
async function restore(config, file, out) {
  if (isOurSupervisor(readJson(config.supervisorFile)) || (await answers(readJson(config.stateFile)?.port))) {
    out('Сервер работает: сначала остановите его (npm run serve:stop), потом повторите');
    return { code: EXIT.config };
  }
  try {
    const made = restoreBase(config, path.resolve(file));
    createLogger(config.logFile, { now: createNodePlatform().now }).info(`base restored from ${path.basename(file)}`);
    out(`База возвращена из копии: ${path.basename(file)}`);
    out(made.before ? `Прежняя база сохранена в папке: ${made.before}` : 'Прежней базы не было');
    out(made.secret === 'kept' ? 'Файл secret.key прежний'
      : made.secret === 'copies' ? 'Файл secret.key взят из папки копий'
        : 'Файла secret.key не было нигде: создан новый, все войдут в журнал заново');
    out(`Файлов возвращено из копии: ${made.files}`);
    out('Запустите сервер: npm run serve:start');
    return { code: EXIT.ok };
  } catch (error) {
    if (!(error instanceof BaseError)) throw error;
    out(`${RESTORE_WORDS[error.code] || 'Ошибка'}${error.code === 'bad_copy' ? ` (${error.message})` : ''}`);
    return { code: EXIT.config };
  }
}

export async function cli(argv, { env = process.env, root, out = console.log } = {}) {
  const known = argv[0] === undefined || ((argv[0] === '--stop' || argv[0] === '--status') && argv.length === 1) || (argv[0] === '--restore' && argv.length === 2);
  if (!known) {
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
    const note = readJson(config.supervisorFile);
    const other = !s.supervisor.running && note && isAlive(note.pid);
    out(`Процесс присмотра: ${s.supervisor.pid ?? note?.pid ?? 'нет'}${s.supervisor.running ? '' : other ? ' (не работает: файл остался от прежнего запуска, а процесс с этим номером чужой)' : ' (не работает)'}`);
    out(`Последняя копия: ${s.lastCopy ?? 'нет'}; всего копий: ${s.copies}`);
    out(`Ошибок в журнале за сегодня: ${s.errorsToday}; неверных входов за сегодня: ${s.failedLoginsToday}`);
    return { code: EXIT.ok };
  }
  if (argv[0] === '--restore') return restore(config, argv[1], out);
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

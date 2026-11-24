import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../api.js';
import { actionKind } from '../../core/permissions.js';
import { createLoginGuard } from '../../core/loginGuard.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
import { readConfig, ConfigError, START_ALERT_FILE } from './config.js';
import { initBase, openBase, resetAdminPassword, BaseError } from './base.js';
import { MAX_BODY_BYTES, TOO_LARGE, readBody, sendJson } from './http.js';
import { createLogger } from './log.js';
import { backupNow, startBackups } from './backup.js';
import { createDiskFiles, sweepFiles, spaceAlarm } from './files.js';
import { createSiteHandler } from './static.js';
import { runDemo } from './demo.js';
import { EXIT } from './exit.js';

// The working server: answers only its own site, serves no files, limits login attempts, keeps a work log.
// Node only: this file is not bundled for Apps Script.
export { EXIT };

const MIN_NODE = 24;
const oneLine = (error) => String(error?.message || error).replace(/[\r\n]+/g, ' ');
const SERVER_ERROR = { ok: false, error: { code: 'internal' } };

function actionOf(body) {
  try {
    const action = JSON.parse(body)?.action;
    return typeof action === 'string' && actionKind(action) !== null ? action : '?';
  } catch (error) {
    return '?';
  }
}

export async function startServer({ config, base, logger, guard = createLoginGuard(), maxBodyBytes = MAX_BODY_BYTES, files }) {
  const { platform, store } = base;
  const ctx = { store, platform, files, loginGuard: guard, log: (e) => logger.error('handler', e) };
  const notFound = (res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
  };
  const site = config.siteDir ? createSiteHandler(config.siteDir, { notFound }) : null;

  async function handleApi(req, res) {
    if (req.method !== 'POST' && req.method !== 'OPTIONS') {
      return sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed' }, serverTime: platform.now() }, { Allow: 'POST' });
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !config.origins.includes(origin)) {
      req.resume();
      return sendJson(res, 403, { ok: false, error: { code: 'forbidden_origin' }, serverTime: platform.now() }, { Connection: 'close' });
    }
    if (req.method === 'OPTIONS') {
      // the preflight of an upload with a progress bar: only our own site is let through
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
        'Cache-Control': 'no-store',
      });
      return res.end();
    }
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const started = platform.now();
    const body = await readBody(req, maxBodyBytes);
    if (body === TOO_LARGE) {
      return sendJson(res, 413, { ok: false, error: { code: 'payload_too_large' }, serverTime: platform.now() }, { ...cors, Connection: 'close' });
    }
    const result = handleRequest(body, ctx);
    logger.info(`api ${actionOf(body)} ${result.ok ? 'ok' : result.error.code} ${platform.now() - started}ms`);
    return sendJson(res, 200, result, cors);
  }

  const server = http.createServer(async (req, res) => {
    try {
      // The path is cut by hand, never parsed as an address: the addresses '//' and '/\' make URL parsing throw.
      const pathname = String(req.url).split('?')[0];
      if (pathname === '/api') return await handleApi(req, res);
      if (pathname === '/health') return req.method === 'GET' ? sendJson(res, 200, { ok: true, data: 'journal' }) : notFound(res);
      return site ? site(req, res, String(req.url)) : notFound(res);
    } catch (error) {
      if (!req.destroyed) logger.error('request', error);
      try {
        if (!res.headersSent) sendJson(res, 500, SERVER_ERROR);
        else res.end();
      } catch (sendError) { /* the client is gone */ }
    }
  });
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  server.on('connection', (socket) => socket.on('error', () => {}));

  const host = config.host ?? '127.0.0.1';
  // the address to knock at: a server on all addresses is reached through the loopback
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' || host === '::1' ? '[::1]' : host;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, host, resolve);
  });
  const port = server.address().port;
  return {
    url: `http://${urlHost}:${port}`,
    port,
    address: server.address().address,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

const CONFIG_WORDS = {
  bad_config: 'Файл настроек serve.local.json не читается или написан неверно',
  no_data_dir: 'В настройках не указана папка данных (dataDir)',
  no_backup_dir: 'В настройках не указана папка копий (backupDir)',
  inside_repo: 'Папка данных или копий лежит внутри папки журнала: настоящие данные нельзя хранить рядом с кодом',
  bad_port: 'В настройках неверный порт',
  bad_origin: 'В настройках неверный адрес сайта (origins)',
  bad_host: 'В настройках неверный адрес, на котором слушает сервер (host): нужен адрес вида 127.0.0.1, :: или ::1',
  bad_site_dir: 'Папка сайта (siteDir) не найдена или это не папка',
};
const BASE_WORDS = {
  exists: 'База уже создана, второй раз первый запуск не делается',
  no_base: 'Базы нет: сначала выполните первый запуск (serve:init). Папка с базой могла пропасть или переименоваться',
  no_secret: 'Нет файла secret.key рядом с базой или он слишком короткий',
};

function said(error) {
  const words = error instanceof ConfigError ? CONFIG_WORDS : BASE_WORDS;
  return `${words[error.code] || 'Ошибка'} (${error.code})`;
}

function showPassword(out, { adminLogin, adminTempPassword }) {
  out(`Администратор: ${adminLogin}`);
  out(`Временный пароль: ${adminTempPassword}`);
  out('Запишите пароль: он показан один раз и нигде не сохранён. При первом входе журнал попросит его сменить.');
}

export async function main(argv, { env = process.env, root, out: given, echo, now, nodeVersion = process.versions.node, stopCheckMs = 2000 } = {}) {
  const out = given ?? console.log;
  if (Number.parseInt(nodeVersion, 10) < MIN_NODE) {
    out(`Нужен Node 24 или новее (сейчас ${nodeVersion})`);
    return { code: EXIT.config };
  }
  const command = argv[0];
  const wipe = command === '--demo' && argv.length === 2 && argv[1] === '--wipe';
  if ((argv.length > 1 && !wipe) || (command !== undefined && command !== '--init' && command !== '--admin-password' && command !== '--backup' && command !== '--demo')) {
    out(`Неизвестный параметр: ${argv.join(' ')}`);
    return { code: EXIT.config };
  }
  try {
    const config = readConfig({ env, root });
    const clock = createNodePlatform({ now }).now;
    // in the container the work log goes to the console too; a test (it gives its own `out`) stays quiet unless it asks
    const toConsole = !env.JOURNAL_DATA_DIR ? null : echo !== undefined ? echo : given === undefined ? (line) => process.stdout.write(line + '\n') : null;
    const logger = createLogger(config.logFile, { now: clock, echo: toConsole });
    if (command === '--init') {
      const made = initBase(config);
      logger.info('base created');
      out(`База создана: ${config.dbFile}`);
      showPassword(out, made);
      return { code: EXIT.ok };
    }
    if (command === '--admin-password') {
      const made = resetAdminPassword(config);
      logger.info('admin password reset');
      showPassword(out, made);
      return { code: EXIT.ok };
    }

    if (command === '--demo') return await runDemo(config, { out, now, logger, wipe });

    if (command === '--backup') {
      const base = openBase(config, { now });
      try {
        const made = await backupNow({ db: base.db, config, now: clock, logger });
        out(made.ok ? `Копия сделана: ${made.file}` : `Копия не сделана: ${made.error}`);
        return { code: made.ok ? EXIT.ok : EXIT.crash };
      } finally {
        base.close();
      }
    }

    // the container makes its base by itself at the first start; the temporary password is thrown away, it is got with --admin-password
    if (config.autoInit && !fs.existsSync(config.dbFile)) {
      initBase(config);
      logger.info('base created automatically; set the admin password with --admin-password');
      out('База создана автоматически. Пароль администратора задайте командой: node backend/node/server.js --admin-password');
    }
    const base = openBase(config, { now });
    const files = createDiskFiles(config.filesDir);
    // the sweep of the files and the look at the free space: a failure is a line in the log, never a stop
    const upkeep = () => {
      try {
        const swept = sweepFiles({ store: base.store, dir: config.filesDir, nowMs: clock() });
        if (swept.rows > 0 || swept.files > 0) logger.info(`files swept: ${swept.rows} rows, ${swept.files} files`);
      } catch (error) {
        logger.error(`files sweep failed: ${oneLine(error)}`);
      }
      try {
        spaceAlarm({ config, logger });
      } catch (error) {
        logger.error(`space check failed: ${oneLine(error)}`);
      }
    };
    let server;
    let backups;
    try {
      // the copy of the base as it was, before new sheets are added to it; a failed copy does not stop the start
      backups = startBackups({ db: base.db, config, now: clock, logger, afterRun: upkeep });
      await backups.first;
      const upgraded = base.upgrade();
      if (upgraded.created.length > 0 || upgraded.added.length > 0) {
        logger.info(`base upgraded: ${upgraded.created.length} tables made, ${upgraded.added.length} columns added`);
      }
      upkeep();
      server = await startServer({ config, base, logger, files });
    } catch (error) {
      backups?.stop();
      base.close();
      throw error;
    }
    // the port is ours now: a request left from the last time is stale, a request meant for another server is not touched before this point
    fs.rmSync(config.stopFile, { force: true });
    try {
      if (config.alertDir) fs.rmSync(path.join(config.alertDir, START_ALERT_FILE), { force: true });      // the journal runs: the alarm "did not start" is over
    } catch (error) { /* the folder of the alert is not there */ }
    fs.writeFileSync(config.stateFile, JSON.stringify({ pid: process.pid, port: server.port, startedAt: clock() }));
    logger.info(`server started on port ${server.port}`);
    out(`Сервер журнала: ${server.url}  база: ${config.dbFile}`);
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    let stopped = null;
    let watcher = null;
    const stop = () => {
      stopped ??= (async () => {
        clearInterval(watcher);
        backups.stop();
        await server.close();
        base.close();
        fs.rmSync(config.stateFile, { force: true });
        logger.info('server stopped');
        finish(EXIT.ok);
      })();
      return stopped;
    };
    watcher = setInterval(() => {
      if (!fs.existsSync(config.stopFile)) return;
      logger.info('stop requested');
      fs.rmSync(config.stopFile, { force: true });
      stop();
    }, stopCheckMs);
    watcher.unref();
    return { code: EXIT.ok, server, base, stop, done };
  } catch (error) {
    if (error instanceof ConfigError || error instanceof BaseError) {
      out(said(error));
      return { code: EXIT.config };
    }
    if (error?.code === 'EADDRINUSE') {
      out('Порт уже занят: на нём работает другой сервер или программа');
      return { code: EXIT.portBusy };
    }
    throw error;
  }
}

// SIGTERM (docker stop, a cluster) and SIGINT stop the server the same way the stop file does.
export function installSignalHandlers(result, proc = process) {
  if (typeof result?.stop !== 'function') return;
  for (const signal of ['SIGTERM', 'SIGINT']) proc.once(signal, () => { result.stop(); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    installSignalHandlers(result);
    process.exit(result.done ? await result.done : result.code);
  } catch (error) {
    try {
      createLogger(readConfig().logFile, { now: createNodePlatform().now }).error('crash', error);
    } catch (logError) { /* no settings, no log */ }
    console.error(error);
    process.exit(EXIT.crash);
  }
}

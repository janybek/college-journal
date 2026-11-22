import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from '../api.js';
import { actionKind } from '../../core/permissions.js';
import { createLoginGuard } from '../../core/loginGuard.js';
import { createNodePlatform } from '../platform/nodePlatform.js';
import { readConfig, ConfigError } from './config.js';
import { initBase, openBase, resetAdminPassword, BaseError } from './base.js';
import { MAX_BODY_BYTES, TOO_LARGE, readBody, sendJson } from './http.js';
import { createLogger } from './log.js';
import { backupNow, startBackups } from './backup.js';

// The working server: answers only its own site, serves no files, limits login attempts, keeps a work log.
// Node only: this file is not bundled for Apps Script.
export const EXIT = { ok: 0, crash: 1, config: 2, portBusy: 3 };

const MIN_NODE = 24;
const SERVER_ERROR = { ok: false, error: { code: 'internal' } };

function actionOf(body) {
  try {
    const action = JSON.parse(body)?.action;
    return typeof action === 'string' && actionKind(action) !== null ? action : '?';
  } catch (error) {
    return '?';
  }
}

export async function startServer({ config, base, logger, guard = createLoginGuard(), maxBodyBytes = MAX_BODY_BYTES }) {
  const { platform, store } = base;
  const ctx = { store, platform, loginGuard: guard, log: (e) => logger.error('handler', e) };
  const notFound = (res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Not found');
  };

  async function handleApi(req, res) {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed' }, serverTime: platform.now() }, { Allow: 'POST' });
    }
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !config.origins.includes(origin)) {
      req.resume();
      return sendJson(res, 403, { ok: false, error: { code: 'forbidden_origin' }, serverTime: platform.now() }, { Connection: 'close' });
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
      if (pathname === '/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, data: 'journal' });
      return notFound(res);
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

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
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

export async function main(argv, { env = process.env, root, out = console.log, now, nodeVersion = process.versions.node } = {}) {
  if (Number.parseInt(nodeVersion, 10) < MIN_NODE) {
    out(`Нужен Node 24 или новее (сейчас ${nodeVersion})`);
    return { code: EXIT.config };
  }
  const command = argv[0];
  if (argv.length > 1 || (command !== undefined && command !== '--init' && command !== '--admin-password' && command !== '--backup')) {
    out(`Неизвестный параметр: ${argv.join(' ')}`);
    return { code: EXIT.config };
  }
  try {
    const config = readConfig({ env, root });
    const clock = createNodePlatform({ now }).now;
    const logger = createLogger(config.logFile, { now: clock });
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

    const base = openBase(config, { now });
    let server;
    let backups;
    try {
      // the copy of the base as it was, before new sheets are added to it; a failed copy does not stop the start
      backups = startBackups({ db: base.db, config, now: clock, logger });
      await backups.first;
      const upgraded = base.upgrade();
      if (upgraded.created.length > 0 || upgraded.added.length > 0) {
        logger.info(`base upgraded: ${upgraded.created.length} tables made, ${upgraded.added.length} columns added`);
      }
      server = await startServer({ config, base, logger });
    } catch (error) {
      backups?.stop();
      base.close();
      throw error;
    }
    fs.writeFileSync(config.stateFile, JSON.stringify({ pid: process.pid, port: server.port, startedAt: clock() }));
    logger.info(`server started on port ${server.port}`);
    out(`Сервер журнала: ${server.url}  база: ${config.dbFile}`);
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    let stopped = null;
    const stop = () => {
      stopped ??= (async () => {
        backups.stop();
        await server.close();
        base.close();
        fs.rmSync(config.stateFile, { force: true });
        logger.info('server stopped');
        finish(EXIT.ok);
      })();
      return stopped;
    };
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main(process.argv.slice(2));
    process.exit(result.done ? await result.done : result.code);
  } catch (error) {
    try {
      createLogger(readConfig().logFile, { now: createNodePlatform().now }).error('crash', error);
    } catch (logError) { /* no settings, no log */ }
    console.error(error);
    process.exit(EXIT.crash);
  }
}

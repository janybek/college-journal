import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from '../core/schema.js';
import { createFileStore } from '../backend/store/fileStore.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { handleRequest } from '../backend/api.js';
import { createLoginGuard } from '../core/loginGuard.js';
import { MAX_BODY_BYTES, TOO_LARGE, readBody, sendJson } from '../backend/node/http.js';
import { seed, seedAdmin, prepareLessonNow } from './seed.js';
import { upgradeFile } from './upgrade.js';

// Local stand: serves the static site and answers the production API from a JSON file. Node only.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export { MAX_BODY_BYTES };
export const DATA_FILES = { demo: 'dev/data/db.json', real: 'dev/data/real.json' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

function serveFile(req, res, siteDir, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (error) { return sendNotFound(res); }
  if (decoded.includes('\0')) return sendNotFound(res);
  let file = path.resolve(siteDir, '.' + decoded);
  if (file !== siteDir && !file.startsWith(siteDir + path.sep)) return sendNotFound(res);
  try {
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.statSync(file).isFile()) return sendNotFound(res);
  } catch (error) {
    return sendNotFound(res);
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Arguments of a direct run -> { mode, dataFile } (files relative to `root`; with --lesson-now also lessonNow: true) or
// { error: 'reset_refused' } or { error: 'lesson_refused' }.
// --reset deletes only the fictional data file; the real one is never deleted by any arguments.
// --lesson-now puts a pair at the current time: the real data is not edited, so it is refused with --real.
export function standArgs(argv, root = ROOT) {
  const real = argv.includes('--real');
  const reset = argv.includes('--reset');
  const lessonNow = argv.includes('--lesson-now');
  if (real && reset) return { error: 'reset_refused' };
  if (real && lessonNow) return { error: 'lesson_refused' };
  if (reset) fs.rmSync(path.resolve(root, DATA_FILES.demo), { force: true });
  if (real) return { mode: 'real', dataFile: DATA_FILES.real };
  return lessonNow ? { mode: 'demo', dataFile: DATA_FILES.demo, lessonNow: true } : { mode: 'demo', dataFile: DATA_FILES.demo };
}

// What fills a missing data file. The real data file never gets the fictional people, whatever the mode.
export function seederFor(dataPath, mode) {
  return mode === 'real' || path.resolve(dataPath) === path.resolve(ROOT, DATA_FILES.real) ? seedAdmin : seed;
}

// mode 'demo': a missing data file is filled with the fictional stand. mode 'real': a missing file gets an empty base and one admin;
// the fictional seed is never called, so no invented people, subjects or pairs get in.
// lessonNow: after the seed of a fresh fictional file a pair of «Информатика» of 01-1 is put at the current time (the real data is never edited).
export async function startDevServer({ port = 5273, dataFile = DATA_FILES.demo, siteDir = 'site', maxBodyBytes = MAX_BODY_BYTES, mode = 'demo', lessonNow = false } = {}) {
  const dataPath = path.resolve(ROOT, dataFile);
  const sitePath = path.resolve(ROOT, siteDir);
  const platform = createNodePlatform();
  const fresh = !fs.existsSync(dataPath);
  const upgraded = upgradeFile(dataPath);
  if (upgraded.changed) {
    console.log(`stand file carried over: versions ${upgraded.versions}, split rows ${upgraded.split}, units ${upgraded.units}, untouched rows ${upgraded.skipped.length}, zero-hour rows ${upgraded.zeroHours.length}; copy: ${path.basename(dataPath)}.before-addendum-3.bak`);
  }
  const store = createFileStore(SCHEMA, platform, dataPath);
  if (fresh) seederFor(dataPath, mode)(store, platform);
  if (lessonNow && fresh && mode !== 'real' && seederFor(dataPath, mode) === seed) prepareLessonNow(store, platform);
  const ctx = { store, platform, loginGuard: createLoginGuard(), log: (error) => console.error(error) };

  const server = http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api') {
        if (req.method !== 'POST') {
          return sendJson(res, 405, { ok: false, error: { code: 'method_not_allowed' }, serverTime: platform.now() }, { Allow: 'POST' });
        }
        const body = await readBody(req, maxBodyBytes);
        if (body === TOO_LARGE) {
          return sendJson(res, 413, { ok: false, error: { code: 'payload_too_large' }, serverTime: platform.now() }, { Connection: 'close' });
        }
        return sendJson(res, 200, handleRequest(body, ctx));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendNotFound(res);
      return serveFile(req, res, sitePath, pathname);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: { code: 'internal' } });
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://localhost:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = standArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error === 'lesson_refused'
      ? '--lesson-now не работает с --real: пара «сейчас» правит данные, а настоящие данные стенд не правит. Запустите без --real (npm run dev:lesson).'
      : '--reset не работает с --real: настоящие данные стенда не стираются. Если файл правда нужно удалить, удалите dev/data/real.json руками.');
    process.exit(1);
  }
  const server = await startDevServer({ port: 5273, dataFile: args.dataFile, mode: args.mode, lessonNow: args.lessonNow });
  console.log(`${server.url}  data: ${path.resolve(ROOT, args.dataFile)}`);
}

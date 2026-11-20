import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from '../core/schema.js';
import { createFileStore } from '../backend/store/fileStore.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { handleRequest } from '../backend/api.js';
import { seed } from './seed.js';

// Local stand: serves the static site and answers the production API from a JSON file. Node only.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
const TOO_LARGE = Symbol('too large');
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
const JSON_TYPE = 'application/json; charset=utf-8';

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

// Resolves with the UTF-8 body, or TOO_LARGE once the limit is passed (the rest of the upload is discarded).
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(tooLarge ? TOO_LARGE : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

export async function startDevServer({ port = 5273, dataFile = 'dev/data/db.json', siteDir = 'site', maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const dataPath = path.resolve(ROOT, dataFile);
  const sitePath = path.resolve(ROOT, siteDir);
  const platform = createNodePlatform();
  const fresh = !fs.existsSync(dataPath);
  const store = createFileStore(SCHEMA, platform, dataPath);
  if (fresh) seed(store, platform);
  const ctx = { store, platform, log: (error) => console.error(error) };

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
  const dataFile = 'dev/data/db.json';
  if (process.argv.includes('--reset')) fs.rmSync(path.resolve(ROOT, dataFile), { force: true });
  const server = await startDevServer({ port: 5273, dataFile });
  console.log(`${server.url}  data: ${path.resolve(ROOT, dataFile)}`);
}

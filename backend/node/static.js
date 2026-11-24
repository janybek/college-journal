import fs from 'node:fs';
import path from 'node:path';

// The site files for the container: GET and HEAD only, nothing outside the site folder, no dotfiles, no listing.
// Node only: this file is not bundled for Apps Script.

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  pdf: 'application/pdf',
};
const SITE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-cache',
};

export const typeOf = (file) => TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

// The path of the request to the segments inside the site folder, or null for everything that is refused.
export function siteSegments(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath.split('#')[0].split('?')[0]);      // once
  } catch (error) {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return null;
  const parts = decoded.split('/').slice(1);
  const directory = parts[parts.length - 1] === '';
  const segments = parts.filter((s) => s !== '');
  if (segments.some((s) => s === '.' || s === '..' || s.startsWith('.'))) return null;
  if (directory || segments.length === 0) segments.push('index.html');
  return segments;
}

// The site folder must exist when this is made; the answer is a function (req, res) that has answered or not.
export function createSiteHandler(siteDir, { notFound }) {
  const root = fs.realpathSync(siteDir);

  function locate(requestPath) {
    const segments = siteSegments(requestPath);
    if (segments === null) return null;
    let real;
    try {
      real = fs.realpathSync(path.join(root, ...segments));
    } catch (error) {
      return null;
    }
    const relative = path.relative(root, real);
    if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    let stat;
    try {
      stat = fs.statSync(real);
    } catch (error) {
      return null;
    }
    return stat.isFile() ? { file: real, size: stat.size } : null;
  }

  return function serve(req, res, requestPath) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.resume();
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      return res.end('Method not allowed');
    }
    const found = locate(requestPath);
    if (found === null) return notFound(res);
    res.writeHead(200, { 'Content-Type': typeOf(found.file), 'Content-Length': found.size, ...SITE_HEADERS });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(found.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return undefined;
  };
}

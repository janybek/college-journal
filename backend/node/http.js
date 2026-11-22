// Helpers shared by the stand and the working server. Node only: this file is not bundled for Apps Script.
export const MAX_BODY_BYTES = 20 * 1024 * 1024;
export const TOO_LARGE = Symbol('too large');
const JSON_TYPE = 'application/json; charset=utf-8';

// Resolves with the UTF-8 body, or TOO_LARGE once the limit is passed (the rest of the upload is discarded).
export function readBody(req, maxBytes) {
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

export function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(body));
}

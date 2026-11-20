import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Copies the browser libraries the site loads from site/vendor/ (the site has no build step and no CDN links).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [['node_modules/xlsx/dist/xlsx.full.min.js', 'site/vendor/xlsx.full.min.js']];

for (const [from, to] of FILES) {
  const target = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), target);
  console.log(`${from} -> ${to}`);
}

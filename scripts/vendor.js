import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Copies the browser libraries and fonts the site loads from site/vendor/ (the site has no build step and no CDN links).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTER = 'node_modules/@fontsource-variable/inter';
// Inter Variable, upright, weight axis: Latin, Cyrillic, and Cyrillic Extended (Kyrgyz ң, ө, ү live there).
const INTER_SUBSETS = ['latin', 'cyrillic', 'cyrillic-ext'];
const FILES = [
  ['node_modules/xlsx/dist/xlsx.full.min.js', 'site/vendor/xlsx.full.min.js'],
  ...INTER_SUBSETS.map((subset) => [`${INTER}/files/inter-${subset}-wght-normal.woff2`, `site/vendor/fonts/inter-${subset}-wght-normal.woff2`]),
  [`${INTER}/LICENSE`, 'site/vendor/fonts/OFL.txt'],
];

for (const [from, to] of FILES) {
  const target = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), target);
  console.log(`${from} -> ${to}`);
}

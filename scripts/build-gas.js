import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'build', 'gas');

const WRAPPERS = [
  'function doPost(e) { return App.doPost(e); }',
  'function doGet(e) { return App.doGet(e); }',
  'function setup() { return App.setup(); }',
].join('\n');

// Bundles backend/gas/main.js into one Apps Script file (build/gas/Code.js) plus the manifest.
export function buildGas() {
  const result = buildSync({
    entryPoints: [path.join(ROOT, 'backend', 'gas', 'main.js')],
    bundle: true,
    format: 'iife',
    globalName: 'App',
    target: 'es2019',
    platform: 'neutral',
    write: false,
    outfile: path.join(OUT_DIR, 'Code.js'),
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const codeFile = path.join(OUT_DIR, 'Code.js');
  fs.writeFileSync(codeFile, `${result.outputFiles[0].text}\n${WRAPPERS}\n`);
  fs.copyFileSync(path.join(ROOT, 'backend', 'gas', 'appsscript.json'), path.join(OUT_DIR, 'appsscript.json'));
  return codeFile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`built ${buildGas()}`);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');

// All files the server start reaches by static imports (dynamic import() of dev/seed.js in demo.js is on purpose).
const IMPORT_LINE = /^\s*(?:\}|import|export)[^\n]*\bfrom\s+['"]([^'"]+)['"]/gm;
function importClosure(entry) {
  const seen = new Map();
  const queue = [path.resolve(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const specifiers = [...fs.readFileSync(file, 'utf8').matchAll(IMPORT_LINE)].map((m) => m[1]);
    seen.set(file, specifiers);
    for (const s of specifiers) if (s.startsWith('.')) queue.push(path.resolve(path.dirname(file), s));
  }
  return seen;
}

test('the server needs only backend/, core/ and package.json, and no npm package', () => {
  const closure = importClosure('backend/node/server.js');
  assert.equal(closure.size > 20, true);
  for (const [file, specifiers] of closure) {
    assert.equal(['backend', 'core'].includes(path.relative(ROOT, file).split(path.sep)[0]), true, file);
    for (const s of specifiers) assert.equal(s.startsWith('.') || s.startsWith('node:'), true, file + ' imports ' + s);
  }
  assert.equal(JSON.parse(read('package.json')).dependencies, undefined);
});

test('Dockerfile: the base image, only the named folders, no secrets, the user node, the variables, the check and the command', () => {
  const d = read('Dockerfile');
  assert.match(d, /^FROM node:24-slim$/m);
  assert.match(d, /^WORKDIR \/app$/m);
  assert.deepEqual([...d.matchAll(/^COPY (.+)$/gm)].map((m) => m[1]), ['package.json ./', 'backend ./backend', 'core ./core', 'site ./site']);
  assert.equal(/npm (ci|install)/.test(d), false);
  for (const v of ['NODE_ENV=production', 'JOURNAL_DATA_DIR=/data', 'JOURNAL_BACKUP_DIR=/backup', 'JOURNAL_HOST=0.0.0.0', 'JOURNAL_PORT=5373', 'JOURNAL_SITE_DIR=/app/site', 'JOURNAL_AUTO_INIT=1']) assert.equal(d.includes(v), true, v);
  assert.equal(d.includes('JOURNAL_ORIGINS'), true);                                                  // only in the comment: no value is set
  assert.equal(/JOURNAL_ORIGINS=/.test(d), false);
  assert.match(d, /RUN mkdir -p \/data \/backup && chown node:node \/data \/backup/);
  assert.equal(d.indexOf('USER node') > d.indexOf('RUN mkdir'), true);
  assert.match(d, /^EXPOSE 5373$/m);
  assert.match(d, /^VOLUME \["\/data", "\/backup"\]$/m);
  assert.match(d, /^HEALTHCHECK .*\\\n\s+CMD \["node", "-e", "fetch\(.*\/health/m);
  assert.match(d, /org\.opencontainers\.image\.source="https:\/\/github\.com\/janybek\/college-journal"/);
  assert.match(d, /^CMD \["node", "backend\/node\/server\.js"\]$/m);
  assert.equal(/password|secret\.key|serve\.local/i.test(d.replace(/^#.*$/gm, '')), false);
});

test('.dockerignore keeps the repository, secrets, bases, tests and documents out of the build', () => {
  const lines = read('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const need of ['.git', '.github', 'node_modules', 'dev', 'tests', 'aidlc-docs', '.superpowers', '.claude', 'build', 'scripts', 'serve.local.json', '*.sqlite*', 'secret.key', '*.log', '**/.env*', 'DOCKER.md', 'CLAUDE.md']) {
    assert.equal(lines.includes(need), true, need);
  }
});

test('image.yml: ghcr, the right actions and tags, the test job is not a gate; pages.yml is untouched in kind', () => {
  const y = read('.github/workflows/image.yml');
  assert.match(y, /^name: Publish image to ghcr\.io$/m);
  assert.match(y, /branches: \[main\]/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /contents: read\n\s+packages: write/);
  for (const a of ['actions/checkout@v4', 'docker/setup-buildx-action@v3', 'docker/login-action@v3', 'docker/metadata-action@v5', 'docker/build-push-action@v6', 'actions/setup-node@v4']) assert.equal(y.includes(a), true, a);
  assert.match(y, /registry: ghcr\.io/);
  assert.match(y, /username: \$\{\{ github\.actor \}\}/);
  assert.match(y, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(y, /images: ghcr\.io\/\$\{\{ github\.repository \}\}/);
  assert.match(y, /type=raw,value=latest/);
  assert.match(y, /type=sha,prefix=,format=short/);
  assert.match(y, /push: true/);
  assert.match(y, /platforms: linux\/amd64/);
  assert.match(y, /node-version: 24/);
  assert.equal(/needs:/.test(y), false);
});

test('DOCKER.md names the image, the port, the volumes, every variable and the first-start commands; no real address', () => {
  const d = read('DOCKER.md');
  for (const word of ['ghcr.io/janybek/college-journal:latest', '5373', '/data', '/backup', 'JOURNAL_DATA_DIR', 'JOURNAL_BACKUP_DIR', 'JOURNAL_HOST', 'JOURNAL_PORT', 'JOURNAL_ORIGINS', 'JOURNAL_SITE_DIR',
    'JOURNAL_AUTO_INIT', 'JOURNAL_ALERT_DIR', 'docker exec -it', 'kubectl exec -it', 'node backend/node/server.js --admin-password', 'uid 1000', '20 МБ', '/health', 'https://journal.example.edu', 'secret.key', 'files/']) {
    assert.equal(d.includes(word), true, word);
  }
  assert.equal(/ts\.net/.test(d), false);
});

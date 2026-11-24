import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from '../backend/node/config.js';
import { ORIGIN, PERSON, login, start, tempDir, tempRoot } from './serverSetup.js';

// The site folder with a secret next to it (outside) and a secret dotfile inside.
function siteFolder(t) {
  const base = tempDir(t);
  const site = path.join(base, 'site');
  fs.mkdirSync(path.join(site, 'js'), { recursive: true });
  fs.mkdirSync(path.join(site, '.git'));
  fs.mkdirSync(path.join(site, 'css'));
  fs.writeFileSync(path.join(base, 'package.json'), 'OUTSIDE-SECRET');
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>j</title>');
  fs.writeFileSync(path.join(site, 'js', 'main.js'), 'export const a = 1;');
  fs.writeFileSync(path.join(site, 'css', 'app.css'), 'body{}');
  fs.writeFileSync(path.join(site, 'data.bin'), 'xx');
  fs.writeFileSync(path.join(site, 'logo.svg'), '<svg/>');
  fs.writeFileSync(path.join(site, '.git', 'config'), 'DOT-SECRET');
  fs.writeFileSync(path.join(site, '.env'), 'DOT-SECRET');
  return { base, site };
}

const noLeak = (res) => assert.equal(/OUTSIDE-SECRET|DOT-SECRET/.test(res.body), false);

test('the site is served: index, types, headers, HEAD, the right body', async (t) => {
  const { site } = siteFolder(t);
  const { raw } = await start(t, { config: { siteDir: site } });
  for (const p of ['/', '/index.html', '/?x=1', '/#frag']) {
    const res = await raw('GET', p);
    assert.deepEqual([res.status, res.headers['content-type'], res.body], [200, 'text/html; charset=utf-8', '<!doctype html><title>j</title>'], p);
  }
  const js = await raw('GET', '/js/main.js?v=3');
  assert.deepEqual([js.status, js.headers['content-type'], js.body], [200, 'text/javascript; charset=utf-8', 'export const a = 1;']);
  assert.deepEqual([(await raw('GET', '/css/app.css')).headers['content-type'], (await raw('GET', '/logo.svg')).headers['content-type'], (await raw('GET', '/data.bin')).headers['content-type']],
    ['text/css; charset=utf-8', 'image/svg+xml', 'application/octet-stream']);
  assert.equal(js.headers['x-content-type-options'], 'nosniff');
  assert.equal(js.headers['referrer-policy'], 'no-referrer');
  assert.equal(js.headers['x-frame-options'], 'DENY');
  assert.equal(js.headers['cache-control'], 'no-cache');
  const head = await raw('HEAD', '/js/main.js');
  assert.deepEqual([head.status, head.body, head.headers['content-length']], [200, '', String('export const a = 1;'.length)]);
});

test('probes: no way out of the site folder, no dotfiles, no listing', async (t) => {
  const { site } = siteFolder(t);
  const { raw } = await start(t, { config: { siteDir: site } });
  const bad = ['/../package.json', '/%2e%2e/package.json', '/js/%2e%2e/%2e%2e/package.json', '/..%2fpackage.json', '/%5c..%5cpackage.json', '/..\\package.json',
    '/js/../../package.json', '/%2E%2E/package.json', '/.git/config', '/.git/', '/.env', '/js/.env', '/%2egit/config', '/%00', '/index.html%00.png', '/js/%00', '/js/', '/js', '/css/', '/.',
    '/./index.html', '/js/./main.js', '/js/..', '/%252e%252e/package.json', '/%', '/%zz', '/%e0%a4%a', '/index.html::$DATA', '/C:/Windows/win.ini', '/js//..//..//package.json',
    '//../package.json', '/' + encodeURIComponent(path.join(site, '..', 'package.json'))];
  for (const p of bad) {
    const res = await raw('GET', p);
    assert.equal(res.status, 404, p);
    noLeak(res);
    assert.equal(res.headers['content-type'].startsWith('text/plain'), true, p);
  }
  assert.equal((await raw('HEAD', '/../package.json')).status, 404);
});

test('a link inside the folder that points outside is not followed', async (t) => {
  const { base, site } = siteFolder(t);
  const links = [];
  for (const [target, name, type] of [[path.join(base, 'package.json'), 'leak.txt', 'file'], [base, 'up', 'junction']]) {
    try {
      fs.symlinkSync(target, path.join(site, name), type);
      links.push(name);
    } catch (error) { /* the system does not let this user make this kind of link */ }
  }
  if (links.length === 0) {
    t.skip('the system does not let this user make links');
    return;
  }
  const { raw } = await start(t, { config: { siteDir: site } });
  for (const p of [...links.includes('leak.txt') ? ['/leak.txt'] : [], ...links.includes('up') ? ['/up/package.json'] : []]) {
    const res = await raw('GET', p);
    assert.equal(res.status, 404, p);
    noLeak(res);
  }
});

test('other methods on a site path: 405 with Allow; the API and the check still answer', async (t) => {
  const { site } = siteFolder(t);
  const { raw, post } = await start(t, { config: { siteDir: site } });
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const res = await raw(method, '/index.html');
    assert.deepEqual([res.status, res.headers.allow], [405, 'GET, HEAD'], method);
  }
  const health = await raw('GET', '/health');
  assert.deepEqual([health.status, JSON.parse(health.body)], [200, { ok: true, data: 'journal', version: 'unknown' }]);
  assert.equal((await raw('POST', '/health')).status, 404);
  const res = await post(login(PERSON.password), { Origin: ORIGIN });
  assert.deepEqual([res.status, (await res.json()).ok], [200, true]);
  assert.equal((await raw('GET', '/api')).status, 405);
  assert.equal((await raw('GET', '/api', { Origin: ORIGIN })).headers['content-type'], 'application/json; charset=utf-8');
  assert.equal((await raw('GET', '/api/')).status, 404);
});

test('without siteDir every site path is 404, as before', async (t) => {
  const { raw } = await start(t);
  for (const p of ['/', '/index.html', '/js/main.js']) assert.equal((await raw('GET', p)).status, 404, p);
  assert.equal((await raw('POST', '/index.html')).status, 404);
});

test('siteDir in the settings: a folder that exists, relative to the repository; anything else is bad_site_dir', (t) => {
  const { root, outside } = tempRoot(t);
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'x');
  const ok = { dataDir: path.join(outside, 'data'), backupDir: path.join(outside, 'copies') };
  const withFile = (extra) => { fs.writeFileSync(path.join(root, 'serve.local.json'), JSON.stringify({ ...ok, ...extra })); return readConfig({ root, env: {} }); };
  assert.equal(withFile({}).siteDir, '');
  assert.equal(withFile({ siteDir: '' }).siteDir, '');
  assert.equal(withFile({ siteDir: 'site' }).siteDir, path.join(root, 'site'));
  for (const siteDir of ['nope', 'file.txt']) assert.throws(() => withFile({ siteDir }), { code: 'bad_site_dir' }, siteDir);
  for (const siteDir of [5, ['site']]) assert.throws(() => withFile({ siteDir }), { code: 'bad_config' }, String(siteDir));
  const env = { JOURNAL_DATA_DIR: ok.dataDir, JOURNAL_BACKUP_DIR: ok.backupDir };
  assert.equal(readConfig({ root, env: { ...env, JOURNAL_SITE_DIR: path.join(root, 'site') } }).siteDir, path.join(root, 'site'));
  assert.equal(readConfig({ root, env: { ...env, JOURNAL_SITE_DIR: '' } }).siteDir, '');
  assert.throws(() => readConfig({ root, env: { ...env, JOURNAL_SITE_DIR: path.join(root, 'file.txt') } }), { code: 'bad_site_dir' });
  assert.throws(() => readConfig({ root, env: { ...env, JOURNAL_SITE_DIR: path.join(root, 'nope') } }), { code: 'bad_site_dir' });
});

test('siteDir may not be, hold or lie inside the data, copies or alert folders; a sibling is fine', (t) => {
  const { root, outside } = tempRoot(t);
  const data = path.join(outside, 'data');
  const copies = path.join(outside, 'copies');
  const alert = path.join(outside, 'alert');
  for (const d of [data, copies, alert, path.join(outside, 'site'), path.join(data, 'pub'), path.join(outside, 'holder', 'copies')]) fs.mkdirSync(d, { recursive: true });
  const read = (siteDir, extra = {}) => readConfig({ root, env: { JOURNAL_DATA_DIR: data, JOURNAL_BACKUP_DIR: copies, JOURNAL_ALERT_DIR: alert, JOURNAL_SITE_DIR: siteDir, ...extra } });
  assert.equal(read(path.join(outside, 'site')).siteDir, path.join(outside, 'site'));
  for (const siteDir of [data, outside, path.join(data, 'pub'), copies, alert]) assert.throws(() => read(siteDir), { code: 'bad_site_dir' }, siteDir);
  assert.throws(() => read(path.join(outside, 'holder'), { JOURNAL_BACKUP_DIR: path.join(outside, 'holder', 'copies') }), { code: 'bad_site_dir' });
  assert.throws(() => read(path.join(outside, 'site'), { JOURNAL_ALERT_DIR: path.join(outside, 'site', 'a') }), { code: 'bad_site_dir' });
});

test('a 404 on a site path carries nosniff too', async (t) => {
  const { site } = siteFolder(t);
  const { raw } = await start(t, { config: { siteDir: site } });
  assert.equal((await raw('GET', '/nope.html')).headers['x-content-type-options'], 'nosniff');
});

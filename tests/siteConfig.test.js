import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// config.js reads the page address when it loads, so the site modules are imported after the address is set.
globalThis.location = { hostname: 'localhost' };
const { apiUrlFor, API_URL, PRODUCTION_API_URL } = await import('../site/config.js');

test('the stand talks to its own stand, any other page to the journal server; a wrong address means «not configured»', () => {
  const live = 'https://journal.example.ts.net/api';
  assert.deepEqual([apiUrlFor('localhost', live), apiUrlFor('127.0.0.1', live), apiUrlFor('janybek.github.io', live), apiUrlFor('evil.example', live)], ['/api', '/api', live, live]);
  for (const bad of ['', 'http://journal.example.ts.net/api', 'https://journal.example.ts.net', 'https://journal.example.ts.net/api?x=1', 'https://journal.example.ts.net/api#x',
    '//journal.example.ts.net/api', 'javascript:alert(1)', ' https://journal.example.ts.net/api', 'https://a b/api'])
    assert.equal(apiUrlFor('janybek.github.io', bad), '', bad);
  assert.equal(API_URL, '/api');
  assert.equal(PRODUCTION_API_URL === '' || apiUrlFor('janybek.github.io') === PRODUCTION_API_URL, true);        // the address written at the deployment must pass the check
});

test('the address of the server cannot come from the page address or the browser storage', () => {
  const site = (file) => fs.readFileSync(new URL(`../site/${file}`, import.meta.url), 'utf8');
  for (const file of ['config.js', 'js/api.js'])
    assert.doesNotMatch(site(file), /location\.(search|hash|href)|URLSearchParams|localStorage|sessionStorage|document\.cookie/, file);
  assert.doesNotMatch(site('config.js'), /script\.google\.com/);
});

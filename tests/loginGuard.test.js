import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOGIN_LIMIT, loginKey, createLoginGuard } from '../core/loginGuard.js';

const L = { attempts: 3, windowMs: 1000, blockMs: 5000, maxKeys: 3, keyLength: 10 };

test('the default limit', () => {
  assert.deepEqual(LOGIN_LIMIT, { attempts: 10, windowMs: 900000, blockMs: 900000, maxKeys: 5000, keyLength: 100 });
});
test('loginKey: letter case, spaces, long and non-string logins', () => {
  assert.deepEqual([loginKey(' Admin '), loginKey('S1001'), loginKey('ӨМҮР'), loginKey(['admin']), loginKey(7), loginKey(null), loginKey(undefined), loginKey('x'.repeat(500)).length],
    ['admin', 's1001', 'өмүр', '', '', '', '', 100]);
});
test('loginKey: objects and blank logins give an empty key, never a real login', () => {
  assert.deepEqual([loginKey({ toString: () => 'admin' }), loginKey({}), loginKey('   '), loginKey('')], ['', '', '', '']);
  assert.equal(loginKey('  ' + 'x'.repeat(500)).length, 100);
});
test('the block starts at the limit, lasts blockMs, is not prolonged and then gives a fresh count', () => {
  const g = createLoginGuard(L);
  g.fail('a', 0); g.fail('a', 10);
  assert.equal(g.blockedFor('a', 20), 0);
  g.fail('a', 20);
  assert.deepEqual([g.blockedFor('a', 20), g.blockedFor('b', 20)], [5000, 0]);
  g.fail('a', 3000);                                                     // попытка во время блока его не продлевает
  assert.deepEqual([g.blockedFor('a', 5019), g.blockedFor('a', 5020), g.size()], [1, 0, 0]);
  g.fail('a', 5020); g.fail('a', 5021);
  assert.equal(g.blockedFor('a', 5022), 0);                              // после блока счёт с нуля: две ошибки из трёх
});
test('failures outside the window do not add up; a success clears the count; keys do not touch each other', () => {
  const g = createLoginGuard(L);
  g.fail('a', 0); g.fail('a', 1); g.fail('a', 1000);                     // третья — уже в новом окне
  assert.equal(g.blockedFor('a', 1001), 0);
  g.fail('a', 1001); g.success('a'); g.fail('a', 1002); g.fail('a', 1003);
  assert.deepEqual([g.blockedFor('a', 1004), g.size()], [0, 1]);
  g.fail('b', 1004); g.fail('b', 1005); g.fail('b', 1006);
  assert.deepEqual([g.blockedFor('b', 1006) > 0, g.blockedFor('a', 1006)], [true, 0]);
});
test('a full table: a flow of strange logins pushes out only one-error keys, never the victim and never a blocked key; nobody is locked out', () => {
  const g = createLoginGuard(L);
  g.fail('victim', 0); g.fail('victim', 1);
  g.fail('x1', 2); g.fail('x2', 3);
  g.fail('x3', 4);                                                       // таблица полна: вытеснен x1 (счёт 1, самый старый)
  assert.deepEqual([g.size(), g.blockedFor('x3', 5), g.blockedFor('victim', 5)], [3, 0, 0]);
  for (let i = 0; i < 50; i++) g.fail('junk' + i, 6 + i);                // поток чужих логинов
  g.fail('victim', 60);
  assert.deepEqual([g.blockedFor('victim', 61), g.blockedFor('someone-new', 61), g.size()], [4999, 0, 3]);   // счёт жертвы цел: третья ошибка закрыла вход
  const B = { attempts: 1, windowMs: 1000, blockMs: 5000, maxKeys: 2, keyLength: 10 };
  const h = createLoginGuard(B);
  h.fail('a', 0); h.fail('b', 1);                                        // оба закрыты, таблица полна
  h.fail('c', 2);                                                        // места нет, закрытых не вытесняют: c не записан
  assert.deepEqual([h.size(), h.blockedFor('c', 3), h.blockedFor('a', 3) > 0, h.blockedFor('b', 3) > 0], [2, 0, true, true]);
  h.fail('c', 5001);                                                     // блоки a и b истекли: место нашлось
  assert.deepEqual([h.size(), h.blockedFor('c', 5002)], [1, 5000 - 1]);  // c тоже закрыт (лимит 1): until = 5001 + 5000
});
test('guessing made-up logins does not lock out a real one: keys are separate, junk keys are counted separately', () => {
  const g = createLoginGuard();
  for (let i = 0; i < 20000; i++) g.fail(loginKey('guess' + i), i);
  assert.equal(g.blockedFor(loginKey(' Admin '), 20000), 0);
  assert.equal(g.size() <= LOGIN_LIMIT.maxKeys, true);
  for (let i = 0; i < 10; i++) g.fail(loginKey(' ADMIN'), 20001 + i);
  assert.equal(g.blockedFor(loginKey('admin'), 20011) > 0, true);        // регистр и пробелы — один ключ
});
test('array, object and blank logins all land on the one empty key and cannot lock a real login', () => {
  const g = createLoginGuard();
  for (const bad of [['admin'], { login: 'admin' }, '   ', 7, null]) for (let i = 0; i < 12; i++) g.fail(loginKey(bad), i);
  assert.equal(g.blockedFor(loginKey('admin'), 20), 0);
  assert.equal(g.blockedFor(loginKey(['admin']), 20) > 0, true);
});

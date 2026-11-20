import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, t, tCount, setLang, applyOverrides, pickLang } from '../site/js/i18n.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';
import { IMPORT_SPECS } from '../core/import.js';
import { IMPORT_COLUMNS } from '../site/js/views/directoryConfig.js';

test('template column titles in the dictionaries equal IMPORT_SPECS', () => {
  for (const [table, spec] of Object.entries(IMPORT_SPECS)) for (const col of spec.columns)
    for (const [lang, dict] of Object.entries({ ru, ky, en }))
      assert.equal(dict[`import.col.${table}.${col.key}`], col.titles[lang], `${lang} ${table}.${col.key}`);
});

test('the site lists the same template columns as IMPORT_SPECS', () => {
  const fromSpecs = Object.fromEntries(Object.entries(IMPORT_SPECS)
    .map(([table, spec]) => [table, spec.columns.map(({ key, required }) => ({ key, required }))]));
  assert.deepEqual(IMPORT_COLUMNS, fromSpecs);
});

test('tCount picks the plural form of the current language', () => {
  try {
    setLang('ru');
    assert.equal(tCount('import.apply', 1), 'Импортировать 1 строку');
    assert.equal(tCount('import.apply', 3), 'Импортировать 3 строки');
    assert.equal(tCount('import.apply', 5), 'Импортировать 5 строк');
    assert.equal(tCount('import.apply', 21), 'Импортировать 21 строку');
    setLang('en');
    assert.equal(tCount('import.apply', 1), 'Import 1 row');
    assert.equal(tCount('import.apply', 2), 'Import 2 rows');
    setLang('ky');
    assert.equal(tCount('import.apply', 2), ky['import.apply.other'].replace('{count}', '2'));
  } finally {
    setLang('ky');
  }
});

test('dictionaries have identical key sets', () => {
  assert.deepEqual(Object.keys(ky).sort(), Object.keys(ru).sort());
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
});

test('translate falls back lang -> ru -> key and fills params', () => {
  assert.equal(translate({ ky: {}, ru: { a: 'Привет, {name}' }, en: {} }, 'ky', 'a', { name: 'Айгерим' }), 'Привет, Айгерим');
  assert.equal(translate({ ky: {}, ru: {}, en: {} }, 'ky', 'нет.ключа'), 'нет.ключа');
  assert.equal(translate({ ky: { a: 'Салам' }, ru: { a: 'Привет' }, en: {} }, 'ky', 'a'), 'Салам');
  assert.equal(translate({ ky: {}, ru: { a: '{n} из {m}' }, en: {} }, 'en', 'a', { n: 3 }), '3 из {m}');
});

test('every server error code has a text', () => {
  for (const code of ['bad_credentials', 'unauthorized', 'forbidden', 'invalid', 'in_use', 'internal', 'network', 'must_change_password',
    'required', 'too_long', 'bad_value', 'duplicate', 'bad_ref', 'last_admin', 'too_short', 'same_as_login', 'too_simple', 'too_many_rows'])
    assert.ok(ru['error.' + code], code);
});

test('pickLang: a choice made on this device wins over the account language', () => {
  assert.deepEqual(pickLang({ deviceLang: null, userLang: 'ru' }), { lang: 'ru', saveToAccount: false });
  assert.deepEqual(pickLang({ deviceLang: 'en', userLang: 'ru' }), { lang: 'en', saveToAccount: true });
  assert.deepEqual(pickLang({ deviceLang: 'ru', userLang: 'ru' }), { lang: 'ru', saveToAccount: false });
  assert.deepEqual(pickLang({ deviceLang: 'xx', userLang: 'en' }), { lang: 'en', saveToAccount: false });
  // Signed out: the device choice, else the default; there is no account to save to.
  assert.deepEqual(pickLang({ deviceLang: 'en', userLang: null }), { lang: 'en', saveToAccount: false });
  assert.deepEqual(pickLang({ deviceLang: null, userLang: null }), { lang: 'ky', saveToAccount: false });
});

test('overrides replace texts; empty values are ignored for that language', () => {
  assert.equal(t('login.submit'), ky['login.submit']);
  applyOverrides([{ key: 'login.submit', ky: 'Кир', ru: '', en: 'Go' }]);
  assert.equal(t('login.submit'), 'Кир');
  applyOverrides([{ key: 'login.submit', ky: '  ', ru: 'Войти!', en: '' }]);
  assert.equal(t('login.submit'), ky['login.submit']);
  applyOverrides([]);
});

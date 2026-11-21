import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, t, tCount, setLang, applyOverrides, pickLang } from '../site/js/i18n.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';
import { IMPORT_SPECS, parseSheet } from '../core/import.js';
import { LESSON_TYPES } from '../core/schema.js';
import { IMPORT_COLUMNS, IMPORT_TABLES, FIELDS } from '../site/js/views/directoryConfig.js';

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

test('topics can be imported: last in the order, with a field for every column and the texts of the screen', () => {
  assert.equal(IMPORT_TABLES[IMPORT_TABLES.length - 1], 'topics');
  for (const { key } of IMPORT_COLUMNS.topics) assert.ok(FIELDS[key], key);
  // The template formats every column but the numbers as Text.
  assert.deepEqual(IMPORT_COLUMNS.topics.filter(({ key }) => FIELDS[key].kind === 'number').map(({ key }) => key), ['semester', 'unit', 'order']);
  for (const { key } of IMPORT_COLUMNS.syllabus) assert.ok(FIELDS[key], key);
  assert.deepEqual(IMPORT_COLUMNS.syllabus.filter(({ key }) => FIELDS[key].kind === 'number').map(({ key }) => key), ['semester', 'unit', 'order']);
  assert.equal(IMPORT_TABLES.includes('syllabus'), false);                        // силлабус загружается со страницы предмета, не из общего импорта
  for (const key of ['import.colHint.topics.semester', 'import.error.semester.bad_value']) assert.ok(ru[key], key);
  for (const key of ['dir.topics', 'import.matchBy.topics', 'import.error.name.held', 'import.error.subjectId.bad_ref']) assert.ok(ru[key], key);
  for (const table of IMPORT_TABLES) assert.ok(ru['import.matchBy.' + table], table);
});

test('the lesson types the import hint names are words the importer reads; in English, the type codes themselves', () => {
  const db = { groups: [{ id: 'g1', name: '01-1' }], subjects: [{ id: 'sb1', name: 'Анатомия', groupId: 'g1' }], topics: [], pairs: [] };
  const words = (dict) => dict['import.colHint.topics.lessonType'].replace(/\.$/, '').split(/,\s*|\s+(?:или|or|же)\s+/);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    const cells = [IMPORT_SPECS.topics.columns.map((col) => col.titles.ru),
      ...words(dict).map((word, i) => ['Анатомия', '01-1', 1, 1, i + 1, 'Тема', word])];
    const { records, errors } = parseSheet('topics', cells, db);
    assert.deepEqual(errors, [], lang);
    assert.deepEqual(records.map((r) => r.lessonType), LESSON_TYPES, lang);
  }
  assert.deepEqual(words(en), LESSON_TYPES);
  assert.match(en['import.error.lessonType.bad_value'], /lecture, practice or control/);
});

test('the lesson types the syllabus hint names are words the syllabus file reads', () => {
  const db = { groups: [{ id: 'g1', name: '01-1' }], subjects: [{ id: 'sb1', name: 'Анатомия', groupId: 'g1' }], topics: [], pairs: [] };
  const words = (dict) => dict['import.colHint.syllabus.lessonType'].replace(/\.$/, '').split(/,\s*|\s+(?:или|or|же)\s+/);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    const cells = [IMPORT_SPECS.syllabus.columns.map((col) => col.titles.ru),
      ...words(dict).map((word, i) => [1, 1, i + 1, 'Тема', word])];               // Семестр, Модуль, №, Тема, Тип
    const { records, errors } = parseSheet('syllabus', cells, db, { subjectId: 'sb1' });
    assert.deepEqual(errors, [], lang);
    assert.deepEqual(records.map((r) => r.lessonType), LESSON_TYPES, lang);
  }
  assert.deepEqual(words(en), LESSON_TYPES);                                       // en: «lecture, practice or control»
});

test('the syllabus is uploaded from the subject page; the old link to the topics import is gone', () => {
  for (const key of ['syllabus.title', 'syllabus.upload', 'syllabus.back', 'syllabus.forbidden', 'syllabus.sheet', 'import.matchBy.syllabus',
    'import.error.order.duplicate']) assert.ok(ru[key], key);
  for (const key of ['semester', 'unit', 'order', 'lessonType']) assert.ok(ru['import.colHint.syllabus.' + key], key);
  for (const dict of [ru, ky, en]) assert.equal('topics.import' in dict, false);
});

test('every directory that can be in use elsewhere explains why it cannot be removed', () => {
  for (const table of ['groups', 'staff', 'subjects', 'rooms']) assert.ok(ru['dir.inUse.' + table], table);
});

test('a subject whose group cannot be changed has its own error text in every language', () => {
  for (const [lang, dict] of [['ru', ru], ['ky', ky], ['en', en]]) assert.ok(dict['error.subjects.groupId.in_use'], lang);
});

test('the bell list has its texts: the empty choice and a saved time that is not on the list', () => {
  for (const key of ['settings.bellChoose', 'settings.bellOffList']) assert.ok(ru[key], key);
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

test('the «Сегодня» placeholder of the student home is gone: the home shows the pairs of today', () => {
  for (const dict of [ru, ky, en]) assert.equal('home.todaySoon' in dict, false);
});

test('a weekday of the schedule names the week template it opens', () => {
  assert.ok(ru['schedule.toTemplate']);
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

test('the syllabus page has its texts: a part of the course is a unit, the control lesson a module; «Темы» and the plan page are gone', () => {
  assert.deepEqual([ru['syllabus.unitN'], ru['syllabus.controlN'], ky['syllabus.unitN'], en['syllabus.unitN']], ['Юнит {n}', 'Модуль {n} (рубежный контроль)', 'Юнит {n}', 'Unit {n}']);
  for (const key of ['syllabus.title', 'syllabus.descriptions', 'home.subjects', 'lessonType.seminar', 'lessonType.lab', 'pairs.lessonPart', 'pairs.unitControl']) assert.ok(ru[key], key);
  for (const dict of [ru, ky, en]) assert.equal(Object.keys(dict).some((k) => k.startsWith('topics.') || k.startsWith('plan.')), false);
  // переключатель «Сейчас идёт» в «Настройках семестра» берёт подпись отсюда — тексты прежних topics.semesterN
  assert.deepEqual([ru['syllabus.semesterN'], ky['syllabus.semesterN'], en['syllabus.semesterN']], ['{n} семестр', '{n}-семестр', 'Semester {n}']);
  for (const key of ['home.syllabus', 'settings.semesterNo', 'settings.savedSemester', 'settings.error.semester.bad_value']) assert.ok(ru[key], key);
});

test('every schedule error code has a text', () => {
  for (const code of ['group_busy', 'teacher_busy', 'room_busy', 'in_past', 'pair_locked', 'empty_template', 'held', 'out_of_semester', 'day_off', 'bad_request'])
    assert.ok(ru['error.' + code], code);
});

test('days and months are in the dictionaries, not taken from Intl', () => {
  for (let n = 1; n <= 7; n++) assert.ok(ru['date.weekday.' + n] && ru['date.weekdayShort.' + n], String(n));
  for (let n = 1; n <= 12; n++) assert.ok(ru['date.month.' + n], String(n));
  assert.equal(translate({ ky: {}, ru, en: {} }, 'ru', 'date.dayMonth', { day: 21, month: ru['date.month.11'] }), '21 ноября');
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

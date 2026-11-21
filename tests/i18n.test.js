import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, t, tCount, setLang, applyOverrides, pickLang } from '../site/js/i18n.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';
import { IMPORT_SPECS } from '../core/import.js';
import { SYLLABUS_SHEETS, INFO_ROWS, PLAN_COLUMNS, KIND_WORDS } from '../core/syllabusFile.js';
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

test('the old topic import is gone: the site lists no topics or syllabus import, and no texts for them', () => {
  assert.deepEqual(IMPORT_TABLES, ['groups', 'rooms', 'staff', 'students', 'disciplines', 'subjects']);
  assert.deepEqual(Object.keys(IMPORT_COLUMNS).sort(), Object.keys(IMPORT_SPECS).sort());
  for (const key of ['subjectId', 'lessonType', 'semester', 'unit', 'order']) assert.equal(key in FIELDS, false, key);
  for (const dict of [ru, ky, en]) for (const key of Object.keys(dict)) {
    assert.equal(/^import\.(col|colHint|matchBy)\.(topics|syllabus)/.test(key) || key.startsWith('dir.topics'), false, key);
  }
  for (const table of IMPORT_TABLES) assert.ok(ru['import.matchBy.' + table], table);
});

test('the sheets, lines, columns and kinds of the syllabus template are the names core/syllabusFile.js reads, in every language', () => {
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    for (const [key, titles] of Object.entries(SYLLABUS_SHEETS)) assert.equal(dict['syllabus.file.sheet.' + key], titles[lang], lang + ' ' + key);
    for (const item of INFO_ROWS) assert.equal(dict['syllabus.file.info.' + item.key], item.titles[lang], lang + ' ' + item.key);
    for (const column of PLAN_COLUMNS) assert.equal(dict['syllabus.file.plan.' + column.key], column.titles[lang], lang + ' ' + column.key);
    for (const kind of ['seminar', 'lab', 'control']) assert.equal(KIND_WORDS[dict['syllabus.file.kind.' + kind].toLowerCase()], kind, lang + ' ' + kind);
  }
});

test('every code of the syllabus check has a text; the old texts of the syllabus import are gone', () => {
  for (const code of ['missing_sheet', 'missing_column', 'too_many_rows', 'empty', 'required', 'bad_value', 'too_long', 'bad_hours', 'no_hours', 'unit_order', 'semester_order', 'semester_clash', 'held_missing', 'held_hours', 'kind_needs_practice']) {
    assert.ok(ru['syllabus.error.' + code], code);
  }
  for (const code of ['ignored_sheets', 'ignored', 'info_empty', 'total_mismatch', 'class_mismatch', 'self_mismatch', 'no_control', 'discipline_differs', 'teacher_differs', 'held_renamed', 'semester_replaces', 'unit_title_differs']) {
    assert.ok(ru['syllabus.warning.' + code], code);
  }
  assert.ok(ru['syllabus.error.bad_hours'].includes('1 пара = 2 часа'));
  for (const key of ['syllabus.upload', 'syllabus.template', 'syllabus.download', 'syllabus.check.title', 'syllabus.check.whose', 'syllabus.check.summary',
    'syllabus.check.first', 'syllabus.check.replace', 'syllabus.check.failed', 'syllabus.check.apply', 'syllabus.done', 'syllabus.where', 'syllabus.whereSheet',
    'syllabus.fileError.dateCell', 'syllabus.fileError.tooMany', 'syllabus.help.title']) assert.ok(ru[key], key);
  for (const key of ['order', 'hours', 'semester', 'control', 'columns', 'self']) assert.ok(ru['syllabus.help.' + key], key);
  assert.equal(ru['syllabus.upload'], 'Загрузить (Excel)');
  for (const dict of [ru, ky, en]) {
    for (const gone of ['syllabus.lead', 'syllabus.step.subject', 'syllabus.subjectHint', 'syllabus.sheet', 'syllabus.back', 'topics.import']) assert.equal(gone in dict, false, gone);
  }
});

test('final fix wave: field texts of the file check, the replaced semester, unit titles, a new teacher of a group', () => {
  // I2: the semester cell has its own text; the plan column (one number per row) another
  assert.equal(ru['syllabus.error.semester.bad_value'], 'Семестр — число от 1 до 8, как в учебном плане (например 3). Для курса на два семестра — «1-2».');
  // I3, M2, M13, R3, M4
  assert.equal(ru['syllabus.warning.semester_replaces'],
    'В журнале загружен силлабус {stored} семестра. Этот файл ({file} семестр) заменит его во всех группах: {groups}. Если это другой курс, заведите для него отдельную дисциплину.');
  for (const dict of [ru, ky, en]) {
    for (const key of ['syllabus.error.plan.semester.bad_value', 'syllabus.error.practiceKind.bad_value', 'syllabus.unitTitled', 'subjects.edit.busy.one', 'subjects.edit.busy.other']) assert.ok(dict[key], key);
    assert.match(dict['syllabus.error.semester_clash'], /3/);                                       // different academic years, e.g. 2 and 3
    assert.match(dict['syllabus.help.semester'], /1-2/);
    assert.match(dict['syllabus.help.columns'], new RegExp(dict['syllabus.file.plan.unitTitle']));
  }
  for (const word of ['лекция', 'практика', 'семинар', 'лабораторная', 'модуль']) assert.ok(ru['syllabus.error.practiceKind.bad_value'].includes(word), word);
  // I1: the success text says that the future pairs now belong to the new teacher
  assert.match(ru['subjects.edit.saved'], /предстоящие пары теперь у нового преподавателя/);
});

test('«Все занятия стоят на парах»: the number of pairs is written with its word in every language (M12)', () => {
  const said = {};
  for (const lang of ['ru', 'ky', 'en']) {
    setLang(lang);
    said[lang] = [18, 21].map((n) => t('syllabus.fits', { pairs: tCount('syllabus.pairsCount', n) }));
  }
  setLang('ky');
  assert.deepEqual(said.ru, ['Все занятия стоят на парах: в расписании семестра 18 пар.', 'Все занятия стоят на парах: в расписании семестра 21 пара.']);
  assert.equal(said.ky[0], 'Бардык темалар сабактарга коюлду: семестрдин жадыбалында 18 сабак.');
  assert.equal(said.en[0], 'Every lesson has a class: the semester schedule has 18 classes.');
});

test('every directory that can be in use elsewhere explains why it cannot be removed', () => {
  for (const table of ['groups', 'staff', 'subjects', 'rooms', 'disciplines']) assert.ok(ru['dir.inUse.' + table], table);
});

test('the subjects screen and the disciplines directory have their texts; the subjects directory form is gone', () => {
  for (const key of ['subjects.title', 'subjects.syllabus.none', 'subjects.add', 'dir.disciplines.hint', 'dir.inUse.disciplines', 'error.subjects.disciplineId.duplicate']) assert.ok(ru[key], key);
  for (const dict of [ru, ky, en]) for (const gone of ['dir.subjects.add', 'dir.subjects.new', 'error.subjects.name.duplicate']) assert.equal(gone in dict, false, gone);
  for (const key of ['dir.disciplines.add', 'dir.disciplines.new', 'error.disciplines.name.duplicate', 'error.subjects.disciplineId.bad_ref', 'error.subjects.disciplineId.in_use',
    'subjects.hint', 'subjects.lead', 'subjects.syllabus.uploaded', 'subjects.syllabus.other', 'subjects.pairsDiffer', 'subjects.empty', 'subjects.edit.saved']) assert.ok(ru[key], key);
  assert.equal(ru['subjects.col.syllabus'], 'Силлабус ({n} семестр)');
  assert.equal(ru['syllabus.check.renamed'], 'Переименованная тема считается новой: даты её пар сохранятся.');
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

test('the week grid and the pair window have their texts', () => {
  for (const key of ['pairs.grid.caption', 'pairs.grid.slot', 'pairs.hasNote', 'pairs.details.when', 'pairs.details.teacher', 'pairs.details.room',
    'pairs.details.topic', 'pairs.details.noTopic', 'pairs.details.note', 'pairs.details.syllabus', 'pairs.details.control']) assert.ok(ru[key], key);
});

test('a group with a syllabus but no pairs yet has a calm line on «Предметы», not «по плану 18 пар, в расписании 0»', () => {
  assert.equal(ru['subjects.notScheduled'], 'ещё нет в расписании');
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

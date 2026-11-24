import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate, t, tCount, setLang, applyOverrides, pickLang } from '../site/js/i18n.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';
import { IMPORT_SPECS } from '../core/import.js';
import { SYLLABUS_SHEETS, INFO_ROWS, PLAN_COLUMNS, KIND_WORDS } from '../core/syllabusFile.js';
import { IMPORT_COLUMNS, IMPORT_TABLES, FIELDS } from '../site/js/views/directoryConfig.js';
import { TABS } from '../site/js/syllabusForm.js';

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
  for (const code of ['missing_sheet', 'missing_column', 'too_many_rows', 'empty', 'required', 'bad_value', 'too_long', 'bad_hours', 'no_hours', 'unit_order', 'semester_order', 'semester_clash', 'held_missing', 'held_hours', 'kind_needs_practice', 'kind_is_lecture', 'kind_is_practice', 'control_first', 'in_review']) {
    assert.ok(ru['syllabus.error.' + code], code);
  }
  for (const code of ['ignored_sheets', 'ignored', 'info_empty', 'total_mismatch', 'class_mismatch', 'self_mismatch', 'no_control', 'discipline_differs', 'teacher_differs', 'held_renamed', 'semester_replaces', 'unit_title_differs', 'units_removed']) {
    assert.ok(ru['syllabus.warning.' + code], code);
  }
  assert.ok(ru['syllabus.error.bad_hours'].includes('1 пара = 2 часа'));
  for (const key of ['syllabus.fillFromFile', 'syllabus.template', 'syllabus.check.title', 'syllabus.check.whose', 'syllabus.check.summary',
    'syllabus.check.first', 'syllabus.check.replace', 'syllabus.check.failed', 'syllabus.check.apply', 'syllabus.done', 'syllabus.where', 'syllabus.whereSheet',
    'syllabus.fileError.dateCell', 'syllabus.fileError.tooMany', 'syllabus.help.title']) assert.ok(ru[key], key);
  for (const key of ['order', 'hours', 'semester', 'control', 'columns']) assert.ok(ru['syllabus.help.' + key], key);
  assert.equal(ru['syllabus.fillFromFile'], 'Заполнить из файла');
  for (const dict of [ru, ky, en]) {
    for (const gone of ['syllabus.lead', 'syllabus.step.subject', 'syllabus.subjectHint', 'syllabus.sheet', 'syllabus.back', 'topics.import']) assert.equal(gone in dict, false, gone);
  }
});

test('final fix wave: field texts of the file check, the replaced semester, unit titles, a new teacher of a group', () => {
  // I2: the semester cell has its own text; the plan column (one number per row) another
  assert.equal(ru['syllabus.error.semester.bad_value'], 'Семестр — число от 1 до 8, как в учебном плане (например 3). Для курса на два семестра — «1-2».');
  // I3, M2, M13, R3, M4
  // task 44: a file changes the draft only; the groups get it once it is approved
  assert.equal(ru['syllabus.warning.semester_replaces'].includes('во всех группах'), false);
  assert.ok(ru['syllabus.warning.semester_replaces'].includes('черновик'));
  for (const dict of [ru, ky, en]) for (const name of ['{stored}', '{file}', '{groups}']) assert.ok(dict['syllabus.warning.semester_replaces'].includes(name), name);
  for (const dict of [ru, ky, en]) {
    for (const key of ['syllabus.error.plan.semester.bad_value', 'syllabus.error.practiceKind.bad_value', 'syllabus.unitTitled', 'subjects.edit.busy.one', 'subjects.edit.busy.other']) assert.ok(dict[key], key);
    assert.match(dict['syllabus.error.semester_clash'], /3/);                                       // different academic years, e.g. 2 and 3
    assert.match(dict['syllabus.help.semester'], /1-2/);
    assert.match(dict['syllabus.help.columns'], new RegExp(dict['syllabus.file.plan.unitTitle']));
  }
  for (const word of ['лекция', 'практика', 'семинар', 'лабораторная', 'модуль']) assert.ok(ru['syllabus.error.practiceKind.bad_value'].includes(word), word);
  // I1: the success text says that the future pairs now belong to the new teacher
  // N2: moved pairs pass to the new teacher too; pairs handed to another teacher stay
  assert.match(ru['subjects.edit.saved'], /предстоящие пары, в том числе перенесённые, теперь у нового преподавателя/);
  assert.match(ru['subjects.edit.saved'], /отданные на замену другому преподавателю, остались/);
  // N3: the import result says how many pairs stayed with the previous teachers
  for (const dict of [ru, ky, en]) assert.match(dict['import.done.busy'], /\{count\}/);
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
    'subjects.hint', 'subjects.lead', 'subjects.syllabus.approved', 'subjects.syllabus.other', 'subjects.pairsDiffer', 'subjects.empty', 'subjects.edit.saved']) assert.ok(ru[key], key);
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
    'required', 'too_long', 'bad_value', 'duplicate', 'bad_ref', 'last_admin', 'too_short', 'same_as_login', 'too_simple', 'too_many_rows', 'server_down', 'too_many_attempts'])
    assert.ok(ru['error.' + code], code);
});

test('the messages about the server and the file button have a text in all three languages, not the key itself', () => {
  for (const [lang, dict] of Object.entries({ ru, ky, en }))
    for (const key of ['error.server_down', 'error.too_many_attempts', 'syllabus.fillFromFile']) {
      assert.ok(dict[key], lang + ' ' + key);
      assert.notEqual(dict[key], key, lang + ' ' + key);
    }
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
  for (const code of ['group_busy', 'teacher_busy', 'room_busy', 'in_past', 'pair_locked', 'empty_template', 'held', 'out_of_semester', 'day_off', 'bad_request', 'syllabus_locked'])
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

test('the syllabus form has its texts: the tabs, the statuses, the errors of a section', () => {
  for (const tab of TABS) assert.ok(ru['sform.tab.' + tab], tab);
  for (const status of ['draft', 'review', 'returned', 'approved']) assert.ok(ru['syllabus.status.' + status], status);
  for (const code of ['required', 'too_long', 'too_many', 'too_many_rows', 'bad_value', 'bad_hours', 'semester_half', 'duplicate', 'bad_ref', 'bad_order', 'unit_order', 'control_first']) assert.ok(ru['sform.error.' + code], code);
  assert.deepEqual([ru['lessonType.short.seminar'], ru['lessonType.short.lab'], ru['sform.error.bad_hours'].includes('1 пара = 2 часа')], ['С', 'ЛР', true]);
  assert.deepEqual([ru['syllabus.status.review'], ru['syllabus.status.returned']], ['На утверждении', 'Возвращён']);
});

test('the syllabus form of task 42: the checks before submitting, the file into the draft, no «soon» any more', () => {
  const CHECK_KEYS = ['title.department', 'title.academicYear', 'title.course', 'title.planSemester', 'title.credits', 'goals.goal', 'goals.empty', 'plan.empty', 'plan.unit_empty',
    'plan.bad_hours', 'plan.held_missing', 'plan.held_hours', 'plan.held_kind', 'selfWork.bad_unit', 'literature.empty', 'software.empty', 'policies.empty', 'units.empty',
    'plan.bad_kind', 'order.control_first'];
  for (const dict of [ru, ky, en]) {
    for (const key of CHECK_KEYS) assert.ok(dict['sform.checks.' + key], key);
    assert.ok(dict['home.syllabusUpdating']);
    assert.equal('sform.soon' in dict, false);
  }
  assert.ok(ru['syllabus.check.intoDraft']);
  assert.ok(ru['sform.checks.plan.held_missing'].includes('тем же названием'));                    // подсказка: верните тему под тем же названием
  assert.ok(ru['syllabus.error.in_review'].includes('{semester}'));
  // the words a lesson of the draft is written with in the file are read back as its kind
  for (const dict of [ru, ky, en]) {
    for (const kind of ['lecture', 'practice']) assert.equal(KIND_WORDS[dict['syllabus.file.kind.' + kind].toLowerCase()], '', kind);
  }
});

test('task 43: the syllabus page has texts of the states, the buttons, the windows of approval and return, the sections', () => {
  const keys = [
    'syllabus.state.approved', 'syllabus.state.approvedUndated', 'syllabus.state.draft', 'syllabus.state.review', 'syllabus.state.returned', 'syllabus.state.none', 'syllabus.state.noOpen',
    'syllabus.action.approve', 'syllabus.action.giveBack', 'syllabus.version.switch', 'syllabus.version.approved', 'syllabus.version.open',
    'syllabus.openNote', 'syllabus.hidden', 'syllabus.hiddenHint', 'syllabus.emptyHint.staff', 'syllabus.emptyHint.student', 'syllabus.noOpen', 'syllabus.toApproved', 'syllabus.toOpen',
    'syllabus.approve.title', 'syllabus.approve.text', 'syllabus.approve.go', 'syllabus.approve.busy', 'syllabus.approve.failed', 'syllabus.approve.done',
    'syllabus.return.title', 'syllabus.return.lead', 'syllabus.return.label', 'syllabus.return.hint', 'syllabus.return.go', 'syllabus.return.busy',
    'syllabus.return.required', 'syllabus.return.tooLong', 'syllabus.return.count', 'syllabus.return.done', 'syllabus.submit.done', 'sform.submit.notSent',
    'syllabus.toc', 'syllabus.sec.title', 'syllabus.sec.goals', 'syllabus.sec.units', 'syllabus.sec.selfWork', 'syllabus.sec.literature', 'syllabus.sec.software', 'syllabus.sec.policies',
    'syllabus.info.year', 'syllabus.info.groups', 'syllabus.goals.results', 'syllabus.goals.links', 'syllabus.col.kind', 'syllabus.col.hours', 'syllabus.controlForms',
    'syllabus.self.unit', 'syllabus.book.availability', 'syllabus.software.newTab', 'syllabus.sanction',
  ];
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  assert.equal(ru['syllabus.hidden'], 'Силлабус обновляется: новая версия на утверждении в деканате.');
  assert.equal(ru['syllabus.emptyHint.staff'], 'Заполните силлабус на сайте. Готовую таблицу Excel можно загрузить один раз — при первом заполнении.');
  assert.equal(ru['syllabus.emptyHint.student'], 'Преподаватель ещё не заполнил силлабус.');
  assert.equal(ru['syllabus.approve.text'], 'Версия станет действующей: темы лягут на будущие пары всех групп преподавателя. Проведённые пары не изменятся.');
  // the texts of the time when the deanery uploaded the file and the teacher only looked are gone
  for (const dict of [ru, ky, en]) {
    for (const gone of ['syllabus.notUploadedHint.student', 'syllabus.notUploadedHint.teacher', 'syllabus.notUploadedHint.office', 'syllabus.help.self',
      'syllabus.col.lecture', 'syllabus.col.practice']) assert.equal(gone in dict, false, gone);
  }
  // «Л1. Тема»: the label is the letter of the kind and the number of the journal
  for (const dict of [ru, ky, en]) assert.match(dict['pairs.topicLabel'], /\{label\}.*\{name\}/);
});

test('task 44: the review queue, the syllabus marks of the subject lists; the texts of the time of «загружен» are gone', () => {
  assert.equal(ru['review.title'], 'Силлабусы на утверждении');
  assert.equal(ru['review.empty'], 'Нет силлабусов, ожидающих утверждения');
  assert.equal(ru['review.noSubjects'], 'у преподавателя больше нет групп по этой дисциплине');
  assert.deepEqual(['approved', 'returned', 'review', 'draft', 'other', 'none', 'approvedNote'].map((k) => ru['subjects.syllabus.' + k]),
    ['Утверждён: {hours} ч, {pairs}', 'Возвращён', 'На утверждении', 'Черновик', 'Есть только на другой семестр', 'Нет силлабуса', 'утверждён: {hours} ч, {pairs}']);
  assert.deepEqual(['returned', 'review', 'draft', 'approved', 'none'].map((k) => ru['home.syllabusState.' + k]),
    ['Возвращён', 'На утверждении', 'Черновик', 'Утверждён', 'Нет силлабуса']);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    for (const key of ['review.title', 'review.hint', 'review.lead', 'review.empty', 'review.col.discipline', 'review.col.teacher', 'review.col.semester', 'review.col.sent',
      'review.col.version', 'review.col.status', 'review.emptyHint', 'review.sentBy', 'review.version', 'review.noSubjects', 'review.openForm',
      'subjects.syllabus.approvedNote', 'subjects.uploadedDraft', 'subjects.openForm']) assert.ok(dict[key], lang + ' ' + key);
    for (const gone of ['subjects.syllabus.uploaded', 'syllabus.notUploaded']) assert.equal(gone in dict, false, lang + ' ' + gone);
    assert.equal(Object.keys(dict).some((key) => key.startsWith('syllabus.notUploaded')), false, lang);
    assert.match(dict['subjects.syllabus.approved'], /\{hours\}.*\{pairs\}/);
  }
  // nothing says the deanery uploads or that a file is «загружен» in effect
  for (const key of ['subjects.lead', 'subjects.add.saved', 'syllabus.done', 'syllabus.check.first', 'syllabus.check.replace', 'syllabus.check.failed', 'home.noSyllabus']) {
    assert.doesNotMatch(ru[key], /загружа?ен|загружает деканат/i, key);
  }
});

test('task 17: the list of journals and its menu items have their texts in every language', () => {
  const keys = ['journal.title', 'journal.hint', 'journal.loading', 'nav.journal', 'journal.list.title', 'journal.list.leadTeacher', 'journal.list.leadOffice',
    'journal.list.col.group', 'journal.list.col.subject', 'journal.list.col.teacher', 'journal.list.col.held', 'journal.list.col.unfilled',
    'journal.list.unfilled', 'journal.list.overdue', 'journal.list.filled', 'journal.list.cover', 'journal.list.empty', 'journal.list.allGroups'];
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) for (const key of ['journal.list.unfilled', 'journal.list.overdue']) assert.ok(dict[key].includes('{n}'), key);
  assert.equal(ru['journal.list.empty'], 'Журналов пока нет');
  assert.equal(ru['journal.loading'], 'Журнал загружается');
});

test('task 18: the grid of a journal has its texts in every language', () => {
  const keys = [];
  for (const s of ['present', 'late', 'absent', 'excused', 'madeup']) keys.push('journal.short.' + s, 'journal.legend.' + s);
  for (const k of ['lecture', 'practice', 'control', 'none']) keys.push('journal.kind.' + k);
  for (const k of ['unfilled', 'overdue', 'missed', 'cancelled', 'future', 'running']) keys.push('journal.state.' + k);
  for (const k of ['student', 'unit', 'current', 'self', 'control', 'total', 'outside', 'absences', 'percent', 'preliminary']) keys.push('journal.col.' + k);
  for (const k of ['current', 'self', 'control', 'total', 'manual', 'absences', 'percent', 'preliminary', 'outside', 'activity']) keys.push('journal.tip.' + k);
  for (const k of ['excellent', 'good', 'fair', 'fail']) keys.push('journal.grade.' + k);
  keys.push('journal.legend.title', 'journal.legend.noCoat', 'journal.legend.activity', 'journal.legend.manual', 'journal.scheme', 'journal.noSyllabus', 'journal.partial',
    'journal.left', 'journal.sub', 'journal.topic', 'journal.topicNone', 'journal.teacherLine', 'journal.notFound', 'journal.back', 'journal.emptyPairs', 'journal.emptyStudents');
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    assert.ok(dict['journal.scheme'].includes('{attendance}') && dict['journal.scheme'].includes('{activity}'));
    for (const key of ['journal.tip.current', 'journal.tip.self', 'journal.tip.control', 'journal.tip.total']) assert.ok(dict[key].includes('{max}'), key);
  }
});

test('task 19: the window of the marks of a pair has its texts in every language', () => {
  const keys = ['title', 'when', 'open', 'list', 'kind.none', 'hint', 'allPresent', 'noMark', 'coat', 'activity', 'activityPlaceholder', 'reason.label', 'reason.hint', 'reason.count',
    'unsaved', 'stay', 'discard', 'notBegun', 'termPassed', 'error.reason.required', 'error.reason.too_long', 'error.activity.bad_value', 'error.studentId.bad_ref']
    .map((k) => 'journal.marks.' + k);
  for (const s of ['present', 'late', 'absent', 'excused', 'madeup']) keys.push('journal.marks.status.' + s);
  keys.push('error.too_early', 'error.journal_closed', 'error.no_syllabus', 'error.has_marks', 'error.incomplete', 'error.not_allowed', 'error.locked');
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    for (const p of ['{date}', '{slot}', '{time}']) assert.ok(dict['journal.marks.when'].includes(p), p);
    assert.ok(dict['journal.marks.activityPlaceholder'].includes('{max}'));
    assert.ok(dict['journal.marks.reason.count'].includes('{n}') && dict['journal.marks.reason.count'].includes('{max}'));
  }
  assert.equal(ru['journal.marks.unsaved'], 'Отметки не сохранены. Закрыть?');
  assert.equal(ru['journal.marks.notBegun'], 'Пара ещё не началась');
  assert.equal(ru['journal.marks.termPassed'], 'Срок заполнения прошёл. Обратитесь в деканат');
});

test('task 20: the window of a cell and the history of changes have their texts in every language', () => {
  const keys = ['open', 'current', 'noMark', 'points', 'noPoints', 'readOnly', 'options', 'limited.hint', 'limited.none', 'limited.excused', 'limited.madeup',
    'limited.choose', 'saved', 'history.title', 'history.loading', 'history.empty'].map((k) => 'journal.cell.' + k);
  keys.push('journal.log.late', 'journal.log.reason', 'journal.log.other', 'journal.log.unit', 'journal.log.pair.status');
  for (const k of ['status', 'statusSet', 'noCoatOn', 'noCoatOff', 'activity', 'activitySet', 'cleared']) keys.push('journal.log.mark.' + k);
  for (const k of ['status', 'noCoat', 'activity', 'control', 'self', 'current']) keys.push('journal.log.field.' + k);
  for (const k of ['planned', 'running', 'closed', 'missed', 'cancelled']) keys.push('journal.log.pairStatus.' + k);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    assert.ok(dict['journal.cell.points'].includes('{earned}') && dict['journal.cell.points'].includes('{possible}'));
    assert.ok(dict['journal.cell.open'].includes('{name}') && dict['journal.cell.open'].includes('{date}'));
    assert.ok(dict['journal.log.reason'].includes('{reason}'));
    assert.ok(dict['journal.log.unit'].includes('{what}') && dict['journal.log.unit'].includes('{unit}'));
    for (const k of ['status', 'activity']) assert.ok(dict['journal.log.mark.' + k].includes('{before}') && dict['journal.log.mark.' + k].includes('{after}'));
  }
});

test('task 21: the windows of the results of a unit have their texts in every language', () => {
  const keys = ['title.control', 'title.self', 'title.current', 'hint', 'of', 'notSet', 'low', 'error.bad', 'reasonHint.change', 'reasonHint.office', 'reasonHint.current',
    'unsaved', 'stay', 'discard', 'open.control', 'open.self', 'open.current', 'calc.label', 'calc.value', 'calc.none', 'manual.now', 'manual.label', 'manual.hint',
    'reset', 'manual.none'].map((k) => 'journal.unit.' + k);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    for (const k of ['title.control', 'title.self', 'title.current']) assert.ok(dict['journal.unit.' + k].includes('{n}'));
    for (const k of ['hint', 'of', 'error.bad', 'manual.hint']) assert.ok(dict['journal.unit.' + k].includes('{max}'));
    for (const p of ['{auto}', '{max}', '{earned}', '{possible}']) assert.ok(dict['journal.unit.calc.value'].includes(p));
    assert.ok(dict['journal.unit.open.current'].includes('{name}'));
  }
});

test('task 22: the deanery actions on a pair have their texts in every language', () => {
  const keys = ['menu', 'miss', 'reopen', 'clear', 'miss.title', 'miss.note', 'reopen.title', 'reopen.note', 'clear.title', 'clear.note', 'miss.go', 'reopen.go', 'clear.go', 'reason.hint']
    .map((k) => 'journal.action.' + k);
  keys.push('error.pair_locked', 'error.too_early', 'error.has_marks');
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) assert.ok(dict['journal.action.menu'].includes('{date}'));
  assert.equal(ru['journal.action.miss'], 'Не проведена');
});

test('task 23: the change log screen has its texts in every language', () => {
  const keys = ['title', 'hint', 'lead', 'leadSubject', 'from', 'to', 'group', 'subject', 'allGroups', 'allSubjects', 'last30', 'empty', 'emptyHint', 'more',
    'col.when', 'col.who', 'col.subject', 'col.student', 'col.pair', 'col.change', 'col.reason', 'pairWhen', 'link', 'back'].map((k) => 'journalLog.' + k);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) assert.ok(dict['journalLog.pairWhen'].includes('{date}') && dict['journalLog.pairWhen'].includes('{slot}'));
  assert.equal(ru['journalLog.title'], 'Журнал изменений');
});

test('task 24: the scoring card of the settings has its texts in every language', () => {
  const keys = ['title', 'hint', 'example', 'warning', 'reset', 'saved']
    .concat(['attendance', 'activity', 'current', 'self', 'control', 'minimum', 'fair', 'good', 'excellent', 'editDays'].map((k) => 'field.' + k))
    .concat(['pair', 'unit', 'grades', 'edit'].map((k) => 'group.' + k))
    .concat(['sum', 'order', 'too_big', 'bad_value'].map((k) => 'error.' + k))
    .map((k) => 'scoring.' + k);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    for (const p of ['{pair}', '{first}', '{current}', '{self}', '{control}', '{total}']) assert.ok(dict['scoring.example'].includes(p), p);
    assert.ok(dict['scoring.error.bad_value'].includes('{min}') && dict['scoring.error.bad_value'].includes('{max}'));
  }
  assert.equal(ru['scoring.title'], 'Баллы и журнал');
});

test('task 25: the course and semester check has its texts in every language', () => {
  const keys = ['sform.checks.title.planSemester.course_semester', 'sform.checks.title.group_course', 'syllabus.error.course_semester', 'syllabus.warning.semester_by_course'];
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    for (const p of ['{course}', '{a}', '{b}']) assert.ok(dict[keys[0]].includes(p), p);
    assert.ok(dict[keys[1]].includes('{groups}'));
    for (const p of ['{course}', '{semester}', '{plan}']) assert.ok(dict[keys[3]].includes(p), p);
  }
});

test('the student grades screen: its keys exist in all three dictionaries; the old placeholder is gone', () => {
  for (const key of ['grades.title', 'grades.unit.full', 'grades.unit.part.current', 'grades.unit.part.self', 'grades.unit.part.control', 'grades.unit.empty', 'grades.points', 'grades.notCounted', 'grades.notFound', 'grades.back', 'grades.how.title', 'home.gradesLead']) {
    for (const dict of [ru, ky, en]) assert.ok(dict[key], key);
  }
  for (const dict of [ru, ky, en]) assert.equal('home.gradesSoon' in dict, false);
});

test('the pair screen and the list of today: their keys exist in all three dictionaries, with the same placeholders', () => {
  const keys = [...Object.keys(ru).filter((key) => key.startsWith('lesson.') || key.startsWith('home.lessons.')), 'error.start_early', 'error.start_late'];
  assert.ok(keys.length > 30);
  const holders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of keys) {
    for (const dict of [ru, ky, en]) assert.ok(dict[key], key);
    assert.equal(holders(ky[key]), holders(ru[key]), 'ky ' + key);
    assert.equal(holders(en[key]), holders(ru[key]), 'en ' + key);
  }
  assert.equal(ru['lesson.end.ask'], 'Закончить отметку? Кто не отметился, получит «не был».');
  assert.equal(ru['lesson.unsaved'], 'Правки не сохранены. Сохранить?');
  assert.equal(ru['lesson.finish.ask'], 'Завершить пару? Отметки можно будет поправить в журнале по обычным правилам.');
  assert.equal(ru['lesson.done.empty'], 'Отметок нет — пара осталась незаполненной');
  for (const dict of [ru, ky, en]) assert.equal('lesson.soon' in dict, false);
});

test('the student check-in: its keys exist in all three dictionaries, with the same placeholders', () => {
  const keys = [...Object.keys(ru).filter((key) => key.startsWith('checkin.')), 'error.code_expired', 'error.too_many_codes', 'error.device_used', 'error.window_closed', 'error.not_running', 'error.bad_pass', 'error.bad_code'];
  assert.ok(keys.length > 15);
  const holders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of keys) {
    for (const dict of [ru, ky, en]) assert.ok(dict[key], key);
    assert.equal(holders(ky[key]), holders(ru[key]), 'ky ' + key);
    assert.equal(holders(en[key]), holders(ru[key]), 'en ' + key);
  }
});

const WORK_CHECK_KEYS = ['work.state.checkedPoints', 'work.filter.all', 'work.filter.wait', 'work.filter.none', 'work.students', 'work.left', 'work.max', 'work.edit', 'work.back', 'work.attempt', 'work.sentAt', 'work.paper', 'work.noText', 'work.files', 'work.file.open', 'work.file.download', 'work.file.loading', 'work.file.broken', 'work.grade.title', 'work.grade.points', 'work.grade.comment', 'work.grade.reason', 'work.grade.reasonHint', 'work.grade.check', 'work.grade.return', 'work.grade.returnHint', 'work.grade.next', 'work.grade.nextNone', 'work.grade.saved', 'work.grade.attemptChanged', 'work.grade.paper', 'work.grade.paperHint', 'work.grade.checkedBy', 'work.grade.given', 'work.prev', 'work.unsaved.title', 'work.unsaved.save', 'work.unsaved.discard', 'work.noStudents', 'work.noneShown'];

test('the assignments screens and the codes of the work answers have texts in all three languages', () => {
  const codes = ['bad_value', 'bad_ref', 'empty', 'too_long', 'due_past', 'too_far', 'below_points', 'locked', 'bad_type', 'bad_file', 'too_big', 'too_many', 'self_by_work', 'required'];
  const keys = [
    'error.in_use', 'error.files_unavailable', 'error.already_checked', 'error.upload_limit', 'error.file_missing', 'error.nothing_to_return', 'error.attempt_changed',
    ...codes.map((code) => 'work.form.error.' + code),
    'tasks.title', 'tasks.new', 'work.give', 'work.given', 'work.size.kb', 'work.size.mb', 'work.due.overdue', 'work.due.today', 'work.due.tomorrow', 'work.due.date',
    'work.state.none', 'work.state.submitted', 'work.state.checked', 'work.state.returned', 'work.state.late', 'work.kind.hw', 'work.kind.srs', 'work.form.unsaved',
    ...WORK_CHECK_KEYS,
  ];
  for (const [lang, dict] of [['ru', ru], ['ky', ky], ['en', en]]) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) assert.ok(dict['work.due.today'].includes('{time}') && dict['work.due.date'].includes('{date}'));
});

test('the screens of the student for the assignments have texts in all three languages, with the same parameters', () => {
  const mine = (dict) => Object.keys(dict).filter((key) => /^work\.(home|mine|pick)\./.test(key) || key.startsWith('work.upload.error.') || key.startsWith('work.submit.error.'));
  const keys = mine(ru);
  for (const key of ['work.home.fresh', 'work.home.soon', 'work.home.overdue', 'work.home.returned', 'work.home.none', 'work.home.all', 'work.mine.title', 'work.mine.submit', 'work.mine.resubmit',
    'work.mine.submitted', 'work.mine.late', 'work.pick.badType', 'work.pick.tooBig', 'work.pick.tooMany', 'work.upload.error.photo_unreadable', 'work.upload.error.network']) assert.ok(keys.includes(key), key);
  for (const code of ['bad_type', 'bad_file', 'too_big', 'too_many', 'empty', 'upload_limit', 'photo_unreadable', 'already_checked', 'files_unavailable', 'network']) assert.ok(ru['work.upload.error.' + code], code);
  for (const [lang, dict] of [['ky', ky], ['en', en]]) {
    assert.deepEqual(mine(dict).sort(), [...keys].sort(), lang);
    for (const key of keys) assert.deepEqual(ru[key].match(/\{\w+\}/g)?.sort(), dict[key].match(/\{\w+\}/g)?.sort(), lang + ' ' + key);
  }
  assert.equal(ru['work.pick.badType'], 'Такой файл не принимается: фото, PDF, Word, Excel, PowerPoint');
  assert.equal(ru['work.upload.error.bad_file'], 'Файл не похож на свой тип или повреждён');
});

test('unit 6 task 9: the new scale texts exist in every language and carry the numbers only as placeholders', () => {
  const keys = ['journal.tip.semesterSoFar', 'journal.tip.admitted', 'journal.tip.notAdmitted', 'grades.semester', 'grades.semesterSoFar', 'grades.admitted', 'grades.notAdmitted',
    'scoring.group.final', 'scoring.field.semester', 'scoring.field.exam', 'scoring.field.admission', 'scoring.example.final', 'scoring.error.split.sum', 'scoring.error.split.too_big',
    'error.units_closed', 'error.final_closed'];
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    for (const key of keys) {
      assert.ok(dict[key], lang + ' ' + key);
      assert.ok(!/(^|\D)(60|40|30|80)(\D|$)/.test(dict[key]), lang + ' ' + key + ' has a regulation number');
    }
    for (const p of ['{semester}', '{exam}', '{need}', '{fair}', '{good}', '{excellent}']) assert.ok(dict['scoring.example.final'].includes(p), lang + ' ' + p);
    for (const p of ['{value}', '{max}', '{need}']) assert.ok(dict['grades.notAdmitted'].includes(p), lang + ' ' + p);
    assert.ok(!('grades.preliminary' in dict), lang + ' grades.preliminary is gone');
  }
});

test('unit 6 task 18: the ledger screens have their texts in every language', () => {
  const keys = ['title', 'hint', 'loading', 'back', 'notFound', 'noSyllabus', 'emptyStudents', 'leadSemester', 'link.journal', 'low', 'draft', 'left', 'manual', 'selfPending',
    'list.leadTeacher', 'list.leadOffice', 'list.empty', 'list.allGroups', 'list.search', 'list.noMatch', 'list.noSyllabus',
    'list.col.subject', 'list.col.group', 'list.col.teacher', 'list.col.units',
    'state.unitClosed', 'state.unitOpen', 'state.finalClosed', 'state.finalOpen', 'exam.now', 'exam.from', 'exam.absent', 'exam.incomplete', 'exam.incompleteTip',
    'col.student', 'col.semester', 'col.admission', 'col.exam', 'col.final', 'col.word', 'unit.head', 'unit.headPlain', 'unit.closed', 'unit.open', 'unit.closedAt',
    'block.pairs_not_held', 'block.self_pending', 'missing', 'counts.label', 'count.absent', 'count.incomplete', 'count.notAdmitted', 'menu',
    'close.button', 'close.title', 'close.body', 'close.missing', 'close.accept', 'close.confirm', 'close.busy', 'close.needAccept',
    'reopen.item', 'reopen.title.unit', 'reopen.title.final', 'reopen.body.unit', 'reopen.body.final', 'reopen.reason', 'reopen.reasonHint', 'reopen.confirm', 'reopen.busy',
    'final.stateClosed', 'final.stateOpen', 'final.notAdmitted', 'final.absent', 'final.incomplete', 'admission.yes', 'admission.noUnit', 'admission.low']
    .map((k) => 'ledger.' + k);
  keys.push('error.unit_closed', 'error.already_closed', 'error.not_closed', 'error.exam_not_started');
  for (const [lang, dict] of Object.entries({ ru, ky, en })) for (const key of keys) assert.ok(dict[key], lang + ' ' + key);
  for (const dict of [ru, ky, en]) {
    assert.ok(dict['ledger.admission.low'].includes('{need}'));
    for (const key of ['ledger.col.semester', 'ledger.col.exam', 'ledger.col.final']) assert.ok(dict[key].includes('{max}'), key);
    assert.ok(dict['ledger.low'].includes('{min}'));
  }
});

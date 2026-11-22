import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSyllabus, MAX_SHEET_ROWS, HOURS_ALLOWED, DESCRIPTION_MAX, SYLLABUS_SHEETS, INFO_ROWS, PLAN_COLUMNS, KIND_WORDS,
} from '../core/syllabusFile.js';
import { HOURS_PER_PAIR } from '../core/topics.js';
import { docLessons } from '../core/syllabusPlan.js';

const INFO = [['Дисциплина', 'Информатика'], ['Преподаватель', 'Teacher One'], ['Курс', 1], ['Семестр', 1], ['Специальность', 'Сестринское дело'],
  ['Кредиты', 2], ['Всего часов', 60], ['Аудиторных часов', 36], ['СРС, часов', 24]];
const HEAD = ['Юнит', '№', 'Тема', 'Лекция, ч (1 пара = 2 ч)', 'Практика, ч (1 пара = 2 ч)', 'Вид занятия', 'СРС, ч', 'Описание'];
const NAMES = ['Цифровой пост медсестры: введение в IT', 'Рабочие программы: Windows, МИС и утилиты', 'Защита данных: врачебная тайна и кибергигиена',
  'Медицинский поиск: справочники и инструкции', 'Телемедицина и «умные» гаджеты в практике', 'Работа в МИС: электронная карта и регистратура',
  'Аппаратное обеспечение: ПК и периферия', 'Медицинский документооборот в Word и Excel', 'Файловая дисциплина: порядок на рабочем столе',
  'Электронные таблицы: учёт лекарств и расчёт доз'];
const REST = [['', '', 2], [2, '', 4], [2, 'семинар', 2], [2, '', 2], ['', '', 2], [2, '', 2], [2, 'лабораторная', 2], [2, '', 4], [2, '', 2], [2, '', 2]];
const topicRow = (i) => [i < 5 ? 1 : 2, (i < 5 ? '1.' : '2.') + ((i % 5) + 1), NAMES[i], 2, ...REST[i], i === 8 ? '' : 'Описание ' + (i + 1)];
const moduleRow = (unit) => [unit, '', `Модуль ${unit} (рубежный контроль)`, '', '', 'модуль', '', ''];
const PLAN = [HEAD, ...[0, 1, 2, 3, 4].map(topicRow), moduleRow(1), ...[5, 6, 7, 8, 9].map(topicRow), moduleRow(2)];
const book = (info = INFO, plan = PLAN) => [{ name: 'Сведения', cells: info }, { name: 'Тематический план', cells: plan }];
const SHORT = ['Юнит', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия'];
const one = (rows, info = [['Семестр', 1]]) => parseSyllabus(book(info, [SHORT, ...rows]));
const codes = (r) => r.errors.map((e) => [e.sheet, e.row, e.field, e.code]);
const EMPTY_INFO = { code: 'info_empty', fields: ['audience', 'credits', 'totalHours', 'classHours', 'selfHours'] };

test('the sample file is read whole and without warnings', () => {
  const ok = parseSyllabus(book());
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  assert.deepEqual(ok.found, { info: 'Сведения', plan: 'Тематический план' });
  assert.deepEqual(ok.doc.info, { discipline: 'Информатика', teacher: 'Teacher One', semester: 1, course: 1, audience: 'Сестринское дело', credits: 2, totalHours: 60, classHours: 36, selfHours: 24 });
  assert.deepEqual(ok.doc.rows.map((r) => (r.kind === 'control' ? 'M' + r.unit : r.label)), ['1.1', '1.2', '1.3', '1.4', '1.5', 'M1', '2.1', '2.2', '2.3', '2.4', '2.5', 'M2']);
  assert.deepEqual(ok.doc.rows[2], { kind: 'topic', semester: 1, unit: 1, unitTitle: '', label: '1.3', name: NAMES[2], lectureHours: 2, practiceHours: 2, practiceKind: 'seminar', selfHours: 2, description: 'Описание 3', row: 4 });
  assert.deepEqual(ok.doc.rows[5], { kind: 'control', semester: 1, unit: 1, unitTitle: '', label: '', name: 'Модуль 1 (рубежный контроль)', lectureHours: 0, practiceHours: 0, practiceKind: '', selfHours: null, description: '', row: 7 });
  assert.deepEqual([ok.doc.rows[7].practiceKind, ok.doc.rows[9].description], ['lab', '']);
  const sum = (key) => ok.doc.rows.reduce((n, r) => n + (r[key] ?? 0), 0);
  assert.deepEqual([sum('lectureHours'), sum('practiceHours'), sum('selfHours')], [20, 16, 24]);
});

test('families of real syllabi', () => {
  const mixed = one([['', 'Л1', 'Право', 2, '', ''], ['', 'Л2', 'Право', 2, '', 'Лекция №2'], ['', 'С1', 'Право', '', 2, 'Семинар №1'], ['', 'ПЗ1', 'Документы', '', 4, '']]);
  assert.deepEqual(mixed.errors, []);
  assert.deepEqual(mixed.doc.rows.map((r) => [r.unit, r.label, r.lectureHours, r.practiceHours, r.practiceKind]),
    [[1, 'Л1', 2, 0, ''], [1, 'Л2', 2, 0, ''], [1, 'С1', 0, 2, 'seminar'], [1, 'ПЗ1', 0, 4, '']]);
  assert.deepEqual(mixed.warnings, [EMPTY_INFO, { code: 'no_control', count: 1 }]);

  const lang = one([[1, '', 'Тема 1', '', 2, ''], ['', '', 'Тема 2', '', 2, ''], ['', '', '', '', 2, 'Модуль'], [2, '', 'Тема 3', '', 2, ''], ['', '', 'Сдача модуля', '', '', 'Рубежный контроль']]);
  assert.deepEqual(lang.errors, []);
  assert.deepEqual(lang.doc.rows.map((r) => [r.unit, r.kind, r.practiceHours]), [[1, 'topic', 2], [1, 'topic', 2], [1, 'control', 2], [2, 'topic', 2], [2, 'control', 0]]);
  assert.deepEqual(lang.warnings, [EMPTY_INFO]);
});

test('sheets in another order, extra sheet, English titles, numbers as text', () => {
  const en = parseSyllabus([{ name: 'Лист1', cells: [['x']] },
    { name: 'thematic plan', cells: [['Unit', 'Topic', 'Lecture', 'Practice', 'Description'], ['1', 'Intro', ' 2 ', '', 'About\nthe course']] },
    { name: 'Details', cells: [['Semester:', '4']] }]);
  assert.deepEqual([en.errors, en.doc.info.semester, en.doc.info.credits, en.doc.rows[0].semester, en.doc.rows[0].description], [[], 4, null, 4, 'About\nthe course']);
  assert.deepEqual(en.warnings[0], { code: 'ignored_sheets', titles: ['Лист1'] });
});

test('semesters', () => {
  const TWO = ['Семестр', ...SHORT];
  const year = parseSyllabus(book([['Семестр', '1-2']], [TWO, [1, '', '', 'А', 2, '', ''], [2, '', '', 'Б', 2, '', '']]));
  assert.deepEqual([year.errors, year.doc.info.semester, year.doc.rows.map((r) => [r.semester, r.unit])], [[], null, [[1, 1], [2, 1]]]);
  assert.equal(one([['', '', 'А', 2, '', '']], [['Семестр', 3]]).doc.rows[0].semester, 3);
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', '1-2']], [SHORT, ['', '', 'А', 2, '', '']]))), [['plan', 2, 'semester', 'required']]);
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', 9]]))), [['info', 1, 'semester', 'bad_value']]);
  assert.deepEqual(codes(parseSyllabus(book([], [TWO, [2, '', '', 'А', 2, '', ''], [1, '', '', 'Б', 2, '', '']]))), [['plan', 3, 'semester', 'semester_order']]);
  assert.deepEqual(codes(parseSyllabus(book([], [TWO, [1, '', '', 'А', 2, '', ''], [3, '', '', 'Б', 2, '', '']]))), [['plan', 0, 'semester', 'semester_clash']]);
});

test('errors of plan rows', () => {
  assert.deepEqual(codes(one([[1, '', 'А', 3, '', '']])), [['plan', 2, 'lectureHours', 'bad_hours']]);
  assert.deepEqual(codes(one([[1, '', 'А', 6, 9, '']])), [['plan', 2, 'lectureHours', 'bad_hours'], ['plan', 2, 'practiceHours', 'bad_hours']]);
  assert.deepEqual(codes(one([[1, '', 'А', '', '', '']])), [['plan', 2, 'lectureHours', 'no_hours']]);
  assert.deepEqual(codes(one([[1, '', 'А', 0, '0', '']])), [['plan', 2, 'lectureHours', 'no_hours']]);
  assert.deepEqual(codes(one([[1, '', '', 2, '', '']])), [['plan', 2, 'name', 'required']]);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', 'коллоквиум']])), [['plan', 2, 'practiceKind', 'bad_value']]);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', 'семинар']])), [['plan', 2, 'practiceKind', 'kind_needs_practice']]);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', ''], [1, '', 'Модуль', 2, '', 'модуль']])), [['plan', 3, 'lectureHours', 'bad_value']]);
  assert.deepEqual(codes(one([[2, '', 'А', 2, '', ''], [1, '', 'Б', 2, '', '']])), [['plan', 3, 'unit', 'unit_order']]);
  assert.deepEqual(codes(one([[0, '', 'А', 2, '', ''], [1, 'x'.repeat(21), 'Б', 2, '', ''], [1, '', 'x'.repeat(201), 2, '', ''], [1, '', 'Г', 2.5, 'два', '']])),
    [['plan', 2, 'unit', 'bad_value'], ['plan', 3, 'label', 'too_long'], ['plan', 4, 'name', 'too_long'], ['plan', 5, 'lectureHours', 'bad_hours'], ['plan', 5, 'practiceHours', 'bad_hours']]);
  assert.deepEqual(codes(one([])), [['plan', 0, '', 'empty']]);
  assert.deepEqual(codes(one([[1, '', 'Сдача модуля', '', 2, 'модуль']])), [['plan', 0, '', 'empty']]);
  assert.equal(one([[1, '', 'А', 3, '', '']]).doc, null);
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', 1]], [SHORT, ...Array.from({ length: MAX_SHEET_ROWS }, (_, i) => [1, '', 'Т' + i, 2, '', ''])]))), [['plan', 0, '', 'too_many_rows']]);
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', 1]], [[...SHORT, 'СРС, ч', 'Описание'], [1, '', 'А', 2, '', '', 'много', 'x'.repeat(DESCRIPTION_MAX + 1)]]))),
    [['plan', 2, 'selfHours', 'bad_value'], ['plan', 2, 'description', 'too_long']]);
});

test('sheets and columns', () => {
  const noPlan = parseSyllabus(book().slice(0, 1));
  assert.deepEqual([codes(noPlan), noPlan.found.plan], [[['plan', 0, '', 'missing_sheet']], null]);
  assert.deepEqual(codes(parseSyllabus(book(INFO, [['Юнит', 'Тема', 'Лекция, ч'], [1, 'А', 2]]))), [['plan', 1, 'practiceHours', 'missing_column']]);
  for (const bad of [null, 'x', [{ name: 5, cells: 'x' }], [null]]) {
    assert.deepEqual(codes(parseSyllabus(bad)), [['info', 0, '', 'missing_sheet'], ['plan', 0, '', 'missing_sheet']]);
  }
});

test('info sheet errors', () => {
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', 1], ['Кредиты', 'два'], ['Всего часов', 0]]))), [['info', 2, 'credits', 'bad_value'], ['info', 3, 'totalHours', 'bad_value']]);
});

test('the course of the info sheet: 1-6 or none; another value is a bad value', () => {
  const course = (value) => { const r = parseSyllabus(book([['Семестр', 1], ['Курс', value]])); return [r.errors.map((e) => [e.row, e.field, e.code]), r.doc && r.doc.info.course]; };
  assert.deepEqual([course(1), course(6), course('3'), course(''), course(7), course(0), course('первый')],
    [[[], 1], [[], 6], [[], 3], [[], null], [[[2, 'course', 'bad_value']], null], [[[2, 'course', 'bad_value']], null], [[[2, 'course', 'bad_value']], null]]);
  assert.equal(parseSyllabus(book([['Семестр', 1]])).doc.info.course, null);
});

test('warnings: extra columns, numbers that do not add up, unit without a module', () => {
  const noisy = parseSyllabus(book([['Семестр', 1], ['Кафедра', 'ИТ'], ['Всего часов', 60], ['Аудиторных часов', 36], ['СРС, часов', 20]],
    [[...SHORT, 'СРС, ч', 'Всего', 'Недели'], [1, '', 'А', 2, '', '', 4, 6, '1-2'], [2, '', 'Б', 2, 2, '', '', 4, '3-4'], [2, '', '', '', '', 'модуль', '', '', '']]));
  assert.deepEqual(noisy.errors, []);
  assert.deepEqual(noisy.warnings, [{ code: 'ignored', sheet: 'info', titles: ['Кафедра'] }, { code: 'ignored', sheet: 'plan', titles: ['Всего', 'Недели'] },
    { code: 'info_empty', fields: ['audience', 'credits'] }, { code: 'total_mismatch', total: 60, classHours: 36, selfHours: 20 },
    { code: 'class_mismatch', declared: 36, planned: 6 }, { code: 'self_mismatch', declared: 20, planned: 4 }, { code: 'no_control', count: 1 }]);
});

test('titles in three languages and kind words', () => {
  assert.deepEqual(Object.keys(SYLLABUS_SHEETS), ['info', 'plan']);
  assert.deepEqual(INFO_ROWS.map((r) => r.key), ['discipline', 'teacher', 'course', 'semester', 'audience', 'credits', 'totalHours', 'classHours', 'selfHours']);
  assert.deepEqual(PLAN_COLUMNS.map((c) => c.key), ['semester', 'unit', 'unitTitle', 'label', 'name', 'lectureHours', 'practiceHours', 'practiceKind', 'selfHours', 'description']);
  assert.deepEqual(PLAN_COLUMNS.filter((c) => c.required).map((c) => c.key), ['name', 'lectureHours', 'practiceHours']);
  for (const item of [...Object.values(SYLLABUS_SHEETS), ...INFO_ROWS, ...PLAN_COLUMNS]) for (const lang of ['ru', 'ky', 'en']) assert.ok((item.titles ?? item)[lang], lang);
  assert.deepEqual([KIND_WORDS['семинар'], KIND_WORDS['лабораторная'], KIND_WORDS['модуль'], KIND_WORDS['рубежный контроль'], KIND_WORDS['практика']], ['seminar', 'lab', 'control', 'control', '']);
  assert.equal(one([[1, '', 'А', 2, '', ''], [1, '', 'Итог', '', '', ' Рубежный   контроль №1 ']]).doc.rows[1].kind, 'control');
  assert.deepEqual([HOURS_PER_PAIR, HOURS_ALLOWED], [2, [0, 2, 4]]);
});

test('a missing semester is reported once when every row lacks it', () => {
  const rows50 = Array.from({ length: 50 }, (_, i) => [1, '', 'Т' + i, 2, '', '']);
  const range = parseSyllabus(book([['Семестр', '1-2']], [SHORT, ...rows50]));
  assert.deepEqual(range.errors, [{ sheet: 'plan', row: 2, field: 'semester', code: 'required', count: 50 }]);
  const TWO = ['Семестр', ...SHORT];
  const emptyCol = parseSyllabus(book([['Курс', 1]], [TWO, ...rows50.map((r) => ['', ...r])]));
  // the template's «Семестр» column left empty in every row is no semester: the one error points to «Сведения»
  assert.deepEqual(codes(emptyCol), [['info', 0, 'semester', 'required']]);
  const some = parseSyllabus(book([['Семестр', '1-2']], [TWO, ...rows50.map((r, i) => [i === 9 || i === 19 ? '' : 1, ...r])]));
  assert.deepEqual(codes(some), [['plan', 11, 'semester', 'required'], ['plan', 21, 'semester', 'required']]);
});

test('hardening for real files', () => {
  // 1. trailing blank rows do not count toward MAX_SHEET_ROWS
  const blanks = Array.from({ length: 400 }, () => ['', '', '', '', '', '']);
  const tail = one([[1, '', 'А', 2, '', ''], ...blanks]);
  assert.deepEqual([tail.errors, tail.doc.rows.length], [[], 1]);
  const tailInfo = parseSyllabus(book([['Семестр', 1], ...Array.from({ length: 400 }, () => ['', ''])], [SHORT, [1, '', 'А', 2, '', '']]));
  assert.deepEqual(tailInfo.errors, []);
  const middle = one([[1, '', 'А', 2, '', ''], ['', '', '', '', '', ''], [1, '', 'Б', '', '', '']]);
  assert.deepEqual(codes(middle), [['plan', 4, 'lectureHours', 'no_hours']]);
  // 2. en and em dash in a semester range
  for (const range of ['1–2', '1—2']) {
    const r = parseSyllabus(book([['Семестр', range]], [['Семестр', ...SHORT], [1, '', '', 'А', 2, '', ''], [2, '', '', 'Б', 2, '', '']]));
    assert.deepEqual([r.errors, r.doc.info.semester], [[], null]);
  }
  // 3. a control row has 0 or 2 practice hours only
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', ''], [1, '', '', '', 4, 'модуль']])), [['plan', 3, 'practiceHours', 'bad_hours']]);
  assert.deepEqual(one([[1, '', 'А', 2, '', ''], [1, '', '', '', 2, 'модуль']]).errors, []);
  // 4. hour spellings
  for (const spelled of ['2 ч', '2ч', '2 ч.', '2,0', '2.0', ' 2 Ч ']) assert.equal(one([[1, '', 'А', spelled, '', '']]).doc.rows[0].lectureHours, 2, spelled);
  for (const spelled of ['4 ч', '4,0', '4.0']) assert.equal(one([[1, '', 'А', '', spelled, '']]).doc.rows[0].practiceHours, 4, spelled);
  for (const spelled of ['3', '2,5', 'два', '2 дня', '-2']) assert.deepEqual(codes(one([[1, '', 'А', spelled, '', '']])), [['plan', 2, 'lectureHours', 'bad_hours']], spelled);
  // 5. one error for a missing semester, not one per row
  const lots = Array.from({ length: 50 }, (_, i) => [1, '', 'Т' + i, 2, '', '']);
  assert.deepEqual(codes(parseSyllabus(book([['Курс', 1]], [SHORT, ...lots]))), [['info', 0, 'semester', 'required']]);
  assert.deepEqual(codes(parseSyllabus(book([['Курс', 1], ['Семестр', '']], [SHORT, ...lots]))), [['info', 2, 'semester', 'required']]);
  // 6. two semesters must lie in one academic year
  for (const pair of [[2, 3], [1, 4]]) {
    const r = parseSyllabus(book([], [['Семестр', ...SHORT], [pair[0], 1, '', 'А', 2, '', ''], [pair[1], 1, '', 'Б', 2, '', '']]));
    assert.deepEqual(codes(r), [['plan', 0, 'semester', 'semester_clash']], pair.join());
  }
  assert.deepEqual(parseSyllabus(book([], [['Семестр', ...SHORT], [3, 1, '', 'А', 2, '', ''], [4, 1, '', 'Б', 2, '', '']])).errors, []);
});

// ---- Final fix wave: the wording of real syllabi ----

const semesterOf = (value) => parseSyllabus(book([['Семестр', value]], [SHORT, ['', '', 'А', 2, '', '']]));
const yearOf = (value) => parseSyllabus(book([['Семестр', value]], [['Семестр', ...SHORT], [1, '', '', 'А', 2, '', ''], [2, '', '', 'Б', 2, '', '']]));

test('the semester as real title pages write it: a number followed by words, a range', () => {     // I2
  for (const [value, n] of [[3, 3], ['3', 3], [' 3 ', 3], ['3 семестр', 3], ['3-семестр', 3], ['3 - семестр', 3], ['3-й', 3], ['3-й семестр', 3], ['3 й семестр', 3],
    ['4 (Весенний)', 4], ['4 (весенний семестр)', 4], ['1 курс 1 семестр', 1], ['2 курс, 3 семестр', 3], ['1-курс 2-семестр', 2], ['1-семестр', 1], ['Семестр 5', 5], ['5 СЕМЕСТР', 5], ['2nd semester', 2]]) {
    const r = semesterOf(value);
    assert.deepEqual([r.errors, r.doc && r.doc.rows[0].semester], [[], n], JSON.stringify(value));
  }
  for (const value of ['1-2', '1–2', '1 и 2', '1, 2', '1,2', '3-4 семестр', '1 и 2 семестры']) {
    const r = yearOf(value);
    assert.deepEqual([r.errors, r.doc && r.doc.info.semester, r.doc && r.doc.rows.map((row) => row.semester)], [[], null, [1, 2]], JSON.stringify(value));
  }
  for (const value of [0, 9, '0', '9 семестр', 'III', 'осенний', '1 курс', '3.5', 2.5, 1.2, 'семестр', '3 семестр 4', '1-9', '3 (весенний', 'два']) {
    assert.deepEqual(codes(semesterOf(value)), [['info', 1, 'semester', 'bad_value']], JSON.stringify(value));
  }
});

test('the semester column of the plan takes the same single forms, not a range', () => {         // I2
  const column = (value) => parseSyllabus(book([['Кредиты', 2]], [['Семестр', ...SHORT], [value, '', '', 'А', 2, '', '']]));
  for (const [value, n] of [[1, 1], ['2', 2], ['1 семестр', 1], ['3-й', 3], ['1-семестр', 1], ['4 (весенний)', 4]]) {
    const r = column(value);
    assert.deepEqual([r.errors, r.doc && r.doc.rows[0].semester], [[], n], JSON.stringify(value));
  }
  for (const value of ['1-2', 'I', 9, 'осень']) assert.deepEqual(codes(column(value)), [['plan', 2, 'semester', 'bad_value']], JSON.stringify(value));
});

test('«Итого» rows are skipped and named in the remark, not read as a topic', () => {                  // M1
  const totals = one([[1, '', 'А', 2, 2, ''], [1, '', 'Б', 2, 2, ''], ['', '', 'Итого', 4, 4, '']]);
  assert.deepEqual(totals.errors, []);
  assert.deepEqual(totals.doc.rows.map((r) => r.name), ['А', 'Б']);
  assert.equal(totals.doc.rows.reduce((n, r) => n + (r.lectureHours + r.practiceHours) / HOURS_PER_PAIR, 0), 4);
  assert.deepEqual(totals.warnings[0], { code: 'ignored', sheet: 'plan', titles: ['Итого'] });
  // a totals row has no «№» and no «Вид занятия»; «итого» / «всего» may be followed by anything (N4) ...
  const skipped = (name) => {
    const r = one([[1, '', 'А', 2, '', ''], ['', '', name, 2, '', '']]);
    return r.errors.length === 0 && r.doc.rows.length === 1 && r.warnings.some((w) => w.code === 'ignored' && w.titles.includes(name.trim()));
  };
  for (const name of ['ИТОГО:', ' Всего ', 'Итого  часов', 'Итого по курсу', 'Всего за семестр', 'Итого 36', 'Итого:', 'ИТОГО ЧАСОВ:', 'Всего по юниту 1',
    'Итого: 36 ч', 'Всего понемногу']) assert.equal(skipped(name), true, name);
  // ... «жалпы», «жыйынтыгы», «итог», «total» only alone or with numbers, a colon or a dash and words of hours (R2-1)
  for (const name of ['Жалпы', 'Жалпы: 36', 'Жалпы саат: 36', 'жалпы саат:', 'Жалпы — 36 саат', 'жыйынтыгы:', 'Жыйынтыгы 36 ч', 'Итог', 'Итог: 36 часов',
    'Total', 'Total:', 'Total: 36 h', 'Total hours: 36']) assert.equal(skipped(name), true, name);
  // everything else is a topic, and so is every row with a «№»
  const kept = (label, name) => {
    const r = one([[1, '1.1', 'А', 2, '', ''], [1, label, name, 2, '', '']]);
    return [r.errors, r.doc && r.doc.rows.map((row) => row.name), r.warnings.filter((w) => w.code === 'ignored')];
  };
  for (const name of ['Жалпы маалымат', 'Жалпы патология', 'Жалпы анатомия', 'Жалпы түшүнүктөр', 'Итог курса: защита проектов', 'Total quality management',
    'Итоговое занятие', 'Итоговое тестирование', 'Итоги года', 'Всеобщая история', 'Totally new', 'Жалпылоо']) {
    assert.deepEqual(kept('', name), [[], ['А', name], []], name);
  }
  for (const [label, name] of [['1.2', 'Жалпы маалымат'], ['5', 'Итого по курсу'], ['1', 'Всего понемногу'], ['3', 'Итог'], ['Л2', 'Total']]) {
    assert.deepEqual(kept(label, name), [[], ['А', name], []], label + ' ' + name);
  }
  // a kept «Жалпы маалымат» takes its pairs in its place: nothing after it shifts
  const general = one([[1, '1.1', 'Введение', 2, '', ''], [1, '1.2', 'Жалпы маалымат', 2, 2, ''], [1, '1.3', 'Сети', 2, '', '']]);
  assert.deepEqual(docLessons(general.doc)[0].rows.map((l) => l.name + ' ' + l.lessonKind), ['Введение lecture', 'Жалпы маалымат lecture', 'Жалпы маалымат practice', 'Сети lecture']);
});

test('class type: more spellings; an unknown word and a kind without practice hours have their own codes', () => {   // M2
  for (const [word, kind] of [['Лабораторная работа', 'lab'], ['лабораторное занятие', 'lab'], ['Практическое занятие №2', ''], ['Семинарское занятие', 'seminar'],
    ['практикалык сабак', ''], ['Лабораториялык иш', 'lab']]) {
    assert.deepEqual(one([[1, '', 'А', '', 2, word]]).doc.rows[0].practiceKind, kind, word);
  }
  for (const word of ['Контрольная работа', 'Итоговое занятие']) assert.equal(one([[1, '', 'А', 2, '', ''], [1, '', 'Тест', '', '', word]]).doc.rows[1].kind, 'control', word);
  assert.deepEqual(codes(one([[1, '', 'А', '', 2, 'коллоквиум']])), [['plan', 2, 'practiceKind', 'bad_value']]);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', 'семинар']])), [['plan', 2, 'practiceKind', 'kind_needs_practice']]);
});

test('hours written with a word', () => {                                                              // M3
  for (const spelled of ['2 часа', '2 час.', '2 час', '2 саат', '2 h', '2h', '2 hours', '2 ч.']) assert.equal(one([[1, '', 'А', spelled, '', '']]).doc.rows[0].lectureHours, 2, spelled);
  for (const spelled of ['4 часа', '4 саат', '4 hours']) assert.equal(one([[1, '', 'А', '', spelled, '']]).doc.rows[0].practiceHours, 4, spelled);
  for (const spelled of ['3 часа', '2,5 часа', 'два часа', '2 дня']) assert.deepEqual(codes(one([[1, '', 'А', spelled, '', '']])), [['plan', 2, 'lectureHours', 'bad_hours']], spelled);
});

test('unit titles: the first title of a unit names every row of it; a second one is a remark', () => {   // R3
  const HEAD_T = ['Юнит', 'Название юнита', 'Тема', 'Лекция, ч', 'Практика, ч'];
  const r = parseSyllabus(book([['Семестр', 1]], [HEAD_T, [1, 'Техническое и программное обеспечение', 'А', 2, ''], [1, '', 'Б', 2, ''],
    [2, '', 'В', 2, ''], [2, 'Сети', 'Г', 2, ''], [2, 'Другое', 'Д', 2, ''], [3, '', 'Е', 2, '']]));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.doc.rows.map((row) => [row.unit, row.unitTitle]),
    [[1, 'Техническое и программное обеспечение'], [1, 'Техническое и программное обеспечение'], [2, 'Сети'], [2, 'Сети'], [2, 'Сети'], [3, '']]);
  assert.deepEqual(r.warnings.find((w) => w.code === 'unit_title_differs'), { code: 'unit_title_differs', row: 6, unit: 2, title: 'Сети', other: 'Другое' });
  // other names of the column, three languages; no column — no titles
  for (const title of ['Название юнита', 'Юниттин аталышы', 'Unit title', 'Название раздела']) {
    assert.equal(parseSyllabus(book([['Семестр', 1]], [['Юнит', title, 'Тема', 'Лекция, ч', 'Практика, ч'], [1, 'X', 'А', 2, '']])).doc.rows[0].unitTitle, 'X', title);
  }
  assert.equal(one([[1, '', 'А', 2, '', '']]).doc.rows[0].unitTitle, '');
  assert.deepEqual(codes(parseSyllabus(book([['Семестр', 1]], [HEAD_T, [1, 'x'.repeat(201), 'А', 2, '']]))), [['plan', 2, 'unitTitle', 'too_long']]);
});

test('the word of the class type agrees with the column of its hours', () => {                         // final M5
  assert.deepEqual(codes(one([[1, 'Л1', 'А', '', 2, 'лекция']])), [['plan', 2, 'practiceKind', 'kind_is_lecture']]);
  assert.deepEqual(codes(one([[1, 'Л1', 'А', 2, 2, 'Лекция']])), [['plan', 2, 'practiceKind', 'kind_is_lecture']]);
  assert.deepEqual(codes(one([[1, 'П1', 'А', 2, '', 'практика']])), [['plan', 2, 'practiceKind', 'kind_is_practice']]);
  assert.deepEqual(codes(one([[1, 'П1', 'А', 2, '', 'практикалык сабак']])), [['plan', 2, 'practiceKind', 'kind_is_practice']]);
  // agreeing words, and a lecture with a practice under «практика» (as with a seminar), are read
  for (const row of [[1, '', 'А', 2, '', 'лекция'], [1, '', 'А', '', 2, 'практика'], [1, '', 'А', 2, 2, 'практика'], [1, '', 'А', 2, '', 'теория']]) {
    assert.deepEqual(codes(one([row])), [], row.join('|'));
  }
});

test('a module without hours first in its unit is an error of the row; with hours, or after a topic, it is read', () => {      // final M2
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', ''], [2, '', '', '', '', 'модуль'], [2, '', 'Б', 2, '', '']])), [['plan', 3, 'practiceKind', 'control_first']]);
  assert.deepEqual(codes(one([[1, '', 'М', '', '', 'аралык көзөмөл'], [1, '', 'А', 2, '', '']])), [['plan', 2, 'practiceKind', 'control_first']]);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', ''], [2, '', 'М', '', 2, 'модуль'], [2, '', 'Б', 2, '', '']])), []);
  assert.deepEqual(codes(one([[1, '', 'А', 2, '', ''], [1, '', '', '', '', 'модуль'], [2, '', 'Б', 2, '', ''], [2, '', '', '', '', 'модуль']])), []);
  // no «Юнит» column: the module after the topics of the one unit
  assert.deepEqual(codes(one([['', '', 'А', 2, '', ''], ['', '', '', '', '', 'модуль']])), []);
});

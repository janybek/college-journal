import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { TEMPLATE_ROWS, MAX_BOOK_SHEETS, templateSheet, findDateCell, bookSheets, syllabusBook, READ_OPTIONS } from '../site/js/excel.js';
import { fileLabels, fileData } from '../site/js/syllabus.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { setup } from './syllabusSetup.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';

// Writes a sheet to .xlsx bytes and reads it back the way the import screen does.
function roundTrip(sheet, bookType = 'xlsx') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Лист');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType }));
  const back = XLSX.read(bytes, { type: 'array', ...READ_OPTIONS });
  return back.Sheets[back.SheetNames[0]];
}

test('template: text columns are Text-formatted for many rows, other columns stay General', () => {
  const sheet = templateSheet(XLSX, ['Название', 'Курс'], [true, false]);
  assert.equal(sheet['!ref'], 'A1:B' + (TEMPLATE_ROWS + 1));
  assert.ok(TEMPLATE_ROWS >= 300);
  assert.deepEqual(sheet.A2, { t: 's', v: '', z: '@' });
  assert.deepEqual(sheet['A' + (TEMPLATE_ROWS + 1)], { t: 's', v: '', z: '@' });
  assert.equal(sheet.B2, undefined);
  assert.equal(sheet.A1.v, 'Название');
  const back = XLSX.read(new Uint8Array(XLSX.write({ SheetNames: ['g'], Sheets: { g: sheet } }, { type: 'array', bookType: 'xlsx' })),
    { type: 'array', cellNF: true });
  assert.equal(back.Sheets.g.A300.z, '@');
});

test('template read back: the empty formatted cells add only blank rows, which the reader drops', () => {
  const sheet = roundTrip(templateSheet(XLSX, ['ФИО', '№ студ. билета'], [true, true]));
  const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  assert.deepEqual(cells[0], ['ФИО', '№ студ. билета']);
  assert.ok(cells.slice(1).every((row) => row.every((cell) => cell === '')));
  assert.equal(findDateCell(XLSX, sheet), null);
});

test('findDateCell: the first date cell with its Excel row number and the title of its column', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Название', 'Курс'], ['02-1', 2], ['x', 1]]);
  sheet.A3 = { t: 'n', v: 46023, z: 'd-mmm' };
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 3, column: 'Название' });
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet, 'biff8')), { row: 3, column: 'Название' });
});

test('findDateCell: a column without a title is named by its letter; a sheet with no dates gives null', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['', 'Курс'], [46023, 1]]);
  sheet.A2.z = 'dd.mm.yyyy';
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 2, column: 'A' });
  const plain = roundTrip(XLSX.utils.aoa_to_sheet([['Название', 'Курс'], ['01-1', 1], [12, 2]]));
  assert.equal(findDateCell(XLSX, plain), null);
  assert.equal(findDateCell(XLSX, {}), null);
});

test('findDateCell: rows are counted from the top of the sheet even when the data starts lower', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Название', 'Курс'], [46023, 1]], { origin: 'B3' });
  sheet.B4.z = 'd-mmm';
  sheet['!ref'] = 'B3:C4'; // as in a file whose used range starts at B3
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 4, column: 'Название' });
});

// ---- The two-sheet syllabus file: the template, «Скачать (Excel)» and reading a whole book ----

const labels = fileLabels((key) => ru[key]);
const blankRow = { unit: 1, label: '', practiceKind: '', selfHours: null, description: '' };
const SAMPLE = {
  info: { discipline: 'Информатика', teacher: 'Teacher One', course: 1, semester: 1, audience: 'Сестринское дело', credits: 2, totalHours: 6, classHours: 6, selfHours: 0 },
  rows: [{ ...blankRow, kind: 'topic', label: '1.10', name: 'Введение', lectureHours: 2, practiceHours: 0, selfHours: 2, description: 'Первая строка\nвторая строка' },
    { ...blankRow, kind: 'topic', name: 'Введение', lectureHours: 0, practiceHours: 2, practiceKind: 'seminar' },
    { ...blankRow, kind: 'control', name: '' },
    { ...blankRow, kind: 'control', unit: 2, name: 'Экзамен', lectureHours: 0, practiceHours: 2 }],
};
const reread = (book) => bookSheets(XLSX, XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array', ...READ_OPTIONS }));

test('syllabusBook: the file «Скачать (Excel)» gives is read back by the same parser without losses', () => {      // Review Focus 19
  const back = reread(syllabusBook(XLSX, labels, SAMPLE));
  assert.deepEqual([back.sheets.map((s) => s.name), back.dateCell, back.tooMany], [['Сведения', 'Тематический план'], null, false]);
  const parsed = parseSyllabus(back.sheets);
  assert.deepEqual(parsed.errors, []);
  // «№» 1.10 stays text, the line break of the description is in place
  assert.deepEqual(parsed.doc.rows.map(({ row, semester, ...rest }) => rest),
    SAMPLE.rows.map((r) => ({ kind: r.kind, unit: r.unit, unitTitle: '', label: r.label, name: r.name, lectureHours: r.lectureHours ?? 0, practiceHours: r.practiceHours ?? 0, practiceKind: r.practiceKind, selfHours: r.selfHours, description: r.description })));
  assert.deepEqual(parsed.doc.info, { discipline: 'Информатика', teacher: 'Teacher One', semester: 1, course: 1, audience: 'Сестринское дело', credits: 2, totalHours: 6, classHours: 6, selfHours: 0 });
  // СРС of zero is a number on the page («zero is a number too»), so it stays a zero, not an empty cell
  const zero = parseSyllabus(reread(syllabusBook(XLSX, labels, { ...SAMPLE, rows: [{ ...SAMPLE.rows[0], selfHours: 0 }] })).sheets);
  assert.deepEqual(zero.doc.rows.map((r) => r.selfHours), [0]);
});

test('syllabusBook: the blank template has two sheets, the discipline and the teacher filled in, no topics and no semester yet', () => {
  const blank = reread(syllabusBook(XLSX, labels, { info: { discipline: 'Информатика', teacher: 'Teacher One', course: 1 }, rows: [] }));
  assert.deepEqual(blank.sheets.map((s) => s.name), ['Сведения', 'Тематический план']);
  assert.deepEqual(blank.sheets[0].cells.slice(0, 4), [['Дисциплина', 'Информатика'], ['Преподаватель', 'Teacher One'], ['Курс', '1'], ['Семестр', '']]);
  assert.deepEqual(blank.sheets[1].cells.length, 1);                                  // only the titles: the empty text rows of the template are dropped
  // the parser asks for the semester (one error on «Сведения») and for the topics
  assert.deepEqual(parseSyllabus(blank.sheets).errors.map((e) => [e.sheet, e.code]), [['info', 'required'], ['plan', 'empty']]);
  const empty = reread(syllabusBook(XLSX, labels));
  assert.deepEqual(empty.sheets.map((s) => [s.name, s.cells.length]), [['Сведения', 9], ['Тематический план', 1]]);
});

test('syllabusBook: the template in every language is read by the same parser', () => {
  for (const dict of [ru, ky, en]) {
    const sheets = reread(syllabusBook(XLSX, fileLabels((key) => dict[key]), SAMPLE)).sheets;
    assert.deepEqual(sheets.map((s) => s.name), [dict['syllabus.file.sheet.info'], dict['syllabus.file.sheet.plan']]);
    const parsed = parseSyllabus(sheets);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.doc.rows.map((r) => [r.kind, r.practiceKind]), [['topic', ''], ['topic', 'seminar'], ['control', ''], ['control', '']]);
  }
});

test('fileData: «Скачать (Excel)» writes the semester of the curriculum, so a 3rd semester stays the 3rd after the upload', () => {
  const view = { semester: 1, subject: { name: 'Информатика', teacherName: 'Teacher One', course: 2 },
    syllabus: { planSemester: 3, audience: 'Сестринское дело', credits: 2, totalHours: 6, classHours: 6, selfHours: 0, rows: SAMPLE.rows } };
  assert.deepEqual([fileData(view).info.semester, fileData(view).rows], [3, SAMPLE.rows]);
  assert.deepEqual(fileData(view).info, { discipline: 'Информатика', teacher: 'Teacher One', course: 2, semester: 3, audience: 'Сестринское дело', credits: 2, totalHours: 6, classHours: 6, selfHours: 0 });
  const round = parseSyllabus(reread(syllabusBook(XLSX, labels, fileData(view))).sheets);
  assert.deepEqual([round.errors, round.doc.info.semester, round.doc.rows.map((r) => r.semester)], [[], 3, [3, 3, 3, 3]]);
  assert.deepEqual(fileData({ ...view, syllabus: null }), { info: { discipline: 'Информатика', teacher: 'Teacher One', course: 2 }, rows: [] });
});

test('syllabusBook: the text columns are Text-formatted for TEMPLATE_ROWS rows, the hours are not', () => {
  const planSheet = syllabusBook(XLSX, labels, null).Sheets['Тематический план'];
  const titles = XLSX.utils.sheet_to_json(planSheet, { header: 1 })[0];
  // «Название юнита» beside «Юнит»; «Семестр» (only for a course of two semesters) just before «Описание» (R2, R3)
  assert.deepEqual(titles, ['Юнит', 'Название юнита', '№', 'Тема', 'Лекция, ч (1 пара = 2 ч)', 'Практика, ч (1 пара = 2 ч)', 'Вид занятия', 'СРС, ч', 'Семестр', 'Описание']);
  const formatOf = (title) => planSheet[XLSX.utils.encode_cell({ r: TEMPLATE_ROWS, c: titles.indexOf(title) })]?.z;
  assert.deepEqual(['Название юнита', '№', 'Тема', 'Вид занятия', 'Описание', 'Юнит', 'СРС, ч', 'Семестр'].map(formatOf), ['@', '@', '@', '@', '@', undefined, undefined, undefined]);
  // «Сведения»: the discipline, the teacher, the course, the semester and the specialty are text: «1-2» typed into the
  // semester does not become a date, «1,2» not a fraction (R1); the numbers of hours are not text
  const infoSheet = syllabusBook(XLSX, labels, null).Sheets['Сведения'];
  assert.deepEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6'].map((ref) => infoSheet[ref]?.z), ['@', '@', '@', '@', '@', undefined]);
  // the written rows: hours of zero are an empty cell, the kind is the word of the dictionary
  const filled = syllabusBook(XLSX, labels, SAMPLE).Sheets['Тематический план'];
  assert.deepEqual(XLSX.utils.sheet_to_json(filled, { header: 1, defval: '' }).slice(1, 5), [
    [1, '', '1.10', 'Введение', 2, '', '', 2, '', 'Первая строка\nвторая строка'],
    [1, '', '', 'Введение', '', 2, 'семинар', '', '', ''],
    [1, '', '', '', '', '', 'модуль', '', '', ''],
    [2, '', '', 'Экзамен', '', 2, 'модуль', '', '', '']]);
});

test('syllabusBook: a unit title is written once, on the first row of its unit, and read back on every row of it', () => {   // R3
  const titled = { ...SAMPLE, rows: SAMPLE.rows.map((r) => ({ ...r, unitTitle: r.unit === 1 ? 'Техническое и программное обеспечение' : '' })) };
  const plan = XLSX.utils.sheet_to_json(syllabusBook(XLSX, labels, titled).Sheets['Тематический план'], { header: 1, defval: '' });
  assert.deepEqual(plan.slice(1, 5).map((row) => row[1]), ['Техническое и программное обеспечение', '', '', '']);
  const back = parseSyllabus(reread(syllabusBook(XLSX, labels, titled)).sheets);
  assert.deepEqual([back.errors, back.doc.rows.map((r) => r.unitTitle)], [[], ['Техническое и программное обеспечение', 'Техническое и программное обеспечение', 'Техническое и программное обеспечение', '']]);
});

test('fileData: both semesters of the year in one file — «1-2» in «Сведения», the semester of every row in the plan', () => {   // R2
  const half = (semester, planSemester, rows, over = {}) => ({ semester, subject: { name: 'Информатика', teacherName: 'Teacher One', course: 1 },
    semesters: [{ semester: 1, planSemester: 1 }, { semester: 2, planSemester: 2 }],
    syllabus: { planSemester, audience: 'Сестринское дело', credits: 4, totalHours: 10, classHours: 8, selfHours: 2, rows, ...over } });
  const autumn = half(1, 1, SAMPLE.rows.slice(0, 2));
  const spring = half(2, 2, [{ ...blankRow, kind: 'topic', name: 'Таблицы', lectureHours: 2, practiceHours: 2 }]);
  // shown from either semester, the file is the same: the autumn rows first
  for (const [view, other] of [[autumn, spring], [spring, autumn]]) {
    const data = fileData(view, other);
    assert.deepEqual([data.info.semester, data.rows.map((r) => [r.semester, r.name])], ['1-2', [[1, 'Введение'], [1, 'Введение'], [2, 'Таблицы']]]);
    assert.deepEqual([data.info.audience, data.info.credits, data.info.classHours], ['Сестринское дело', 4, 8]);
    const back = parseSyllabus(reread(syllabusBook(XLSX, labels, data)).sheets);
    assert.deepEqual([back.errors, back.doc.info.semester, back.doc.rows.map((r) => r.semester)], [[], null, [1, 1, 2]]);
  }
  // one «Сведения» sheet must hold what both semesters store (N1): other numbers, another specialty, or numbers the plan
  // of the year does not add up to — only the semester shown, as one semester's file
  for (const over of [{ credits: 2, totalHours: 10, classHours: 4, selfHours: 6 }, { audience: 'Лечебное дело' }, { credits: 3 }]) {
    const apart = fileData(autumn, half(2, 2, spring.syllabus.rows, over));
    assert.deepEqual([apart.info.semester, apart.info.credits, apart.info.classHours, apart.rows.length], [1, 4, 8, 2], JSON.stringify(over));
  }
  const notYear = { classHours: 4 };                                                       // each half alone, not the year (8)
  assert.deepEqual(fileData(half(1, 1, autumn.syllabus.rows, notYear), half(2, 2, spring.syllabus.rows, notYear)).info.semester, 1);
  const noSelfYear = { selfHours: 1 };                                                     // the plan of the year has 2 of СРС
  assert.deepEqual(fileData(half(1, 1, autumn.syllabus.rows, noSelfYear), half(2, 2, spring.syllabus.rows, noSelfYear)).info.semester, 1);
  // numbers left empty in both halves say nothing to check
  const blankNumbers = { credits: null, totalHours: null, classHours: null, selfHours: null };
  assert.deepEqual(fileData(half(1, 1, autumn.syllabus.rows, blankNumbers), half(2, 2, spring.syllabus.rows, blankNumbers)).info.semester, '1-2');
  // semesters of two academic years (1 and 4) cannot stand in one file: only the semester shown
  const far = fileData(autumn, half(2, 4, spring.syllabus.rows));
  assert.deepEqual([far.info.semester, far.rows.length], [1, 2]);
  assert.deepEqual(fileData(autumn, { ...spring, syllabus: null }).info.semester, 1);
});

test('round trip through the site: download → upload unchanged changes nothing, for one semester and for a whole year', () => {   // R2
  const { send, call, dean, sb1 } = setup();
  const upload = (sheets) => send('syllabus.apply', sb1, sheets, dean).data;
  const downloaded = () => {
    const view = call('syllabus.get', { subjectId: sb1, semester: 1 }, dean).data;
    const other = view.semesters.length === 2 ? call('syllabus.get', { subjectId: sb1, semester: 2 }, dean).data : null;
    return reread(syllabusBook(XLSX, labels, fileData(view, other))).sheets.map(({ name, cells }) => ({ name, cells }));
  };
  const unchanged = (preview) => preview.summaries.map((s) => [s.semester, s.replaces, s.added, s.changed, s.removed]);

  const INFO1 = [['Семестр', 1], ['Специальность', 'Сестринское дело'], ['Кредиты', 1], ['Всего часов', 10], ['Аудиторных часов', 6], ['СРС, часов', 4]];
  const HEAD1 = ['Юнит', 'Название юнита', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'Описание'];
  const one = upload([{ name: 'Сведения', cells: INFO1 }, { name: 'Тематический план', cells: [HEAD1, [1, 'Основы', '1.1', 'Введение', 2, 2, '', 'О курсе'],
    [1, '', '', 'Практикум', '', 2, 'семинар', ''], [1, '', '', '', '', '', 'модуль', '']] }]);
  assert.deepEqual([one.applied, one.warnings], [true, []]);
  const again = send('syllabus.preview', sb1, downloaded(), dean).data;
  assert.deepEqual([again.ok, again.warnings, unchanged(again)], [true, [], [[1, true, 0, 0, 0]]]);

  const INFO2 = [['Дисциплина', 'Информатика'], ['Курс', 1], ['Семестр', '1-2'], ['Специальность', 'Сестринское дело'], ['Кредиты', 3], ['Всего часов', 20], ['Аудиторных часов', 12], ['СРС, часов', 8]];
  const HEAD2 = ['Семестр', 'Юнит', 'Название юнита', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'СРС, ч', 'Описание'];
  const year = upload([{ name: 'Сведения', cells: INFO2 }, { name: 'Тематический план', cells: [HEAD2,
    [1, 1, 'Основы', '1.1', 'Введение', 2, 2, '', 2, 'О курсе'], [1, 1, '', '', 'Модуль 1 (рубежный контроль)', '', '', 'модуль', '', ''],
    [1, 2, 'Сети', '2.1', 'Сети', 2, '', '', 2, ''], [1, 2, '', '', '', '', '', 'модуль', '', ''],
    [2, 1, 'Таблицы', '1.1', 'Формулы', '', 4, 'лабораторная', 4, 'Расчёт доз'], [2, 1, '', '', 'Экзамен', '', 2, 'модуль', '', '']] }]);
  assert.deepEqual([year.applied, year.warnings, year.summaries.map((s) => [s.semester, s.replaces])], [true, [], [[1, true], [2, false]]]);
  const back = send('syllabus.preview', sb1, downloaded(), dean).data;
  assert.deepEqual([back.ok, back.warnings, unchanged(back)], [true, [], [[1, true, 0, 0, 0], [2, true, 0, 0, 0]]]);
  // a row «lecture + practice» is two lessons now, so it is downloaded as two rows: «Сети» is the fourth row of the first semester
  const autumn = call('syllabus.get', { subjectId: sb1, semester: 1 }, dean).data.syllabus.rows;
  assert.deepEqual(autumn.map((r) => [r.lessonKind, r.name, r.unitTitle]), [['lecture', 'Введение', 'Основы'], ['practice', 'Введение', 'Основы'],
    ['control', 'Модуль 1 (рубежный контроль)', 'Основы'], ['lecture', 'Сети', 'Сети'], ['control', '', 'Сети']]);
});

test('two halves uploaded from two files: the download changes nothing stored and says nothing new (N1)', () => {
  const info = (semester, credits, total, classHours, self) => [['Дисциплина', 'Информатика'], ['Курс', 1], ['Семестр', semester], ['Специальность', 'Сестринское дело'],
    ['Кредиты', credits], ['Всего часов', total], ['Аудиторных часов', classHours], ['СРС, часов', self]];
  const HEAD = ['Юнит', 'Название юнита', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'СРС, ч', 'Описание'];
  const plan = (topic) => [HEAD, [1, 'Основы', '1.1', topic, 2, 2, '', 2, ''], [1, '', '', 'Модуль 1', '', '', 'модуль', '', '']];   // 4 classroom hours, 2 of СРС
  for (const [label, autumn, spring, yearFile] of [
    ['different numbers', info(1, 2, 10, 6, 4), info(2, 3, 12, 6, 6), false],
    ['identical numbers the year does not add up to', info(1, 2, 10, 4, 6), info(2, 2, 10, 4, 6), false],
    ['identical numbers of the whole year', info(1, 2, 12, 8, 4), info(2, 2, 12, 8, 4), true],
  ]) {
    const { send, call, dean, sb1 } = setup();
    const first = send('syllabus.apply', sb1, [{ name: 'Сведения', cells: autumn }, { name: 'Тематический план', cells: plan('Введение') }], dean).data;
    assert.equal(send('syllabus.apply', sb1, [{ name: 'Сведения', cells: spring }, { name: 'Тематический план', cells: plan('Формулы') }], dean).data.applied, true, label);
    const get = (semester) => call('syllabus.get', { subjectId: sb1, semester }, dean).data;
    const stored = () => [1, 2].map((semester) => {
      const { planSemester, audience, credits, totalHours, classHours, selfHours, rows } = get(semester).syllabus;
      return { planSemester, audience, credits, totalHours, classHours, selfHours, rows: rows.map((r) => r.name) };
    });
    const before = stored();
    const data = fileData(get(1), get(2));
    assert.equal(data.info.semester, yearFile ? '1-2' : 1, label);
    const again = send('syllabus.apply', sb1, reread(syllabusBook(XLSX, labels, data)).sheets.map(({ name, cells }) => ({ name, cells })), dean).data;
    assert.equal(again.applied, true, label);
    // no remark the first upload of that semester did not have; nothing added, changed or removed; both semesters stored as before
    assert.deepEqual(again.warnings.filter((w) => !first.warnings.some((f) => JSON.stringify(f) === JSON.stringify(w))), [], label);
    assert.deepEqual(again.summaries.map((s) => [s.added, s.changed, s.removed]), again.summaries.map(() => [0, 0, 0]), label);
    assert.deepEqual(stored(), before, label);
  }
});

test('bookSheets: empty rows above the data, an empty sheet, a date on the second sheet, too many sheets', () => {
  const many = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(many, XLSX.utils.aoa_to_sheet([['Семестр', 1]]), 'Сведения');
  XLSX.utils.book_append_sheet(many, XLSX.utils.aoa_to_sheet([]), 'Пустой');
  XLSX.utils.book_append_sheet(many, XLSX.utils.aoa_to_sheet([['Тема', 'Недели'], ['А', new Date(2026, 0, 2)]], { origin: 'A3', cellDates: true }), 'Тематический план');
  const seen = bookSheets(XLSX, many);
  assert.deepEqual(seen.sheets.map((s) => [s.name, s.firstRow, s.cells.length]), [['Сведения', 0, 1], ['Тематический план', 2, 2]]);
  assert.deepEqual(seen.dateCell, { sheet: 'Тематический план', row: 4, column: 'Недели' });
  assert.equal(seen.tooMany, false);
  const big = XLSX.utils.book_new();
  for (let i = 0; i <= MAX_BOOK_SHEETS; i++) XLSX.utils.book_append_sheet(big, XLSX.utils.aoa_to_sheet([[i]]), 'Лист' + i);
  assert.deepEqual([bookSheets(XLSX, big).tooMany, bookSheets(XLSX, big).sheets.length], [true, MAX_BOOK_SHEETS]);
  // a sheet of formatted but empty cells has no data
  const blankOnly = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(blankOnly, templateSheet(XLSX, [''], [true]), 'Лист1');
  assert.deepEqual(bookSheets(XLSX, blankOnly), { sheets: [], dateCell: null, tooMany: false });
});

test('bookSheets: a parser error row plus firstRow is the row Excel shows when empty rows stand above the plan', () => {
  const book = syllabusBook(XLSX, labels, SAMPLE);
  const plan = XLSX.utils.sheet_to_json(book.Sheets['Тематический план'], { header: 1, defval: '' }).slice(0, 5);
  plan[2][4] = 3;                                                                      // the seminar «Введение» gets 3 hours of lecture
  book.Sheets['Тематический план'] = XLSX.utils.aoa_to_sheet(plan, { origin: 'A4' });  // the plan starts at row 4 in Excel
  const read = reread(book);
  const planSheet = read.sheets.find((s) => s.name === 'Тематический план');
  const [error] = parseSyllabus(read.sheets).errors;
  assert.deepEqual([error.code, error.row + planSheet.firstRow], ['bad_hours', 6]);    // titles in row 4, the first topic in 5, the broken one in 6
});

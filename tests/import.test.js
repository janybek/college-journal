import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheet, planImport, MAX_IMPORT_ROWS, IMPORT_SPECS } from '../core/import.js';

const makeDb = () => ({
  groups: [{ id: 'g_1', name: '01-1', course: 1 }],
  students: [{ id: 'st_1', fullName: 'Старый', cardNo: '1001', groupId: 'g_1', lang: 'ky', active: true }],
  staff: [
    { id: 'sf_1', fullName: 'Иванов Иван', login: 'ivanov', roles: 'teacher', lang: 'ru', active: true },
    { id: 'sf_2', fullName: 'Двойной Тёзка', login: 'twin1', roles: 'teacher', lang: 'ru', active: true },
    { id: 'sf_3', fullName: 'Двойной Тёзка', login: 'twin2', roles: 'teacher', lang: 'ru', active: true },
  ],
  disciplines: [{ id: 'ds_1', name: 'Математика' }, { id: 'ds_2', name: 'Физика' }, { id: 'ds_3', name: 'Химия' }, { id: 'ds_4', name: 'Музыка' }, { id: 'ds_5', name: 'Спорт' }],
  subjects: [{ id: 'sb_1', name: 'Математика', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }],
  rooms: [],
});

test('students: messy sheet, references, duplicates, plan', () => {
  const db = makeDb();
  const r = parseSheet('students', [
    ['  фио ', 'Группа', '№ СТУД.  БИЛЕТА', 'лишняя'],
    ['Асанов Азамат', ' 01-1 ', 1002, 'x'],
    ['', '', '', ''],
    ['Бекова Бегимай', '09-9', 1003, ''],
    ['Новое Имя', '01-1', 1001, ''],
    ['Дубль', '01-1', '1002', ''],
    [null, null, null, null],
  ], db);
  assert.deepEqual(r.unknownColumns, ['лишняя']);
  assert.deepEqual(r.missingColumns, []);
  assert.deepEqual(r.errors, [{ row: 4, field: 'groupId', code: 'bad_ref' }, { row: 6, field: 'cardNo', code: 'duplicate' }]);
  assert.deepEqual(r.records.map(x => [x.row, x.cardNo, x.groupId]), [[2, '1002', 'g_1'], [5, '1001', 'g_1']]);
  const plan = planImport('students', r.records, db);
  assert.equal(plan.toInsert.length, 1);
  assert.equal(plan.toInsert[0].lang, 'ky');
  assert.equal('row' in plan.toInsert[0], false);
  assert.equal('id' in plan.toInsert[0], false);
  assert.deepEqual(plan.toUpdate, [{ id: 'st_1', patch: { fullName: 'Новое Имя', groupId: 'g_1' } }]);
});

test('missing columns, other header languages', () => {
  const db = makeDb();
  assert.deepEqual(parseSheet('students', [['ФИО'], ['А']], db).missingColumns, ['cardNo', 'groupId']);
  assert.deepEqual(parseSheet('students', [['ФИО'], ['А']], db).records, []);
  assert.deepEqual(parseSheet('students', [['Аты-жөнү', 'Тайпа', 'Student ID'], ['А', '01-1', 7]], db).errors, []);
});

test('group column: the Kyrgyz title «Топ» and the old «Тайпа» are both recognised', () => {
  const db = makeDb();
  assert.equal(IMPORT_SPECS.students.columns.find((c) => c.key === 'groupId').titles.ky, 'Топ');
  assert.equal(IMPORT_SPECS.subjects.columns.find((c) => c.key === 'groupId').titles.ky, 'Топ');
  for (const title of ['Топ', 'Тайпа', '  ТАЙПА ', 'топ']) {
    const students = parseSheet('students', [['Аты-жөнү', title, 'Студенттик билеттин №'], ['А', '01-1', 7]], db);
    assert.deepEqual(students.missingColumns, [], title);
    assert.deepEqual(students.unknownColumns, [], title);
    assert.equal(students.records[0].groupId, 'g_1', title);
    const subjects = parseSheet('subjects', [['Аталышы', 'Окутуучу', title], ['Физика', 'ivanov', '01-1']], db);
    assert.deepEqual(subjects.missingColumns, [], title);
    assert.deepEqual(subjects.unknownColumns, [], title);
    assert.equal(subjects.records[0].groupId, 'g_1', title);
  }
  // An alias is the same column: a second group column under the other name is reported as unknown.
  assert.deepEqual(parseSheet('students', [['ФИО', 'Топ', 'Тайпа', '№ студ. билета'], ['А', '01-1', '01-1', 8]], db).unknownColumns, ['Тайпа']);
});

test('staff: roles and lang words', () => {
  const db = makeDb();
  assert.deepEqual(parseSheet('staff', [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'Преподаватель, деканат'], ['Б', 'bbb', 'директор']], db).errors,
    [{ row: 3, field: 'roles', code: 'bad_value' }]);
  assert.equal(parseSheet('staff', [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'Преподаватель, деканат']], db).records[0].roles, 'dean,teacher');
  const r = parseSheet('staff', [['ФИО', 'Логин', 'Роли', 'Язык'], ['А', 'aaa', 'admin', 'Русский'], ['Б', 'bbb', 'admin', 'klingon'], ['В', 'ccc', 'admin', '']], db);
  assert.equal(r.records[0].lang, 'ru');
  assert.deepEqual(r.errors, [{ row: 3, field: 'lang', code: 'bad_value' }]);
  assert.equal('lang' in r.records[1], false);
});

test('required cells, several errors per row', () => {
  const db = makeDb();
  const r = parseSheet('students', [['ФИО', 'Группа', '№ студ. билета'], ['', '01-1', 5], ['Х', '', '']], db);
  assert.deepEqual(r.errors, [
    { row: 2, field: 'fullName', code: 'required' },
    { row: 3, field: 'cardNo', code: 'required' },
    { row: 3, field: 'groupId', code: 'required' },
  ]);
  assert.deepEqual(r.records, []);
});

test('subjects: teacher by login, by full name, ambiguous name, unknown', () => {
  const db = makeDb();
  const r = parseSheet('subjects', [
    ['Название', 'Преподаватель', 'Группа'],
    ['Физика', 'IVANOV', '01-1'],
    ['Химия', 'иванов  иван', '01-1'],
    ['Музыка', 'Двойной Тёзка', '01-1'],
    ['Спорт', 'nobody', '01-1'],
  ], db);
  assert.deepEqual(r.errors, [{ row: 4, field: 'teacherId', code: 'bad_ref' }, { row: 5, field: 'teacherId', code: 'bad_ref' }]);
  assert.deepEqual(r.records.map(x => [x.row, x.teacherId]), [[2, 'sf_1'], [3, 'sf_1']]);
});

test('subjects: (discipline, group) pair is the key', () => {
  const same = parseSheet('subjects', [['Название', 'Преподаватель', 'Группа'], ['математика', 'ivanov', '01-1']], makeDb());
  assert.deepEqual([same.errors, planImport('subjects', same.records, makeDb()).toUpdate], [[], [{ id: 'sb_1', patch: { teacherId: 'sf_1', name: 'Математика' } }]]);
});

test('subjects: the discipline comes from the directory', () => {
  const idb = {
    ...makeDb(),
    groups: [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '02-1', course: 2 }],
    disciplines: [{ id: 'ds_1', name: 'Математика' }],
    subjects: [{ id: 'sb_1', name: 'Математика', disciplineId: 'ds_1', teacherId: 'sf_2', groupId: 'g_1', scheme: 'A' }],      // sf_1 — ivanov, sf_2 — twin1
  };
  const r = parseSheet('subjects', [['Дисциплина', 'Преподаватель', 'Группа'], [' математика ', 'ivanov', '01-1'], ['Физика', 'ivanov', '01-1'], ['Математика', 'ivanov', '02-1']], idb);
  assert.deepEqual(r.errors, [{ row: 3, field: 'disciplineId', code: 'bad_ref' }]);
  assert.deepEqual(r.records.map((x) => [x.row, x.disciplineId, x.name, x.groupId]), [[2, 'ds_1', 'Математика', 'g_1'], [4, 'ds_1', 'Математика', 'g_2']]);
  const plan = planImport('subjects', r.records, idb);
  assert.deepEqual([plan.toUpdate, plan.toInsert.map((x) => [x.disciplineId, x.name, x.groupId])], [[{ id: 'sb_1', patch: { teacherId: 'sf_1', name: 'Математика' } }], [['ds_1', 'Математика', 'g_2']]]);
  for (const title of ['Название', 'Аталышы', 'Name', 'Предмет', 'Discipline']) {
    assert.deepEqual(parseSheet('subjects', [[title, 'Преподаватель', 'Группа'], ['Математика', 'ivanov', '02-1']], idb).missingColumns, [], title);
  }
});

test('groups: course coerced, bad course reported, repeat in file is duplicate', () => {
  const db = makeDb();
  const r = parseSheet('groups', [['Название', 'Курс'], ['02-1', 2], ['02-1', 3], ['03-1', 9]], db);
  assert.deepEqual(r.errors, [{ row: 3, field: 'name', code: 'duplicate' }, { row: 4, field: 'course', code: 'bad_value' }]);
  assert.deepEqual(planImport('groups', r.records, db).toInsert, [{ name: '02-1', course: 2 }]);
});

test('same existing row twice in one file is a duplicate', () => {
  const db = makeDb();
  const r = parseSheet('rooms', [['Name'], ['101'], [' 101 ']], db);
  assert.deepEqual(r.errors, [{ row: 3, field: 'name', code: 'duplicate' }]);
});

test('too many rows', () => {
  const rows = [['Название']];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i++) rows.push([`R${i}`]);
  const r = parseSheet('rooms', rows, makeDb());
  assert.deepEqual(r.errors, [{ row: 0, field: '', code: 'too_many_rows' }]);
  assert.deepEqual(r.records, []);
});

test('duplicate header and specs', () => {
  const r = parseSheet('rooms', [['Название', 'Name', ''], ['101', 'x', '']], makeDb());
  assert.deepEqual(r.unknownColumns, ['Name']);
  assert.deepEqual(Object.keys(IMPORT_SPECS).sort(), ['disciplines', 'groups', 'rooms', 'staff', 'students', 'subjects', 'syllabus', 'topics']);
});

const topicsDb = () => ({
  groups: [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '02-1', course: 2 }],
  subjects: [{ id: 'sb_1', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }, { id: 'sb_2', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_2', scheme: 'A' }],
  topics: [{ id: 'tp_1', subjectId: 'sb_1', semester: 1, unit: 1, order: 1, name: 'Старое имя', lessonType: 'lecture' },
    { id: 'tp_2', subjectId: 'sb_1', semester: 1, unit: 1, order: 2, name: 'Проведённая', lessonType: 'practice' },
    { id: 'tp_3', subjectId: 'sb_1', unit: 1, order: 7, name: 'Старая строка', lessonType: 'lecture' },
    { id: 'tp_9', subjectId: 'sb_2', semester: 1, unit: 1, order: 9, name: 'Тема другой группы', lessonType: 'lecture' }],
  pairs: [{ id: 'p_1', subjectId: 'sb_1', topicId: 'tp_2', status: 'closed' }],
});

test('topics import', () => {
  const db = topicsDb();
  const r = parseSheet('topics', [
    ['Предмет', 'Группа', 'Семестр', 'Юнит', '№ темы', 'Тема', 'Тип'],
    ['информатика', '01-1', 1, 1, 1, 'Цифровой пост медсестры', 'Лекция'],
    ['Информатика', '01-1', 1, 1, 2, 'Другое имя', 'практика'],
    ['Информатика', '01-1', 1, 1, 3, 'Защита данных', 'практика'],
    ['Информатика', '01-1', 1, 1, 3, 'Повтор номера', 'лекция'],
    ['Информатика', '09-9', 1, 1, 1, 'Нет группы', 'лекция'],
    ['Химия', '01-1', 1, 1, 1, 'Нет предмета', 'лекция'],
    ['Информатика', '02-1', 1, 2, 1, 'Модуль 2 — экзамен', 'экзамен'],
    ['Информатика', '02-1', 1, 0, 2, 'Юнит 0', 'семинар'],
    ['Информатика', '01-1', 2, 1, 1, 'Первая тема второго семестра', 'лекция'],   // 10: новая — № 1 есть только в семестре 1
    ['Информатика', '01-1', 2, 1, 1, 'Повтор во втором', 'лекция'],               // 11
    ['Информатика', '01-1', 3, 1, 4, 'Третий семестр', 'лекция'],                 // 12
    ['Информатика', '01-1', '', 1, 5, 'Без семестра', 'лекция'],                  // 13
    ['Информатика', '01-1', 1, 1, 7, 'Старая строка, новое имя', 'лекция'],       // 14: обновит tp_3
  ], db);
  assert.deepEqual(r.errors, [{ row: 3, field: 'name', code: 'held' }, { row: 5, field: 'order', code: 'duplicate' },
    { row: 6, field: 'groupId', code: 'bad_ref' }, { row: 7, field: 'subjectId', code: 'bad_ref' },
    { row: 9, field: 'unit', code: 'bad_value' }, { row: 9, field: 'lessonType', code: 'bad_value' },
    { row: 11, field: 'order', code: 'duplicate' }, { row: 12, field: 'semester', code: 'bad_value' }, { row: 13, field: 'semester', code: 'required' }]);
  assert.deepEqual(r.records.map(x => [x.row, x.subjectId, x.lessonType]),
    [[2, 'sb_1', 'lecture'], [4, 'sb_1', 'practice'], [8, 'sb_2', 'control'], [10, 'sb_1', 'lecture'], [14, 'sb_1', 'lecture']]);
  assert.equal('groupId' in r.records[0], false);
  const plan = planImport('topics', r.records, db);
  assert.deepEqual(plan.toInsert.map(t => [t.subjectId, t.semester, t.unit, t.order, t.name]),
    [['sb_1', 1, 1, 3, 'Защита данных'], ['sb_2', 1, 2, 1, 'Модуль 2 — экзамен'], ['sb_1', 2, 1, 1, 'Первая тема второго семестра']]);
  assert.deepEqual(plan.toUpdate, [{ id: 'tp_1', patch: { unit: 1, name: 'Цифровой пост медсестры', lessonType: 'lecture' } },
    { id: 'tp_3', patch: { unit: 1, name: 'Старая строка, новое имя', lessonType: 'lecture' } }]);
});

test('topics import: held topic unchanged is fine, missing group column, lesson type words', () => {
  const db = topicsDb();
  const same = parseSheet('topics', [['Предмет', 'Группа', 'Семестр', 'Юнит', '№', 'Тема', 'Тип'], ['Информатика', '01-1', 1, 1, 2, 'Проведённая', 'практика']], db);
  assert.deepEqual(same.errors, []);
  const noGroup = parseSheet('topics', [['Предмет', 'Семестр', 'Юнит', '№', 'Тема', 'Тип'], ['Информатика', 1, 1, 5, 'Т', 'лекция']], db);
  assert.deepEqual(noGroup.missingColumns, ['groupId']);
  const noSemester = parseSheet('topics', [['Предмет', 'Группа', 'Юнит', '№', 'Тема', 'Тип'], ['Информатика', '01-1', 1, 5, 'Т', 'лекция']], db);
  assert.deepEqual(noSemester.missingColumns, ['semester']);
  const words = parseSheet('topics', [['Subject', 'Group', 'Semester', 'Module', 'No.', 'Topic', 'Type'],
    ['Информатика', '01-1', 1, 1, 10, 'a', 'Практическое'], ['Информатика', '01-1', 1, 1, 11, 'b', 'Рубежный контроль'],
    ['Информатика', '01-1', 1, 1, 12, 'c', 'аралык текшерүү'], ['Информатика', '01-1', 1, 1, 13, 'd', 'lecture']], db);
  assert.deepEqual(words.errors, []);
  assert.deepEqual(words.records.map(x => x.lessonType), ['practice', 'control', 'control', 'lecture']);
});

test('syllabus import: the teacher file, subject from `fixed`', () => {
  const db = topicsDb();
  const s = parseSheet('syllabus', [
    ['Семестр', 'Модуль', '№', 'Тема', 'Тип'],
    [1, 1, 1, 'Цифровой пост медсестры', 'лекция'],      // 2: обновит tp_1
    [1, 1, 2, 'Другое имя', 'практика'],                  // 3: пара с этой темой проведена
    [1, 2, 3, 'Новая в первом', 'практика'],              // 4: новая
    [2, 1, 1, 'Первая во втором', 'лекция'],              // 5: новая, № снова с 1
    [2, 2, 2, 'Экзамен', 'экзамен'],                      // 6: новая
    [2, 2, 2, 'Повтор', 'лекция'],                        // 7
    [0, 1, 3, 'Нулевой семестр', 'лекция'],               // 8: только ошибка семестра, хотя № 3 уже занят строкой 4
    ['', '', '', '', ''],                                  // 9: пустая строка пропускается
    [2, 13, 201, '', 'семинар'],                           // 10
    [1, 1, 9, 'Девятая', 'лекция'],                        // 11: новая — № 9 занят только у предмета другой группы (tp_9)
  ], db, { subjectId: 'sb_1' });
  assert.deepEqual(s.errors, [{ row: 3, field: 'name', code: 'held' }, { row: 7, field: 'order', code: 'duplicate' },
    { row: 8, field: 'semester', code: 'bad_value' }, { row: 10, field: 'unit', code: 'bad_value' }, { row: 10, field: 'order', code: 'bad_value' },
    { row: 10, field: 'name', code: 'required' }, { row: 10, field: 'lessonType', code: 'bad_value' }]);
  assert.deepEqual(s.records.map(x => [x.row, x.subjectId, x.lessonType]),
    [[2, 'sb_1', 'lecture'], [4, 'sb_1', 'practice'], [5, 'sb_1', 'lecture'], [6, 'sb_1', 'control'], [11, 'sb_1', 'lecture']]);
  const sp = planImport('syllabus', s.records, db);
  assert.deepEqual(sp.toInsert.map(t => [t.subjectId, t.semester, t.unit, t.order, t.name]),
    [['sb_1', 1, 2, 3, 'Новая в первом'], ['sb_1', 2, 1, 1, 'Первая во втором'], ['sb_1', 2, 2, 2, 'Экзамен'], ['sb_1', 1, 1, 9, 'Девятая']]);
  assert.deepEqual(sp.toUpdate, [{ id: 'tp_1', patch: { unit: 1, name: 'Цифровой пост медсестры', lessonType: 'lecture' } }]);
});

test('syllabus import: extra Subject column, missing Semester column, English headers', () => {
  const db = topicsDb();
  const extra = parseSheet('syllabus', [['Предмет', 'Семестр', 'Модуль', '№', 'Тема', 'Тип'], ['Химия', 1, 1, 20, 'Т', 'лекция']], db, { subjectId: 'sb_1' });
  assert.deepEqual(extra.unknownColumns, ['Предмет']);
  assert.deepEqual(extra.records.map(x => [x.subjectId, x.order]), [['sb_1', '20']]);
  const noSemester = parseSheet('syllabus', [['Модуль', '№', 'Тема', 'Тип'], [1, 20, 'Т', 'лекция']], db, { subjectId: 'sb_1' });
  assert.deepEqual(noSemester.missingColumns, ['semester']);
  const en = parseSheet('syllabus', [['Semester', 'Unit', 'No.', 'Topic', 'Type'], [1, 1, 21, 'T', 'lecture']], db, { subjectId: 'sb_1' });
  assert.deepEqual([en.errors, en.records.length], [[], 1]);
});

test('syllabus import: the fixed subject is checked; semester text is read as a number', () => {
  const db = topicsDb();
  const rows = [['Семестр', 'Модуль', '№', 'Тема', 'Тип'], [1, 1, 20, 'Т', 'лекция']];
  const bad = parseSheet('syllabus', rows, db, { subjectId: 'nope' });
  assert.deepEqual([bad.errors, bad.records], [[{ row: 0, field: 'subjectId', code: 'bad_ref' }], []]);
  const none = parseSheet('syllabus', rows, db);
  assert.deepEqual([none.errors, none.records], [[{ row: 0, field: 'subjectId', code: 'required' }], []]);
  const ok = parseSheet('syllabus', rows, db, { subjectId: 'sb_1' });
  assert.deepEqual([ok.errors, ok.records.length], [[], 1]);
  const text = parseSheet('syllabus', [rows[0], ['01', 1, 1, 'Цифровой пост медсестры', 'лекция']], db, { subjectId: 'sb_1' });
  assert.deepEqual(text.errors, []);
  assert.deepEqual(planImport('syllabus', text.records, db).toUpdate.map(u => u.id), ['tp_1']);
});

test('disciplines import', () => {
  const ddb = { disciplines: [{ id: 'ds_1', name: 'Информатика' }] };
  const d = parseSheet('disciplines', [['Название'], ['Анатомия'], ['информатика'], ['']], ddb);
  assert.deepEqual([d.errors, d.records], [[], [{ row: 2, name: 'Анатомия' }, { row: 3, name: 'информатика' }]]);
  assert.deepEqual([planImport('disciplines', d.records, ddb).toInsert.length, planImport('disciplines', d.records, ddb).toUpdate.map(u => u.id)], [1, ['ds_1']]);
});

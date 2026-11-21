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
  assert.deepEqual(Object.keys(IMPORT_SPECS).sort(), ['disciplines', 'groups', 'rooms', 'staff', 'students', 'subjects']);
  // no fixed parameter any more: a fourth argument does not reach the records
  assert.deepEqual(parseSheet('rooms', [['Название'], ['101']], { rooms: [] }, { subjectId: 'sb_1' }).records, [{ row: 2, name: '101' }]);
  for (const spec of Object.values(IMPORT_SPECS)) for (const key of ['table', 'fixedKeys', 'check', 'keyDefaults']) assert.equal(key in spec, false, key);
});

test('disciplines import', () => {
  const ddb = { disciplines: [{ id: 'ds_1', name: 'Информатика' }] };
  const d = parseSheet('disciplines', [['Название'], ['Анатомия'], ['информатика'], ['']], ddb);
  assert.deepEqual([d.errors, d.records], [[], [{ row: 2, name: 'Анатомия' }, { row: 3, name: 'информатика' }]]);
  assert.deepEqual([planImport('disciplines', d.records, ddb).toInsert.length, planImport('disciplines', d.records, ddb).toUpdate.map(u => u.id)], [1, ['ds_1']]);
});

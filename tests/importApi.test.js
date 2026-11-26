import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const ctx = { store, platform, log: () => {} };
  store.insert('staff', {
    fullName: 'dean', login: 'dean', passwordHash: hashPassword(platform, 'secret12'),
    roles: 'dean', lang: 'ky', mustChangePassword: false, active: true,
  });
  store.insert('groups', { name: '01-1', course: 1 });
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const dean = call('auth.login', { login: 'dean', password: 'secret12' }).data.token;
  return { store, call, dean, platform };
}

const cells = [['ФИО', 'Группа', '№ студ. билета'], ['Асанов Азамат', '01-1', 2001], ['Бекова Бегимай', '01-1', 2002], ['Кривой', '99-9', 2003]];

test('preview writes nothing, apply imports once and never re-issues passwords', () => {
  const { store, call, dean } = setup();
  const pre = call('import.preview', { table: 'students', cells }, dean).data;
  assert.deepEqual([pre.total, pre.valid, pre.newCount, pre.updateCount], [3, 2, 2, 0]);
  assert.equal(store.list('students').length, 0);
  const first = call('import.apply', { table: 'students', cells }, dean).data;
  assert.deepEqual([first.inserted, first.updated, first.skipped, first.passwords.length], [2, 0, 1, 2]);
  assert.deepEqual(first.errors, [{ row: 4, field: 'groupId', code: 'bad_ref' }]);
  assert.equal(first.passwords[0].login, '2001');
  assert.equal(JSON.stringify(first).includes('v1$'), false);
  assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);
  const second = call('import.apply', { table: 'students', cells }, dean).data;
  assert.deepEqual([second.inserted, second.updated, second.passwords.length], [0, 2, 0]);
  assert.equal(store.list('students').length, 2);
  assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);
  assert.deepEqual(call('import.apply', { table: 'staff', cells: [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'admin']] }, dean).error, { code: 'forbidden' });
});

test('bad requests and files that cannot be applied', () => {
  const { store, call, dean } = setup();
  assert.deepEqual(call('import.preview', { table: 'translations', cells }, dean).error, { code: 'forbidden' });
  assert.deepEqual(call('import.preview', { table: 'students', cells: 'x' }, dean).error, { code: 'bad_request' });
  assert.deepEqual(call('import.apply', { table: 'students', cells: [['ФИО'], 'x'] }, dean).error, { code: 'bad_request' });
  const noCol = call('import.apply', { table: 'students', cells: [['ФИО', 'Группа'], ['А', '01-1']] }, dean).data;
  assert.deepEqual([noCol.inserted, noCol.updated, noCol.passwords], [0, 0, []]);
  assert.deepEqual(noCol.missingColumns, ['cardNo']);
  const many = [cells[0], ...Array.from({ length: 2001 }, (_, i) => ['N', '01-1', 5000 + i])];
  const tooMany = call('import.apply', { table: 'students', cells: many }, dean).data;
  assert.deepEqual([tooMany.inserted, tooMany.skipped], [0, 1]);
  assert.equal(store.list('students').length, 0);
});

test('groups import needs no passwords; a row with two errors is skipped once', () => {
  const { store, call, dean } = setup();
  const g = [['Название', 'Курс'], ['02-1', 2], ['', '']];
  const r = call('import.apply', { table: 'groups', cells: g }, dean).data;
  assert.deepEqual([r.inserted, r.passwords], [1, []]);
  assert.equal(store.list('groups').length, 2);
  const bad = call('import.preview', { table: 'students', cells: [cells[0], ['', 'zz', '']] }, dean).data;
  assert.deepEqual([bad.total, bad.valid], [1, 0]);
  assert.ok(bad.errors.length >= 2);
});

test('re-importing identical rows writes nothing but still counts them as updated', () => {
  const { store, call, dean } = setup();
  const good = cells.slice(0, 3);
  call('import.apply', { table: 'students', cells: good }, dean);
  const updates = [];
  const update = store.updateMany;
  store.updateMany = (...args) => { updates.push(args); return update(...args); };
  const pre = call('import.preview', { table: 'students', cells: good }, dean).data;
  assert.deepEqual([pre.newCount, pre.updateCount], [0, 2]);
  const again = call('import.apply', { table: 'students', cells: good }, dean).data;
  assert.deepEqual([again.inserted, again.updated, again.passwords.length], [0, 2, 0]);
  assert.deepEqual(updates, []);
  const renamed = [good[0], ['Асанов Азамат Бекович', '01-1', 2001], good[2]];
  const changed = call('import.apply', { table: 'students', cells: renamed }, dean).data;
  assert.deepEqual([changed.inserted, changed.updated], [0, 2]);
  assert.equal(updates.length, 1);
  assert.equal(store.list('students').find((s) => s.cardNo === '2001').fullName, 'Асанов Азамат Бекович');
});

test('updates run before inserts: a failing update leaves no new people behind', () => {
  const { store, call, dean } = setup();
  call('import.apply', { table: 'students', cells: cells.slice(0, 2) }, dean);
  store.updateMany = () => { throw new Error('sheet write failed'); };
  const mixed = [cells[0], ['Асанов Азамат Бекович', '01-1', 2001], ['Бекова Бегимай', '01-1', 2002]];
  assert.deepEqual(call('import.apply', { table: 'students', cells: mixed }, dean).error, { code: 'internal' });
  assert.deepEqual(store.list('students').map((s) => s.cardNo), ['2001']);
});

test('subjects import refuses a teacher who is busy in the week template, other rows load', () => {
  const { store, call, dean } = setup();
  const g1 = store.list('groups')[0].id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  const teacher = (login) => store.insert('staff', { fullName: login, login, passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const [t1, t2, t3] = ['tea1', 'tea2', 'tea3'].map(teacher);
  const disc = Object.fromEntries(['Информатика', 'Анатомия', 'Химия'].map((name) => [name, store.insert('disciplines', { name }).id]));
  const subject = (name, groupId, teacherId) => store.insert('subjects', { name, disciplineId: disc[name], groupId, teacherId, scheme: 'A' }).id;
  const sb1 = subject('Информатика', g1, t1);
  const sb2 = subject('Анатомия', g2, t2);
  const sb3 = subject('Химия', g2, t2);
  store.insert('weekTemplate', { weekday: 1, slot: 1, subjectId: sb1, roomId: '' });
  store.insert('weekTemplate', { weekday: 1, slot: 1, subjectId: sb2, roomId: '' });
  const sheet = [['Дисциплина', 'Преподаватель', 'Группа'], ['Анатомия', 'tea1', '02-1'], ['Химия', 'tea3', '02-1'], ['Физика', 'tea3', '02-1'], [' информатика ', 'tea3', '02-1']];
  const pre = call('import.preview', { table: 'subjects', cells: sheet }, dean).data;
  assert.deepEqual(pre.errors, [{ row: 2, field: 'teacherId', code: 'teacher_busy' }, { row: 4, field: 'disciplineId', code: 'bad_ref' }]);
  const done = call('import.apply', { table: 'subjects', cells: sheet }, dean).data;
  assert.deepEqual([done.inserted, done.updated, done.skipped, done.errors], [1, 1, 2, pre.errors]);
  assert.equal(store.get('subjects', sb2).teacherId, t2);
  assert.equal(store.get('subjects', sb3).teacherId, t3);
  assert.deepEqual(store.list('disciplines').map((d) => d.name), ['Информатика', 'Анатомия', 'Химия']);       // the log does not create disciplines
  const added = store.list('subjects').find((s) => s.groupId === g2 && s.disciplineId === disc['Информатика']);
  assert.equal(added.name, 'Информатика');                                                                    // name === the discipline's name
});

test('disciplines import: the deanery loads the list, a known name is not added twice', () => {
  const { store, call, dean } = setup();
  const file = [['Название'], ['Анатомия'], ['Информатика'], [' анатомия ']];
  const first = call('import.apply', { table: 'disciplines', cells: file }, dean).data;
  assert.deepEqual([first.inserted, first.updated, first.skipped, first.errors], [2, 0, 1, [{ row: 4, field: 'name', code: 'duplicate' }]]);
  assert.deepEqual(store.list('disciplines').map((x) => x.name), ['Анатомия', 'Информатика']);
  assert.deepEqual([call('import.apply', { table: 'disciplines', cells: file.slice(0, 3) }, dean).data.inserted, store.list('disciplines').length], [0, 2]);
});

test('a subjects import that changes the teacher re-lays the group and hands it its pairs; every sheet is read once', () => {
  const { store, call, dean, platform } = setup();
  const g1 = store.list('groups')[0].id;
  const teacher = (login) => store.insert('staff', { fullName: login, login, passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const t1 = teacher('tea1');
  const t2 = teacher('tea2');                                                     // tea2 has no syllabus
  const ds = store.insert('disciplines', { name: 'Информатика' }).id;
  const sb = store.insert('subjects', { name: 'Информатика', disciplineId: ds, groupId: g1, teacherId: t1, scheme: 'A' }).id;
  const sy = store.insert('syllabi', { disciplineId: ds, teacherId: t1, semester: 1, planSemester: 1, status: 'approved', version: 1 }).id;
  for (const [order, lessonKind] of [[1, 'lecture'], [2, 'practice']]) store.insert('topics', { syllabusId: sy, order, unit: 1, lessonKind, name: 'Введение', hours: 2, description: '' });
  // a second teacher of the discipline with an approved syllabus of his own: the half waits for the choice, so a teacher without his own syllabus has no topics
  const t3 = teacher('tea3');
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  store.insert('subjects', { name: 'Информатика', disciplineId: ds, groupId: g2, teacherId: t3, scheme: 'A' });
  store.insert('syllabi', { disciplineId: ds, teacherId: t3, semester: 1, planSemester: 1, status: 'approved', version: 1 });
  applyLinesUpgrade(store, platform);
  assert.equal(call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-09-25', holidays: [], bells: ['08:00', '09:40'], semester: 1 } }, dean).ok, true);
  store.insert('weekTemplate', { weekday: 2, slot: 1, subjectId: sb, roomId: '' });
  assert.equal(call('schedule.generate', {}, dean).ok, true);                     // four Tuesdays: 1, 8, 15, 22 September
  const lessons = () => store.list('pairs').map((p) => [p.topicId !== '', p.lessonType, p.part]);
  assert.deepEqual(lessons(), [[true, 'lecture', 1], [true, 'practice', 1], [false, '', null], [false, '', null]]);
  const lists = {};
  const list = store.list;
  store.list = (table) => { lists[table] = (lists[table] || 0) + 1; return list(table); };
  const done = call('import.apply', { table: 'subjects', cells: [['Дисциплина', 'Преподаватель', 'Группа'], ['Информатика', 'tea2', '01-1']] }, dean).data;
  store.list = list;
  assert.deepEqual([done.updated, done.errors], [1, []]);
  for (const [table, n] of Object.entries(lists)) assert.equal(n, 1, table);
  assert.deepEqual(lessons(), [[false, '', null], [false, '', null], [false, '', null], [false, '', null]]);   // NO_LESSON on every pair that is not held
  assert.deepEqual(store.list('pairs').map((p) => p.teacherId === t2), [true, true, true, true]);              // the future pairs follow the new teacher (I1)
});

test('a subjects import says how many pairs stayed with the old teacher because the new one teaches at that time (N3)', () => {
  const { store, call, dean } = setup();
  const g1 = store.list('groups')[0].id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  const teacher = (login) => store.insert('staff', { fullName: login, login, passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const t1 = teacher('tea1');
  const t2 = teacher('tea2');
  const ds = store.insert('disciplines', { name: 'Информатика' }).id;
  const ds2 = store.insert('disciplines', { name: 'Анатомия' }).id;
  const sb = store.insert('subjects', { name: 'Информатика', disciplineId: ds, groupId: g1, teacherId: t1, scheme: 'A' }).id;
  const other = store.insert('subjects', { name: 'Анатомия', disciplineId: ds2, groupId: g2, teacherId: t2, scheme: 'A' }).id;
  assert.equal(call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-09-25', holidays: [], bells: ['08:00', '09:40'], semester: 1 } }, dean).ok, true);
  store.insert('weekTemplate', { weekday: 2, slot: 1, subjectId: sb, roomId: '' });         // Tuesdays 1, 8, 15, 22 September
  store.insert('weekTemplate', { weekday: 3, slot: 1, subjectId: other, roomId: '' });
  assert.equal(call('schedule.generate', {}, dean).ok, true);
  // tea2 is moved by hand onto Tuesday 15 September, pair 1 (another group): that pair of «Информатика» cannot go to tea2
  const busy = store.list('pairs').find((x) => x.subjectId === other && x.date === '2026-09-16');
  assert.equal(call('schedule.changePair', { id: busy.id, date: '2026-09-15' }, dean).ok, true);
  const done = call('import.apply', { table: 'subjects', cells: [['Дисциплина', 'Преподаватель', 'Группа'], ['Информатика', 'tea2', '01-1']] }, dean).data;
  assert.deepEqual([done.updated, done.skippedBusy], [1, 1]);
  const teachers = store.list('pairs').filter((x) => x.subjectId === sb).sort((a, b) => a.date.localeCompare(b.date)).map((x) => [x.date, x.teacherId === t2]);
  assert.deepEqual(teachers, [['2026-09-01', true], ['2026-09-08', true], ['2026-09-15', false], ['2026-09-22', true]]);
  // other tables say nothing about pairs
  assert.equal('skippedBusy' in call('import.apply', { table: 'rooms', cells: [['Название'], ['101']] }, dean).data, false);
});

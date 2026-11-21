import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRow, validateRow } from '../core/validate.js';

const db = {
  groups: [{ id: 'g_1', name: '01-1', course: 1 }],
  students: [{ id: 'st_1', fullName: 'А', cardNo: 'S1001', groupId: 'g_1', lang: 'ky', active: true }],
  staff: [{ id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'admin', lang: 'ru', active: true }],
  subjects: [], rooms: [], disciplines: [{ id: 'ds_1', name: 'Информатика' }],
};

test('normalizeRow trims, collapses spaces, coerces types and applies defaults', () => {
  assert.deepEqual(normalizeRow('students', { fullName: '  Асанов   Азамат ', cardNo: 1002, groupId: 'g_1' }),
    { fullName: 'Асанов Азамат', cardNo: '1002', groupId: 'g_1', lang: 'ky', mustChangePassword: true, active: true });
});

test('normalizeRow orders roles by STAFF_ROLES and drops unknown keys', () => {
  const row = normalizeRow('staff', { fullName: 'Б', login: 'b', roles: 'teacher, dean', extra: 1, passwordHash: ' x ' });
  assert.equal(row.roles, 'dean,teacher');
  assert.equal(row.passwordHash, ' x ');
  assert.equal('extra' in row, false);
  assert.equal('id' in row, false);
});

test('normalizeRow defaults scheme for subjects', () => {
  assert.equal(normalizeRow('subjects', { name: 'X' }).scheme, 'A');
});

test('groups: duplicate name is case/space-insensitive', () => {
  assert.deepEqual(validateRow('groups', { name: ' 01-1 ', course: 1 }, db), [{ field: 'name', code: 'duplicate' }]);
});

test('groups: course out of range', () => {
  assert.deepEqual(validateRow('groups', { name: '02-1', course: 9 }, db), [{ field: 'course', code: 'bad_value' }]);
});

test('groups: too long name', () => {
  assert.deepEqual(validateRow('groups', { name: 'x'.repeat(201), course: 1 }, db), [{ field: 'name', code: 'too_long' }]);
});

test('students: errors come in schema column order', () => {
  assert.deepEqual(validateRow('students', { fullName: '', cardNo: 'ADMIN', groupId: 'g_x', lang: 'ky' }, db),
    [{ field: 'fullName', code: 'required' }, { field: 'groupId', code: 'bad_ref' }, { field: 'cardNo', code: 'duplicate' }]);
});

test('staff: cannot remove admin role from the last active admin', () => {
  assert.deepEqual(validateRow('staff', { id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'teacher', lang: 'ru', active: true }, db),
    [{ field: 'roles', code: 'last_admin' }]);
});

test('staff: cannot deactivate the last active admin', () => {
  assert.deepEqual(validateRow('staff', { id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'admin', lang: 'ru', active: false }, db),
    [{ field: 'active', code: 'last_admin' }]);
});

test('subjects: teacher must have the teacher role', () => {
  assert.deepEqual(validateRow('subjects', { name: 'Информатика', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }, db),
    [{ field: 'teacherId', code: 'bad_value' }]);
});

test('subjects: the discipline is a reference, once per group', () => {
  const sdb = {
    groups: [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '02-1', course: 2 }],
    staff: [{ id: 'sf_1', fullName: 'Иванов Иван', login: 'ivanov', roles: 'teacher', lang: 'ru', active: true }],
    disciplines: [{ id: 'ds_1', name: 'Информатика' }],
    subjects: [{ id: 'sb_1', name: 'Информатика', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }],
  };
  const subject = (patch) => validateRow('subjects', { name: '', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_2', scheme: 'A', ...patch }, sdb);
  assert.deepEqual(subject({}), []);                                                       // the name is not checked
  assert.deepEqual(subject({ disciplineId: '' }), [{ field: 'disciplineId', code: 'bad_ref' }]);
  assert.deepEqual(subject({ disciplineId: 'ds_x' }), [{ field: 'disciplineId', code: 'bad_ref' }]);
  assert.deepEqual(subject({ groupId: 'g_1' }), [{ field: 'disciplineId', code: 'duplicate' }]);
  assert.deepEqual(subject({ id: 'sb_1', groupId: 'g_1' }), []);
});

test('students: a row is not a duplicate of itself', () => {
  assert.deepEqual(validateRow('students', { id: 'st_1', fullName: 'А', cardNo: 's1001', groupId: 'g_1', lang: 'ky' }, db), []);
});

const wdb = {
  subjects: [{ id: 'sb_1', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1' }, { id: 'sb_2', name: 'Анатомия', teacherId: 'sf_2', groupId: 'g_1' },
    { id: 'sb_3', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_2' }, { id: 'sb_4', name: 'Анатомия', teacherId: 'sf_2', groupId: 'g_2' }],
  rooms: [{ id: 'r_1', name: '204' }, { id: 'r_2', name: '101' }],
  weekTemplate: [{ id: 'wt_1', weekday: 1, slot: 1, subjectId: 'sb_1', roomId: 'r_1' }],
  slotCount: 6,
};

test('weekTemplate rules', () => {
  const wt = (row) => validateRow('weekTemplate', row, wdb);
  assert.deepEqual(wt({ weekday: 1, slot: 2, subjectId: 'sb_2', roomId: 'r_1' }), []);
  assert.deepEqual(wt({ weekday: 2, slot: 1, subjectId: 'sb_1', roomId: '' }), []);
  assert.deepEqual(wt({ id: 'wt_1', weekday: 1, slot: 1, subjectId: 'sb_1', roomId: 'r_1' }), []);
  assert.deepEqual(wt({ weekday: 6, slot: 7, subjectId: 'sb_x', roomId: 'r_x' }), [{ field: 'weekday', code: 'bad_value' },
    { field: 'slot', code: 'bad_value' }, { field: 'subjectId', code: 'bad_ref' }, { field: 'roomId', code: 'bad_ref' }]);
  assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_2', roomId: 'r_2' }), [{ field: 'slot', code: 'group_busy' }]);
  assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_3', roomId: 'r_2' }), [{ field: 'subjectId', code: 'teacher_busy' }]);
  assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_4', roomId: 'r_1' }), [{ field: 'roomId', code: 'room_busy' }]);
});

test('weekTemplate: slot limit follows slotCount, falls back to MAX_SLOTS', () => {
  const row = { weekday: 1, slot: 7, subjectId: 'sb_2', roomId: '' };
  assert.deepEqual(validateRow('weekTemplate', row, wdb), [{ field: 'slot', code: 'bad_value' }]);
  const { slotCount, ...noCount } = wdb;
  assert.deepEqual(validateRow('weekTemplate', row, noCount), []);
});

test('topics have no rules: only the syllabus upload writes their rows; a syllabus gets no default semester', () => {
  assert.deepEqual(validateRow('topics', { name: '' }, {}), []);
  assert.equal('semester' in normalizeRow('syllabi', { disciplineId: 'ds_1' }), false);
});

test('subjects: a new teacher must be free at every template slot of the subject', () => {
  const sdb = {
    groups: [{ id: 'g_1' }, { id: 'g_2' }],
    staff: [{ id: 'sf_1', roles: 'teacher' }, { id: 'sf_2', roles: 'teacher' }],
    disciplines: [{ id: 'ds_1', name: 'Информатика' }, { id: 'ds_2', name: 'Анатомия' }],
    subjects: [{ id: 'sb_1', name: 'Информатика', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1' }, { id: 'sb_2', name: 'Анатомия', disciplineId: 'ds_2', teacherId: 'sf_2', groupId: 'g_2' }],
    weekTemplate: [{ id: 'wt_1', weekday: 1, slot: 1, subjectId: 'sb_1', roomId: '' }, { id: 'wt_2', weekday: 1, slot: 1, subjectId: 'sb_2', roomId: '' }],
  };
  const row = { id: 'sb_2', name: 'Анатомия', disciplineId: 'ds_2', groupId: 'g_2', scheme: 'A' };
  assert.deepEqual(validateRow('subjects', { ...row, teacherId: 'sf_1' }, sdb), [{ field: 'teacherId', code: 'teacher_busy' }]);
  assert.deepEqual(validateRow('subjects', { ...row, teacherId: 'sf_2' }, sdb), []);
  assert.deepEqual(validateRow('subjects', { ...row, teacherId: 'sf_1' }, { ...sdb, weekTemplate: undefined }), []);
});

test('disciplines rules', () => {
  const ddb = { disciplines: [{ id: 'ds_1', name: 'Информатика' }] };
  assert.deepEqual(validateRow('disciplines', { name: '' }, ddb), [{ field: 'name', code: 'required' }]);
  assert.deepEqual(validateRow('disciplines', { name: ' информатика ' }, ddb), [{ field: 'name', code: 'duplicate' }]);
  assert.deepEqual(validateRow('disciplines', { id: 'ds_1', name: 'Информатика и ИТ' }, ddb), []);
  assert.deepEqual(validateRow('disciplines', { name: 'x'.repeat(201) }, ddb), [{ field: 'name', code: 'too_long' }]);
});

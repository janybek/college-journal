import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRow, validateRow } from '../core/validate.js';

const db = {
  groups: [{ id: 'g_1', name: '01-1', course: 1 }],
  students: [{ id: 'st_1', fullName: 'А', cardNo: 'S1001', groupId: 'g_1', lang: 'ky', active: true }],
  staff: [{ id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'admin', lang: 'ru', active: true }],
  subjects: [], rooms: [],
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
  assert.deepEqual(validateRow('subjects', { name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }, db),
    [{ field: 'teacherId', code: 'bad_value' }]);
});

test('students: a row is not a duplicate of itself', () => {
  assert.deepEqual(validateRow('students', { id: 'st_1', fullName: 'А', cardNo: 's1001', groupId: 'g_1', lang: 'ky' }, db), []);
});

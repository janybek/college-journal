import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, tableNames } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'subjects', 'rooms', 'translations', 'settings']);
});

test('students sheet and column titles', () => {
  assert.equal(SCHEMA.students.sheet, 'Студенты');
  assert.deepEqual(SCHEMA.students.columns.map(c => c.title),
    ['id', 'ФИО', 'группа', '№ студ. билета', 'хэш пароля', 'язык', 'сменить пароль', 'активен']);
});

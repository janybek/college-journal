import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SEMESTERS, tableNames, PAIR_STATUSES, FIXED_STATUSES, LESSON_TYPES, WEEKDAYS } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate', 'topics', 'pairs']);
});

test('students sheet and column titles', () => {
  assert.equal(SCHEMA.students.sheet, 'Студенты');
  assert.deepEqual(SCHEMA.students.columns.map(c => c.title),
    ['id', 'ФИО', 'группа', '№ студ. билета', 'хэш пароля', 'язык', 'сменить пароль', 'активен']);
});

test('schedule tables', () => {
  assert.equal(SCHEMA.pairs.sheet, 'Пары');
  assert.deepEqual(SCHEMA.pairs.columns.map(c => c.title), ['id', 'дата', '№ пары', 'время начала', 'группа', 'предмет', 'преподаватель',
    'аудитория', 'тема', 'статус', 'дата по плану', '№ пары по плану', 'изменена вручную', 'примечание']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.title), ['id', 'предмет', 'юнит', '№ по порядку', 'название', 'тип пары', 'семестр']);
  assert.deepEqual(SEMESTERS, [1, 2]);
  assert.deepEqual(SCHEMA.weekTemplate.columns.map(c => c.title), ['id', 'день недели', '№ пары', 'предмет', 'аудитория']);
  assert.deepEqual(SCHEMA.pairs.columns.filter(c => c.type !== 'string').map(c => [c.key, c.type]),
    [['slot', 'int'], ['planSlot', 'int'], ['changed', 'bool']]);
  assert.deepEqual([SCHEMA.weekTemplate.prefix, SCHEMA.topics.prefix, SCHEMA.pairs.prefix], ['wt', 'tp', 'p']);
  assert.deepEqual(PAIR_STATUSES, ['planned', 'running', 'closed', 'missed', 'cancelled']);
  assert.deepEqual(FIXED_STATUSES, ['running', 'closed']);
  assert.deepEqual(LESSON_TYPES, ['lecture', 'practice', 'control']);
  assert.deepEqual(WEEKDAYS, [1, 2, 3, 4, 5]);
});

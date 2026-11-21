import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SEMESTERS, TOPIC_KINDS, PRACTICE_KINDS, tableNames, PAIR_STATUSES, FIXED_STATUSES, LESSON_TYPES, WEEKDAYS } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate', 'syllabi', 'topics', 'pairs']);
});

test('students sheet and column titles', () => {
  assert.equal(SCHEMA.students.sheet, 'Студенты');
  assert.deepEqual(SCHEMA.students.columns.map(c => c.title),
    ['id', 'ФИО', 'группа', '№ студ. билета', 'хэш пароля', 'язык', 'сменить пароль', 'активен']);
});

test('schedule tables', () => {
  assert.equal(SCHEMA.pairs.sheet, 'Пары');
  assert.deepEqual(SCHEMA.pairs.columns.map(c => c.title), ['id', 'дата', '№ пары', 'время начала', 'группа', 'предмет', 'преподаватель',
    'аудитория', 'тема', 'тип занятия', 'часть', 'статус', 'дата по плану', '№ пары по плану', 'изменена вручную', 'примечание']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.title),
    ['id', 'силлабус', '№ по порядку', 'юнит', '№ в силлабусе', 'название', 'лекция, ч', 'практика, ч', 'вид практики', 'СРС, ч', 'описание', 'вид строки', 'название юнита']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.key), ['id', 'syllabusId', 'order', 'unit', 'label', 'name', 'lectureHours', 'practiceHours', 'practiceKind', 'selfHours', 'description', 'kind', 'unitTitle']);
  assert.deepEqual(SEMESTERS, [1, 2]);
  assert.deepEqual(SCHEMA.weekTemplate.columns.map(c => c.title), ['id', 'день недели', '№ пары', 'предмет', 'аудитория']);
  assert.deepEqual(SCHEMA.pairs.columns.filter(c => c.type !== 'string').map(c => [c.key, c.type]),
    [['slot', 'int'], ['part', 'int'], ['planSlot', 'int'], ['changed', 'bool']]);
  assert.deepEqual([SCHEMA.weekTemplate.prefix, SCHEMA.topics.prefix, SCHEMA.pairs.prefix], ['wt', 'tp', 'p']);
  assert.deepEqual(PAIR_STATUSES, ['planned', 'running', 'closed', 'missed', 'cancelled']);
  assert.deepEqual(FIXED_STATUSES, ['running', 'closed']);
  assert.deepEqual(LESSON_TYPES, ['lecture', 'practice', 'control']);
  assert.deepEqual(WEEKDAYS, [1, 2, 3, 4, 5]);
});

test('disciplines sheet and subject discipline column', () => {
  assert.deepEqual([SCHEMA.disciplines.sheet, SCHEMA.disciplines.prefix, SCHEMA.disciplines.columns.map(c => c.title)], ['Дисциплины', 'ds', ['id', 'название']]);
  assert.deepEqual(SCHEMA.subjects.columns.map(c => c.title), ['id', 'название', 'преподаватель', 'группа', 'схема оценивания', 'дисциплина']);
});

test('syllabi sheet, pair lesson columns and kinds', () => {
  assert.deepEqual([SCHEMA.syllabi.sheet, SCHEMA.syllabi.prefix], ['Силлабусы', 'sy']);
  assert.deepEqual(SCHEMA.syllabi.columns.map(c => c.title),
    ['id', 'дисциплина', 'преподаватель', 'семестр', 'семестр по плану', 'специальность', 'кредиты', 'всего часов', 'аудиторных часов', 'часов СРС', 'обновлён']);
  const pairKeys = SCHEMA.pairs.columns.map(c => c.key);
  assert.deepEqual(pairKeys.slice(pairKeys.indexOf('topicId'), pairKeys.indexOf('topicId') + 3), ['topicId', 'lessonType', 'part']);
  assert.deepEqual([TOPIC_KINDS, PRACTICE_KINDS], [['topic', 'control'], ['', 'seminar', 'lab']]);
});

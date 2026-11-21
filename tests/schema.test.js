import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SEMESTERS, tableNames, PAIR_STATUSES, FIXED_STATUSES, LESSON_TYPES, WEEKDAYS, SYLLABUS_STATUSES, OPEN_STATUSES, LESSON_KINDS } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate',
    'syllabi', 'topics', 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules', 'pairs']);
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
    ['id', 'силлабус', '№ по порядку', 'юнит', 'вид занятия', 'название', 'часы', 'формы текущего контроля', 'СРС, ч', 'описание', 'название юнита', 'скопирована из']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.key),
    ['id', 'syllabusId', 'order', 'unit', 'lessonKind', 'name', 'hours', 'controlForms', 'selfHours', 'description', 'unitTitle', 'sourceId']);
  assert.deepEqual(SCHEMA.topics.columns.filter(c => c.type !== 'string').map(c => c.key), ['order', 'unit', 'hours', 'selfHours']);
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
  assert.deepEqual(SCHEMA.syllabi.columns.slice(0, 11).map(c => c.title),
    ['id', 'дисциплина', 'преподаватель', 'семестр', 'семестр по плану', 'специальность', 'кредиты', 'всего часов', 'аудиторных часов', 'часов СРС', 'обновлён']);
  const pairKeys = SCHEMA.pairs.columns.map(c => c.key);
  assert.deepEqual(pairKeys.slice(pairKeys.indexOf('topicId'), pairKeys.indexOf('topicId') + 3), ['topicId', 'lessonType', 'part']);
});

test('syllabus version fields and section sheets', () => {
  assert.deepEqual(SCHEMA.syllabi.columns.map((c) => c.key).slice(11), ['department', 'faculty', 'academicYear', 'course', 'contacts', 'place', 'goal',
    'status', 'version', 'remark', 'submittedBy', 'submittedAt', 'decidedBy', 'decidedAt', 'editedBy', 'manualOrder']);
  assert.deepEqual(SCHEMA.syllabi.columns.filter((c) => c.type !== 'string').map((c) => c.key),
    ['semester', 'planSemester', 'credits', 'totalHours', 'classHours', 'selfHours', 'course', 'version', 'manualOrder']);
  const sheet = (t) => [SCHEMA[t].sheet, SCHEMA[t].prefix, SCHEMA[t].columns.map((c) => c.key)];
  assert.deepEqual(sheet('units'), ['Юниты', 'un', ['id', 'syllabusId', 'unit', 'title', 'description', 'questions', 'guidance', 'results']]);
  assert.deepEqual(sheet('outcomes'), ['Результаты обучения', 'oc', ['id', 'syllabusId', 'kind', 'order', 'text']]);
  assert.deepEqual(sheet('selfWork'), ['СРС', 'sw', ['id', 'syllabusId', 'order', 'unit', 'name', 'tasks', 'hours']]);
  assert.deepEqual(sheet('literature'), ['Литература', 'lt', ['id', 'syllabusId', 'kind', 'unit', 'order', 'authors', 'title', 'year', 'publisher', 'availability']]);
  assert.deepEqual(sheet('software'), ['Программное обеспечение', 'so', ['id', 'syllabusId', 'order', 'name', 'link']]);
  assert.deepEqual(sheet('grading'), ['Оценивание', 'gr', ['id', 'syllabusId', 'order', 'name', 'maxPoints', 'rangeFail', 'rangeFair', 'rangeGood', 'rangeExcellent',
    'criteriaFail', 'criteriaFair', 'criteriaGood', 'criteriaExcellent']]);
  assert.deepEqual(sheet('rules'), ['Правила', 'rl', ['id', 'syllabusId', 'kind', 'order', 'text']]);
  assert.equal(new Set(tableNames().map((t) => SCHEMA[t].prefix)).size, tableNames().length);
  for (const t of tableNames()) assert.equal(new Set(SCHEMA[t].columns.map((c) => c.title)).size, SCHEMA[t].columns.length, t);
  assert.deepEqual([SYLLABUS_STATUSES, OPEN_STATUSES, LESSON_KINDS], [['draft', 'review', 'returned', 'approved', 'archived'], ['draft', 'review', 'returned'],
    ['lecture', 'practice', 'seminar', 'lab', 'control']]);
});

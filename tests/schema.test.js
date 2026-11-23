import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SEMESTERS, tableNames, PAIR_STATUSES, FIXED_STATUSES, LESSON_TYPES, WEEKDAYS, SYLLABUS_STATUSES, OPEN_STATUSES, LESSON_KINDS,
  ATTENDANCE_STATUSES, ATTENDED_STATUSES, MARK_SOURCES, CHECKIN_WAYS, CHECKIN_RESULTS, RESULT_FIELDS, LOG_ENTITIES, WORK_KINDS, WORK_STATUSES, FILE_STATES } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate',
    'syllabi', 'topics', 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules', 'pairs',
    'attendance', 'unitResults', 'changeLog', 'checkins', 'assignments', 'submissions', 'files']);
});

test('journal tables, substitute column and statuses', () => {
  assert.deepEqual(tableNames().slice(-7), ['attendance', 'unitResults', 'changeLog', 'checkins', 'assignments', 'submissions', 'files']);
  assert.deepEqual(SCHEMA.attendance.columns.map((c) => c.key), ['id', 'pairId', 'studentId', 'status', 'noCoat', 'activity', 'source', 'markedBy', 'markedAt']);
  assert.deepEqual(SCHEMA.unitResults.columns.map((c) => c.key), ['id', 'subjectId', 'studentId', 'planSemester', 'unit', 'control', 'self', 'currentManual', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.changeLog.columns.map((c) => c.key), ['id', 'at', 'actorId', 'entity', 'subjectId', 'pairId', 'studentId', 'unit', 'field', 'before', 'after', 'reason', 'late', 'assignmentId']);
  assert.deepEqual(SCHEMA.pairs.columns.slice(-7).map((c) => [c.key, c.type]), [['substitute', 'bool'], ['startedAt', 'string'], ['startedBy', 'string'],
    ['checkinUntil', 'string'], ['checkinClosed', 'bool'], ['finishedAt', 'string'], ['finishedBy', 'string']]);
  assert.equal(tableNames().at(-1), 'files');
  assert.deepEqual(SCHEMA.checkins.columns.map((c) => c.key), ['id', 'pairId', 'studentId', 'device', 'way', 'result', 'at']);
  assert.deepEqual([SCHEMA.checkins.sheet, SCHEMA.checkins.prefix], ['Отметки с телефона', 'ci']);
  assert.deepEqual([MARK_SOURCES, CHECKIN_WAYS, CHECKIN_RESULTS], [['teacher', 'code', 'qr', 'auto'], ['code', 'qr'], ['ok', 'wrong']]);
  assert.equal(new Set(Object.values(SCHEMA).map((d) => d.sheet)).size, tableNames().length);
  assert.equal(new Set(Object.values(SCHEMA).map((d) => d.prefix)).size, tableNames().length);
  assert.deepEqual(ATTENDANCE_STATUSES, ['present', 'late', 'absent', 'excused', 'madeup']);
  assert.deepEqual(ATTENDED_STATUSES, ['present', 'late', 'madeup']);
  assert.deepEqual(RESULT_FIELDS, ['control', 'self', 'current']);
  assert.deepEqual(LOG_ENTITIES, ['mark', 'unit', 'pair', 'work']);
});

test('students sheet and column titles', () => {
  assert.equal(SCHEMA.students.sheet, 'Студенты');
  assert.deepEqual(SCHEMA.students.columns.map(c => c.title),
    ['id', 'ФИО', 'группа', '№ студ. билета', 'хэш пароля', 'язык', 'сменить пароль', 'активен']);
});

test('schedule tables', () => {
  assert.equal(SCHEMA.pairs.sheet, 'Пары');
  assert.deepEqual(SCHEMA.pairs.columns.map(c => c.title), ['id', 'дата', '№ пары', 'время начала', 'группа', 'предмет', 'преподаватель',
    'аудитория', 'тема', 'тип занятия', 'часть', 'статус', 'дата по плану', '№ пары по плану', 'изменена вручную', 'примечание', 'замена',
    'фактический старт', 'кто начал', 'отметка до', 'отметка закрыта', 'пара закрыта', 'кто закрыл']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.title),
    ['id', 'силлабус', '№ по порядку', 'юнит', 'вид занятия', 'название', 'часы', 'формы текущего контроля', 'СРС, ч', 'описание', 'название юнита', 'скопирована из']);
  assert.deepEqual(SCHEMA.topics.columns.map(c => c.key),
    ['id', 'syllabusId', 'order', 'unit', 'lessonKind', 'name', 'hours', 'controlForms', 'selfHours', 'description', 'unitTitle', 'sourceId']);
  assert.deepEqual(SCHEMA.topics.columns.filter(c => c.type !== 'string').map(c => c.key), ['order', 'unit', 'hours', 'selfHours']);
  assert.deepEqual(SEMESTERS, [1, 2]);
  assert.deepEqual(SCHEMA.weekTemplate.columns.map(c => c.title), ['id', 'день недели', '№ пары', 'предмет', 'аудитория']);
  assert.deepEqual(SCHEMA.pairs.columns.filter(c => c.type !== 'string').map(c => [c.key, c.type]),
    [['slot', 'int'], ['part', 'int'], ['planSlot', 'int'], ['changed', 'bool'], ['substitute', 'bool'], ['checkinClosed', 'bool']]);
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

test('unit 5 tables: assignments, submissions, files, the work log column and the constants', () => {
  assert.deepEqual(tableNames().slice(-4), ['checkins', 'assignments', 'submissions', 'files']);
  assert.deepEqual(SCHEMA.assignments.columns.map((c) => c.key), ['id', 'subjectId', 'kind', 'planSemester', 'unit', 'topicId', 'pairId', 'title', 'description', 'dueAt', 'maxPoints', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.submissions.columns.map((c) => [c.key, c.type]).filter(([, t]) => t !== 'string'), [['n', 'int'], ['paper', 'bool'], ['points', 'int']]);
  assert.deepEqual(SCHEMA.files.columns.map((c) => c.key), ['id', 'assignmentId', 'submissionId', 'ownerId', 'state', 'name', 'kind', 'size', 'stored', 'at']);
  assert.deepEqual([SCHEMA.assignments.sheet, SCHEMA.submissions.sheet, SCHEMA.files.sheet, SCHEMA.assignments.prefix, SCHEMA.submissions.prefix, SCHEMA.files.prefix],
    ['Задания', 'Сдачи', 'Файлы', 'as', 'su', 'fl']);
  assert.equal(SCHEMA.changeLog.columns.at(-1).key, 'assignmentId');
  assert.deepEqual([WORK_KINDS, WORK_STATUSES, FILE_STATES, LOG_ENTITIES], [['hw', 'srs'], ['submitted', 'replaced', 'checked', 'returned'], ['pending', 'attached', 'dropped'], ['mark', 'unit', 'pair', 'work']]);
});

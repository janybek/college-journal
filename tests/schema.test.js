import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA, SEMESTERS, tableNames, PAIR_STATUSES, FIXED_STATUSES, LESSON_TYPES, WEEKDAYS, SYLLABUS_STATUSES, OPEN_STATUSES, LESSON_KINDS,
  REPEAT_KINDS, REPEAT_STATUSES, ATTENDANCE_STATUSES, ATTENDED_STATUSES, MARK_SOURCES, CHECKIN_WAYS, CHECKIN_RESULTS, RESULT_FIELDS, LOG_ENTITIES, WORK_KINDS, WORK_STATUSES, FILE_STATES, REQUEST_KINDS, EXAM_OUTCOMES, REQUEST_STATUSES, OPEN_REQUESTS, AUDIENCES } from '../core/schema.js';

test('tableNames lists tables in schema order', () => {
  assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate',
    'syllabi', 'topics', 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules', 'pairs',
    'attendance', 'unitResults', 'changeLog', 'checkins', 'assignments', 'submissions', 'files',
    'closures', 'requests', 'announcements', 'stateExams', 'stateExamResults', 'subjectExams', 'examAttempts', 'repeats', 'repeatAttempts',
    'syllabusLines']);
});

test('journal tables, substitute column and statuses', () => {
  assert.deepEqual(tableNames().slice(-17, -10), ['attendance', 'unitResults', 'changeLog', 'checkins', 'assignments', 'submissions', 'files']);
  assert.deepEqual(SCHEMA.attendance.columns.map((c) => c.key), ['id', 'pairId', 'studentId', 'status', 'noCoat', 'activity', 'source', 'markedBy', 'markedAt']);
  assert.deepEqual(SCHEMA.unitResults.columns.map((c) => c.key), ['id', 'subjectId', 'studentId', 'planSemester', 'unit', 'control', 'self', 'currentManual', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.changeLog.columns.map((c) => c.key), ['id', 'at', 'actorId', 'entity', 'subjectId', 'pairId', 'studentId', 'unit', 'field', 'before', 'after', 'reason', 'late', 'assignmentId', 'requestId', 'examId']);
  assert.deepEqual(SCHEMA.pairs.columns.slice(-7).map((c) => [c.key, c.type]), [['substitute', 'bool'], ['startedAt', 'string'], ['startedBy', 'string'],
    ['checkinUntil', 'string'], ['checkinClosed', 'bool'], ['finishedAt', 'string'], ['finishedBy', 'string']]);
  assert.equal(tableNames().at(-4), 'examAttempts');
  assert.deepEqual(SCHEMA.checkins.columns.map((c) => c.key), ['id', 'pairId', 'studentId', 'device', 'way', 'result', 'at']);
  assert.deepEqual([SCHEMA.checkins.sheet, SCHEMA.checkins.prefix], ['Отметки с телефона', 'ci']);
  assert.deepEqual([MARK_SOURCES, CHECKIN_WAYS, CHECKIN_RESULTS], [['teacher', 'code', 'qr', 'auto'], ['code', 'qr'], ['ok', 'wrong']]);
  assert.equal(new Set(Object.values(SCHEMA).map((d) => d.sheet)).size, tableNames().length);
  assert.equal(new Set(Object.values(SCHEMA).map((d) => d.prefix)).size, tableNames().length);
  assert.deepEqual(ATTENDANCE_STATUSES, ['present', 'late', 'absent', 'excused', 'madeup']);
  assert.deepEqual(ATTENDED_STATUSES, ['present', 'late', 'madeup']);
  assert.deepEqual(RESULT_FIELDS, ['control', 'self', 'current']);
  assert.deepEqual(LOG_ENTITIES, ['mark', 'unit', 'pair', 'work', 'ledger', 'exam', 'subjectExam', 'repeat']);
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
    'status', 'version', 'remark', 'submittedBy', 'submittedAt', 'decidedBy', 'decidedAt', 'editedBy', 'manualOrder', 'fileId', 'lineId', 'sourceId']);
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
  assert.deepEqual(tableNames().slice(-14, -10), ['checkins', 'assignments', 'submissions', 'files']);
  assert.deepEqual(SCHEMA.assignments.columns.map((c) => c.key), ['id', 'subjectId', 'kind', 'planSemester', 'unit', 'topicId', 'pairId', 'title', 'description', 'dueAt', 'maxPoints', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.submissions.columns.map((c) => [c.key, c.type]).filter(([, t]) => t !== 'string'), [['n', 'int'], ['paper', 'bool'], ['points', 'int']]);
  assert.deepEqual(SCHEMA.files.columns.map((c) => c.key), ['id', 'assignmentId', 'submissionId', 'ownerId', 'state', 'name', 'kind', 'size', 'stored', 'at']);
  assert.deepEqual([SCHEMA.assignments.sheet, SCHEMA.submissions.sheet, SCHEMA.files.sheet, SCHEMA.assignments.prefix, SCHEMA.submissions.prefix, SCHEMA.files.prefix],
    ['Задания', 'Сдачи', 'Файлы', 'as', 'su', 'fl']);
  assert.equal(SCHEMA.changeLog.columns.at(-3).key, 'assignmentId');
  assert.deepEqual([WORK_KINDS, WORK_STATUSES, FILE_STATES, LOG_ENTITIES], [['hw', 'srs'], ['submitted', 'replaced', 'checked', 'returned'], ['pending', 'attached', 'dropped', 'syllabus'], ['mark', 'unit', 'pair', 'work', 'ledger', 'exam', 'subjectExam', 'repeat']]);
});

test('unit 6 tables: closures, requests, announcements, state exams, subject exams, attempts and the constants', () => {
  assert.deepEqual(tableNames().slice(-11, -3), ['files', 'closures', 'requests', 'announcements', 'stateExams', 'stateExamResults', 'subjectExams', 'examAttempts']);
  assert.deepEqual(SCHEMA.subjectExams.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['subjectId', 'string'], ['planSemester', 'int'], ['date', 'string'], ['examiner', 'string'], ['assistants', 'string'], ['updatedBy', 'string'], ['updatedAt', 'string']]);
  assert.deepEqual(SCHEMA.examAttempts.columns.map((c) => c.key), ['id', 'subjectId', 'planSemester', 'studentId', 'no', 'date', 'outcome', 'score', 'commission', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.examAttempts.columns.filter((c) => c.type !== 'string').map((c) => [c.key, c.type]), [['planSemester', 'int'], ['no', 'int'], ['score', 'int']]);
  assert.deepEqual(['subjectExams', 'examAttempts'].map((t) => [SCHEMA[t].sheet, SCHEMA[t].prefix]), [['Экзамены предметов', 'xe'], ['Попытки экзамена', 'xa']]);
  assert.deepEqual(EXAM_OUTCOMES, ['score', 'absent', 'incomplete']);
  assert.deepEqual(SCHEMA.closures.columns.map((c) => c.key), ['id', 'subjectId', 'planSemester', 'unit', 'closedBy', 'closedAt', 'reopenedBy', 'reopenedAt']);
  assert.deepEqual(SCHEMA.requests.columns.map((c) => c.key), ['id', 'kind', 'subjectId', 'planSemester', 'unit', 'pairId', 'assignmentId', 'attemptId', 'studentId', 'before', 'after', 'reason',
    'authorId', 'createdAt', 'status', 'deanBy', 'deanAt', 'finalBy', 'finalAt', 'closedAt', 'closeNote']);
  assert.deepEqual(SCHEMA.requests.columns.filter((c) => c.type !== 'string').map((c) => [c.key, c.type]), [['planSemester', 'int'], ['unit', 'int']]);
  assert.deepEqual(SCHEMA.announcements.columns.map((c) => c.key), ['id', 'authorId', 'audience', 'groupId', 'title', 'text', 'createdAt', 'expiresOn', 'removedBy', 'removedAt']);
  assert.deepEqual(SCHEMA.stateExams.columns.map((c) => c.key), ['id', 'groupId', 'name', 'date', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt']);
  assert.deepEqual(SCHEMA.stateExamResults.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['examId', 'string'], ['studentId', 'string'], ['score', 'int'], ['updatedBy', 'string'], ['updatedAt', 'string']]);
  assert.deepEqual(['closures', 'requests', 'announcements', 'stateExams', 'stateExamResults'].map((t) => [SCHEMA[t].sheet, SCHEMA[t].prefix]),
    [['Закрытые юниты', 'cu'], ['Заявки', 'rq'], ['Объявления', 'an'], ['Гос. экзамены', 'se'], ['Результаты гос. экзаменов', 'sr']]);
  assert.deepEqual(SCHEMA.changeLog.columns.slice(-3).map((c) => c.key), ['assignmentId', 'requestId', 'examId']);
  assert.deepEqual([LOG_ENTITIES, REQUEST_KINDS, REQUEST_STATUSES, OPEN_REQUESTS, AUDIENCES],
    [['mark', 'unit', 'pair', 'work', 'ledger', 'exam', 'subjectExam', 'repeat'], ['mark', 'current', 'self', 'control', 'work', 'exam'], ['dean', 'prorector', 'applied', 'rejected', 'stale', 'withdrawn'], ['dean', 'prorector'], ['all', 'teachers', 'group']]);
});

test('repeat course tables: repeats, repeatAttempts and the constants', () => {
  assert.deepEqual(tableNames().slice(-3, -1), ['repeats', 'repeatAttempts']);
  assert.deepEqual(SCHEMA.repeats.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['studentId', 'string'], ['subjectId', 'string'], ['planSemester', 'int'],
    ['kind', 'string'], ['orderNo', 'string'], ['orderDate', 'string'], ['deadline', 'string'], ['teacherId', 'string'], ['prevSemester', 'int'], ['prevAdmitted', 'bool'],
    ['prevStatus', 'string'], ['prevExam', 'int'], ['prevTotal', 'int'], ['prevWord', 'string'], ['prevAttempts', 'string'], ['prevRepeatId', 'string'], ['works', 'int'],
    ['worksNote', 'string'], ['status', 'string'], ['createdBy', 'string'], ['createdAt', 'string'], ['updatedBy', 'string'], ['updatedAt', 'string'], ['closedBy', 'string'], ['closedAt', 'string']]);
  assert.deepEqual(SCHEMA.repeatAttempts.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['repeatId', 'string'], ['no', 'int'], ['date', 'string'], ['outcome', 'string'],
    ['score', 'int'], ['commission', 'string'], ['updatedBy', 'string'], ['updatedAt', 'string']]);
  assert.deepEqual(['repeats', 'repeatAttempts'].map((t) => [SCHEMA[t].sheet, SCHEMA[t].prefix]), [['Повторный курс', 'rp'], ['Попытки экзамена повтора', 'rx']]);
  assert.deepEqual([REPEAT_KINDS, REPEAT_STATUSES], [['full', 'exam'], ['open', 'passed', 'failed', 'cancelled']]);
  assert.ok(LOG_ENTITIES.includes('repeat'));
});

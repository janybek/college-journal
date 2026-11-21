export const STAFF_ROLES = ['admin', 'dean', 'prorector', 'teacher'];
export const LANGS = ['ky', 'ru', 'en'];
export const DEFAULT_LANG = 'ky';
export const PAIR_STATUSES = ['planned', 'running', 'closed', 'missed', 'cancelled'];
export const FIXED_STATUSES = ['running', 'closed'];
export const LESSON_TYPES = ['lecture', 'practice', 'control'];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const SEMESTERS = [1, 2];
export const TOPIC_KINDS = ['topic', 'control'];
export const PRACTICE_KINDS = ['', 'seminar', 'lab'];
export const SYLLABUS_STATUSES = ['draft', 'review', 'returned', 'approved', 'archived'];
export const OPEN_STATUSES = ['draft', 'review', 'returned'];
export const LESSON_KINDS = ['lecture', 'practice', 'seminar', 'lab', 'control'];
export const OUTCOME_KINDS = ['knowledge', 'skill', 'attitude', 'prerequisite', 'postrequisite'];
export const LITERATURE_KINDS = ['main', 'extra'];
export const RULE_KINDS = ['behavior', 'ethics', 'sanction_behavior', 'sanction_ethics'];

const col = (key, title, type = 'string') => ({ key, title, type });

export const SCHEMA = {
  groups: {
    sheet: 'Группы', prefix: 'g',
    columns: [col('id', 'id'), col('name', 'название'), col('course', 'курс', 'int')],
  },
  students: {
    sheet: 'Студенты', prefix: 'st',
    columns: [
      col('id', 'id'), col('fullName', 'ФИО'), col('groupId', 'группа'), col('cardNo', '№ студ. билета'),
      col('passwordHash', 'хэш пароля'), col('lang', 'язык'),
      col('mustChangePassword', 'сменить пароль', 'bool'), col('active', 'активен', 'bool'),
    ],
  },
  staff: {
    sheet: 'Сотрудники', prefix: 'sf',
    columns: [
      col('id', 'id'), col('fullName', 'ФИО'), col('login', 'логин'), col('passwordHash', 'хэш пароля'),
      col('roles', 'роли'), col('lang', 'язык'),
      col('mustChangePassword', 'сменить пароль', 'bool'), col('active', 'активен', 'bool'),
    ],
  },
  disciplines: {
    sheet: 'Дисциплины', prefix: 'ds',
    columns: [col('id', 'id'), col('name', 'название')],
  },
  subjects: {
    sheet: 'Предметы', prefix: 'sb',
    columns: [
      col('id', 'id'), col('name', 'название'), col('teacherId', 'преподаватель'),
      col('groupId', 'группа'), col('scheme', 'схема оценивания'), col('disciplineId', 'дисциплина'),
    ],
  },
  rooms: {
    sheet: 'Аудитории', prefix: 'r',
    columns: [col('id', 'id'), col('name', 'название')],
  },
  translations: {
    sheet: 'Переводы', prefix: 'tr',
    columns: [
      col('id', 'id'), col('key', 'ключ'), col('ky', 'кыргызский'),
      col('ru', 'русский'), col('en', 'английский'),
    ],
  },
  settings: {
    sheet: 'Настройки', prefix: 'cfg',
    columns: [col('id', 'id'), col('key', 'ключ'), col('value', 'значение')],
  },
  weekTemplate: {
    sheet: 'Шаблон недели', prefix: 'wt',
    columns: [
      col('id', 'id'), col('weekday', 'день недели', 'int'), col('slot', '№ пары', 'int'),
      col('subjectId', 'предмет'), col('roomId', 'аудитория'),
    ],
  },
  syllabi: {
    sheet: 'Силлабусы', prefix: 'sy',
    columns: [
      col('id', 'id'), col('disciplineId', 'дисциплина'), col('teacherId', 'преподаватель'), col('semester', 'семестр', 'int'),
      col('planSemester', 'семестр по плану', 'int'), col('audience', 'специальность'), col('credits', 'кредиты', 'int'),
      col('totalHours', 'всего часов', 'int'), col('classHours', 'аудиторных часов', 'int'), col('selfHours', 'часов СРС', 'int'),
      col('updated', 'обновлён'),
      col('department', 'кафедра'), col('faculty', 'факультет'), col('academicYear', 'учебный год'), col('course', 'курс', 'int'),
      col('contacts', 'контакты преподавателя'), col('place', 'место проведения'), col('goal', 'цель курса'), col('status', 'статус'),
      col('version', 'версия', 'int'), col('remark', 'замечание деканата'), col('submittedBy', 'отправил'), col('submittedAt', 'отправлен'),
      col('decidedBy', 'решение принял'), col('decidedAt', 'дата решения'), col('editedBy', 'правил'),
      col('manualOrder', 'порядок задан вручную', 'bool'),
    ],
  },
  topics: {
    sheet: 'Темы', prefix: 'tp',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('order', '№ по порядку', 'int'), col('unit', 'юнит', 'int'),
      col('label', '№ в силлабусе'), col('name', 'название'), col('lectureHours', 'лекция, ч', 'int'),
      col('practiceHours', 'практика, ч', 'int'), col('practiceKind', 'вид практики'), col('selfHours', 'СРС, ч', 'int'),
      col('description', 'описание'), col('kind', 'вид строки'), col('unitTitle', 'название юнита'),
    ],
  },
  units: {
    sheet: 'Юниты', prefix: 'un',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('unit', 'юнит', 'int'), col('title', 'название'), col('description', 'описание'),
      col('questions', 'ключевые вопросы'), col('guidance', 'методические указания'), col('results', 'ожидаемые результаты'),
    ],
  },
  outcomes: {
    sheet: 'Результаты обучения', prefix: 'oc',
    columns: [col('id', 'id'), col('syllabusId', 'силлабус'), col('kind', 'вид'), col('order', '№ по порядку', 'int'), col('text', 'текст')],
  },
  selfWork: {
    sheet: 'СРС', prefix: 'sw',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('order', '№ по порядку', 'int'), col('unit', 'юнит', 'int'),
      col('name', 'название'), col('tasks', 'задания'), col('hours', 'часы', 'int'),
    ],
  },
  literature: {
    sheet: 'Литература', prefix: 'lt',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('kind', 'вид'), col('unit', 'юнит', 'int'), col('order', '№ по порядку', 'int'),
      col('authors', 'авторы'), col('title', 'заглавие'), col('year', 'год'), col('publisher', 'издательство'), col('availability', 'наличие'),
    ],
  },
  software: {
    sheet: 'Программное обеспечение', prefix: 'so',
    columns: [col('id', 'id'), col('syllabusId', 'силлабус'), col('order', '№ по порядку', 'int'), col('name', 'название'), col('link', 'ссылка')],
  },
  grading: {
    sheet: 'Оценивание', prefix: 'gr',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('order', '№ по порядку', 'int'), col('name', 'вид контроля'),
      col('maxPoints', 'максимум баллов', 'int'), col('rangeFail', 'неуд., баллы'), col('rangeFair', 'удовл., баллы'),
      col('rangeGood', 'хорошо, баллы'), col('rangeExcellent', 'отлично, баллы'), col('criteriaFail', 'неуд., критерии'),
      col('criteriaFair', 'удовл., критерии'), col('criteriaGood', 'хорошо, критерии'), col('criteriaExcellent', 'отлично, критерии'),
    ],
  },
  rules: {
    sheet: 'Правила', prefix: 'rl',
    columns: [col('id', 'id'), col('syllabusId', 'силлабус'), col('kind', 'вид'), col('order', '№ по порядку', 'int'), col('text', 'текст')],
  },
  pairs: {
    sheet: 'Пары', prefix: 'p',
    columns: [
      col('id', 'id'), col('date', 'дата'), col('slot', '№ пары', 'int'), col('startTime', 'время начала'),
      col('groupId', 'группа'), col('subjectId', 'предмет'), col('teacherId', 'преподаватель'), col('roomId', 'аудитория'),
      col('topicId', 'тема'), col('lessonType', 'тип занятия'), col('part', 'часть', 'int'), col('status', 'статус'), col('planDate', 'дата по плану'),
      col('planSlot', '№ пары по плану', 'int'), col('changed', 'изменена вручную', 'bool'), col('note', 'примечание'),
    ],
  },
};

export function tableNames() {
  return Object.keys(SCHEMA);
}

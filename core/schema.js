export const STAFF_ROLES = ['admin', 'dean', 'prorector', 'teacher'];
export const LANGS = ['ky', 'ru', 'en'];
export const DEFAULT_LANG = 'ky';
export const PAIR_STATUSES = ['planned', 'running', 'closed', 'missed', 'cancelled'];
export const FIXED_STATUSES = ['running', 'closed'];
export const LESSON_TYPES = ['lecture', 'practice', 'control'];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const SEMESTERS = [1, 2];
export const SYLLABUS_STATUSES = ['draft', 'review', 'returned', 'approved', 'archived'];
export const OPEN_STATUSES = ['draft', 'review', 'returned'];
export const LESSON_KINDS = ['lecture', 'practice', 'seminar', 'lab', 'control'];
export const OUTCOME_KINDS = ['knowledge', 'skill', 'attitude', 'prerequisite', 'postrequisite'];
export const LITERATURE_KINDS = ['main', 'extra'];
export const RULE_KINDS = ['behavior', 'ethics', 'sanction_behavior', 'sanction_ethics'];
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];   // был, опоздал, не был, уважительная причина, отработано
export const ATTENDED_STATUSES = ['present', 'late', 'madeup'];
export const MARK_SOURCES = ['teacher', 'code', 'qr', 'auto'];   // рукой, по коду, по QR, «не был» в конце окна
export const CHECKIN_WAYS = ['code', 'qr'];
export const CHECKIN_RESULTS = ['ok', 'wrong'];
export const RESULT_FIELDS = ['control', 'self', 'current'];
export const WORK_KINDS = ['hw', 'srs'];                                   // ДЗ, СРС
export const WORK_STATUSES = ['submitted', 'replaced', 'checked', 'returned']; // сдано, заменено новой попыткой, проверено, возвращено
export const FILE_STATES = ['pending', 'attached', 'dropped', 'syllabus'];             // загружен и ждёт «Сдать», в сдаче, убран студентом
export const LOG_ENTITIES = ['mark', 'unit', 'pair', 'work', 'ledger', 'exam', 'subjectExam', 'repeat'];   // 'exam' - гос. экзамен, 'subjectExam' - экзамен предмета
export const REQUEST_KINDS = ['mark', 'current', 'self', 'control', 'work', 'exam'];   // отметка пары, ТК вручную, СРС вручную, рубежный, баллы задания СРС, результат экзамена предмета
export const EXAM_OUTCOMES = ['score', 'absent', 'incomplete'];                    // баллы, «не явился(ась)», «I»
export const REQUEST_STATUSES = ['dean', 'prorector', 'applied', 'rejected', 'stale', 'withdrawn'];
export const OPEN_REQUESTS = ['dean', 'prorector'];                                // ждёт деканат, ждёт проректора
export const AUDIENCES = ['all', 'teachers', 'group'];
export const REPEAT_KINDS = ['full', 'exam'];                          // весь предмет, только экзамен
export const REPEAT_STATUSES = ['open', 'passed', 'failed', 'cancelled']; // идёт, сдал, не сдал, отменён

const col =(key, title, type = 'string') => ({ key, title, type });

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
      col('manualOrder', 'порядок задан вручную', 'bool'), col('fileId', 'файл силлабуса'),
    ],
  },
  topics: {
    sheet: 'Темы', prefix: 'tp',
    columns: [
      col('id', 'id'), col('syllabusId', 'силлабус'), col('order', '№ по порядку', 'int'), col('unit', 'юнит', 'int'),
      col('lessonKind', 'вид занятия'), col('name', 'название'), col('hours', 'часы', 'int'),
      col('controlForms', 'формы текущего контроля'), col('selfHours', 'СРС, ч', 'int'), col('description', 'описание'),
      col('unitTitle', 'название юнита'), col('sourceId', 'скопирована из'),
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
      col('substitute', 'замена', 'bool'),
      col('startedAt', 'фактический старт'), col('startedBy', 'кто начал'), col('checkinUntil', 'отметка до'),
      col('checkinClosed', 'отметка закрыта', 'bool'), col('finishedAt', 'пара закрыта'), col('finishedBy', 'кто закрыл'),
    ],
  },
  attendance: {
    sheet: 'Посещаемость', prefix: 'at',
    columns: [col('id', 'id'), col('pairId', 'пара'), col('studentId', 'студент'), col('status', 'статус'),
      col('noCoat', 'без халата', 'bool'), col('activity', 'активность', 'int'), col('source', 'как отмечено'),
      col('markedBy', 'кто отметил'), col('markedAt', 'когда отмечено')],
  },
  unitResults: {
    sheet: 'Итоги юнитов', prefix: 'ur',
    columns: [col('id', 'id'), col('subjectId', 'предмет'), col('studentId', 'студент'), col('planSemester', 'семестр по плану', 'int'),
      col('unit', 'юнит', 'int'), col('control', 'рубежный контроль', 'int'), col('self', 'СРС', 'int'),
      col('currentManual', 'текущий контроль вручную', 'int'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
  changeLog: {
    sheet: 'Журнал изменений', prefix: 'cl',
    columns: [col('id', 'id'), col('at', 'когда'), col('actorId', 'кто'), col('entity', 'что'), col('subjectId', 'предмет'),
      col('pairId', 'пара'), col('studentId', 'студент'), col('unit', 'юнит', 'int'), col('field', 'поле'),
      col('before', 'было'), col('after', 'стало'), col('reason', 'причина'), col('late', 'после срока', 'bool'), col('assignmentId', 'задание'),
      col('requestId', 'заявка'), col('examId', 'гос. экзамен')],
  },
  checkins: {
    sheet: 'Отметки с телефона', prefix: 'ci',
    columns: [col('id', 'id'), col('pairId', 'пара'), col('studentId', 'студент'), col('device', 'устройство'),
      col('way', 'как'), col('result', 'результат'), col('at', 'когда')],
  },
  assignments: {
    sheet: 'Задания', prefix: 'as',
    columns: [col('id', 'id'), col('subjectId', 'предмет'), col('kind', 'тип'), col('planSemester', 'семестр по плану', 'int'),
      col('unit', 'юнит', 'int'), col('topicId', 'тема'), col('pairId', 'выдано на паре'), col('title', 'название'),
      col('description', 'описание'), col('dueAt', 'срок сдачи'), col('maxPoints', 'максимум баллов', 'int'),
      col('createdBy', 'кто выдал'), col('createdAt', 'когда выдано'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
  submissions: {
    sheet: 'Сдачи', prefix: 'su',
    columns: [col('id', 'id'), col('assignmentId', 'задание'), col('studentId', 'студент'), col('n', 'попытка', 'int'),
      col('text', 'текст'), col('paper', 'на бумаге', 'bool'), col('submittedAt', 'когда сдано'), col('status', 'статус'),
      col('points', 'баллы', 'int'), col('comment', 'комментарий'), col('checkedBy', 'кто проверил'), col('checkedAt', 'когда проверено')],
  },
  files: {
    sheet: 'Файлы', prefix: 'fl',
    // ownerId: id студента; у строки состояния 'syllabus' — id сотрудника, прикрепившего файл (id sf… и st… не пересекаются)
    columns: [col('id', 'id'), col('assignmentId', 'задание'), col('submissionId', 'сдача'), col('ownerId', 'студент'),
      col('state', 'состояние'), col('name', 'имя файла'), col('kind', 'вид'), col('size', 'размер, байт', 'int'),
      col('stored', 'имя на диске'), col('at', 'когда загружен')],
  },
  closures: {
    sheet: 'Закрытые юниты', prefix: 'cu',
    columns: [col('id', 'id'), col('subjectId', 'предмет'), col('planSemester', 'семестр по плану', 'int'), col('unit', 'юнит', 'int'),
      col('closedBy', 'кто закрыл'), col('closedAt', 'когда закрыт'), col('reopenedBy', 'кто открыл'), col('reopenedAt', 'когда открыт')],
  },
  requests: {
    sheet: 'Заявки', prefix: 'rq',
    columns: [col('id', 'id'), col('kind', 'что меняется'), col('subjectId', 'предмет'), col('planSemester', 'семестр по плану', 'int'),
      col('unit', 'юнит', 'int'), col('pairId', 'пара'), col('assignmentId', 'задание'), col('attemptId', 'попытка'), col('studentId', 'студент'),
      col('before', 'было'), col('after', 'стало'), col('reason', 'причина'), col('authorId', 'кто подал'), col('createdAt', 'когда подана'),
      col('status', 'состояние'), col('deanBy', 'деканат: кто'), col('deanAt', 'деканат: когда'), col('finalBy', 'проректор: кто'),
      col('finalAt', 'проректор: когда'), col('closedAt', 'когда закрыта'), col('closeNote', 'причина отказа')],
  },
  announcements: {
    sheet: 'Объявления', prefix: 'an',
    columns: [col('id', 'id'), col('authorId', 'кто написал'), col('audience', 'кому'), col('groupId', 'группа'), col('title', 'заголовок'),
      col('text', 'текст'), col('createdAt', 'когда написано'), col('expiresOn', 'показывать до'), col('removedBy', 'кто убрал'), col('removedAt', 'когда убрано')],
  },
  stateExams: {
    sheet: 'Гос. экзамены', prefix: 'se',
    columns: [col('id', 'id'), col('groupId', 'группа'), col('name', 'название'), col('date', 'дата'),
      col('createdBy', 'кто создал'), col('createdAt', 'когда создан'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменён')],
  },
  stateExamResults: {
    sheet: 'Результаты гос. экзаменов', prefix: 'sr',
    columns: [col('id', 'id'), col('examId', 'экзамен'), col('studentId', 'студент'), col('score', 'баллы', 'int'),
      col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
  subjectExams: {
    sheet: 'Экзамены предметов', prefix: 'xe',
    columns: [col('id', 'id'), col('subjectId', 'предмет'), col('planSemester', 'семестр по плану', 'int'), col('date', 'дата экзамена'),
      col('examiner', 'экзаменатор'), col('assistants', 'ассистенты'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
  examAttempts: {
    sheet: 'Попытки экзамена', prefix: 'xa',
    columns: [col('id', 'id'), col('subjectId', 'предмет'), col('planSemester', 'семестр по плану', 'int'), col('studentId', 'студент'),
      col('no', 'номер попытки', 'int'), col('date', 'дата'), col('outcome', 'результат'), col('score', 'баллы', 'int'),
      col('commission', 'комиссия'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
  repeats: {
    sheet: 'Повторный курс', prefix: 'rp',
    columns: [col('id', 'id'), col('studentId', 'студент'), col('subjectId', 'предмет'), col('planSemester', 'семестр по плану', 'int'), col('kind', 'вид'),
      col('orderNo', 'приказ №'), col('orderDate', 'дата приказа'), col('deadline', 'срок'), col('teacherId', 'преподаватель повтора'),
      col('prevSemester', 'прежний семестр', 'int'), col('prevAdmitted', 'прежний допуск', 'bool'), col('prevStatus', 'прежний результат'), col('prevExam', 'прежний экзамен', 'int'),
      col('prevTotal', 'прежний итог', 'int'), col('prevWord', 'прежняя оценка'), col('prevAttempts', 'прежние попытки'), col('prevRepeatId', 'снимок из повтора'),
      col('works', 'работы повтора', 'int'), col('worksNote', 'что сделано'), col('status', 'состояние'),
      col('createdBy', 'кто записал'), col('createdAt', 'когда записан'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено'),
      col('closedBy', 'кто закрыл'), col('closedAt', 'когда закрыт')],
  },
  repeatAttempts: {
    sheet: 'Попытки экзамена повтора', prefix: 'rx',
    columns: [col('id', 'id'), col('repeatId', 'повтор'), col('no', 'номер попытки', 'int'), col('date', 'дата'), col('outcome', 'результат'),
      col('score', 'баллы', 'int'), col('commission', 'комиссия'), col('updatedBy', 'кто изменил'), col('updatedAt', 'когда изменено')],
  },
};

export function tableNames() {
  return Object.keys(SCHEMA);
}

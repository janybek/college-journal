import { hashPassword } from '../core/auth.js';
import { addDays, addMinutes, localDate, localDateTime, localTime, minutesOf, mondayOf, parseLocalDateTime } from '../core/dates.js';
import { DEFAULT_BELLS, extraToRows, readSettings, settingsToRows } from '../core/settings.js';
import { readSplit } from '../core/scoring.js';
import { markText, pointsText } from '../core/requests.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { generateSchedule, relayout, todayOf } from '../backend/scheduleData.js';
import { publishSyllabusDoc, uploadSyllabus } from '../backend/syllabusUpload.js';
import { draftForm, saveSection, startDraft } from '../backend/syllabusDraft.js';
import { journalView, lastOf, readJournalRows, savePairMarks, saveUnitResults, writeMarks, writeUnitResult } from '../backend/journalData.js';
import { approveSyllabus, returnSyllabus, submitSyllabus } from '../backend/syllabusFlow.js';
import { saveAssignment } from '../backend/workData.js';
import { submitWork } from '../backend/workStudent.js';
import { uploadFile } from '../backend/workFiles.js';
import { gradeWork } from '../backend/workGrade.js';
import { currentAttempt } from '../core/work.js';
import { closeUnit, readLedgerRows } from '../backend/ledgerData.js';
import { enrol } from '../backend/repeatData.js';
import { closeRepeat, saveAttempt, saveWorks } from '../backend/repeatScores.js';
import { halfResults } from '../backend/repeatSnapshot.js';
import { createRequest, decideRequest } from '../backend/requestData.js';
import { saveStateExam, saveStateExamScores } from '../backend/stateExamData.js';
import { saveAnnouncement } from '../backend/announceData.js';
import { inviteMember } from '../backend/syllabusLines.js';
import { addMember } from '../backend/lineSwitch.js';

// One password for every fictional person of the dev stand.
export const DEV_PASSWORD = 'journal2026';

const GIVEN = [
  'Aidar', 'Aizada', 'Bakyt', 'Begimai', 'Chyngyz', 'Dinara', 'Eldar', 'Elmira', 'Kanat', 'Meerim', 'Nurlan',
  'Nurzat', 'Ruslan', 'Sezim', 'Talant', 'Ulan', 'Zhyldyz', 'Adilet', 'Gulnara', 'Iskender', 'Kymbat', 'Tilek',
];
const SURNAMES = [
  'Asanov', 'Bekov', 'Chynybekov', 'Duishenov', 'Ermekov', 'Isaev', 'Jumabaev', 'Kasymov', 'Mamytov', 'Orozov',
  'Sadykov', 'Toktogulov', 'Usenov',
];
// teacher1 teaches «Информатика» in 01-1 and 02-1 by one syllabus of the 1st semester, so both groups are on the 1st course.
// The student numbers keep their own prefix: S1001…, S2001…, S3001….
const GROUPS = [{ name: '01-1', course: 1, card: 1 }, { name: '02-1', course: 1, card: 2 }, { name: '03-1', course: 2, card: 3 }];
const STUDENTS_PER_GROUP = 22;
const STAFF = [
  { login: 'admin', fullName: 'Admin Demo', roles: 'admin' },
  { login: 'dean', fullName: 'Dean Demo', roles: 'dean,teacher' },
  { login: 'prorector', fullName: 'Prorector Demo', roles: 'prorector' },
  { login: 'teacher1', fullName: 'Teacher One', roles: 'teacher' },
  { login: 'teacher2', fullName: 'Teacher Two', roles: 'teacher' },
  { login: 'teacher3', fullName: 'Teacher Three', roles: 'teacher' },
];

// The names of the fictional people: Latin for the dev stand, Cyrillic for the demo data of the working base (same sets, same order).
const NAMES = {
  latin: { given: GIVEN, surnames: SURNAMES, staff: Object.fromEntries(STAFF.map((p) => [p.login, p.fullName])) },
  cyrillic: {
    given: ['Айдар', 'Айзада', 'Бакыт', 'Бегимай', 'Чынгыз', 'Динара', 'Эльдар', 'Эльмира', 'Канат', 'Мээрим', 'Нурлан',
      'Нурзат', 'Руслан', 'Сезим', 'Талант', 'Улан', 'Жылдыз', 'Адилет', 'Гульнара', 'Искендер', 'Кымбат', 'Тилек'],
    surnames: ['Асанов', 'Беков', 'Чыныбеков', 'Дуйшенов', 'Эрмеков', 'Исаев', 'Жумабаев', 'Касымов', 'Мамытов', 'Орозов',
      'Садыков', 'Токтогулов', 'Усенов'],
    staff: { admin: 'Администратор Демо', dean: 'Деканат Демо', prorector: 'Проректор Демо', teacher1: 'Преподаватель Один', teacher2: 'Преподаватель Два', teacher3: 'Преподаватель Три' },
  },
};

const PLAN_HEAD = ['Юнит', '№', 'Тема', 'Лекция, ч (1 пара = 2 ч)', 'Практика, ч (1 пара = 2 ч)', 'Вид занятия', 'СРС, ч', 'Описание'];
const sheetsOf = (info, rows) => [{ name: 'Сведения', cells: info }, { name: 'Тематический план', cells: [PLAN_HEAD, ...rows] }];

// The sample syllabus of «Информатика», semester 1 (fictional): 10 topics, 2 units, 18 pairs; the modules take no hours.
const syllabus1 = (teacher) => sheetsOf([
  ['Дисциплина', 'Информатика'], ['Преподаватель', teacher], ['Курс', 1], ['Семестр', 1], ['Специальность', 'Сестринское дело'],
  ['Кредиты', 2], ['Всего часов', 60], ['Аудиторных часов', 36], ['СРС, часов', 24],
], [
  [1, '1.1', 'Цифровой пост медсестры: введение в IT', 2, '', '', 2, 'Зачем медсестре компьютер: рабочее место, учётные записи, правила работы в кабинете.'],
  [1, '1.2', 'Рабочие программы: Windows, МИС и утилиты', 2, 2, '', 4, 'Окна, файлы и папки, запуск программ; знакомство с медицинской информационной системой.'],
  [1, '1.3', 'Защита данных: врачебная тайна и кибергигиена', 2, 2, 'семинар', 2, 'Пароли, блокировка рабочего места, что нельзя отправлять в мессенджерах.'],
  [1, '1.4', 'Медицинский поиск: справочники и инструкции', 2, 2, '', 2, 'Как быстро найти инструкцию к препарату и проверить источник.'],
  [1, '1.5', 'Телемедицина и «умные» гаджеты в практике', 2, '', '', 2, 'Дистанционный приём, тонометры и глюкометры с передачей данных.'],
  [1, '', 'Модуль 1 (рубежный контроль)', '', '', 'модуль', '', ''],
  [2, '2.1', 'Работа в МИС: электронная карта и регистратура', 2, 2, '', 2, 'Запись пациента, заполнение электронной карты, талон на приём.'],
  [2, '2.2', 'Аппаратное обеспечение: ПК и периферия', 2, 2, 'лабораторная', 2, 'Принтер, сканер, кабели: что проверить до вызова техника.'],
  [2, '2.3', 'Медицинский документооборот в Word и Excel', 2, 2, '', 4, 'Справка в Word и график дежурств в Excel по образцу.'],
  [2, '2.4', 'Файловая дисциплина: порядок на рабочем столе', 2, 2, '', 2, ''],
  [2, '2.5', 'Электронные таблицы: учёт лекарств и расчёт доз', 2, 2, '', 2, 'Таблица учёта препаратов, формулы для расчёта дозы.'],
  [2, '', 'Модуль 2 (рубежный контроль)', '', '', 'модуль', '', ''],
]);

// Semester 2 (plan semester 2) of the same discipline: laid over pairs only when the owner switches the semester.
const syllabus2 = (teacher) => sheetsOf([
  ['Дисциплина', 'Информатика'], ['Преподаватель', teacher], ['Курс', 1], ['Семестр', 2], ['Специальность', 'Сестринское дело'],
  ['Кредиты', 1], ['Всего часов', 30], ['Аудиторных часов', 16], ['СРС, часов', 14],
], [
  [1, '1.1', 'Электронные рецепты и льготные лекарства', 2, 2, '', 4, 'Как выписывается и проверяется электронный рецепт.'],
  [1, '1.2', 'Презентация для пациента: памятка и санбюллетень', '', 2, '', 2, 'Короткая памятка для пациента в программе для презентаций.'],
  [2, '2.1', 'Электронная очередь и запись на приём', 2, 2, '', 4, 'Талон, расписание приёма, отмена записи.'],
  [2, '2.2', 'Итоговый проект: цифровой пост отделения', '', 4, '', 4, 'Проект на две пары подряд: рабочее место поста от начала до конца.'],
  [2, '', 'Экзамен', '', 2, 'модуль', '', ''],
]);

// The sections of the approved syllabus of «Информатика», semester 1 (fictional): everything the form has besides the file.
const BOOK = (authors, title, year, publisher) => ({ authors, title, year, publisher, availability: 'библиотека колледжа' });
const SECTIONS_1 = {
  title: {
    department: 'Кафедра информатики и медицинской техники', faculty: 'Факультет сестринского дела', academicYear: '2026–2027', course: 1,
    contacts: 'teacher1@example.test, приём по вторникам с 14:00', place: 'Кабинет 204, главный корпус',
  },
  goals: {
    goal: 'Научить будущего медика уверенно работать с компьютером и медицинской информационной системой.',
    knowledge: ['устройство рабочего места и правила работы в кабинете', 'основные функции медицинской информационной системы (МИС)', 'правила защиты персональных данных пациента'],
    skill: ['вести электронную карту пациента', 'искать и проверять медицинскую информацию', 'составлять документы и таблицы учёта'],
    attitude: ['бережное отношение к данным пациента', 'аккуратность при работе с техникой', 'готовность учиться новым программам'],
    prerequisite: ['школьный курс информатики'], postrequisite: ['клиническая практика', 'медицинская статистика'],
  },
  selfWork: { items: [
    { unit: 1, name: 'Памятка по кибергигиене', tasks: 'Составить памятку из десяти правил для поста медсестры.', hours: 2 },
    { unit: 1, name: 'Обзор медицинского справочника', tasks: 'Найти и сравнить два источника по одному препарату.', hours: 4 },
    { unit: 2, name: 'График дежурств в таблице', tasks: 'Собрать график дежурств на месяц с проверкой выходных.', hours: 4 },
    { unit: 2, name: 'Таблица учёта препаратов', tasks: 'Заполнить таблицу учёта и посчитать остатки формулами.', hours: 4 },
  ] },
  literature: {
    main: [BOOK('Асанов А.', 'Информатика для медицинских колледжей', '2022', 'Учебное издательство'), BOOK('Бекова Э.', 'Медицинские информационные системы', '2021', 'Научный центр'),
      BOOK('Исаев Р.', 'Основы работы с электронными таблицами', '2020', 'Городская типография')],
    extra: [BOOK('Орозов Т.', 'Защита данных в здравоохранении', '2023', 'Учебное издательство'), BOOK('Садыкова Н.', 'Цифровая гигиена', '2022', 'Научный центр')],
  },
  software: { items: [{ name: 'LibreOffice Calc', link: 'https://www.libreoffice.org/' }, { name: 'Учебная версия МИС колледжа', link: '' }] },
  policies: {
    grading: [
      { name: 'Текущий контроль', maxPoints: 40, rangeFail: '0–19', rangeFair: '20–27', rangeGood: '28–35', rangeExcellent: '36–40',
        criteriaFail: 'Задания не выполнены.', criteriaFair: 'Выполнено больше половины заданий.', criteriaGood: 'Выполнено почти всё, есть мелкие ошибки.', criteriaExcellent: 'Выполнено всё без ошибок.' },
      { name: 'Рубежный контроль', maxPoints: 30, rangeFail: '0–14', rangeFair: '15–20', rangeGood: '21–26', rangeExcellent: '27–30',
        criteriaFail: 'Тест не пройден.', criteriaFair: 'Верно больше половины ответов.', criteriaGood: 'Верно большинство ответов.', criteriaExcellent: 'Верны почти все ответы.' },
      { name: 'Итоговый зачёт', maxPoints: 30, rangeFail: '0–14', rangeFair: '15–20', rangeGood: '21–26', rangeExcellent: '27–30',
        criteriaFail: 'Работа не сдана.', criteriaFair: 'Работа выполнена частично.', criteriaGood: 'Работа выполнена с мелкими замечаниями.', criteriaExcellent: 'Работа выполнена полностью.' },
    ],
    behavior: ['Приходить на пару вовремя.', 'Телефон в кабинете выключен, если задание не требует его.', 'Техника в кабинете остаётся в порядке.'],
    ethics: ['Задания выполняются самостоятельно.', 'Чужие данные пациентов не копируются и не пересылаются.', 'Преподавателю и однокурсникам отвечают вежливо.'],
    sanctionBehavior: 'Замечание, затем беседа с куратором группы.', sanctionEthics: 'Работа не засчитывается, пересдача по решению преподавателя.',
  },
  units: { units: [
    { unit: 1, description: 'Рабочее место медсестры, защита данных и поиск медицинской информации.', questions: 'Что такое врачебная тайна в цифровой среде?\nКак проверить источник инструкции к препарату?',
      guidance: '', results: '', literature: [BOOK('Асанов А.', 'Информатика для медицинских колледжей', '2022', 'Учебное издательство')] },
    { unit: 2, description: 'Работа в МИС, документы и электронные таблицы.', questions: 'Как заполнить электронную карту пациента?\nКакие формулы нужны для расчёта дозы?',
      guidance: '', results: '', literature: [BOOK('Исаев Р.', 'Основы работы с электронными таблицами', '2020', 'Городская типография')] },
  ] },
};

// The anatomy syllabus (fictional): six lessons in two units, no control rows, no literature.
const ANATOMY_PLAN = { units: [
  { title: 'Строение тела', lecture: [{ name: 'Жалпы анатомия', hours: 2 }, { name: 'Скелет и суставы', hours: 2 }], practice: [{ name: 'Кости и суставы на муляже', hours: 2 }] },
  { title: 'Системы органов', lecture: [{ name: 'Мышечная система', hours: 2 }], practice: [{ name: 'Мышцы на муляже', hours: 2 }, { name: 'Сердце и сосуды на муляже', hours: 2 }] },
] };

function sheetsApply(store, platform, subjectId, sheets, user) {
  const done = uploadSyllabus(store, platform, { subjectId, sheets }, user, true);
  if (!done.applied) throw new Error('seed: the sample syllabus is not applied: ' + JSON.stringify(done.errors));
  return done.drafts[0].syllabusId;
}

// Saves a section of a version the way the form does: the stored section with the given fields over it.
function writeSection(store, platform, user, syllabusId, section, patch) {
  const doc = draftForm(store, platform, { syllabusId }, user).doc;
  const base = section === 'plan' ? { units: doc.plan.units } : doc[section];
  saveSection(store, platform, { syllabusId, section, data: { ...base, ...patch } }, user);
}

// The states of the syllabus the stand shows (all fictional), see the plan of unit 2, addendum 3:
//   «Информатика» of teacher1, 1st half: version 1 approved with every section, version 2 returned with a remark; 2nd half: version 1 approved;
//   «Анатомия» of teacher2: version 1 under review; «Информатика» in 03-1 (teacher3): a draft with the title only.
function seedSyllabi(store, platform, subjects, teacherName, adminRow) {
  const admin = { id: adminRow.id, roles: ['admin'], kind: 'staff' };
  const first = sheetsApply(store, platform, subjects.informatics, syllabus1(teacherName), admin);
  for (const section of ['title', 'goals', 'selfWork', 'literature', 'software', 'policies', 'units']) writeSection(store, platform, admin, first, section, SECTIONS_1[section]);
  const approved = approveSyllabus(store, platform, { syllabusId: first }, admin);
  if (!approved.approved) throw new Error('seed: the sample syllabus is not approved: ' + JSON.stringify(approved.checks.errors));

  // the 2nd half: a file is not enough to approve — the department, the year and the goal are written the way a person would on the form
  const { doc, errors } = parseSyllabus(syllabus2(teacherName));
  if (errors.length > 0) throw new Error('seed: the sample syllabus does not parse: ' + JSON.stringify(errors));
  publishSyllabusDoc(store, platform, subjects.informatics, doc, admin, { department: SECTIONS_1.title.department, academicYear: '2026–2027' }, SECTIONS_1.goals.goal);

  // version 2 of the 1st half: a copy with one lesson renamed, returned by the deanery
  const second = startDraft(store, platform, { subjectId: subjects.informatics, semester: 1 }, admin).syllabusId;
  const plan = draftForm(store, platform, { syllabusId: second }, admin).doc.plan.units;
  plan[0].lecture[0] = { ...plan[0].lecture[0], name: `${plan[0].lecture[0].name} (новая редакция)` };
  saveSection(store, platform, { syllabusId: second, section: 'plan', data: { units: plan } }, admin);
  if (!submitSyllabus(store, platform, { syllabusId: second }, admin).submitted) throw new Error('seed: the second version is not submitted');
  returnSyllabus(store, platform, { syllabusId: second, remark: 'Добавьте литературу к юниту 2' }, admin);

  // «Анатомия»: under review
  const anatomy = startDraft(store, platform, { subjectId: subjects.anatomy, semester: 1 }, admin).syllabusId;
  writeSection(store, platform, admin, anatomy, 'title', { department: 'Кафедра анатомии и физиологии', faculty: 'Факультет сестринского дела', academicYear: '2026–2027', course: 1, credits: 2 });
  writeSection(store, platform, admin, anatomy, 'goals', { goal: 'Дать будущему медику знание строения тела человека.' });
  saveSection(store, platform, { syllabusId: anatomy, section: 'plan', data: ANATOMY_PLAN }, admin);
  if (!submitSyllabus(store, platform, { syllabusId: anatomy }, admin).submitted) throw new Error('seed: the anatomy syllabus is not submitted');

  // «Информатика» of teacher3 in 03-1: a draft with the title only
  const draft = startDraft(store, platform, { subjectId: subjects.thirdInformatics, semester: 1 }, admin).syllabusId;
  writeSection(store, platform, admin, draft, 'title', { department: 'Кафедра информатики и медицинской техники', academicYear: '2026–2027', course: 2 });
}

// The common filling: groups, students, disciplines, subjects, the week, syllabi, pairs. The staff of the stand
// (everyone except the administrator) is made here; the administrator is made by the caller or already is in the store.
function fill(store, platform, { passwordHash, names, studentsMustChange, admin, files, repeats = true }) {
  const common = { passwordHash, mustChangePassword: false, active: true };
  const staff = STAFF.filter((person) => person.login !== 'admin')
    .map((person) => store.insert('staff', { ...person, fullName: names.staff[person.login], ...common, lang: 'ru' }));
  const teacher1 = staff.find((person) => person.login === 'teacher1');
  const teacher2 = staff.find((person) => person.login === 'teacher2');
  const teacher3 = staff.find((person) => person.login === 'teacher3');
  const disciplines = Object.fromEntries(['Информатика', 'Анатомия'].map((name) => [name, store.insert('disciplines', { name })]));
  const rooms = {};
  for (const name of ['101', '204', '305']) rooms[name] = store.insert('rooms', { name });

  const subjects = {};
  GROUPS.forEach((def, g) => {
    const group = store.insert('groups', { name: def.name, course: def.course });
    const students = [];
    for (let i = 0; i < STUDENTS_PER_GROUP; i++) {
      const cardNo = `S${def.card}${String(i + 1).padStart(3, '0')}`;
      const number = g * STUDENTS_PER_GROUP + i;
      students.push({
        fullName: `${names.surnames[(number * 5 + g) % names.surnames.length]} ${names.given[number % names.given.length]}`,
        groupId: group.id,
        cardNo,
        ...common,
        mustChangePassword: studentsMustChange && cardNo === 'S1002',
        lang: 'ky',
      });
    }
    store.insertMany('students', students);
    // Informatics: teacher1 in 01-1 and 02-1, teacher3 in 03-1; anatomy: teacher2 everywhere.
    const subject = (discipline, teacher) => store.insert('subjects', {
      name: discipline.name, disciplineId: discipline.id, teacherId: teacher.id, groupId: group.id, scheme: 'A',
    });
    const informatics = subject(disciplines['Информатика'], g < 2 ? teacher1 : teacher3);
    const anatomy = subject(disciplines['Анатомия'], teacher2);
    if (g === 0) Object.assign(subjects, { informatics: informatics.id, anatomy: anatomy.id });
    if (g === 2) subjects.thirdInformatics = informatics.id;
    // Monday: informatics in room 204; Wednesday and Thursday: anatomy in room 101. The pair number is the group number.
    store.insertMany('weekTemplate', [
      { weekday: 1, slot: g + 1, subjectId: informatics.id, roomId: rooms['204'].id },
      { weekday: 3, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
      { weekday: 4, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
    ]);
  });

  seedSyllabi(store, platform, subjects, teacher1.fullName, admin);
  seedPairs(store, platform);
  seedMarks(store, platform);
  seedWork(store, platform, files);
  seedLedger(store, platform);
  seedExam(store, platform);
  if (repeats) seedRepeat(store, platform);
  seedShared(store, platform);
}

// A small real PDF (one page, the text «Syllabus sample»), with a proper cross-reference table.
export function sampleSyllabusPdf() {
  const stream = 'BT /F1 24 Tf 72 700 Td (Syllabus sample) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 255);
}

// The sample PDF of the stand: the file of the approved «Информатика» of teacher1, 1st half, put by the deanery. Without a box nothing happens.
export function seedSyllabusFile(store, platform, files) {
  if (!files) return;
  const teacher = store.list('staff').find((p) => p.login === 'teacher1');
  const dean = store.list('staff').find((p) => p.login === 'dean');
  const discipline = store.list('disciplines').find((d) => d.name === 'Информатика');
  const version = teacher && discipline && store.list('syllabi').find((v) => v.disciplineId === discipline.id && v.teacherId === teacher.id && v.semester === 1 && v.status === 'approved');
  if (!version || !dean) throw new Error('seed: no approved «Информатика» of teacher1 for the sample file');
  const bytes = sampleSyllabusPdf();
  const stored = platform.randomHex(16) + '.bin';
  files.put(stored, bytes);
  const [row] = store.insertMany('files', [{
    assignmentId: '', submissionId: '', ownerId: dean.id, state: 'syllabus', name: 'Силлабус — Информатика.pdf', kind: 'pdf',
    size: bytes.length, stored, at: localDateTime(platform.now()),
  }]);
  store.updateMany('syllabi', [{ id: version.id, patch: { fileId: row.id } }]);
}

// Fills an empty dev store with fictional data. Does nothing when `staff` already has rows.
export function seed(store, platform, files = null, { repeats = true } = {}) {
  if (store.list('staff').length > 0) return;
  // The stored hash carries its own salt, so one hash serves every person.
  const passwordHash = hashPassword(platform, DEV_PASSWORD);
  const admin = store.insert('staff', { ...STAFF[0], passwordHash, mustChangePassword: false, active: true, lang: 'ru' });
  fill(store, platform, { passwordHash, names: NAMES.latin, studentsMustChange: true, admin, files, repeats });
  seedSyllabusFile(store, platform, files);
}

// The demo data for the working base (Cyrillic names, one password given by the caller): the same data set as the stand, but on a base
// that already has its administrator. The administrator is not touched: no password, no roles, no name. Everything is one transaction
// when the store has them. Does nothing but refuse (returns false) when the store has anyone besides one administrator.
export function seedDemo(store, platform, { password, files = null }) {
  const staff = store.list('staff');
  const admin = staff.find((person) => person.login === 'admin');
  if (!admin || staff.length !== 1 || !String(admin.roles).split(',').includes('admin')) return false;
  const passwordHash = hashPassword(platform, password);
  const run = () => fill(store, platform, { passwordHash, names: NAMES.cyrillic, studentsMustChange: false, admin, files });
  if (typeof store.transaction === 'function') store.transaction(run);
  else run();
  return true;
}

// The one account of the stand with real data: the administrator, nothing else. Does nothing when `staff` already has rows.
export function seedAdmin(store, platform) {
  if (store.list('staff').length > 0) return;
  const person = STAFF.find((p) => p.login === 'admin');
  store.insert('staff', { ...person, passwordHash: hashPassword(platform, DEV_PASSWORD), mustChangePassword: false, active: true, lang: 'ru' });
}

// Semester from nine weeks before this week to the Friday of week 18; one day off on the Wednesday after next Monday.
function seedPairs(store, platform) {
  const thisMonday = mondayOf(todayOf(platform));
  const start = addDays(thisMonday, -63);
  store.insertMany('settings', settingsToRows({
    semesterStart: start, semesterEnd: addDays(start, 123), holidays: [addDays(thisMonday, 9)], bells: DEFAULT_BELLS, semester: 1,
  }));
  generateSchedule(store, platform);

  const groups = new Map(store.list('groups').map((g) => [g.name, g.id]));
  const subjects = store.list('subjects');
  const pairs = store.list('pairs');
  const pairOf = (name, group, date) => {
    const subject = subjects.find((s) => s.name === name && s.groupId === groups.get(group));
    return pairs.find((p) => p.subjectId === subject.id && p.date === date);
  };
  const nextMonday = addDays(thisMonday, 7);
  const substitute = pairOf('Анатомия', '01-1', addDays(nextMonday, 3));
  const cancelled = pairOf('Информатика', '02-1', nextMonday);
  const teacher3 = store.list('staff').find((s) => s.login === 'teacher3');
  store.update('pairs', substitute.id, { teacherId: teacher3.id, changed: true, substitute: true, note: 'Замена' });
  store.update('pairs', cancelled.id, { status: 'cancelled', changed: true });
  relayout(store);
}

// The mark of student i on the k-th pair of a subject (no chance in it): [status, noCoat, activity].
function markOfStudent(i, k, pair, first) {
  let status = 'present';
  if ((i + k) % 17 === 0) status = 'excused';
  else if ((i * 7 + k * 3) % 11 === 0) status = 'absent';
  else if ((i * 7 + k * 3) % 11 === 1) status = 'late';
  const attended = status === 'present' || status === 'late';
  const noCoat = pair.lessonType === 'practice' && status !== 'absent' && status !== 'excused' && (i + 2 * k) % 13 === 0;
  const activity = attended && !first && pair.lessonType !== 'control' ? 4 + ((i * 3 + k * 5) % 7) : null;
  return { status, noCoat, activity };
}

// The marks of the stand: every past pair is held except the last past pair of «Анатомия» in 02-1; the control and the self-work of unit 1
// of «Информатика»; three corrections for the change log. Written through the functions of the journal, by the people of the stand.
function seedMarks(store, platform) {
  const today = localDate(platform.now());
  const staff = new Map(store.list('staff').map((p) => [p.id, p]));
  const groups = new Map(store.list('groups').map((g) => [g.id, g]));
  const students = store.list('students');
  const subjects = store.list('subjects');
  const userOf = (row) => ({ id: row.id, roles: String(row.roles).split(','), kind: 'staff' });
  const order = (a, b) => a.date.localeCompare(b.date) || a.slot - b.slot;

  const past = (subject) => store.list('pairs').filter((p) => p.subjectId === subject.id).sort(order);
  const skipped = past(subjects.find((s) => s.name === 'Анатомия' && groups.get(s.groupId).name === '02-1')).filter((p) => p.date < today && p.status === 'planned').at(-1);
  for (const subject of subjects) {
    const group = students.filter((s) => s.groupId === subject.groupId);
    const pairs = past(subject);
    const first = pairs.find((p) => ['planned', 'running', 'closed'].includes(p.status));
    pairs.forEach((pair, k) => {
      if (pair.date >= today || pair.status !== 'planned' || pair.id === skipped.id) return;
      const items = group.map((s, i) => ({ studentId: s.id, ...markOfStudent(i, k, pair, pair === first) }));
      const at = `${pair.date} ${addMinutes(pair.startTime, 85)}:00`;
      writeMarks(store, { pair, subject, items, existing: new Map(), actorId: pair.teacherId, at });
    });
  }

  const informatics = subjects.filter((s) => s.name === 'Информатика' && groups.get(s.groupId).name !== '03-1');
  for (const subject of informatics) {
    const group = students.filter((s) => s.groupId === subject.groupId);
    const teacher = userOf(staff.get(subject.teacherId));
    const rated = group.slice(0, -2);
    saveUnitResults(store, platform, { subjectId: subject.id, unit: 1, field: 'control', items: rated.map((s, i) => ({ studentId: s.id, value: 22 + ((i * 5) % 19) })) }, teacher);
    saveUnitResults(store, platform, { subjectId: subject.id, unit: 1, field: 'self', items: rated.map((s, i) => ({ studentId: s.id, value: 10 + ((i * 3) % 11) })) }, teacher);
  }

  // 1. the teacher turns «не был» into «отработано» with an activity on an old pair (a status row and an activity row)
  const first = informatics.find((s) => groups.get(s.groupId).name === '01-1');
  const teacher1 = userOf(staff.get(first.teacherId));
  const group1 = students.filter((s) => s.groupId === first.groupId);
  const old = past(first)[5];
  savePairMarks(store, platform, { pairId: old.id, marks: [{ studentId: group1[1].id, status: 'madeup', noCoat: false, activity: 8 }], reason: 'Отработал тему на консультации' }, teacher1);

  // 2. the deanery changes one mark
  const second = informatics.find((s) => groups.get(s.groupId).name === '02-1');
  const dean = userOf(store.list('staff').find((p) => p.login === 'dean'));
  const group2 = students.filter((s) => s.groupId === second.groupId);
  const pair = past(second)[3];
  const was = markOfStudent(4, 3, pair, false);
  savePairMarks(store, platform, { pairId: pair.id, marks: [{ studentId: group2[4].id, ...was, status: was.status === 'present' ? 'late' : 'present' }], reason: 'Ошибка при заполнении' }, dean);

  // 3. the manual current points of one student: two more than the calculated ones, not above the scheme
  const view = journalView(readJournalRows(store), platform, first.id, teacher1);
  const calculated = view.results[group1[3].id].units[0].current;
  saveUnitResults(store, platform, { subjectId: first.id, unit: 1, field: 'current', items: [{ studentId: group1[3].id, value: Math.min(40, calculated + 2) }], reason: 'Участие в олимпиаде' }, teacher1);
}

// A small PNG built here (a blue field with a lighter diamond, 48 x 32): no file from outside, no photo of a person.
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function samplePng() {
  const w = 48;
  const h = 32;
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0);
    for (let x = 0; x < w; x++) {
      const inside = Math.abs(x - w / 2) / (w / 2) + Math.abs(y - h / 2) / (h / 2) < 0.8;
      raw.push(...(inside ? [150, 190, 255] : [30, 70 + y, 160]));
    }
  }
  let a = 1;
  let b = 0;
  for (const v of raw) {
    a = (a + v) % 65521;
    b = (b + a) % 65521;
  }
  const be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const len = raw.length;
  // zlib: the header, one stored block, the Adler-32 sum
  const zlib = [0x78, 0x01, 0x01, len & 255, len >> 8, ~len & 255, (~len >> 8) & 255, ...raw, ...be(((b << 16) | a) >>> 0)];
  const chunk = (type, data) => {
    const body = [...type].map((ch) => ch.charCodeAt(0)).concat(data);
    return [...be(data.length), ...body, ...be(crc32(body))];
  };
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...be(w), ...be(h), 8, 2, 0, 0, 0]), ...chunk('IDAT', zlib), ...chunk('IEND', [])]);
}

// The assignments of the stand (fictional): «Информатика» 01-1 of teacher1, unit 2 of the syllabus in force. Written through the very functions
// the requests use, each at its own moment of the past (a clock that says the given date and time), so the rows, the late mark and the
// change log are what the live requests would have made.
//   «Эссе по теме юнита» (СРС, 10, due 5 days ago): 3 checked (8, 10, 6; the last one late), 1 returned with a remark, 1 not handed in;
//   «Презентация» (СРС, 20, due in 5 days): 2 handed in and waiting, one with the picture when a box is given;
//   «Задачи 1–5» (ДЗ, 5, due in 2 days): 1 handed in as text.
export function seedWork(store, platform, files = null) {
  const group = store.list('groups').find((g) => g.name === '01-1');
  const teacherRow = store.list('staff').find((p) => p.login === 'teacher1');
  const subject = group && teacherRow && store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id && s.teacherId === teacherRow.id);
  if (!subject) throw new Error('seed: no «Информатика» of teacher1 in 01-1 for the assignments');
  const today = todayOf(platform);
  const clock = (days, time) => {
    const ms = parseLocalDateTime(`${addDays(today, days)} ${time}:00`);
    return Object.assign(Object.create(platform), { now: () => ms });
  };
  const teacher = { id: teacherRow.id, roles: String(teacherRow.roles).split(','), kind: 'staff', row: teacherRow };
  const [s1, s2, s3, s4] = store.list('students').filter((s) => s.groupId === group.id).sort((x, y) => x.cardNo.localeCompare(y.cardNo)).slice(0, 5)
    .map((row) => ({ id: row.id, roles: ['student'], kind: 'student', row }));

  const give = (data) => saveAssignment(store, clock(-10, '09:00'), { subjectId: subject.id, unit: 2, topicId: '', ...data }, teacher).assignment.id;
  const essay = give({ kind: 'srs', title: 'Эссе по теме юнита', description: 'Эссе на одну страницу: как электронные таблицы помогают в работе медсестры.', dueDate: addDays(today, -5), dueTime: '23:59', maxPoints: 10 });
  const slides = give({ kind: 'srs', title: 'Презентация', description: 'Презентация из пяти слайдов по теме юнита.', dueDate: addDays(today, 5), dueTime: '23:59', maxPoints: 20 });
  const tasks = give({ kind: 'hw', title: 'Задачи 1–5', description: 'Решите задачи 1–5 из рабочей тетради.', dueDate: addDays(today, 2), dueTime: '23:59', maxPoints: 5 });

  const hand = (at, student, assignmentId, text, fileIds = []) => submitWork(store, at, { assignmentId, text, fileIds }, student);
  hand(clock(-6, '11:00'), s1, essay, 'Электронные таблицы помогают считать дозы и вести учёт назначений.');
  hand(clock(-5, '20:00'), s2, essay, 'Таблица с формулами экономит время и снижает риск ошибки в расчётах.');
  hand(clock(-4, '09:30'), s3, essay, 'Сдаю позже срока: перепроверял расчёты примеров.');
  hand(clock(-6, '15:00'), s4, essay, 'Таблицы нужны для учёта.');

  const grade = (student, assignmentId, data) => {
    const attempt = currentAttempt(store.list('submissions').filter((r) => r.assignmentId === assignmentId && r.studentId === student.id));
    return gradeWork(store, clock(-3, '10:00'), { assignmentId, studentId: student.id, attemptId: attempt.id, ...data }, teacher);
  };
  grade(s1, essay, { verdict: 'checked', points: 8, comment: 'Хорошо, добавьте пример формулы.' });
  grade(s2, essay, { verdict: 'checked', points: 10, comment: '' });
  grade(s3, essay, { verdict: 'checked', points: 6, comment: 'Сдано позже срока.' });
  grade(s4, essay, { verdict: 'returned', points: null, comment: 'Слишком коротко: раскройте тему и перепишите.' });

  let fileIds = [];
  if (files) {
    const picture = uploadFile(store, clock(-1, '14:00'), files, { assignmentId: slides, name: 'slide-1.png', data: files.encode(samplePng()) }, s1);
    fileIds = [picture.file.id];
  }
  hand(clock(-1, '14:05'), s1, slides, files ? 'Презентация, первый слайд с картинкой во вложении.' : 'Презентация готова: пять слайдов, ссылка на файл будет у преподавателя.', fileIds);
  hand(clock(-1, '15:00'), s2, slides, 'Презентация о защите данных пациентов, пять слайдов.');
  hand(clock(-1, '16:00'), s2, tasks, 'Задачи 1–3 решены, 4 и 5 в тетради.');
}

// The stand of the QR screens: puts a pair of «Информатика» of 01-1 (teacher1) on the current time, so the screens can be tried at any hour.
// Today's planned pair of that subject is taken (only its start time changes), else the nearest future one moves to today ({ date, startTime, changed }).
// The start time is the Bishkek time now, rounded down to 5 minutes; after 22:00 it is now minus 10 minutes, not later than 22:25 (the bells go to 22:25).
// After 23:30 nothing is prepared (the window and the 90 minutes of the pair would cross midnight). The topic and the pair number stay as they are;
// the start time not matching the slot is allowed on the stand only: the pair is a trial one. -> the id of the pair or null.
export function prepareLessonNow(store, platform) {
  const nowMs = platform.now();
  const today = localDate(nowMs);
  const minutes = minutesOf(localTime(nowMs));
  if (minutes >= 23 * 60 + 30) {
    console.log('После 23:30 стенд не готовит пару «сейчас»: пара и окно отметки перешли бы через полночь.');
    return null;
  }
  const rounded = minutes - (minutes % 5);
  const start = addMinutes('00:00', rounded >= 22 * 60 ? Math.min(rounded - 10, 22 * 60 + 25) : rounded);
  const group = store.list('groups').find((g) => g.name === '01-1');
  const teacher = store.list('staff').find((p) => p.login === 'teacher1');
  const subject = group && teacher && store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id && s.teacherId === teacher.id);
  if (!subject) return null;
  const planned = store.list('pairs').filter((p) => p.subjectId === subject.id && p.status === 'planned');
  const order = (a, b) => a.date.localeCompare(b.date) || a.slot - b.slot;
  const own = planned.filter((p) => p.date === today).sort(order)[0];
  if (own) {
    store.update('pairs', own.id, { startTime: start });
    return own.id;
  }
  const next = planned.filter((p) => p.date > today).sort(order)[0];
  if (!next) return null;
  store.update('pairs', next.id, { date: today, startTime: start, changed: true });
  return next.id;
}

// The person of the stand as the rules of the modules take him.
const staffUser = (row) => ({ id: row.id, roles: String(row.roles).split(','), kind: 'staff', row });
const byCard = (a, b) => a.cardNo.localeCompare(b.cardNo);

// The ledger of the stand (all through the rules of the modules, by the people of the stand):
//   the credit week (the last 7 days of the semester) and the name of the college;
//   «Информатика» 01-1 (teacher1): unit 1 closed; four requests of teacher1 on it: the control of student 3 waits for the deanery, a mark of the
//   first student who was absent on the first pair waits for the vice-rector, the control of student 7 is applied, the manual current of student 9 is rejected;
//   three announcements; the state exam of 03-1 with 20 scores of 22.
export function seedLedger(store, platform) {
  const staff = (login) => {
    const row = store.list('staff').find((p) => p.login === login);
    if (!row) throw new Error(`seed: no person ${login} for the ledger`);
    return staffUser(row);
  };
  const [teacher, dean, prorector, admin] = ['teacher1', 'dean', 'prorector', 'admin'].map(staff);
  const today = todayOf(platform);
  const groups = new Map(store.list('groups').map((g) => [g.name, g]));
  const subject = store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === groups.get('01-1').id && s.teacherId === teacher.id);
  if (!subject) throw new Error('seed: no «Информатика» of teacher1 in 01-1 for the ledger');

  const { semesterEnd } = readSettings(store.list('settings'));
  store.insertMany('settings', extraToRows({ examStart: addDays(semesterEnd, -6), examEnd: semesterEnd, collegeName: 'Учебный колледж (стенд)' }));

  // unit 1: the control and the self-work of every student (the marks of the stand leave two students without them), then the closing
  const students = store.list('students').filter((s) => s.groupId === subject.groupId).sort(byCard);
  const missing = students.slice(-2);
  const fill = (field, value) => saveUnitResults(store, platform, { subjectId: subject.id, unit: 1, field, items: missing.map((s, i) => ({ studentId: s.id, value: value(students.length - 2 + i) })) }, teacher);
  fill('control', (i) => 22 + ((i * 5) % 19));
  fill('self', (i) => 10 + ((i * 3) % 11));
  closeUnit(store, platform, { subjectId: subject.id, unit: 1 }, teacher);

  // the requests of teacher1 on unit 1
  const view = journalView(readJournalRows(store), platform, subject.id, teacher);
  const control = (student) => view.results[student.id].units[0].control;
  const raise = (student) => Math.min(view.scheme.control, control(student) + 3);
  const file = (data) => createRequest(store, platform, { subjectId: subject.id, unit: 1, ...data }, teacher).request.id;
  const decide = (requestId, step, verdict, who, note = '') => decideRequest(store, platform, { requestId, step, verdict, note }, who);
  const unitRequest = (student, reason) => file({ kind: 'control', studentId: student.id, before: pointsText(control(student)), after: pointsText(raise(student)), reason });

  unitRequest(students[2], 'Рубежный проверен повторно: ошибка при подсчёте баллов');
  const onFirst = view.pairs.find((p) => p.first);
  const marks = store.list('attendance').filter((r) => r.pairId === onFirst.id);
  const absent = students.find((s) => { const row = lastOf(marks.filter((r) => r.studentId === s.id), 'markedAt'); return row && row.status === 'absent'; });
  if (!absent) throw new Error('seed: nobody was absent on the first pair of «Информатика» 01-1');
  const was = { status: 'absent', noCoat: false, activity: null };
  const markId = file({
    kind: 'mark', pairId: onFirst.id, studentId: absent.id, before: markText(was), after: markText({ ...was, status: 'excused' }),
    reason: 'Справка о болезни принесена после закрытия юнита',
  });
  decide(markId, 'dean', 'approve', dean);
  const appliedId = unitRequest(students[6], 'Рубежный пересчитан по протоколу проверки');
  decide(appliedId, 'dean', 'approve', dean);
  decide(appliedId, 'prorector', 'approve', prorector);
  const manual = lastOf(store.list('unitResults').filter((r) => r.subjectId === subject.id && r.studentId === students[8].id && r.unit === 1), 'updatedAt');
  const rejectedId = file({ kind: 'current', studentId: students[8].id, before: pointsText(manual ? manual.currentManual : null), after: '30', reason: 'Прошу засчитать участие в олимпиаде' });
  decide(rejectedId, 'dean', 'reject', dean, 'Нет подтверждающего документа');

  // the announcements
  const note = (who, data) => saveAnnouncement(store, platform, data, who);
  note(dean, { audience: 'all', title: 'Субботник в пятницу', text: 'В пятницу после четвёртой пары убираем территорию колледжа. Приходите в рабочей одежде.' });
  note(admin, { audience: 'teachers', title: 'Педсовет', text: 'Педсовет в четверг в 15:00 в актовом зале. Повестка у деканата.' });
  note(teacher, { audience: 'group', groupId: groups.get('01-1').id, title: 'Консультация перед рубежным', text: 'Консультация по информатике в среду после пар, кабинет 204.' });

  // the state exam of 03-1 three days ago: 20 scores of 22
  const exam = saveStateExam(store, platform, { groupId: groups.get('03-1').id, name: 'Государственный экзамен по специальности', date: addDays(today, -3) }, dean).exam;
  const third = store.list('students').filter((s) => s.groupId === groups.get('03-1').id).sort(byCard).slice(0, 20);
  const score = (i) => (i === 0 ? 52 : i === 1 ? 96 : 53 + ((i * 13) % 43));
  saveStateExamScores(store, platform, { examId: exam.id, items: third.map((s, i) => ({ studentId: s.id, score: score(i) })), reason: '' }, dean);
}

// The exam of «Информатика» 02-1 (teacher1; the pairs and the QR are tried on 01-1): both units closed, the head of the exam three days ago and the
// first attempts. The ONLY place where the stand writes the new tables straight (insertMany): the semester of the stand is still going, the pairs
// of unit 2 are ahead, so by the rules neither unit could be closed. The change log gets no line of the exam. The pairs of unit 2 stay planned in the
// closed unit (a condition of the stand): they cannot be marked.
//   unit 2 of the students: the manual current, the self-work and the control by the numbers of the scheme (the numbers are computed from the settings):
//   two students fall to the admission threshold or below, one has no control of unit 2 (no result of the unit: not admitted); the others are admitted;
//   the first attempts of the admitted by the semester points: excellent, good, fair and one fail by the best and the worst; two have nothing yet,
//   one did not come, one is incomplete; the rest sit between fair and the maximum.
export function seedExam(store, platform) {
  const teacherRow = store.list('staff').find((p) => p.login === 'teacher1');
  const group = store.list('groups').find((g) => g.name === '02-1');
  const subject = teacherRow && group && store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id && s.teacherId === teacherRow.id);
  if (!subject) throw new Error('seed: no «Информатика» of teacher1 in 02-1 for the exam');
  const teacher = staffUser(teacherRow);
  const today = todayOf(platform);
  const at = localDateTime(platform.now());
  const students = store.list('students').filter((s) => s.groupId === group.id).sort(byCard);
  const n = students.length;

  const first = journalView(readJournalRows(store), platform, subject.id, teacher);
  const { planSemester } = first.subject;
  const { scheme, split } = first;
  const put = (student, unit, field, value) => writeUnitResult(store, {
    rows: store.list('unitResults'), subject, planSemester, unit, studentId: student.id, field, value, actorId: teacher.id, at,
  });

  // unit 1: the two last students have no control and no self-work yet
  students.slice(-2).forEach((student, k) => {
    put(student, 1, 'control', 22 + (((n - 2 + k) * 5) % 19));
    put(student, 1, 'self', 10 + (((n - 2 + k) * 3) % 11));
  });
  // unit 2: n-3 and n-2 are low, n-1 has no control
  students.forEach((student, i) => {
    const low = i === n - 3 || i === n - 2;
    const f = low ? 0 : 0.62 + ((i * 7) % 9) * 0.04;
    put(student, 2, 'current', Math.round(scheme.current * f));
    put(student, 2, 'self', Math.round(scheme.self * f));
    if (i !== n - 1) put(student, 2, 'control', Math.round(scheme.control * f));
  });

  const view = journalView(readJournalRows(store), platform, subject.id, teacher);
  const admitted = students.filter((s) => view.results[s.id].admitted === true)
    .sort((a, b) => view.results[b.id].semester - view.results[a.id].semester || a.cardNo.localeCompare(b.cardNo));
  const examFor = (student, target, atLeast = 0) => {
    const own = view.results[student.id].semester;
    return Math.min(split.exam, Math.max(0, target - own, atLeast - own));
  };
  const outcomes = new Map();
  admitted.forEach((student, k) => {
    if (k === 3 || k === 4) return;
    if (k === 5) outcomes.set(student.id, { outcome: 'absent', score: null });
    else if (k === 6) outcomes.set(student.id, { outcome: 'incomplete', score: null });
    else if (k === 0) outcomes.set(student.id, { outcome: 'score', score: examFor(student, scheme.excellent + 1) });
    else if (k === 1) outcomes.set(student.id, { outcome: 'score', score: examFor(student, scheme.good + 1) });
    else if (k === 2) outcomes.set(student.id, { outcome: 'score', score: examFor(student, scheme.fair + 3) });
    else if (k === admitted.length - 1) outcomes.set(student.id, { outcome: 'score', score: examFor(student, scheme.fair - 10) });
    else outcomes.set(student.id, { outcome: 'score', score: examFor(student, Math.round(split.exam * (0.5 + ((k * 3) % 5) * 0.1)), scheme.fair) });
  });

  const date = addDays(today, -3);
  const stamp = { updatedBy: teacher.id, updatedAt: `${date} 12:00:00` };
  store.insertMany('closures', [[1, 6, '15:00:00'], [2, 5, '15:00:00']].map(([unit, ago, time]) => ({
    subjectId: subject.id, planSemester, unit, closedBy: teacher.id, closedAt: `${addDays(today, -ago)} ${time}`, reopenedBy: '', reopenedAt: '',
  })));
  store.insertMany('subjectExams', [{ subjectId: subject.id, planSemester, date, examiner: '', assistants: 'Ассистент Стендовый', ...stamp }]);
  store.insertMany('examAttempts', [...outcomes].map(([studentId, result]) => ({
    subjectId: subject.id, planSemester, studentId, no: 1, date, outcome: result.outcome, score: result.score, commission: '', ...stamp,
  })));
}

// The repeat courses of «Информатика» 02-1 (teacher1) on the stand: every state of the card, found by the result of seedExam.
// Like seedExam it writes the OLD tables straight (the semester of the stand is still going): the retakes and the closing of the final sheet
// (unit 0, teacher1, 3 days ago, after the first sits); the cards and their scores go only through the functions of repeatData / repeatScores, by dean and teacher1.
// The students are taken by their result, not by the number of the card; with the stand as it is now (22 students of 02-1, card numbers):
//   S2001 «неуд.» after three sits (the retakes 2 days and 1 day ago, the second by the commission «Комиссия Стендовая»): card «весь предмет», open, works 3/4 of the maximum;
//   S2003 «не явился(ась)»: card «только экзамен», open, one try today, the total «удовл.» (preliminary);
//   S2020 not admitted: card «весь предмет», closed «сдал» (works 4/5 of the maximum, the exam to «хорошо»);
//   S2006 «неуд.» after one sit: card «весь предмет», teacher3, the deadline 2 days ago («срок вышел»), no works;
//   S2007 «неуд.» after one sit and S2008 «I»: no card (the owner enrols them himself). The others passed.
// The chain of dates (days from today): first sits and the head of the exam -3 -> the final sheet closed -3 -> retakes -2, -1 -> the orders «12-с»:
// S2006 -3 (deadline -2), S2003 and S2020 -1, S2001 today -> the tries and works of the repeat today; the deadline of the others is 30 days ahead.
// The pairs of the closed units stay planned (a condition of the stand): they cannot be marked.
export function seedRepeat(store, platform) {
  const find = (login) => {
    const row = store.list('staff').find((p) => p.login === login);
    if (!row) throw new Error(`seed: no person ${login} for the repeat courses`);
    return row;
  };
  const [teacherRow, deanRow, teacher3] = ['teacher1', 'dean', 'teacher3'].map(find);
  const teacher = staffUser(teacherRow);
  const dean = staffUser(deanRow);
  const group = store.list('groups').find((g) => g.name === '02-1');
  const subject = group && store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id && s.teacherId === teacherRow.id);
  if (!subject) throw new Error('seed: no «Информатика» of teacher1 in 02-1 for the repeat courses');
  const today = todayOf(platform);
  const cardOf = new Map(store.list('students').filter((s) => s.groupId === group.id).map((s) => [s.id, s.cardNo]));
  const first = journalView(readJournalRows(store), platform, subject.id, teacher);
  const { planSemester } = first.subject;
  const { scheme, split } = first;

  const rows = halfResults(readLedgerRows(store, platform), platform, subject, planSemester, dean).students
    .sort((a, b) => cardOf.get(a.id).localeCompare(cardOf.get(b.id)));
  const pick = (list, what) => {
    if (list.length === 0) throw new Error(`seed: no student of 02-1 for the repeat courses: ${what}`);
    return list[0];
  };
  const failed = pick(rows.filter((r) => r.status === 'done' && r.word === 'fail'), 'fail');
  const absent = pick(rows.filter((r) => r.status === 'absent'), 'absent');
  const notAdmitted = pick(rows.filter((r) => r.status === 'not_admitted' && r.complete === true), 'not admitted');
  const [oneSitA, oneSitB] = rows.filter((r) => r.status === 'none' && r.admitted === true);
  if (!oneSitA || !oneSitB) throw new Error('seed: no two students of 02-1 without an exam result for the repeat courses');

  // the old tables: the sits that make the fails, the closing of the final sheet
  const stamp = (date) => ({ updatedBy: teacher.id, updatedAt: `${date} 12:00:00` });
  const sit = (student, no, ago, exam, commission = '') => ({
    subjectId: subject.id, planSemester, studentId: student.id, no, date: addDays(today, -ago), outcome: 'score', score: exam, commission, ...stamp(addDays(today, -ago)),
  });
  const failExam = (student) => Math.min(split.exam, Math.max(0, scheme.fair - 8 - student.semester));
  const again = (student, k) => Math.min(split.exam, student.exam + k, Math.max(student.exam, scheme.fair - 1 - student.semester));
  store.insertMany('examAttempts', [
    sit(failed, 2, 2, again(failed, 1)),
    sit(failed, 3, 1, again(failed, 2), 'Комиссия Стендовая'),
    sit(oneSitA, 1, 3, failExam(oneSitA)),
    sit(oneSitB, 1, 3, failExam(oneSitB)),
  ]);
  store.insertMany('closures', [{
    subjectId: subject.id, planSemester, unit: 0, closedBy: teacher.id, closedAt: `${addDays(today, -3)} 15:00:00`, reopenedBy: '', reopenedAt: '',
  }]);

  // the cards: each is written by a clock of the day of its order (after the closing of the final sheet and the sit before it)
  const card = (student, kind, ago, deadline, teacherId = teacherRow.id) => {
    const at = ago === 0 ? platform : Object.assign(Object.create(platform), { now: () => parseLocalDateTime(`${addDays(today, -ago)} 16:00:00`) });
    return enrol(store, at, {
      subjectId: subject.id, planSemester, studentId: student.id, kind, orderNo: '12-с', orderDate: addDays(today, -ago), deadline, teacherId,
    }, dean).repeat.id;
  };
  const ahead = addDays(today, 30);
  const score = (repeatId, date, exam) => saveAttempt(store, platform, { repeatId, date, outcome: 'score', score: exam }, teacher);

  const worksFull = (share) => Math.round(split.semester * share);
  const fullId = card(failed, 'full', 0, ahead);
  saveWorks(store, platform, { repeatId: fullId, works: worksFull(0.75), note: 'Реферат и две практические работы' }, teacher);

  const examId = card(absent, 'exam', 1, ahead);
  score(examId, today, Math.min(split.exam, Math.max(0, scheme.fair + 2 - absent.semester)));

  const passedId = card(notAdmitted, 'full', 1, ahead);
  const works = worksFull(0.8);
  saveWorks(store, platform, { repeatId: passedId, works, note: 'Реферат и практические работы' }, teacher);
  score(passedId, today, Math.min(split.exam, Math.max(0, scheme.good + 1 - works)));
  closeRepeat(store, platform, { repeatId: passedId }, teacher);

  card(oneSitA, 'full', 3, addDays(today, -2), teacher3.id);
}

// A shared syllabus for the stand, written only through the functions of the line requests. «Информатика», the 2nd half (not the current one): the deanery
// puts teacher3 on the line of teacher1, so it is shared by two. The 1st half (the current one): teacher1 calls teacher3, the call waits; no pair changes.
export function seedShared(store, platform) {
  const person = (login) => store.list('staff').find((p) => p.login === login);
  const asUser = (login) => ({ id: person(login).id, roles: String(person(login).roles).split(',').map((r) => r.trim()), kind: 'staff' });
  const discipline = store.list('disciplines').find((d) => d.name === 'Информатика');
  const lineOf = (semester) => {
    const lines = store.list('syllabusLines').filter((l) => l.disciplineId === discipline.id && l.semester === semester && l.authorId === person('teacher1').id);
    if (lines.length !== 1) throw new Error(`seed: no single line of teacher1 for the half ${semester}`);
    return lines[0];
  };
  addMember(store, platform, { lineId: lineOf(2).id, teacherId: person('teacher3').id }, asUser('dean'));
  inviteMember(store, platform, { lineId: lineOf(1).id, teacherId: person('teacher3').id }, asUser('teacher1'));
}

import { hashPassword } from '../core/auth.js';
import { addDays, mondayOf } from '../core/dates.js';
import { DEFAULT_BELLS, settingsToRows } from '../core/settings.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { generateSchedule, relayout, todayOf } from '../backend/scheduleData.js';
import { publishSyllabusDoc, uploadSyllabus } from '../backend/syllabusUpload.js';
import { draftForm, saveSection, startDraft } from '../backend/syllabusDraft.js';
import { approveSyllabus, returnSyllabus, submitSyllabus } from '../backend/syllabusFlow.js';

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
function fill(store, platform, { passwordHash, names, studentsMustChange, admin }) {
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
}

// Fills an empty dev store with fictional data. Does nothing when `staff` already has rows.
export function seed(store, platform) {
  if (store.list('staff').length > 0) return;
  // The stored hash carries its own salt, so one hash serves every person.
  const passwordHash = hashPassword(platform, DEV_PASSWORD);
  const admin = store.insert('staff', { ...STAFF[0], passwordHash, mustChangePassword: false, active: true, lang: 'ru' });
  fill(store, platform, { passwordHash, names: NAMES.latin, studentsMustChange: true, admin });
}

// The demo data for the working base (Cyrillic names, one password given by the caller): the same data set as the stand, but on a base
// that already has its administrator. The administrator is not touched: no password, no roles, no name. Everything is one transaction
// when the store has them. Does nothing but refuse (returns false) when the store has anyone besides one administrator.
export function seedDemo(store, platform, { password }) {
  const staff = store.list('staff');
  const admin = staff.find((person) => person.login === 'admin');
  if (!admin || staff.length !== 1 || !String(admin.roles).split(',').includes('admin')) return false;
  const passwordHash = hashPassword(platform, password);
  const run = () => fill(store, platform, { passwordHash, names: NAMES.cyrillic, studentsMustChange: false, admin });
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

// Semester from four weeks before this week to the Friday of week 18; one day off on the Wednesday after next Monday.
function seedPairs(store, platform) {
  const thisMonday = mondayOf(todayOf(platform));
  const start = addDays(thisMonday, -28);
  store.insertMany('settings', settingsToRows({
    semesterStart: start, semesterEnd: addDays(start, 123), holidays: [addDays(start, 37)], bells: DEFAULT_BELLS, semester: 1,
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
  store.update('pairs', substitute.id, { teacherId: teacher3.id, changed: true, note: 'Замена' });
  store.update('pairs', cancelled.id, { status: 'cancelled', changed: true });
  relayout(store);
}

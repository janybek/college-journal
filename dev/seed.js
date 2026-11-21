import { hashPassword } from '../core/auth.js';
import { addDays, mondayOf } from '../core/dates.js';
import { DEFAULT_BELLS, settingsToRows } from '../core/settings.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { generateSchedule, relayout, todayOf } from '../backend/scheduleData.js';
import { saveSyllabusDoc } from '../backend/syllabusData.js';

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

const PLAN_HEAD = ['Юнит', '№', 'Тема', 'Лекция, ч (1 пара = 2 ч)', 'Практика, ч (1 пара = 2 ч)', 'Вид занятия', 'СРС, ч', 'Описание'];
const sheetsOf = (info, rows) => [{ name: 'Сведения', cells: info }, { name: 'Тематический план', cells: [PLAN_HEAD, ...rows] }];

// The sample syllabus of «Информатика», semester 1 (fictional): 10 topics, 2 units, 18 pairs; the modules take no hours.
const SYLLABUS_1 = sheetsOf([
  ['Дисциплина', 'Информатика'], ['Преподаватель', 'Teacher One'], ['Курс', 1], ['Семестр', 1], ['Специальность', 'Сестринское дело'],
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
const SYLLABUS_2 = sheetsOf([
  ['Дисциплина', 'Информатика'], ['Преподаватель', 'Teacher One'], ['Курс', 1], ['Семестр', 2], ['Специальность', 'Сестринское дело'],
  ['Кредиты', 1], ['Всего часов', 30], ['Аудиторных часов', 16], ['СРС, часов', 14],
], [
  [1, '1.1', 'Электронные рецепты и льготные лекарства', 2, 2, '', 4, 'Как выписывается и проверяется электронный рецепт.'],
  [1, '1.2', 'Презентация для пациента: памятка и санбюллетень', '', 2, '', 2, 'Короткая памятка для пациента в программе для презентаций.'],
  [2, '2.1', 'Электронная очередь и запись на приём', 2, 2, '', 4, 'Талон, расписание приёма, отмена записи.'],
  [2, '2.2', 'Итоговый проект: цифровой пост отделения', '', 4, '', 4, 'Проект на две пары подряд: рабочее место поста от начала до конца.'],
  [2, '', 'Экзамен', '', 2, 'модуль', '', ''],
]);

// Fills an empty dev store with fictional data. Does nothing when `staff` already has rows.
export function seed(store, platform) {
  if (store.list('staff').length > 0) return;
  // The stored hash carries its own salt, so one hash serves every person.
  const passwordHash = hashPassword(platform, DEV_PASSWORD);
  const common = { passwordHash, mustChangePassword: false, active: true };

  const staff = STAFF.map((person) => store.insert('staff', { ...person, ...common, lang: 'ru' }));
  const teacher1 = staff.find((person) => person.login === 'teacher1');
  const teacher2 = staff.find((person) => person.login === 'teacher2');
  const teacher3 = staff.find((person) => person.login === 'teacher3');
  const disciplines = Object.fromEntries(['Информатика', 'Анатомия'].map((name) => [name, store.insert('disciplines', { name })]));
  const rooms = {};
  for (const name of ['101', '204', '305']) rooms[name] = store.insert('rooms', { name });

  let firstInformatics = null;
  GROUPS.forEach((def, g) => {
    const group = store.insert('groups', { name: def.name, course: def.course });
    const students = [];
    for (let i = 0; i < STUDENTS_PER_GROUP; i++) {
      const cardNo = `S${def.card}${String(i + 1).padStart(3, '0')}`;
      const number = g * STUDENTS_PER_GROUP + i;
      students.push({
        fullName: `${SURNAMES[(number * 5 + g) % SURNAMES.length]} ${GIVEN[number % GIVEN.length]}`,
        groupId: group.id,
        cardNo,
        ...common,
        mustChangePassword: cardNo === 'S1002',
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
    if (g === 0) firstInformatics = informatics.id;
    // Monday: informatics in room 204; Wednesday and Thursday: anatomy in room 101. The pair number is the group number.
    store.insertMany('weekTemplate', [
      { weekday: 1, slot: g + 1, subjectId: informatics.id, roomId: rooms['204'].id },
      { weekday: 3, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
      { weekday: 4, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
    ]);
  });

  // The syllabus belongs to «Информатика» and teacher1: one upload serves both of his groups. teacher3 and «Анатомия» have none.
  for (const sheets of [SYLLABUS_1, SYLLABUS_2]) {
    const { doc, errors } = parseSyllabus(sheets);
    if (errors.length > 0) throw new Error('seed: the sample syllabus does not parse: ' + JSON.stringify(errors));
    saveSyllabusDoc(store, platform, firstInformatics, doc);
  }
  seedPairs(store, platform);
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

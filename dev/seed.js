import { hashPassword } from '../core/auth.js';
import { addDays, mondayOf } from '../core/dates.js';
import { DEFAULT_BELLS, settingsToRows } from '../core/settings.js';
import { generateSchedule, relayout, todayOf } from '../backend/scheduleData.js';

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
const GROUPS = [{ name: '01-1', course: 1 }, { name: '02-1', course: 2 }, { name: '03-1', course: 3 }];
const STUDENTS_PER_GROUP = 22;
const STAFF = [
  { login: 'admin', fullName: 'Admin Demo', roles: 'admin' },
  { login: 'dean', fullName: 'Dean Demo', roles: 'dean,teacher' },
  { login: 'prorector', fullName: 'Prorector Demo', roles: 'prorector' },
  { login: 'teacher1', fullName: 'Teacher One', roles: 'teacher' },
  { login: 'teacher2', fullName: 'Teacher Two', roles: 'teacher' },
  { login: 'teacher3', fullName: 'Teacher Three', roles: 'teacher' },
];

// The 18 topics of the sample «Информатика» (section 12 of the requirements): one row per pair.
// [unit, name, lesson types of its pairs]
const TOPIC_PLAN = [
  [1, 'Цифровой пост медсестры: введение в IT', ['lecture', 'practice']],
  [1, 'Рабочие программы: Windows, МИС и утилиты', ['lecture', 'practice']],
  [1, 'Защита данных: врачебная тайна и кибергигиена', ['lecture', 'practice']],
  [1, 'Медицинский поиск: справочники и инструкции', ['lecture', 'practice']],
  [1, 'Телемедицина и «умные» гаджеты в практике', ['lecture', 'practice']],
  [2, 'Работа в МИС: электронная карта и регистратура', ['lecture', 'practice']],
  [2, 'Аппаратное обеспечение: ПК и периферия', ['practice']],
  [2, 'Медицинский документооборот в Word и Excel', ['practice', 'practice']],
  [2, 'Файловая дисциплина: порядок на рабочем столе', ['practice', 'practice']],
  [2, 'Модуль 2 — экзамен', ['control']],
];

// Semester 2 of the same subject: 6 topics, laid over pairs only when the owner switches the semester.
const TOPIC_PLAN_2 = [
  [1, 'Электронные таблицы: учёт лекарств и расчёт доз', ['lecture', 'practice']],
  [1, 'Презентация для пациента: памятка и санбюллетень', ['practice']],
  [2, 'Электронная очередь и запись на приём', ['lecture', 'practice']],
  [2, 'Модуль 2 — экзамен', ['control']],
];

function planRows(subjectId, plan, semester) {
  const rows = [];
  for (const [unit, name, types] of plan) {
    for (const lessonType of types) rows.push({ subjectId, semester, unit, order: rows.length + 1, name, lessonType });
  }
  return rows;
}

const topicRows = (subjectId) => [...planRows(subjectId, TOPIC_PLAN, 1), ...planRows(subjectId, TOPIC_PLAN_2, 2)];

// Fills an empty dev store with fictional data. Does nothing when `staff` already has rows.
export function seed(store, platform) {
  if (store.list('staff').length > 0) return;
  // The stored hash carries its own salt, so one hash serves every person.
  const passwordHash = hashPassword(platform, DEV_PASSWORD);
  const common = { passwordHash, mustChangePassword: false, active: true };

  const staff = STAFF.map((person) => store.insert('staff', { ...person, ...common, lang: 'ru' }));
  const teacher1 = staff.find((person) => person.login === 'teacher1');
  const teacher2 = staff.find((person) => person.login === 'teacher2');
  const rooms = {};
  for (const name of ['101', '204', '305']) rooms[name] = store.insert('rooms', { name });

  GROUPS.forEach((def, g) => {
    const group = store.insert('groups', { name: def.name, course: def.course });
    const students = [];
    for (let i = 0; i < STUDENTS_PER_GROUP; i++) {
      const cardNo = `S${def.course}${String(i + 1).padStart(3, '0')}`;
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
    const informatics = store.insert('subjects', { name: 'Информатика', teacherId: teacher1.id, groupId: group.id, scheme: 'A' });
    const anatomy = store.insert('subjects', { name: 'Анатомия', teacherId: teacher2.id, groupId: group.id, scheme: 'A' });
    store.insertMany('topics', topicRows(informatics.id));
    // Monday: informatics in room 204; Wednesday and Thursday: anatomy in room 101. The pair number is the group number.
    store.insertMany('weekTemplate', [
      { weekday: 1, slot: g + 1, subjectId: informatics.id, roomId: rooms['204'].id },
      { weekday: 3, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
      { weekday: 4, slot: g + 1, subjectId: anatomy.id, roomId: rooms['101'].id },
    ]);
  });

  seedPairs(store, platform);
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

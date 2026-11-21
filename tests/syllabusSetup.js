// Shared helper of the syllabus tests (not a *.test.js file: `npm test` does not run it on its own, like storeContract.js).
// A test file is never imported from another one: the import would run all its tests again.
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

export const INFO = [['Семестр', 1], ['Специальность', 'Сестринское дело'], ['Кредиты', 1], ['Всего часов', 10], ['Аудиторных часов', 6], ['СРС, часов', 4]];
export const HEAD = ['Юнит', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'Описание'];
export const T = (name, lecture, practice) => [1, '', name, lecture, practice, '', 'О теме ' + name];
export const M = [1, '', '', '', '', 'модуль', ''];                                  // a module without hours: a mark on the last pair of the unit
export const file = (rows, info = INFO) => [{ name: 'Сведения', cells: info }, { name: 'Тематический план', cells: [HEAD, ...rows] }];
export const A = file([T('Введение', 2, 2), T('Практикум', '', 2), M]);             // lessons: Введение — lecture, practice; Практикум — practice
export const FIRST = [['Введение', 'lecture', 1], ['Введение', 'practice', 1]];
export const READS = { subjects: 1, staff: 1, groups: 1, syllabi: 1, topics: 1, pairs: 1, settings: 1 };      // sheets of one upload: each once

export const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: ['2026-09-07'], bells: DEFAULT_BELLS, semester: 1 };

// A spy over the store: lists[table] counts `list`, calls[method] every call, writes['method:table'] the batch writes. reset() clears them in place.
function spyOn(store) {
  const lists = {};
  const calls = {};
  const writes = {};
  const spy = {};
  for (const name of Object.keys(store)) {
    spy[name] = (...args) => {
      calls[name] = (calls[name] || 0) + 1;
      if (name === 'list') lists[args[0]] = (lists[args[0]] || 0) + 1;
      if (['insertMany', 'updateMany', 'removeMany'].includes(name)) writes[`${name}:${args[0]}`] = (writes[`${name}:${args[0]}`] || 0) + 1;
      return store[name](...args);
    };
  }
  const reset = () => {
    for (const bag of [lists, calls, writes]) for (const k of Object.keys(bag)) delete bag[k];
  };
  return { spy, lists, calls, writes, reset };
}

// A fresh store for every test: dean, prorector, teacher1, teacher2; students s1 (01-1) and s2 (02-1); disciplines «Информатика» (ds1) and «Анатомия» (ds2);
// sb1 = ds1 + 01-1 + teacher1 (Tuesday, pair 1: 2026-09-01 and 09-08), sb3 = ds1 + 02-1 + teacher1 (Wednesday: 09-02 and 09-09),
// sb2 = ds2 + 02-1 + teacher2 (Friday); semester 1, the schedule is made.
export function setup() {
  const platform = createNodePlatform({ now: () => Date.UTC(2026, 7, 31, 6), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const spied = spyOn(store);
  const ctx = { store: spied.spy, platform, log: () => {} };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const tokens = {};
  const staff = {};
  for (const [login, roles] of [['dean', 'dean,teacher'], ['prorector', 'prorector'], ['teacher1', 'teacher'], ['teacher2', 'teacher']]) {
    staff[login] = store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'), roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    tokens[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  const g1 = store.insert('groups', { name: '01-1', course: 1 }).id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  for (const [cardNo, groupId] of [['s1', g1], ['s2', g2]]) {
    store.insert('students', { fullName: cardNo, groupId, cardNo, passwordHash: hashPassword(platform, 'secret12'), lang: 'ky', mustChangePassword: false, active: true });
    tokens[cardNo] = call('auth.login', { login: cardNo, password: 'secret12' }).data.token;
  }
  const ds1 = store.insert('disciplines', { name: 'Информатика' }).id;
  const ds2 = store.insert('disciplines', { name: 'Анатомия' }).id;
  const subject = (name, disciplineId, groupId, teacherId) => store.insert('subjects', { name, disciplineId, groupId, teacherId, scheme: 'A' }).id;
  const sb1 = subject('Информатика', ds1, g1, staff.teacher1);
  const sb3 = subject('Информатика', ds1, g2, staff.teacher1);
  const sb2 = subject('Анатомия', ds2, g2, staff.teacher2);
  call('settings.save', { settings: S }, tokens.dean);
  for (const [weekday, subjectId] of [[2, sb1], [3, sb3], [5, sb2]]) store.insert('weekTemplate', { weekday, slot: 1, subjectId, roomId: '' });
  call('schedule.generate', {}, tokens.dean);

  const send = (action, subjectId, sheets, token) => call(action, { subjectId, sheets }, token);
  const pairOf = (subjectId, date) => store.list('pairs').find((p) => p.subjectId === subjectId && p.date === date);
  // the pairs of a subject by date: [date, topic name, lesson type, part]
  const lessons = (subjectId) => {
    const names = new Map(store.list('topics').map((t) => [t.id, t.name]));
    return store.list('pairs').filter((p) => p.subjectId === subjectId).sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => [p.date, names.get(p.topicId) ?? '', p.lessonType, p.part]);
  };
  const snapshot = () => JSON.stringify([store.list('topics'), store.list('syllabi'), store.list('pairs')]);
  return {
    store, spy: spied.spy, call, send, pairOf, lessons, snapshot, lists: spied.lists, calls: spied.calls, writes: spied.writes, reset: spied.reset,
    ...tokens, staff, ds1, ds2, g1, g2, sb1, sb2, sb3, S,
  };
}

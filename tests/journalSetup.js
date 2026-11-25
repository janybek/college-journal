// Shared helper of the journal tests (not a *.test.js file: `npm test` does not run it on its own).
// Fictional people only. A group 01-1 with the subject sb1 (Информатика, teacher1, the approved syllabus of two units: 01.09 and 08.09 are
// unit 1, 15.09 and 22.09 unit 2, 29.09 the control of unit 2) and a group 02-1 with the subject sb2 (Анатомия, teacher2, no syllabus).
// 01.09 and 08.09 of sb1 and 04.09 and 11.09 of sb2 are closed and carry marks; the pair of sb1 on 15.09 is a substitution of teacher3.
import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { localDateTime, parseLocalDateTime } from '../core/dates.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';

export const PASSWORD = 'secret12';
const SEMESTER = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20', holidays: [], bells: DEFAULT_BELLS, semester: 1 };

// UTC milliseconds of a Bishkek date and time (UTC+6).
// `time` is 'HH:MM' or 'HH:MM:SS'.
export const bishkek = (date, time = '12:00') => Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`) - 6 * 3600000;

// A device number of the tests: 32 hex digits of one character.
export const dev = (n) => String(n).repeat(32);

// A spy over the store: lists[table] counts `list`, writes['method:table'] the batch and single writes. reset() clears them in place.
function spyOn(store) {
  const lists = {};
  const writes = {};
  const spy = {};
  for (const name of Object.keys(store)) {
    if (name === 'transaction') { spy[name] = store[name]; continue; }
    spy[name] = (...args) => {
      if (name === 'list') lists[args[0]] = (lists[args[0]] || 0) + 1;
      if (['insert', 'insertMany', 'update', 'updateMany', 'remove', 'removeMany'].includes(name)) writes[`${name}:${args[0]}`] = (writes[`${name}:${args[0]}`] || 0) + 1;
      return store[name](...args);
    };
  }
  const reset = () => { for (const bag of [lists, writes]) for (const k of Object.keys(bag)) delete bag[k]; };
  return { spy, lists, writes, reset };
}

export function setup({ makeStore = (schema, platform) => createMemoryStore(schema, platform), files = createMemoryFiles() } = {}) {
  let now = bishkek('2026-08-31');
  const platform = createNodePlatform({ now: () => now, secret: 'test-secret' });
  const store = makeStore(SCHEMA, platform);
  const spied = spyOn(store);
  const ctx = { store: spied.spy, platform, files, log: () => {} };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const hash = hashPassword(platform, PASSWORD);

  const ids = {};
  const logins = {};      // key -> [login, kind]
  const t = {};
  const staff = (key, fullName, roles) => {
    ids[key] = store.insert('staff', { fullName, login: key, passwordHash: hash, roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    logins[key] = [key, 'staff'];
  };
  staff('admin', 'Администратор Стенда', 'admin');
  staff('dean', 'Деканова Айгуль', 'dean,teacher');
  staff('prorector', 'Проректоров Талант', 'prorector');
  staff('teacher1', 'Иванова Нургуль', 'teacher');
  staff('teacher2', 'Петров Эрмек', 'teacher');
  staff('teacher3', 'Сидорова Алина', 'teacher');

  const g1 = store.insert('groups', { name: '01-1', course: 1 }).id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  const student = (key, fullName, groupId, active = true) => {
    ids[key] = store.insert('students', { fullName, groupId, cardNo: key.toUpperCase(), passwordHash: hash, lang: 'ky', mustChangePassword: false, active }).id;
    if (active) logins[key] = [key.toUpperCase(), 'student'];
  };
  student('a1', 'Асанов Айдар', g1);
  student('a2', 'Өмүров Канат', g1);
  student('a3', 'Ёлкин Бакыт', g1);
  student('a4', 'Яковлев Улан', g1, false);
  student('b1', 'Беков Нурлан', g2);

  const ds1 = store.insert('disciplines', { name: 'Информатика' }).id;
  const ds2 = store.insert('disciplines', { name: 'Анатомия' }).id;
  const sb1 = store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g1, teacherId: ids.teacher1, scheme: 'A' }).id;
  const sb2 = store.insert('subjects', { name: 'Анатомия', disciplineId: ds2, groupId: g2, teacherId: ids.teacher2, scheme: 'A' }).id;

  // the approved syllabus of sb1: unit 1 (lecture, practice), unit 2 (lecture, practice, control)
  const syllabusId = store.insert('syllabi', { disciplineId: ds1, teacherId: ids.teacher1, semester: 1, planSemester: 1, status: 'approved', version: 1 }).id;
  [[1, 'lecture'], [1, 'practice'], [2, 'lecture'], [2, 'practice'], [2, 'control']].forEach(([unit, lessonKind], i) => {
    store.insert('topics', { syllabusId, order: i + 1, unit, lessonKind, name: `Тема ${i + 1}`, hours: 2 });
  });
  applyLinesUpgrade(store, platform);

  // sign-in of everyone at the current moment; the tokens of `t` are replaced in place
  const login = () => {
    for (const [key, [name]] of Object.entries(logins)) t[key] = call('auth.login', { login: name, password: PASSWORD }).data.token;
  };
  const at = (date, time = '12:00') => { now = bishkek(date, time); login(); };
  const tick = (ms) => { now += ms; };         // moves the clock without signing in again

  login();
  call('settings.save', { settings: SEMESTER }, t.dean);
  store.insert('weekTemplate', { weekday: 2, slot: 1, subjectId: sb1, roomId: '' });
  store.insert('weekTemplate', { weekday: 5, slot: 1, subjectId: sb2, roomId: '' });
  call('schedule.generate', {}, t.dean);

  const pairOf = (subjectId, date) => store.list('pairs').find((p) => p.subjectId === subjectId && p.date === date);
  const p0901 = pairOf(sb1, '2026-09-01').id;
  const p0908 = pairOf(sb1, '2026-09-08').id;
  const p0915 = pairOf(sb1, '2026-09-15').id;
  const q0904 = pairOf(sb2, '2026-09-04').id;
  const q0911 = pairOf(sb2, '2026-09-11').id;
  for (const id of [p0901, p0908, q0904, q0911]) store.update('pairs', id, { status: 'closed' });
  store.update('pairs', p0915, { teacherId: ids.teacher3, substitute: true });

  const p0922 = pairOf(sb1, '2026-09-22').id;
  // a started pair written straight into the store (the start button comes later): the window of 5 minutes is open
  const running = (pairId, startedAt, extra = {}) => {
    const pair = store.get('pairs', pairId);
    const until = localDateTime(parseLocalDateTime(startedAt) + 5 * 60000);
    return store.update('pairs', pairId, {
      status: 'running', startedAt, startedBy: pair.teacherId, checkinUntil: until, checkinClosed: false, finishedAt: '', finishedBy: '', ...extra,
    });
  };
  const snapshot = () => JSON.parse(JSON.stringify({
    attendance: store.list('attendance'), checkins: store.list('checkins'), changeLog: store.list('changeLog'), pairs: store.list('pairs'),
    assignments: store.list('assignments'), submissions: store.list('submissions'), files: store.list('files'), unitResults: store.list('unitResults'),
    closures: store.list('closures'), requests: store.list('requests'), announcements: store.list('announcements'), stateExams: store.list('stateExams'),
    stateExamResults: store.list('stateExamResults'), subjectExams: store.list('subjectExams'), examAttempts: store.list('examAttempts'), repeats: store.list('repeats'), repeatAttempts: store.list('repeatAttempts'), settings: store.list('settings'),
    disk: files ? files.names() : [],
  }));

  // an assignment of sb1 written straight into the store; `over` replaces fields
  const task = (over = {}) => store.insert('assignments', {
    subjectId: sb1, kind: 'srs', planSemester: 1, unit: 2, topicId: '', pairId: '', title: 'СРС А', description: '', dueAt: '2026-09-20 23:59:00',
    maxPoints: 10, createdBy: ids.teacher1, createdAt: '2026-09-10 12:00:00', updatedBy: '', updatedAt: '', ...over,
  }).id;
  // an attempt of student `key` written straight into the store
  const attempt = (assignmentId, key, over = {}) => store.insert('submissions', {
    assignmentId, studentId: ids[key], n: 1, text: 'ответ', paper: false, submittedAt: '2026-09-18 10:00:00', status: 'submitted',
    points: null, comment: '', checkedBy: '', checkedAt: '', ...over,
  }).id;

  // a closed unit written straight into the store (unit 0 is the final sheet)
  const closeUnit = (unit, over = {}) => store.insert('closures', {
    subjectId: sb1, planSemester: 1, unit, closedBy: ids.teacher1, closedAt: '2026-09-30 12:00:00', reopenedBy: '', reopenedAt: '', ...over,
  }).id;
  // a request written straight into the store
  const request = (over = {}) => store.insert('requests', {
    kind: 'control', subjectId: sb1, planSemester: 1, unit: 1, pairId: '', assignmentId: '', attemptId: '', studentId: ids.a2, before: '25', after: '31',
    reason: 'ошибка при вводе', authorId: ids.teacher1, createdAt: '2026-10-01 10:00:00', status: 'dean', deanBy: '', deanAt: '', finalBy: '', finalAt: '',
    closedAt: '', closeNote: '', ...over,
  }).id;
  // the numbers of unit 1 from the rules of the unit: through real requests of teacher1 on 30.09 (the current control is computed by itself: a1 38, a2 20, a3 0)
  const unitNumbers = () => {
    at('2026-09-30');
    call('journal.saveResults', { subjectId: sb1, unit: 1, field: 'self', items: [{ studentId: ids.a1, value: 16 }, { studentId: ids.a2, value: 12 }] }, t.teacher1);
    call('journal.saveResults', { subjectId: sb1, unit: 1, field: 'control', items: [{ studentId: ids.a1, value: 30 }, { studentId: ids.a2, value: 25 }] }, t.teacher1);
  };
  // unit 2 written straight into the results (its pairs are not held yet: the current control is manual) and both units closed
  const allUnits = () => {
    unitNumbers();
    const row = (key, current, self, control) => store.insert('unitResults', {
      subjectId: sb1, studentId: ids[key], planSemester: 1, unit: 2, control, self, currentManual: current, updatedBy: ids.teacher1, updatedAt: '2026-12-10 10:00:00',
    });
    row('a1', 26, 15, 30); row('a2', 30, 18, 22); row('a3', 31, 14, 30);
    closeUnit(1);
    closeUnit(2, { closedAt: '2026-12-10 12:00:00' });
  };
  // the head of the exam of sb1 written straight into the store
  const examHead = (over = {}) => store.insert('subjectExams', {
    subjectId: sb1, planSemester: 1, date: '2026-12-15', examiner: '', assistants: 'Ассистент Первый', updatedBy: ids.teacher1, updatedAt: '2026-12-15 09:00:00', ...over,
  }).id;
  // an attempt of the exam written straight into the store
  const examRow = (studentId, over = {}) => store.insert('examAttempts', {
    subjectId: sb1, planSemester: 1, studentId, no: 1, date: '2026-12-15', outcome: 'score', score: 35, commission: '', updatedBy: ids.teacher1, updatedAt: '2026-12-15 12:00:00', ...over,
  }).id;
  const closeFinal = (over = {}) => closeUnit(0, { closedAt: '2026-12-16 12:00:00', ...over });
  // sb1 of the semester 1 closed with a failure: a1 semester 47 + exam 35 = 82 good, a2 38 + 20 = 58 fail, a3 not admitted
  const failed = () => {
    allUnits();
    examHead();
    examRow(ids.a1, { score: 35 });
    examRow(ids.a2, { score: 20 });
    closeFinal();
  };
  // a card of the repeat course written straight into the store; `over` replaces fields
  const repeatCard = (over = {}) => store.insert('repeats', {
    studentId: ids.a2, subjectId: sb1, planSemester: 1, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: ids.teacher1,
    prevSemester: 38, prevAdmitted: true, prevStatus: 'done', prevExam: 20, prevTotal: 58, prevWord: 'fail', prevAttempts: '1|2026-12-15|20', prevRepeatId: '',
    works: null, worksNote: '', status: 'open', createdBy: ids.dean, createdAt: '2026-12-21 10:00:00', updatedBy: ids.dean, updatedAt: '2026-12-21 10:00:00',
    closedBy: '', closedAt: '', ...over,
  }).id;
  // an attempt of the repeat exam written straight into the store
  const repeatTry = (repeatId, over = {}) => store.insert('repeatAttempts', {
    repeatId, no: 1, date: '2027-01-15', outcome: 'score', score: 30, commission: '', updatedBy: ids.teacher1, updatedAt: '2027-01-15 12:00:00', ...over,
  }).id;
  // the second half of the year through the real settings.save of the deanery; returns its response
  const switchSemester = () => {
    at('2027-01-11');
    return call('settings.save', { settings: { semesterStart: '2027-01-11', semesterEnd: '2027-05-30', holidays: [], bells: DEFAULT_BELLS, semester: 2 } }, t.dean);
  };

  const mark = (pairId, key, status, activity, markedAt, extra = {}) => store.insert('attendance', {
    pairId, studentId: ids[key], status, noCoat: false, activity, source: 'teacher', markedBy: ids.teacher1, markedAt, ...extra,
  }).id;
  mark(p0901, 'a1', 'present', null, '2026-09-01 08:10:00');
  mark(p0908, 'a1', 'present', 7, '2026-09-08 08:10:00');
  mark(p0901, 'a2', 'absent', null, '2026-09-01 08:10:00');
  mark(p0908, 'a2', 'late', 5, '2026-09-08 08:10:00');
  mark(p0901, 'a3', 'excused', null, '2026-09-01 08:10:00');
  mark(p0908, 'a3', 'absent', null, '2026-09-08 08:10:00');
  mark(q0904, 'b1', 'present', null, '2026-09-04 08:10:00', { markedBy: ids.teacher2 });
  mark(q0911, 'b1', 'present', 3, '2026-09-11 08:10:00', { markedBy: ids.teacher2 });

  return {
    store, spy: { lists: spied.lists, writes: spied.writes, reset: spied.reset }, platform, call, t, at, tick, running, snapshot, ids, mark, pairOf, files, task, attempt,
    closeUnit, request, unitNumbers, allUnits, examHead, examRow, closeFinal, failed, repeatCard, repeatTry, switchSemester,
    a1: ids.a1, a2: ids.a2, a3: ids.a3, a4: ids.a4, b1: ids.b1, g1, g2, ds1, ds2, sb1, sb2, p0901, p0908, p0915, p0922, q0904, q0911, syllabusId,
  };
}

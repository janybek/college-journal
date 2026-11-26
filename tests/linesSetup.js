// Shared helper of the tests of the syllabus of a discipline (not a *.test.js file: `npm test` does not run it on its own).
// Fictional people only: staff admin, dean (dean + teacher), prorector, t1…t5; students s1…s3 of the groups 01-1, 02-1, 03-1.
// Anatomy (ds1) is led by t1 (01-1, Tuesday), t2 (02-1, Wednesday), t3 (03-1, Thursday); Chemistry (ds2) by t4 (01-1, Friday); t5 teaches nothing.
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { oneMain, mainLine } from '../core/disciplineSyllabus.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { docLessons } from '../core/syllabusPlan.js';
import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { INFO, file } from './syllabusSetup.js';

const UNIT_END = (unit) => [unit, '', '', '', '', 'модуль', ''];
const topic = (unit, name) => [unit, '', name, 2, '', '', 'О теме ' + name];
const plan = (p) => [topic(1, p + '1'), topic(1, p + '2'), topic(1, p + '3'), UNIT_END(1), topic(2, p + '4'), topic(2, p + '5'), UNIT_END(2)];
export const FILE_A = file(plan('А'), INFO);
export const FILE_B = file(plan('Б'), INFO);

const SETTINGS = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20', holidays: [], bells: DEFAULT_BELLS, semester: 1 };

// A spy over a store: lists[table] counts `list`, writes['method:table'] the batch writes. reset() clears them in place.
function spyOn(store) {
  const lists = {};
  const writes = {};
  const spy = {};
  for (const name of Object.keys(store)) {
    if (name === 'transaction') { spy[name] = store[name]; continue; }
    spy[name] = (...args) => {
      if (name === 'list') lists[args[0]] = (lists[args[0]] || 0) + 1;
      if (['insertMany', 'updateMany', 'removeMany'].includes(name)) writes[`${name}:${args[0]}`] = (writes[`${name}:${args[0]}`] || 0) + 1;
      return store[name](...args);
    };
  }
  const reset = () => { for (const bag of [lists, writes]) for (const k of Object.keys(bag)) delete bag[k]; };
  return Object.assign(spy, { lists, writes, reset });
}

// A store that throws on one write of one table (the other calls go to the real store).
export function failingOn(store, method, table) {
  const wrapper = { ...store };
  wrapper[method] = (...args) => {
    if (args[0] === table) throw new Error(`boom: ${method} ${table}`);
    return store[method](...args);
  };
  return wrapper;
}

export function setup({ makeStore = (schema, platform) => createMemoryStore(schema, platform), files } = {}) {
  let clock = Date.UTC(2026, 7, 31, 6);
  const platform = createNodePlatform({ now: () => clock, secret: 'test-secret' });
  const store = makeStore(SCHEMA, platform);
  const spy = spyOn(store);
  const ctx = { store: spy, platform, log: () => {}, files };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const ids = {};
  const names = {};
  const t = {};
  const login = (key) => { t[key] = call('auth.login', { login: key, password: 'secret12' }).data.token; };
  for (const [key, roles] of [['admin', 'admin'], ['dean', 'dean,teacher'], ['prorector', 'prorector'], ['t1', 'teacher'], ['t2', 'teacher'], ['t3', 'teacher'], ['t4', 'teacher'], ['t5', 'teacher']]) {
    names[key] = 'Сотрудник ' + key;
    ids[key] = store.insert('staff', { fullName: names[key], login: key, passwordHash: hashPassword(platform, 'secret12'), roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    login(key);
  }
  const groups = ['01-1', '02-1', '03-1'].map((name) => store.insert('groups', { name, course: 1 }).id);
  ['s1', 's2', 's3'].forEach((key, i) => {
    names[key] = 'Студент ' + key;
    ids[key] = store.insert('students', { fullName: names[key], groupId: groups[i], cardNo: key, passwordHash: hashPassword(platform, 'secret12'), lang: 'ky', mustChangePassword: false, active: true }).id;
    login(key);
  });
  const ds1 = store.insert('disciplines', { name: 'Анатомия' }).id;
  const ds2 = store.insert('disciplines', { name: 'Химия' }).id;
  const subject = (name, disciplineId, groupId, teacherId) => store.insert('subjects', { name, disciplineId, groupId, teacherId, scheme: 'A' }).id;
  const sb1 = subject('Анатомия', ds1, groups[0], ids.t1);
  const sb2 = subject('Анатомия', ds1, groups[1], ids.t2);
  const sb3 = subject('Анатомия', ds1, groups[2], ids.t3);
  const sb4 = subject('Химия', ds2, groups[0], ids.t4);
  call('settings.save', { settings: SETTINGS }, t.dean);
  for (const [weekday, subjectId] of [[2, sb1], [3, sb2], [4, sb3], [5, sb4]]) store.insert('weekTemplate', { weekday, slot: 1, subjectId, roomId: '' });
  call('schedule.generate', {}, t.dean);

  // moves the clock to a date and a time of Bishkek and logs everybody in again (the old tokens may have expired)
  const at = (date, time = '12:00') => {
    clock = Date.parse(`${date}T${time}:00Z`) - 6 * 3600000;
    for (const key of Object.keys(t)) login(key);
  };
  // a file -> the draft (syllabus.apply) -> the sections the draft lacks -> approved; the answer is the one of syllabus.apply
  const publish = (subjectId, sheets, token = t.dean) => {
    const done = call('syllabus.apply', { subjectId, sheets }, token);
    if (!done.ok || !done.data.applied) throw new Error('publish: ' + JSON.stringify(done));
    for (const { syllabusId } of done.data.drafts) {
      const form = call('syllabus.form', { syllabusId }, t.dean).data;
      const title = { ...form.doc.title, department: form.doc.title.department || 'Кафедра', academicYear: form.doc.title.academicYear || '2026–2027', course: form.doc.title.course || 1, credits: form.doc.title.credits || 1 };
      call('syllabus.saveSection', { syllabusId, section: 'title', data: title }, t.dean);
      call('syllabus.saveSection', { syllabusId, section: 'goals', data: { ...form.doc.goals, goal: form.doc.goals.goal || 'Цель курса' } }, t.dean);
      const approved = call('syllabus.approve', { syllabusId }, t.dean);
      if (!approved.ok || !approved.data.approved) throw new Error('publish: not approved: ' + JSON.stringify(approved));
    }
    return done;
  };
  const main = (disciplineId) => mainLine(store.list('syllabusLines'), disciplineId) ?? undefined;
  const lines = (disciplineId) => store.list('syllabusLines').filter((l) => l.disciplineId === disciplineId);
  // a version «as the earlier build kept it»: a row of «Силлабусы» without a line, under the key of the teacher of the subject, and its rows of «Темы»
  const old = (subjectId, sheets, { status = 'approved', semester = 1, version = 1 } = {}) => {
    const subject = store.list('subjects').find((x) => x.id === subjectId);
    const { doc } = parseSyllabus(sheets);
    const half = docLessons(doc).find((x) => x.semester === semester);
    const row = store.insert('syllabi', {
      disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester, planSemester: half ? half.planSemester : null, status, version,
      ...(status === 'approved' ? { decidedAt: '2026-08-31' } : {}),
    });
    (half ? half.rows : []).forEach((r, i) => store.insert('topics', {
      syllabusId: row.id, order: i + 1, unit: r.unit, unitTitle: r.unitTitle, lessonKind: r.lessonKind, name: r.name, hours: r.hours,
      selfHours: r.selfHours, description: r.description, controlForms: '', sourceId: '',
    }));
    return row.id;
  };
  const hold = (subjectId, date) => {
    const pair = store.list('pairs').find((p) => p.subjectId === subjectId && p.date === date);
    store.update('pairs', pair.id, { status: 'closed' });
    return pair;
  };
  const closeUnit = (subjectId, unit, planSemester = 1, over = {}) => store.insert('closures', {
    subjectId, planSemester, unit, closedBy: ids.dean, closedAt: '2026-10-01 10:00:00', reopenedBy: '', reopenedAt: '', ...over,
  });
  const topicsOf = (subjectId) => {
    const named = new Map(store.list('topics').map((x) => [x.id, x.name]));
    return store.list('pairs').filter((p) => p.subjectId === subjectId).sort((a, b) => a.date.localeCompare(b.date)).map((p) => named.get(p.topicId) ?? '');
  };
  const snapshot = () => Object.fromEntries(Object.keys(SCHEMA).map((name) => [name, store.list(name)]));
  return {
    store, files, spied: spy, spy, platform, call, ids, names, t, ds1, ds2, groups, sb1, sb2, sb3, sb4, FILE_A, FILE_B, at, publish, hold, closeUnit,
    topicsOf, snapshot, failingOn: (method, table) => failingOn(store, method, table), main, lines, old,
    oneMain: () => oneMain(store.list('syllabusLines')), upgrade: () => applyLinesUpgrade(store, platform),
  };
}

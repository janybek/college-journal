import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS, readSettings } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { relayout, todayOf } from '../backend/scheduleData.js';

const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: ['2026-09-07'], bells: DEFAULT_BELLS };

// A spy over the store: counts every call by method and every list by table.
function spyOn(store) {
  const calls = {};
  const reads = {};
  const writes = {};
  const spy = {};
  for (const name of Object.keys(store)) {
    spy[name] = (...args) => {
      calls[name] = (calls[name] || 0) + 1;
      if (name === 'list') reads[args[0]] = (reads[args[0]] || 0) + 1;
      if (['insertMany', 'updateMany', 'removeMany'].includes(name)) writes[`${name}:${args[0]}`] = (writes[`${name}:${args[0]}`] || 0) + 1;
      return store[name](...args);
    };
  }
  const reset = () => {
    for (const k of Object.keys(calls)) delete calls[k];
    for (const k of Object.keys(reads)) delete reads[k];
    for (const k of Object.keys(writes)) delete writes[k];
  };
  return { spy, calls, reads, writes, reset };
}

// One plan row, one lecture pair: the row gives one lesson.
const topicRow = (store, syllabusId, order, name) => store.insert('topics', {
  syllabusId, order, unit: 1, label: '', name, lectureHours: 2, practiceHours: 0, practiceKind: '', description: '', kind: 'topic',
}).id;

function setup({ withSettings = true, withTemplate = true } = {}) {
  const state = { now: Date.UTC(2026, 7, 31, 6) };
  const platform = createNodePlatform({ now: () => state.now, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const spied = spyOn(store);
  const ctx = { store: spied.spy, platform, log: () => {} };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const tokens = {};
  const staff = {};
  for (const [login, roles] of [['dean', 'dean,teacher'], ['prorector', 'prorector'], ['teacher1', 'teacher'], ['teacher2', 'teacher']]) {
    staff[login] = store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
      roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    tokens[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  const g1 = store.insert('groups', { name: '01-1', course: 1 }).id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  const ds1 = store.insert('disciplines', { name: 'Информатика' }).id;
  const ds2 = store.insert('disciplines', { name: 'Анатомия' }).id;
  const sb1 = store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g1, teacherId: staff.teacher1, scheme: 'A' }).id;
  const sb2 = store.insert('subjects', { name: 'Анатомия', disciplineId: ds2, groupId: g2, teacherId: staff.teacher2, scheme: 'A' }).id;
  const r1 = store.insert('rooms', { name: '101' }).id;
  const r2 = store.insert('rooms', { name: '102' }).id;
  const syllabus1 = store.insert('syllabi', { disciplineId: ds1, teacherId: staff.teacher1, semester: 1, planSemester: 1 }).id;
  const topics = [1, 2, 3].map((order) => topicRow(store, syllabus1, order, 'Тема ' + order));
  if (withSettings) call('settings.save', { settings: S }, tokens.dean);
  const wt = withTemplate
    ? [[2, 1, sb1, r1], [1, 2, sb1, r1], [5, 1, sb2, '']].map(([weekday, slot, subjectId, roomId]) =>
      store.insert('weekTemplate', { weekday, slot, subjectId, roomId }).id)
    : [];
  return { store, state, call, calls: spied.calls, reads: spied.reads, writes: spied.writes, reset: spied.reset, ...tokens, staff, g1, g2, ds1, sb1, sb2, r1, r2, topics, wt };
}

test('generate: dry run, real run, repeat, later start, topics laid over pairs', () => {
  const { store, state, call, dean, sb1, r1, r2, topics: [topic1, topic2], wt } = setup();
  assert.equal(todayOf({ now: () => state.now }), '2026-08-31');
  const dry = call('schedule.generate', { dryRun: true }, dean).data;
  assert.deepEqual(dry, { from: '2026-09-01', to: '2026-09-11', inserted: 4, updated: 0, removed: 0, kept: 0, conflicts: 0 });
  assert.equal(store.list('pairs').length, 0);
  assert.deepEqual(call('schedule.generate', {}, dean).data, dry);
  const mine = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(mine().map(p => [p.date, p.topicId]), [['2026-09-01', topic1], ['2026-09-08', topic2]]);
  assert.deepEqual(mine().map(p => [p.lessonType, p.part]), [['lecture', 1], ['lecture', 1]]);

  assert.deepEqual(call('schedule.generate', {}, dean).data, { ...dry, inserted: 0, kept: 4 });
  assert.equal(store.list('pairs').length, 4);
  state.now = Date.UTC(2026, 8, 3, 6);
  store.update('weekTemplate', wt[0], { roomId: r2 });
  const later = call('schedule.generate', {}, dean).data;
  assert.deepEqual(later, { from: '2026-09-03', to: '2026-09-11', inserted: 0, updated: 1, removed: 0, kept: 2, conflicts: 0 });
  assert.equal(mine()[0].roomId, r1);
  assert.equal(mine()[1].roomId, r2);
});

test('generate: one write per kind, every sheet read at most once', () => {
  const { store, call, calls, reads, reset, dean, wt, r2 } = setup();
  reset();
  call('schedule.generate', {}, dean);
  assert.deepEqual([calls.insertMany, calls.updateMany || 0, calls.removeMany || 0], [1, 1, 0]);
  assert.equal((calls.insert || 0) + (calls.update || 0) + (calls.remove || 0), 0);
  assert.equal(Math.max(...Object.values(reads)), 1);

  store.update('weekTemplate', wt[0], { roomId: r2 });
  store.remove('weekTemplate', wt[2]);
  reset();
  call('schedule.generate', {}, dean);
  assert.deepEqual([calls.insertMany || 0, calls.removeMany], [0, 1]);
  assert.equal(calls.updateMany <= 2, true);
  assert.equal((calls.insert || 0) + (calls.update || 0) + (calls.remove || 0), 0);
  assert.equal(Math.max(...Object.values(reads)), 1);
});

test('generate: errors', () => {
  const { call, dean, prorector, teacher1 } = setup();
  assert.deepEqual(call('schedule.generate', {}, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('schedule.generate', {}, prorector).error, { code: 'forbidden' });
  const noSettings = setup({ withSettings: false });
  assert.deepEqual(noSettings.call('schedule.generate', {}, noSettings.dean).error,
    { code: 'invalid', fields: [{ field: 'semesterStart', code: 'required' }] });
  const noTemplate = setup({ withTemplate: false });
  assert.deepEqual(noTemplate.call('schedule.generate', {}, noTemplate.dean).error, { code: 'empty_template' });
});

test('generate: restart', () => {
  const { store, call, dean } = setup();
  call('schedule.generate', {}, dean);
  const [first] = store.list('pairs');
  store.update('pairs', first.id, { status: 'closed' });
  assert.deepEqual(call('schedule.generate', { restart: true }, dean).error, { code: 'in_use' });
  assert.equal(store.list('pairs').length, 4);
  store.update('pairs', first.id, { status: 'planned' });
  const done = call('schedule.generate', { restart: true }, dean).data;
  assert.deepEqual([done.removed, done.inserted], [4, 4]);
  assert.equal(store.list('pairs').length, 4);
});

test('relayout: nothing to change writes nothing and uses the rows it is given', () => {
  const { store, call, calls, reset, dean } = setup();
  call('schedule.generate', {}, dean);
  reset();
  const result = relayout(store, null, { subjects: store.list('subjects'), syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs'), settings: readSettings(store.list('settings')) });
  assert.equal(result.changed, 0);
  assert.equal(result.pairs.length, 4);
  assert.equal(result.subjects.length, 2);
  assert.deepEqual(calls, {});
});

test('generate: pairs between today and a later semester start are removed, held ones stay', () => {
  const { store, call, dean, sb1, topics } = setup();
  assert.equal(call('schedule.generate', {}, dean).ok, true);
  assert.equal(call('settings.save', { settings: { ...S, semesterStart: '2026-09-04' } }, dean).ok, true);
  const sb1Pairs = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(sb1Pairs().map(p => [p.date, p.topicId]), [['2026-09-01', ''], ['2026-09-08', topics[0]]]);
  const preview = call('schedule.generate', { dryRun: true }, dean).data;
  assert.deepEqual([preview.from, preview.removed, preview.kept], ['2026-09-04', 1, 3]);
  const early = store.list('pairs').find((p) => p.subjectId === sb1 && p.date === '2026-09-01');
  store.update('pairs', early.id, { status: 'closed' });
  assert.equal(call('schedule.generate', {}, dean).data.removed, 0);
  assert.equal(store.get('pairs', early.id).status, 'closed');
  store.update('pairs', early.id, { status: 'planned' });
  assert.equal(call('schedule.generate', {}, dean).data.removed, 1);
  assert.equal(store.list('pairs').some((p) => p.date < '2026-09-04'), false);
});

test('semester: only topics of the current semester are laid, switching moves them', () => {
  const { store, state, call, dean, staff, ds1, sb1, topics: [topic1, topic2] } = setup();
  const spring = store.insert('syllabi', { disciplineId: ds1, teacherId: staff.teacher1, semester: 2, planSemester: 2 }).id;
  const b1 = topicRow(store, spring, 1, 'Второй семестр 1');
  const b2 = topicRow(store, spring, 2, 'Второй семестр 2');
  call('schedule.generate', {}, dean);
  const mine = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
  const withoutTopic = () => mine().filter((p) => p.status === 'planned' && p.topicId === '' && p.date >= settings().semesterStart && p.date <= settings().semesterEnd).length;
  const settings = () => call('settings.get', {}, dean).data.settings;
  assert.deepEqual(mine().map(p => p.topicId), [topic1, topic2]);
  assert.equal(settings().semester, 1);

  store.update('pairs', mine()[0].id, { status: 'closed' });
  assert.equal(call('settings.save', { settings: { ...S, semester: 2 } }, dean).data.settings.semester, 2);
  assert.deepEqual(mine().map(p => p.topicId), [topic1, b1]);
  assert.deepEqual([settings().semester, withoutTopic()], [2, 0]);
  assert.equal(call('settings.save', { settings: S }, dean).data.settings.semester, 2);
  assert.deepEqual(mine().map(p => p.topicId), [topic1, b1]);
  call('settings.save', { settings: { ...S, semester: 1 } }, dean);
  assert.deepEqual(mine().map(p => p.topicId), [topic1, topic2]);

  state.now = Date.UTC(2026, 8, 12, 6);
  const dean12 = call('auth.login', { login: 'dean', password: 'secret12' }).data.token;
  assert.equal(call('settings.save', { settings: { semesterStart: '2026-09-14', semesterEnd: '2026-09-25', holidays: [], bells: DEFAULT_BELLS, semester: 2 } }, dean12).ok, true);
  assert.equal(call('schedule.generate', {}, dean12).data.inserted, 6);
  assert.deepEqual(mine().map(p => [p.date, p.topicId]), [['2026-09-01', topic1], ['2026-09-08', topic2],
    ['2026-09-14', b1], ['2026-09-15', b2], ['2026-09-21', ''], ['2026-09-22', '']]);
  assert.deepEqual([mine().filter((p) => p.date >= '2026-09-14' && p.topicId === '').length, call('topics.plan', { subjectId: sb1 }, dean12).error], [2, { code: 'bad_request' }]);
});

test('semester switch and pair changes read each sheet at most once', () => {
  const { store, call, calls, reads, writes, reset, dean, sb1 } = setup();
  call('schedule.generate', {}, dean);
  const check = (label, response) => {
    assert.equal(response.ok, true, label);
    for (const [table, n] of Object.entries(reads)) assert.ok(n <= 1, `${label}: ${table} read ${n} times`);
    assert.ok((calls.update || 0) <= 1, label + ': update');
    assert.ok((writes['updateMany:pairs'] || 0) <= 1, label + ': updateMany pairs');
    reset();
  };
  reset();
  check('switch', call('settings.save', { settings: { ...S, semester: 2 } }, dean));
  const same = call('settings.save', { settings: { ...S, semester: 2 } }, dean);
  assert.deepEqual([same.ok, reads.topics || 0, reads.pairs || 0], [true, 0, 0]);
  reset();
  check('generate', call('schedule.generate', {}, dean));
  const moved = store.list('pairs').find(p => p.subjectId === sb1 && p.date === '2026-09-08').id;
  check('move', call('schedule.changePair', { id: moved, date: '2026-09-10', slot: 2 }, dean));
  check('cancel', call('schedule.cancelPair', { id: moved }, dean));
  check('restore', call('schedule.restorePair', { id: moved }, dean));
});

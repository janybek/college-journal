import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { relayout, todayOf } from '../backend/scheduleData.js';

const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: ['2026-09-07'], bells: DEFAULT_BELLS };
const HEAD = ['Предмет', 'Группа', 'Семестр', 'Юнит', '№', 'Тема', 'Тип'];

// A spy over the store: counts every call by method and every list by table.
function spyOn(store) {
  const calls = {};
  const reads = {};
  const spy = {};
  for (const name of Object.keys(store)) {
    spy[name] = (...args) => {
      calls[name] = (calls[name] || 0) + 1;
      if (name === 'list') reads[args[0]] = (reads[args[0]] || 0) + 1;
      return store[name](...args);
    };
  }
  const reset = () => {
    for (const k of Object.keys(calls)) delete calls[k];
    for (const k of Object.keys(reads)) delete reads[k];
  };
  return { spy, calls, reads, reset };
}

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
  const sb1 = store.insert('subjects', { name: 'Информатика', groupId: g1, teacherId: staff.teacher1, scheme: 'A' }).id;
  const sb2 = store.insert('subjects', { name: 'Анатомия', groupId: g2, teacherId: staff.teacher2, scheme: 'A' }).id;
  const r1 = store.insert('rooms', { name: '101' }).id;
  const r2 = store.insert('rooms', { name: '102' }).id;
  const topics = [1, 2, 3].map((order) => store.insert('topics', { subjectId: sb1, unit: 1, order, name: 'Тема ' + order, lessonType: 'lecture' }).id);
  if (withSettings) call('settings.save', { settings: S }, tokens.dean);
  const wt = withTemplate
    ? [[2, 1, sb1, r1], [1, 2, sb1, r1], [5, 1, sb2, '']].map(([weekday, slot, subjectId, roomId]) =>
      store.insert('weekTemplate', { weekday, slot, subjectId, roomId }).id)
    : [];
  return { store, state, call, calls: spied.calls, reads: spied.reads, reset: spied.reset, ...tokens, staff, g1, g2, sb1, sb2, r1, r2, topics, wt };
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
  const plan = call('topics.plan', { subjectId: sb1 }, dean).data;
  assert.deepEqual(plan.topics.map(t => [t.order, t.pair && t.pair.date]), [[1, '2026-09-01'], [2, '2026-09-08'], [3, null]]);
  assert.equal(plan.withoutTopic, 0);
  assert.equal(JSON.stringify(plan).includes('passwordHash'), false);
  assert.deepEqual(plan.subject, { id: sb1, name: 'Информатика', groupId: plan.subject.groupId, groupName: '01-1', teacherId: plan.subject.teacherId, teacherName: 'teacher1' });
  assert.deepEqual(Object.keys(plan.topics[0]), ['id', 'unit', 'order', 'name', 'lessonType', 'pair']);
  assert.deepEqual(plan.topics[0].pair, { id: mine()[0].id, date: '2026-09-01', slot: 1, startTime: '08:00', status: 'planned' });

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

test('topics are laid over pairs after directory edits and imports', () => {
  const { store, call, dean, sb1, sb2, topics: [topic1, topic2, topic3] } = setup();
  call('schedule.generate', {}, dean);
  const mine = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
  call('dir.remove', { table: 'topics', id: topic1 }, dean);
  assert.deepEqual(mine().map(p => p.topicId), [topic2, topic3]);

  call('import.apply', { table: 'topics', cells: [HEAD, ['Анатомия', '02-1', 1, 1, 1, 'Кости', 'лекция']] }, dean);
  const sb2Pair = store.list('pairs').find(p => p.subjectId === sb2 && p.date === '2026-09-04');
  assert.equal(sb2Pair.topicId, store.list('topics').find(t => t.subjectId === sb2).id);

  store.update('pairs', mine()[0].id, { status: 'closed' });
  const cells = [HEAD,
    ['Информатика', '01-1', 1, 1, 2, 'Другое название', 'лекция'],
    ['Информатика', '01-1', 1, 1, 4, 'Новая тема', 'практика']];
  const imported = call('import.apply', { table: 'topics', cells }, dean).data;
  assert.deepEqual([imported.inserted, imported.updated, imported.skipped, imported.errors], [1, 0, 1, [{ row: 2, field: 'name', code: 'held' }]]);
  assert.deepEqual(call('topics.plan', { subjectId: sb1 }, dean).data.topics.map(t => [t.order, t.name === 'Другое название', t.pair && t.pair.date]),
    [[2, false, '2026-09-01'], [3, false, '2026-09-08'], [4, false, null]]);

  // a topic added by dir.save lands on the free pair
  const added = call('dir.save', { table: 'topics', row: { subjectId: sb1, unit: 1, order: 1, name: 'Раньше всех', lessonType: 'lecture' } }, dean).data.row;
  assert.equal(mine()[1].topicId, added.id);
});

test('topic writes read each sheet once and batch their writes', () => {
  const { store, call, calls, reads, reset, dean, sb1, topics: [topic1] } = setup();
  call('schedule.generate', {}, dean);
  const check = () => {
    assert.equal(Math.max(...Object.values(reads)), 1);
    assert.equal((calls.update || 0) + (calls.remove || 0), 0);
    assert.equal((calls.updateMany || 0) <= 2, true);
  };
  reset();
  call('dir.remove', { table: 'topics', id: topic1 }, dean);
  assert.equal(calls.remove, 1);
  assert.equal(Math.max(...Object.values(reads)), 1);
  reset();
  call('dir.save', { table: 'topics', row: { subjectId: sb1, unit: 1, order: 9, name: 'Ещё', lessonType: 'lecture' } }, dean);
  assert.equal(Math.max(...Object.values(reads)), 1);
  reset();
  call('import.apply', { table: 'topics', cells: [HEAD,
    ['Информатика', '01-1', 1, 1, 2, 'Переименована', 'лекция'], ['Информатика', '01-1', 1, 1, 10, 'Десятая', 'лекция']] }, dean);
  check();
  assert.equal(store.list('topics').find(t => t.order === 2).name, 'Переименована');
});

test('relayout: nothing to change writes nothing and uses the rows it is given', () => {
  const { store, call, calls, reset, dean } = setup();
  call('schedule.generate', {}, dean);
  reset();
  const result = relayout(store, null, { topics: store.list('topics'), pairs: store.list('pairs') });
  assert.equal(result.changed, 0);
  assert.equal(result.pairs.length, 4);
  assert.deepEqual(calls, {});
});

test('topics.plan: access and not found', () => {
  const { call, dean, teacher1, sb1, sb2 } = setup();
  call('schedule.generate', {}, dean);
  assert.equal(call('topics.plan', { subjectId: sb1 }, teacher1).ok, true);
  assert.deepEqual(call('topics.plan', { subjectId: sb2 }, teacher1).error, { code: 'forbidden' });
  assert.equal(call('topics.plan', { subjectId: sb2 }, dean).ok, true);
  assert.deepEqual(call('topics.plan', { subjectId: 'sb_nope' }, dean).error, { code: 'not_found' });
  assert.equal(call('topics.plan', { subjectId: sb2 }, dean).data.withoutTopic, 2);
});

test('generate: pairs between today and a later semester start are removed, held ones stay', () => {
  const { store, call, dean, sb1 } = setup();
  assert.equal(call('schedule.generate', {}, dean).ok, true);
  assert.equal(call('settings.save', { settings: { ...S, semesterStart: '2026-09-04' } }, dean).ok, true);
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

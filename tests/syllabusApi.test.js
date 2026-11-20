import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS, readSettings } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { importHandlers } from '../backend/handlers/import.js';

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
      if (name === 'list' || name === 'get') reads[args[0]] = (reads[args[0]] || 0) + 1;
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
  if (withSettings) call('settings.save', { settings: S }, tokens.dean);
  const wt = withTemplate
    ? [[2, 1, sb1, r1], [1, 2, sb1, r1], [5, 1, sb2, '']].map(([weekday, slot, subjectId, roomId]) =>
      store.insert('weekTemplate', { weekday, slot, subjectId, roomId }).id)
    : [];
  if (withSettings && withTemplate) call('schedule.generate', {}, tokens.dean);
  return { store, platform, state, call, calls: spied.calls, reads: spied.reads, writes: spied.writes, reset: spied.reset, ...tokens, staff, g1, g2, sb1, sb2, r1, r2, wt };
}

const HEAD = ['Семестр', 'Модуль', '№', 'Тема', 'Тип'];
const year = [HEAD, [1, 1, 1, 'Введение', 'лекция'], [1, 1, 2, 'Практикум', 'практика'], [1, 2, 3, 'Рубежный', 'рубежный'],
  [2, 1, 1, 'Таблицы', 'лекция'], [2, 2, 2, 'Экзамен', 'экзамен']];

test('syllabus upload and topic editing by the teacher of the subject', () => {
  const { store, platform, call, calls, reads, reset, dean, prorector, teacher1, sb1, sb2 } = setup();
  const send = (action, subjectId, cells, token) => call(action, { subjectId, cells }, token);

  const pre = send('syllabus.preview', sb1, year, teacher1).data;
  assert.deepEqual([pre.total, pre.valid, pre.newCount, pre.updateCount, pre.errors], [5, 5, 5, 0, []]);
  assert.equal(store.list('topics').length, 0);
  const first = send('syllabus.apply', sb1, year, teacher1).data;
  assert.deepEqual([first.inserted, first.updated, first.skipped, first.passwords, first.errors], [5, 0, 0, [], []]);
  assert.deepEqual(store.list('topics').map(t => [t.subjectId, t.semester]), [[sb1, 1], [sb1, 1], [sb1, 1], [sb1, 2], [sb1, 2]]);
  const plan = call('topics.plan', { subjectId: sb1 }, teacher1).data;
  assert.deepEqual([plan.semester, plan.canEdit], [1, true]);
  assert.deepEqual(plan.topics.map(t => [t.semester, t.order, t.pair && t.pair.date]),
    [[1, 1, '2026-09-01'], [1, 2, '2026-09-08'], [1, 3, null], [2, 1, null], [2, 2, null]]);
  const again = send('syllabus.apply', sb1, year, teacher1).data;
  assert.deepEqual([again.inserted, again.updated, store.list('topics').length], [0, 5, 5]);

  assert.deepEqual(send('syllabus.preview', sb2, year, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(send('syllabus.apply', sb2, year, teacher1).error, { code: 'forbidden' });
  assert.equal(store.list('topics').some(t => t.subjectId === sb2), false);
  assert.deepEqual(send('syllabus.apply', sb1, year, prorector).error, { code: 'forbidden' });
  assert.equal(send('syllabus.apply', sb2, year, dean).data.inserted, 5);
  assert.deepEqual(send('syllabus.apply', 'sb_nope', year, dean).error, { code: 'not_found' });
  assert.deepEqual(send('syllabus.apply', sb1, 'x', teacher1).error, { code: 'bad_request' });
  assert.deepEqual(send('syllabus.apply', 5, year, teacher1).error, { code: 'bad_request' });
  const noColumn = send('syllabus.apply', sb1, [['Модуль', '№', 'Тема', 'Тип'], [1, 1, 'Т', 'лекция']], teacher1).data;
  assert.deepEqual([noColumn.inserted, noColumn.missingColumns], [0, ['semester']]);

  store.update('pairs', store.list('pairs').find(p => p.subjectId === sb1 && p.date === '2026-09-01').id, { status: 'closed' });
  const shifted = [HEAD, [1, 1, 1, 'Новое введение', 'лекция'], [1, 1, 2, 'Введение', 'лекция'], [1, 1, 3, 'Практикум', 'практика']];
  const res = send('syllabus.apply', sb1, shifted, teacher1).data;
  assert.deepEqual([res.inserted, res.updated, res.skipped, res.errors], [0, 2, 1, [{ row: 2, field: 'name', code: 'held' }]]);
  assert.deepEqual(call('topics.plan', { subjectId: sb1 }, teacher1).data.topics.slice(0, 3).map(t => [t.order, t.name, t.pair && t.pair.date]),
    [[1, 'Введение', '2026-09-01'], [2, 'Введение', '2026-09-08'], [3, 'Практикум', null]]);

  const save = (row, token) => call('dir.save', { table: 'topics', row }, token);
  const own = save({ subjectId: sb1, semester: 2, unit: 1, order: 3, name: 'Своя тема', lessonType: 'lecture' }, teacher1).data.row;
  assert.equal(own.semester, 2);
  assert.deepEqual(save({ subjectId: sb2, semester: 1, unit: 1, order: 9, name: 'Чужая', lessonType: 'lecture' }, teacher1).error, { code: 'forbidden' });
  const before = store.list('topics').length;
  for (const subjectId of [[sb2], ` ${sb2} `]) {
    assert.deepEqual(save({ subjectId, semester: 1, unit: 1, order: 9, name: 'Чужая', lessonType: 'lecture' }, teacher1).error, { code: 'forbidden' });
  }
  assert.equal(store.list('topics').length, before);
  assert.equal(save({ subjectId: 'sb_nope', semester: 1, unit: 1, order: 9, name: 'Ничья', lessonType: 'lecture' }, teacher1).error.code, 'invalid');
  const foreign = store.insert('topics', { subjectId: sb2, semester: 1, unit: 1, order: 8, name: 'Тема коллеги', lessonType: 'lecture' });
  assert.deepEqual(save({ id: foreign.id, name: 'Не моя' }, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.remove', { table: 'topics', id: foreign.id }, teacher1).error, { code: 'forbidden' });
  assert.equal(store.get('topics', foreign.id).name, 'Тема коллеги');
  assert.equal(call('dir.remove', { table: 'topics', id: own.id }, teacher1).ok, true);
  assert.equal(save({ id: foreign.id, name: 'Правка деканата' }, dean).ok, true);
  assert.deepEqual(save({ id: foreign.id, semester: 2 }, dean).error, { code: 'invalid', fields: [{ field: 'semester', code: 'bad_value' }] });
  assert.equal(save({ id: foreign.id, semester: '' }, dean).ok, true);
  assert.equal(save({ subjectId: sb2, semester: 2, unit: 1, order: 8, name: 'Тот же номер, другой семестр', lessonType: 'lecture' }, dean).ok, true);
  assert.deepEqual(call('dir.list', { table: 'topics' }, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('dir.save', { table: 'rooms', row: { name: '999' } }, teacher1).error, { code: 'forbidden' });
  assert.deepEqual([call('topics.plan', { subjectId: sb2 }, prorector).data.canEdit, call('topics.plan', { subjectId: sb2 }, dean).data.canEdit], [false, true]);

  const orphan = store.insert('topics', { subjectId: 'sb_gone', semester: 1, unit: 1, order: 1, name: 'Сирота', lessonType: 'lecture' });
  assert.deepEqual(call('dir.remove', { table: 'topics', id: orphan.id }, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(save({ id: orphan.id, name: 'Моя' }, teacher1).error, { code: 'forbidden' });
  assert.equal(call('dir.remove', { table: 'topics', id: orphan.id }, dean).ok, true);

  const hctx = { store, platform, log: () => {} };
  assert.throws(() => importHandlers['import.preview']({ table: 'syllabus', cells: [HEAD] }, hctx), { code: 'bad_request' });
  assert.throws(() => importHandlers['import.apply']({ table: 'syllabus', cells: [HEAD] }, hctx), { code: 'bad_request' });

  reset();
  assert.equal(send('syllabus.apply', sb1, year, dean).ok, true);
  for (const [table, n] of Object.entries(reads)) assert.ok(n <= 1, `${table} read ${n} times`);
  assert.equal(reads.subjects, 1);
  assert.equal((calls.update || 0) + (calls.remove || 0) + (calls.removeMany || 0), 0);
  assert.ok((calls.insertMany || 0) <= 1);
  assert.ok((calls.updateMany || 0) <= 2);
});

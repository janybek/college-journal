import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { pairViews } from '../backend/scheduleData.js';

const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-25', holidays: ['2026-09-07'], bells: DEFAULT_BELLS };

// A spy over the store: counts every call by method and every list by table.
function spyOn(store) {
  const calls = {};
  const reads = {};
  const updates = [];
  const spy = {};
  for (const name of Object.keys(store)) {
    spy[name] = (...args) => {
      calls[name] = (calls[name] || 0) + 1;
      if (name === 'list') reads[args[0]] = (reads[args[0]] || 0) + 1;
      if (name === 'update' && args[0] === 'pairs') updates.push(args[2]);
      return store[name](...args);
    };
  }
  const reset = () => {
    for (const k of Object.keys(calls)) delete calls[k];
    for (const k of Object.keys(reads)) delete reads[k];
  };
  return { spy, calls, reads, updates, reset };
}

function setup() {
  const state = { now: Date.UTC(2026, 7, 31, 6) };
  const platform = createNodePlatform({ now: () => state.now, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const spied = spyOn(store);
  const ctx = { store: spied.spy, platform, log: () => {} };
  const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
  const hash = hashPassword(platform, 'secret12');
  const t = {};
  const ids = {};
  for (const [login, roles] of [['dean', 'dean'], ['prorector', 'prorector'], ['teacher1', 'teacher'], ['teacher2', 'teacher'], ['teacher3', 'teacher']]) {
    ids[login] = store.insert('staff', { fullName: login, login, passwordHash: hash, roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    t[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  const g1 = store.insert('groups', { name: '01-1', course: 1 }).id;
  const g2 = store.insert('groups', { name: '02-1', course: 1 }).id;
  for (const [cardNo, groupId] of [['S1', g1], ['S2', g2]]) {
    store.insert('students', { fullName: cardNo, groupId, cardNo, passwordHash: hash, lang: 'ky', mustChangePassword: false, active: true });
    t[cardNo] = call('auth.login', { login: cardNo, password: 'secret12' }).data.token;
  }
  const sb1 = store.insert('subjects', { name: 'Информатика', groupId: g1, teacherId: ids.teacher1, scheme: 'A' }).id;
  const sb2 = store.insert('subjects', { name: 'Анатомия', groupId: g2, teacherId: ids.teacher2, scheme: 'A' }).id;
  const r1 = store.insert('rooms', { name: '101' });
  const r2 = store.insert('rooms', { name: '102' });
  for (const order of [1, 2, 3, 4]) store.insert('topics', { subjectId: sb1, unit: 1, order, name: 'Тема ' + order, lessonType: 'lecture' });
  call('settings.save', { settings: S }, t.dean);
  store.insert('weekTemplate', { weekday: 2, slot: 1, subjectId: sb1, roomId: r1.id });
  store.insert('weekTemplate', { weekday: 5, slot: 1, subjectId: sb2, roomId: r2.id });
  assert.equal(call('schedule.generate', {}, t.dean).ok, true);
  const idAt = (subjectId, date) => store.list('pairs').find((p) => p.subjectId === subjectId && p.date === date).id;
  return {
    store, spy: spied.spy, state, call, calls: spied.calls, reads: spied.reads, updates: spied.updates, reset: spied.reset, ...t, ids, g1, g2, sb1, sb2, r1Name: r1.name, r2Id: r2.id,
    pair1: idAt(sb1, '2026-09-01'), pair8: idAt(sb1, '2026-09-08'), pair15: idAt(sb1, '2026-09-15'), pair22: idAt(sb1, '2026-09-22'),
  };
}

test('schedule views: mine, list, filters, limits and permissions', () => {
  const x = setup();
  const { call, state, store } = x;
  state.now = Date.UTC(2026, 8, 1, 18, 30); // 00:30 on 2 September in Bishkek
  const week = call('schedule.mine', { from: '2026-09-10' }, x.S1).data;
  assert.deepEqual([week.today, week.from, week.to], ['2026-09-02', '2026-09-07', '2026-09-13']);
  assert.deepEqual(week.pairs.map(p => [p.date, p.subjectName, p.teacherName, p.roomName, p.topic.order, p.startTime, p.endTime]),
    [['2026-09-08', 'Информатика', 'teacher1', x.r1Name, 2, '08:00', '09:30']]);
  assert.equal(JSON.stringify(week).includes('passwordHash'), false);
  assert.deepEqual([call('schedule.mine', {}, x.S1).data.from, call('schedule.mine', {}, x.S1).data.to], ['2026-08-31', '2026-09-06']);
  assert.deepEqual(call('schedule.mine', { from: 'мусор' }, x.S1).error, { code: 'bad_request' });

  assert.deepEqual(call('schedule.mine', { from: '2026-09-07' }, x.S2).data.pairs.map(p => [p.date, p.groupId]), [['2026-09-11', x.g2]]);
  assert.deepEqual(call('schedule.mine', { from: '2026-09-07' }, x.teacher1).data.pairs.map(p => p.date), ['2026-09-08']);
  assert.deepEqual(call('schedule.list', { from: '2026-09-07' }, x.S1).error, { code: 'forbidden' });
  assert.deepEqual(call('schedule.list', { from: '2026-09-07' }, x.teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('schedule.changePair', { id: x.pair8, slot: 2 }, x.teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('schedule.cancelPair', { id: x.pair8 }, x.prorector).error, { code: 'forbidden' });
  assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11' }, x.prorector).data.pairs.length, 4);
  assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11', groupId: x.g1 }, x.dean).data.pairs.length, 2);
  assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11', teacherId: x.ids.teacher2 }, x.dean).data.pairs.length, 2);
  assert.deepEqual(call('schedule.list', { from: '2026-09-01', to: '2026-10-15' }, x.dean).error, { code: 'bad_request' });
  assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-10-01' }, x.dean).ok, true);
  assert.deepEqual(call('schedule.list', { from: '2026-09-01', to: '2026-10-02' }, x.dean).error, { code: 'bad_request' });
  assert.deepEqual(call('schedule.list', { from: '2026-09-10', to: '2026-09-09' }, x.dean).error, { code: 'bad_request' });
  assert.deepEqual(call('schedule.list', { from: 'мусор' }, x.dean).error, { code: 'bad_request' });
  const firstWeek = call('schedule.list', {}, x.dean).data;
  assert.deepEqual([firstWeek.today, firstWeek.from, firstWeek.to], ['2026-09-02', '2026-08-31', '2026-09-06']);

  // a pair without a room: the room name is an empty string; the view carries exactly the documented fields
  store.update('pairs', x.pair8, { roomId: '' });
  const view = call('schedule.list', { from: '2026-09-08', to: '2026-09-08' }, x.dean).data.pairs[0];
  assert.equal(view.roomName, '');
  assert.deepEqual(Object.keys(view), ['id', 'date', 'slot', 'startTime', 'endTime', 'status', 'groupId', 'groupName', 'subjectId', 'subjectName',
    'teacherId', 'teacherName', 'roomId', 'roomName', 'topic', 'substitution', 'moved', 'planDate', 'planSlot', 'note']);
});

test('pairViews reads each sheet once and skips sheets it was given', () => {
  const x = setup();
  x.reset();
  pairViews(x.spy, () => true);
  assert.deepEqual(x.reads, { pairs: 1, topics: 1, groups: 1, subjects: 1, staff: 1, rooms: 1 });
  x.reset();
  pairViews(x.spy, () => true, { pairs: [], topics: [], groups: [], subjects: [], staff: [], rooms: [] });
  assert.deepEqual(x.reads, {});
});

test('cancel, restore, move and substitute one pair; topics follow', () => {
  const x = setup();
  const { call, state, store } = x;
  state.now = Date.UTC(2026, 8, 1, 18, 30);
  store.update('pairs', x.pair1, { status: 'closed' });
  const topicsByDate = () => Object.fromEntries(call('schedule.list', { from: '2026-09-01', to: '2026-09-25', groupId: x.g1 }, x.dean).data.pairs
    .map(p => [p.date, p.topic ? p.topic.order : null]));
  const cancelled = call('schedule.cancelPair', { id: x.pair8, note: '  Преподаватель на конференции ' }, x.dean).data.pair;
  assert.deepEqual([cancelled.status, cancelled.note, cancelled.topic], ['cancelled', 'Преподаватель на конференции', null]);
  assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': null, '2026-09-15': 2, '2026-09-22': 3 });
  assert.equal(call('schedule.restorePair', { id: x.pair8 }, x.dean).data.pair.status, 'planned');
  assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': 2, '2026-09-15': 3, '2026-09-22': 4 });
  assert.equal(store.get('pairs', x.pair8).note, '');

  const moved = call('schedule.changePair', { id: x.pair22, date: '2026-09-10', slot: 2 }, x.dean).data.pair;
  assert.deepEqual([moved.date, moved.startTime, moved.moved, moved.planDate, moved.planSlot], ['2026-09-10', '09:40', true, '2026-09-22', 1]);
  assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': 2, '2026-09-10': 3, '2026-09-15': 4 });

  const sub = call('schedule.changePair', { id: x.pair15, teacherId: x.ids.teacher3, note: 'Болезнь' }, x.dean).data.pair;
  assert.deepEqual([sub.teacherName, sub.substitution, sub.moved, sub.note], ['teacher3', true, false, 'Болезнь']);
  assert.deepEqual(call('schedule.mine', { from: '2026-09-14' }, x.teacher3).data.pairs.map(p => p.date), ['2026-09-15']);
  assert.equal(call('schedule.mine', { from: '2026-09-14' }, x.teacher1).data.pairs.length, 0);

  assert.deepEqual(call('schedule.changePair', { id: x.pair15, date: '2026-09-06' }, x.dean).error, { code: 'invalid', fields: [{ field: 'date', code: 'day_off' }] });
  assert.deepEqual(call('schedule.changePair', { id: x.pair15, date: '2026-09-10', slot: 2 }, x.dean).error,
    { code: 'invalid', fields: [{ field: 'slot', code: 'group_busy' }, { field: 'roomId', code: 'room_busy' }] });
  assert.deepEqual(call('schedule.changePair', { id: x.pair1, slot: 2 }, x.dean).error, { code: 'pair_locked' });
  assert.deepEqual(call('schedule.restorePair', { id: x.pair15 }, x.dean).error, { code: 'pair_locked' });
  assert.deepEqual(call('schedule.cancelPair', { id: 'p_nope' }, x.dean).error, { code: 'not_found' });
  assert.deepEqual(call('schedule.changePair', { id: 5 }, x.dean).error, { code: 'not_found' });
  assert.deepEqual(call('schedule.cancelPair', { id: x.pair15, note: 'x'.repeat(201) }, x.dean).error, { code: 'invalid', fields: [{ field: 'note', code: 'too_long' }] });
  // staff tokens live 7 days: log in again at each new date
  const loginDean = () => call('auth.login', { login: 'dean', password: 'secret12' }).data.token;
  state.now = Date.UTC(2026, 8, 9, 6);
  const dean9 = loginDean();
  assert.deepEqual(call('schedule.cancelPair', { id: x.pair8 }, dean9).error, { code: 'in_past' });
  assert.deepEqual(call('schedule.changePair', { id: x.pair8, slot: 2 }, dean9).error, { code: 'in_past' });
  store.update('pairs', x.pair15, { status: 'cancelled' });
  state.now = Date.UTC(2026, 8, 16, 6);
  assert.deepEqual(call('schedule.restorePair', { id: x.pair15 }, loginDean()).error, { code: 'in_past' });
});

test('changing one pair reads each sheet at most once and writes in batches', () => {
  const x = setup();
  const { call, calls, reads, reset } = x;
  const check = (label, response) => {
    assert.equal(response.ok, true, label);
    for (const [table, n] of Object.entries(reads)) assert.ok(n <= 1, `${label}: ${table} read ${n} times`);
    assert.ok((calls.update || 0) <= 1, label + ': update');
    assert.ok((calls.updateMany || 0) <= 1, label + ': updateMany');
    assert.equal(calls.remove || 0, 0, label + ': remove');
    assert.equal(calls.removeMany || 0, 0, label + ': removeMany');
  };
  reset();
  check('move', call('schedule.changePair', { id: x.pair22, date: '2026-09-10', slot: 2 }, x.dean));
  reset();
  check('substitute', call('schedule.changePair', { id: x.pair15, teacherId: x.ids.teacher3 }, x.dean));
  reset();
  check('cancel', call('schedule.cancelPair', { id: x.pair8 }, x.dean));
  reset();
  check('restore', call('schedule.restorePair', { id: x.pair8 }, x.dean));
});

test('restoring a pair onto a place somebody took is refused', () => {
  const x = setup();
  const { call, store } = x;
  assert.equal(call('schedule.cancelPair', { id: x.pair8, note: 'Конференция' }, x.dean).ok, true);
  // pair22 (same group) takes the place of the cancelled pair
  assert.equal(call('schedule.changePair', { id: x.pair22, date: '2026-09-08', slot: 1 }, x.dean).ok, true);
  const refused = call('schedule.restorePair', { id: x.pair8 }, x.dean).error;
  assert.equal(refused.code, 'invalid');
  assert.ok(refused.fields.some((f) => f.field === 'slot' && f.code === 'group_busy'));
  assert.equal(store.get('pairs', x.pair8).status, 'cancelled');
});

test('a note-only edit keeps the pair free and writes only the note; a room change freezes it', () => {
  const x = setup();
  const { call, store, updates } = x;
  updates.length = 0;
  const view = call('schedule.changePair', { id: x.pair15, note: 'Принести халаты' }, x.dean).data.pair;
  assert.equal(view.note, 'Принести халаты');
  assert.deepEqual(updates, [{ note: 'Принести халаты' }]);
  assert.equal(store.get('pairs', x.pair15).changed, false);
  updates.length = 0;
  assert.equal(call('schedule.changePair', { id: x.pair15, roomId: x.r2Id }, x.dean).ok, true);
  assert.deepEqual(updates, [{ roomId: x.r2Id, changed: true }]);
  assert.equal(store.get('pairs', x.pair15).changed, true);
  updates.length = 0;
  assert.equal(call('schedule.changePair', { id: x.pair22 }, x.dean).ok, true);
  assert.deepEqual(updates, []);
});

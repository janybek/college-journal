import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';

function setup() {
  const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  const reads = [];
  const spy = { ...store, list: (table) => { reads.push(table); return store.list(table); } };
  const ctx = { store: spy, platform };
  const call = (action, data, token) => { reads.length = 0; return handleRequest(JSON.stringify({ action, data, token }), ctx); };
  const tokens = {};
  const staff = {};
  for (const [login, roles] of [['admin', 'admin'], ['dean', 'dean'], ['prorector', 'prorector'],
    ['teacher1', 'teacher'], ['teacher2', 'teacher'], ['teacher3', 'teacher']]) {
    staff[login] = store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'),
      roles, lang: 'ky', mustChangePassword: false, active: true }).id;
    tokens[login] = call('auth.login', { login, password: 'secret12' }).data.token;
  }
  const g = ['g1', 'g2', 'g3'].map((name) => store.insert('groups', { name, course: 1 }).id);
  const subj = (name, groupId, teacherId) => store.insert('subjects', { name, groupId, teacherId, scheme: 'A' }).id;
  const sb = [subj('Информатика', g[0], staff.teacher1), subj('Анатомия', g[0], staff.teacher2), subj('Химия', g[1], staff.teacher1)];
  const r = ['r1', 'r2', 'r3'].map((name) => store.insert('rooms', { name }).id);
  call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: ['08:00', '09:40'] } }, tokens.dean);
  return { store, call, reads, tokens, staff, g, sb, r };
}

test('weekTemplate and topics through the directories, delete protection', () => {
  const { call, tokens: { admin, dean, prorector, teacher1 }, sb, r, g, staff, store } = setup();
  const wt = call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 1, subjectId: sb[0], roomId: r[0] } }, dean).data.row;
  assert.deepEqual(wt, { id: wt.id, weekday: 1, slot: 1, subjectId: sb[0], roomId: r[0] });
  assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 1, subjectId: sb[1], roomId: r[1] } }, dean).error,
    { code: 'invalid', fields: [{ field: 'slot', code: 'group_busy' }] });
  assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 3, subjectId: sb[1], roomId: r[1] } }, dean).error,
    { code: 'invalid', fields: [{ field: 'slot', code: 'bad_value' }] });
  assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 2, slot: 1, subjectId: sb[1], roomId: '' } }, prorector).error, { code: 'forbidden' });
  assert.equal(call('dir.list', { table: 'weekTemplate' }, prorector).data.rows.length, 1);
  assert.deepEqual(call('dir.list', { table: 'topics' }, teacher1).error, { code: 'forbidden' });

  const tp = call('dir.save', { table: 'topics', row: { subjectId: sb[0], unit: 1, order: 1, name: 'Введение', lessonType: 'lecture' } }, dean).data.row;
  assert.deepEqual(call('dir.save', { table: 'topics', row: { subjectId: sb[0], unit: 1, order: 1, name: 'Дубль', lessonType: 'lecture' } }, dean).error,
    { code: 'invalid', fields: [{ field: 'order', code: 'duplicate' }] });
  assert.deepEqual(call('dir.save', { table: 'topics', row: { id: tp.id, subjectId: sb[2] } }, dean).error,
    { code: 'invalid', fields: [{ field: 'subjectId', code: 'bad_value' }] });
  assert.equal(call('dir.save', { table: 'topics', row: { id: tp.id, name: 'Введение в IT' } }, dean).data.row.name, 'Введение в IT');

  assert.deepEqual(call('dir.remove', { table: 'subjects', id: sb[0] }, dean).error, { code: 'in_use' });
  assert.deepEqual(call('dir.remove', { table: 'rooms', id: r[0] }, dean).error, { code: 'in_use' });
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { id: sb[0], groupId: g[1] } }, dean).error,
    { code: 'invalid', fields: [{ field: 'groupId', code: 'in_use' }] });
  assert.equal(call('dir.save', { table: 'subjects', row: { id: sb[0], teacherId: staff.teacher2 } }, dean).ok, true);

  // sb3 (teacher1) takes the same slot as sb1 (now teacher2); handing sb3 to teacher2 collides
  assert.equal(call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 1, subjectId: sb[2], roomId: r[1] } }, dean).ok, true);
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { id: sb[2], teacherId: staff.teacher2 } }, dean).error,
    { code: 'invalid', fields: [{ field: 'teacherId', code: 'teacher_busy' }] });

  // a pair that refers to a group, teacher, room, topic and subject
  const tp9 = store.insert('topics', { subjectId: sb[2], unit: 1, order: 1, name: 'T9', lessonType: 'lecture' }).id;
  const pair = store.insert('pairs', { date: '2026-09-01', slot: 1, startTime: '08:00', groupId: g[2], subjectId: sb[2],
    teacherId: staff.teacher3, roomId: r[2], topicId: tp9, status: 'closed', planDate: '2026-09-01', planSlot: 1 });
  for (const [table, id] of [['groups', g[2]], ['staff', staff.teacher3], ['rooms', r[2]], ['topics', tp9], ['subjects', sb[2]]]) {
    assert.deepEqual(call('dir.remove', { table, id }, admin).error, { code: 'in_use' }, table);
  }
  store.update('pairs', pair.id, { status: 'planned' });
  assert.equal(call('dir.remove', { table: 'topics', id: tp9 }, admin).ok, true);
  assert.equal(call('dir.remove', { table: 'weekTemplate', id: wt.id }, dean).ok, true);
});

test('directories read only the sheets they need, each once', () => {
  const { call, reads, tokens: { dean }, sb, r } = setup();
  call('dir.save', { table: 'groups', row: { name: '09-9', course: 3 } }, dean);
  assert.deepEqual(reads, ['groups']);
  call('dir.save', { table: 'subjects', row: { id: sb[1], name: 'Анатомия' } }, dean);
  assert.deepEqual([...reads].sort(), ['groups', 'pairs', 'staff', 'subjects', 'weekTemplate']);
  call('dir.remove', { table: 'rooms', id: r[1] }, dean);
  assert.equal(reads.includes('students'), false);
  assert.equal(new Set(reads).size, reads.length);
});

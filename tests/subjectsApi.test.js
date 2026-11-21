import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { hashPassword } from '../core/auth.js';
import { handleRequest } from '../backend/api.js';
import { linkSubjects } from '../backend/subjectData.js';

const lists = {};
const calls = {};
const writes = {};
const reset = () => { for (const o of [lists, calls, writes]) for (const k of Object.keys(o)) delete o[k]; };
const bump = (o, key) => { o[key] = (o[key] || 0) + 1; };

const platform = createNodePlatform({ now: () => 1_000_000, secret: 'test-secret' });
const store = createMemoryStore(SCHEMA, platform);
// The spy counts every read per sheet (`list`), every single-row write and every batch write per sheet.
const spy = {
  ...store,
  list: (table) => { bump(lists, table); return store.list(table); },
  insert: (...a) => { bump(calls, 'insert'); return store.insert(...a); },
  update: (...a) => { bump(calls, 'update'); return store.update(...a); },
  remove: (...a) => { bump(calls, 'remove'); return store.remove(...a); },
  insertMany: (table, rows) => { bump(writes, `insertMany:${table}`); return store.insertMany(table, rows); },
  updateMany: (table, rows) => { bump(writes, `updateMany:${table}`); return store.updateMany(table, rows); },
  removeMany: (table, ids) => { bump(writes, `removeMany:${table}`); return store.removeMany(table, ids); },
};
const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store: spy, platform, log: () => {} });

const staff = {};
const tokens = {};
for (const [login, roles] of [['dean', 'dean'], ['prorector', 'prorector'], ['teacher1', 'teacher'], ['teacher2', 'teacher']]) {
  staff[login] = store.insert('staff', { fullName: login, login, passwordHash: hashPassword(platform, 'secret12'), roles, lang: 'ky', mustChangePassword: false, active: true }).id;
  tokens[login] = call('auth.login', { login, password: 'secret12' }).data.token;
}
const { dean, prorector, teacher1 } = tokens;
const g1 = store.insert('groups', { name: '01-1', course: 1 }).id;
const g2 = store.insert('groups', { name: '02-1', course: 2 }).id;

// Every test starts without disciplines, subjects, template rows and pairs.
function clean() {
  for (const t of ['subjects', 'disciplines', 'weekTemplate', 'pairs']) for (const r of store.list(t)) store.remove(t, r.id);
  reset();
}

test('disciplines: one name for every group, rename reaches the subjects, delete protection', () => {
  clean();
  const ds = call('dir.save', { table: 'disciplines', row: { name: 'Информатика' } }, dean).data.row;
  assert.deepEqual(call('dir.save', { table: 'disciplines', row: { name: ' информатика ' } }, dean).error, { code: 'invalid', fields: [{ field: 'name', code: 'duplicate' }] });
  const sb = call('dir.save', { table: 'subjects', row: { disciplineId: ds.id, groupId: g1, teacherId: staff.teacher1, name: 'Что угодно' } }, dean).data.row;
  assert.deepEqual([sb.name, sb.disciplineId], ['Информатика', ds.id]);                    // the name from the site is not accepted
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { name: 'Без дисциплины', groupId: g2, teacherId: staff.teacher1 } }, dean).error,
    { code: 'invalid', fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { disciplineId: ds.id, groupId: g1, teacherId: staff.teacher2 } }, dean).error,
    { code: 'invalid', fields: [{ field: 'disciplineId', code: 'duplicate' }] });
  reset();
  assert.equal(call('dir.save', { table: 'disciplines', row: { id: ds.id, name: 'Информатика и ИТ' } }, dean).ok, true);
  assert.equal(store.get('subjects', sb.id).name, 'Информатика и ИТ');
  assert.deepEqual([lists.subjects, writes['updateMany:subjects']], [1, 1]);
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { id: sb.id, name: 'Руками' } }, dean).data.row.name, 'Информатика и ИТ');
  assert.deepEqual(call('dir.remove', { table: 'disciplines', id: ds.id }, dean).error, { code: 'in_use' });
  // the discipline of a subject that stands in the week template cannot change
  const other = call('dir.save', { table: 'disciplines', row: { name: 'Анатомия' } }, dean).data.row;
  store.insert('weekTemplate', { weekday: 1, slot: 1, subjectId: sb.id, roomId: '' });
  assert.deepEqual(call('dir.save', { table: 'subjects', row: { id: sb.id, disciplineId: other.id } }, dean).error, { code: 'invalid', fields: [{ field: 'disciplineId', code: 'in_use' }] });
  assert.deepEqual(call('dir.save', { table: 'disciplines', row: { name: 'Химия' } }, prorector).error, { code: 'forbidden' });
  assert.equal(call('dir.remove', { table: 'disciplines', id: other.id }, dean).ok, true);
});

test('subjects.add: one discipline, several groups, each with its teacher; all or nothing', () => {
  clean();
  const ds = store.insert('disciplines', { name: 'Информатика' }).id;
  const bad = call('subjects.add', { disciplineId: ds, items: [{ groupId: g1, teacherId: staff.teacher1 }, { groupId: g1, teacherId: staff.teacher2 }, { groupId: 'g_x', teacherId: staff.prorector }] }, dean);
  assert.deepEqual(bad.error, { code: 'invalid', fields: [{ index: 1, field: 'disciplineId', code: 'duplicate' }, { index: 2, field: 'teacherId', code: 'bad_value' }, { index: 2, field: 'groupId', code: 'bad_ref' }] });
  assert.equal(store.list('subjects').length, 0);
  reset();
  const done = call('subjects.add', { disciplineId: ds, name: 'Руками', items: [{ groupId: g1, teacherId: staff.teacher1 }, { groupId: g2, teacherId: staff.teacher2, name: 'Руками' }] }, dean).data;
  assert.deepEqual(done.rows.map((s) => [s.name, s.disciplineId, s.groupId, s.teacherId, s.scheme]), [['Информатика', ds, g1, staff.teacher1, 'A'], ['Информатика', ds, g2, staff.teacher2, 'A']]);
  assert.deepEqual([lists, writes, calls.insert || 0], [{ subjects: 1, staff: 1, groups: 1, disciplines: 1 }, { 'insertMany:subjects': 1 }, 0]);
  assert.deepEqual(call('subjects.add', { disciplineId: 'ds_x', items: [{ groupId: g1, teacherId: staff.teacher1 }] }, dean).error.fields[0], { index: 0, field: 'disciplineId', code: 'bad_ref' });
  for (const data of [{ disciplineId: 5, items: [] }, { disciplineId: ds, items: [] }, { disciplineId: ds, items: 'x' }, { disciplineId: ds, items: [5] }, { disciplineId: ds, items: Array(31).fill({ groupId: g1, teacherId: staff.teacher1 }) }]) {
    assert.deepEqual(call('subjects.add', data, dean).error, { code: 'bad_request' });
  }
  for (const token of [prorector, teacher1]) assert.deepEqual(call('subjects.add', { disciplineId: ds, items: [{ groupId: g1, teacherId: staff.teacher1 }] }, token).error, { code: 'forbidden' });
});

test('subjects.add: an array instead of an id is not an id', () => {
  clean();
  const ds = store.insert('disciplines', { name: 'Информатика' }).id;
  const res = call('subjects.add', { disciplineId: ds, items: [{ groupId: [g1], teacherId: [staff.teacher1] }] }, dean);
  assert.deepEqual(res.error, { code: 'invalid', fields: [{ index: 0, field: 'teacherId', code: 'bad_ref' }, { index: 0, field: 'groupId', code: 'bad_ref' }] });
  assert.equal(store.list('subjects').length, 0);
});

test('linkSubjects: old subjects get a discipline by their name; a second run writes nothing', () => {
  clean();
  const row = (name, groupId) => store.insert('subjects', { name, groupId, teacherId: staff.teacher1, scheme: 'A' });
  const have = store.insert('disciplines', { name: 'Анатомия' }).id;
  const [a, b, c, d] = [row('Информатика', g1), row(' информатика ', g2), row('Анатомия', g1), row('', g2)];
  reset();
  assert.deepEqual(linkSubjects(spy), { created: 1, linked: 3, unlinked: 1 });
  assert.deepEqual(store.list('disciplines').map((x) => x.name), ['Анатомия', 'Информатика']);
  const now = (x) => store.get('subjects', x.id);
  assert.equal(now(a).disciplineId, now(b).disciplineId);
  assert.deepEqual([now(b).name, now(c).disciplineId, now(d).disciplineId], ['Информатика', have, '']);       // the name of b is rewritten with the discipline's
  assert.deepEqual([lists, writes], [{ subjects: 1, disciplines: 1 }, { 'insertMany:disciplines': 1, 'updateMany:subjects': 1 }]);
  reset();
  assert.deepEqual([linkSubjects(spy), writes], [{ created: 0, linked: 0, unlinked: 1 }, {}]);
});

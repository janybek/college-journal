import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { ANNOUNCE } from '../core/announce.js';
import { ANNOUNCE_TABLES } from '../backend/announceData.js';

// Announcements: to everyone, to teachers or to a group. Fictional people only. teacher1 teaches in g1, teacher2 in g2.
const mk = (s) => {
  const A = { audience: 'group', groupId: s.g1, title: 'Собрание', text: 'В 15:00 в ауд. 204', expiresOn: '' };
  const save = (data, token = s.t.teacher1) => s.call('announce.save', { ...A, ...data }, token);
  const ids = (token) => s.call('announce.list', {}, token).data.items.map((x) => x.id).sort();
  return { save, ids };
};

test('announce: rights, checks, who sees what, removal', () => {
  const s = setup();
  s.at('2026-11-01');
  const { save, ids } = mk(s);
  const before = s.snapshot();
  for (const who of ['prorector', 'a1']) assert.equal(save({}, s.t[who]).error.code, 'forbidden');
  assert.equal(save({ groupId: s.g2 }).error.code, 'forbidden');
  for (const audience of ['all', 'teachers']) assert.equal(save({ audience }).error.code, 'forbidden');
  for (const groupId of [[s.g1], 5, 'нет', ' ' + s.g1]) assert.deepEqual(save({ groupId }).error.fields, [{ field: 'groupId', code: 'bad_ref' }]);
  assert.deepEqual(save({ title: ' ' }).error.fields, [{ field: 'title', code: 'empty' }]);
  assert.deepEqual(save({ expiresOn: '2026-10-31' }).error.fields, [{ field: 'expiresOn', code: 'in_past' }]);
  assert.deepEqual(s.snapshot(), before);
  const own = save({}).data.item.id;
  const all = save({ audience: 'all', groupId: s.g1, title: 'Субботник' }, s.t.dean).data.item.id;
  const staffOnly = save({ audience: 'teachers', title: 'Педсовет' }, s.t.admin).data.item.id;
  assert.equal(s.store.get('announcements', all).groupId, '');
  assert.deepEqual(ids(s.t.a1), [own, all].sort());
  assert.deepEqual(ids(s.t.b1), [all]);
  assert.deepEqual(ids(s.t.teacher2), [all, staffOnly].sort());
  assert.deepEqual(ids(s.t.teacher1), [own, all, staffOnly].sort());
  for (const who of ['dean', 'prorector', 'admin']) assert.deepEqual(ids(s.t[who]), [own, all, staffOnly].sort());
  const studentJson = JSON.stringify(s.call('announce.list', {}, s.t.b1).data);
  for (const leak of ['Собрание', 'Педсовет', s.g1, s.a1, 'passwordHash']) assert.equal(studentJson.includes(leak), false, leak);
  assert.deepEqual(s.call('announce.list', {}, s.t.a1).data.can, { write: false, audiences: [], groups: [] });
  assert.deepEqual(s.call('announce.list', {}, s.t.teacher1).data.can.audiences, ['group']);
  assert.deepEqual(s.call('announce.list', {}, s.t.teacher1).data.can.groups, [{ id: s.g1, name: '01-1' }]);
  assert.deepEqual(s.call('announce.list', {}, s.t.dean).data.can.audiences, ['all', 'teachers', 'group']);
  assert.equal(s.call('announce.list', {}, s.t.dean).data.can.groups.length, 2);
  assert.deepEqual(s.call('announce.list', {}, s.t.prorector).data.can, { write: false, audiences: [], groups: [] });
  const item = s.call('announce.list', {}, s.t.a1).data.items.find((x) => x.id === own);
  assert.deepEqual([item.authorName, item.groupName, item.own, item.can.remove, item.until], ['Иванова Нургуль', '01-1', false, false, '2026-12-01']);
  const mid = s.snapshot();
  assert.equal(s.call('announce.remove', { id: all }, s.t.teacher1).error.code, 'forbidden');
  assert.equal(s.call('announce.remove', { id: own }, s.t.teacher2).error.code, 'forbidden');
  assert.equal(s.call('announce.remove', { id: own }, s.t.a1).error.code, 'forbidden');
  for (const id of [[own], 5, 'нет']) assert.equal(s.call('announce.remove', { id }, s.t.dean).error.code, 'not_found');
  assert.deepEqual(s.snapshot(), mid);
  assert.equal(s.call('announce.remove', { id: own }, s.t.teacher1).ok, true);
  assert.deepEqual(ids(s.t.a1), [all]);
  assert.equal(s.store.list('announcements').length, 3);
  const row = s.store.get('announcements', own);
  assert.deepEqual([row.removedBy, row.removedAt !== ''], [s.ids.teacher1, true]);
  const removed = s.snapshot();
  assert.equal(s.call('announce.remove', { id: own }, s.t.teacher1).ok, true);
  assert.deepEqual(s.snapshot(), removed);
});

test('announce: the term of showing', () => {
  const s = setup();
  s.at('2026-11-01');
  const { save, ids } = mk(s);
  const open = save({}).data.item.id;
  const dated = save({ expiresOn: '2026-11-10' }).data.item.id;
  s.at('2026-12-01');
  assert.deepEqual(ids(s.t.a1), [open]);
  s.at('2026-12-02');
  assert.deepEqual(ids(s.t.a1), []);
  s.at('2026-11-10');
  assert.deepEqual(ids(s.t.a1), [open, dated].sort());
  s.at('2026-11-11');
  assert.deepEqual(ids(s.t.a1), [open]);
});

test('announce: twenty a day per author, a removed one counts; the next day is free', () => {
  const s = setup();
  s.at('2026-11-01');
  const { save } = mk(s);
  const first = save({}).data.item.id;
  for (let i = 1; i < ANNOUNCE.perDay; i++) assert.equal(save({ title: 'N' + i }).ok, true);
  s.call('announce.remove', { id: first }, s.t.teacher1);
  const full = s.snapshot();
  assert.equal(save({}).error.code, 'too_many');
  assert.deepEqual(s.snapshot(), full);
  assert.equal(save({}, s.t.dean).ok, true);
  s.at('2026-11-02');
  assert.equal(save({}).ok, true);
});

test('announce: the deanery removes a teacher announcement; markup is stored as it is; a teacher who lost the group', () => {
  const s = setup();
  s.at('2026-11-01');
  const { save, ids } = mk(s);
  const xss = '<img src=x onerror=alert(1)>';
  const id = save({ text: xss }).data.item.id;
  assert.equal(s.call('announce.list', {}, s.t.a1).data.items[0].text, xss);
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher3 });
  assert.equal(save({}).error.code, 'forbidden');
  assert.deepEqual(ids(s.t.teacher1), [id]);
  assert.equal(s.call('announce.list', {}, s.t.teacher1).data.can.write, false);
  assert.equal(s.call('announce.remove', { id }, s.t.teacher1).ok, true);
  const id2 = save({}, s.t.teacher3).data.item.id;
  assert.equal(s.call('announce.remove', { id: id2 }, s.t.dean).ok, true);
  assert.equal(s.store.get('announcements', id2).removedBy, s.ids.dean);
});

test('announce: every table is read at most once, the students never', () => {
  const s = setup();
  s.at('2026-11-01');
  const { save } = mk(s);
  const id = save({}).data.item.id;
  for (const who of ['a1', 'teacher1', 'dean']) {
    s.spy.reset();
    assert.equal(s.call('announce.list', {}, s.t[who]).ok, true);
    for (const table of ANNOUNCE_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, table);
    assert.equal(s.spy.lists.students || 0, 0);
  }
  for (const act of [() => save({}), () => s.call('announce.remove', { id }, s.t.teacher1)]) {
    s.spy.reset();
    act();
    assert.equal(s.spy.lists.students || 0, 0);
    for (const table of ANNOUNCE_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, table);
  }
});

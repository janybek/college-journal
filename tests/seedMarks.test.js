import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { SCHEMA } from '../core/schema.js';
import { journalView, readJournalRows } from '../backend/journalData.js';
import { approveSyllabus } from '../backend/syllabusFlow.js';
import { seed, seedAdmin, seedDemo } from '../dev/seed.js';
import { bishkek } from './journalSetup.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek

function stand(fill = seed) {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  fill(store, platform);
  return { store, platform };
}

const subjectOf = (store, name, group) => {
  const groupId = store.list('groups').find((g) => g.name === group).id;
  return store.list('subjects').find((s) => s.name === name && s.groupId === groupId);
};
const adminOf = (store) => {
  const row = store.list('staff').find((s) => s.login === 'admin');
  return { id: row.id, roles: ['admin'], kind: 'staff' };
};

test('the stand carries marks: unit 1 of «Информатика» 01-1 is finished, unit 2 is going', () => {
  const { store, platform } = stand();
  const informatics = subjectOf(store, 'Информатика', '01-1');
  const j = journalView(readJournalRows(store), platform, informatics.id, adminOf(store));
  assert.equal(j.pairs.filter((p) => p.status === 'closed').length, 10);
  const totals = j.students.map((s) => j.results[s.id].units[0].total);
  assert.deepEqual([totals.filter((x) => x === null).length, totals.filter((x) => Number.isInteger(x)).length], [2, 20]);
  assert.equal(j.students.every((s) => j.results[s.id].units[1].total === null && j.results[s.id].units[1].current !== null), true);
  assert.equal(Object.values(j.results).some((r) => r.units[0].controlLow), true);
});

test('no mark on the pairs of today and later; one unfilled past pair of «Анатомия» 02-1', () => {
  const { store } = stand();
  const pairs = new Map(store.list('pairs').map((p) => [p.id, p]));
  assert.equal(store.list('attendance').length > 0, true);
  assert.equal(store.list('attendance').every((x) => pairs.get(x.pairId).date < TODAY), true);
  const open = store.list('pairs').filter((p) => p.date < TODAY && p.status === 'planned');
  assert.equal(open.length, 1);
  assert.equal(open[0].subjectId, subjectOf(store, 'Анатомия', '02-1').id);
  assert.equal(store.list('pairs').length, 159);
});

test('the change log: three corrections with reasons, the late one gives a status row and an activity row', () => {
  const { store } = stand();
  const log = store.list('changeLog');
  assert.deepEqual([...new Set(log.map((x) => x.reason).filter((x) => x !== ''))].sort(),
    ['Отработал тему на консультации', 'Ошибка при заполнении', 'Участие в олимпиаде'].sort());
  assert.equal(log.filter((x) => x.reason === 'Отработал тему на консультации').length, 2);
  assert.equal(log.filter((x) => x.reason === 'Ошибка при заполнении').length, 1);
  assert.equal(log.some((x) => x.late === true), true);
});

test('a second seed changes nothing; the demo data carries the same marks; seedAdmin carries none', () => {
  const { store, platform } = stand();
  const count = () => ['attendance', 'unitResults', 'changeLog'].map((t) => store.list(t).length);
  const before = count();
  seed(store, platform);
  assert.deepEqual(count(), before);

  const demoPlatform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const demoStore = createMemoryStore(SCHEMA, demoPlatform);
  seedAdmin(demoStore, demoPlatform);
  assert.deepEqual(['attendance', 'unitResults', 'changeLog'].map((t) => demoStore.list(t).length), [0, 0, 0]);
  assert.equal(seedDemo(demoStore, demoPlatform, { password: 'пароль-демо-1' }), true);
  assert.deepEqual(['attendance', 'unitResults', 'changeLog'].map((t) => demoStore.list(t).length), before);
});

test('after the deanery approves the syllabus of «Анатомия», the held pairs get their topics by date', () => {
  const { store, platform } = stand();
  const anatomy = store.list('syllabi').find((s) => s.status === 'review');
  const done = approveSyllabus(store, platform, { syllabusId: anatomy.id }, adminOf(store));
  assert.equal(done.approved, true);
  const subject = subjectOf(store, 'Анатомия', '01-1');
  const pairs = store.list('pairs').filter((p) => p.subjectId === subject.id).sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
  const held = pairs.filter((p) => p.status === 'closed');
  // six lessons in the syllabus: the first six held pairs carry them in the order of their dates, the later ones none
  assert.equal(held.length > 6, true);
  assert.deepEqual(held.map((p) => p.topicId !== ''), held.map((_, i) => i < 6));
  const topics = new Map(store.list('topics').map((t) => [t.id, t]));
  const orders = held.slice(0, 6).map((p) => topics.get(p.topicId).order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

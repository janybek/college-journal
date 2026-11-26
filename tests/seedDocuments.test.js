import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { addDays } from '../core/dates.js';
import { seed, prepareLessonNow, DEV_PASSWORD } from '../dev/seed.js';
import { bishkek } from './journalSetup.js';
import { oneMain } from '../core/disciplineSyllabus.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek

function stand() {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform, null, { repeats: false });
  const ctx = { store, platform };
  const tokens = {};
  const call = (action, data, who) => {
    if (!tokens[who]) tokens[who] = handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, ctx).data.token;
    return handleRequest({ action, token: tokens[who], data }, ctx);
  };
  return { store, platform, call };
}

const byName = (rows, name) => rows.find((r) => r.disciplineName === name);

test('seedDocuments: the tabs of the documents show a discipline in every state of its syllabus', () => {
  const { store, call } = stand();
  const board = call('docs.syllabi', {}, 'dean').data;
  const names = (rows) => rows.map((r) => r.disciplineName).sort();
  assert.deepEqual(names(board.approved), ['Информатика', 'Физиология']);
  assert.deepEqual(names(board.review), ['Анатомия', 'Химия']);
  assert.deepEqual(names(board.development), ['Биология', 'Латинский язык']);

  assert.equal(byName(board.approved, 'Информатика').next, 'returned');
  assert.equal(byName(board.approved, 'Информатика').waiting, false);
  assert.equal(byName(board.approved, 'Физиология').waiting, true);

  const anatomy = byName(board.review, 'Анатомия');
  const chemistry = byName(board.review, 'Химия');
  assert.equal(anatomy.reviewDue, addDays(board.today, -2));
  assert.equal(chemistry.reviewDue, addDays(board.today, 5));
  assert.ok(anatomy.reviewDue < board.today && chemistry.reviewDue > board.today);

  const staff = new Map(store.list('staff').map((p) => [p.id, p.login]));
  const biology = byName(board.development, 'Биология');
  const latin = byName(board.development, 'Латинский язык');
  assert.equal(staff.get(biology.responsibleId), 'teacher3');
  assert.equal(biology.dueDate, addDays(board.today, 10));
  assert.deepEqual([latin.responsibleId, latin.dueDate], ['', '']);
  assert.equal(staff.get(store.list('syllabusLines').find((l) => l.disciplineId === chemistry.disciplineId).responsibleId), 'teacher2');

  const physiology = call('docs.discipline', { disciplineId: byName(board.approved, 'Физиология').disciplineId }, 'dean').data;
  assert.equal(physiology.candidates[1].length, 2);
  assert.deepEqual(oneMain(store.list('syllabusLines')), []);
});

test('seedDocuments: the new disciplines have the subjects and the week the stand promises', () => {
  const { store } = stand();
  const groups = new Map(store.list('groups').map((g) => [g.id, g.name]));
  const staff = new Map(store.list('staff').map((p) => [p.id, p.login]));
  const disciplines = new Map(store.list('disciplines').map((d) => [d.id, d.name]));
  const subjects = store.list('subjects').map((s) => `${s.name}|${groups.get(s.groupId)}|${staff.get(s.teacherId)}`);
  for (const mark of ['Химия|01-1|teacher2', 'Биология|02-1|teacher3', 'Латинский язык|03-1|teacher1', 'Физиология|01-1|teacher2', 'Физиология|03-1|teacher3']) {
    assert.ok(subjects.includes(mark), mark);
  }
  assert.equal(store.list('subjects').every((s) => disciplines.get(s.disciplineId) === s.name), true);
  const rooms = new Map(store.list('rooms').map((r) => [r.id, r.name]));
  const week = store.list('weekTemplate').filter((w) => store.list('subjects').find((s) => s.id === w.subjectId).name === 'Физиология');
  assert.deepEqual(week.map((w) => [w.weekday, w.slot, rooms.get(w.roomId)]).sort(), [[5, 1, '305'], [5, 3, '305']]);
  const noWeek = ['Химия', 'Биология', 'Латинский язык'];
  assert.equal(store.list('weekTemplate').some((w) => noWeek.includes(store.list('subjects').find((s) => s.id === w.subjectId).name)), false);
  // two syllabi of one discipline with their own topics: before the choice each group follows the syllabus of its own teacher
  const topics = new Map(store.list('topics').map((t) => [t.id, t.name]));
  const taught = (group) => new Set(store.list('pairs').filter((p) => store.list('subjects').find((s) => s.id === p.subjectId).name === 'Физиология'
    && groups.get(p.groupId) === group).map((p) => topics.get(p.topicId)).filter(Boolean));
  assert.deepEqual([...taught('01-1')].sort(), ['Дыхание и газообмен', 'Пищеварение', 'Сердечный цикл', 'Физиология крови']);
  assert.deepEqual([...taught('03-1')].sort(), ['Кровь и её функции', 'Лёгочная вентиляция', 'Обмен веществ', 'Работа сердца и давление']);
});

test('seedDocuments: the pairs of the earlier subjects of the stand are as they were', () => {
  const { store } = stand();
  const topics = new Map(store.list('topics').map((t) => [t.id, t.name]));
  const groups = new Map(store.list('groups').map((g) => [g.id, g.name]));
  const staff = new Map(store.list('staff').map((p) => [p.id, p.login]));
  const mine = store.list('subjects').filter((s) => ['Информатика', 'Анатомия'].includes(s.name))
    .sort((a, b) => (a.name + groups.get(a.groupId)).localeCompare(b.name + groups.get(b.groupId)));
  const lines = [];
  for (const s of mine) {
    for (const p of store.list('pairs').filter((x) => x.subjectId === s.id).sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot))) {
      lines.push([s.name, groups.get(s.groupId), p.date, p.slot, p.status, p.lessonType, p.part, topics.get(p.topicId) ?? '', staff.get(p.teacherId), p.changed, p.note].join('|'));
    }
  }
  // the digest of the stand before «seedDocuments» (the same clock)
  assert.deepEqual([lines.length, createHash('sha1').update(lines.join('\n')).digest('hex')], [159, '88e3b4d6744079bf55ba7d68083d1066fafefa96']);
});

test('seedDocuments: the second seed writes nothing, a lesson of «Информатика» in 01-1 can still be made ready', () => {
  const { store, platform } = stand();
  const before = Object.fromEntries(Object.keys(SCHEMA).map((name) => [name, JSON.stringify(store.list(name))]));
  seed(store, platform, null, { repeats: false });
  assert.deepEqual(Object.fromEntries(Object.keys(SCHEMA).map((name) => [name, JSON.stringify(store.list(name))])), before);
  const id = prepareLessonNow(store, platform);
  const pair = store.get('pairs', id);
  const subject = store.get('subjects', pair.subjectId);
  assert.deepEqual([subject.name, store.get('groups', subject.groupId).name, store.get('staff', subject.teacherId).login], ['Информатика', '01-1', 'teacher1']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { oneJoined } from '../core/syllabusLines.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { bishkek } from './journalSetup.js';

function stand() {
  const platform = createNodePlatform({ now: () => bishkek('2026-11-18', '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  const tokens = {};
  const call = (action, data, who) => {
    if (!tokens[who]) tokens[who] = handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, { store, platform }).data.token;
    return handleRequest({ action, token: tokens[who], data }, { store, platform });
  };
  const id = (login) => store.list('staff').find((p) => p.login === login).id;
  const informatics = store.list('disciplines').find((d) => d.name === 'Информатика').id;
  const line = (semester) => store.list('syllabusLines').find((l) => l.disciplineId === informatics && l.semester === semester && store.list('syllabusMembers').some((m) => m.lineId === l.id && m.state !== 'left'));
  const members = (l, state) => store.list('syllabusMembers').filter((m) => m.lineId === l.id && m.state === state);
  return { store, call, id, line, members };
}

test('the stand has a shared spring line and an autumn line with a pending invitation', () => {
  const s = stand();
  const spring = s.line(2);
  const autumn = s.line(1);
  assert.deepEqual(s.members(spring, 'joined').map((m) => m.teacherId).sort(), [s.id('teacher1'), s.id('teacher3')].sort());
  assert.equal(spring.authorId, s.id('teacher1'));
  assert.equal(s.members(autumn, 'joined').length, 1);
  assert.deepEqual(s.members(autumn, 'invited').map((m) => m.teacherId), [s.id('teacher3')]);
  assert.deepEqual(oneJoined(s.store.list('syllabusMembers')), []);
  const r = s.call('syllabus.invitations', {}, 'teacher3');
  assert.equal(r.ok, true);
  assert.equal(r.data.invitations.length, 1);
  const [inv] = r.data.invitations;
  assert.equal(inv.semester, 1);
  assert.equal(inv.authorName, s.store.list('staff').find((p) => p.login === 'teacher1').fullName);
  assert.equal(inv.hasApproved, true);
  assert.equal(inv.losesTopics, false);
});

test('the invitation can be accepted, then the first teacher is locked in by closed units', () => {
  const s = stand();
  const autumn = s.line(1);
  const remove = () => s.call('syllabus.remove', { lineId: autumn.id, teacherId: s.id('teacher1') }, 'dean');
  assert.equal(remove().error.code, 'last_member');
  const group = s.store.list('groups').find((g) => g.name === '03-1').id;
  const infoSubject = s.store.list('subjects').find((x) => x.groupId === group && x.teacherId === s.id('teacher3'));
  const before = s.store.list('pairs').filter((p) => p.subjectId === infoSubject.id && p.topicId).length;
  const joined = s.call('syllabus.join', { lineId: autumn.id }, 'teacher3');
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.ok(s.store.list('pairs').filter((p) => p.subjectId === infoSubject.id && p.topicId).length > before);
  assert.deepEqual(oneJoined(s.store.list('syllabusMembers')), []);
  const { error } = remove();
  assert.equal(error.code, 'line_locked');
  assert.ok(JSON.stringify(error).includes('02-1'));
});

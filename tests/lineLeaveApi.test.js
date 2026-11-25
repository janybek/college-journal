import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FILE_A, FILE_B } from './linesSetup.js';
import { file, INFO } from './syllabusSetup.js';
import { handleRequest } from '../backend/api.js';
import { LEAVE_TABLES } from '../backend/lineSwitch.js';
import { DOC_TABLES } from '../core/syllabusDoc.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);
const callOn = (s, store, action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store, platform: s.platform, log: () => {} });
const pairsOf = (s, subjectId) => JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === subjectId));
const versionOf = (s, id) => s.store.list('syllabi').find((v) => v.id === id);
const approvedOf = (s, lineId) => s.store.list('syllabi').find((v) => v.lineId === lineId && v.status === 'approved');

// t1 leads L (approved А1…А5; t1 is the author), t2 (earlier an own syllabus Б of versions 1 and 2) joined at 09-03, t3 at 09-04.
// sb2 held 02.09 («Б1», before the move) and 09.09 («А2», after it).
function base() {
  const s = setup();
  s.publish(s.sb1, FILE_A);
  s.publish(s.sb2, FILE_B);
  s.publish(s.sb2, FILE_B);
  s.at('2026-09-03');
  s.hold(s.sb2, '2026-09-02');
  const L = s.lineOf('t1');
  for (const key of ['t2', 't3']) assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids[key] }, s.t.t1).ok, true);
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.t2).ok, true);
  s.at('2026-09-04');
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.t3).ok, true);
  s.at('2026-09-10');
  s.hold(s.sb2, '2026-09-09');
  return { s, L, A: approvedOf(s, L.id) };
}

test('leave: the teacher gets an approved copy, his pairs move to it, the others stay', () => {
  const { s, L, A } = base();
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);
  const before = s.topicsOf(s.sb2);
  const others = JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId !== s.sb2));
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  const copy = s.store.list('syllabi').find((v) => v.id === r.data.syllabusId);
  const oldKey = s.store.list('syllabi').filter((v) => v.disciplineId === s.ds1 && v.teacherId === s.ids.t2 && v.semester === 1);
  assert.deepEqual([r.ok, r.data.copied, copy.status, copy.sourceId, copy.teacherId, copy.decidedBy, copy.version], [true, true, 'approved', A.id, s.ids.t2, s.ids.t2, 3]);
  assert.deepEqual(oldKey.filter((v) => v.status === 'approved').map((v) => v.id), [copy.id]);
  assert.deepEqual(s.topicsOf(s.sb2), before);
  const copyRows = new Set(s.store.list('topics').filter((t) => t.syllabusId === copy.id).map((t) => t.id));
  assert.ok(s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.date >= '2026-09-09' && p.topicId).every((p) => copyRows.has(p.topicId)));
  const held = s.store.list('pairs').find((p) => p.subjectId === s.sb2 && p.date === '2026-09-02');
  assert.equal(copyRows.has(held.topicId), false);
  assert.equal(JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId !== s.sb2)), others);
  assert.deepEqual([s.oneJoined(), s.lineOf('t2').id, s.lineOf('t2').authorId], [[], r.data.lineId, s.ids.t2]);
  for (const name of DOC_TABLES) assert.equal(s.store.list(name).filter((x) => x.syllabusId === copy.id).length, s.store.list(name).filter((x) => x.syllabusId === A.id).length, name);
  const left = s.store.list('syllabusMembers').find((m) => m.lineId === L.id && m.teacherId === s.ids.t2);
  assert.deepEqual([left.state, left.endedBy, left.endedAt !== ''], ['left', s.ids.t2, true]);
  assert.deepEqual(s.store.list('syllabusMembers').filter((m) => m.lineId === L.id && m.state === 'joined').map((m) => m.teacherId).sort(), [s.ids.t1, s.ids.t3].sort());
  assert.equal(JSON.stringify(r.data).includes('passwordHash'), false);
  assert.equal(r.data.changedPairs >= 0, true);
});

test('leave: the page of the subject says the approved version is a copy; an own new version is not', () => {
  const { s, L } = base();
  assert.equal(s.call('syllabus.get', { subjectId: s.sb1 }, s.t.t1).data.state.approved.copy, undefined);
  assert.equal(s.call('syllabus.leave', { lineId: L.id }, s.t.t2).ok, true);
  assert.equal(s.call('syllabus.get', { subjectId: s.sb2 }, s.t.t2).data.state.approved.copy, true);
  assert.equal(s.call('syllabus.get', { subjectId: s.sb3 }, s.t.t3).data.state.approved.copy, undefined);
  const sb3Before = pairsOf(s, s.sb3);
  const d = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  assert.equal(d.ok, true, JSON.stringify(d));
  const draft = versionOf(s, d.data.syllabusId);
  assert.deepEqual([draft.lineId, draft.version], [s.lineOf('t2').id, 4]);
  const ok = s.call('syllabus.approve', { syllabusId: draft.id }, s.t.dean);
  assert.equal(ok.data.approved, true, JSON.stringify(ok));
  assert.equal(pairsOf(s, s.sb3), sb3Before);
  assert.equal(s.call('syllabus.get', { subjectId: s.sb2 }, s.t.t2).data.state.approved.copy, undefined);
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: the author leaves, the one who joined earliest takes the line, the approved version stays', () => {
  const { s, L, A } = base();
  const before = s.topicsOf(s.sb2);
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, s.ids.t2);
  assert.equal(versionOf(s, A.id).status, 'approved');
  assert.equal(versionOf(s, A.id).teacherId, s.ids.t1);
  assert.deepEqual(s.topicsOf(s.sb2), before);
  const aTopics = new Set(s.store.list('topics').filter((t) => t.syllabusId === A.id).map((t) => t.id));
  assert.ok(s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.topicId && p.date >= '2026-09-09').every((p) => aTopics.has(p.topicId)));
  const own = s.store.list('syllabi').filter((v) => v.disciplineId === s.ds1 && v.teacherId === s.ids.t1 && v.status === 'approved');
  const copy = versionOf(s, r.data.syllabusId);
  assert.deepEqual([own.length, copy.version > A.version, copy.sourceId], [2, true, A.id]);
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: the author leaves while his version waits for the deanery: it stays in the queue under the new author', () => {
  const { s, L } = base();
  const d = s.call('syllabus.startDraft', { lineId: L.id }, s.t.t1);
  assert.equal(d.ok, true, JSON.stringify(d));
  const sub = s.call('syllabus.submit', { syllabusId: d.data.syllabusId }, s.t.t1);
  assert.equal(sub.data.submitted, true, JSON.stringify(sub));
  assert.equal(s.call('syllabus.leave', { lineId: L.id }, s.t.t1).ok, true);
  assert.equal(versionOf(s, d.data.syllabusId).status, 'review');
  const row = s.call('syllabus.queue', {}, s.t.dean).data.rows.find((x) => x.syllabusId === d.data.syllabusId);
  assert.equal(row.authorName, s.names.t2);
  assert.equal(s.call('syllabus.approve', { syllabusId: d.data.syllabusId }, s.t.dean).data.approved, true);
});

test('leave: three members with the same time of joining - the successor is the one with the smallest row id', () => {
  const s = setup();
  s.publish(s.sb1, FILE_A);
  const L = s.lineOf('t1');
  const rows = [s.share(L.id, 't2', 'joined', { joinedAt: '2026-09-02 10:00:00' }), s.share(L.id, 't3', 'joined', { joinedAt: '2026-09-02 10:00:00' })];
  s.at('2026-09-03');
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, rows.sort((x, y) => (x.id < y.id ? -1 : 1))[0].teacherId);
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: the only member cannot leave; a closed unit of his group locks, of another member does not', () => {
  const s = setup();
  s.publish(s.sb1, FILE_A);
  s.at('2026-09-03');
  const L = s.lineOf('t1');
  const snap = s.snapshot();
  assert.equal(code(s.call('syllabus.leave', { lineId: L.id }, s.t.t1)), 'last_member');
  assert.deepEqual(s.snapshot(), snap);

  const { s: b, L: BL } = base();
  b.closeUnit(b.sb2, 1);
  const before = b.snapshot();
  const locked = b.call('syllabus.leave', { lineId: BL.id }, b.t.t2);
  assert.equal(code(locked), 'line_locked');
  assert.deepEqual(locked.error.fields, [{ field: 'group', code: 'unit_closed', name: '02-1' }]);
  assert.deepEqual(b.snapshot(), before);
  assert.equal(b.call('syllabus.leave', { lineId: BL.id }, b.t.t3).ok, true);
  const { s: c, L: CL } = base();
  c.closeUnit(c.sb3, 1);
  assert.equal(c.call('syllabus.leave', { lineId: CL.id }, c.t.t2).ok, true);
});

test('leave: a line without an approved version gives a new line with an empty draft', () => {
  const s = setup();
  const R = s.call('syllabus.newLine', { disciplineId: s.ds1, semester: 1 }, s.t.dean).data;
  for (const key of ['t1', 't2']) assert.equal(s.call('syllabus.add', { lineId: R.lineId, teacherId: s.ids[key] }, s.t.dean).ok, true);
  const r = s.call('syllabus.leave', { lineId: R.lineId }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  const draft = versionOf(s, r.data.syllabusId);
  assert.deepEqual([r.data.copied, draft.status, draft.lineId, draft.sourceId, s.lineOf('t2').id, s.lineOf('t2').authorId], [false, 'draft', r.data.lineId, '', r.data.lineId, s.ids.t2]);
  assert.equal(s.store.list('topics').filter((t) => t.syllabusId === draft.id).length, 0);
  assert.deepEqual(s.oneJoined(), []);
  assert.equal(code(s.call('syllabus.leave', { lineId: R.lineId }, s.t.t2)), 'forbidden');
});

test('leave: a ready syllabus of the deanery without people stays approved', () => {
  const s = setup();
  s.publish(s.sb1, FILE_A);
  const L = s.lineOf('t1');
  const sbD = s.store.insert('subjects', { name: 'Анатомия', disciplineId: s.ds1, groupId: s.groups[2], teacherId: s.ids.dean, scheme: 'A' }).id;
  s.publish(sbD, FILE_B);
  const own = s.lineOf('dean');
  s.store.removeMany('syllabusMembers', s.store.list('syllabusMembers').filter((m) => m.lineId === own.id).map((m) => m.id));
  s.store.update('syllabusLines', own.id, { authorId: '' });
  const ready = approvedOf(s, own.id);
  assert.equal(ready.teacherId, s.ids.dean);
  assert.equal(s.call('syllabus.add', { lineId: L.id, teacherId: s.ids.dean }, s.t.dean).ok, true);
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.dean);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(versionOf(s, ready.id).status, 'approved');
  assert.equal(versionOf(s, r.data.syllabusId).status, 'approved');
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: a half of the year that is not the current one changes no pair', () => {
  const s = setup();
  const second = (p) => file([[1, '', p + '1', 2, '', '', 'о'], [1, '', '', '', '', 'модуль', '']], [['Семестр', 2], ...INFO.slice(1)]);
  s.publish(s.sb1, second('В'));
  s.publish(s.sb2, second('Г'));
  s.at('2026-09-03');
  const L = s.lineOf('t1', 2);
  assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1).ok, true);
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.t2).ok, true);
  const pairs = JSON.stringify(s.store.list('pairs'));
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.stringify(s.store.list('pairs')), pairs);
  assert.equal(s.lineOf('t2', 2).id, r.data.lineId);
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: someone who is not on the line, an invited teacher and bad ids are refused, nothing is written', () => {
  const { s, L } = base();
  const snap = s.snapshot();
  assert.equal(code(s.call('syllabus.leave', { lineId: L.id }, s.t.t4)), 'forbidden');
  assert.equal(code(s.call('syllabus.leave', { lineId: L.id }, s.t.s1)), 'forbidden');
  assert.equal(code(s.call('syllabus.leave', { lineId: 'line_00000000' }, s.t.t2)), 'not_found');
  for (const lineId of [[L.id], ' ', '', {}, 5, null, undefined]) assert.equal(code(s.call('syllabus.leave', { lineId }, s.t.t2)), 'bad_request');
  assert.equal(code(s.call('syllabus.leave', null, s.t.t2)), 'bad_request');
  assert.deepEqual(s.snapshot(), snap);
});

test('remove: the author takes a colleague off the line, the copy goes to him', () => {
  const { s, L, A } = base();
  const before = s.topicsOf(s.sb2);
  const r = s.call('syllabus.remove', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const copy = versionOf(s, r.data.left.syllabusId);
  assert.deepEqual([r.data.left.copied, copy.status, copy.sourceId, copy.teacherId, copy.decidedBy, copy.version], [true, 'approved', A.id, s.ids.t2, s.ids.t1, 3]);
  const row = s.store.list('syllabusMembers').find((m) => m.lineId === L.id && m.teacherId === s.ids.t2);
  assert.deepEqual([row.state, row.endedBy], ['left', s.ids.t1]);
  assert.deepEqual(r.data.line.members.map((m) => m.teacherId).sort(), [s.ids.t1, s.ids.t3].sort());
  assert.deepEqual([s.lineOf('t2').id, r.data.left.lineId, s.lineOf('t2').authorId], [r.data.left.lineId, r.data.left.lineId, s.ids.t2]);
  assert.deepEqual(s.topicsOf(s.sb2), before);
  assert.deepEqual(s.oneJoined(), []);
  assert.equal(JSON.stringify(r.data).includes('passwordHash'), false);
});

test('remove: the deanery takes the author off, the line gets a new author', () => {
  const { s, L } = base();
  const r = s.call('syllabus.remove', { lineId: L.id, teacherId: s.ids.t1 }, s.t.dean);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.line.authorId, s.ids.t2);
  assert.equal(versionOf(s, r.data.left.syllabusId).decidedBy, s.ids.dean);
  assert.deepEqual(s.oneJoined(), []);
});

test('remove: refusals write nothing', () => {
  const { s, L } = base();
  s.store.insert('subjects', { name: 'Анатомия', disciplineId: s.ds1, groupId: s.groups[0], teacherId: s.ids.t5, scheme: 'A' });
  assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t5 }, s.t.t1).ok, true);
  const snap = s.snapshot();
  const rm = (teacher, token, lineId = L.id) => code(s.call('syllabus.remove', { lineId, teacherId: s.ids[teacher] }, s.t[token]));
  assert.equal(rm('t1', 't3'), 'forbidden');
  assert.equal(rm('t2', 't3'), 'forbidden');
  assert.equal(rm('t2', 't4'), 'forbidden');
  assert.equal(rm('t2', 's1'), 'forbidden');
  assert.equal(rm('t2', 'prorector'), 'forbidden');
  assert.equal(rm('t1', 't1'), 'bad_request');
  assert.equal(rm('t5', 't1'), 'not_found');
  assert.equal(rm('t4', 't1'), 'not_found');
  assert.equal(rm('t2', 't1', 'line_00000000'), 'not_found');
  for (const bad of [[s.ids.t2], ' ', '', {}, null, undefined, 7]) assert.equal(code(s.call('syllabus.remove', { lineId: L.id, teacherId: bad }, s.t.t1)), 'bad_request');
  for (const bad of [[L.id], ' ', {}, undefined]) assert.equal(code(s.call('syllabus.remove', { lineId: bad, teacherId: s.ids.t2 }, s.t.t1)), 'bad_request');
  assert.deepEqual(s.snapshot(), snap);
  b2(s, L);
});

function b2(s, L) {
  // the last one cannot be taken off; a closed unit locks
  const solo = setup();
  solo.publish(solo.sb1, FILE_A);
  const SL = solo.lineOf('t1');
  assert.equal(code(solo.call('syllabus.remove', { lineId: SL.id, teacherId: solo.ids.t1 }, solo.t.dean)), 'last_member');
  s.closeUnit(s.sb3, 1);
  const snap = s.snapshot();
  const locked = s.call('syllabus.remove', { lineId: L.id, teacherId: s.ids.t3 }, s.t.t1);
  assert.equal(code(locked), 'line_locked');
  assert.deepEqual(locked.error.fields, [{ field: 'group', code: 'unit_closed', name: '03-1' }]);
  assert.deepEqual(s.snapshot(), snap);
}

function leaveWith(breaking, who = 't2') {
  const { s, L } = base();
  const lines = s.store.list('syllabusLines').length;
  const versions = s.store.list('syllabi').length;
  const failed = callOn(s, breaking(s), 'syllabus.leave', { lineId: L.id }, s.t[who]);
  assert.equal(failed.ok, false);
  return { s, L, lines, versions };
}

test('leave: a break on the write of the versions - the repeat finishes with one new line and one new version', () => {
  const { s, L, lines, versions } = leaveWith((x) => x.failingOn('updateMany', 'syllabi'));
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1]);
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1]);
  const copy = versionOf(s, r.data.syllabusId);
  assert.deepEqual([copy.status, copy.version, s.lineOf('t2').id, s.oneJoined()], ['approved', 3, r.data.lineId, []]);
  assert.deepEqual(s.store.list('syllabi').filter((v) => v.teacherId === s.ids.t2 && v.status === 'approved').map((v) => v.id), [copy.id]);
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);
});

test('leave: a break on the second write of the members - the repeat does not make a second copy and writes "joined"', () => {
  const { s, L, lines, versions } = leaveWith((x) => x.failingOn('insertMany', 'syllabusMembers'));
  assert.equal(s.store.list('syllabusMembers').find((m) => m.lineId === L.id && m.teacherId === s.ids.t2).state, 'left');
  assert.equal(s.lineOf('t2'), null);
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1]);
  assert.deepEqual([s.lineOf('t2').id, r.data.lineId, versionOf(s, r.data.syllabusId).status, s.oneJoined()], [r.data.lineId, r.data.lineId, 'approved', []]);
  assert.equal(code(s.call('syllabus.leave', { lineId: L.id }, s.t.t2)), 'forbidden');
});

test('leave: a break on the line of the author - the repeat names the successor', () => {
  const { s, L, lines, versions } = leaveWith((x) => x.failingOn('updateMany', 'syllabusLines'), 't1');
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1]);
  assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, s.ids.t2);
  assert.deepEqual(s.oneJoined(), []);
});

test('leave: a break on the pairs - the repeat finishes', () => {
  const { s, L, lines, versions } = leaveWith((x) => x.failingOn('updateMany', 'pairs'));
  const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1]);
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);
  const copyRows = new Set(s.store.list('topics').filter((t) => t.syllabusId === r.data.syllabusId).map((t) => t.id));
  assert.ok(s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.date >= '2026-09-09' && p.topicId).every((p) => copyRows.has(p.topicId)));
});

test('remove: a break on the second write of the members - the repeat of the author finishes it', () => {
  const { s, L } = base();
  const failed = callOn(s, s.failingOn('insertMany', 'syllabusMembers'), 'syllabus.remove', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1);
  assert.equal(failed.ok, false);
  const lines = s.store.list('syllabusLines').length;
  const r = s.call('syllabus.remove', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.store.list('syllabusLines').length, lines);
  assert.deepEqual([s.lineOf('t2').id, s.oneJoined()], [r.data.left.lineId, []]);
});

test('leave and remove read each sheet once', () => {
  const { s, L } = base();
  s.spy.reset();
  assert.equal(s.call('syllabus.leave', { lineId: L.id }, s.t.t2).ok, true);
  for (const table of LEAVE_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, `${table}: ${s.spy.lists[table]}`);
  s.spy.reset();
  assert.equal(s.call('syllabus.remove', { lineId: L.id, teacherId: s.ids.t3 }, s.t.t1).ok, true);
  for (const table of LEAVE_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, `${table}: ${s.spy.lists[table]}`);
});

test('leave: a break while the copy is being written (any sheet) - the repeat completes the copy before the pairs move', () => {
  const clean = base();
  assert.equal(clean.s.call('syllabus.leave', { lineId: clean.L.id }, clean.s.t.t2).ok, true);
  const expected = clean.s.topicsOf(clean.s.sb2);
  for (const name of DOC_TABLES.filter((n) => clean.s.store.list(n).some((x) => x.syllabusId === clean.A.id))) {
    const { s, L, A, lines, versions } = (() => { const b = leaveWith((x) => x.failingOn('insertMany', name)); return { ...b, A: approvedOf(b.s, b.L.id) }; })();
    const r = s.call('syllabus.leave', { lineId: L.id }, s.t.t2);
    assert.equal(r.ok, true, name + JSON.stringify(r));
    assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabi').length], [lines + 1, versions + 1], name);
    for (const t of DOC_TABLES) {
      assert.equal(s.store.list(t).filter((x) => x.syllabusId === r.data.syllabusId).length, s.store.list(t).filter((x) => x.syllabusId === A.id).length, name + '/' + t);
    }
    assert.deepEqual(s.topicsOf(s.sb2), expected, name);
    assert.equal(versionOf(s, r.data.syllabusId).status, 'approved', name);
    assert.deepEqual(s.oneJoined(), [], name);
  }
});

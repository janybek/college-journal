import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './linesSetup.js';
import { MEMBER_TABLES } from '../backend/syllabusLines.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);

// t1 leads the line L of «Анатомия» (first half) with an approved version.
function base() {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const L = s.lineOf('t1');
  const invite = (teacherId, token = s.t.t1, lineId = L.id) => s.call('syllabus.invite', { lineId, teacherId }, token);
  return { s, L, invite };
}
const memberRows = (s, lineId, teacherKey) => s.store.list('syllabusMembers').filter((m) => m.lineId === lineId && m.teacherId === s.ids[teacherKey]);

test('invite: the author calls a colleague, the themes stay as they were', () => {
  const { s, L, invite } = base();
  const pairs = JSON.stringify(s.store.list('pairs'));
  const syllabi = JSON.stringify(s.store.list('syllabi'));
  const r = invite(s.ids.t2);
  assert.deepEqual([r.ok, r.data.line.invited.map((x) => x.teacherId), r.data.line.members.length, r.data.line.shared], [true, [s.ids.t2], 1, false]);
  assert.equal(JSON.stringify(s.store.list('pairs')), pairs);
  assert.equal(JSON.stringify(s.store.list('syllabi')), syllabi);
  const row = memberRows(s, L.id, 't2')[0];
  assert.deepEqual([row.state, row.byId, row.semester, row.disciplineId, row.invitedAt !== ''], ['invited', s.ids.t1, 1, s.ds1, true]);
  assert.deepEqual([s.ids.t2, s.ids.t1, s.ids.t4, s.ids.t5, s.ids.prorector].map((id) => code(invite(id))), ['already_member', 'already_member', 'not_teaching', 'not_teaching', 'not_teaching']);
  const was = s.snapshot();
  assert.deepEqual([s.t.t2, s.t.t3, s.t.dean, s.t.admin].map((token) => code(invite(s.ids.t3, token))), ['forbidden', 'forbidden', 'forbidden', 'forbidden']);
  for (const bad of [[s.ids.t3], 5, { id: 1 }, '  ', '__proto__', null]) assert.ok(['bad_request', 'not_teaching'].includes(code(invite(bad))), JSON.stringify(bad));
  assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t3 }).ok, false);
  assert.deepEqual(s.snapshot(), was);
  assert.deepEqual(s.call('syllabus.invitations', {}, s.t.t2).data.invitations.map((x) => [x.lineId, x.disciplineName, x.semester, x.authorName, x.hasApproved, x.losesTopics]),
    [[L.id, 'Анатомия', 1, s.names.t1, true, false]]);
  assert.deepEqual(s.oneJoined(), []);
});

test('invite: bad lines and students', () => {
  const { s, L } = base();
  const was = s.snapshot();
  for (const lineId of ['nope', 5, '', null, ' x', [L.id]]) assert.ok(['bad_request', 'not_found'].includes(code(s.call('syllabus.invite', { lineId, teacherId: s.ids.t2 }, s.t.t1))), JSON.stringify(lineId));
  assert.equal(code(s.call('syllabus.invite', { lineId: 'nope', teacherId: s.ids.t2 }, s.t.t1)), 'not_found');
  assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }, s.t.s1).ok, false);
  assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }, s.t.prorector).ok, false);
  assert.deepEqual(s.snapshot(), was);
  // a teacher who is switched off is not called
  s.store.update('staff', s.ids.t2, { active: false });
  assert.equal(code(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1)), 'not_teaching');
});

test('withdraw and decline', () => {
  const { s, L, invite } = base();
  const withdraw = (teacherId, token = s.t.t1) => s.call('syllabus.withdraw', { lineId: L.id, teacherId }, token);
  const decline = (token, lineId = L.id) => s.call('syllabus.decline', { lineId }, token);
  invite(s.ids.t2);
  assert.equal(code(withdraw(s.ids.t3)), 'not_found');
  const was = s.snapshot();
  assert.deepEqual([s.t.t2, s.t.t3, s.t.t4].map((token) => code(withdraw(s.ids.t2, token))), ['forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual([s.t.t3, s.t.t4, s.t.t1].map((token) => code(decline(token))), ['forbidden', 'forbidden', 'forbidden']);
  assert.equal(code(decline(s.t.t2, 'nope')), 'not_found');
  assert.deepEqual(s.snapshot(), was);

  const r = withdraw(s.ids.t2);
  assert.deepEqual([r.ok, r.data.line.invited.length], [true, 0]);
  const row = memberRows(s, L.id, 't2')[0];
  assert.deepEqual([row.state, row.endedBy, row.endedAt !== ''], ['withdrawn', s.ids.t1, true]);
  assert.deepEqual(s.call('syllabus.invitations', {}, s.t.t2).data.invitations, []);
  assert.equal(code(withdraw(s.ids.t2)), 'not_found');
  // called again: a new row, the old one stays
  assert.equal(invite(s.ids.t2).ok, true);
  assert.deepEqual(memberRows(s, L.id, 't2').map((m) => m.state).sort(), ['invited', 'withdrawn']);
  // the deanery withdraws too
  assert.equal(code(withdraw(s.ids.t2, s.t.dean)), 'ok');
  assert.equal(memberRows(s, L.id, 't2').find((m) => m.state === 'withdrawn' && m.endedBy === s.ids.dean) !== undefined, true);

  // declines
  invite(s.ids.t3);
  assert.deepEqual(decline(s.t.t3).data, { declined: true });
  const declined = memberRows(s, L.id, 't3')[0];
  assert.deepEqual([declined.state, declined.endedBy], ['declined', s.ids.t3]);
  assert.equal(code(decline(s.t.t3)), 'forbidden');
  assert.deepEqual(s.oneJoined(), []);
});

test('an invited teacher without a subject of the discipline is not shown the invitation', () => {
  const { s, L, invite } = base();
  invite(s.ids.t2);
  s.store.update('subjects', s.sb2, { teacherId: s.ids.t5 });
  assert.deepEqual(s.call('syllabus.invitations', {}, s.t.t2).data.invitations, []);
});

test('setAuthor: the deanery picks a member', () => {
  const { s, L } = base();
  s.share(L.id, 't2');
  s.share(L.id, 't3', 'invited');
  const draft = s.call('syllabus.startDraft', { lineId: L.id }, s.t.t1).data.syllabusId;
  const set = (teacherId, token = s.t.dean) => s.call('syllabus.setAuthor', { lineId: L.id, teacherId }, token);
  const was = s.snapshot();
  assert.deepEqual([s.t.t1, s.t.t2, s.t.t4].map((token) => code(set(s.ids.t2, token))), ['forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual([set(s.ids.t3), set(s.ids.t4), set('nope')].map(code), ['not_found', 'not_found', 'not_found']);
  assert.equal(code(set(s.ids.t2, s.t.prorector)), 'forbidden');
  assert.deepEqual(s.snapshot(), was);
  const versionTeacher = s.store.list('syllabi').map((v) => v.teacherId);
  const r = set(s.ids.t2);
  assert.deepEqual([r.ok, r.data.line.authorId], [true, s.ids.t2]);
  assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, s.ids.t2);
  assert.deepEqual(s.store.list('syllabi').map((v) => v.teacherId), versionTeacher);
  assert.equal(code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, s.t.t1)), 'forbidden');
  assert.equal(code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, s.t.t2)), 'ok');
  assert.deepEqual(s.oneJoined(), []);
});

test('newLine: a ready syllabus from the deanery', () => {
  const { s } = base();
  const make = (data, token = s.t.dean) => s.call('syllabus.newLine', data, token);
  const before = s.store.list('syllabusLines').length;
  const pairs = JSON.stringify(s.store.list('pairs'));
  const r = make({ disciplineId: s.ds2, semester: 2 });
  assert.equal(r.ok, true);
  const line = s.store.list('syllabusLines').find((l) => l.id === r.data.lineId);
  assert.deepEqual([line.disciplineId, line.semester, line.authorId, line.createdBy], [s.ds2, 2, '', s.ids.dean]);
  const v = s.store.list('syllabi').find((x) => x.id === r.data.syllabusId);
  assert.deepEqual([v.lineId, v.version, v.status, v.teacherId, v.semester, v.planSemester ?? null], [line.id, 1, 'draft', s.ids.dean, 2, null]);
  assert.deepEqual(s.store.list('syllabusMembers').filter((m) => m.lineId === line.id), []);
  assert.equal(s.store.list('syllabusLines').length, before + 1);
  assert.equal(JSON.stringify(s.store.list('pairs')), pairs);
  // the same discipline and half again: allowed
  assert.equal(make({ disciplineId: s.ds2, semester: 2 }).ok, true);
  assert.equal(make({ disciplineId: s.ds2, semester: 2 }, s.t.admin).ok, true);
  assert.equal(s.store.list('syllabusLines').length, before + 3);

  const was = s.snapshot();
  assert.deepEqual([s.t.t1, s.t.prorector, s.t.s1].map((token) => code(make({ disciplineId: s.ds2, semester: 2 }, token))), ['forbidden', 'forbidden', 'forbidden']);
  assert.equal(code(make({ disciplineId: s.ds2, semester: 3 })), 'bad_request');
  assert.equal(code(make({ disciplineId: s.ds2, semester: '1' })), 'bad_request');
  assert.equal(code(make({ disciplineId: [s.ds2], semester: 1 })), 'bad_request');
  assert.equal(code(make({ disciplineId: 'nope', semester: 1 })), 'not_found');
  assert.equal(code(make({ disciplineId: s.ds2, semester: 2 }, 'bad-token')), 'unauthorized');
  assert.deepEqual(s.snapshot(), was);
});

test('every action refuses a call without a token and writes nothing', () => {
  const { s, L } = base();
  const was = s.snapshot();
  for (const [action, data] of [['syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }], ['syllabus.withdraw', { lineId: L.id, teacherId: s.ids.t2 }],
    ['syllabus.decline', { lineId: L.id }], ['syllabus.setAuthor', { lineId: L.id, teacherId: s.ids.t1 }], ['syllabus.newLine', { disciplineId: s.ds1, semester: 1 }],
    ['syllabus.invitations', {}]]) {
    assert.equal(s.call(action, data).ok, false, action);
    assert.equal(s.call(action, data, s.t.s1).ok, false, action);
  }
  assert.deepEqual(s.snapshot(), was);
});

test('the card of a discipline lists its lines', () => {
  const { s, L } = base();
  const card = (token = s.t.dean) => s.call('dir.card', { table: 'disciplines', id: s.ds1 }, token).data;
  let lines = card().lines;
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].lineId, lines[0].semester, lines[0].authorName, lines[0].shared, lines[0].members, lines[0].teachers, lines[0].approved, lines[0].open, lines[0].subjectId],
    [L.id, 1, s.names.t1, false, 1, [s.names.t1], true, null, s.sb1]);
  assert.equal(lines[0].syllabusId, s.store.list('syllabi').find((v) => v.status === 'approved').id);
  assert.deepEqual(card().can, { newLine: true });
  s.share(L.id, 't2');
  lines = card().lines;
  assert.deepEqual([lines[0].shared, lines[0].members, lines[0].teachers], [true, 2, [s.names.t1, s.names.t2]]);
  assert.deepEqual(card().rows.find((r) => r.subjectId === s.sb2).syllabus, { approved: true, open: null, shared: true, members: 2 });

  // a line of the deanery without people is seen
  const made = s.call('syllabus.newLine', { disciplineId: s.ds1, semester: 2 }, s.t.dean).data;
  lines = card().lines;
  assert.equal(lines.length, 2);
  const fresh = lines.find((l) => l.lineId === made.lineId);
  assert.deepEqual([fresh.authorName, fresh.members, fresh.shared, fresh.open, fresh.approved, fresh.subjectId, fresh.syllabusId], ['', 0, false, 'draft', false, '', made.syllabusId]);
  assert.deepEqual(lines.map((l) => l.semester), [1, 2]);

  // the prorector does not see the draft
  const seen = card(s.t.prorector);
  const f2 = seen.lines.find((l) => l.lineId === made.lineId);
  assert.deepEqual([f2.open, f2.syllabusId, seen.can], [null, '', { newLine: false }]);

  // a line where everybody left is not shown
  for (const m of s.store.list('syllabusMembers').filter((x) => x.lineId === L.id)) s.store.update('syllabusMembers', m.id, { state: 'left', endedAt: '2026-09-02 10:00:00', endedBy: s.ids.t1 });
  assert.equal(card().lines.some((l) => l.lineId === L.id), false);
});

test('a history line takes no invitations', () => {
  const { s, L, invite } = base();
  invite(s.ids.t2);
  const mine = s.store.list('syllabusMembers').find((m) => m.lineId === L.id && m.teacherId === s.ids.t1);
  s.store.update('syllabusMembers', mine.id, { state: 'left', endedAt: '2026-09-02 10:00:00', endedBy: s.ids.t1 });
  assert.equal(code(invite(s.ids.t3)), 'not_found');
  assert.equal(code(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t3 }, s.t.dean)), 'not_found');
  assert.deepEqual(s.call('syllabus.invitations', {}, s.t.t2).data.invitations, []);
});

test('dir.summary, subjects.overview and teacher.mySubjects mark a shared line', () => {
  const { s, L } = base();
  const sum = () => s.call('dir.summary', { table: 'disciplines' }, s.t.dean).data.rows.find((r) => r.id === s.ds1).syllabi;
  assert.equal('shared' in sum(), false);
  s.share(L.id, 't2');
  assert.equal(sum().shared, 1);
  const mine = s.call('teacher.mySubjects', {}, s.t.t2).data.subjects[0].syllabus;
  assert.deepEqual(mine, { approved: true, open: null, shared: true, members: 2 });
  const rows = s.call('subjects.overview', {}, s.t.dean).data.rows;
  assert.deepEqual([rows.find((r) => r.teacherId === s.ids.t2).shared, rows.find((r) => r.teacherId === s.ids.t2).members], [true, 2]);
  assert.equal('shared' in rows.find((r) => r.teacherId === s.ids.t3), false);
  // a member who no longer teaches the discipline is not counted
  s.store.update('subjects', s.sb2, { teacherId: s.ids.t5 });
  assert.equal('shared' in sum(), false);
});

test('every request reads a sheet at most once, invite does not touch pairs, topics and syllabi', () => {
  const { s, L } = base();
  const run = (action, data, token, allowed) => {
    s.spy.reset();
    assert.equal(s.call(action, data, token).ok, true, action);
    for (const [table, n] of Object.entries(s.spy.lists)) assert.ok(n <= 1, `${action} reads ${table} ${n} times`);
    for (const table of Object.keys(s.spy.lists)) assert.ok(allowed.includes(table), `${action} reads ${table}`);
  };
  run('syllabus.invite', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1, MEMBER_TABLES);
  run('syllabus.invitations', {}, s.t.t2, [...MEMBER_TABLES, 'disciplines', 'syllabi']);
  run('syllabus.setAuthor', { lineId: L.id, teacherId: s.ids.t1 }, s.t.dean, MEMBER_TABLES);
  run('syllabus.withdraw', { lineId: L.id, teacherId: s.ids.t2 }, s.t.t1, MEMBER_TABLES);
  s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids.t3 }, s.t.t1);
  run('syllabus.decline', { lineId: L.id }, s.t.t3, MEMBER_TABLES);
  run('syllabus.newLine', { disciplineId: s.ds1, semester: 2 }, s.t.dean, ['disciplines', 'syllabi']);
});

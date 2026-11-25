import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './linesSetup.js';
import { handleRequest } from '../backend/api.js';
import { SWITCH_TABLES } from '../backend/lineSwitch.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);
const TABLES = ['pairs', 'syllabi', 'syllabusLines', 'syllabusMembers', 'topics'];
// The tables as text with the random ids numbered by their first appearance, so two bases built apart can be compared.
function dump(s) {
  const seen = new Map();
  const ids = /(?<![a-z0-9_])[a-z]{1,2}_[0-9a-f]{8}(?![0-9a-z_])/g;
  return Object.fromEntries(TABLES.map((n) => [n, JSON.stringify(s.store.list(n)).replace(ids, (id) => { if (!seen.has(id)) seen.set(id, `#${seen.size}`); return seen.get(id); })]));
}
const pairsOf = (s, subjectId) => JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === subjectId));
const rowOf = (s, lineId, key) => s.store.list('syllabusMembers').filter((m) => m.lineId === lineId && m.teacherId === s.ids[key]);

// t1 leads L (approved А1…А5), t2 has an own approved syllabus (Б1…Б5), t2 held the first pair on «Б1»; t1 calls t2 and t3.
function base() {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  s.publish(s.sb2, s.FILE_B);
  s.at('2026-09-03');
  s.hold(s.sb2, '2026-09-02');
  const L = s.lineOf('t1');
  const own = s.lineOf('t2');
  for (const key of ['t2', 't3']) assert.equal(s.call('syllabus.invite', { lineId: L.id, teacherId: s.ids[key] }, s.t.t1).ok, true);
  const join = (key, lineId = L.id, extra = {}) => s.call('syllabus.join', { lineId, ...extra }, s.t[key]);
  const add = (key, lineId = L.id, token = s.t.dean, extra = {}) => s.call('syllabus.add', { lineId, teacherId: s.ids[key], ...extra }, token);
  return { s, L, own, join, add };
}
const fresh = (s, half = 1, token = s.t.dean) => s.call('syllabus.newLine', { disciplineId: s.ds1, semester: half }, token).data;

test('join: a teacher moves onto the line, the held pair keeps its theme, the group of the author is untouched', () => {
  const { s, L, own, join } = base();
  const mine1 = pairsOf(s, s.sb1);
  const r = join('t2');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);
  assert.equal(pairsOf(s, s.sb1), mine1);
  assert.equal(s.store.list('syllabusMembers').find((x) => x.lineId === own.id).state, 'left');
  assert.equal(s.store.list('syllabi').find((v) => v.lineId === own.id && v.version === 1).status, 'approved');
  assert.deepEqual([s.oneJoined(), r.data.line.members.length, code(join('t2'))], [[], 2, 'already_member']);
  assert.deepEqual(s.topicsOf(s.sb3).slice(0, 2), ['', '']);
  assert.ok(r.data.changedPairs > 0);
  assert.equal(r.data.line.id, L.id);
  const row = rowOf(s, L.id, 't2')[0];
  assert.deepEqual([row.state, row.joinedAt !== '', rowOf(s, own.id, 't2')[0].endedBy], ['joined', true, s.ids.t2]);
  assert.equal(JSON.stringify(r.data).includes('passwordHash'), false);
});

test('join: a teacher without an own syllabus gets the themes, a held pair without a theme gets the next one', () => {
  const { s, join } = base();
  s.hold(s.sb3, '2026-09-03');
  assert.deepEqual(s.topicsOf(s.sb3).slice(0, 2), ['', '']);
  const r = join('t3');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(s.topicsOf(s.sb3).slice(0, 3), ['А1', 'А2', 'А3']);
  assert.deepEqual(s.oneJoined(), []);
  assert.equal(s.lineOf('t3').id, r.data.line.id);
});

test('join: the line of the one who leaves goes to the history; the calls into it are taken back', () => {
  const { s, L, own, join, add } = base();
  assert.equal(s.call('syllabus.invite', { lineId: own.id, teacherId: s.ids.t3 }, s.t.t2).ok, true);
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2).data.syllabusId;
  assert.equal(s.call('syllabus.invitations', {}, s.t.t3).data.invitations.length, 2);
  const r = join('t2');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rowOf(s, own.id, 't3')[0].state, 'withdrawn');
  assert.deepEqual(s.call('syllabus.invitations', {}, s.t.t3).data.invitations.map((x) => x.lineId), [L.id]);
  assert.deepEqual([code(join('t3', own.id)), code(add('t3', own.id)), code(s.call('syllabus.startDraft', { lineId: own.id }, s.t.dean))], ['not_found', 'not_found', 'not_found']);
  const versions = s.store.list('syllabi').filter((v) => v.lineId === own.id).map((v) => [v.version, v.status]).sort();
  assert.deepEqual(versions, [[1, 'approved'], [2, 'archived']]);
  assert.equal(s.store.list('syllabi').find((v) => v.id === draft).status, 'archived');
  assert.equal(s.call('syllabus.queue', {}, s.t.dean).data.count, 0);
  assert.deepEqual(s.oneJoined(), []);
});

test('join: a version on review is archived too', () => {
  const { s, own, join } = base();
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2).data.syllabusId;
  s.store.update('syllabi', draft, { status: 'review' });
  assert.equal(s.call('syllabus.queue', {}, s.t.dean).data.count, 1);
  assert.equal(join('t2').ok, true);
  assert.equal(s.store.list('syllabi').find((v) => v.id === draft).status, 'archived');
  assert.equal(s.call('syllabus.queue', {}, s.t.dean).data.count, 0);
  assert.equal(s.store.list('syllabi').find((v) => v.lineId === own.id && v.version === 1).status, 'approved');
});

test('join: a closed unit, a final sheet or an exam of the group stop the move; the group of the author does not', () => {
  const { s, join } = base();
  s.closeUnit(s.sb1, 1);
  s.closeUnit(s.sb2, 1, 3);
  const was = s.snapshot();
  const closed = s.closeUnit(s.sb2, 1, 1);
  const stopped = s.snapshot();
  const r = join('t2');
  assert.deepEqual([r.ok, r.error.code, r.error.fields], [false, 'line_locked', [{ field: 'group', code: 'unit_closed', name: '02-1' }]]);
  assert.deepEqual(s.snapshot(), stopped);
  s.store.update('closures', closed.id, { reopenedAt: '2026-09-02 10:00:00', reopenedBy: s.ids.dean });
  assert.notDeepEqual(s.snapshot(), was);
  const reopened = s.snapshot();
  assert.equal(join('t2').ok, true);
  assert.notDeepEqual(s.snapshot().syllabusMembers, reopened.syllabusMembers);

  const final = base();
  final.s.closeUnit(final.s.sb2, 0, 1);
  assert.deepEqual(final.join('t2').error.fields, [{ field: 'group', code: 'unit_closed', name: '02-1' }]);

  const exam = base();
  exam.s.store.insert('subjectExams', { subjectId: exam.s.sb2, planSemester: 1, date: '2026-12-25', examiner: '', assistants: '', updatedBy: '', updatedAt: '' });
  const before = exam.s.snapshot();
  const e = exam.join('t2');
  assert.deepEqual([e.error.code, e.error.fields], ['line_locked', [{ field: 'group', code: 'exam_exists', name: '02-1' }]]);
  assert.deepEqual(exam.s.snapshot(), before);

  const attempt = base();
  attempt.s.store.insert('examAttempts', { subjectId: attempt.s.sb2, planSemester: 1, studentId: attempt.s.ids.s2, no: 1, date: '2026-12-25', outcome: 'score', score: 20, commission: '', updatedBy: '', updatedAt: '' });
  assert.equal(attempt.join('t2').error.code, 'line_locked');
  assert.deepEqual(attempt.s.oneJoined(), []);
});

test('join: no approved version on the new line asks for a confirmation', () => {
  const { s, own } = base();
  const N = fresh(s);
  s.share(N.lineId, 't2', 'invited');
  s.share(N.lineId, 't3', 'invited');
  const was = s.snapshot();
  const r = s.call('syllabus.join', { lineId: N.lineId }, s.t.t2);
  assert.deepEqual([r.ok, r.error.code, r.error.fields], [false, 'needs_confirm', [{ field: 'line', code: 'no_approved' }]]);
  assert.deepEqual(s.snapshot(), was);
  assert.equal(code(s.call('syllabus.join', { lineId: N.lineId, confirm: 'yes' }, s.t.t2)), 'bad_request');
  assert.equal(s.call('syllabus.join', { lineId: N.lineId, confirm: true }, s.t.t2).ok, true);
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', '', '']);
  assert.equal(s.store.list('syllabi').find((v) => v.lineId === own.id && v.version === 1).status, 'approved');
  assert.equal(s.call('syllabus.join', { lineId: N.lineId }, s.t.t3).ok, true);              // no syllabus of his own: no question
  assert.deepEqual(s.oneJoined(), []);
});

test('join: the general syllabus is shorter than what was held, the move still goes', () => {
  const { s, L, join } = base();
  for (const date of ['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']) s.hold(s.sb2, date);
  assert.equal(s.topicsOf(s.sb2).slice(0, 5).every((t) => t.startsWith('Б')), true);
  const r = join('t2');
  assert.equal(r.ok, true, JSON.stringify(r));
  const names = s.topicsOf(s.sb2);
  assert.deepEqual(names.slice(0, 5), ['Б1', 'Б2', 'Б3', 'Б4', 'Б5']);
  assert.deepEqual(names.slice(5, 8), ['', '', '']);
  assert.equal(r.data.line.id, L.id);
});

test('join: only an invited teacher of the discipline, a plain id of a line that is there', () => {
  const { s, L, join } = base();
  const was = s.snapshot();
  assert.equal(code(s.call('syllabus.join', { lineId: L.id }, s.t.t4)), 'forbidden');             // another discipline
  assert.equal(code(s.call('syllabus.join', { lineId: L.id }, s.t.t5)), 'forbidden');
  assert.equal(code(s.call('syllabus.join', { lineId: L.id }, s.t.t1)), 'already_member');
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.s2).ok, false);
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.dean).ok, false);
  assert.equal(s.call('syllabus.join', { lineId: L.id }).ok, false);
  for (const lineId of [[L.id], 5, '  ', '__proto__', '', null, { id: L.id }, 'nope']) assert.ok(['bad_request', 'not_found'].includes(code(s.call('syllabus.join', { lineId }, s.t.t2))), JSON.stringify(lineId));
  assert.equal(code(s.call('syllabus.join', { lineId: L.id, confirm: 1 }, s.t.t2)), 'bad_request');
  assert.equal(code(s.call('syllabus.join', undefined, s.t.t2)), 'bad_request');
  assert.deepEqual(s.snapshot(), was);
  // a call that was taken back or declined
  assert.equal(s.call('syllabus.withdraw', { lineId: L.id, teacherId: s.ids.t3 }, s.t.t1).ok, true);
  assert.equal(code(join('t3')), 'forbidden');
  assert.equal(s.call('syllabus.decline', { lineId: L.id }, s.t.t2).ok, true);
  assert.equal(code(join('t2')), 'forbidden');
  // a teacher who was switched off
  const again = base();
  again.s.store.update('staff', again.s.ids.t2, { active: false });
  assert.ok(['not_teaching', 'unauthorized'].includes(code(again.join('t2'))));
  assert.deepEqual(again.s.oneJoined(), []);
});

test('add: the deanery puts a teacher on the line at once, with or without a call', () => {
  const { s, L, add } = base();
  const r = add('t4', L.id);
  assert.equal(r.error.code, 'not_teaching');
  const r4 = add('t5');
  assert.equal(r4.error.code, 'not_teaching');
  const mine = pairsOf(s, s.sb1);
  const ok = add('t2');                                                             // had a call: the same row
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual([rowOf(s, L.id, 't2').length, rowOf(s, L.id, 't2')[0].state, rowOf(s, L.id, 't2')[0].byId], [1, 'joined', s.ids.t1]);
  const other = s.call('syllabus.withdraw', { lineId: L.id, teacherId: s.ids.t3 }, s.t.t1);
  assert.equal(other.ok, true);
  const free = add('t3', L.id, s.t.admin);                                          // no call at all
  assert.equal(free.ok, true, JSON.stringify(free));
  const row = rowOf(s, L.id, 't3').find((m) => m.state === 'joined');
  assert.deepEqual([row.byId, row.joinedAt !== '', row.lineId, row.semester, row.disciplineId], [s.ids.admin, true, L.id, 1, s.ds1]);
  assert.equal(pairsOf(s, s.sb1), mine);
  assert.deepEqual(s.topicsOf(s.sb3).slice(0, 2), ['А1', 'А2']);
  assert.deepEqual([code(add('t2')), code(add('t3'))], ['already_member', 'already_member']);
  assert.deepEqual(free.data.line.members.map((m) => m.teacherId).sort(), [s.ids.t1, s.ids.t2, s.ids.t3].sort());
  assert.deepEqual(s.oneJoined(), []);
});

test('add: rights and bad input write nothing', () => {
  const { s, L, add } = base();
  const was = s.snapshot();
  for (const token of [s.t.t1, s.t.t2, s.t.prorector, s.t.s1]) assert.equal(code(add('t3', L.id, token)), 'forbidden');
  assert.equal(s.call('syllabus.add', { lineId: L.id, teacherId: s.ids.t3 }).ok, false);
  for (const bad of [[s.ids.t3], 5, '  ', '__proto__', null, undefined, { id: 1 }]) assert.ok(['bad_request', 'not_teaching'].includes(code(s.call('syllabus.add', { lineId: L.id, teacherId: bad }, s.t.dean))), JSON.stringify(bad));
  for (const lineId of [[L.id], 5, '  ', '__proto__', null, 'nope']) assert.ok(['bad_request', 'not_found'].includes(code(s.call('syllabus.add', { lineId, teacherId: s.ids.t3 }, s.t.dean))), JSON.stringify(lineId));
  assert.equal(code(s.call('syllabus.add', { lineId: L.id, teacherId: 'nope' }, s.t.dean)), 'not_teaching');
  assert.equal(code(s.call('syllabus.add', { lineId: L.id, teacherId: s.ids.t3, confirm: 'true' }, s.t.dean)), 'bad_request');
  s.store.update('staff', s.ids.t3, { active: false });
  const off = s.snapshot();
  assert.equal(code(add('t3')), 'not_teaching');
  assert.deepEqual(s.snapshot(), off);
  assert.deepEqual(Object.keys(was), Object.keys(off));
});

test('add: into a line of the deanery that has no author and no people yet', () => {
  const { s, add } = base();
  const N = fresh(s);
  const r = add('t3', N.lineId);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.data.line.authorId, r.data.line.members.map((m) => m.teacherId)], ['', [s.ids.t3]]);
  assert.equal(add('t2', N.lineId).error.code, 'needs_confirm');
  assert.equal(add('t2', N.lineId, s.t.dean, { confirm: true }).ok, true);
  assert.deepEqual(s.oneJoined(), []);
});

test('join: from one shared line to another one, no new version but the empty draft of the new line', () => {
  const { s, L, join } = base();
  assert.equal(join('t2').ok, true);
  const before = s.store.list('syllabi').length;
  const N = fresh(s);
  s.share(N.lineId, 't2', 'invited');
  const r = s.call('syllabus.join', { lineId: N.lineId, confirm: true }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([rowOf(s, L.id, 't2')[0].state, rowOf(s, N.lineId, 't2')[0].state], ['left', 'joined']);
  assert.equal(s.store.list('syllabi').length, before + 1);                               // only the empty draft of newLine
  assert.deepEqual(s.oneJoined(), []);
  assert.deepEqual(s.call('syllabus.get', { subjectId: s.sb2 }, s.t.t2).ok, true);
});

test('join: the author leaves, the one who joined earliest among those who teach the discipline becomes the author', () => {
  const { s, L, join } = base();
  s.share(L.id, 't5', 'joined', { joinedAt: '2026-09-01 08:00:00' });                         // joined first but teaches nothing
  assert.equal(s.call('syllabus.add', { lineId: L.id, teacherId: s.ids.t3 }, s.t.dean).ok, true);
  const N = fresh(s);
  s.share(N.lineId, 't1', 'invited');
  const r = s.call('syllabus.join', { lineId: N.lineId, confirm: true }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, s.ids.t3);
  assert.deepEqual(rowOf(s, L.id, 't1').map((m) => m.state), ['left']);
  assert.deepEqual(rowOf(s, L.id, 't2').map((m) => m.state), ['invited']);
  assert.deepEqual(s.oneJoined(), []);
  assert.equal(join('t2').ok, true);
});

test('join: the author leaves a line where only people without a group stay, the author is the deanery', () => {
  const { s, L } = base();
  s.share(L.id, 't5', 'joined');
  const N = fresh(s);
  s.share(N.lineId, 't1', 'invited');
  const r = s.call('syllabus.join', { lineId: N.lineId, confirm: true }, s.t.t1);
  assert.equal(r.ok, true, JSON.stringify(r));
  const line = s.store.list('syllabusLines').find((l) => l.id === L.id);
  assert.equal(line.authorId, '');
  assert.deepEqual(rowOf(s, L.id, 't1').map((m) => m.state), ['left']);
  assert.deepEqual(rowOf(s, L.id, 't2').map((m) => m.state), ['invited']);            // somebody still stays on the line: the calls stay
  assert.deepEqual(s.oneJoined(), []);
});

test('join: a line of the other half of the year changes no pair', () => {
  const { s, own } = base();
  const N = fresh(s, 2);
  s.share(N.lineId, 't2', 'invited');
  const pairs = JSON.stringify(s.store.list('pairs'));
  const r = s.call('syllabus.join', { lineId: N.lineId }, s.t.t2);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([JSON.stringify(s.store.list('pairs')) === pairs, r.data.changedPairs], [true, 0]);
  assert.notEqual(s.lineOf('t2', 2), null);
  assert.equal(s.lineOf('t2', 1).id, own.id);                                                 // the autumn line is still his
  assert.deepEqual(s.oneJoined(), []);
});

// A store over the one of the test whose n-th write (insertMany or updateMany) of the table fails.
function breakAt(s, table, nth) {
  let seen = 0;
  const wrap = (method) => (name, rows) => {
    if (name === table) { seen += 1; if (seen === nth) throw new Error('Service Spreadsheets timed out'); }
    return s.spy[method](name, rows);
  };
  return { ...s.spy, updateMany: wrap('updateMany'), insertMany: wrap('insertMany') };
}
const callOn = (s, store, action, data, token) => handleRequest(JSON.stringify({ action, data, token }), { store, platform: s.platform, log: () => {} });

// Scenario A: t1 (author) leaves L for the line of the deanery; t3 stays. Scenario B: t2 alone on an own line with a draft and a call leaves for L.
const SCENARIOS = {
  A: (s, L) => {
    s.share(L.id, 't3', 'joined');
    const N = fresh(s);
    s.share(N.lineId, 't1', 'invited');
    return { action: 'syllabus.join', data: { lineId: N.lineId, confirm: true }, token: s.t.t1, check: () => assert.equal(s.store.list('syllabusLines').find((l) => l.id === L.id).authorId, s.ids.t3) };
  },
  B: (s, L, own) => {
    s.call('syllabus.invite', { lineId: own.id, teacherId: s.ids.t3 }, s.t.t2);
    s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
    return { action: 'syllabus.join', data: { lineId: L.id }, token: s.t.t2, check: () => assert.equal(rowOf(s, own.id, 't3')[0].state, 'withdrawn') };
  },
};
for (const [name, make] of Object.entries(SCENARIOS)) {
  for (const nth of [1, 2]) {
    test(`join: a break on write ${nth} of «Участники» (scenario ${name}) is finished by the same request again`, () => {
      const clean = base();
      const q = make(clean.s, clean.L, clean.own);
      assert.equal(clean.s.call(q.action, q.data, q.token).ok, true);
      const end = dump(clean.s);

      const { s, L, own } = base();
      const p = make(s, L, own);
      const failed = callOn(s, breakAt(s, 'syllabusMembers', nth), p.action, p.data, p.token);
      assert.deepEqual([failed.ok, failed.error.code], [false, 'internal']);
      const again = s.call(p.action, p.data, p.token);
      assert.equal(again.ok, true, JSON.stringify(again));
      assert.deepEqual(dump(s), end);
      p.check();
      assert.deepEqual(s.oneJoined(), []);
      assert.equal(code(s.call(p.action, p.data, p.token)), 'already_member');
    });
  }
}

test('join: a break before the members are written leaves the pairs as the move needs them', () => {
  const { s, L, own } = base();
  const p = SCENARIOS.B(s, L, own);
  const failed = callOn(s, breakAt(s, 'syllabusMembers', 1), p.action, p.data, p.token);
  assert.equal(failed.ok, false);
  assert.equal(rowOf(s, own.id, 't2')[0].state, 'joined');                                   // still on the own line
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);                         // the pairs are already laid
  assert.deepEqual(s.oneJoined(), []);
});

test('join and add read each sheet once', () => {
  const { s, L } = base();
  s.spy.reset();
  assert.equal(s.call('syllabus.join', { lineId: L.id }, s.t.t2).ok, true);
  for (const table of SWITCH_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, `${table}: ${s.spy.lists[table]}`);
  s.spy.reset();
  assert.equal(s.call('syllabus.add', { lineId: L.id, teacherId: s.ids.t3 }, s.t.dean).ok, true);
  for (const table of SWITCH_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, `${table}: ${s.spy.lists[table]}`);
});

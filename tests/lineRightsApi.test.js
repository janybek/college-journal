import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setup } from './linesSetup.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';
import { SAMPLE, b64 } from './fakes/sampleFiles.js';
import { ensureLine } from '../backend/syllabusDraft.js';
import { oneJoined } from '../core/syllabusLines.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);

// t1 (author, 01-1), t2 (joined, 02-1), t3 (invited, 03-1) on one line of «Анатомия»; an approved version A; a draft of t1.
function base() {
  const s = setup({ files: createMemoryFiles() });
  s.publish(s.sb1, s.FILE_A);
  const line = s.lineOf('t1');
  s.share(line.id, 't2');
  s.share(line.id, 't3', 'invited');
  assert.equal(s.call('schedule.generate', {}, s.t.dean).ok, true);
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  return { s, line, draft };
}
const planOf = (s, id) => structuredClone(s.call('syllabus.form', { syllabusId: id }, s.t.dean).data.doc.plan);
const without = (plan, name) => {
  for (const u of plan.units) for (const kind of ['lecture', 'practice', 'seminar', 'lab']) u[kind] = u[kind].filter((r) => r.name !== name);
  return plan;
};
const lessonsOnVersion = (s, subjectId) => {
  const versionOf = new Map(s.store.list('topics').map((t) => [t.id, t.syllabusId]));
  return [...new Set(s.store.list('pairs').filter((p) => p.subjectId === subjectId && p.topicId).map((p) => versionOf.get(p.topicId)))];
};

test('who may save, submit and read the form of a version of a shared line', () => {
  const { s, draft } = base();
  const goals = { ...s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.doc.goals, goal: 'Правка цели' };
  const save = (token) => code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: goals }, token));
  assert.deepEqual(['t1', 't2', 't3', 't4', 'dean', 'prorector'].map((k) => save(s.t[k])), ['ok', 'ok', 'forbidden', 'forbidden', 'ok', 'forbidden']);
  const submit = (token) => code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, token));
  assert.deepEqual(['t2', 't3', 't4', 't1'].map((k) => submit(s.t[k])), ['forbidden', 'forbidden', 'forbidden', 'ok']);
  const form = (token) => s.call('syllabus.form', { syllabusId: draft }, token);
  assert.deepEqual([form(s.t.t3).data.can.edit, form(s.t.t3).data.line.mine, code(form(s.t.t4))], [false, 'invited', 'forbidden']);
  assert.deepEqual([code(form(s.t.t5)), code(form(s.t.s1)), code(form(s.t.prorector))], ['forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual([code(s.call('syllabus.approve', { syllabusId: draft }, s.t.t1)), code(s.call('syllabus.return', { syllabusId: draft, remark: 'x' }, s.t.t2))], ['forbidden', 'forbidden']);
  assert.deepEqual(s.oneJoined(), []);

  // the approved version is not read by the form of a stranger either
  const approved = s.store.list('syllabi').find((v) => v.status === 'approved').id;
  assert.deepEqual(['t4', 't5', 's1'].map((k) => code(s.call('syllabus.form', { syllabusId: approved }, s.t[k]))), ['forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual(['t1', 't2', 't3', 'dean', 'admin', 'prorector'].map((k) => code(s.call('syllabus.form', { syllabusId: approved }, s.t[k]))), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
});

test('a refusal writes nothing: the tables are the same before and after', () => {
  const { s, draft } = base();
  const before = JSON.stringify(s.snapshot());
  const goals = { goal: 'Чужая правка' };
  for (const k of ['t3', 't4', 't5', 'prorector']) assert.equal(code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: goals }, s.t[k])), 'forbidden', k);
  for (const k of ['t2', 't3', 't4']) assert.equal(code(s.call('syllabus.submit', { syllabusId: draft }, s.t[k])), 'forbidden', k);
  for (const k of ['t1', 't2', 't4']) assert.equal(code(s.call('syllabus.approve', { syllabusId: draft }, s.t[k])), 'forbidden', k);
  assert.equal(JSON.stringify(s.snapshot()), before);
});

test('an author who no longer teaches the discipline neither edits nor submits', () => {
  const { s, draft } = base();
  s.store.update('subjects', s.sb1, { teacherId: s.ids.t5 });
  const goals = { ...s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.doc.goals, goal: 'Правка' };
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: goals }, s.t.t1)), 'forbidden');
  assert.equal(code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, s.t.t1)), 'forbidden');
  assert.equal(code(s.call('syllabus.form', { syllabusId: draft }, s.t.t1)), 'forbidden');
});

test('a locked version: someone who may edit gets syllabus_locked, someone who may not gets forbidden', () => {
  const { s, draft } = base();
  assert.equal(s.call('syllabus.submit', { syllabusId: draft }, s.t.t1).data.submitted, true);
  const goals = { ...s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.doc.goals, goal: 'Правка' };
  const save = (k) => code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: goals }, s.t[k]));
  assert.deepEqual(['t1', 't2', 'dean', 't3', 't4', 'prorector'].map(save), ['syllabus_locked', 'syllabus_locked', 'syllabus_locked', 'forbidden', 'forbidden', 'forbidden']);
});

test('the queue: the author and the number of the members', () => {
  const { s, draft } = base();
  assert.equal(s.call('syllabus.submit', { syllabusId: draft }, s.t.t1).data.submitted, true);
  const rows = s.call('syllabus.queue', {}, s.t.dean).data.rows;
  assert.deepEqual(rows.map((r) => [r.authorName, r.teacherName, r.members, r.subjectId]), [[s.names.t1, s.names.t1, 2, s.sb1]]);
  s.store.update('syllabusLines', s.lineOf('t1').id, { authorId: '' });
  assert.deepEqual(s.call('syllabus.queue', {}, s.t.prorector).data.rows.map((r) => [r.authorName, r.teacherName]), [['', '']]);
});

test('the page of a student: the teachers of the line and nothing of invitations, dates or history', () => {
  const { s } = base();
  const page = s.call('syllabus.get', { subjectId: s.sb2 }, s.t.s2).data;
  assert.deepEqual(page.line, { shared: true, teachers: [{ fullName: s.names.t1 }, { fullName: s.names.t2 }] });
  assert.equal(/invited|joinedAt|endedAt|byName|candidates|history/.test(JSON.stringify(page)), false);
  const alone = s.call('syllabus.get', { subjectId: s.sb3 }, s.t.s3).data;
  assert.equal('line' in alone, false);                                        // t3 is only invited: his group has no line of its own yet
  assert.equal(JSON.stringify(alone).includes(s.names.t1), false);
});

test('syllabus.get: the groups of the line and the line itself for the staff', () => {
  const { s } = base();
  const dean = s.call('syllabus.get', { subjectId: s.sb1 }, s.t.dean).data;
  assert.deepEqual(dean.groups.map((g) => [g.groupName, g.teacherName]), [['01-1', s.names.t1], ['02-1', s.names.t2]]);
  assert.deepEqual([dean.line.shared, dean.line.mine, dean.line.can.add], [true, null, true]);
  const own = s.call('syllabus.get', { subjectId: s.sb2 }, s.t.t2).data;
  assert.deepEqual([own.groups.map((g) => [g.groupName, g.teacherName]), own.line.mine], [[['02-1', undefined]], 'member']);
  assert.equal(s.call('syllabus.get', { subjectId: s.sb1 }, s.t.prorector).data.line.can.add, false);
});

test('lineView: the members, the invited and the history; a member without a subject is listed with no groups', () => {
  const { s, line, draft } = base();
  s.share(line.id, 't5', 'joined', { joinedAt: '2026-09-02 10:00:00' });
  s.share(line.id, 't4', 'declined', { endedAt: '2026-09-03 10:00:00', endedBy: s.ids.t4 });
  s.share(line.id, 't4', 'withdrawn', { endedAt: '2026-09-04 10:00:00', endedBy: s.ids.t1 });
  s.share(line.id, 'prorector', 'left', { endedAt: '2026-09-02 09:00:00', endedBy: s.ids.prorector });
  const view = s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.line;
  assert.deepEqual([view.id, view.disciplineId, view.semester, view.authorId, view.authorName], [line.id, s.ds1, 1, s.ids.t1, s.names.t1]);
  assert.deepEqual(view.teachers, [{ id: s.ids.t1, fullName: s.names.t1 }, { id: s.ids.t2, fullName: s.names.t2 }]);
  assert.equal(view.shared, true);
  assert.deepEqual(view.members.map((m) => [m.fullName, m.author, m.groups]), [[s.names.t1, true, ['01-1']], [s.names.t2, false, ['02-1']], [s.names.t5, false, []]]);
  assert.deepEqual(view.members.map((m) => m.byName), [s.names.dean, s.names.t1, s.names.t1]);
  assert.deepEqual(view.invited.map((m) => [m.teacherId, m.fullName, m.invitedAt, m.byName]), [[s.ids.t3, s.names.t3, '2026-09-01 09:00:00', s.names.t1]]);
  assert.deepEqual(view.history.map((h) => [h.state, h.fullName, h.endedAt, h.endedByName]), [
    ['withdrawn', s.names.t4, '2026-09-04 10:00:00', s.names.t1], ['declined', s.names.t4, '2026-09-03 10:00:00', s.names.t4], ['left', s.names.prorector, '2026-09-02 09:00:00', s.names.prorector]]);
  assert.deepEqual(Object.keys(view.history[0]).sort(), ['endedAt', 'endedByName', 'fullName', 'invitedAt', 'joinedAt', 'state', 'teacherId']);
  // the one who left without a subject does not make the line «shared»
  const alone = setup();
  alone.publish(alone.sb1, alone.FILE_A);
  alone.share(alone.lineOf('t1').id, 't5');
  const d = alone.call('syllabus.startDraft', { subjectId: alone.sb1, semester: 1 }, alone.t.t1).data.syllabusId;
  const v = alone.call('syllabus.form', { syllabusId: d }, alone.t.t1).data.line;
  assert.deepEqual([v.shared, v.teachers.length, v.members.length], [false, 1, 2]);
  // a removed person: the name is empty, not an error
  s.store.remove('staff', s.ids.t3);
  assert.equal(s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.line.invited[0].fullName, '');
});

test('lineView: what each person may do and who can be called', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const line = s.lineOf('t1');
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  const can = (k, id = draft) => s.call('syllabus.form', { syllabusId: id }, s.t[k]).data.line;
  const none = { invite: false, add: false, remove: false, withdraw: false, leave: false, join: false, decline: false, setAuthor: false };
  assert.deepEqual(can('t1').can, { ...none, invite: true, remove: true, withdraw: true });
  assert.deepEqual(can('t1').candidates.map((c) => [c.id, c.fullName, c.groups]), [[s.ids.t2, s.names.t2, ['02-1']], [s.ids.t3, s.names.t3, ['03-1']]]);
  assert.deepEqual(can('dean').can, { ...none, add: true, remove: true, withdraw: true, setAuthor: true });
  assert.equal(can('dean').candidates.length, 2);
  s.share(line.id, 't2');
  s.share(line.id, 't3', 'invited');
  assert.deepEqual(can('t1').can, { ...none, invite: true, remove: true, withdraw: true, leave: true });
  assert.deepEqual(can('t2').can, { ...none, leave: true });
  assert.deepEqual(can('t3').can, { ...none, join: true, decline: true });
  assert.deepEqual(can('t1').candidates, []);
  assert.equal('candidates' in can('t2'), false);
  // the prorector sees the line of a version under review, but may do nothing
  assert.equal(s.call('syllabus.submit', { syllabusId: draft }, s.t.t1).data.submitted, true);
  const pro = can('prorector');
  assert.deepEqual([pro.can, 'candidates' in pro], [none, false]);
  // a dead line (everybody left) cannot be called to, joined or added to
  for (const m of s.store.list('syllabusMembers').filter((x) => x.lineId === line.id)) s.store.update('syllabusMembers', m.id, { state: 'left', endedAt: '2026-09-02 10:00:00', endedBy: s.ids.t1 });
  s.store.insert('syllabusMembers', { lineId: line.id, disciplineId: s.ds1, semester: 1, teacherId: s.ids.t2, state: 'invited', byId: s.ids.t1, invitedAt: '2026-09-02 11:00:00', joinedAt: '', endedAt: '', endedBy: '' });
  const dead = can('dean');
  assert.deepEqual([dead.can.invite, dead.can.add, dead.can.join], [false, false, false]);
  assert.deepEqual([can('t2').can.join, can('t2').mine], [false, 'invited']);
});

test('approval is checked against the pairs of every member of the line', () => {
  const { s, draft } = base();
  s.hold(s.sb2, '2026-09-02');                                                // t2 has held «А1»
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  const save = (plan) => assert.equal(s.call('syllabus.saveSection', { syllabusId: draft, section: 'plan', data: plan }, s.t.t1).ok, true);
  save(without(planOf(s, draft), 'А1'));
  const before = JSON.stringify(s.snapshot());
  const refused = s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data;
  assert.deepEqual([refused.approved, refused.changedPairs], [false, 0]);
  assert.deepEqual(refused.checks.errors, [{ section: 'plan', code: 'held_missing', name: 'А1', date: '2026-09-02', group: '02-1' }]);
  assert.equal(JSON.stringify(s.snapshot()), before);
  assert.deepEqual(s.call('syllabus.form', { syllabusId: draft }, s.t.t1).data.checks.errors, refused.checks.errors);
  assert.equal(s.oneJoined().length, 0);
});

test('a held lesson moved out of a closed unit of another member is named with its group', () => {
  const { s, draft } = base();
  s.hold(s.sb2, '2026-09-02');
  s.closeUnit(s.sb2, 1);
  const plan = planOf(s, draft);
  const moved = plan.units[0].lecture.find((r) => r.name === 'А1');
  plan.units[0].lecture = plan.units[0].lecture.filter((r) => r !== moved);
  plan.units[1].lecture.push(moved);
  assert.equal(s.call('syllabus.saveSection', { syllabusId: draft, section: 'plan', data: plan }, s.t.t1).ok, true);
  const refused = s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data;
  assert.deepEqual([refused.approved, refused.checks.errors], [false, [{ section: 'plan', code: 'held_closed', name: 'А1', date: '2026-09-02', group: '02-1' }]]);
});

test('another half of the plan is refused while a member has a closed unit; the error names the groups', () => {
  const { s, draft } = base();
  s.closeUnit(s.sb2, 1);
  const title = { ...s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.doc.title, course: 2, planSemester: 3 };
  assert.equal(s.call('syllabus.saveSection', { syllabusId: draft, section: 'title', data: title }, s.t.t1).ok, true);
  const refused = s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data;
  assert.deepEqual([refused.approved, refused.checks.errors], [false, [{ section: 'title', code: 'semester_closed', groups: ['02-1'] }]]);
});

test('the protection follows the line at the moment of the approval: a member who joined after the sending counts', () => {
  const { s, line, draft } = base();
  s.store.update('syllabusMembers', s.store.list('syllabusMembers').find((m) => m.teacherId === s.ids.t3).id, { state: 'withdrawn', endedAt: '2026-09-01 12:00:00', endedBy: s.ids.t1 });
  assert.equal(s.call('syllabus.saveSection', { syllabusId: draft, section: 'plan', data: without(planOf(s, draft), 'А1') }, s.t.t1).ok, true);
  assert.equal(s.call('syllabus.submit', { syllabusId: draft }, s.t.t1).data.submitted, true);
  s.share(line.id, 't3', 'joined', { joinedAt: '2026-09-03 10:00:00' });
  assert.equal(s.call('schedule.generate', {}, s.t.dean).ok, true);
  s.hold(s.sb3, '2026-09-03');
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');
  const refused = s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data;
  assert.deepEqual([refused.approved, refused.checks.errors.map((e) => [e.code, e.group])], [false, [['held_missing', '03-1']]]);
});

test('a successful approval lays the new rows over the pairs of every member and leaves the others', () => {
  const { s, line, draft } = base();
  s.share(line.id, 't4', 'left', { endedAt: '2026-09-01 12:00:00', endedBy: s.ids.t4 });
  const own3 = s.call('syllabus.startDraft', { subjectId: s.sb3, semester: 1 }, s.t.t3).data.syllabusId;   // t3 is only invited: a line of his own
  assert.notEqual(own3, draft);
  const pairsOf = (id) => JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === id));
  const before = [pairsOf(s.sb3), pairsOf(s.sb4)];
  const moving = s.store.list('pairs').filter((p) => [s.sb1, s.sb2].includes(p.subjectId) && p.topicId).length;
  const done = s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data;
  assert.deepEqual([done.approved, done.changedPairs], [true, moving]);
  assert.deepEqual([lessonsOnVersion(s, s.sb1), lessonsOnVersion(s, s.sb2)], [[draft], [draft]]);
  assert.deepEqual([pairsOf(s.sb3), pairsOf(s.sb4)], before);
  assert.deepEqual(s.store.list('syllabi').filter((v) => v.lineId === line.id).map((v) => v.status).sort(), ['approved', 'archived']);
  assert.deepEqual(s.oneJoined(), []);
});

test('a member starts a new version in the shared line; the author is the teacher of the version; the number goes on', () => {
  const { s, line, draft } = base();
  const again = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  assert.deepEqual(again.data, { syllabusId: draft, created: false });
  assert.deepEqual(s.store.list('syllabi').filter((v) => v.lineId === line.id && v.status === 'draft').length, 1);
  assert.deepEqual(s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data, { syllabusId: draft, created: false });
  assert.equal(s.store.list('syllabi').filter((v) => v.sourceId === '' && v.lineId === line.id && v.status === 'draft').length, 0);

  // after the approval, the member starts the next one
  assert.equal(s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data.approved, true);
  const next = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2).data;
  assert.equal(next.created, true);
  const row = s.store.list('syllabi').find((v) => v.id === next.syllabusId);
  assert.deepEqual([row.lineId, row.teacherId, row.version, row.sourceId === draft], [line.id, s.ids.t1, 3, true]);
  assert.deepEqual(s.store.list('syllabusLines').length, 1);
  assert.deepEqual(s.oneJoined(), []);
});

test('a file of a member lies in the shared draft, and the teacher of the version stays', () => {
  const { s, line } = base();
  const first = s.call('syllabus.apply', { subjectId: s.sb2, sheets: s.FILE_B }, s.t.t2);
  assert.equal(first.data.applied, true);
  const row = s.store.list('syllabi').find((v) => v.id === first.data.drafts[0].syllabusId);
  assert.deepEqual([row.lineId, row.teacherId, row.status, s.store.list('syllabusLines').length], [line.id, s.ids.t1, 'draft', 1]);
  const second = s.call('syllabus.apply', { subjectId: s.sb1, sheets: s.FILE_A }, s.t.t1);
  assert.deepEqual(second.data.drafts, first.data.drafts);
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === line.id && v.status === 'draft').length, 1);
  assert.equal(s.store.list('syllabi').find((v) => v.id === row.id).teacherId, s.ids.t1);
  assert.deepEqual(s.oneJoined(), []);
});

test('the administrator who starts a draft or loads a file for a member of a shared line makes no new line', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const line = s.lineOf('t1');
  s.share(line.id, 't2');
  const lines = s.store.list('syllabusLines').length;
  const started = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.admin);
  assert.equal(started.ok, true);
  const loaded = s.call('syllabus.apply', { subjectId: s.sb2, sheets: s.FILE_B }, s.t.admin);
  assert.deepEqual([loaded.data.applied, loaded.data.drafts[0].syllabusId], [true, started.data.syllabusId]);
  const row = s.store.list('syllabi').find((v) => v.id === started.data.syllabusId);
  assert.deepEqual([s.store.list('syllabusLines').length, s.oneJoined(), row.lineId], [lines, [], line.id]);
});

test('a line without an author: the name is empty and the deanery sends the version', () => {
  const { s, line, draft } = base();
  s.store.update('syllabusLines', line.id, { authorId: '' });
  const view = s.call('syllabus.form', { syllabusId: draft }, s.t.dean).data.line;
  assert.deepEqual([view.authorId, view.authorName, view.members.map((m) => m.author)], ['', '', [false, false]]);
  assert.equal(code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, s.t.t1)), 'forbidden');
  assert.equal(s.call('syllabus.submit', { syllabusId: draft }, s.t.dean).data.submitted, true);
});

test('a version without a line is not found, not an internal error', () => {
  const { s } = base();
  const { id, ...row } = s.store.list('syllabi')[0];
  const orphan = s.store.insert('syllabi', { ...row, lineId: '', status: 'draft', version: 9 }).id;
  const before = JSON.stringify(s.snapshot());
  const calls = [['syllabus.form', {}], ['syllabus.saveSection', { section: 'goals', data: { goal: 'x' } }], ['syllabus.submit', {}], ['syllabus.approve', {}], ['syllabus.return', { remark: 'x' }],
    ['syllabus.attachFile', { name: 'a.pdf', data: b64(SAMPLE.pdf) }], ['syllabus.dropFile', {}], ['syllabus.file', {}]];
  for (const [action, data] of calls) assert.equal(code(s.call(action, { syllabusId: orphan, ...data }, s.t.dean)), 'not_found', action);
  assert.equal(JSON.stringify(s.snapshot()), before);
});

test('the file of an approved version: who may read it', () => {
  const { s, draft } = base();
  const attached = s.call('syllabus.attachFile', { syllabusId: draft, name: 'Силлабус.pdf', data: b64(SAMPLE.pdf) }, s.t.t2);
  assert.equal(attached.ok, true);
  const read = (k, id = draft) => code(s.call('syllabus.file', { syllabusId: id }, s.t[k]));
  // an open version: those who see it
  assert.deepEqual(['t1', 't2', 't3', 'dean', 'admin', 't4', 't5', 's2', 'prorector'].map((k) => read(k)), ['ok', 'ok', 'ok', 'ok', 'ok', 'forbidden', 'forbidden', 'not_found', 'forbidden']);
  assert.equal(s.call('syllabus.approve', { syllabusId: draft }, s.t.dean).data.approved, true);
  assert.deepEqual(['t4', 't5', 's1', 's3'].map((k) => read(k)), ['forbidden', 'forbidden', 'ok', 'not_found']);
  assert.deepEqual(['t1', 't2', 't3', 'dean', 'admin', 'prorector', 's2'].map((k) => read(k)), Array(7).fill('ok'));
  // a replacement of a pair of the line reads it, a student of the group of someone who left does not
  const pair = s.store.list('pairs').find((p) => p.subjectId === s.sb1);
  s.store.update('pairs', pair.id, { teacherId: s.ids.t5 });
  assert.equal(read('t5'), 'ok');
  const row = s.store.list('syllabusMembers').find((m) => m.teacherId === s.ids.t2 && m.state === 'joined');
  s.store.update('syllabusMembers', row.id, { state: 'left', endedAt: '2026-09-05 10:00:00', endedBy: s.ids.t2 });
  assert.equal(read('s2'), 'not_found');
  assert.equal(read('t2'), 'forbidden');
});

test('student.subjects and the page of a student follow the line', () => {
  const { s } = base();
  const mine = (k) => s.call('student.subjects', {}, s.t[k]).data.subjects.map((x) => [x.name, x.hasSyllabus]);
  assert.deepEqual([mine('s1'), mine('s2'), mine('s3')], [[['Анатомия', true], ['Химия', false]], [['Анатомия', true]], [['Анатомия', false]]]);
});

// ---- the points of the deferred remarks of the check of task 2 ----

test('ensureLine: a joined row that points at a missing line is no line: it is closed and a new line is made', () => {
  const s = setup();
  const orphan = s.store.insert('syllabusMembers', { lineId: 'sl_missing', disciplineId: s.ds1, semester: 1, teacherId: s.ids.t2, state: 'joined', byId: s.ids.dean, invitedAt: '', joinedAt: '2026-09-01 08:00:00', endedAt: '', endedBy: '' });
  const started = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  assert.equal(started.ok, true);
  assert.deepEqual([s.oneJoined(), s.store.list('syllabusLines').length], [[], 1]);
  const old = s.store.list('syllabusMembers').find((m) => m.id === orphan.id);
  assert.deepEqual([old.state, old.lineId, old.teacherId, old.endedBy], ['left', 'sl_missing', s.ids.t2, s.ids.t2]);
  assert.equal(old.endedAt, '2026-08-31 12:00:00');
  const line = s.lineOf('t2');
  assert.deepEqual([line.authorId, s.store.list('syllabi').find((v) => v.id === started.data.syllabusId).lineId], [s.ids.t2, line.id]);
});

test('ensureLine: a line made before a break (no member at all) is taken again, not doubled', () => {
  const s = setup();
  const rows = () => ({ syllabusLines: s.store.list('syllabusLines'), syllabusMembers: s.store.list('syllabusMembers') });
  const key = { disciplineId: s.ds1, teacherId: s.ids.t2, semester: 1, userId: s.ids.t2 };
  assert.throws(() => ensureLine(s.failingOn('insertMany', 'syllabusMembers'), s.platform, key, rows()), /boom/);
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabusMembers').length], [1, 0]);
  const again = ensureLine(s.store, s.platform, key, rows());
  assert.equal(again.line.id, s.store.list('syllabusLines')[0].id);
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabusMembers').map((m) => [m.lineId, m.state, m.teacherId]), oneJoined(s.store.list('syllabusMembers'))],
    [1, [[again.line.id, 'joined', s.ids.t2]], []]);
  // a line of another author, of another maker, of another half or with a member is not taken
  const other = ensureLine(s.store, s.platform, { ...key, semester: 2 }, rows());
  assert.notEqual(other.line.id, again.line.id);
  s.store.insert('syllabusLines', { disciplineId: s.ds1, semester: 1, authorId: s.ids.t3, createdBy: s.ids.t3, createdAt: '2026-09-01 08:00:00' });
  const third = ensureLine(s.store, s.platform, { ...key, teacherId: s.ids.t3, userId: s.ids.dean }, rows());
  assert.equal(s.store.list('syllabusLines').filter((l) => l.authorId === s.ids.t3).length, 2);
  assert.notEqual(third.line.createdBy, s.ids.t3);
});

// ---- the speed and the places that looked for a version by the old key ----

test('every sheet, the two new ones too, is read at most once by the requests of a version', () => {
  const { s, draft } = base();
  const once = (action, data, token) => {
    s.spy.reset();
    const r = s.call(action, data, token);
    assert.equal(r.ok, true, action + ' ' + JSON.stringify(r));
    const over = Object.entries(s.spy.lists).filter(([, n]) => n > 1);
    assert.deepEqual(over, [], action);
    return r;
  };
  once('syllabus.get', { subjectId: s.sb2 }, s.t.s2);
  once('syllabus.get', { subjectId: s.sb1, version: 'open' }, s.t.dean);
  once('syllabus.form', { syllabusId: draft }, s.t.t1);
  once('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  once('syllabus.apply', { subjectId: s.sb2, sheets: s.FILE_B }, s.t.t2);
  once('syllabus.submit', { syllabusId: draft }, s.t.t1);
  once('syllabus.queue', {}, s.t.dean);
  once('syllabus.approve', { syllabusId: draft }, s.t.dean);
  once('student.subjects', {}, s.t.s2);
  const second = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 2 }, s.t.t1).data.syllabusId;
  once('syllabus.apply', { subjectId: s.sb1, sheets: s.FILE_A }, s.t.t1);
  assert.equal(s.store.list('syllabi').some((v) => v.id === second), true);
});

test('no place of the server looks for a version by the old key', () => {
  const files = readdirSync(new URL('../backend/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = readFileSync(new URL('../backend/' + f, import.meta.url), 'utf8');
    assert.equal(/teacherId === version\.teacherId/.test(text), false, f);
    assert.equal(/\bversionsOf\(/.test(text), false, f);
    assert.equal(/groupsOfTeacher/.test(text), false, f);
  }
});

test('the invitations, the joining and the leaving are gone: ten actions refused like an unknown one, startDraft by a line is a bad request', () => {
  const { s, line } = base();
  const removed = ['invite', 'join', 'decline', 'leave', 'invitations', 'withdraw', 'remove', 'add', 'setAuthor', 'newLine'];
  const before = JSON.stringify(s.snapshot());
  for (const k of ['dean', 't1']) {
    const unknown = s.call('syllabus.nothing', { lineId: line.id, teacherId: s.ids.t3 }, s.t[k]);
    assert.equal(unknown.ok, false);
    for (const name of removed) {
      const r = s.call(`syllabus.${name}`, { lineId: line.id, teacherId: s.ids.t3, disciplineId: s.ds1, semester: 1 }, s.t[k]);
      assert.deepEqual([name, r.ok, r.error.code], [name, false, unknown.error.code]);
    }
  }
  assert.equal(code(s.call('syllabus.startDraft', { lineId: line.id }, s.t.t1)), 'bad_request');
  assert.equal(JSON.stringify(s.snapshot()), before);
});

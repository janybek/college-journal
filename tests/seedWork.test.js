import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { seed, seedDemo, seedSyllabusFile, DEV_PASSWORD } from '../dev/seed.js';
import { sniffKind } from '../core/files.js';
import { bishkek } from './journalSetup.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek

function stand(files = null) {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform, files);
  return { store, platform, files };
}

function api(ctx) {
  const login = (who) => handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, ctx).data.token;
  return (action, data, who) => handleRequest({ action, token: login(who), data }, ctx);
}

const workLog = (store) => store.list('changeLog').filter((r) => r.entity === 'work');
const ESSAY = 'Эссе по теме юнита';

test('seedWork: three assignments of «Информатика» 01-1, the attempts of the first five students', () => {
  const { store } = stand(createMemoryFiles());
  const group = store.list('groups').find((g) => g.name === '01-1');
  const teacher1 = store.list('staff').find((p) => p.login === 'teacher1');
  const subject = store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id);
  assert.equal(subject.teacherId, teacher1.id);
  const tasks = store.list('assignments');
  assert.equal(tasks.length, 3);
  assert.equal(tasks.every((t) => t.subjectId === subject.id && t.unit === 2 && t.createdBy === teacher1.id), true);
  const by = (title) => tasks.find((t) => t.title === title);
  assert.deepEqual([by(ESSAY), by('Презентация'), by('Задачи 1–5')].map((t) => [t.kind, t.maxPoints]), [['srs', 10], ['srs', 20], ['hw', 5]]);
  assert.equal(by(ESSAY).dueAt, '2026-11-13 23:59:00');
  assert.equal(by('Презентация').dueAt, '2026-11-23 23:59:00');
  assert.equal(by('Задачи 1–5').dueAt, '2026-11-20 23:59:00');

  const first5 = store.list('students').filter((s) => s.groupId === group.id).slice(0, 5);
  const cardOf = new Map(store.list('students').map((s) => [s.id, s.cardNo]));
  const rows = store.list('submissions');
  const essay = rows.filter((r) => r.assignmentId === by(ESSAY).id);
  assert.deepEqual(essay.map((r) => [cardOf.get(r.studentId), r.status, r.points]).sort(), [['S1001', 'checked', 8], ['S1002', 'checked', 10], ['S1003', 'checked', 6], ['S1004', 'returned', null]]);
  assert.equal(essay.every((r) => first5.some((s) => s.id === r.studentId)), true);
  assert.deepEqual(essay.filter((r) => r.submittedAt > by(ESSAY).dueAt).map((r) => cardOf.get(r.studentId)), ['S1003']);
  assert.notEqual(essay.find((r) => r.status === 'returned').comment, '');
  const slides = rows.filter((r) => r.assignmentId === by('Презентация').id);
  assert.deepEqual(slides.map((r) => [cardOf.get(r.studentId), r.status]).sort(), [['S1001', 'submitted'], ['S1002', 'submitted']]);
  assert.deepEqual(rows.filter((r) => r.assignmentId === by('Задачи 1–5').id).map((r) => [cardOf.get(r.studentId), r.status]), [['S1002', 'submitted']]);
});

test('seedWork: one PNG picture on the disk, attached to a submitted work; the box holds it', () => {
  const files = createMemoryFiles();
  const { store } = stand(files);
  const rows = store.list('files').filter((r) => r.state !== 'syllabus');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].state, rows[0].kind], ['attached', 'png']);
  const bytes = files.read(rows[0].stored);
  assert.equal(sniffKind(bytes, 'png'), 'png');
  assert.equal(bytes.length, rows[0].size);
  assert.equal(bytes.length < 5000, true);
  assert.deepEqual(files.names().filter((n) => store.list('files').some((r) => r.stored === n && r.state !== 'syllabus')), [rows[0].stored]);
  const sub = store.list('submissions').find((r) => r.id === rows[0].submissionId);
  assert.equal(sub.status, 'submitted');
  assert.equal(store.list('assignments').find((a) => a.id === sub.assignmentId).title, 'Презентация');
});

test('seedWork: without a box nothing is a file, everything is text', () => {
  const { store } = stand(null);
  assert.equal(store.list('files').length, 0);
  assert.equal(store.list('assignments').length, 3);
  const subs = store.list('submissions');
  assert.equal(subs.length, 7);
  assert.equal(subs.filter((r) => r.status === 'submitted').every((r) => r.text !== ''), true);
});

test('seedWork: the change log has the rows of the grades, as work.grade writes them', () => {
  const { store } = stand(createMemoryFiles());
  const log = workLog(store);
  // three first grades (points and status each) and one return (status only)
  assert.equal(log.length, 7);
  assert.deepEqual(log.filter((r) => r.field === 'points').map((r) => r.after).sort(), ['10', '6', '8']);
  assert.deepEqual(log.filter((r) => r.field === 'status').map((r) => [r.before, r.after]).sort(), [['submitted', 'checked'], ['submitted', 'checked'], ['submitted', 'checked'], ['submitted', 'returned']]);
  assert.equal(log.every((r) => r.reason === '' && r.studentId !== '' && r.assignmentId !== '' && r.unit === 2), true);
  const teacher1 = store.list('staff').find((p) => p.login === 'teacher1');
  assert.equal(log.every((r) => r.actorId === teacher1.id), true);
});

test('seedWork: the journal of the teacher counts unit 2 by assignments; a checked essay and a waiting presentation give a provisional СРС', () => {
  const ctx = stand(createMemoryFiles());
  const call = api(ctx);
  const subject = ctx.store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === ctx.store.list('groups').find((g) => g.name === '01-1').id);
  const student = ctx.store.list('students').find((s) => s.cardNo === 'S1001');
  const view = call('journal.get', { subjectId: subject.id }, 'teacher1');
  assert.equal(view.ok, true);
  const journal = view.data.journal;
  assert.equal(journal.units.find((u) => u.unit === 2).byWork, true);
  assert.equal('byWork' in journal.units.find((u) => u.unit === 1), false);
  const { selfWork } = journal.results[student.id].units.find((u) => u.unit === 2);
  assert.deepEqual([selfWork.earned, selfWork.max, selfWork.pending], [8, 30, 1]);
  const list = call('work.list', { subjectId: subject.id }, 'teacher1');
  assert.equal(list.ok, true);
  assert.equal(list.data.assignments.length, 3);
});

test('seedWork: work.mine has non-zero counters for the students with something to do; another group has no tasks', () => {
  const ctx = stand(createMemoryFiles());
  const call = api(ctx);
  const one = call('work.mine', {}, 'S1001').data;
  assert.deepEqual(one.tasks.map((t) => t.state).sort(), ['checked', 'none', 'submitted']);
  assert.equal(one.counts.fresh, 1);
  assert.equal(call('work.mine', {}, 'S1004').data.counts.returned, 1);
  assert.equal(call('work.mine', {}, 'S1005').data.counts.overdue, 1);
  assert.equal(call('work.mine', {}, 'S2001').data.tasks.length, 0);
});

test('seedWork: seedDemo gives the same rows of the change log, the assignments and the picture as seed', () => {
  const a = stand(createMemoryFiles());
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  store.insert('staff', { login: 'admin', fullName: 'Admin Demo', roles: 'admin', passwordHash: 'x', mustChangePassword: false, active: true, lang: 'ru' });
  assert.equal(seedDemo(store, platform, { password: 'pw-for-the-demo', files: createMemoryFiles() }), true);
  assert.equal(store.list('changeLog').length, a.store.list('changeLog').length);
  assert.equal(store.list('assignments').length, 3);
  assert.equal(store.list('files').length, 1);
  assert.equal(store.list('files').some((r) => r.state === 'syllabus'), false);
});

test('seedSyllabusFile: one real PDF on the approved «Информатика» of teacher1; none without a box and none in the demo', () => {
  const files = createMemoryFiles();
  const { store } = stand(files);
  const rows = store.list('files').filter((r) => r.state === 'syllabus');
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.deepEqual([row.kind, row.name, row.assignmentId, row.submissionId], ['pdf', 'Силлабус — Информатика.pdf', '', '']);
  assert.equal(row.ownerId, store.list('staff').find((p) => p.login === 'dean').id);
  const bytes = files.read(row.stored);
  assert.equal(sniffKind(bytes, 'pdf'), 'pdf');
  assert.equal(bytes.length, row.size);
  assert.equal(bytes.length < 2000, true);
  assert.equal(Buffer.from(bytes).toString('latin1').includes('Syllabus sample'), true);
  assert.equal(files.names().includes(row.stored), true);
  const teacher1 = store.list('staff').find((p) => p.login === 'teacher1');
  const discipline = store.list('disciplines').find((d) => d.name === 'Информатика');
  const linked = store.list('syllabi').filter((v) => v.fileId !== '');
  assert.deepEqual(linked.map((v) => [v.id, v.status, v.semester, v.teacherId, v.disciplineId]), [[linked[0].id, 'approved', 1, teacher1.id, discipline.id]]);
  assert.equal(linked[0].fileId, row.id);

  const bare = stand(null).store;
  assert.equal(bare.list('files').some((r) => r.state === 'syllabus'), false);
  assert.equal(bare.list('syllabi').every((v) => v.fileId === ''), true);
  assert.equal(seedSyllabusFile(bare, createNodePlatform(), null), undefined);
  assert.equal(bare.list('files').length, 0);
});

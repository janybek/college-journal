import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllabusFor } from '../core/syllabus.js';
import { syllabusState } from '../core/dirInfo.js';
import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { setup } from './linesSetup.js';

// sb1 (t1) and sb2 (t2) have their own syllabi; then t2 leaves its own line and joins the line of t1.
function shared() {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  s.publish(s.sb2, s.FILE_B);
  const own = s.lineOf('t2');
  const line1 = s.lineOf('t1');
  const row = s.store.list('syllabusMembers').find((m) => m.lineId === own.id && m.teacherId === s.ids.t2);
  s.store.update('syllabusMembers', row.id, { state: 'left', endedAt: '2026-09-01 11:00:00', endedBy: s.ids.t2 });
  s.share(line1.id, 't2');
  assert.deepEqual(s.call('schedule.generate', {}, s.t.dean).ok, true);
  return { s, line1, own, row };
}
const names = (s, subjectId, token) => s.call('journal.get', { subjectId }, token).data.journal.pairs.map((p) => p.topicName).filter(Boolean);

test('every module finds the syllabus of a group by the line of its teacher', () => {
  const { s } = shared();
  assert.equal(names(s, s.sb2, s.t.t2)[0], 'А1');
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  assert.equal(s.call('ledger.list', {}, s.t.t2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, true);
  assert.equal(s.call('student.grades', {}, s.t.s2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, true);
  assert.deepEqual(s.call('teacher.mySubjects', {}, s.t.t2).data.subjects[0].syllabus, { approved: true, open: null });
  assert.equal(s.call('subjects.overview', {}, s.t.dean).data.rows.find((r) => r.teacherId === s.ids.t2).syllabusStatus, 'approved');
  assert.deepEqual(s.call('dir.summary', { table: 'disciplines' }, s.t.dean).data.rows.find((r) => r.id === s.ds1).syllabi, { approved: 1, review: 0, returned: 0, draft: 0, none: 1 });
  assert.equal(s.call('work.list', { subjectId: s.sb2 }, s.t.t2).ok, true);
  assert.notEqual(s.call('work.list', { subjectId: s.sb2 }, s.t.t2).error?.code, 'no_syllabus');
  assert.deepEqual(s.oneJoined(), []);
});

test('a missing members list is a programming error, not a silent «no syllabus»', () => {
  const s = setup();
  assert.throws(() => syllabusFor({ disciplineId: s.ds1, teacherId: s.ids.t1 }, s.store.list('syllabi'), 1), TypeError);
  assert.throws(() => syllabusState(s.store.list('syllabi'), { disciplineId: s.ds1, teacherId: s.ids.t1, semester: 1 }, { id: s.ids.dean, roles: ['dean'] }), TypeError);
});

test('a member who left loses the topics at the next layout', () => {
  const { s, line1 } = shared();
  const joined = s.store.list('syllabusMembers').find((m) => m.lineId === line1.id && m.teacherId === s.ids.t2);
  s.store.update('syllabusMembers', joined.id, { state: 'left', endedAt: '2026-09-02 10:00:00', endedBy: s.ids.t2 });
  s.call('schedule.generate', {}, s.t.dean);
  assert.deepEqual(s.topicsOf(s.sb2).filter(Boolean), []);
  assert.equal(s.call('ledger.list', {}, s.t.t2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, false);
});

test('shifting the semester end keeps the shared topics', () => {
  const { s } = shared();
  const settings = s.call('settings.get', {}, s.t.dean).data.settings;
  assert.equal(s.call('settings.save', { settings: { ...settings, semesterEnd: '2026-12-19' } }, s.t.dean).ok, true);
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
});

test('a new teacher of a group follows the syllabus of his own line', () => {
  const { s } = shared();
  const row = s.store.list('subjects').find((x) => x.id === s.sb3);
  assert.equal(s.call('dir.save', { table: 'subjects', row: { ...row, teacherId: s.ids.t2 } }, s.t.dean).ok, true);
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');
  assert.equal(s.call('dir.save', { table: 'subjects', row: { ...row, teacherId: s.ids.t5 } }, s.t.dean).ok, true);
  assert.deepEqual(s.topicsOf(s.sb3).filter(Boolean), []);
});

test('the journal results and the works of a group on a shared syllabus work', () => {
  const { s } = shared();
  assert.equal(s.call('journal.get', { subjectId: s.sb2 }, s.t.t2).ok, true);
  assert.notEqual(s.call('journal.saveResults', { subjectId: s.sb2, unit: 1, field: 'self', items: [] }, s.t.t2).error?.code, 'no_syllabus');
});

test('the old keys give the same answers before and after the transfer', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  s.publish(s.sb2, s.FILE_B);
  const ask = () => ({
    journal: s.call('journal.get', { subjectId: s.sb1 }, s.t.t1), ledger: s.call('ledger.list', {}, s.t.t1),
    grades: s.call('student.grades', {}, s.t.s1), mine: s.call('teacher.mySubjects', {}, s.t.t2),
  });
  const before = ask();
  applyLinesUpgrade(s.store, s.platform);
  assert.deepEqual(ask(), before);
});

test('every list is read once per request, the members once', () => {
  const { s } = shared();
  const settings = s.call('settings.get', {}, s.t.dean).data.settings;
  const requests = [
    ['journal.get', { subjectId: s.sb2 }, s.t.t2], ['ledger.list', {}, s.t.t2], ['work.list', { subjectId: s.sb2 }, s.t.t2],
    ['student.grades', {}, s.t.s2], ['subjects.overview', {}, s.t.dean], ['dir.summary', { table: 'disciplines' }, s.t.dean],
    ['settings.save', { settings: { ...settings, semesterEnd: '2026-12-18' } }, s.t.dean], ['schedule.generate', {}, s.t.dean],
  ];
  for (const [action, data, token] of requests) {
    s.spy.reset();
    assert.equal(s.call(action, data, token).ok, true, action);
    assert.ok(Object.values(s.spy.lists).every((n) => n === 1), `${action}: ${JSON.stringify(s.spy.lists)}`);
    assert.ok((s.spy.lists.syllabusMembers ?? 1) === 1, action);
  }
  s.spy.reset();
  s.call('journal.get', { subjectId: s.sb2 }, s.t.t2);
  assert.equal(s.spy.lists.syllabusMembers, 1);
});

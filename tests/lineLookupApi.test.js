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
// The answers the old code (the key «discipline + teacher + half») gave on this base; the transfer must not change them.
const EXPECTED = {
  get1: ['approved', 1, 'draft', ['А1', 'А2', 'А3']], get1open: ['open', 1, 'draft', []], get2: ['approved', null, 'review', null],
  journal: [[true, ['А1', 'А2', 'А3']], [false, []], [false, []]],
  ledger: [true, false, false, false],
  grades: [[['Анатомия', true], ['Химия', false]], [['Анатомия', false]], [['Анатомия', false]]],
  mySubjects: [[{ approved: true, open: 'draft' }], [{ approved: false, open: 'review' }], [{ approved: false, open: null }]],
  overview: [['Анатомия', 'Сотрудник t1', 'approved', 'draft', false, 3], ['Анатомия', 'Сотрудник t2', 'none', 'review', true, 0],
    ['Анатомия', 'Сотрудник t3', 'none', null, false, 0], ['Химия', 'Сотрудник t4', 'none', null, false, 0]],
  summary: [['ds1', { approved: 1, review: 1, returned: 0, draft: 1, none: 1 }], ['ds2', { approved: 0, review: 0, returned: 0, draft: 0, none: 1 }]],
};
const names = (s, subjectId, token) => s.call('journal.get', { subjectId }, token).data.journal.pairs.map((p) => p.topicName).filter(Boolean);

test('every module finds the syllabus of a group by the line of its teacher', () => {
  const { s } = shared();
  assert.equal(names(s, s.sb2, s.t.t2)[0], 'А1');
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  assert.equal(s.call('ledger.list', {}, s.t.t2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, true);
  assert.equal(s.call('student.grades', {}, s.t.s2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, true);
  assert.deepEqual(s.call('teacher.mySubjects', {}, s.t.t2).data.subjects[0].syllabus, { approved: true, open: null, shared: true, members: 2 });
  assert.equal(s.call('subjects.overview', {}, s.t.dean).data.rows.find((r) => r.teacherId === s.ids.t2).syllabusStatus, 'approved');
  assert.deepEqual(s.call('dir.summary', { table: 'disciplines' }, s.t.dean).data.rows.find((r) => r.id === s.ds1).syllabi, { approved: 1, review: 0, returned: 0, draft: 0, none: 1, shared: 1 });
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

// A base as the old code left it: versions and topics inserted straight into the store, with no line and no member.
function oldBase() {
  const s = setup();
  const version = (key, semester, status, number) => s.store.insert('syllabi', {
    disciplineId: s.ds1, teacherId: s.ids[key], semester, planSemester: semester, status, version: number, course: 1,
  }).id;
  const topics = (syllabusId, prefix) => [1, 2, 3].forEach((order) => s.store.insert('topics', {
    syllabusId, order, unit: 1, lessonKind: 'lecture', name: prefix + order, hours: 2, description: '',
  }));
  topics(version('t1', 1, 'approved', 1), 'А');   // t1: an approved one and a draft after it
  version('t1', 1, 'draft', 2);
  version('t2', 1, 'review', 1);                    // t2: only a version under review in the autumn, an approved one in the spring
  topics(version('t2', 2, 'approved', 1), 'Б');     // t3 and t4 have no syllabus
  return s;
}

// What each person sees, reduced to what a screen shows (no ids).
function answers(s) {
  const get = (subjectId, data = {}) => s.call('syllabus.get', { subjectId, ...data }, s.t.dean).data;
  const page = (d) => [d.shown, d.state.approved && d.state.approved.version, d.state.open && d.state.open.status, d.syllabus ? d.syllabus.rows.map((r) => r.name) : null];
  const mine = (key) => s.call('teacher.mySubjects', {}, s.t[key]).data.subjects.map((x) => x.syllabus);
  const has = (list) => list.map((x) => [x.name, x.hasSyllabus]);
  return {
    get1: page(get(s.sb1)), get1open: page(get(s.sb1, { version: 'open' })), get2: page(get(s.sb2)),
    journal: ['sb1', 'sb2', 'sb3'].map((k) => { const j = s.call('journal.get', { subjectId: s[k] }, s.t.dean).data.journal; return [j.subject.hasSyllabus, j.pairs.map((p) => p.topicName).filter(Boolean)]; }),
    ledger: [s.sb1, s.sb2, s.sb3, s.sb4].map((id) => s.call('ledger.list', {}, s.t.dean).data.subjects.find((x) => x.subjectId === id).hasSyllabus),
    grades: ['s1', 's2', 's3'].map((k) => has(s.call('student.grades', {}, s.t[k]).data.subjects)),
    mySubjects: [mine('t1'), mine('t2'), mine('t3')],
    overview: s.call('subjects.overview', {}, s.t.dean).data.rows.map((r) => [r.disciplineName, r.teacherName, r.syllabusStatus, r.open, r.otherSemester, r.plannedPairs]),
    summary: s.call('dir.summary', { table: 'disciplines' }, s.t.dean).data.rows.map((r) => [r.id === s.ds1 ? 'ds1' : 'ds2', r.syllabi]).sort(),
  };
}

test('the transfer of a base made by the old code keeps what every screen shows', () => {
  const s = oldBase();
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === '').length, 4);
  assert.deepEqual([s.store.list('syllabusLines').length, s.store.list('syllabusMembers').length], [0, 0]);
  applyLinesUpgrade(s.store, s.platform);
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === '').length, 0);
  assert.deepEqual(s.oneJoined(), []);
  assert.equal(s.call('schedule.generate', {}, s.t.dean).ok, true);
  assert.deepEqual(answers(s), EXPECTED);
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
    assert.equal(s.spy.lists.syllabusMembers, 1, action);
  }
  s.spy.reset();
  s.call('journal.get', { subjectId: s.sb2 }, s.t.t2);
  assert.equal(s.spy.lists.syllabusMembers, 1);
});

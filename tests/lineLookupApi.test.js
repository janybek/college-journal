import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syllabusFor } from '../core/syllabus.js';
import { syllabusState } from '../core/dirInfo.js';
import { setup } from './linesSetup.js';

const names = (s, subjectId, token) => s.call('journal.get', { subjectId }, token).data.journal.pairs.map((p) => p.topicName).filter(Boolean);

// Every module finds the syllabus of a group through the syllabus of the discipline: sb2 and sb3 have no syllabus of their own.
test('every module finds the syllabus of a group by the syllabus of its discipline', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  assert.deepEqual(s.oneMain(), []);
  assert.deepEqual(names(s, s.sb2, s.t.t2).slice(0, 3), ['А1', 'А2', 'А3']);
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');
  for (const [sb, who] of [[s.sb2, 't2'], [s.sb3, 't3']]) {
    assert.equal(s.call('journal.get', { subjectId: sb }, s.t[who]).data.journal.subject.hasSyllabus, true);
    assert.equal(s.call('ledger.list', {}, s.t[who]).data.subjects.find((x) => x.subjectId === sb).hasSyllabus, true);
    assert.equal(s.call('work.list', { subjectId: sb }, s.t[who]).ok, true);
    assert.notEqual(s.call('work.list', { subjectId: sb }, s.t[who]).error?.code, 'no_syllabus');
  }
  assert.equal(s.call('student.grades', {}, s.t.s2).data.subjects.find((x) => x.subjectId === s.sb2).hasSyllabus, true);
  assert.deepEqual(s.call('teacher.mySubjects', {}, s.t.t2).data.subjects[0].syllabus, { approved: true, open: null, mine: 'teaches' });
  const overview = s.call('subjects.overview', {}, s.t.dean).data.rows;
  assert.deepEqual(overview.filter((r) => r.disciplineId === s.ds1).map((r) => r.syllabusStatus), ['approved', 'approved', 'approved']);
  assert.deepEqual(s.call('dir.summary', { table: 'disciplines' }, s.t.dean).data.rows.find((r) => r.id === s.ds1).syllabi, { approved: 1, review: 0, returned: 0, draft: 0, none: 0 });
});

test('a missing list of the syllabi of the disciplines is a programming error, not a silent «no syllabus»', () => {
  const s = setup();
  assert.throws(() => syllabusFor({ disciplineId: s.ds1, teacherId: s.ids.t1 }, s.store.list('syllabi'), 1), TypeError);
  assert.throws(() => syllabusState(s.store.list('syllabi'), { disciplineId: s.ds1, teacherId: s.ids.t1, semester: 1 }, { id: s.ids.dean, roles: ['dean'] }), TypeError);
});

test('a new subject and a new teacher of a group: the group follows the syllabus of the discipline, nothing is written to the table of the syllabi of disciplines', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const lines = s.store.list('syllabusLines');
  s.spy.reset();
  const g4 = s.store.insert('groups', { name: '04-1', course: 1 }).id;
  const added = s.call('subjects.add', { disciplineId: s.ds1, items: [{ teacherId: s.ids.t5, groupId: g4 }] }, s.t.dean);
  assert.equal(added.ok, true, JSON.stringify(added));
  const sb5 = s.store.list('subjects').find((x) => x.groupId === g4).id;
  assert.equal(s.call('ledger.list', {}, s.t.t5).data.subjects.find((x) => x.subjectId === sb5).hasSyllabus, true);
  const row = s.store.list('subjects').find((x) => x.id === s.sb3);
  assert.equal(s.call('dir.save', { table: 'subjects', row: { ...row, teacherId: s.ids.t5 } }, s.t.dean).ok, true);
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');
  assert.deepEqual(Object.keys(s.spy.writes).filter((k) => k.endsWith(':syllabusLines')), []);
  assert.deepEqual(s.store.list('syllabusLines'), lines);
});

test('shifting the semester end keeps the topics of every group of the discipline', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  const settings = s.call('settings.get', {}, s.t.dean).data.settings;
  assert.equal(s.call('settings.save', { settings: { ...settings, semesterEnd: '2026-12-19' } }, s.t.dean).ok, true);
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  assert.equal(s.call('journal.saveResults', { subjectId: s.sb2, unit: 1, field: 'self', items: [] }, s.t.t2).error?.code === 'no_syllabus', false);
});

// A base as the earlier code left it: versions and topics inserted straight into the store, with no line.
function oldBase() {
  const s = setup();
  const topics = (versionId) => s.store.list('topics').filter((x) => x.syllabusId === versionId);
  const t1 = s.old(s.sb1, s.FILE_A);                                         // t1: an approved one and a draft after it
  s.old(s.sb1, s.FILE_A, { status: 'draft', version: 2 });
  s.old(s.sb2, s.FILE_B, { status: 'review' });                              // t2: a version under review in the autumn, an approved one in the spring
  s.old(s.sb2, s.FILE_B, { semester: 2 });
  assert.equal(topics(t1).length > 0, true);
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

const ROWS = ['А1', 'А2', 'А3', '', 'А4', 'А5', ''];                       // the rows of the plan (the modules have no name)
const AUTUMN = ['А1', 'А2', 'А3', 'А4', 'А5'];                             // the topics of the pairs

test('the transfer of a base made by the earlier code: what changes is what the rules of the transfer say', () => {
  const s = oldBase();
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === '').length, 4);
  assert.deepEqual(s.store.list('syllabusLines'), []);
  // the answers of the earlier code on this base are written in the test of the journal of that code: sb1 sees its approved version and a draft after it,
  // sb2 and sb3 have no syllabus (nothing is laid) and t2 has a version under review
  const [first] = s.store.list('pairs').filter((p) => p.subjectId === s.sb1);
  s.hold(s.sb1, first.date);
  s.upgrade();
  assert.equal(s.call('schedule.generate', {}, s.t.dean).ok, true);
  assert.deepEqual(s.oneMain(), []);
  assert.equal(s.store.list('syllabi').filter((v) => v.lineId === '').length, 0);
  // the version of t2 under review lies in the archive now: it is gone from the queue (it is the rule of the transfer: a loser is not kept open)
  assert.deepEqual(s.call('syllabus.queue', {}, s.t.dean).data.rows, []);
  assert.deepEqual(answers(s), {
    // without changes for sb1: its approved version, the draft after it, the topics of its pairs
    get1: ['approved', 1, 'draft', ROWS], get1open: ['open', 1, 'draft', ROWS],
    // changes: sb2 follows the syllabus of the discipline now (the version of t2 under review is in the archive), so its topics are «А»
    get2: ['approved', 1, 'draft', ROWS],               // the draft of t1 is the open version of the syllabus of the discipline for everybody who may see it
    journal: [[true, AUTUMN], [true, AUTUMN], [true, AUTUMN]],
    ledger: [true, true, true, false],
    grades: [[['Анатомия', true], ['Химия', false]], [['Анатомия', true]], [['Анатомия', true]]],
    mySubjects: [[{ approved: true, open: 'draft', mine: 'responsible' }], [{ approved: true, open: 'draft', mine: 'teaches' }], [{ approved: true, open: 'draft', mine: 'teaches' }]],
    // changes: the spring syllabus of t2 became the spring syllabus of the discipline, so every row of the discipline has «other semester»
    overview: [['Анатомия', 'Сотрудник t1', 'approved', 'draft', true, 5], ['Анатомия', 'Сотрудник t2', 'approved', 'draft', true, 5],
      ['Анатомия', 'Сотрудник t3', 'approved', 'draft', true, 5], ['Химия', 'Сотрудник t4', 'none', null, false, 0]],
    summary: [['ds1', { approved: 1, review: 0, returned: 0, draft: 1, none: 0 }], ['ds2', { approved: 0, review: 0, returned: 0, draft: 0, none: 1 }]],
  });
  // the held pair of sb1 had no topic (the earlier code laid nothing without a line): it gets the next topic like a future pair; a held pair with a topic is in the test of the transfer
  const held = s.store.list('pairs').find((p) => p.id === first.id);
  assert.deepEqual([held.status, held.lessonType, held.part, held.topicId !== ''], ['closed', 'lecture', 1, true]);
});

test('every list is read once per request, the syllabi of the disciplines once', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
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
    assert.equal(s.spy.lists.syllabusLines, 1, action);
  }
});

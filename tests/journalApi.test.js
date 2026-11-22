import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

const journalOf = (s, subjectId, token) => s.call('journal.get', { subjectId }, token).data.journal;

test('journal.get: students, pairs, units, points, marks and rights of the teacher', () => {
  const s = setup();
  const { call, t, a1, a2, a3, sb1, p0908 } = s;
  const j = journalOf(s, sb1, t.teacher1);
  assert.deepEqual(j.students.map((x) => x.fullName), ['Асанов Айдар', 'Ёлкин Бакыт', 'Өмүров Канат']);
  assert.deepEqual(j.pairs.slice(0, 5).map((p) => [p.date, p.status, p.unit, p.lessonType, p.first, p.counts]),
    [['2026-09-01', 'closed', 1, 'lecture', true, true], ['2026-09-08', 'closed', 1, 'practice', false, true], ['2026-09-15', 'planned', 2, 'lecture', false, false],
      ['2026-09-22', 'planned', 2, 'practice', false, false], ['2026-09-29', 'planned', 2, 'control', false, false]]);
  assert.deepEqual(j.units, [{ unit: 1, title: '' }, { unit: 2, title: '' }]);
  assert.deepEqual([j.results[a1].units[0].current, j.results[a2].units[0].current, j.results[a3].units[0].current], [38, 20, 0]);
  assert.deepEqual(j.marks[p0908][a1], { status: 'present', noCoat: false, activity: 7, source: 'teacher', markedAt: '2026-09-08 08:10:00' });
  assert.deepEqual([j.partial, j.can], [false, { results: true, manage: false }]);
  assert.deepEqual([j.subject.planSemester, j.subject.hasSyllabus], [1, true]);
  assert.deepEqual([j.subject.semester, j.subject.groupName, j.subject.teacherName], [1, '01-1', 'Иванова Нургуль']);
  assert.deepEqual(j.scheme, DEFAULT_SCHEME);
  assert.equal(call('journal.get', { subjectId: sb1 }, t.dean).data.journal.can.manage, true);
  assert.deepEqual(call('journal.get', { subjectId: sb1 }, t.prorector).data.journal.can, { results: false, manage: false });
  assert.equal(call('journal.get', { subjectId: sb1 }, t.prorector).data.journal.partial, false);
});

test('journal.get: state and mode by the clock', () => {
  const s = setup();
  const { t, at, sb1 } = s;
  at('2026-09-08', '08:05');
  const states = (token) => journalOf(s, sb1, token).pairs.slice(0, 3);
  assert.deepEqual(states(t.teacher1).map((p) => [p.state, p.mode]), [['late', 'limited'], ['open', 'free'], ['future', 'none']]);
  assert.deepEqual(states(t.dean).map((p) => p.mode), ['reason', 'reason', 'none']);
  assert.deepEqual(states(t.prorector).map((p) => p.mode), ['none', 'none', 'none']);
});

test('journal.get: a foreign subject, a substitute, a student and bad ids', () => {
  const s = setup();
  const { call, t, sb1, store } = s;
  assert.equal(call('journal.get', { subjectId: sb1 }, t.teacher2).error.code, 'forbidden');
  const part = journalOf(s, sb1, t.teacher3);
  assert.deepEqual([part.partial, part.pairs.map((p) => p.date), part.results, part.units, part.can], [true, ['2026-09-15'], {}, [], { results: false, manage: false }]);
  assert.equal(part.pairs[0].substitution, true);
  assert.deepEqual(Object.keys(part.marks), []);
  assert.equal(JSON.stringify(part).includes('"activity":7'), false);
  assert.equal(call('journal.get', { subjectId: sb1 }, t.a1).error.code, 'forbidden');
  for (const bad of [[sb1], 5, ` ${sb1} `, null, { id: sb1 }, undefined]) assert.equal(call('journal.get', { subjectId: bad }, t.dean).error.code, 'not_found', JSON.stringify(bad));
  assert.equal(call('journal.get', { subjectId: 'sb_999' }, t.teacher1).error.code, 'not_found');
  const text = JSON.stringify(call('journal.get', { subjectId: sb1 }, t.dean).data);
  for (const word of ['passwordHash', 'cardNo', 'login', 'markedBy', 'Беков']) assert.equal(text.includes(word), false, word);
  const partText = JSON.stringify(call('journal.get', { subjectId: sb1 }, t.teacher3).data);
  for (const word of ['passwordHash', 'cardNo', 'login', 'markedBy', 'Беков']) assert.equal(partText.includes(word), false, word);
  // a substitute who has a pair only outside the semester sees nothing
  store.update('pairs', s.p0915, { teacherId: s.ids.teacher1 });
  assert.equal(call('journal.get', { subjectId: sb1 }, t.teacher3).error.code, 'forbidden');
});

test('journal.get: a left student, two rows of one mark, a subject without a syllabus', () => {
  const s = setup();
  const { store, t, ids, sb1, sb2, a1, a4, b1, p0901, p0908 } = s;
  store.insert('attendance', { pairId: p0901, studentId: a4, status: 'present', source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-01 08:10:00' });
  const j = journalOf(s, sb1, t.teacher1);
  assert.deepEqual(j.students.map((x) => [x.fullName, x.left]).at(-1), ['Яковлев Улан', true]);
  assert.equal(j.students.filter((x) => !x.left).length, 3);
  // the later of two rows wins
  store.insert('attendance', { pairId: p0908, studentId: a1, status: 'absent', activity: null, source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-08 09:00:00' });
  assert.equal(journalOf(s, sb1, t.teacher1).marks[p0908][a1].status, 'absent');
  assert.equal(Object.keys(journalOf(s, sb1, t.teacher1).marks[p0908][a1]).includes('markedBy'), false);
  // the subject without a syllabus
  const k = journalOf(s, sb2, t.teacher2);
  assert.deepEqual([k.subject.hasSyllabus, k.subject.planSemester, k.units], [false, null, []]);
  assert.equal(k.marks[s.q0911][b1].activity, 3);
  assert.deepEqual(k.results[b1].outside, { earned: 43, possible: 50 });
  assert.equal(k.pairs.every((p) => p.unit === null && p.topicName === '' && p.number === ''), true);
});

test('journal.get: the unit rows are read by subject, student and plan semester', () => {
  const s = setup();
  const { store, t, a1, a2, ids, sb1, sb2 } = s;
  store.insert('unitResults', { subjectId: sb1, studentId: a1, planSemester: 1, unit: 1, control: 30, self: 10, currentManual: 36, updatedBy: ids.teacher1, updatedAt: '2026-09-09 10:00:00' });
  store.insert('unitResults', { subjectId: sb1, studentId: a2, planSemester: 2, unit: 1, control: 40, self: 20, updatedBy: ids.teacher1, updatedAt: '2026-09-09 10:00:00' });
  store.insert('unitResults', { subjectId: sb2, studentId: a2, planSemester: 1, unit: 1, control: 40, self: 20, updatedBy: ids.teacher2, updatedAt: '2026-09-09 10:00:00' });
  const j = journalOf(s, sb1, t.teacher1);
  assert.deepEqual([j.results[a1].units[0].control, j.results[a1].units[0].self, j.results[a1].units[0].manual, j.results[a1].units[0].total], [30, 10, 36, 76]);
  assert.equal(j.results[a2].units[0].control, null);
});

test('journal.get: the numbers are recounted after the scheme changes', () => {
  const s = setup();
  const { call, t, a1, sb1 } = s;
  call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5 } }, t.dean);
  const u = journalOf(s, sb1, t.teacher1).results[a1].units[0];
  assert.deepEqual([u.possible, u.current], [45, 40]);
  call('scoring.save', { scheme: { ...DEFAULT_SCHEME } }, t.dean);
  assert.equal(journalOf(s, sb1, t.teacher1).results[a1].units[0].current, 38);
});

test('journal.get: each table is read once and nothing is written', () => {
  const s = setup();
  s.spy.reset();
  s.call('journal.get', { subjectId: s.sb1 }, s.t.teacher1);
  for (const table of JOURNAL_TABLES) assert.equal(s.spy.lists[table], 1, table);
  assert.deepEqual(Object.keys(s.spy.writes), []);
});

test('journal.get: the semester dates cut the pairs; the settings are read as settings', () => {
  const s = setup();
  s.call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-09-20', holidays: [], bells: ['08:00', '09:40', '11:20', '13:30', '15:10', '16:50'], semester: 1 } }, s.t.dean);
  const dates = journalOf(s, s.sb1, s.t.teacher1).pairs.map((p) => p.date);
  assert.deepEqual(dates, ['2026-09-01', '2026-09-08', '2026-09-15']);
  // the lessons are still on the pairs: the journal read does not drop the topics
  assert.equal(journalOf(s, s.sb1, s.t.teacher1).pairs[2].topicName, 'Тема 3');
  assert.equal(journalOf(s, s.sb1, s.t.teacher1).pairs[2].number, 2);
});

test('journal.get: the former teacher of a subject sees only his own pairs, partly', () => {
  const s = setup();
  const { store, t, ids, sb1, p0915 } = s;
  store.update('subjects', sb1, { teacherId: ids.teacher2 });
  store.update('pairs', p0915, { teacherId: ids.teacher1, substitute: false });
  const j = journalOf(s, sb1, t.teacher1);
  assert.deepEqual([j.partial, j.results, j.units, j.can], [true, {}, [], { results: false, manage: false }]);
  assert.equal(j.pairs.length > 0 && j.pairs.every((p) => p.teacherId === ids.teacher1), true);
  assert.deepEqual(Object.keys(j.marks).sort(), [s.p0901, s.p0908].sort());
  assert.equal(journalOf(s, sb1, t.teacher2).partial, false);
});

test('journal.get: a left student does not change the results of the others', () => {
  const s = setup();
  const { store, t, ids, sb1, a1, a2, a3, a4, p0901, p0908 } = s;
  const before = journalOf(s, sb1, t.teacher1);
  store.insert('attendance', { pairId: p0901, studentId: a4, status: 'present', noCoat: false, activity: null, source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-01 08:10:00' });
  store.insert('attendance', { pairId: p0908, studentId: a4, status: 'present', noCoat: false, activity: 9, source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-08 08:10:00' });
  const after = journalOf(s, sb1, t.teacher1);
  assert.equal(after.students.at(-1).left, true);
  for (const id of [a1, a2, a3]) assert.deepEqual(after.results[id], before.results[id]);
});

// ---- journal.list

// A third subject: Информатика of teacher1 in the group 02-1, Wednesdays; its pair of 02.09 is past, of 09.09 is ahead at 08.09.
function withSb3(s) {
  const sb3 = s.store.insert('subjects', { name: 'Информатика', disciplineId: s.ds1, groupId: s.g2, teacherId: s.ids.teacher1, scheme: 'A' }).id;
  s.store.insert('weekTemplate', { weekday: 3, slot: 1, subjectId: sb3, roomId: '' });
  s.call('schedule.generate', {}, s.t.dean);
  return sb3;
}

test('journal.list: counters, rights and the rows of a substitute', () => {
  const s = setup();
  const { call, t, at } = s;
  withSb3(s);
  at('2026-09-08', '08:05');
  assert.deepEqual(call('journal.list', {}, t.teacher1).data.subjects.map((x) => [x.groupName, x.name, x.own, x.held, x.unfilled, x.overdue]),
    [['01-1', 'Информатика', true, 2, 0, 0], ['02-1', 'Информатика', true, 0, 1, 1]]);
  assert.deepEqual(call('journal.list', {}, t.teacher3).data.subjects.map((x) => [x.name, x.own, x.covers, x.held, x.unfilled, x.overdue]), [['Информатика', false, true, 0, 0, 0]]);
  at('2026-09-20', '09:00');
  assert.deepEqual(call('journal.list', {}, t.teacher3).data.subjects.map((x) => [x.held, x.unfilled, x.overdue]), [[0, 1, 1]]);
  assert.equal(call('journal.list', {}, t.teacher2).data.subjects.length, 1);
  assert.deepEqual(call('journal.list', {}, t.dean).data.subjects.map((x) => x.groupName), ['01-1', '02-1', '02-1']);
  assert.equal(call('journal.list', {}, t.prorector).data.subjects.length, 3);
  assert.equal(call('journal.list', {}, t.a1).error.code, 'forbidden');
  assert.equal(typeof call('journal.list', {}, t.dean).data.today, 'string');
  const text = JSON.stringify(call('journal.list', {}, t.teacher3).data);
  for (const word of ['passwordHash', 'login', 'Анатомия']) assert.equal(text.includes(word), false, word);
});

test('journal.list: a former teacher is a substitute row; the dean who teaches sees all', () => {
  const s = setup();
  const { call, store, t, ids, sb1, at } = s;
  store.update('subjects', sb1, { teacherId: ids.teacher2 });
  at('2026-09-20', '09:00');
  const row = call('journal.list', {}, t.teacher1).data.subjects.find((x) => x.subjectId === sb1);
  assert.deepEqual([row.own, row.covers, row.teacherName], [false, true, 'Петров Эрмек']);
  assert.equal(row.held, 2);                           // his own pairs: the two closed ones
  assert.equal(call('journal.list', {}, t.dean).data.subjects.length, 2);
});

test('journal.list: each table is read once and nothing is written', () => {
  const s = setup();
  s.spy.reset();
  s.call('journal.list', {}, s.t.dean);
  for (const table of JOURNAL_TABLES) assert.equal(s.spy.lists[table] <= 1, true, table);
  assert.deepEqual(Object.keys(s.spy.writes), []);
});

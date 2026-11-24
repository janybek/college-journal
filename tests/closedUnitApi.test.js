import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { WORK_TABLES } from '../backend/workData.js';
import { LESSON_TABLES } from '../backend/lessonData.js';
import { SAMPLE, b64 } from './fakes/sampleFiles.js';

// A closed unit and a closed final sheet are not changed by anybody directly. Fictional people only.
const without = (snap, ...keys) => Object.fromEntries(Object.entries(snap).filter(([k]) => !keys.includes(k)));

test('journal.get: the pairs of a closed unit are shut, the units stay as they were; every direct write is refused', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const j = s.call('journal.get', { subjectId: s.sb1 }, s.t.teacher1).data.journal;
  assert.deepEqual([j.closed, j.canRequest, j.can], [{ units: [1], final: false }, true, { results: true, manage: false }]);
  assert.deepEqual(j.pairs.filter((p) => p.unit === 1).map((p) => p.mode), ['none', 'none']);
  assert.deepEqual(j.pairs.filter((p) => p.unit === 1).map((p) => p.lesson), [null, null]);
  assert.notDeepEqual(j.pairs.filter((p) => p.unit === 2).map((p) => p.mode), ['none', 'none', 'none']);
  assert.deepEqual(j.units, [{ unit: 1, title: '' }, { unit: 2, title: '' }]);
  assert.equal(s.call('journal.get', { subjectId: s.sb1 }, s.t.dean).data.journal.canRequest, false);
  assert.deepEqual(s.call('journal.get', { subjectId: s.sb2 }, s.t.teacher2).data.journal.closed, { units: [], final: false });

  const before = s.snapshot();
  const mark = { studentId: s.a2, status: 'excused', noCoat: false, activity: null };
  for (const who of ['teacher1', 'dean', 'admin']) assert.equal(s.call('journal.savePair', { pairId: s.p0901, marks: [mark], reason: 'справка' }, s.t[who]).error.code, 'unit_closed');
  // a substituting teacher gets the same answer on the pair he leads (unit 2 is open, so the pair of unit 1 is still not his: forbidden comes first)
  assert.equal(s.call('journal.savePair', { pairId: s.p0901, marks: [mark], reason: 'справка' }, s.t.teacher3).error.code, 'forbidden');
  for (const field of ['control', 'self', 'current']) {
    for (const who of ['teacher1', 'dean', 'admin']) {
      assert.equal(s.call('journal.saveResults', { subjectId: s.sb1, unit: 1, field, items: [{ studentId: s.a2, value: 30 }], reason: 'x' }, s.t[who]).error.code, 'unit_closed');
    }
  }
  assert.equal(s.call('journal.reopenPair', { pairId: s.p0901, reason: 'x' }, s.t.dean).error.code, 'unit_closed');
  assert.equal(s.call('journal.reopenPair', { pairId: s.p0901, reason: 'x' }, s.t.admin).error.code, 'unit_closed');
  assert.deepEqual(s.snapshot(), before);
});

test('journal: an open unit and a pair without a topic work as before', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const before = s.snapshot();
  assert.equal(s.call('journal.saveResults', { subjectId: s.sb1, unit: 2, field: 'self', items: [{ studentId: s.a1, value: 10 }] }, s.t.teacher1).ok, true);
  assert.notDeepEqual(s.snapshot(), before);
  // a pair without a topic belongs to no unit
  const free = s.pairOf(s.sb1, '2026-09-22');
  s.store.update('pairs', free.id, { topicId: '' });
  s.store.update('pairs', free.id, { status: 'planned' });
  const res = s.call('journal.savePair', {
    pairId: free.id, marks: [s.a1, s.a2, s.a3].map((studentId) => ({ studentId, status: 'present', noCoat: false, activity: null })), reason: 'не успел',
  }, s.t.dean);
  assert.deepEqual(res.error, undefined);
  // a pair of unit 2 (open) can be marked
  const p2 = s.pairOf(s.sb1, '2026-09-15');
  assert.equal(s.call('journal.savePair', { pairId: p2.id, marks: [s.a1, s.a2, s.a3].map((studentId) => ({ studentId, status: 'present', noCoat: false, activity: null })), reason: 'не успел' }, s.t.dean).ok, true);
});

test('scoring.save: the points of a pair and a unit are fixed once a unit is closed; the word and the split once the final is closed', () => {
  const s = setup();
  s.at('2026-09-30');
  s.closeUnit(1);
  const before = s.snapshot();
  for (const over of [{ activity: 5 }, { minimum: 20 }, { current: 50, control: 30 }]) {
    assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, ...over } }, s.t.dean).error.code, 'units_closed');
    assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, ...over } }, s.t.admin).error.code, 'units_closed');
  }
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 5 } }, s.t.dean).ok, true);
  // the words and the split: with only a unit closed they can still be changed
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 5, good: 76 }, split: { semester: 50, exam: 50, admission: 25 } }, s.t.dean).ok, true);
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 5 }, split: { ...DEFAULT_SPLIT } }, s.t.dean).ok, true);
  // a request without `split` does not touch the split
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 5 } }, s.t.dean).ok, true);
});

test('scoring.save: the closed final sheet fixes the thresholds and the split; reopening and the last half year free them', () => {
  const s = setup();
  s.allUnits();
  const finalId = s.closeFinal();
  const before = s.snapshot();
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, good: 76 } }, s.t.dean).error.code, 'final_closed');
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, fair: 55 } }, s.t.admin).error.code, 'final_closed');
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME }, split: { semester: 50, exam: 50, admission: 25 } }, s.t.dean).error.code, 'final_closed');
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5 } }, s.t.dean).error.code, 'units_closed');
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5, good: 76 } }, s.t.dean).error.code, 'units_closed');
  assert.deepEqual(s.snapshot(), before);
  // the same numbers, with or without the same split, and the days of the term
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 7 } }, s.t.dean).ok, true);
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 7 }, split: { ...DEFAULT_SPLIT } }, s.t.dean).ok, true);
  assert.deepEqual(without(s.snapshot(), 'settings'), without(before, 'settings'));
  assert.deepEqual(s.store.list('settings').filter((r) => r.key === 'journalEditDays').map((r) => r.value), ['7']);
  // the final sheet opened again: the thresholds can be changed
  s.store.update('closures', finalId, { reopenedAt: '2026-12-17 10:00:00', reopenedBy: s.ids.admin });
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 7, good: 76 } }, s.t.dean).ok, true);
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, editDays: 7, good: 76 } }, s.t.dean).ok, true);
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5 } }, s.t.dean).error.code, 'units_closed');
});

test('scoring.save: the closing of an earlier half year does not stop the scheme', () => {
  const s = setup();
  s.at('2026-09-30');
  s.closeUnit(1, { closedAt: '2026-06-01 10:00:00' });
  s.closeUnit(0, { closedAt: '2026-06-10 10:00:00' });
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5, good: 76 }, split: { semester: 50, exam: 50, admission: 25 } }, s.t.dean).ok, true);
});

test('scoring.save: the exam part cannot fall below a score already entered; the tables are read once', () => {
  const s = setup();
  s.allUnits();
  s.examHead();
  s.examRow(s.a1, { score: 35 });
  const before = s.snapshot();
  const save = (split) => s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME }, split }, s.t.dean);
  const res = save({ semester: 70, exam: 30, admission: 30 });
  assert.deepEqual(res.error, { code: 'invalid', fields: [{ field: 'exam', code: 'too_small' }] });
  assert.deepEqual(s.snapshot(), before);
  // with another error of the split the answer carries both
  const both = save({ semester: 70, exam: 30, admission: 80 });
  assert.equal(both.error.code, 'invalid');
  assert.deepEqual(both.error.fields.map((f) => f.field).sort(), ['admission']);
  // a retake of 20 does not matter: the live attempt is the last one; here only the first sitting is entered
  s.spy.reset();
  assert.equal(save({ semester: 60, exam: 40, admission: 30 }).ok, true);
  assert.equal(s.spy.lists.examAttempts, 1);
  assert.equal(s.spy.lists.closures, 1);
  assert.equal(s.spy.lists.settings, 1);
  // 35 fits in a part of exactly 35
  assert.equal(save({ semester: 65, exam: 35, admission: 30 }).ok, true);
  assert.equal(save({ semester: 66, exam: 34, admission: 30 }).error.fields[0].code, 'too_small');
  // an attempt of a subject whose final sheet is closed does not hold the split (it is fixed by the closing itself)
  s.closeFinal();
  assert.equal(save({ semester: 66, exam: 34, admission: 30 }).error.code, 'final_closed');
});

// the assignments: A and A2 of unit 1 (self-work), H of unit 1 (homework), B of unit 2 (self-work)
function tasks() {
  const s = setup();
  s.at('2026-09-30');
  const A = s.task({ unit: 1, title: 'СРС юнита 1' });
  const A2 = s.task({ unit: 1, title: 'СРС юнита 1 без попыток' });
  const H = s.task({ unit: 1, kind: 'hw', title: 'ДЗ юнита 1' });
  const B = s.task({ unit: 2 });
  s.attempt(A, 'a1');
  s.attempt(H, 'a1');
  s.closeUnit(1);
  return { s, A, A2, H, B };
}

const newTask = (s, data) => s.call('work.save', {
  subjectId: s.sb1, kind: 'srs', unit: 1, topicId: '', title: 'Новое', description: '', dueDate: '2026-10-20', dueTime: '23:59', maxPoints: 10, ...data,
}, s.t.teacher1);

test('self-work of a closed unit: nobody grades, changes, removes, gives or hands it in; the homework and the open unit work as before', () => {
  const { s, A, A2, H, B } = tasks();
  const H2 = s.task({ unit: 1, kind: 'hw', title: 'ДЗ без попыток' });
  const before = s.snapshot();
  const cur = (id, key) => s.store.list('submissions').find((r) => r.assignmentId === id && r.studentId === s.ids[key]).id;
  assert.equal(s.call('work.grade', { assignmentId: A, studentId: s.a1, attemptId: cur(A, 'a1'), verdict: 'checked', points: 8, comment: '' }, s.t.teacher1).error.code, 'unit_closed');
  assert.equal(s.call('work.save', { id: A, subjectId: s.sb1, kind: 'srs', unit: 1, topicId: '', title: 'Новое название', description: '', dueDate: '2026-10-20', dueTime: '23:59', maxPoints: 10 }, s.t.teacher1).error.code, 'unit_closed');
  assert.equal(s.call('work.remove', { assignmentId: A2 }, s.t.teacher1).error.code, 'unit_closed');
  assert.equal(newTask(s, {}).error.code, 'unit_closed');
  assert.equal(newTask(s, { id: H2, kind: 'srs', title: 'ДЗ без попыток' }).error.code, 'unit_closed');
  assert.equal(newTask(s, { id: B, unit: 1, title: 'СРС А' }).error.code, 'unit_closed');
  // the rights come first: another teacher is told 'forbidden', not the state of the unit
  assert.equal(s.call('work.remove', { assignmentId: A2 }, s.t.teacher2).error.code, 'forbidden');
  assert.equal(s.call('work.grade', { assignmentId: A, studentId: s.a1, attemptId: cur(A, 'a1'), verdict: 'checked', points: 8, comment: '' }, s.t.teacher2).error.code, 'forbidden');

  // the student
  assert.equal(s.call('work.submit', { assignmentId: A, text: 'ответ', fileIds: [] }, s.t.a2).error.code, 'unit_closed');
  assert.equal(s.call('work.upload', { assignmentId: A, name: 'scan.pdf', data: b64(SAMPLE.pdf) }, s.t.a2).error.code, 'unit_closed');
  assert.equal(s.call('work.submit', { assignmentId: A, text: 'ответ', fileIds: [] }, s.t.a1).error.code, 'unit_closed');
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual(s.files.names(), []);

  // the homework of the closed unit and the self-work of an open one
  assert.equal(s.call('work.grade', { assignmentId: H, studentId: s.a1, attemptId: cur(H, 'a1'), verdict: 'checked', points: 8, comment: '' }, s.t.teacher1).ok, true);
  assert.equal(s.call('work.submit', { assignmentId: H, text: 'ответ', fileIds: [] }, s.t.a2).ok, true);
  assert.equal(s.call('work.submit', { assignmentId: B, text: 'ответ', fileIds: [] }, s.t.a2).ok, true);
  const b2 = s.store.list('submissions').find((r) => r.assignmentId === B && r.studentId === s.a2);
  assert.equal(s.call('work.grade', { assignmentId: B, studentId: s.a2, attemptId: b2.id, verdict: 'checked', points: 8, comment: '' }, s.t.teacher1).ok, true);
  assert.equal(s.call('work.remove', { assignmentId: H2 }, s.t.teacher1).ok, true);
  assert.equal(newTask(s, { unit: 2 }).ok, true);
  assert.equal(newTask(s, { kind: 'hw' }).ok, true);
});

test('work.get, work.list, work.mine: the closed self-work is marked, the open one has no key', () => {
  const { s, A, B, H } = tasks();
  const keys = Object.keys(s.call('work.get', { assignmentId: B }, s.t.a1).data);
  const closed = s.call('work.get', { assignmentId: A }, s.t.a1).data;
  assert.deepEqual([closed.canSubmit, closed.closed], [false, true]);
  assert.deepEqual(Object.keys(s.call('work.get', { assignmentId: B }, s.t.a1).data), keys);
  assert.equal('closed' in s.call('work.get', { assignmentId: B }, s.t.a1).data, false);
  assert.equal('closed' in s.call('work.get', { assignmentId: H }, s.t.a1).data, false);
  assert.equal(s.call('work.get', { assignmentId: H }, s.t.a1).data.canSubmit, true);

  const staff = s.call('work.get', { assignmentId: A }, s.t.teacher1).data;
  assert.deepEqual([staff.can, staff.closed], [{ manage: false, grade: false, request: true }, true]);   // the subject teacher may file a request
  assert.equal(s.call('work.get', { assignmentId: A }, s.t.teacher2).error.code, 'forbidden');
  const open = s.call('work.get', { assignmentId: B }, s.t.teacher1).data;
  assert.deepEqual([open.can, 'closed' in open], [{ manage: true, grade: true }, false]);
  assert.deepEqual(s.call('work.get', { assignmentId: A }, s.t.dean).data.can, { manage: false, grade: false });

  const list = s.call('work.list', { subjectId: s.sb1 }, s.t.teacher1).data.assignments;
  assert.equal(list.find((x) => x.id === A).closed, true);
  assert.equal('closed' in list.find((x) => x.id === B), false);
  assert.equal('closed' in list.find((x) => x.id === H), false);

  const mine = s.call('work.mine', {}, s.t.a2).data;
  assert.equal(mine.tasks.find((x) => x.id === A).closed, true);
  assert.equal('closed' in mine.tasks.find((x) => x.id === B), false);
  // the closed self-work is not counted as a thing to do: B and the homework H remain
  assert.equal(mine.counts.fresh + mine.counts.overdue, 2);
});

test('lesson.start and lesson.mine: a pair of a closed unit cannot be started', () => {
  const s = setup();
  const { call, t, at, store, p0908, p0922, snapshot } = s;
  at('2026-09-08', '07:58');
  s.closeUnit(1);
  store.update('pairs', p0908, { status: 'planned' });
  const mine = call('lesson.mine', {}, t.teacher1).data.pairs;
  assert.deepEqual(mine.map((p) => [p.id, p.lesson, p.problem]), [[p0908, null, 'unit_closed']]);
  const before = snapshot();
  assert.equal(call('lesson.start', { pairId: p0908 }, t.teacher1).error.code, 'unit_closed');
  assert.deepEqual(snapshot(), before);
  at('2026-09-22', '07:58');
  assert.equal(call('lesson.mine', {}, t.teacher1).data.pairs[0].lesson, 'start');
  assert.equal(call('lesson.start', { pairId: p0922 }, t.teacher1).ok, true);
  assert.equal(call('lesson.start', { pairId: p0922 }, t.teacher1).ok, true);
});

test('student.grades: the closed unit is marked, the exam appears only with the closed final sheet and only the own one', () => {
  const s = setup();
  s.allUnits();
  s.examHead();
  s.examRow(s.a1, { score: 35 });
  const g = (token = s.t.a1) => s.call('student.grades', {}, token).data.subjects[0];
  const open = g();
  assert.deepEqual([open.units[0].closed, open.units[1].closed, open.final], [true, true, null]);
  assert.equal(JSON.stringify(open).includes('2026-12-15'), false);
  assert.equal(JSON.stringify(open).includes('Ассистент'), false);
  assert.equal('final' in open, true);

  s.closeFinal();
  const done = g();
  assert.deepEqual([done.semester, done.admitted], [47, true]);
  assert.deepEqual(done.final, { status: 'done', exam: 35, total: 82, word: 'good', tries: 1, canRetake: false, attempts: [{ no: 1, date: '2026-12-15', outcome: 'score', score: 35 }] });
  const text = JSON.stringify(s.call('student.grades', {}, s.t.a1).data);
  for (const word of [s.a2, s.a3, 'Өмүров', 'Ёлкин', 'Ассистент', 'commission', 'updatedBy']) assert.equal(text.includes(word), false, word);
  assert.equal(JSON.stringify(s.call('student.grades', {}, s.t.a2).data).includes('"exam":35'), false);
  // a3 is not admitted
  assert.deepEqual(g(s.t.a3).final, { status: 'not_admitted', exam: null, total: null, word: null, tries: 0, canRetake: false, attempts: [] });
});

test('student.grades: a retake, an absence and an incomplete sitting; the commission and the ids of the attempts stay out', () => {
  const s = setup();
  s.allUnits();
  s.examHead();
  s.examRow(s.a2, { score: 20 });
  s.examRow(s.a2, { no: 2, date: '2026-12-18', score: 25, updatedAt: '2026-12-18 12:00:00' });
  s.examRow(s.a1, { score: 5 });
  s.examRow(s.a1, { no: 2, date: '2026-12-19', score: 5, updatedAt: '2026-12-19 12:00:00' });
  const third = s.examRow(s.a1, { no: 3, date: '2026-12-22', score: 30, commission: 'Председатель Комиссиев', updatedAt: '2026-12-22 12:00:00' });
  s.closeFinal();
  const final = (key) => s.call('student.grades', {}, s.t[key]).data.subjects[0].final;
  const a2 = final('a2');
  assert.deepEqual([a2.total, a2.word, a2.tries, a2.canRetake, a2.attempts.map((a) => [a.no, a.score])], [63, 'fair', 2, false, [[1, 20], [2, 25]]]);
  assert.deepEqual(Object.keys(a2.attempts[0]), ['no', 'date', 'outcome', 'score']);
  const a1 = final('a1');
  assert.deepEqual([a1.total, a1.word, a1.tries, a1.canRetake, a1.attempts.map((a) => a.no)], [77, 'fair', 3, false, [1, 2, 3]]);
  for (const key of ['a1', 'a2']) {
    const text = JSON.stringify(s.call('student.grades', {}, s.t[key]).data);
    for (const word of ['Председатель', 'commission']) assert.equal(text.includes(word), false, word);
    for (const id of s.store.list('examAttempts').map((r) => r.id)) assert.equal(text.includes(id), false, id);
  }
  assert.ok(third);

  s.store.list('examAttempts').forEach((r) => s.store.remove('examAttempts', r.id));
  s.examRow(s.a2, { outcome: 'absent', score: null });
  assert.deepEqual(final('a2'), { status: 'absent', exam: null, total: null, word: null, tries: 1, canRetake: true, attempts: [{ no: 1, date: '2026-12-15', outcome: 'absent', score: null }] });
  s.store.list('examAttempts').forEach((r) => s.store.remove('examAttempts', r.id));
  s.examRow(s.a2, { outcome: 'incomplete', score: null });
  const incomplete = final('a2');
  assert.deepEqual([incomplete.status, incomplete.tries, incomplete.exam, incomplete.total], ['incomplete', 0, null, null]);
});

test('the tables are read once: journal.get, student.grades, work.*', () => {
  const { s, A } = tasks();
  const once = (tables, label) => { for (const table of tables) assert.equal(s.spy.lists[table], 1, label + ' ' + table); };
  s.spy.reset();
  assert.equal(s.call('journal.get', { subjectId: s.sb1 }, s.t.teacher1).ok, true);
  once(JOURNAL_TABLES, 'journal.get');
  s.spy.reset();
  assert.equal(s.call('student.grades', {}, s.t.a1).ok, true);
  once([...JOURNAL_TABLES, 'examAttempts'], 'student.grades');
  for (const [action, data, token] of [['work.get', { assignmentId: A }, s.t.a1], ['work.get', { assignmentId: A }, s.t.teacher1], ['work.list', { subjectId: s.sb1 }, s.t.teacher1],
    ['work.mine', {}, s.t.a1], ['work.submit', { assignmentId: A, text: 'x', fileIds: [] }, s.t.a2]]) {
    s.spy.reset();
    s.call(action, data, token);
    once(WORK_TABLES, action);
  }
  s.spy.reset();
  s.call('lesson.mine', {}, s.t.teacher1);
  once(LESSON_TABLES.filter((x) => x !== 'checkins'), 'lesson.mine');
});

test('scoring.save: no direct writes of a closed unit reach the log', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const logs = s.store.list('changeLog').length;
  s.call('journal.saveResults', { subjectId: s.sb1, unit: 1, field: 'control', items: [{ studentId: s.a2, value: 30 }], reason: 'x' }, s.t.admin);
  s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, activity: 5 } }, s.t.admin);
  assert.equal(s.store.list('changeLog').length, logs);
});

// the closing does not depend on the present teacher or on the half of the year in force
const markOf = (s, id) => ({ pairId: id, marks: [{ studentId: s.a2, status: 'excused', noCoat: false, activity: null }], reason: 'справка' });

test('a closed unit stays closed when the teacher of the subject changes to one without a syllabus', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const subject = s.store.get('subjects', s.sb1);
  assert.equal(s.call('dir.save', { table: 'subjects', row: { ...subject, teacherId: s.ids.teacher2 } }, s.t.admin).ok, true);
  const j = s.call('journal.get', { subjectId: s.sb1 }, s.t.dean).data.journal;
  assert.deepEqual(j.closed, { units: [1], final: false });
  assert.deepEqual(j.pairs.filter((p) => p.unit === 1).map((p) => p.mode), ['none', 'none']);
  const before = s.snapshot();
  for (const who of ['dean', 'admin']) assert.equal(s.call('journal.savePair', markOf(s, s.p0901), s.t[who]).error.code, 'unit_closed');
  assert.equal(s.call('journal.reopenPair', { pairId: s.p0901, reason: 'x' }, s.t.dean).error.code, 'unit_closed');
  assert.equal(s.call('journal.saveResults', { subjectId: s.sb1, unit: 1, field: 'control', items: [{ studentId: s.a2, value: 30 }], reason: 'x' }, s.t.dean).ok, false);
  assert.deepEqual(s.snapshot(), before);
  // only the administrator opens it again
  const closure = s.store.list('closures')[0];
  s.store.update('closures', closure.id, { reopenedAt: '2026-10-01 10:00:00', reopenedBy: s.ids.admin });
  assert.equal(s.call('journal.savePair', markOf(s, s.p0901), s.t.dean).ok, true);
});

test('a closed unit stays closed when the half of the year is switched', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const cur = s.call('settings.get', {}, s.t.dean).data.settings;
  assert.equal(s.call('settings.save', { settings: { ...cur, semester: 2 } }, s.t.dean).ok, true);
  const before = s.snapshot();
  assert.equal(s.call('journal.savePair', markOf(s, s.p0901), s.t.dean).error.code, 'unit_closed');
  assert.equal(s.call('journal.reopenPair', { pairId: s.p0901, reason: 'x' }, s.t.dean).error.code, 'unit_closed');
  assert.equal(s.call('journal.saveResults', { subjectId: s.sb1, unit: 1, field: 'control', items: [{ studentId: s.a2, value: 30 }], reason: 'x' }, s.t.dean).ok, false);
  assert.deepEqual(s.snapshot(), before);
  const closure = s.store.list('closures')[0];
  s.store.update('closures', closure.id, { reopenedAt: '2026-10-01 10:00:00', reopenedBy: s.ids.admin });
  assert.equal(s.call('journal.savePair', markOf(s, s.p0901), s.t.dean).ok, true);
});

test('a pair of a closed unit is neither returned from "missed" nor marked missed (final review, M2)', () => {
  const s = setup();
  s.unitNumbers();
  const base = s.store.get('pairs', s.p0908);
  const missed = s.store.insert('pairs', { ...base, id: undefined, date: '2026-09-09', status: 'missed' });
  const planned = s.store.insert('pairs', { ...base, id: undefined, date: '2026-09-10', status: 'planned' });
  s.closeUnit(1);
  s.at('2026-10-01');
  const before = s.snapshot();
  for (const who of ['dean', 'admin']) {
    assert.equal(s.call('journal.reopenPair', { pairId: missed.id, reason: 'ошибка' }, s.t[who]).error.code, 'unit_closed', who);
    assert.equal(s.call('journal.missPair', { pairId: planned.id, reason: 'ошибка' }, s.t[who]).error.code, 'unit_closed', who);
  }
  assert.deepEqual(s.snapshot(), before);
});

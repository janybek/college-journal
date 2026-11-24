import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import { STATE_EXAM_TABLES } from '../backend/stateExamData.js';

// The state exams of a group. Fictional people only.
const NAME = 'Гос. экзамен по специальности';
const base = (s) => ({ groupId: s.g1, name: NAME, date: '2026-12-10' });
const READERS = ['teacher1', 'teacher2', 'prorector', 'admin'];

function withExam() {
  const s = setup();
  const id = s.call('stateExam.save', base(s), s.t.dean).data.exam.id;
  const put = (items, reason, token = s.t.dean) => s.call('stateExam.saveScores', { examId: id, items, reason }, token);
  return { s, id, put };
}

test('stateExam.save: only the deanery and the admin; every problem at once; a duplicate; nothing is written on refusal', () => {
  const s = setup();
  const E = base(s);
  const before = s.snapshot();
  for (const who of ['prorector', 'teacher1', 'a1']) assert.equal(s.call('stateExam.save', E, s.t[who]).error.code, 'forbidden');
  assert.deepEqual(s.call('stateExam.save', { ...E, groupId: [s.g1], name: ' ', date: 'x' }, s.t.dean).error.fields,
    [{ field: 'groupId', code: 'bad_ref' }, { field: 'name', code: 'empty' }, { field: 'date', code: 'bad_value' }]);
  assert.deepEqual(s.snapshot(), before);
  const id = s.call('stateExam.save', E, s.t.dean).data.exam.id;
  const row = s.store.list('stateExams')[0];
  assert.deepEqual([row.id === id, row.createdBy, row.createdAt !== '', row.updatedBy], [true, s.ids.dean, true, '']);
  assert.deepEqual(s.call('stateExam.save', { ...E, name: 'гос. экзамен по специальности' }, s.t.dean).error.fields, [{ field: 'name', code: 'duplicate' }]);
  assert.equal(s.call('stateExam.save', { ...E, name: 'Другой' }, s.t.admin).ok, true);
  // an edit: another date; the same data writes nothing
  s.spy.reset();
  assert.equal(s.call('stateExam.save', { ...E, id }, s.t.dean).ok, true);
  assert.deepEqual(Object.keys(s.spy.writes).filter((k) => k.endsWith(':stateExams')), []);
  assert.equal(s.call('stateExam.save', { ...E, id, date: '2026-12-11' }, s.t.dean).ok, true);
  const edited = s.store.get('stateExams', id);
  assert.deepEqual([edited.date, edited.updatedBy, edited.updatedAt !== '', edited.createdBy], ['2026-12-11', s.ids.dean, true, s.ids.dean]);
  for (const bad of [[id], 5, 'нет', null]) assert.equal(s.call('stateExam.save', { ...E, id: bad }, s.t.dean).error.code, 'not_found');
});

test('stateExam.saveScores: the rights, the checks, all or nothing, the reason of a change, the log', () => {
  const { s, id, put } = withExam();
  const mid = s.snapshot();
  for (const who of ['prorector', 'teacher1', 'a1']) assert.equal(put([{ studentId: s.a1, score: 90 }], '', s.t[who]).error.code, 'forbidden');
  for (const score of ['90', 90.5, -1, 101, undefined]) assert.deepEqual(put([{ studentId: s.a1, score }]).error.fields, [{ index: 0, field: 'score', code: 'bad_value' }]);
  assert.deepEqual(put([{ studentId: s.a1, score: 90 }, { studentId: s.b1, score: 80 }]).error.fields, [{ index: 1, field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(put([{ studentId: s.a4, score: 80 }]).error.fields, [{ index: 0, field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(put([{ studentId: 'sd_none', score: 80 }]).error.fields, [{ index: 0, field: 'studentId', code: 'bad_ref' }]);
  assert.equal(put([{ studentId: s.a1, score: 90 }, { studentId: s.a1, score: 80 }]).error.code, 'bad_request');
  for (const items of [[], 'x', null, [null], [{ studentId: 5, score: 1 }], [[]], Array.from({ length: 201 }, (_, i) => ({ studentId: 'x' + i, score: 1 }))]) {
    assert.equal(put(items).error.code, 'bad_request');
  }
  for (const examId of [[id], 5, 'нет', ' ' + id]) {
    assert.equal(s.call('stateExam.get', { examId }, s.t.dean).error.code, 'not_found');
    assert.equal(s.call('stateExam.saveScores', { examId, items: [{ studentId: s.a1, score: 1 }] }, s.t.dean).error.code, 'not_found');
  }
  assert.deepEqual(s.snapshot(), mid);

  const view = put([{ studentId: s.a1, score: 90 }, { studentId: s.a2, score: 59 }]).data;
  const got = new Map(view.students.map((x) => [x.id, [x.score, x.word, x.left]]));
  assert.deepEqual([got.get(s.a1), got.get(s.a2), got.get(s.a3), view.students.length], [[90, 'excellent', false], [59, 'fail', false], [null, null, false], 3]);
  assert.deepEqual(view.stats, { total: 3, entered: 2, fail: 1, fair: 0, good: 0, excellent: 1, average: 75 });
  assert.deepEqual(put([{ studentId: s.a1, score: 80 }]).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(put([{ studentId: s.a1, score: 80 }], 'x'.repeat(301)).error.fields, [{ field: 'reason', code: 'too_long' }]);
  assert.equal(put([{ studentId: s.a1, score: 80 }], 'опечатка в протоколе').ok, true);
  assert.deepEqual(s.store.list('changeLog').filter((r) => r.entity === 'exam').map((r) => [r.studentId, r.before, r.after, r.reason, r.examId === id, r.field, r.subjectId, r.late]),
    [[s.a1, '', '90', '', true, 'score', '', false], [s.a2, '', '59', '', true, 'score', '', false], [s.a1, '90', '80', 'опечатка в протоколе', true, 'score', '', false]]);
  assert.equal(s.store.list('changeLog').filter((r) => r.entity === 'exam').every((r) => r.actorId === s.ids.dean && r.at !== ''), true);

  // the same values write nothing; clearing a score needs a reason and leaves an empty row
  const same = s.snapshot();
  assert.equal(put([{ studentId: s.a1, score: 80 }]).ok, true);
  assert.deepEqual(s.snapshot(), same);
  assert.equal(put([{ studentId: s.a2, score: null }]).error.fields[0].code, 'required');
  assert.equal(put([{ studentId: s.a2, score: null }], 'ошибочно внесён').ok, true);
  assert.equal(s.store.list('stateExamResults').length, 2);
  assert.deepEqual(s.store.list('changeLog').filter((r) => r.entity === 'exam').pop().after, '');
});

test('stateExam.saveScores: the word follows the thresholds of the scheme', () => {
  const { s, put } = withExam();
  const word = (id, view) => view.students.find((x) => x.id === id).word;
  assert.equal(word(s.a3, put([{ studentId: s.a3, score: 79 }]).data), 'fair');
  assert.equal(s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, good: 76 } }, s.t.dean).ok, true);
  const view = s.call('stateExam.get', { examId: s.store.list('stateExams')[0].id }, s.t.dean).data;
  assert.deepEqual([word(s.a3, view), view.scheme], ['good', { fair: 60, good: 76, excellent: 90 }]);
  assert.equal(s.call('scoring.save', { scheme: DEFAULT_SCHEME }, s.t.dean).ok, true);
});

test('stateExam.get and list: the order of students, the readers, the numbers; the removal', () => {
  const { s, id, put } = withExam();
  put([{ studentId: s.a1, score: 90 }, { studentId: s.a2, score: 59 }]);
  const view = s.call('stateExam.get', { examId: id }, s.t.dean).data;
  assert.deepEqual(view.students.map((x) => x.id), [s.a1, s.a3, s.a2]);           // Асанов, Ёлкин, Өмүров
  assert.deepEqual(view.exam, { id, groupId: s.g1, groupName: '01-1', name: NAME, date: '2026-12-10' });
  assert.deepEqual([view.can, view.collegeName, typeof view.today], [{ manage: true }, '', 'string']);
  for (const who of READERS) {
    assert.equal(s.call('stateExam.get', { examId: id }, s.t[who]).ok, true);
    const list = s.call('stateExam.list', {}, s.t[who]);
    assert.equal(list.ok, true);
    assert.equal(list.data.can.manage, who === 'admin');
    assert.deepEqual(list.data.groups.length, who === 'admin' ? 2 : 0);
  }
  assert.equal(s.call('stateExam.get', { examId: id }, s.t.teacher1).data.can.manage, false);
  assert.equal(s.call('stateExam.get', { examId: id }, s.t.a1).error.code, 'forbidden');
  assert.equal(s.call('stateExam.list', {}, s.t.a1).error.code, 'forbidden');

  s.call('stateExam.save', { groupId: s.g2, name: 'Позднее', date: '2026-12-20' }, s.t.dean);
  s.call('stateExam.save', { groupId: s.g2, name: 'Раннее', date: '2026-11-20' }, s.t.dean);
  const list = s.call('stateExam.list', {}, s.t.dean).data;
  assert.deepEqual(list.exams.map((e) => [e.name, e.date, e.groupName, e.students, e.entered]),
    [['Позднее', '2026-12-20', '02-1', 1, 0], [NAME, '2026-12-10', '01-1', 3, 2], ['Раннее', '2026-11-20', '02-1', 1, 0]]);
  assert.deepEqual(list.groups.map((g) => g.name), ['01-1', '02-1']);

  assert.equal(s.call('stateExam.remove', { examId: id }, s.t.dean).error.code, 'in_use');
  for (const who of ['prorector', 'teacher1', 'a1']) assert.equal(s.call('stateExam.remove', { examId: id }, s.t[who]).error.code, 'forbidden');
  const empty = list.exams[0].id;
  s.store.insert('stateExamResults', { examId: empty, studentId: s.b1, score: null, updatedBy: s.ids.dean, updatedAt: '2026-12-01 10:00:00' });
  assert.equal(s.call('stateExam.remove', { examId: empty }, s.t.dean).ok, true);
  assert.equal(s.store.list('stateExams').some((e) => e.id === empty), false);
  assert.equal(s.store.list('stateExamResults').some((r) => r.examId === empty), false);
  assert.equal(s.call('stateExam.remove', { examId: empty }, s.t.dean).error.code, 'not_found');
});

test('stateExam: the group of an exam with scores is locked; a transferred student stays at the end; a result without a person is not shown', () => {
  const { s, id, put } = withExam();
  const fresh = s.call('stateExam.save', { groupId: s.g1, name: 'Новый', date: '2026-12-12' }, s.t.dean).data.exam.id;
  assert.equal(s.call('stateExam.save', { id: fresh, groupId: s.g2, name: 'Новый', date: '2026-12-12' }, s.t.dean).ok, true);
  put([{ studentId: s.a1, score: 85 }, { studentId: s.a2, score: 70 }]);
  assert.deepEqual(s.call('stateExam.save', { id, ...base(s), groupId: s.g2 }, s.t.dean).error.fields, [{ field: 'groupId', code: 'locked' }]);

  // a ghost: a result of a deleted student; a transferred one: a1 moved to the other group
  s.store.insert('stateExamResults', { examId: id, studentId: 'sd_gone', score: 77, updatedBy: s.ids.dean, updatedAt: '2026-12-01 10:00:00' });
  s.store.update('students', s.a1, { groupId: s.g2 });
  const view = s.call('stateExam.get', { examId: id }, s.t.dean);
  assert.equal(view.ok, true);
  assert.deepEqual(view.data.students.map((x) => [x.id, x.left]), [[s.a3, false], [s.a2, false], [s.a1, true]]);
  assert.deepEqual(view.data.stats, { total: 3, entered: 2, fail: 0, fair: 1, good: 1, excellent: 0, average: 78 });
  assert.equal(JSON.stringify(view.data).includes('sd_gone'), false);
  const list = s.call('stateExam.list', {}, s.t.dean);
  assert.equal(list.ok, true);
  assert.deepEqual(list.data.exams.filter((e) => e.id === id).map((e) => [e.students, e.entered]), [[2, 1]]);
  assert.equal(s.call('student.grades', {}, s.t.a1).data.stateExams.find((x) => x.name === NAME).score, 85);
  // the transferred student can still be corrected
  assert.equal(put([{ studentId: s.a1, score: 86 }], 'уточнение').ok, true);
});

test('student.grades: only the own score and word of the exams of the group and the ones with a score', () => {
  const { s, id, put } = withExam();
  put([{ studentId: s.a1, score: 80 }, { studentId: s.a2, score: 59 }]);
  const g = (key) => s.call('student.grades', {}, s.t[key]).data;
  assert.deepEqual(g('a1').stateExams, [{ name: NAME, date: '2026-12-10', score: 80, word: 'good' }]);
  assert.deepEqual(g('a3').stateExams, [{ name: NAME, date: '2026-12-10', score: null, word: null }]);
  assert.deepEqual(g('b1').stateExams, []);
  assert.deepEqual(Object.keys(g('a1')).pop(), 'stateExams');
  const text = JSON.stringify(g('a1'));
  for (const hidden of [s.a2, s.a3, id, 'Өмүров', 'Ёлкин', '59']) assert.equal(text.includes(hidden), false, hidden);
  assert.equal(JSON.stringify(g('a2')).includes('"score":80'), false);
  // the order: the later date first
  s.call('stateExam.save', { groupId: s.g1, name: 'Раннее', date: '2026-11-01' }, s.t.dean);
  s.call('stateExam.save', { groupId: s.g1, name: 'Позднее', date: '2026-12-30' }, s.t.dean);
  assert.deepEqual(g('a1').stateExams.map((x) => x.date), ['2026-12-30', '2026-12-10', '2026-11-01']);
  // a student without a group
  s.store.update('students', s.a3, { groupId: '' });
  assert.deepEqual(g('a3').stateExams, []);
  // a result of a person who is gone
  s.store.insert('stateExamResults', { examId: id, studentId: 'sd_gone', score: 77, updatedBy: s.ids.dean, updatedAt: '2026-12-01 10:00:00' });
  assert.equal(s.call('student.grades', {}, s.t.a1).ok, true);
});

test('stateExam: the tables are read once', () => {
  const { s, id, put } = withExam();
  put([{ studentId: s.a1, score: 80 }]);
  const once = (tables, label) => { for (const table of tables) assert.equal(s.spy.lists[table], 1, label + ' ' + table); };
  s.spy.reset();
  assert.equal(s.call('stateExam.list', {}, s.t.dean).ok, true);
  once(STATE_EXAM_TABLES, 'list');
  s.spy.reset();
  assert.equal(s.call('stateExam.get', { examId: id }, s.t.dean).ok, true);
  once(STATE_EXAM_TABLES, 'get');
  s.spy.reset();
  assert.equal(put([{ studentId: s.a3, score: 70 }, { studentId: s.a1, score: 81 }], 'уточнение').ok, true);
  once(STATE_EXAM_TABLES, 'saveScores');
  assert.deepEqual(Object.entries(s.spy.writes).filter(([k]) => /^(insert|update|remove):/.test(k)), []);   // batches only
  s.spy.reset();
  assert.equal(s.call('student.grades', {}, s.t.a1).ok, true);
  once(['stateExams', 'stateExamResults'], 'student.grades');
});

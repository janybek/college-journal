import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import { currentAttempt } from '../core/work.js';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { WORK_TABLES } from '../backend/workData.js';
import { setup } from './journalSetup.js';

const workLog = (store) => store.list('changeLog').filter((r) => r.entity === 'work');
const shape = (r) => [r.field, r.before, r.after, r.assignmentId, r.unit, r.reason];

// The tasks of the unit 2 from the plan: A (max 10, due 20.09) and B (max 20, due 27.09); the control of a1 is 30; a2 has a manual self 16.
function scenario() {
  const s = setup();
  const { store, ids, a1, a2, a3, sb1, call, t, at, task, attempt } = s;
  const A = task();
  const B = task({ title: 'СРС Б', maxPoints: 20, dueAt: '2026-09-27 23:59:00' });
  const cur = (id, key) => (currentAttempt(store.list('submissions').filter((r) => r.assignmentId === id && r.studentId === ids[key])) || { id: '' }).id;
  const grade = (id, key, data = {}, token = t.teacher1) => call('work.grade', {
    assignmentId: id, studentId: ids[key], attemptId: cur(id, key), verdict: 'checked', points: 8, comment: '', ...data,
  }, token);
  const unit2 = (key, token = t.teacher1) => call('journal.get', { subjectId: sb1 }, token).data.journal.results[ids[key]].units.find((u) => u.unit === 2);
  at('2026-09-24', '12:00');
  attempt(A, 'a1');
  attempt(B, 'a1', { submittedAt: '2026-09-23 10:00:00' });
  attempt(A, 'a2', { submittedAt: '2026-09-21 10:00:00', status: 'checked', points: 10, checkedBy: ids.teacher1, checkedAt: '2026-09-22 10:00:00' });
  attempt(B, 'a3', { status: 'returned', comment: 'x', checkedBy: ids.teacher1, checkedAt: '2026-09-23 10:00:00' });
  store.insert('unitResults', { subjectId: sb1, studentId: a2, planSemester: 1, unit: 2, control: null, self: 16, currentManual: null, updatedBy: ids.teacher1, updatedAt: '2026-09-10 10:00:00' });
  assert.equal(call('journal.saveResults', { subjectId: sb1, unit: 2, field: 'control', items: [{ studentId: a1, value: 30 }] }, t.teacher1).ok, true);
  return { ...s, A, B, cur, grade, unit2, a1, a2, a3 };
}

test('work.grade: every refusal leaves the tables and the disk as they were', () => {
  const s = scenario();
  const { t, b1, A, B, grade, snapshot } = s;
  const before = snapshot();
  for (const token of [t.teacher2, t.teacher3, t.dean, t.prorector, t.admin, t.a1, 'bad-token']) assert.notEqual(grade(A, 'a1', {}, token).ok, true);
  for (const data of [{ points: 11 }, { points: -1 }, { points: 2.5 }, { points: '8' }, { verdict: 'returned', points: 3, comment: 'x' }, { verdict: 'returned', points: null, comment: ' ' }, { studentId: b1 }, { attemptId: 'zzz' }, { attemptId: '' }]) {
    assert.equal(grade(A, 'a1', data).ok, false, JSON.stringify(data));
  }
  assert.equal(grade(A, 'a3', { attemptId: '', verdict: 'returned', points: null, comment: 'x' }).error.code, 'nothing_to_return');
  assert.deepEqual(grade(A, 'a1', { studentId: b1 }).error.fields, [{ field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(grade(A, 'a1', { points: 11 }).error.fields, [{ field: 'points', code: 'bad_value' }]);
  assert.equal(grade(A, 'a1', {}, t.teacher2).error.code, 'forbidden');
  assert.equal(grade(A, 'a1', {}, t.a1).error.code, 'forbidden');
  assert.equal(grade('nope', 'a1').error.code, 'not_found');
  assert.equal(grade([A], 'a1').error.code, 'not_found');
  for (const data of [{ studentId: [s.a1] }, { attemptId: undefined }, { attemptId: 5 }, { verdict: 'done' }, { comment: 'я'.repeat(2001) }, { points: 8, comment: 5 }]) {
    assert.equal(grade(A, 'a1', data).ok, false, JSON.stringify(data));
  }
  assert.notEqual(s.call('work.grade', {}, t.teacher1).ok, true);
  assert.notEqual(s.call('work.grade', undefined, t.teacher1).ok, true);
  assert.equal(grade(B, 'a3', { points: 25 }).ok, false);
  assert.equal(grade(B, 'a3', { points: 12 }, t.teacher2).ok, false);
  assert.deepEqual(snapshot(), before);
});

test('work.grade: the first grade, the log rows, a repeat, a change needs a reason', () => {
  const s = scenario();
  const { call, store, t, ids, A, a1, grade, spy, snapshot } = s;
  spy.reset();
  const first = grade(A, 'a1', {});
  assert.equal(first.ok, true);
  for (const table of WORK_TABLES) assert.equal(spy.lists[table] <= 1, true, table);
  assert.deepEqual(spy.writes, { 'updateMany:submissions': 1, 'insertMany:changeLog': 1 });
  const row = store.list('submissions').find((r) => r.assignmentId === A && r.studentId === a1);
  assert.deepEqual([row.status, row.points, row.comment, row.checkedBy, row.checkedAt], ['checked', 8, '', ids.teacher1, '2026-09-24 12:00:00']);
  assert.deepEqual(first.data.work, call('work.get', { assignmentId: A }, t.teacher1).data);
  const log = workLog(store);
  assert.deepEqual(log.map(shape), [['points', '', '8', A, 2, ''], ['status', 'submitted', 'checked', A, 2, '']]);
  for (const r of log) {
    assert.deepEqual([r.at, r.actorId, r.entity, r.subjectId, r.assignmentId, r.studentId, r.unit, r.reason, r.late, r.pairId],
      ['2026-09-24 12:00:00', ids.teacher1, 'work', s.sb1, A, a1, 2, '', false, '']);
  }
  // a repeat changes nothing and writes nothing
  const before = snapshot();
  spy.reset();
  assert.equal(grade(A, 'a1', {}).ok, true);
  assert.deepEqual(spy.writes, {});
  assert.deepEqual(snapshot(), before);
  assert.equal(workLog(store).length, 2);
  // a change of the points needs a reason
  assert.deepEqual(grade(A, 'a1', { points: 9 }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(grade(A, 'a1', { points: 9, reason: '   ' }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(grade(A, 'a1', { points: 9, reason: 'я'.repeat(301) }).error.fields, [{ field: 'reason', code: 'too_long' }]);
  assert.deepEqual(snapshot(), before);
  assert.equal(grade(A, 'a1', { points: 9, reason: ' перепроверил ' }).ok, true);
  assert.deepEqual(workLog(store).slice(2).map(shape), [['points', '8', '9', A, 2, 'перепроверил']]);
  // the points down to zero are points too
  assert.equal(grade(A, 'a1', { points: 0, reason: 'ошибка' }).ok, true);
  assert.deepEqual(workLog(store).slice(3).map(shape), [['points', '9', '0', A, 2, 'ошибка']]);
  // only the comment changes: written, not logged, no reason
  assert.equal(grade(A, 'a1', { points: 0, comment: 'хорошо' }).ok, true);
  assert.equal(store.list('submissions').find((r) => r.assignmentId === A && r.studentId === a1).comment, 'хорошо');
  assert.equal(workLog(store).length, 4);
});

test('work.grade: a comment-only edit of a checked work keeps who checked it and when', () => {
  const s = scenario();
  const { store, ids, A, a1, grade, at } = s;
  const rowOf = () => store.list('submissions').find((r) => r.assignmentId === A && r.studentId === a1);
  assert.equal(grade(A, 'a1', {}).ok, true);
  const first = rowOf();
  assert.deepEqual([first.checkedBy, first.checkedAt], [ids.teacher1, '2026-09-24 12:00:00']);
  at('2026-09-25', '09:30');
  assert.equal(grade(A, 'a1', { comment: 'позже дописал замечание' }).ok, true);
  assert.deepEqual([rowOf().comment, rowOf().checkedBy, rowOf().checkedAt, rowOf().points, rowOf().status], ['позже дописал замечание', ids.teacher1, '2026-09-24 12:00:00', 8, 'checked']);
  // a change of the points is a new check: who and when move
  assert.equal(grade(A, 'a1', { points: 9, reason: 'перепроверил' }).ok, true);
  assert.equal(rowOf().checkedAt, '2026-09-25 09:30:00');
});

test('work.grade: a returned work, with and without a reason', () => {
  const s = scenario();
  const { store, A, B, a1, grade, snapshot } = s;
  grade(A, 'a1', {});
  // a submitted work is returned without a reason
  assert.equal(grade(B, 'a1', { verdict: 'returned', points: null, comment: 'переделай' }).ok, true);
  assert.deepEqual(workLog(store).filter((r) => r.assignmentId === B).map(shape), [['status', 'submitted', 'returned', B, 2, '']]);
  // a checked work is returned only with a reason
  const before = snapshot();
  assert.deepEqual(grade(A, 'a1', { verdict: 'returned', points: null, comment: 'ещё раз' }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(snapshot(), before);
  assert.equal(grade(A, 'a1', { verdict: 'returned', points: null, comment: 'ещё раз', reason: 'нашёл ошибку' }).ok, true);
  assert.deepEqual(workLog(store).filter((r) => r.assignmentId === A).slice(2).map(shape),
    [['points', '8', '', A, 2, 'нашёл ошибку'], ['status', 'checked', 'returned', A, 2, 'нашёл ошибку']]);
  const row = store.list('submissions').find((r) => r.assignmentId === A && r.studentId === a1);
  assert.deepEqual([row.status, row.points, row.comment], ['returned', null, 'ещё раз']);
});

test('work.grade: the attempt the teacher saw must still be the current one', () => {
  const s = scenario();
  const { store, A, B, ids, cur, grade, snapshot, attempt } = s;
  const seen = cur(B, 'a1');
  attempt(B, 'a1', { n: 2, submittedAt: '2026-09-24 11:00:00' });   // the student handed in again
  const before = snapshot();
  assert.equal(grade(B, 'a1', { attemptId: seen, points: 15 }).error.code, 'attempt_changed');
  assert.equal(grade(B, 'a1', { attemptId: '', points: 15 }).error.code, 'attempt_changed');
  assert.equal(grade(A, 'a1', { attemptId: '', points: 8 }).error.code, 'attempt_changed');   // A has an attempt too
  assert.deepEqual(snapshot(), before);
  assert.equal(grade(B, 'a1', { points: 15 }).ok, true);
  assert.equal(store.list('submissions').filter((r) => r.assignmentId === B && r.studentId === ids.a1 && r.status === 'checked').length, 1);
  assert.equal(store.list('submissions').find((r) => r.id === seen).status, 'submitted');
});

test('work.grade: a student who left the group is graded; a student of another group is not', () => {
  const s = scenario();
  const { store, A, a4, grade, snapshot, attempt } = s;
  assert.equal(grade(A, 'a4', { attemptId: '' }).error.fields[0].code, 'bad_ref');   // left, no attempts
  attempt(A, 'a4');
  assert.equal(grade(A, 'a4', {}).ok, true);
  assert.equal(store.list('submissions').find((r) => r.studentId === a4).status, 'checked');
  const before = snapshot();
  assert.equal(grade(A, 'b1', { attemptId: '' }).ok, false);
  assert.deepEqual(snapshot(), before);
});

test('the unit self-work counted from the assignments, 24.09 and 28.09', () => {
  const s = scenario();
  const { call, store, t, at, ids, A, B, a1, a2, a3, sb1, grade, unit2, snapshot, task } = s;
  grade(A, 'a1', {});
  // 24.09: a1 8 of 30, B waits; a2 10 of 30, B not due; a3 0 of 30, A due and empty, B returned
  assert.deepEqual((({ self, total, selfWork }) => ({ self, total, selfWork }))(unit2('a1')), { self: null, total: null, selfWork: { earned: 8, max: 30, pending: 1, value: 5 } });
  assert.deepEqual((({ self, selfWork }) => ({ self, selfWork }))(unit2('a2')), { self: null, selfWork: { earned: 10, max: 30, pending: 1, value: 7 } });
  assert.deepEqual((({ self, selfWork }) => ({ self, selfWork }))(unit2('a3')), { self: null, selfWork: { earned: 0, max: 30, pending: 1, value: 0 } });
  const j = call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal;
  assert.deepEqual(j.units, [{ unit: 1, title: '' }, { unit: 2, title: '', byWork: true }]);
  assert.equal('selfWork' in j.results[a1].units[0], false);            // unit 1 as before
  assert.equal('byWork' in j.units[0], false);

  // 28.09
  at('2026-09-28', '12:00');
  assert.equal(call('journal.saveResults', { subjectId: sb1, unit: 2, field: 'current', items: [{ studentId: a1, value: 26 }], reason: 'ручной' }, t.teacher1).ok, true);
  assert.equal(grade(B, 'a1', { points: 15 }).ok, true);
  assert.deepEqual(grade(B, 'a3', { points: 12 }).ok, true);
  assert.deepEqual(workLog(store).filter((r) => r.studentId === a3).map(shape), [['points', '', '12', B, 2, ''], ['status', 'returned', 'checked', B, 2, '']]);
  const a1u = unit2('a1');
  assert.deepEqual([a1u.self, a1u.current, a1u.control, a1u.total, a1u.selfWork], [15, 26, 30, 71, { earned: 23, max: 30, pending: 0, value: 15 }]);
  assert.equal(a1u.word, 'fair');
  assert.deepEqual([unit2('a2').self, unit2('a2').selfWork], [7, { earned: 10, max: 30, pending: 0, value: 7 }]);    // the manual 16 does not count
  assert.deepEqual([unit2('a3').self, unit2('a3').selfWork], [8, { earned: 12, max: 30, pending: 0, value: 8 }]);

  // a homework on paper: an attempt of its own, and the self-work is the same
  const V = task({ kind: 'hw', title: 'ДЗ В', maxPoints: 5 });
  assert.equal(grade(V, 'a2', { attemptId: '', points: 4 }).ok, true);
  const paper = store.list('submissions').find((r) => r.assignmentId === V);
  assert.deepEqual([paper.studentId, paper.n, paper.text, paper.paper, paper.submittedAt, paper.status, paper.points, paper.comment, paper.checkedBy, paper.checkedAt],
    [a2, 1, '', true, '2026-09-28 12:00:00', 'checked', 4, '', ids.teacher1, '2026-09-28 12:00:00']);
  assert.deepEqual(workLog(store).filter((r) => r.assignmentId === V).map(shape), [['points', '', '4', V, 2, ''], ['status', '', 'checked', V, 2, '']]);
  assert.equal(unit2('a2').selfWork.max, 30);
  assert.equal(unit2('a2').self, 7);
  assert.equal(grade(V, 'a3', { attemptId: '', verdict: 'returned', points: null, comment: 'x' }).error.code, 'nothing_to_return');
  assert.equal(grade(V, 'a3', { attemptId: '', points: 0 }).ok, true);        // zero on paper is a grade
  assert.deepEqual(workLog(store).filter((r) => r.assignmentId === V && r.studentId === a3).map(shape), [['points', '', '0', V, 2, ''], ['status', '', 'checked', V, 2, '']]);

  // student.grades of a1: the same numbers, nothing of the others
  const g = call('student.grades', {}, t.a1).data;
  const own = g.subjects[0].units.find((u) => u.unit === 2);
  assert.deepEqual(own.selfWork, { earned: 23, max: 30, pending: 0, value: 15 });
  assert.deepEqual([own.self, own.total, own.word], [15, 71, 'fair']);
  assert.equal('selfWork' in g.subjects[0].units.find((u) => u.unit === 1), false);
  const text = JSON.stringify(g);
  for (const word of [a2, a3, 'Өмүров', 'Ёлкин']) assert.equal(text.includes(word), false, word);
  const g2 = call('student.grades', {}, t.a2).data.subjects[0].units.find((u) => u.unit === 2);
  assert.deepEqual(g2.selfWork, { earned: 10, max: 30, pending: 0, value: 7 });
  assert.equal(g2.self, 7);

  // the scheme "current 40, self 30, control 30": 23 of 30 is 23
  assert.equal(call('scoring.save', { scheme: { ...DEFAULT_SCHEME, current: 40, self: 30, control: 30 } }, t.dean).ok, true);
  assert.deepEqual([unit2('a1').self, unit2('a1').selfWork.value], [23, 23]);
});

test('journal.saveResults: the self-work of a unit with assignments is not typed by hand', () => {
  const s = scenario();
  const { call, store, t, a1, a2, sb1, snapshot } = s;
  const save = (unit, items, token = t.teacher1) => call('journal.saveResults', { subjectId: sb1, unit, field: 'self', items }, token);
  const before = snapshot();
  const logBefore = JSON.stringify(store.list('changeLog'));
  for (const token of [t.teacher1, t.dean, t.admin]) {
    const r = save(2, [{ studentId: a1, value: 10 }], token);
    assert.equal(r.ok, false);
    assert.deepEqual(r.error.fields, [{ field: 'unit', code: 'self_by_work' }]);
  }
  // before the check of the rows and before "nothing changed"
  assert.deepEqual(save(2, [{ studentId: a2, value: 16 }]).error.fields, [{ field: 'unit', code: 'self_by_work' }]);
  assert.deepEqual(save(2, [{ studentId: 'zzz', value: 99 }]).error.fields, [{ field: 'unit', code: 'self_by_work' }]);
  assert.deepEqual(snapshot(), before);
  assert.equal(JSON.stringify(store.list('changeLog')), logBefore);
  // an unknown unit is still a bad unit; the other fields and unit 1 are as before
  assert.deepEqual(save(7, [{ studentId: a1, value: 10 }]).error.fields, [{ field: 'unit', code: 'bad_value' }]);
  assert.equal(save(1, [{ studentId: a1, value: 10 }]).ok, true);
  assert.equal(call('journal.saveResults', { subjectId: sb1, unit: 2, field: 'control', items: [{ studentId: a2, value: 20 }] }, t.teacher1).ok, true);
  assert.equal(call('journal.saveResults', { subjectId: sb1, unit: 2, field: 'current', items: [{ studentId: a2, value: 20 }], reason: 'x' }, t.teacher1).ok, true);
});

test('a manual self-work comes back when the assignments of the unit are removed', () => {
  const s = setup();
  const { call, store, t, at, ids, a1, sb1, task } = s;
  at('2026-09-10', '12:00');
  store.insert('unitResults', { subjectId: sb1, studentId: a1, planSemester: 1, unit: 2, control: null, self: 16, currentManual: null, updatedBy: ids.teacher1, updatedAt: '2026-09-09 10:00:00' });
  const u = () => call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal.results[a1].units.find((x) => x.unit === 2);
  assert.deepEqual([u().self, 'selfWork' in u()], [16, false]);
  const A = task();
  assert.deepEqual([u().self, u().selfWork.pending], [null, 1]);
  assert.equal(call('work.remove', { assignmentId: A }, t.teacher1).ok, true);
  assert.deepEqual([u().self, 'selfWork' in u()], [16, false]);
  const j = call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal;
  assert.equal(j.units.some((x) => 'byWork' in x), false);
});

test('a task of another half of the plan or of another subject does not count; a hw does not count', () => {
  const s = setup();
  const { call, t, at, a1, sb1, sb2, task } = s;
  at('2026-09-10', '12:00');
  task({ planSemester: 2 });
  task({ subjectId: sb2, unit: 1 });
  task({ kind: 'hw', title: 'ДЗ' });
  const j = call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal;
  assert.equal(j.units.some((x) => 'byWork' in x), false);
  assert.equal('selfWork' in j.results[a1].units[1], false);
});

test('journal.log shows the assignment of a work row; the other rows have no new keys', () => {
  const s = scenario();
  const { call, store, t, A, sb1, grade, ids } = s;
  grade(A, 'a1', {});
  call('journal.saveResults', { subjectId: sb1, unit: 1, field: 'control', items: [{ studentId: ids.a1, value: 20 }] }, t.teacher1);
  for (const token of [t.teacher1, t.dean, t.prorector]) {
    const rows = call('journal.log', token === t.teacher1 ? { subjectId: sb1 } : {}, token).data.rows;
    const work = rows.filter((r) => r.entity === 'work');
    assert.deepEqual(work.map((r) => [r.field, r.assignmentId, r.assignmentTitle, r.studentName]).sort(), [['points', A, 'СРС А', 'Асанов Айдар'], ['status', A, 'СРС А', 'Асанов Айдар']]);
    for (const r of rows.filter((x) => x.entity !== 'work')) assert.equal('assignmentId' in r || 'assignmentTitle' in r, false);
  }
  // a row of a removed assignment keeps an empty title
  store.insert('changeLog', { at: '2026-09-25 10:00:00', actorId: ids.teacher1, entity: 'work', subjectId: sb1, assignmentId: 'gone', studentId: '', unit: 2, field: 'maxPoints', before: '10', after: '12', reason: '', late: false });
  const gone = call('journal.log', { subjectId: sb1 }, t.teacher1).data.rows.find((r) => r.assignmentId === 'gone');
  assert.equal(gone.assignmentTitle, '');
  assert.deepEqual(call('journal.log', { subjectId: s.sb2 }, t.teacher1).error.code, 'forbidden');
});

test('a changed maxPoints of a graded assignment is logged as work too (title in the log)', () => {
  const s = scenario();
  const { call, t, A, grade } = s;
  grade(A, 'a1', {});
  const r = call('work.save', { subjectId: s.sb1, id: A, kind: 'srs', unit: 2, title: 'СРС А', description: '', dueDate: '2026-09-20', dueTime: '23:59', maxPoints: 12 }, t.teacher1);
  assert.equal(r.ok, true);
  const row = call('journal.log', { subjectId: s.sb1 }, t.teacher1).data.rows.find((x) => x.field === 'maxPoints');
  assert.deepEqual([row.assignmentTitle, row.before, row.after], ['СРС А', '10', '12']);
});

test('journal.get and student.grades read each table once and write nothing', () => {
  const s = scenario();
  const { call, spy, t } = s;
  s.grade(s.A, 'a1', {});
  for (const [action, data, token] of [['journal.get', { subjectId: s.sb1 }, t.teacher1], ['student.grades', {}, t.a1]]) {
    spy.reset();
    assert.equal(call(action, data, token).ok, true);
    for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, `${action} ${table}`);
    assert.deepEqual(spy.writes, {});
  }
  assert.equal(JOURNAL_TABLES.includes('assignments') && JOURNAL_TABLES.includes('submissions'), true);
});

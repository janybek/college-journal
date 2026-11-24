// The card of the repeat course: candidates, enrolment, list, reading, editing, cancelling (task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';

const OLD = ['closures', 'subjectExams', 'examAttempts', 'unitResults', 'attendance', 'requests'];

function ready() {
  const s = setup();
  s.failed();
  s.at('2026-12-21');
  const enrol = (data, token = s.t.dean) => s.call('repeat.enrol', {
    subjectId: s.sb1, planSemester: 1, studentId: s.ids.a2, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1, ...data,
  }, token);
  const old = () => { const all = s.snapshot(); return Object.fromEntries(OLD.map((t) => [t, all[t]])); };
  return { s, enrol, old };
}
const logOf = (s, field) => s.store.list('changeLog').filter((r) => r.entity === 'repeat' && r.field === field);

test('repeat.enrol records the card with the snapshot and leaves the finished tables alone', () => {
  const { s, enrol, old } = ready();
  const was = old();
  const r = enrol({});
  assert.deepEqual([r.ok, r.data.repeat.status, r.data.repeat.prev.total, r.data.repeat.prev.word, r.data.repeat.prev.semester, r.data.repeat.result.status], [true, 'open', 58, 'fail', 38, 'not_admitted']);
  assert.deepEqual(old(), was);
  assert.deepEqual(enrol({}).error.fields, [{ field: 'studentId', code: 'has_open' }]);
  assert.deepEqual(enrol({ studentId: s.ids.a1 }).error.fields, [{ field: 'studentId', code: 'not_failed' }]);
  assert.deepEqual(enrol({ studentId: s.ids.a3, kind: 'exam' }).error.fields, [{ field: 'kind', code: 'not_admitted' }]);
  assert.equal(enrol({ studentId: s.ids.a3 }).data.repeat.prev.status, 'not_admitted');
  assert.equal(r.data.repeat.prev.fromRepeat, false);
  assert.deepEqual(s.store.list('repeats').map((c) => [c.studentId, c.status, c.works, c.prevRepeatId]), [[s.ids.a2, 'open', null, ''], [s.ids.a3, 'open', null, '']]);
  const row = logOf(s, 'enrol')[0];
  assert.deepEqual([row.entity, row.field, row.after, row.studentId, row.subjectId], ['repeat', 'enrol', 'full', s.ids.a2, s.sb1]);
  assert.equal(logOf(s, 'enrol').length, 2);
});

test('repeat.enrol: only the deanery and the administrator; a refusal writes nothing', () => {
  const { s, enrol } = ready();
  for (const token of [s.t.teacher1, s.t.prorector, s.t.a1]) {
    const b = s.snapshot();
    assert.equal(enrol({ studentId: s.ids.a3 }, token).error.code, 'forbidden');
    assert.deepEqual(s.snapshot(), b);
  }
  assert.equal(enrol({ studentId: s.ids.a3 }, s.t.admin).ok, true);
});

test('repeat.enrol: bad fields are one invalid and write nothing', () => {
  const { s, enrol } = ready();
  const b = s.snapshot();
  assert.deepEqual(enrol({ planSemester: 2 }).error.fields, [{ field: 'planSemester', code: 'final_open' }]);
  for (const planSemester of ['1', 9, [1], { a: 1 }, null]) {
    const r = enrol({ planSemester });
    assert.deepEqual([r.ok, r.error.code], [false, 'invalid']);
  }
  for (const subjectId of [['x'], 12, {}, ' ' + s.sb1 + ' ', '__proto__', undefined]) assert.equal(enrol({ subjectId }).error.code, 'not_found');
  for (const studentId of [['x'], 12, {}, s.ids.b1, ' ' + s.ids.a2, '__proto__', undefined]) assert.deepEqual(enrol({ studentId }).error.fields, [{ field: 'studentId', code: 'bad_ref' }]);
  assert.equal(enrol({ subjectId: s.sb2 }).error.fields[0].field, 'planSemester');
  s.store.update('staff', s.ids.teacher3, { active: false });
  for (const teacherId of [s.ids.a1, s.ids.teacher3, s.ids.prorector, ['x'], 5, {}, '__proto__', '', undefined]) assert.deepEqual(enrol({ teacherId }).error.fields, [{ field: 'teacherId', code: 'bad_ref' }]);
  assert.deepEqual(enrol({ orderNo: '  ' }).error.fields, [{ field: 'orderNo', code: 'required' }]);
  assert.deepEqual(enrol({ deadline: '2026-12-20' }).error.fields, [{ field: 'deadline', code: 'in_past' }]);
  assert.deepEqual(enrol({ kind: 'x' }).error.fields, [{ field: 'kind', code: 'bad_value' }]);
  assert.deepEqual(s.snapshot(), b);
});

test('repeat.enrol: the final sheet must be closed', () => {
  const s = setup();
  s.allUnits(); s.examHead(); s.examRow(s.ids.a2, { score: 20 });
  s.at('2026-12-17');
  const r = s.call('repeat.enrol', { subjectId: s.sb1, planSemester: 1, studentId: s.ids.a2, kind: 'full', orderNo: '1', orderDate: '2026-12-17', deadline: '2027-02-01', teacherId: s.ids.teacher1 }, s.t.dean);
  assert.deepEqual(r.error.fields, [{ field: 'planSemester', code: 'final_open' }]);
});

test('repeat.list and repeat.get by the rights of the card', () => {
  const { s } = ready();
  const c2 = s.repeatCard();
  const c3 = s.repeatCard({ studentId: s.ids.a3, prevAdmitted: false, prevStatus: 'not_admitted', prevSemester: 12, prevExam: null, prevTotal: null, prevWord: '', prevAttempts: '' });
  const cancelled = s.repeatCard({ studentId: s.ids.a1, status: 'cancelled', closedAt: '2026-12-22 10:00:00', closedBy: s.ids.dean });
  const list = (token) => s.call('repeat.list', {}, token);
  assert.deepEqual(list(s.t.dean).data.repeats.map((r) => r.id).sort(), [c2, c3, cancelled].sort());
  assert.equal(list(s.t.prorector).data.repeats.length, 3);
  assert.equal(list(s.t.admin).data.repeats.length, 3);
  assert.equal(list(s.t.dean).data.can.enrol, true);
  assert.equal(list(s.t.prorector).data.can.enrol, false);
  const mine = list(s.t.teacher1);
  assert.deepEqual([mine.data.repeats.length, mine.data.repeats.every((r) => r.own)], [3 - 1, true]);
  assert.equal(list(s.t.teacher2).data.repeats.length, 0);
  assert.equal(list(s.t.a1).error.code, 'forbidden');
  const row = list(s.t.dean).data.repeats.find((r) => r.id === c2);
  assert.deepEqual([row.studentName, row.groupName, row.subjectName, row.teacherName, row.status, row.kind, row.overdue], ['Өмүров Канат', '01-1', 'Информатика', 'Иванова Нургуль', 'open', 'full', false]);
  assert.equal(JSON.stringify(list(s.t.teacher1).data).includes('passwordHash'), false);

  assert.equal(s.call('repeat.get', { repeatId: c2 }, s.t.teacher2).error.code, 'forbidden');
  assert.equal(s.call('repeat.get', { repeatId: c2 }, s.t.prorector).ok, true);
  assert.equal(s.call('repeat.get', { repeatId: c2 }, s.t.a2).error.code, 'forbidden');
  assert.equal(s.call('repeat.get', { repeatId: cancelled }, s.t.dean).data.repeat.status, 'cancelled');
  for (const repeatId of [['x'], 12, {}, ' ' + c2 + ' ', '__proto__', undefined, null]) assert.equal(s.call('repeat.get', { repeatId }, s.t.dean).error.code, 'not_found');
  const v = s.call('repeat.get', { repeatId: c2 }, s.t.teacher1).data.repeat;
  assert.deepEqual([v.student.fullName, v.student.groupName, v.teacher.fullName, v.subject.name, v.order.no, v.prev.total, v.prev.attempts.length, v.can.works, v.can.attempt, v.can.edit, v.can.cancel, v.can.close, v.can.commission],
    ['Өмүров Канат', '01-1', 'Иванова Нургуль', 'Информатика', '15-с', 58, 1, true, false, false, false, true, false]);
  assert.equal(JSON.stringify(v).includes('passwordHash'), false);
  const d = s.call('repeat.get', { repeatId: c2 }, s.t.dean).data.repeat;
  assert.deepEqual([d.can.edit, d.can.cancel, d.can.commission, d.can.reopen, d.split.semester, d.split.exam, d.split.admission, d.scheme.fair], [true, true, true, false, 60, 40, 30, 60]);
  assert.equal(s.call('repeat.get', { repeatId: c2 }, s.t.admin).data.repeat.can.reopen, false);
});

test('cancelled card: the teacher of the repeat gets forbidden; the current teacher of the subject does not see another card', () => {
  const { s } = ready();
  const c = s.repeatCard({ status: 'cancelled', closedAt: '2026-12-22 10:00:00' });
  assert.equal(s.call('repeat.get', { repeatId: c }, s.t.teacher1).error.code, 'forbidden');
  const d = s.repeatCard({ studentId: s.ids.a3, teacherId: s.ids.teacher2 });
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher3 });
  assert.equal(s.call('repeat.get', { repeatId: d }, s.t.teacher3).error.code, 'forbidden');
  assert.equal(s.call('repeat.get', { repeatId: d }, s.t.teacher2).ok, true);
  assert.equal(s.call('repeat.list', {}, s.t.teacher3).data.repeats.length, 0);
  assert.equal(s.call('repeat.list', {}, s.t.teacher1).data.repeats.length, 0);
});

test('repeat.save: the deanery edits, the old deadline may stay, the rights move with the teacher', () => {
  const { s } = ready();
  const c = s.repeatCard();
  const save = (data, token = s.t.dean) => s.call('repeat.save', { repeatId: c, orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1, ...data }, token);
  const b = s.snapshot();
  assert.equal(save({}).ok, true);
  assert.deepEqual(s.snapshot(), b);
  for (const token of [s.t.teacher1, s.t.prorector, s.t.a2]) { assert.equal(save({ orderNo: 'x' }, token).error.code, 'forbidden'); assert.deepEqual(s.snapshot(), b); }
  const r = save({ deadline: '2027-03-01', teacherId: s.ids.teacher2 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.data.repeat.deadline, r.data.repeat.teacher.id], ['2027-03-01', s.ids.teacher2]);
  assert.deepEqual(logOf(s, 'deadline').map((x) => [x.before, x.after]), [['2027-02-01', '2027-03-01']]);
  assert.deepEqual(logOf(s, 'teacher').map((x) => [x.before, x.after]), [['Иванова Нургуль', 'Петров Эрмек']]);
  assert.equal(s.store.list('changeLog').filter((x) => x.entity === 'repeat').length, 2);
  assert.equal(s.call('repeat.get', { repeatId: c }, s.t.teacher1).error.code, 'forbidden');
  assert.equal(s.call('repeat.get', { repeatId: c }, s.t.teacher2).ok, true);
  const b2 = s.snapshot();
  assert.deepEqual(save({ deadline: '2026-12-20' }).error.fields, [{ field: 'deadline', code: 'in_past' }]);
  assert.deepEqual(save({ teacherId: s.ids.a1 }).error.fields, [{ field: 'teacherId', code: 'bad_ref' }]);
  assert.equal(save({ repeatId: ['x'] }).error.code, 'not_found');
  assert.deepEqual(s.snapshot(), b2);
});

test('repeat.save on a card whose deadline passed; the order date is not after the first attempt', () => {
  const { s } = ready();
  const c = s.repeatCard({ deadline: '2027-01-20' });
  s.repeatTry(c, { date: '2027-01-15' });
  s.at('2027-02-01');
  const save = (data) => s.call('repeat.save', { repeatId: c, orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-01-20', teacherId: s.ids.teacher1, ...data }, s.t.dean);
  assert.equal(save({ orderNo: '16-с' }).ok, true);
  assert.deepEqual(save({ deadline: '2027-01-31' }).error.fields, [{ field: 'deadline', code: 'in_past' }]);
  assert.deepEqual(save({ orderDate: '2027-01-16' }).error.fields, [{ field: 'orderDate', code: 'after_attempt' }]);
  assert.equal(save({ orderDate: '2027-01-15' }).ok, true);
  assert.equal(s.store.get('repeats', c).orderDate, '2027-01-15');
});

test('repeat.save and repeat.cancel on a closed or cancelled card: repeat_closed', () => {
  const { s } = ready();
  for (const status of ['passed', 'failed', 'cancelled']) {
    const c = s.repeatCard({ status, closedAt: '2026-12-22 10:00:00' });
    const b = s.snapshot();
    assert.equal(s.call('repeat.save', { repeatId: c, orderNo: 'z', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1 }, s.t.dean).error.code, 'repeat_closed');
    assert.equal(s.call('repeat.cancel', { repeatId: c, reason: 'ошибка' }, s.t.dean).error.code, 'repeat_closed');
    assert.deepEqual(s.snapshot(), b);
  }
});

test('repeat.cancel: reason, no results, the student may be enrolled again', () => {
  const { s, enrol } = ready();
  const first = enrol({}).data.repeat.id;
  const b = s.snapshot();
  for (const token of [s.t.teacher1, s.t.prorector, s.t.a2]) assert.equal(s.call('repeat.cancel', { repeatId: first, reason: 'ошибка' }, token).error.code, 'forbidden');
  for (const reason of [undefined, '', '   ', 5, ['x'], 'я'.repeat(301)]) assert.equal(s.call('repeat.cancel', { repeatId: first, reason }, s.t.dean).error.code, 'invalid');
  assert.equal(s.call('repeat.cancel', { repeatId: ['x'], reason: 'ошибка' }, s.t.dean).error.code, 'not_found');
  assert.deepEqual(s.snapshot(), b);
  const r = s.call('repeat.cancel', { repeatId: first, reason: 'записали по ошибке' }, s.t.dean);
  assert.deepEqual([r.ok, r.data.repeat.status], [true, 'cancelled']);
  const card = s.store.get('repeats', first);
  assert.deepEqual([card.status, card.closedBy, card.closedAt !== ''], ['cancelled', s.ids.dean, true]);
  const row = logOf(s, 'status')[0];
  assert.deepEqual([row.before, row.after, row.reason], ['open', 'cancelled', 'записали по ошибке']);
  assert.equal(s.call('repeat.list', {}, s.t.teacher2).data.repeats.length, 0);
  assert.equal(s.call('repeat.list', {}, s.t.teacher1).data.repeats.length, 0);
  assert.equal(enrol({}).ok, true);
});

test('repeat.cancel is refused when there are works or an attempt', () => {
  const { s } = ready();
  const withWorks = s.repeatCard({ works: 0 });
  const withTry = s.repeatCard({ studentId: s.ids.a3 });
  s.repeatTry(withTry);
  const b = s.snapshot();
  for (const id of [withWorks, withTry]) assert.deepEqual(s.call('repeat.cancel', { repeatId: id, reason: 'ошибка' }, s.t.dean).error.fields, [{ field: 'repeat', code: 'has_results' }]);
  assert.deepEqual(s.snapshot(), b);
  assert.equal(s.call('repeat.get', { repeatId: withTry }, s.t.dean).data.repeat.can.cancel, false);
});

test('the card stays after the semester is switched, and the snapshot of a new enrolment is the same', () => {
  const { s, enrol } = ready();
  const a2 = enrol({}).data.repeat.id;
  const a3 = enrol({ studentId: s.ids.a3 }).data.repeat;
  const prev = a3.prev;
  assert.equal(s.call('repeat.cancel', { repeatId: a3.id, reason: 'пока рано' }, s.t.dean).ok, true);
  assert.equal(s.switchSemester().ok, true);
  assert.equal(s.call('repeat.list', {}, s.t.dean).data.repeats.map((r) => r.id).includes(a2), true);
  const cand = s.call('repeat.candidates', { subjectId: s.sb1 }, s.t.dean).data;
  assert.deepEqual([cand.halves[0].planSemester, cand.halves[0].current], [1, false]);
  const again = enrol({ studentId: s.ids.a3, deadline: '2027-03-01', orderDate: '2027-01-11' });
  assert.equal(again.ok, true);
  assert.deepEqual(again.data.repeat.prev, prev);
});

test('a forced close (failed, no attempt) does not stop a new enrolment; a second repeat takes the snapshot of the first', () => {
  const { s, enrol } = ready();
  s.repeatCard({ kind: 'exam', status: 'failed', closedBy: s.ids.dean, closedAt: '2027-02-05 10:00:00', deadline: '2027-02-01' });
  s.at('2027-02-10');
  const r = enrol({ deadline: '2027-03-01' });
  assert.deepEqual([r.ok, r.data.repeat.prev.fromRepeat, r.data.repeat.prev.status], [true, true, 'none']);

  const t = ready();
  const id = t.s.repeatCard({ status: 'failed', works: 45, closedBy: t.s.ids.dean, closedAt: '2027-01-20 10:00:00' });
  t.s.repeatTry(id, { score: 10 });
  t.s.at('2027-01-25');
  const second = t.enrol({ deadline: '2027-03-01' });
  assert.deepEqual([second.ok, second.data.repeat.prev.total, second.data.repeat.prev.semester, second.data.repeat.prev.fromRepeat], [true, 55, 45, true]);
  assert.equal(t.s.store.list('repeats').find((c) => c.prevRepeatId === id).prevRepeatId, id);
});

test('a student who passed the repeat is not enrolled again', () => {
  const { s, enrol } = ready();
  s.repeatCard({ status: 'passed', works: 45, closedBy: s.ids.dean, closedAt: '2026-12-30 10:00:00' });
  assert.deepEqual(enrol({}).error.fields, [{ field: 'studentId', code: 'passed' }]);
});

test('the card is kept when the student moved to another group and left; the group is the one of the subject', () => {
  const { s } = ready();
  const c = s.repeatCard();
  s.store.update('students', s.ids.a2, { groupId: s.g2, active: false });
  const row = s.call('repeat.list', {}, s.t.dean).data.repeats.find((r) => r.id === c);
  assert.deepEqual([row.studentName, row.groupName], ['Өмүров Канат', '01-1']);
  const v = s.call('repeat.get', { repeatId: c }, s.t.dean).data.repeat;
  assert.deepEqual([v.student.fullName, v.student.groupName], ['Өмүров Канат', '01-1']);
});

test('repeat.candidates: subjects with a closed final sheet; students who may repeat', () => {
  const { s, enrol } = ready();
  const all = s.call('repeat.candidates', {}, s.t.dean);
  assert.deepEqual(all.data.subjects.map((x) => [x.subjectId, x.halves, x.groupName, x.teacherName]), [[s.sb1, [1], '01-1', 'Иванова Нургуль']]);
  for (const token of [s.t.teacher1, s.t.prorector, s.t.a1]) assert.equal(s.call('repeat.candidates', {}, token).error.code, 'forbidden');
  assert.equal(s.call('repeat.candidates', { subjectId: s.sb1 }, s.t.teacher1).error.code, 'forbidden');
  for (const subjectId of [['x'], 12, {}, '__proto__', ' ' + s.sb1]) assert.equal(s.call('repeat.candidates', { subjectId }, s.t.dean).error.code, 'not_found');
  enrol({});
  const c = s.call('repeat.candidates', { subjectId: s.sb1 }, s.t.dean).data;
  assert.deepEqual([c.subject.id, c.subject.groupName, c.subject.teacherId], [s.sb1, '01-1', s.ids.teacher1]);
  assert.deepEqual(c.teachers.map((t) => t.fullName), ['Деканова Айгуль', 'Иванова Нургуль', 'Петров Эрмек', 'Сидорова Алина']);
  const students = c.halves[0].students;
  assert.equal(students.some((x) => x.id === s.ids.a1), false);
  const a2 = students.find((x) => x.id === s.ids.a2);
  const a3 = students.find((x) => x.id === s.ids.a3);
  assert.deepEqual([a2.blocked, a2.suggest, a2.prev.total, a2.prev.tries, a2.prev.retakesLeft], ['has_open', null, 58, 1, true]);
  assert.deepEqual([a3.blocked, a3.suggest, a3.prev.status, a3.prev.admitted], [null, 'full', 'not_admitted', false]);
  assert.equal(JSON.stringify(c).includes('passwordHash'), false);
});

test('repeat.enrol and repeat.candidates read every table once', () => {
  const { s, enrol } = ready();
  const tables = ['repeats', 'repeatAttempts', 'subjects', 'groups', 'staff', 'students', 'settings', 'syllabi', 'closures', 'pairs', 'attendance', 'unitResults', 'subjectExams', 'examAttempts'];
  const once = (call, need) => {
    s.spy.reset();
    assert.equal(call().ok, true);
    for (const t of tables) assert.ok((s.spy.lists[t] || 0) <= 1, t);
    for (const t of need) assert.equal(s.spy.lists[t], 1, t);
  };
  once(() => s.call('repeat.candidates', { subjectId: s.sb1 }, s.t.dean), tables);
  once(() => s.call('repeat.candidates', {}, s.t.dean), ['subjects', 'groups', 'staff', 'closures', 'syllabi', 'settings']);
  once(() => enrol({ studentId: s.ids.a3 }), tables);
  once(() => s.call('repeat.list', {}, s.t.dean), ['repeats', 'repeatAttempts', 'subjects', 'groups', 'staff', 'students', 'settings']);
  once(() => s.call('repeat.get', { repeatId: s.store.list('repeats')[0].id }, s.t.dean), ['repeats', 'repeatAttempts', 'settings']);
});

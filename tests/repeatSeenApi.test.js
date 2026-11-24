// Where the repeat course is seen: the student, the ledger, the change log, the deletions (task 6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { LEDGER_TABLES } from '../backend/ledgerData.js';

// the card of a2 through real requests: works 45, the exam 30 -> 75 fair
function ready({ withScores = true } = {}) {
  const s = setup();
  s.failed();
  s.at('2026-12-21');
  const enrolled = s.call('repeat.enrol', {
    subjectId: s.sb1, planSemester: 1, studentId: s.ids.a2, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1,
  }, s.t.dean);
  const id = enrolled.data.repeat.id;
  s.at('2027-01-20');
  if (withScores) {
    assert.equal(s.call('repeat.saveWorks', { repeatId: id, works: 45, note: 'Реферат' }, s.t.teacher1).ok, true);
    assert.equal(s.call('repeat.saveAttempt', { repeatId: id, date: '2027-01-15', outcome: 'score', score: 30 }, s.t.teacher1).ok, true);
  }
  return { s, id };
}

test('the student sees the own card in student.grades and repeat.mine, nobody else does', () => {
  const { s, id } = ready();
  const g = (who = s.t.a2) => s.call('student.grades', {}, who).data;
  assert.deepEqual(g().repeats.map((x) => [x.kind, x.status, x.total, x.word, x.preliminary, x.prev.total, x.prev.word]), [['full', 'open', 75, 'fair', true, 58, 'fail']]);
  assert.deepEqual(g().subjects[0].repeat, { kind: 'full', status: 'open', total: 75, word: 'fair', main: false });
  const card = g().repeats[0];
  assert.deepEqual([card.subjectName, card.planSemester, card.orderNo, card.works, card.attempts, card.exam, card.overdue], ['Информатика', 1, '15-с', { value: 45, note: 'Реферат', max: 60 }, [{ no: 1, date: '2027-01-15', outcome: 'score', score: 30 }], 30, false]);
  const mine = s.call('repeat.mine', {}, s.t.a2);
  assert.deepEqual([mine.ok, Object.keys(mine.data).sort(), mine.data.repeats.length, mine.data.split.semester], [true, ['repeats', 'split', 'today'], 1, 60]);

  const own = JSON.stringify(g()) + JSON.stringify(mine.data);
  const attemptId = s.store.list('repeatAttempts')[0].id;
  for (const bad of ['commission', id, attemptId, 'Асанов', 'Ёлкин', 'Беков']) assert.equal(own.includes(bad), false, bad);

  s.call('repeat.close', { repeatId: id }, s.t.teacher1);
  assert.deepEqual([g().subjects[0].repeat.main, g().subjects[0].repeat.status], [true, 'passed']);
  assert.equal(g().repeats[0].preliminary, false);

  const other = JSON.stringify(s.call('student.grades', {}, s.t.a1).data) + JSON.stringify(s.call('repeat.mine', {}, s.t.a1).data);
  for (const bad of [s.ids.a2, 'Өмүров', 'repeats":[{', id, attemptId]) assert.equal(other.includes(bad), false, String(bad));
  assert.equal('repeats' in g(s.t.a1), false);
  assert.equal('repeat' in g(s.t.a1).subjects[0], false);
  assert.deepEqual(s.call('repeat.mine', {}, s.t.a1).data.repeats, []);
  assert.equal(s.call('repeat.mine', {}, s.t.dean).error.code, 'forbidden');
  assert.equal(s.call('repeat.mine', {}, s.t.teacher1).error.code, 'forbidden');
});

test('the card stays after the semester switch, a change of group and a change of the teacher of the subject', () => {
  const { s } = ready({ withScores: false });
  const mine = () => s.call('repeat.mine', {}, s.t.a2).data.repeats.map((x) => [x.subjectName, x.planSemester, x.status]);
  assert.deepEqual(mine(), [['Информатика', 1, 'open']]);
  s.switchSemester();
  assert.deepEqual(mine(), [['Информатика', 1, 'open']]);
  s.store.update('students', s.ids.a2, { groupId: s.g2 });
  assert.deepEqual(mine(), [['Информатика', 1, 'open']]);
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher3 });
  const r = s.call('repeat.mine', {}, s.t.a2).data.repeats[0];
  assert.deepEqual([r.subjectName, r.teacherName], ['Информатика', 'Иванова Нургуль']);
});

test('a cancelled card is not given to the student; the newest card comes first', () => {
  const { s, id } = ready({ withScores: false });
  assert.equal(s.call('repeat.cancel', { repeatId: id, reason: 'ошибка в приказе' }, s.t.dean).ok, true);
  assert.deepEqual(s.call('repeat.mine', {}, s.t.a2).data.repeats, []);
  const g = s.call('student.grades', {}, s.t.a2).data;
  assert.equal('repeats' in g, false);
  assert.equal('repeat' in g.subjects[0], false);
  assert.equal(g.subjects[0].final.canRetake, true);

  const older = s.repeatCard({ status: 'failed', closedAt: '2027-01-30 10:00:00', createdAt: '2026-12-22 10:00:00', orderNo: 'старый' });
  const newer = s.repeatCard({ createdAt: '2027-02-01 10:00:00', orderNo: 'новый' });
  assert.ok(older && newer);
  assert.deepEqual(s.call('repeat.mine', {}, s.t.a2).data.repeats.map((x) => x.orderNo), ['новый', 'старый']);
  assert.equal(s.call('student.grades', {}, s.t.a2).data.subjects[0].repeat.status, 'open');
});

test('the ledger marks the repeat, the student has no next try and the final try is refused as on_repeat', () => {
  const { s } = ready();
  s.at('2026-12-22');
  const view = () => s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger.students;
  const row = (id) => view().find((x) => x.id === id);
  assert.deepEqual(row(s.ids.a2).repeat.kind, 'full');
  assert.equal(row(s.ids.a2).next, null);
  assert.equal('repeat' in row(s.ids.a1), false);
  const keysA1 = Object.keys(row(s.ids.a1)).sort();
  const plain = setup();
  plain.failed();
  plain.at('2026-12-22');
  const plainRow = plain.call('ledger.get', { subjectId: plain.sb1 }, plain.t.dean).data.ledger.students.find((x) => x.id === plain.ids.a1);
  assert.deepEqual(keysA1, Object.keys(plainRow).sort());
  // the same on the sheet of the teacher of the subject: only the mark
  const t1 = s.call('ledger.get', { subjectId: s.sb1 }, s.t.teacher1).data.ledger.students.find((x) => x.id === s.ids.a2);
  assert.deepEqual(t1.repeat, { kind: 'full', status: 'open', total: 75, word: 'fair', main: false });

  const before = s.snapshot();
  const r = s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.ids.a2, date: '2026-12-22', outcome: 'score', score: 25, commission: '' }, s.t.dean);
  assert.deepEqual([r.ok, r.error.code, r.error.fields], [false, 'invalid', [{ field: 'studentId', code: 'on_repeat' }]]);
  assert.deepEqual(s.snapshot(), before);
  // a student without a card: not the code of the repeat
  const other = s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.ids.a3, date: '2026-12-22', outcome: 'score', score: 25, commission: '' }, s.t.dean);
  assert.equal(JSON.stringify(other.error).includes('on_repeat'), false);
});

test('on_repeat comes before the refusal of an exhausted student', () => {
  const s = setup();
  s.failed();
  s.examRow(s.ids.a2, { no: 2, score: 20, date: '2026-12-16' });
  s.examRow(s.ids.a2, { no: 3, score: 20, date: '2026-12-17' });
  s.at('2026-12-22');
  const ask = () => s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.ids.a2, date: '2026-12-22', outcome: 'score', score: 25, commission: 'комиссия' }, s.t.dean);
  assert.deepEqual(ask().error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  s.repeatCard();
  assert.deepEqual(ask().error.fields, [{ field: 'studentId', code: 'on_repeat' }]);
});

test('Возможна пересдача: canRetake is false with a card, as before without or with a cancelled one', () => {
  const s = setup();
  s.failed();
  s.at('2026-12-22');
  const can = () => s.call('student.grades', {}, s.t.a2).data.subjects[0].final.canRetake;
  assert.equal(can(), true);
  const id = s.repeatCard({ createdAt: '2026-12-22 08:00:00' });
  assert.equal(can(), false);
  s.store.update('repeats', id, { status: 'cancelled' });
  assert.equal(can(), true);
});

test('the change log: lines of the repeat only for the office and the teacher of the repeat', () => {
  const { s, id } = ready();
  s.store.insert('changeLog', { at: '2027-01-21 10:00:00', actorId: s.ids.teacher1, entity: 'ledger', subjectId: s.sb1, pairId: '', studentId: '', unit: null, field: 'closed', before: 'open', after: 'closed', reason: '', late: false });
  const log = (token, data = { subjectId: s.sb1 }) => s.call('journal.log', data, token);
  const repeatRows = (r) => r.data.rows.filter((x) => x.entity === 'repeat');
  for (const token of [s.t.dean, s.t.prorector, s.t.admin, s.t.teacher1]) assert.ok(repeatRows(log(token)).length >= 3);
  assert.deepEqual(repeatRows(log(s.t.dean)).map((x) => x.studentName).filter((n) => n !== 'Өмүров Канат'), []);

  // teacher3 teaches the subject now but does not teach the repeat
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher3 });
  const r3 = log(s.t.teacher3);
  assert.deepEqual([r3.ok, repeatRows(r3).length, r3.data.rows.length > 0], [true, 0, true]);
  // the teacher of the repeat who does not teach the subject: the lines of the repeat only
  const r1 = log(s.t.teacher1);
  assert.deepEqual([r1.ok, r1.data.rows.length === repeatRows(r1).length, repeatRows(r1).length >= 3], [true, true, true]);
  assert.equal(log(s.t.teacher1, {}).error.code, 'forbidden');
  assert.equal(log(s.t.teacher2).error.code, 'forbidden');

  // the deanery changes the teacher of the repeat
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher1 });
  const saved = s.call('repeat.save', { repeatId: id, orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher2 }, s.t.dean);
  assert.equal(saved.ok, true);
  assert.deepEqual([repeatRows(log(s.t.teacher1)).length, log(s.t.teacher1).data.rows.length > 0], [0, true]);
  const r2 = log(s.t.teacher2);
  assert.deepEqual([r2.ok, repeatRows(r2).length >= 4, r2.data.rows.length === repeatRows(r2).length], [true, true, true]);

  // a cancelled card: the teacher does not see its lines
  const second = setup();
  second.failed();
  second.at('2026-12-21');
  const cid = second.call('repeat.enrol', { subjectId: second.sb1, planSemester: 1, studentId: second.ids.a2, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: second.ids.teacher2 }, second.t.dean).data.repeat.id;
  assert.ok(repeatRows(second.call('journal.log', { subjectId: second.sb1 }, second.t.teacher2)).length >= 1);
  second.call('repeat.cancel', { repeatId: cid, reason: 'ошибка' }, second.t.dean);
  assert.equal(second.call('journal.log', { subjectId: second.sb1 }, second.t.teacher2).error.code, 'forbidden');
  second.store.update('subjects', second.sb1, { teacherId: second.ids.teacher2 });
  assert.equal(repeatRows(second.call('journal.log', { subjectId: second.sb1 }, second.t.teacher2)).length, 0);
  assert.ok(repeatRows(second.call('journal.log', { subjectId: second.sb1 }, second.t.dean)).length >= 2);
});

test('the hidden lines do not eat the limit and do not give an empty page with "more"', () => {
  const { s } = ready({ withScores: false });
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher3 });
  s.store.insertMany('changeLog', Array.from({ length: 30 }, (_, i) => ({
    at: `2027-02-01 10:${String(i).padStart(2, '0')}:00`, actorId: s.ids.dean, entity: 'repeat', subjectId: s.sb1, pairId: '', studentId: s.ids.a2, unit: null,
    field: 'works', before: '', after: String(i), reason: '', late: false,
  })));
  const others = Array.from({ length: 3 }, (_, i) => ({
    at: `2027-01-0${i + 1} 10:00:00`, actorId: s.ids.teacher3, entity: 'ledger', subjectId: s.sb1, pairId: '', studentId: '', unit: null, field: 'closed', before: 'open', after: 'closed', reason: '', late: false,
  }));
  s.store.insertMany('changeLog', others);
  // the 4 lines of the set-up and the 3 above are the 7 lines of the others
  const r = s.call('journal.log', { subjectId: s.sb1, limit: 8 }, s.t.teacher3);
  assert.deepEqual([r.data.rows.length, r.data.more, r.data.rows.some((x) => x.entity === 'repeat')], [7, false, false]);
  const d = s.call('journal.log', { subjectId: s.sb1, limit: 5 }, s.t.dean);
  assert.deepEqual([d.data.rows.length, d.data.more], [5, true]);
});

test('student.grades and ledger.get read every table once, the repeat tables too', () => {
  const { s } = ready();
  s.spy.reset();
  assert.equal(s.call('student.grades', {}, s.t.a2).ok, true);
  assert.equal(s.spy.lists.repeats, 1);
  assert.equal(s.spy.lists.repeatAttempts, 1);
  for (const [table, n] of Object.entries(s.spy.lists)) assert.equal(n, 1, table);
  s.spy.reset();
  assert.equal(s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).ok, true);
  for (const table of LEDGER_TABLES) assert.equal(s.spy.lists[table], 1, table);
  assert.ok(LEDGER_TABLES.includes('repeats') && LEDGER_TABLES.includes('repeatAttempts'));
  s.spy.reset();
  assert.equal(s.call('repeat.mine', {}, s.t.a2).ok, true);
  for (const [table, n] of Object.entries(s.spy.lists)) assert.equal(n, 1, table);
});

test('a card blocks the deletion of its student, subject and staff; others are deleted as before', () => {
  const s = setup();
  const student = () => s.store.insert('students', { fullName: 'Новый Студент', groupId: s.g1, cardNo: 'N' + Math.random(), passwordHash: 'x', lang: 'ky', mustChangePassword: false, active: true }).id;
  const staff = (login) => s.store.insert('staff', { fullName: login, login, passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const subject = () => s.store.insert('subjects', { name: 'Пустой', disciplineId: s.ds1, groupId: s.g1, teacherId: s.ids.teacher1, scheme: 'A' }).id;
  const remove = (table, id) => s.call('dir.remove', { table, id }, s.t.admin);

  const st = student();
  const free = student();
  s.repeatCard({ studentId: st });
  assert.equal(remove('students', st).error.code, 'in_use');
  assert.equal(remove('students', free).ok, true);

  const sb = subject();
  const freeSb = subject();
  s.repeatCard({ subjectId: sb, studentId: s.ids.a1 });
  assert.equal(remove('subjects', sb).error.code, 'in_use');
  assert.equal(remove('subjects', freeSb).ok, true);

  const t1 = staff('t_teacher');
  const t2 = staff('t_created');
  const t3 = staff('t_closed');
  const t4 = staff('t_attempt');
  const t5 = staff('t_free');
  s.repeatCard({ studentId: s.ids.a1, teacherId: t1 });
  s.repeatCard({ studentId: s.ids.a3, createdBy: t2, updatedBy: s.ids.dean });
  s.repeatCard({ studentId: s.ids.b1, closedBy: t3, updatedBy: s.ids.dean });
  const card = s.repeatCard({ studentId: s.ids.a4 });
  s.repeatTry(card, { updatedBy: t4 });
  for (const id of [t1, t2, t3, t4]) assert.equal(remove('staff', id).error.code, 'in_use', id);
  assert.equal(remove('staff', t5).ok, true);
});

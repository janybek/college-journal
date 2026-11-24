import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { LEDGER_TABLES } from '../backend/ledgerData.js';

const rowOf = (v, id) => v.students.find((x) => x.id === id);
const week = (s) => { for (const [key, value] of [['examStart', '2026-12-14'], ['examEnd', '2026-12-20']]) s.store.insert('settings', { key, value }); };
const ready = () => { const s = setup(); s.allUnits(); s.at('2026-12-15'); week(s); return s; };
const saver = (s) => (data, token = s.t.teacher1) => s.call('ledger.saveExam', { subjectId: s.sb1, date: '2026-12-15', examiner: '', assistants: 'Ассистент Первый', items: [], reason: '', ...data }, token);
const adder = (s) => (data, token = s.t.teacher1) => s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.a2, date: '2027-01-12', outcome: 'score', score: 21, commission: '', ...data }, token);
const examLog = (s) => s.store.list('changeLog').filter((r) => r.entity === 'subjectExam');

test('ledger.saveExam: rights, checks and refusals write nothing; the head and the first results', () => {
  const s = ready();
  const save = saver(s);
  const before = s.snapshot();
  for (const who of ['teacher2', 'teacher3', 'prorector', 'a1']) assert.equal(save({}, s.t[who]).error.code, 'forbidden', who);
  for (const subjectId of [[s.sb1], 5, '__proto__', ' ' + s.sb1]) assert.equal(save({ subjectId }).error.code, 'not_found');
  assert.equal(s.call('ledger.saveExam', { subjectId: s.sb2, date: '2026-12-15', items: [] }, s.t.teacher2).error.code, 'no_syllabus');
  assert.deepEqual(save({ date: '2026-12-10' }).error, { code: 'invalid', fields: [{ field: 'date', code: 'out_of_exam' }] });
  assert.deepEqual(save({ date: '2026-12-16', items: [{ studentId: s.a1, outcome: 'score', score: 35 }] }).error.fields, [{ field: 'date', code: 'in_future' }]);
  assert.deepEqual(save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a3, outcome: 'score', score: 30 }] }).error.fields, [{ index: 1, field: 'studentId', code: 'not_admitted' }]);
  assert.deepEqual(save({ items: [{ studentId: s.b1, outcome: 'absent', score: null }] }).error.fields, [{ index: 0, field: 'studentId', code: 'bad_ref' }]);
  for (const item of [{ outcome: 'score', score: 41 }, { outcome: 'score', score: '35' }, { outcome: 'absent', score: 0 }]) {
    assert.deepEqual(save({ items: [{ studentId: s.a1, ...item }] }).error.fields, [{ index: 0, field: 'score', code: 'bad_value' }]);
  }
  assert.deepEqual(save({ items: [{ studentId: s.a1, outcome: 'passed', score: null }] }).error.fields, [{ index: 0, field: 'outcome', code: 'bad_value' }]);
  assert.deepEqual(save({ items: [{ studentId: s.a1, outcome: null, score: 5 }] }).error.fields, [{ index: 0, field: 'score', code: 'bad_value' }]);
  for (const items of ['x', undefined, { 0: {} }, [null], [{ studentId: s.a1, outcome: 'absent', score: null }, { studentId: s.a1, outcome: 'absent', score: null }], [{ studentId: [s.a1], outcome: 'absent', score: null }], Array.from({ length: 201 }, () => ({ studentId: s.a1 }))]) {
    assert.equal(save({ items }).error.code, 'bad_request');
  }
  assert.equal(save({ examiner: 5 }).error.code, 'invalid');
  assert.deepEqual(save({ assistants: 'я'.repeat(301) }).error.fields, [{ field: 'assistants', code: 'too_long' }]);
  assert.deepEqual(s.snapshot(), before);

  // the head with a future date and no results is saved (the sheet is printed before the exam)
  const head = save({ date: '2026-12-16' }).data.ledger.exam;
  assert.deepEqual([head.ready, head.date, head.assistants], [true, '2026-12-16', 'Ассистент Первый']);
  const view = save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] }).data.ledger;
  assert.deepEqual([rowOf(view, s.a1).total, rowOf(view, s.a1).word, rowOf(view, s.a2).total, rowOf(view, s.a2).word, rowOf(view, s.a3).status], [82, 'good', 58, 'fail', 'not_admitted']);
  assert.equal(view.exam.date, '2026-12-15');
  assert.equal(s.store.list('subjectExams').length, 1);
  assert.deepEqual(examLog(s).map((r) => [r.studentId, r.field, r.before, r.after, r.reason, r.unit]), [[s.a1, 'try1', '', '35', '', null], [s.a2, 'try1', '', '20', '', null]]);
  assert.deepEqual(s.store.list('examAttempts').map((r) => [r.no, r.date, r.commission, r.updatedBy]), [[1, '2026-12-15', '', s.ids.teacher1], [1, '2026-12-15', '', s.ids.teacher1]]);
  assert.equal(JSON.stringify(view).includes('passwordHash'), false);

  // the head with the attempts in: a future date is refused and nothing moves
  const mid = s.snapshot();
  assert.deepEqual(save({ date: '2026-12-16' }).error.fields, [{ field: 'date', code: 'in_future' }]);
  assert.deepEqual(s.snapshot(), mid);
});

test('ledger.saveExam: a change needs a reason; the same values write nothing; absent, incomplete, erase, the date of the head', () => {
  const s = ready();
  const save = saver(s);
  save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] });
  const before = s.snapshot();
  assert.deepEqual(save({ items: [{ studentId: s.a1, outcome: 'score', score: 33 }] }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(save({ items: [{ studentId: s.a1, outcome: 'score', score: 33 }], reason: 'я'.repeat(301) }).error.fields, [{ field: 'reason', code: 'too_long' }]);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(rowOf(save({ items: [{ studentId: s.a1, outcome: 'score', score: 33 }], reason: 'описка в ведомости' }).data.ledger, s.a1).total, 80);
  assert.deepEqual(examLog(s).slice(2).map((r) => [r.field, r.before, r.after, r.reason]), [['try1', '35', '33', 'описка в ведомости']]);
  assert.equal(s.store.list('examAttempts').length, 2);

  // the same values: nothing is written
  s.spy.reset();
  assert.equal(save({ items: [{ studentId: s.a1, outcome: 'score', score: 33 }, { studentId: s.a2, outcome: 'score', score: 20 }] }).ok, true);
  assert.deepEqual(s.spy.writes, {});

  const absent = rowOf(save({ items: [{ studentId: s.a2, outcome: 'absent' }], reason: 'не пришёл' }).data.ledger, s.a2);
  assert.deepEqual([absent.status, absent.total, absent.tries], ['absent', null, 1]);
  const incomplete = rowOf(save({ items: [{ studentId: s.a2, outcome: 'incomplete', score: null }], reason: 'болел' }).data.ledger, s.a2);
  assert.deepEqual([incomplete.status, incomplete.total, incomplete.tries], ['incomplete', null, 0]);
  const erased = rowOf(save({ items: [{ studentId: s.a2, outcome: null, score: null }], reason: 'внесено по ошибке' }).data.ledger, s.a2);
  assert.deepEqual([erased.status, erased.attempts, erased.next], ['none', [], { no: 1, retake: false, commission: false }]);
  const last = examLog(s).filter((r) => r.studentId === s.a2).pop();
  assert.deepEqual([last.before, last.after, last.reason], ['incomplete', '', 'внесено по ошибке']);
  assert.equal(s.store.list('examAttempts').length, 2);
  // the erased result is put again as the first value of the same row, without a reason
  assert.equal(rowOf(save({ items: [{ studentId: s.a2, outcome: 'score', score: 22 }] }).data.ledger, s.a2).total, 60);
  assert.equal(s.store.list('examAttempts').length, 2);

  // the date of the head moves the date of the live first attempts; the log does not get a row for the head
  s.at('2026-12-17');
  const logs = examLog(s).length;
  assert.equal(save({ date: '2026-12-17' }).ok, true);
  assert.deepEqual(s.store.list('examAttempts').map((r) => r.date), ['2026-12-17', '2026-12-17']);
  assert.equal(examLog(s).length, logs);
  assert.equal(s.store.list('subjectExams').length, 1);
  assert.equal(s.store.list('subjectExams')[0].date, '2026-12-17');

  // the office puts a date outside of the week
  assert.equal(save({ date: '2026-12-10' }, s.t.dean).ok, true);
  assert.deepEqual(s.store.list('examAttempts').map((r) => r.date), ['2026-12-10', '2026-12-10']);
  assert.equal(save({ date: '2026-12-10' }, s.t.admin).ok, true);
});

test('ledger.saveExam: an early date of the office is kept by the teacher; no credit week means any date', () => {
  const s = ready();
  const save = saver(s);
  assert.equal(save({ date: '2026-12-10' }, s.t.dean).ok, true);
  assert.equal(save({ date: '2026-12-10', items: [{ studentId: s.a1, outcome: 'score', score: 35 }] }).ok, true);
  assert.deepEqual(save({ date: '2026-12-11' }).error.fields, [{ field: 'date', code: 'out_of_exam' }]);
  assert.equal(s.call('ledger.get', { subjectId: s.sb1 }, s.t.teacher1).data.ledger.exam.strict, true);
  assert.equal(s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger.exam.strict, false);

  const free = setup();
  free.allUnits();
  free.at('2026-12-15');
  assert.equal(saver(free)({ date: '2026-11-01' }).ok, true);
});

test('ledger.saveExam: open units and the closed final sheet', () => {
  const s = ready();
  const save = saver(s);
  save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] });
  const closure = s.store.list('closures').find((r) => r.unit === 2);
  s.store.update('closures', closure.id, { reopenedAt: '2026-12-15 10:00:00', reopenedBy: s.ids.admin });
  const before = s.snapshot();
  assert.equal(save({ items: [{ studentId: s.a1, outcome: 'score', score: 30 }], reason: 'x' }).error.code, 'units_open');
  assert.equal(save({}, s.t.admin).error.code, 'units_open');
  assert.equal(s.call('ledger.addAttempt', { subjectId: s.sb1, studentId: s.a2, date: '2026-12-16', outcome: 'score', score: 21, commission: '' }, s.t.teacher1).error.code, 'not_closed');
  assert.deepEqual(s.snapshot(), before);

  const s2 = setup();
  s2.at('2026-09-30');
  assert.equal(saver(s2)({}).error.code, 'units_open');
});

test('ledger.addAttempt: retakes are new attempts; the rights, the commission, the order of dates', () => {
  const s = ready();
  const save = saver(s);
  const add = adder(s);
  save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] });
  s.closeFinal();
  s.at('2027-01-20');
  const mid = s.snapshot();
  assert.equal(save({ items: [{ studentId: s.a2, outcome: 'score', score: 30 }], reason: 'x' }).error.code, 'final_closed');
  assert.equal(save({ assistants: 'Другой ассистент' }, s.t.admin).error.code, 'final_closed');
  for (const who of ['teacher2', 'teacher3', 'prorector', 'a1']) assert.equal(add({}, s.t[who]).error.code, 'forbidden', who);
  for (const subjectId of [[s.sb1], 5, '__proto__']) assert.equal(add({ subjectId }).error.code, 'not_found');
  assert.deepEqual(add({ studentId: s.a1 }).error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  assert.deepEqual(add({ studentId: s.a3 }).error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  assert.deepEqual(add({ studentId: s.b1 }).error.fields, [{ field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(add({ studentId: [s.a2] }).error.fields, [{ field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual([add({ date: '2026-12-18' }).error.fields, add({ date: '2026-12-15' }).error.fields, add({ date: '2027-01-21' }).error.fields, add({ score: 41 }).error.fields],
    [[{ field: 'date', code: 'in_session' }], [{ field: 'date', code: 'order' }], [{ field: 'date', code: 'in_future' }], [{ field: 'score', code: 'bad_value' }]]);
  assert.deepEqual(s.snapshot(), mid);
});

test('ledger.addAttempt: the second sitting, the third only by the office with a commission, the old attempt stays', () => {
  const s = ready();
  const save = saver(s);
  const add = adder(s);
  save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] });
  s.closeFinal();
  s.at('2027-01-20');
  const mid = s.snapshot();
  assert.deepEqual(add({ studentId: s.a1 }).error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  assert.deepEqual(add({ date: '2026-12-18' }).error.fields, [{ field: 'date', code: 'in_session' }]);
  assert.deepEqual(s.snapshot(), mid);

  const second = rowOf(add({}).data.ledger, s.a2);
  assert.deepEqual([second.attempts.map((x) => [x.no, x.date, x.score]), second.total, second.word, second.next], [[[1, '2026-12-15', 20], [2, '2027-01-12', 21]], 59, 'fail', { no: 3, retake: true, commission: true }]);
  const third = { date: '2027-01-19', score: 25, commission: 'Член комиссии Первый, Член комиссии Второй' };
  assert.equal(add(third).error.code, 'forbidden');
  assert.deepEqual(add({ ...third, commission: ' ' }, s.t.dean).error.fields, [{ field: 'commission', code: 'required' }]);
  const last = rowOf(add(third, s.t.dean).data.ledger, s.a2);
  assert.deepEqual([last.total, last.word, last.tries, last.next, last.attempts[2].commission], [63, 'fair', 3, null, 'Член комиссии Первый, Член комиссии Второй']);
  assert.deepEqual(add({ date: '2027-01-20', score: 40 }, s.t.dean).error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  assert.deepEqual(s.store.list('examAttempts').filter((r) => r.studentId === s.a2 && r.no === 1).map((r) => [r.outcome, r.score, r.date]), [['score', 20, '2026-12-15']]);
  assert.deepEqual(examLog(s).filter((r) => r.studentId === s.a2).map((r) => [r.field, r.before, r.after, r.reason, r.late]), [['try1', '', '20', '', false], ['try2', '', '21', '', false], ['try3', '', '25', '', false]]);
  assert.equal(JSON.stringify(last).includes('updatedBy'), false);
});

test('ledger.addAttempt: after "I" the sitting is a first one; absent three times; a double click', () => {
  const s = ready();
  const save = saver(s);
  const add = adder(s);
  save({ items: [{ studentId: s.a1, outcome: 'incomplete' }, { studentId: s.a2, outcome: 'absent' }] });
  s.closeFinal();
  s.at('2027-01-20');
  assert.deepEqual(rowOf(s.call('ledger.get', { subjectId: s.sb1 }, s.t.teacher1).data.ledger, s.a1).next, { no: 2, retake: false, commission: false });
  const a1 = rowOf(add({ studentId: s.a1, date: '2026-12-18', score: 30 }).data.ledger, s.a1);
  assert.deepEqual([a1.tries, a1.total, a1.word, a1.attempts.map((x) => x.no)], [1, 77, 'fair', [1, 2]]);

  // "absent" three times
  assert.equal(add({ outcome: 'absent', score: null }).ok, true);
  assert.equal(add({ outcome: 'absent', score: null }).error.code, 'forbidden');
  assert.deepEqual(add({ outcome: 'absent', score: null }, s.t.dean).error.fields.filter((f) => f.field === 'date'), [{ field: 'date', code: 'order' }]);
  assert.equal(s.store.list('examAttempts').filter((r) => r.studentId === s.a2 && r.no === 2).length, 1);
  const c = { outcome: 'absent', score: null, date: '2027-01-19', commission: 'Комиссия' };
  assert.equal(add(c, s.t.dean).ok, true);
  assert.deepEqual(add({ ...c, date: '2027-01-20' }, s.t.dean).error.fields, [{ field: 'studentId', code: 'not_allowed' }]);
  assert.deepEqual(examLog(s).filter((r) => r.studentId === s.a2).map((r) => [r.field, r.before, r.after]), [['try1', '', 'absent'], ['try2', '', 'absent'], ['try3', '', 'absent']]);
  const done = rowOf(s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger, s.a2);
  assert.deepEqual([done.status, done.total, done.next, done.tries], ['absent', null, null, 3]);
});

test('each table of the ledger is read once by saveExam and addAttempt', () => {
  const s = ready();
  const save = saver(s);
  s.spy.reset();
  assert.equal(save({ items: [{ studentId: s.a1, outcome: 'score', score: 35 }, { studentId: s.a2, outcome: 'score', score: 20 }] }).ok, true);
  for (const table of LEDGER_TABLES) assert.equal(s.spy.lists[table], 1, table);
  for (const key of Object.keys(s.spy.writes)) assert.equal(/^(insert|update)Many:/.test(key) || key.startsWith('transaction'), true, key);
  s.closeFinal();
  s.at('2027-01-20');
  s.spy.reset();
  assert.equal(adder(s)({}).ok, true);
  for (const table of LEDGER_TABLES) assert.equal(s.spy.lists[table], 1, table);
});

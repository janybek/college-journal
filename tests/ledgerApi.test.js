import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { LEDGER_LIST_TABLES, LEDGER_TABLES } from '../backend/ledgerData.js';

const rowOf = (v, id) => v.students.find((x) => x.id === id);
const week = (s) => { for (const [key, value] of [['examStart', '2026-12-14'], ['examEnd', '2026-12-20']]) s.store.insert('settings', { key, value }); };
const setting = (s, key, value) => s.store.insert('settings', { key, value });
const ledgerRows = (s) => s.store.list('changeLog').filter((r) => r.entity === 'ledger');

test('ledger.get: the numbers of the journal, the admission, the rights and the reading of every table once', () => {
  const s = setup();
  s.unitNumbers();
  const L = (token = s.t.teacher1) => s.call('ledger.get', { subjectId: s.sb1 }, token);
  const view = L().data.ledger;
  assert.deepEqual(rowOf(view, s.a1).units[0], { unit: 1, current: 38, manual: false, self: 16, selfPending: 0, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false });
  assert.deepEqual((({ current, self, control, total, word, currentLow }) => ({ current, self, control, total, word, currentLow }))(rowOf(view, s.a2).units[0]), { current: 20, self: 12, control: 25, total: 57, word: 'fail', currentLow: true });
  assert.deepEqual([rowOf(view, s.a3).units[0].total, rowOf(view, s.a3).total, rowOf(view, s.a1).preliminary], [null, null, 84]);
  assert.deepEqual((({ semester, complete, admitted, attempts, status, total, word, next }) => ({ semester, complete, admitted, attempts, status, total, word, next }))(rowOf(view, s.a1)),
    { semester: 50, complete: false, admitted: false, attempts: [], status: 'not_admitted', total: null, word: null, next: null });
  assert.deepEqual([view.split, view.exam, view.final.blocking], [{ semester: 60, exam: 40, admission: 30 }, { ready: false, date: '', examiner: '', assistants: '', strict: false }, [{ code: 'units_open', n: 2 }, { code: 'no_date', n: 0 }]]);
  assert.deepEqual(view.units.map((u) => [u.unit, u.closed, u.blocking, u.missing]), [[1, false, [], 1], [2, false, [{ code: 'pairs_not_held', n: 3 }], 3]]);
  assert.deepEqual(view.can, { close: true, reopen: false, request: true, exam: true, commission: false });
  assert.deepEqual([L(s.t.dean).data.ledger.can, L(s.t.prorector).data.ledger.can], [{ close: true, reopen: false, request: false, exam: true, commission: true }, { close: false, reopen: false, request: false, exam: false, commission: false }]);
  assert.deepEqual([view.subject.course, view.subject.groupName, view.subject.hasSyllabus, view.subject.planSemester, view.collegeName, view.examWeek], [1, '01-1', true, 1, '', { start: '', end: '' }]);

  // the numbers equal the numbers of journal.get for every student and unit
  const journal = s.call('journal.get', { subjectId: s.sb1 }, s.t.teacher1).data.journal;
  assert.deepEqual(view.students.map((x) => x.id), journal.students.map((x) => x.id));
  for (const st of view.students) {
    const r = journal.results[st.id];
    assert.deepEqual([st.preliminary, st.semester, st.complete, st.admitted], [r.preliminary, r.semester, r.complete, r.admitted]);
    for (const u of st.units) {
      const j = r.units.find((x) => x.unit === u.unit);
      assert.deepEqual([u.current, u.self, u.control, u.total, u.word, u.currentLow, u.controlLow], [j.current, j.self, j.control, j.total, j.word, j.currentLow, j.controlLow]);
    }
  }

  for (const who of ['dean', 'prorector', 'admin']) assert.equal(L(s.t[who]).ok, true);
  for (const who of ['teacher2', 'teacher3', 'a1']) assert.equal(L(s.t[who]).error.code, 'forbidden');
  for (const subjectId of [[s.sb1], 5, { id: s.sb1 }, ' ' + s.sb1, '__proto__', undefined]) assert.equal(s.call('ledger.get', { subjectId }, s.t.dean).error.code, 'not_found');

  s.spy.reset();
  assert.equal(L().ok, true);
  for (const table of LEDGER_TABLES) assert.equal(s.spy.lists[table], 1, table);
  assert.equal(JSON.stringify(view).includes('passwordHash'), false);
});

test('ledger.list: own subjects of a teacher, all for the office, the tables read once', () => {
  const s = setup();
  s.at('2026-09-30');
  s.closeUnit(1);
  const mine = s.call('ledger.list', {}, s.t.teacher1).data;
  assert.deepEqual(mine.subjects.map((x) => [x.subjectId, x.own, x.units, x.final, x.hasSyllabus]), [[s.sb1, true, [{ unit: 1, closed: true }, { unit: 2, closed: false }], false, true]]);
  assert.deepEqual([mine.today, mine.examWeek], ['2026-09-30', { start: '', end: '' }]);
  const dean = s.call('ledger.list', {}, s.t.dean).data.subjects;
  assert.deepEqual(dean.map((x) => [x.subjectId, x.own, x.teacherName, x.groupName]), [[s.sb1, false, 'Иванова Нургуль', '01-1'], [s.sb2, false, 'Петров Эрмек', '02-1']]);
  assert.deepEqual(dean[1].units, []);
  assert.equal(s.call('ledger.list', {}, s.t.prorector).data.subjects.length, 2);
  assert.equal(s.call('ledger.list', {}, s.t.a1).error.code, 'forbidden');
  s.spy.reset();
  assert.equal(s.call('ledger.list', {}, s.t.dean).ok, true);
  for (const table of LEDGER_LIST_TABLES) assert.equal(s.spy.lists[table], 1, table);
  assert.equal(s.spy.lists.attendance, undefined);
  assert.equal(s.spy.lists.pairs, undefined);
});

test('ledger.closeUnit: rights, checks, the record and the log', () => {
  const s = setup();
  s.unitNumbers();
  const before = s.snapshot();
  const close = (data, token = s.t.teacher1) => s.call('ledger.closeUnit', { subjectId: s.sb1, unit: 1, acceptMissing: true, ...data }, token);
  for (const who of ['teacher2', 'teacher3', 'prorector', 'a1']) assert.equal(close({}, s.t[who]).error.code, 'forbidden');
  assert.deepEqual(close({ acceptMissing: false }).error, { code: 'invalid', fields: [{ field: 'acceptMissing', code: 'required' }] });
  assert.deepEqual(close({ unit: 2 }).error, { code: 'invalid', fields: [{ field: 'unit', code: 'pairs_not_held' }] });
  for (const unit of ['1', 1.5, 9, [1], null]) assert.equal(close({ unit }).error.code, 'invalid');
  assert.equal(s.call('ledger.closeUnit', { subjectId: s.sb2, unit: 1 }, s.t.teacher2).error.code, 'no_syllabus');
  assert.equal(s.call('ledger.closeUnit', { subjectId: '__proto__', unit: 1 }, s.t.dean).error.code, 'not_found');
  assert.equal(s.call('ledger.reopen', { subjectId: s.sb1, unit: 1, reason: 'x' }, s.t.admin).error.code, 'not_closed');
  assert.deepEqual(s.snapshot(), before);
  const closed = close({}).data.ledger;
  assert.deepEqual([closed.units[0].closed, closed.units[0].closedByName !== '', closed.final.closed], [true, true, false]);
  assert.deepEqual([closed.units[0].blocking, closed.units[0].missing], [[], 0]);
  assert.deepEqual(ledgerRows(s).map((r) => [r.unit, r.field, r.before, r.after, r.reason]), [[1, 'closed', 'open', 'closed', '']]);
  assert.equal(s.store.list('closures').length, 1);
  assert.equal(close({}).error.code, 'already_closed');
  assert.equal(s.store.list('closures').length, 1);
});

test('ledger.closeUnit: the self-work waiting for a check stops the closing', () => {
  const s = setup();
  s.at('2026-09-30');
  for (const id of [s.p0915, s.p0922, s.pairOf(s.sb1, '2026-09-29').id]) s.store.update('pairs', id, { status: 'closed' });
  const task = s.task();
  s.attempt(task, 'a1', { status: 'submitted' });
  const res = s.call('ledger.closeUnit', { subjectId: s.sb1, unit: 2, acceptMissing: true }, s.t.teacher1);
  assert.deepEqual(res.error, { code: 'invalid', fields: [{ field: 'unit', code: 'self_pending' }] });
  const view = s.call('ledger.get', { subjectId: s.sb1 }, s.t.teacher1).data.ledger;
  assert.deepEqual(view.units[1].blocking, [{ code: 'self_pending', n: 1 }]);
  assert.equal(rowOf(view, s.a1).units[1].selfPending, 1);
  assert.equal(s.store.list('closures').length, 0);
});

test('ledger.reopen: the administrator only, with a reason; the closing row stays', () => {
  const s = setup();
  s.unitNumbers();
  s.closeUnit(1);
  const reopen = (data, token = s.t.admin) => s.call('ledger.reopen', { subjectId: s.sb1, unit: 1, reason: 'ошибка в рубежном', ...data }, token);
  const before = s.snapshot();
  for (const who of ['dean', 'prorector', 'teacher1', 'a1']) assert.equal(reopen({}, s.t[who]).error.code, 'forbidden');
  assert.deepEqual(reopen({ reason: '' }).error, { code: 'invalid', fields: [{ field: 'reason', code: 'required' }] });
  assert.equal(reopen({ reason: 'я'.repeat(301) }).error.fields[0].code, 'too_long');
  for (const unit of [-1, 1.5, '1', null]) assert.equal(reopen({ unit }).error.code, 'invalid');
  assert.deepEqual(s.snapshot(), before);
  const done = reopen({}).data.ledger;
  assert.equal(done.units[0].closed, false);
  assert.deepEqual(ledgerRows(s).map((r) => [r.unit, r.field, r.before, r.after, r.reason]), [[1, 'closed', 'closed', 'open', 'ошибка в рубежном']]);
  const rows = s.store.list('closures');
  assert.deepEqual([rows.length, rows[0].reopenedAt !== '', rows[0].reopenedBy], [1, true, s.ids.admin]);
  assert.equal(reopen({}).error.code, 'not_closed');
});

test('the admission and the exam: the semester points, the attempts, the total and the next try', () => {
  const s = setup();
  s.allUnits();
  s.at('2026-12-15');
  week(s);
  const L = (token = s.t.teacher1) => s.call('ledger.get', { subjectId: s.sb1 }, token).data.ledger;
  let v = L();
  assert.equal(v.exam.ready, true);
  assert.deepEqual(rowOf(v, s.a1).units.map((u) => u.total), [84, 71]);
  assert.deepEqual((({ semester, complete, admitted, status, next }) => ({ semester, complete, admitted, status, next }))(rowOf(v, s.a1)),
    { semester: 47, complete: true, admitted: true, status: 'none', next: { no: 1, retake: false, commission: false } });
  assert.deepEqual([rowOf(v, s.a2).semester, rowOf(v, s.a2).admitted], [38, true]);
  assert.deepEqual((({ semester, complete, admitted, status, next }) => ({ semester, complete, admitted, status, next }))(rowOf(v, s.a3)),
    { semester: 45, complete: false, admitted: false, status: 'not_admitted', next: null });
  assert.deepEqual(v.final.blocking, [{ code: 'no_date', n: 0 }, { code: 'exam_missing', n: 2 }]);
  assert.deepEqual([v.exam.strict, L(s.t.dean).exam.strict, v.examWeek], [true, false, { start: '2026-12-14', end: '2026-12-20' }]);
  assert.deepEqual([v.final.early, v.final.closed], [false, false]);

  s.examHead();
  s.examRow(s.a1, { score: 35 });
  s.examRow(s.a2, { score: 20 });
  v = L();
  assert.deepEqual([v.exam.date, v.exam.assistants, v.exam.examiner], ['2026-12-15', 'Ассистент Первый', '']);
  const a1 = rowOf(v, s.a1);
  assert.deepEqual([a1.status, a1.exam, a1.total, a1.word, a1.next, a1.tries], ['done', 35, 82, 'good', null, 1]);
  assert.deepEqual(Object.keys(a1.attempts[0]), ['id', 'no', 'date', 'outcome', 'score', 'commission']);
  const a2 = rowOf(v, s.a2);
  assert.deepEqual([a2.total, a2.word, a2.next], [58, 'fail', { no: 2, retake: true, commission: false }]);
  assert.deepEqual(v.final.blocking, []);

  s.examRow(s.a2, { no: 2, date: '2027-01-12', score: 25, updatedAt: '2027-01-12 12:00:00' });
  const again = rowOf(L(), s.a2);
  assert.deepEqual(again.attempts.map((x) => [x.no, x.score]), [[1, 20], [2, 25]]);
  assert.deepEqual([again.exam, again.total, again.word], [25, 63, 'fair']);

  // a result written for a student who is not admitted gives no total
  s.examRow(s.a3, { score: 30 });
  const a3 = rowOf(L(), s.a3);
  assert.deepEqual([a3.status, a3.total, a3.word], ['not_admitted', null, null]);

  const json = JSON.stringify(L());
  assert.equal(json.includes('updatedBy'), false);
  assert.equal(json.includes('passwordHash'), false);

  // other numbers of the split come from the settings
  setting(s, 'scoreSemester', '50'); setting(s, 'scoreExam', '50'); setting(s, 'scoreAdmission', '25');
  v = L();
  assert.deepEqual([v.split, rowOf(v, s.a1).semester], [{ semester: 50, exam: 50, admission: 25 }, 39]);
});

test('ledger.closeFinal: the credit week, what is missing, the record, the rights and reopening', () => {
  const s = setup();
  // (a) too early and open units
  s.unitNumbers();
  week(s);
  assert.equal(s.call('ledger.closeFinal', { subjectId: s.sb1 }, s.t.teacher1).error.code, 'exam_not_started');
  assert.deepEqual(s.call('ledger.closeFinal', { subjectId: s.sb1 }, s.t.dean).error, { code: 'invalid', fields: [{ field: 'final', code: 'units_open', n: 2 }] });
  assert.equal(s.store.list('closures').length, 0);

  // (b) the units closed, then the date, then the results
  const s2 = setup();
  s2.allUnits();
  s2.at('2026-12-15');
  week(s2);
  const fin = (token = s2.t.teacher1, data = {}) => s2.call('ledger.closeFinal', { subjectId: s2.sb1, ...data }, token);
  assert.deepEqual(fin().error, { code: 'invalid', fields: [{ field: 'final', code: 'no_date', n: 0 }] });
  s2.examHead();
  assert.deepEqual(fin().error, { code: 'invalid', fields: [{ field: 'final', code: 'exam_missing', n: 2 }] });
  s2.examRow(s2.a1);
  s2.examRow(s2.a2, { outcome: 'absent', score: null });
  // (c) a spare key changes nothing; the rights
  const before = s2.snapshot();
  for (const who of ['teacher2', 'teacher3', 'prorector', 'a1']) assert.equal(fin(s2.t[who]).error.code, 'forbidden');
  assert.deepEqual(s2.snapshot(), before);
  const closures = s2.store.list('closures').map((r) => ({ ...r }));
  const done = fin(s2.t.teacher1, { acceptMissing: true }).data.ledger;
  assert.deepEqual([done.final.closed, done.final.closedByName !== '', done.final.blocking], [true, true, []]);
  const after = s2.store.list('closures');
  assert.equal(after.length, closures.length + 1);
  assert.deepEqual(after.slice(0, closures.length), closures);
  assert.deepEqual([after[after.length - 1].unit, after[after.length - 1].reopenedAt], [0, '']);
  assert.deepEqual(ledgerRows(s2).map((r) => [r.field, r.before, r.after]), [['final', 'open', 'closed']]);
  assert.equal(ledgerRows(s2)[0].unit, null);
  assert.equal(fin().error.code, 'already_closed');
  const attemptsBefore = JSON.stringify(s2.store.list('examAttempts'));

  // (d) reopening a unit opens the final sheet too; unit 0 opens only the final sheet
  const reopen = (unit) => s2.call('ledger.reopen', { subjectId: s2.sb1, unit, reason: 'пересчёт' }, s2.t.admin);
  const r1 = reopen(1).data.ledger;
  assert.deepEqual([r1.units[0].closed, r1.units[1].closed, r1.final.closed], [false, true, false]);
  assert.deepEqual(ledgerRows(s2).slice(1).map((r) => [r.field, r.before, r.after, r.reason]), [['closed', 'closed', 'open', 'пересчёт'], ['final', 'closed', 'open', 'пересчёт']]);
  assert.equal(JSON.stringify(s2.store.list('examAttempts')), attemptsBefore);
  s2.call('ledger.closeUnit', { subjectId: s2.sb1, unit: 1, acceptMissing: true }, s2.t.teacher1);
  assert.equal(fin().ok, true);
  const r0 = reopen(0).data.ledger;
  assert.deepEqual([r0.units.map((u) => u.closed), r0.final.closed], [[true, true], false]);

  // (e) without a credit week the teacher closes the final sheet on any day
  const s3 = setup();
  s3.allUnits();
  s3.at('2026-11-01');
  s3.examHead();
  s3.examRow(s3.a1);
  s3.examRow(s3.a2);
  assert.equal(s3.call('ledger.closeFinal', { subjectId: s3.sb1 }, s3.t.teacher1).ok, true);
});

test('the teacher of a closed subject changes to one without a syllabus: the closures and the exam stay in the ledger and for the student (final review, I2)', () => {
  const s = setup();
  s.allUnits(); s.examHead(); s.examRow(s.a1); s.examRow(s.a2, { score: 20 }); s.closeFinal(); s.at('2026-12-26');
  const grades = () => s.call('student.grades', {}, s.t.a1).data.subjects.find((x) => x.subjectId === s.sb1);
  const finalBefore = grades().final;
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher2 });
  const l = s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger;
  assert.equal(l.units.length > 0 && l.units.every((u) => u.closed), true);
  assert.deepEqual([l.final.closed, rowOf(l, s.a1).exam], [true, 35]);
  assert.equal(l.subject.planSemester, 1);
  assert.deepEqual(grades().final, finalBefore);
  assert.equal(grades().final.status, 'done');
  assert.equal(grades().final.total, 82);
  const journal = s.call('journal.get', { subjectId: s.sb1 }, s.t.dean).data.journal;
  assert.equal(journal.subject.planSemester, 1);
});

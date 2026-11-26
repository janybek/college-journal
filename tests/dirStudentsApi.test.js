import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';

const byId = (rows, id) => rows.find((r) => r.id === id);

function started() {
  const s = setup();
  s.at('2026-09-30');
  s.unitNumbers();       // a1: 38+16+30 = 84, a2: 20+12+25 = 57, a3 without totals
  return s;
}

const person = (s, id, token = s.t.dean) => s.call('dir.person', { table: 'students', id }, token).data;
const codeOf = (r) => (r.ok === false || r.error ? (r.error?.code ?? r.code) : 'ok');

test('dir.people and dir.person of students: the numbers of the journal', () => {
  const s = started();
  const { call, t, store } = s;
  const list = call('dir.people', { table: 'students' }, t.dean).data;
  assert.deepEqual(list.rows.map((r) => r.id), store.list('students').map((x) => x.id));
  assert.deepEqual([byId(list.rows, s.a1), byId(list.rows, s.a2), byId(list.rows, s.a3), byId(list.rows, s.a4), byId(list.rows, s.b1)], [
    { id: s.a1, attendance: 100, average: 84, risk: 0 }, { id: s.a2, attendance: 50, average: 57, risk: 1 }, { id: s.a3, attendance: 0, average: null, risk: 0 },
    { id: s.a4, attendance: null, average: null, risk: 0 }, { id: s.b1, attendance: 100, average: null, risk: 0 }]);
  const c = call('dir.person', { table: 'students', id: s.a2 }, t.dean).data;
  assert.deepEqual(c.student, { id: s.a2, fullName: 'Өмүров Канат', cardNo: 'A2', groupId: s.g1, groupName: '01-1', active: true });
  assert.deepEqual(c.totals, { attendance: 50, absent: 1, average: 57, risk: 1, repeats: 0, debts: 0 });
  assert.deepEqual(c.subjects, [{ subjectId: s.sb1, name: 'Информатика', teacherName: 'Иванова Нургуль', planSemester: 1,
    attendance: { percent: 50, absent: 1, marked: 2 }, units: [{ unit: 1, total: 57 }, { unit: 2, total: null }], average: 57, state: 'risk', total: null }]);
  assert.deepEqual([c.works, c.debts, c.repeats], [[], [], []]);
});

test('the same numbers as the journal and the grades', () => {
  const s = started();
  const j = s.call('journal.get', { subjectId: s.sb1 }, s.t.dean).data.journal;
  for (const id of [s.a1, s.a2, s.a3]) {
    const row = person(s, id).subjects[0];
    const r = j.results[id];
    assert.deepEqual(row.units, r.units.map((u) => ({ unit: u.unit, total: u.total })));
    assert.equal(row.attendance.percent, r.attendance.percent);
    assert.equal(row.attendance.absent, r.attendance.absent);
    assert.equal(row.average, r.preliminary);
  }
  const grades = s.call('student.grades', {}, s.t.a2).data.subjects.find((x) => x.subjectId === s.sb1 || x.id === s.sb1);
  assert.ok(grades, 'the subject is in student.grades');
  assert.deepEqual(person(s, s.a2).subjects[0].units.map((u) => u.total), grades.units.map((u) => u.total));
});

test('a closed final sheet: state and total as in the ledger and the grades', () => {
  const s = setup();
  s.failed();
  const want = { [s.a1]: ['passed', 82], [s.a2]: ['fail', 58], [s.a3]: ['notAdmitted', null] };
  for (const [id, [state, total]] of Object.entries(want)) {
    const row = person(s, id).subjects[0];
    assert.deepEqual([row.state, row.total], [state, total]);
  }
  const ledger = s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger.students;
  const l1 = byId(ledger, s.a1);
  const l2 = byId(ledger, s.a2);
  const l3 = byId(ledger, s.a3);
  assert.deepEqual([l1.status, l1.word, l1.total], ['done', 'good', 82]);
  assert.deepEqual([l2.status, l2.word, l2.total], ['done', 'fail', 58]);
  assert.deepEqual([l3.status, l3.total], ['not_admitted', null]);
  const grades = (token) => s.call('student.grades', {}, token).data.subjects.find((x) => x.subjectId === s.sb1 || x.id === s.sb1);
  const g1 = grades(s.t.a1);
  const g2 = grades(s.t.a2);
  assert.deepEqual([g1.final.status, g1.final.total], ['done', 82]);
  assert.deepEqual([g2.final.status, g2.final.total], ['done', 58]);
});

test('debts of a past half', () => {
  const s = setup();
  s.failed();
  assert.deepEqual(person(s, s.a2).debts, []);
  s.switchSemester();
  const a2 = person(s, s.a2);
  assert.deepEqual(a2.subjects, []);
  assert.deepEqual(a2.debts, [{ subjectId: s.sb1, name: 'Информатика', groupName: '01-1', planSemester: 1, state: 'fail', total: 58, repeat: null }]);
  assert.equal(a2.totals.debts, 1);
  const a3 = person(s, s.a3);
  assert.deepEqual([a3.debts[0].state, a3.debts[0].total], ['notAdmitted', null]);
  assert.deepEqual(person(s, s.a1).debts, []);
  const card = s.repeatCard();
  const withRepeat = person(s, s.a2);
  assert.equal(withRepeat.debts[0].repeat, 'open');
  assert.equal(withRepeat.totals.repeats, 1);
  assert.equal(withRepeat.repeats[0].subjectName, 'Информатика');
  assert.equal(withRepeat.repeats[0].status, 'open');
  assert.equal(withRepeat.repeats[0].kind, 'full');
  assert.equal(withRepeat.repeats[0].orderNo, '15-с');
  s.store.update('repeats', card, { status: 'passed' });
  assert.deepEqual(person(s, s.a2).debts, []);
});

test('works of the student', () => {
  const s = started();
  const first = s.task();
  s.attempt(first, 'a2');
  s.task({ title: 'СРС Б', dueAt: '2026-09-25 23:59:00' });
  s.task({ title: 'СРС В', dueAt: '2026-10-05 23:59:00' });
  assert.deepEqual(person(s, s.a2).works, [{ subjectId: s.sb1, name: 'Информатика', checked: 0, submitted: 1, returned: 0, missing: 1 }]);
  assert.deepEqual(person(s, s.b1).works, []);
});

test('quiet omissions are not errors', () => {
  const s = started();
  const b1 = person(s, s.b1);
  assert.deepEqual(b1.subjects, [{ subjectId: s.sb2, name: 'Анатомия', teacherName: 'Петров Эрмек', planSemester: null,
    attendance: { percent: 100, absent: 0, marked: 2 }, units: [], average: null, state: 'going', total: null }]);
  assert.deepEqual(b1.totals, { attendance: 100, absent: 0, average: null, risk: 0, repeats: 0, debts: 0 });
  const a4 = s.call('dir.person', { table: 'students', id: s.a4 }, s.t.dean);
  assert.equal(a4.ok, true);
  assert.equal(a4.data.student.active, false);
  const topics = s.store.list('topics').filter((x) => x.syllabusId === s.syllabusId).map((x) => x.id);
  s.store.removeMany('topics', topics);
  const a1 = person(s, s.a1).subjects[0];
  assert.deepEqual([a1.subjectId, a1.units, a1.average, a1.state], [s.sb1, [], null, 'going']);
  const w = setup();
  w.switchSemester();
  const moved = person(w, w.b1);
  assert.deepEqual(moved.subjects, []);
  assert.deepEqual(moved.totals, { attendance: null, absent: 0, average: null, risk: 0, repeats: 0, debts: 0 });
});

test('rights and bad input', () => {
  const s = started();
  const { call, t } = s;
  const ok = { table: 'students', id: s.a1 };
  for (const action of ['dir.people', 'dir.person']) {
    assert.equal(codeOf(call(action, ok, t.a1)), 'forbidden');
    assert.equal(codeOf(call(action, ok, t.teacher1)), 'forbidden');
    assert.equal(codeOf(call(action, ok, undefined)), 'unauthorized');
    for (const who of [t.dean, t.prorector, t.admin]) assert.equal(codeOf(call(action, ok, who)), 'ok');
    for (const table of ['groups', 'weekTemplate', '__proto__', ['students'], 5, undefined]) assert.equal(codeOf(call(action, { table, id: s.a1 }, t.dean)), 'forbidden');
  }
  for (const id of [[s.a1], 5, {}, null, '']) assert.equal(codeOf(call('dir.person', { table: 'students', id }, t.dean)), 'bad_request');
  for (const id of ['  ', ' ' + s.a1, '__proto__', 'constructor', 'st_none', s.g1]) assert.equal(codeOf(call('dir.person', { table: 'students', id }, t.dean)), 'not_found');
  assert.equal(codeOf(call('dir.person', { table: 'students', id: s.a1, from: 'junk' }, t.dean)), 'ok');
  const fresh = call('dir.save', { table: 'students', row: { fullName: 'Новый Студент', groupId: s.g1, cardNo: 'N9', active: true } }, t.dean);
  assert.equal(fresh.ok, true);
  const id = fresh.data.row.id;
  assert.equal(call('dir.remove', { table: 'students', id }, t.dean).ok, true);
  assert.equal(codeOf(call('dir.person', { table: 'students', id }, t.dean)), 'not_found');
  assert.equal(codeOf(call('dir.save', { table: 'students', row: { id: s.a1, fullName: 'Иванов Нурлан', groupId: s.g1, cardNo: 'A1', active: true } }, t.prorector)), 'forbidden');
});

test('nothing is written and every sheet is read once', () => {
  const s = setup();
  s.running(s.p0922, '2026-09-22 08:05:00');
  s.at('2026-09-22', '09:00');
  const names = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'syllabi', 'syllabusLines', 'topics'];
  const state = () => ({ ...s.snapshot(), ...Object.fromEntries(names.map((n) => [n, structuredClone(s.store.list(n))])) });
  const before = state();
  for (const [action, data] of [['dir.people', { table: 'students' }], ['dir.person', { table: 'students', id: s.a2 }]]) {
    s.spy.reset();
    assert.equal(s.call(action, data, s.t.dean).ok, true);
    assert.deepEqual(s.spy.writes, {});
    assert.ok(Object.values(s.spy.lists).every((n) => n === 1), JSON.stringify(s.spy.lists));
  }
  assert.deepEqual(state(), before);
});

test('no foreign data in the answers', () => {
  const s = started();
  s.failed();
  s.repeatCard();
  const list = s.call('dir.people', { table: 'students' }, s.t.dean).data;
  const listText = JSON.stringify(list);
  for (const word of ['passwordHash', 'mustChangePassword', 'lang', 'fullName', 'cardNo']) assert.ok(!listText.includes(word), word);
  for (const row of list.rows) assert.deepEqual(Object.keys(row).sort(), ['attendance', 'average', 'id', 'risk']);
  const text = JSON.stringify(person(s, s.a2));
  for (const word of ['passwordHash', 'mustChangePassword', 'lang', 'login', 'tempPassword', 'commission']) assert.ok(!text.includes(word), word);
  for (const id of [s.a1, s.a3, s.a4]) assert.ok(!text.includes(s.store.list('students').find((x) => x.id === id).fullName));
});

test('dir.list keeps its answer', () => {
  const s = setup();
  const want = s.store.list('students').map(({ passwordHash, ...rest }) => rest);
  assert.deepEqual(s.call('dir.list', { table: 'students' }, s.t.dean).data.rows, want);
});

test('a student without marks keeps his debt of a closed past half, as the ledger shows it', () => {
  const s = setup();
  s.failed();
  for (const name of ['attendance', 'unitResults', 'examAttempts']) {
    const ids = s.store.list(name).filter((r) => r.studentId === s.a3).map((r) => r.id);
    if (ids.length) s.store.removeMany(name, ids);
  }
  const l = s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger.students.find((x) => x.id === s.a3);
  assert.equal(l.status, 'not_admitted');
  s.switchSemester();
  const a3 = person(s, s.a3);
  assert.deepEqual(a3.debts, [{ subjectId: s.sb1, name: 'Информатика', groupName: '01-1', planSemester: 1, state: 'notAdmitted', total: l.total ?? null, repeat: null }]);
  assert.equal(a3.totals.debts, 1);
  s.store.update('students', s.a3, { active: false });
  assert.deepEqual(person(s, s.a3).debts, []);
});

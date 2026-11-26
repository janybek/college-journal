import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import { meanOf } from '../core/progress.js';

const byId = (rows, id) => rows.find((r) => r.id === id);
const ZEROS = { risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 };

function started() {
  const s = setup();
  s.at('2026-09-30');
  s.unitNumbers();       // a1: 38+16+30 = 84, a2: 20+12+25 = 57, a3 without totals; marks: a1 2 of 2, a2 1 of 2, a3 0 of 2
  return s;
}

test('dir.progress of a group: the numbers of the journal, per subject and per student', () => {
  const s = started();
  const { call, t } = s;
  const g = call('dir.progress', { table: 'groups', id: s.g1 }, t.dean).data;
  assert.deepEqual(g.subjects, [{ subjectId: s.sb1, inHalf: true, attendance: 50, average: 71, counts: { risk: 1, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 } }]);
  assert.deepEqual(g.totals, { attendance: 50, average: 71, risk: 1 });
  assert.deepEqual(byId(g.students, s.a1), { id: s.a1, attendance: 100, average: 84 });
  assert.deepEqual(byId(g.students, s.a2), { id: s.a2, attendance: 50, average: 57 });
  assert.deepEqual(byId(g.students, s.a3), { id: s.a3, attendance: 0, average: null });
  assert.deepEqual(g.students.map((x) => x.id), call('dir.card', { table: 'groups', id: s.g1 }, t.dean).data.students.map((x) => x.id));
  const g2 = call('dir.progress', { table: 'groups', id: s.g2 }, t.dean).data;
  assert.deepEqual(g2.subjects, [{ subjectId: s.sb2, inHalf: true, attendance: 100, average: null, counts: { ...ZEROS } }]);
  assert.deepEqual([g2.totals, g2.students], [{ attendance: 100, average: null, risk: 0 }, [{ id: s.b1, attendance: 100, average: null }]]);
});

test('dir.progress of a discipline: rows per group and per unit', () => {
  const s = started();
  const d = s.call('dir.progress', { table: 'disciplines', id: s.ds1 }, s.t.dean).data;
  assert.deepEqual(d.rows, [{
    subjectId: s.sb1, groupId: s.g1, inHalf: true, students: 3, attendance: 50, average: 71,
    counts: { risk: 1, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 }, units: [{ unit: 1, closed: false }, { unit: 2, closed: false }],
  }]);
  assert.deepEqual(d.units, [{ unit: 1, groups: 1, closedGroups: 0, average: 71 }, { unit: 2, groups: 1, closedGroups: 0, average: null }]);
  assert.deepEqual(d.totals, { groups: 1, attendance: 50, average: 71, risk: 1 });
  assert.deepEqual(Object.keys(d).sort(), ['id', 'rows', 'semester', 'table', 'totals', 'units']);
});

test('the same numbers as the journal', () => {
  const s = started();
  const g = s.call('dir.progress', { table: 'groups', id: s.g1 }, s.t.dean).data;
  const j = s.call('journal.get', { subjectId: s.sb1 }, s.t.dean).data.journal;
  const totals = [];
  let marked = 0;
  let attended = 0;
  for (const st of j.students.filter((x) => x.left === false)) {
    for (const u of j.results[st.id].units) if (u.total !== null) totals.push(u.total);
    marked += j.results[st.id].attendance.marked;
    attended += j.results[st.id].attendance.attended;
  }
  assert.equal(meanOf(totals), g.subjects[0].average);
  assert.equal(Math.round((attended * 100) / marked), g.subjects[0].attendance);
});

test('a subject outside the current half', () => {
  const s = setup();
  s.switchSemester();
  for (const id of [s.g1, s.g2]) {
    const g = s.call('dir.progress', { table: 'groups', id }, s.t.dean).data;
    assert.deepEqual(g.subjects[0], { subjectId: g.subjects[0].subjectId, inHalf: false, attendance: null, average: null, counts: { ...ZEROS } });
    assert.deepEqual(g.totals, { attendance: null, average: null, risk: 0 });
  }
  const d = s.call('dir.progress', { table: 'disciplines', id: s.ds2 }, s.t.dean).data;
  assert.equal(d.rows[0].inHalf, false);
  assert.deepEqual(d.rows[0].units, []);
});

test('a subject without a syllabus but with pairs counts', () => {
  const s = setup();
  const d = s.call('dir.progress', { table: 'disciplines', id: s.ds2 }, s.t.dean).data;
  assert.deepEqual(d.rows, [{ subjectId: s.sb2, groupId: s.g2, inHalf: true, students: 1, attendance: 100, average: null, counts: { ...ZEROS }, units: [] }]);
  assert.deepEqual(d.units, []);
  assert.deepEqual(d.totals, { groups: 1, attendance: 100, average: null, risk: 0 });
});

test('the thresholds come from the settings', () => {
  const s = started();
  const risk = () => s.call('dir.progress', { table: 'groups', id: s.g1 }, s.t.dean).data.subjects[0].counts.risk;
  s.call('scoring.save', { scheme: { ...DEFAULT_SCHEME, fair: 50 }, split: DEFAULT_SPLIT }, s.t.dean);
  assert.equal(risk(), 0);
  s.call('scoring.save', { scheme: DEFAULT_SCHEME, split: { semester: 60, exam: 40, admission: 50 } }, s.t.dean);
  assert.equal(risk(), 2);
});

test('a closed unit', () => {
  const s = started();
  s.closeUnit(1);
  const d = s.call('dir.progress', { table: 'disciplines', id: s.ds1 }, s.t.dean).data;
  assert.equal(d.rows[0].units[0].closed, true);
  assert.equal(d.units[0].closedGroups, 1);
});

test('a closed final sheet gives the states of the ledger', () => {
  const s = setup();
  s.failed();
  const g = s.call('dir.progress', { table: 'groups', id: s.g1 }, s.t.dean).data;
  assert.deepEqual(g.subjects[0].counts, { risk: 0, fail: 1, notAdmitted: 1, absent: 0, incomplete: 0 });
  const ledger = s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean).data.ledger.students;
  assert.equal(ledger.filter((x) => x.status === 'done' && x.word === 'fail').length, 1);
  assert.equal(ledger.filter((x) => x.status === 'not_admitted').length, 1);
});

test('a student who is switched off is not counted', () => {
  const s = started();
  s.store.update('students', s.a2, { active: false });
  const g = s.call('dir.progress', { table: 'groups', id: s.g1 }, s.t.dean).data;
  assert.equal(g.totals.risk, 0);
  assert.equal(byId(g.students, s.a2), undefined);
  const d = s.call('dir.progress', { table: 'disciplines', id: s.ds1 }, s.t.dean).data;
  assert.equal(d.rows[0].students, 2);
});

test('the old answers keep their keys', () => {
  const s = started();
  const keys = (table, id) => Object.keys(s.call('dir.card', { table, id }, s.t.dean).data).sort();
  assert.deepEqual(keys('groups', s.g1), ['counts', 'group', 'now', 'semesterEnd', 'semesterStart', 'students', 'subjects', 'table', 'term', 'time', 'today']);
  assert.deepEqual(keys('disciplines', s.ds1), ['currentSemester', 'discipline', 'rows', 'syllabus', 'table']);
});

test('rights and bad input', () => {
  const s = started();
  const { call, t } = s;
  const code = (data, token) => {
    const r = call('dir.progress', data, token);
    return r.ok === false || r.error ? (r.error?.code ?? r.code) : 'ok';
  };
  const ok = { table: 'groups', id: s.g1 };
  assert.equal(code(ok, t.a1), 'forbidden');
  assert.equal(code(ok, t.teacher1), 'forbidden');
  assert.equal(code(ok, undefined), 'unauthorized');
  for (const who of [t.dean, t.prorector, t.admin]) assert.equal(code(ok, who), 'ok');
  for (const table of ['students', 'rooms', '__proto__', ['groups'], 5, undefined]) assert.equal(code({ table, id: s.g1 }, t.dean), 'forbidden');
  for (const id of [[s.g1], 5, {}, null, '']) assert.equal(code({ table: 'groups', id }, t.dean), 'bad_request');
  for (const id of ['  ', ' ' + s.g1, '__proto__', 'constructor', 'g_none']) assert.equal(code({ table: 'groups', id }, t.dean), 'not_found');
  assert.equal(code({ table: 'groups', id: s.ds1 }, t.dean), 'not_found');
});

test('nothing is written and every sheet is read once', () => {
  const s = setup();
  s.running(s.p0922, '2026-09-22 08:05:00');
  s.at('2026-09-22', '09:00');
  const names = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'syllabi', 'syllabusLines', 'topics'];
  const state = () => ({ ...s.snapshot(), ...Object.fromEntries(names.map((n) => [n, structuredClone(s.store.list(n))])) });
  const before = state();
  for (const data of [{ table: 'groups', id: s.g1 }, { table: 'disciplines', id: s.ds1 }]) {
    s.spy.reset();
    assert.equal(s.call('dir.progress', data, s.t.dean).ok, true);
    assert.deepEqual(s.spy.writes, {});
    assert.ok(Object.values(s.spy.lists).every((n) => n === 1), JSON.stringify(s.spy.lists));
  }
  assert.deepEqual(state(), before);
});

test('no foreign data in the answers', () => {
  const s = started();
  const text = JSON.stringify([
    s.call('dir.progress', { table: 'groups', id: s.g1 }, s.t.dean).data,
    s.call('dir.progress', { table: 'disciplines', id: s.ds1 }, s.t.dean).data,
  ]);
  for (const word of ['passwordHash', 'mustChangePassword', 'lang', 'login', 'fullName', 'Яковлев Улан']) assert.ok(!text.includes(word), word);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { LEDGER_TABLES } from '../backend/ledgerData.js';
import { halvesOf, halfResults } from '../backend/repeatSnapshot.js';

const prepare = () => {
  const s = setup();
  s.at('2026-12-21');
  s.failed();
  const rows = () => Object.fromEntries(LEDGER_TABLES.map((t) => [t, s.store.list(t)]));
  const dean = { id: s.ids.dean, roles: ['dean', 'teacher'] };
  const subject = () => s.store.list('subjects').find((x) => x.id === s.sb1);
  const byId = (r) => Object.fromEntries(r.students.map((x) => [x.id, x]));
  const half = (planSemester = 1) => halfResults(rows(), s.platform, subject(), planSemester, dean);
  return { s, rows, dean, subject, byId, half };
};

test('the previous result: the same numbers before and after the switch of the semester', () => {
  const { s, rows, subject, byId, half } = prepare();
  assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: true }]);
  const beforeAll = half();
  assert.equal(beforeAll.current, true);
  const before = byId(beforeAll);
  assert.deepEqual([before[s.ids.a1].total, before[s.ids.a1].word, before[s.ids.a2].semester, before[s.ids.a2].exam, before[s.ids.a2].total, before[s.ids.a2].word, before[s.ids.a2].tries], [82, 'good', 38, 20, 58, 'fail', 1]);
  assert.deepEqual([before[s.ids.a3].status, before[s.ids.a3].total], ['not_admitted', null]);
  assert.deepEqual(Object.keys(before[s.ids.a2]), ['id', 'fullName', 'semester', 'complete', 'admitted', 'attempts', 'status', 'tries', 'exam', 'total', 'word', 'next']);
  s.switchSemester();
  assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: false }]);
  const afterAll = half();
  assert.equal(afterAll.current, false);
  assert.deepEqual(byId(afterAll), before);
  assert.deepEqual(afterAll.students.map((x) => x.id).sort(), beforeAll.students.map((x) => x.id).sort());
});

test('a final sheet opened again is no half; a syllabus of the next half without closures changes nothing', () => {
  const { s, rows, subject, byId, half } = prepare();
  const before = byId(half());
  s.switchSemester();
  s.store.insert('syllabi', { disciplineId: s.ds1, teacherId: s.ids.teacher1, semester: 2, planSemester: 2, status: 'approved', version: 1 });
  assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: false }]);
  assert.deepEqual(byId(half()), before);
  const final = s.store.list('closures').find((c) => c.unit === 0);
  s.store.update('closures', final.id, { reopenedBy: s.ids.admin, reopenedAt: '2027-01-12 10:00:00' });
  assert.deepEqual(halvesOf(rows(), subject()), []);
});

test('students who moved, were switched off or joined later', () => {
  const { s, byId, half } = prepare();
  const before = byId(half());
  s.switchSemester();
  s.store.update('students', s.a2, { groupId: s.g2, active: false });
  const joined = s.store.insert('students', { fullName: 'Новенький Тимур', groupId: s.g1, cardNo: 'N1', passwordHash: '', lang: 'ky', mustChangePassword: false, active: true }).id;
  s.store.update('students', s.b1, { groupId: s.g1 });
  const after = half();
  assert.deepEqual(byId(after)[s.a2], before[s.a2]);
  const ids = after.students.map((x) => x.id);
  assert.ok(!ids.includes(joined) && !ids.includes(s.b1) && !ids.includes(s.a4));
  assert.deepEqual(ids.sort(), [s.a1, s.a2, s.a3].sort());
});

test('next comes from the attempts only: a card of the repeat and a student who left change nothing; both halves agree', () => {
  const { s, byId, half } = prepare();
  const plain = byId(half());
  assert.deepEqual([plain[s.a1].next, plain[s.a2].next, plain[s.a3].next], [null, { no: 2, retake: true, commission: false }, null]);
  s.repeatCard();
  s.store.update('students', s.a2, { active: false });
  assert.deepEqual(byId(half()), plain);
  s.store.update('students', s.a2, { active: true });
  s.switchSemester();
  s.store.update('students', s.a2, { active: false });
  assert.deepEqual(byId(half()), plain);
});

test('a teacher changed after the switch: the same numbers', () => {
  const { s, rows, subject, byId, half } = prepare();
  const before = byId(half());
  s.switchSemester();
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher2 });
  assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: false }]);
  assert.deepEqual(byId(half()), before);
});

test('halfResults reads nothing and writes nothing', () => {
  const { s, half } = prepare();
  for (const phase of ['now', 'switched']) {
    if (phase === 'switched') s.switchSemester();
    const lists = JSON.stringify(s.spy.lists);
    const writes = JSON.stringify(s.spy.writes);
    const snap = JSON.stringify(s.snapshot());
    half();
    assert.equal(JSON.stringify(s.spy.lists), lists);
    assert.equal(JSON.stringify(s.spy.writes), writes);
    assert.equal(JSON.stringify(s.snapshot()), snap);
  }
});

test('settings 50 / 50 / 25 are read from the settings, not from the code', () => {
  const s = setup();
  for (const [key, value] of [['scoreSemester', 50], ['scoreExam', 50], ['scoreAdmission', 25]]) s.store.insert('settings', { key, value });
  s.at('2026-12-21');
  s.failed();
  const rows = () => Object.fromEntries(LEDGER_TABLES.map((t) => [t, s.store.list(t)]));
  const subject = () => s.store.list('subjects').find((x) => x.id === s.sb1);
  const dean = { id: s.ids.dean, roles: ['dean', 'teacher'] };
  const run = () => Object.fromEntries(halfResults(rows(), s.platform, subject(), 1, dean).students.map((x) => [x.id, x]));
  const before = run();
  s.switchSemester();
  assert.deepEqual(run(), before);
});

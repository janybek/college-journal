import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';

test('failed(): a1 82 good, a2 58 fail, a3 not admitted, on the real ledger', () => {
  const s = setup();
  s.failed();
  s.at('2026-12-17');
  const r = s.call('ledger.get', { subjectId: s.sb1 }, s.t.dean);
  assert.equal(r.ok, true);
  const row = (id) => r.data.ledger.students.find((x) => x.id === id);
  assert.deepEqual([row(s.a1).total, row(s.a1).word], [82, 'good']);
  assert.deepEqual([row(s.a2).total, row(s.a2).word], [58, 'fail']);
  assert.equal(row(s.a3).status, 'not_admitted');
});

test('repeatCard() and repeatTry() write rows straight into the store and return ids; snapshot() copies both tables', () => {
  const s = setup();
  const id = s.repeatCard();
  assert.match(id, /^rp_/);
  assert.deepEqual([s.store.get('repeats', id).kind, s.store.get('repeats', id).prevTotal, s.store.get('repeats', id).teacherId], ['full', 58, s.ids.teacher1]);
  assert.equal(s.store.get('repeats', s.repeatCard({ kind: 'exam', studentId: s.a1 })).kind, 'exam');
  const tryId = s.repeatTry(id, { score: 25 });
  assert.match(tryId, /^rx_/);
  assert.deepEqual([s.store.get('repeatAttempts', tryId).no, s.store.get('repeatAttempts', tryId).score], [1, 25]);
  const snap = s.snapshot();
  assert.equal(snap.repeats.length, 2);
  assert.equal(snap.repeatAttempts.length, 1);
});

test('switchSemester(): the semester 2 is saved through a real settings.save', () => {
  const s = setup();
  const r = s.switchSemester();
  assert.equal(r.ok, true);
  assert.equal(s.call('settings.get', {}, s.t.dean).data.settings.semester, 2);
});

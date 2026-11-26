import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSqliteStore, ensureTables, openDatabase } from '../backend/store/sqliteStore.js';
import { hashPassword } from '../core/auth.js';
import { dev, PASSWORD, setup } from './journalSetup.js';

// The base of the test: SQLite in a temporary file, removed after the test.
function sqliteSetup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-checkin-'));
  let db;
  const makeStore = (schema, platform) => {
    db = openDatabase(path.join(dir, 'journal.sqlite'));
    ensureTables(schema, db);
    return createSqliteStore(schema, platform, db);
  };
  const s = setup({ makeStore });
  t.after(() => {
    try { db.close(); } catch (error) { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return s;
}

test('SQLite: a wrong code stays in the base, the counter does not roll back', (t) => {
  const s = sqliteSetup(t);
  const { call, t: tokens, at, store, p0922, a1 } = s;
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, tokens.teacher1);
  const wrong = () => call('checkin.mark', { pairId: p0922, device: dev(1), code: '0000' }, tokens.a1);
  assert.deepEqual([wrong().data, wrong().data], [{ result: 'wrong_code', attemptsLeft: 4 }, { result: 'wrong_code', attemptsLeft: 3 }]);
  assert.deepEqual(store.list('checkins').map((x) => [x.pairId, x.studentId, x.device, x.way, x.result, x.at]),
    [[p0922, a1, dev(1), 'code', 'wrong', '2026-09-22 07:58:00'], [p0922, a1, dev(1), 'code', 'wrong', '2026-09-22 07:58:00']]);
  assert.equal(call('checkin.current', {}, tokens.a1).data.pair.attemptsLeft, 3);
});

test('SQLite: a refused request leaves no half-written settling, the next one finishes it once', (t) => {
  const s = sqliteSetup(t);
  const { call, t: tokens, at, tick, store, p0922, a1, a2, a3 } = s;
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, tokens.teacher1);
  store.insert('attendance', { pairId: p0922, studentId: a1, status: 'present', noCoat: false, activity: null, source: 'code', markedBy: a1, markedAt: '2026-09-22 07:58:10' });
  tick(6 * 60000);
  const before = s.snapshot();
  assert.equal(before.pairs.find((p) => p.id === p0922).checkinClosed, false);
  // the window is over: the request would settle, but it is refused (another group), and the refusal takes the settling back
  assert.equal(call('checkin.mark', { pairId: p0922, device: dev(1), code: '0000' }, tokens.b1).error.code, 'forbidden');
  assert.deepEqual(s.snapshot(), before);
  assert.equal(call('checkin.current', {}, tokens.a1).data.pair.phase, 'lesson');
  const absent = () => store.list('attendance').filter((x) => x.pairId === p0922 && x.source === 'auto').map((x) => [x.studentId, x.status]).sort();
  assert.deepEqual(absent(), [[a2, 'absent'], [a3, 'absent']].sort());
  assert.equal(store.get('pairs', p0922).checkinClosed, true);
  call('checkin.current', {}, tokens.a1);
  assert.equal(absent().length, 2);
});

test('SQLite: 25 students check in one after another, with 4000 rows of the past in the attendance', (t) => {
  const s = sqliteSetup(t);
  const { call, t: tokens, at, store, g1, p0922 } = s;
  const teacherId = s.ids.teacher1;
  const hash = hashPassword(s.platform, PASSWORD);
  const extra = [];
  for (let i = 1; i <= 22; i++) extra.push(store.insert('students', { fullName: `Тестов Номер${i}`, groupId: g1, cardNo: `N${String(i).padStart(2, '0')}`, passwordHash: hash, lang: 'ky', mustChangePassword: false, active: true }));
  const everyone = [s.a1, s.a2, s.a3, ...extra.map((x) => x.id)];
  assert.equal(store.list('students').filter((x) => x.groupId === g1 && x.active === true).length, 25);
  const past = [];
  for (let i = 0; i < 4000; i++) past.push({ pairId: 'p_old' + (i % 200), studentId: everyone[i % everyone.length], status: 'present', noCoat: false, activity: null, source: 'teacher', markedBy: teacherId, markedAt: '2026-09-01 08:10:00' });
  store.insertMany('attendance', past);
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, tokens.teacher1);
  const code = call('lesson.get', { pairId: p0922 }, tokens.teacher1).data.lesson.code.now;
  const people = ['A1', 'A2', 'A3', ...extra.map((x) => x.cardNo)];
  const sessions = people.map((name) => call('auth.login', { login: name, password: PASSWORD }).data.token);
  const started = performance.now();
  const results = sessions.map((token, i) => call('checkin.mark', { pairId: p0922, device: i.toString(16).padStart(2, '0').repeat(16), code }, token));
  const elapsed = performance.now() - started;
  console.log('load test, 25 check-ins: ' + Math.round(elapsed) + ' ms');
  assert.ok(results.every((r) => r.ok === true && r.data.result === 'ok'), JSON.stringify(results.filter((r) => !(r.ok === true && r.data.result === 'ok'))));
  assert.equal(store.list('attendance').filter((x) => x.pairId === p0922).length, 25);
  assert.ok(elapsed < 20000, String(elapsed));
});

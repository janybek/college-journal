import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeAt, issuePass, lessonClock, pairKey } from '../core/lesson.js';
import { parseLocalDateTime } from '../core/dates.js';
import { dev, setup } from './journalSetup.js';

// A second pair of sb1 on `date` (slot 2, 09:40) for teacher1.
function secondPair(s, date) {
  const { id, ...row } = s.pairOf(s.sb1, date);
  return s.store.insert('pairs', { ...row, slot: 2, startTime: '09:40', planSlot: 2 }).id;
}
const readOnce = (spy, label) => { for (const [table, n] of Object.entries(spy.lists)) assert.ok(n <= 1, `${label} ${table}`); };

test('checkin.mark: the code, one phone, five wrong codes, the QR pass, the closed window', () => {
  const s = setup();
  const { call, t, at, tick, snapshot, store, platform, sb1, p0922, a1, a2, a3 } = s;
  at('2026-09-22', '07:58');
  assert.equal(call('lesson.start', { pairId: p0922 }, t.teacher1).ok, true);
  const code = () => call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson.code;
  const mark = (token, data) => call('checkin.mark', { pairId: p0922, device: dev(1), ...data }, token);
  // not the own group, a foreign pair, rubbish instead of the id: nothing is written
  call('journal.get', { subjectId: sb1 }, t.teacher1);
  const before = snapshot();
  assert.equal(mark(t.b1, { code: code().now }).error.code, 'forbidden');
  for (const bad of [[p0922], 5, ` ${p0922} `]) assert.equal(call('checkin.mark', { pairId: bad, device: dev(1), code: code().now }, t.a1).error.code, 'not_found');
  for (const data of [{ device: 'x' }, { device: dev(1) }, { device: dev(1), code: code().now, pass: 'pass1.x.y' }, { device: dev(1), code: 4827 }]) {
    assert.equal(call('checkin.mark', { pairId: p0922, ...data }, t.a1).error.code, 'bad_request');
  }
  for (const token of [t.teacher1, t.dean, undefined]) assert.notEqual(mark(token, { code: code().now }).ok, true);
  assert.deepEqual(snapshot(), before);
  // success by the code
  const ok = mark(t.a1, { code: code().now }).data;
  assert.deepEqual([ok.result, ok.at, ok.subjectName], ['ok', '07:58', 'Информатика']);
  assert.deepEqual(store.list('attendance').filter((x) => x.pairId === p0922).map((x) => [x.studentId, x.status, x.source, x.markedBy]), [[a1, 'present', 'code', a1]]);
  assert.deepEqual(mark(t.a1, { code: code().now, device: dev(9) }).data, { result: 'already', status: 'present', at: '07:58' });
  assert.equal(mark(t.a2, { code: code().now }).error.code, 'device_used');
  // the previous code is still accepted, a changed one is not, a very old one counts as expired
  // (a code of this step that repeats at step +2 or +3 would still be accepted there: move the clock one step on and take the next code)
  const repeats = () => {
    const pair = store.get('pairs', p0922);
    const step = lessonClock(pair, platform.now()).step;
    const key0 = pairKey(platform, pair);
    return [2, 3].some((k) => codeAt(platform, key0, step) === codeAt(platform, key0, step + k));
  };
  while (repeats()) tick(15000);
  const first = code();
  tick(15000);
  assert.equal(mark(t.a2, { code: first.now, device: dev(2) }).data.result, 'ok');
  tick(30000);
  assert.equal(mark(t.a3, { code: first.now, device: dev(3) }).error.code, 'code_expired');
  assert.equal(store.list('checkins').filter((x) => x.result === 'wrong').length, 0);
  // guessing: 5 wrong codes, the sixth (right) one is refused
  const wrong = (c) => mark(t.a3, { code: c, device: dev(3) });
  const right = code().now;
  const key = pairKey(platform, store.get('pairs', p0922));
  const near = [0, 1, 2, 3].map((step) => codeAt(platform, key, step));
  const bad = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999'].filter((c) => !near.includes(c)).slice(0, 5);
  assert.deepEqual(bad.map((c) => wrong(c).data), [4, 3, 2, 1, 0].map((attemptsLeft) => ({ result: 'wrong_code', attemptsLeft })));
  assert.equal(wrong(right).error.code, 'too_many_codes');
  assert.equal(call('checkin.current', {}, t.a3).data.pair.attemptsLeft, 0);
  // QR: the pass needs no sign-in and belongs to one device; it works after 5 wrong codes
  const qr = call('checkin.pass', { pairId: p0922, qr: code().qr, device: dev(3) }, undefined).data;
  assert.deepEqual(Object.keys(qr).sort(), ['checkinLeftMs', 'pass']);
  assert.equal(mark(t.a3, { pass: qr.pass, device: dev(4) }).error.code, 'bad_pass');
  // a pass with a changed expiry and the old signature is not a pass
  const [head, body, sign] = qr.pass.split('.');
  const forged = [head, encodeURIComponent(JSON.stringify({ ...JSON.parse(decodeURIComponent(body)), exp: JSON.parse(decodeURIComponent(body)).exp + 3600000 })), sign].join('.');
  const beforeForged = snapshot();
  assert.equal(mark(t.a3, { pass: forged, device: dev(3) }).error.code, 'bad_pass');
  assert.deepEqual(snapshot(), beforeForged);
  assert.equal(mark(t.a3, { pass: qr.pass, device: dev(3) }).data.result, 'ok');
  assert.equal(store.list('attendance').find((x) => x.pairId === p0922 && x.studentId === a3).source, 'qr');
  assert.equal(call('checkin.pass', { pairId: p0922, qr: 'f'.repeat(16), device: dev(5) }, undefined).error.code, 'bad_code');
  // after the window: the code, the pass and the QR are refused; the answers to a student hold no code
  const lastQr = code().qr;
  tick(5 * 60000);
  assert.equal(call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson.code, null);
  assert.equal(mark(t.a1, { code: '0000' }).error.code, 'window_closed');
  assert.equal(mark(t.a2, { pass: qr.pass, device: dev(3) }).error.code, 'window_closed');
  assert.equal(call('checkin.pass', { pairId: p0922, qr: lastQr, device: dev(6) }, undefined).error.code, 'window_closed');
  for (const word of [first.qr, first.nextQr, lastQr, '"code"', '"qr"']) assert.equal(JSON.stringify(call('checkin.current', {}, t.a1).data).includes(word), false, word);
  assert.equal(store.list('attendance').filter((x) => x.pairId === p0922).length, 3);
});

test('checkin: passes, rights, current, settling, one read per table', () => {
  const s = setup();
  const { call, t, at, tick, store, platform, spy, sb1, p0922, a1, a2, a3, g1, g2 } = s;
  const p0929 = s.pairOf(sb1, '2026-09-29').id;
  const second = secondPair(s, '2026-09-22');
  const mark = (token, data) => call('checkin.mark', { pairId: p0922, device: dev(1), ...data }, token);
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, t.teacher1);
  const lesson = () => call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson;
  // current: nothing in another group; the own window without secrets
  assert.deepEqual(call('checkin.current', {}, t.b1).data, { pair: null });
  assert.deepEqual(call('checkin.current', {}, t.a1).data.pair,
    { id: p0922, subjectName: 'Информатика', roomName: '', startTime: '08:00', teacherName: 'Иванова Нургуль', phase: 'checkin', checkinLeftMs: 300000, mark: null, attemptsLeft: 5 });
  // passes: another pair, a login token, the pass as a token, rubbish
  const exp = parseLocalDateTime(store.get('pairs', p0922).checkinUntil);
  assert.equal(mark(t.a1, { pass: issuePass(platform, { pairId: p0929, device: dev(1), exp }) }).error.code, 'bad_pass');
  assert.equal(mark(t.a1, { pass: t.a1 }).error.code, 'bad_pass');
  const pass = call('checkin.pass', { pairId: p0922, qr: lesson().code.qr, device: dev(1) }).data.pass;
  assert.equal(call('checkin.current', {}, pass).error.code, 'unauthorized');
  assert.equal(call('checkin.pass', { pairId: p0929, qr: lesson().code.qr, device: dev(1) }).error.code, 'not_running');
  for (const data of [{ pairId: p0922, qr: 5, device: dev(1) }, { pairId: [p0922], qr: 'a', device: dev(1) }, { pairId: p0922, qr: 'a', device: 'z' }]) {
    assert.equal(call('checkin.pass', data).error.code, 'bad_request');
  }
  // a student moved to another group after the start; a student switched off after the sign-in
  const code = lesson().code.now;
  store.update('students', a2, { groupId: g2 });
  assert.equal(mark(t.a2, { code, device: dev(2) }).error.code, 'forbidden');
  store.update('students', a2, { groupId: g1 });
  store.update('students', a3, { active: false });
  assert.equal(mark(t.a3, { code, device: dev(3) }).error.code, 'unauthorized');
  store.update('students', a3, { active: true });
  // success: every table is read once, one batch to the attendance and one to the check-ins
  spy.reset();
  assert.equal(mark(t.a1, { code }).data.result, 'ok');
  readOnce(spy, 'mark');
  assert.deepEqual(Object.keys(spy.writes).sort(), ['insertMany:attendance', 'insertMany:checkins']);
  assert.deepEqual([spy.writes['insertMany:attendance'], spy.writes['insertMany:checkins']], [1, 1]);
  spy.reset();
  call('checkin.current', {}, t.a1);
  readOnce(spy, 'current');
  spy.reset();
  const again = call('checkin.pass', { pairId: p0922, qr: lesson().code.qr, device: dev(7) });
  assert.equal(again.ok, true);
  assert.deepEqual(call('checkin.current', {}, t.a1).data.pair.mark, { status: 'present', at: '07:58' });
  const qrNow = lesson().code.qr;
  spy.reset();
  call('checkin.pass', { pairId: p0922, qr: qrNow, device: dev(7) });
  assert.equal(spy.lists.pairs, 1);
  // the window ended: the others are "absent" once, the mark of a1 is not touched
  const passOfA2 = call('checkin.pass', { pairId: p0922, qr: lesson().code.qr, device: dev(2) }).data.pass;
  tick(5 * 60000);
  assert.equal(mark(t.a2, { pass: passOfA2, device: dev(2) }).error.code, 'window_closed');
  assert.equal(call('checkin.current', {}, t.a1).data.pair.phase, 'lesson');
  const absent = () => store.list('attendance').filter((x) => x.pairId === p0922 && x.source === 'auto').map((x) => [x.studentId, x.status, x.markedAt]);
  assert.deepEqual(absent().sort(), [[a2, 'absent', '2026-09-22 08:03:00'], [a3, 'absent', '2026-09-22 08:03:00']].sort());
  call('checkin.current', {}, t.a1);
  assert.equal(absent().length, 2);
  assert.equal(store.list('attendance').find((x) => x.pairId === p0922 && x.studentId === a1).status, 'present');
  // the same phone is free on the second pair of the day
  at('2026-09-22', '09:41');
  assert.equal(call('lesson.start', { pairId: second }, t.teacher1).ok, true);
  const code2 = call('lesson.get', { pairId: second }, t.teacher1).data.lesson.code.now;
  assert.equal(call('checkin.mark', { pairId: second, device: dev(1), code: code2 }, t.a1).data.result, 'ok');
  assert.equal(store.get('pairs', p0922).status, 'closed');
});

test('checkin.mark: a pair started again does not carry over wrong codes, phones and passes', () => {
  const s = setup();
  const { call, t, at, tick, store, platform, p0922, a1, a2 } = s;
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, t.teacher1);
  const lesson = () => call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson;
  const mark = (token, data) => call('checkin.mark', { pairId: p0922, device: dev(1), ...data }, token);
  const key = pairKey(platform, store.get('pairs', p0922));
  const nope = ['0000', '1111', '2222', '3333'].find((c) => c !== codeAt(platform, key, 0));
  assert.equal(mark(t.a1, { code: nope }).data.result, 'wrong_code');
  store.insert('checkins', { pairId: p0922, studentId: a2, device: dev(2), way: 'code', result: 'ok', at: '2026-09-22 07:58:05' });
  const old = call('checkin.pass', { pairId: p0922, qr: lesson().code.qr, device: dev(1) }).data.pass;
  tick(4000);
  call('lesson.finish', { pairId: p0922 }, t.teacher1);
  assert.equal(store.get('pairs', p0922).status, 'planned');
  tick(4000);
  call('lesson.start', { pairId: p0922 }, t.teacher1);
  assert.equal(call('checkin.current', {}, t.a1).data.pair.attemptsLeft, 5);
  assert.equal(mark(t.a1, { pass: old }).error.code, 'bad_pass');
  assert.equal(mark(t.a1, { code: lesson().code.now, device: dev(2) }).data.result, 'ok');
  assert.equal(store.list('attendance').find((x) => x.pairId === p0922 && x.studentId === a1).source, 'code');
});

test('checkin.current: with two running pairs of one group the one with an open check-in is current', () => {
  for (const [startFirst, startSecond] of [['08:05', '09:32'], ['09:29', '09:40']]) {
    const s = setup();
    const { call, t, at, store, p0922, ids } = s;
    const { id, ...row } = store.get('pairs', p0922);
    const p2 = store.insert('pairs', { ...row, slot: 2, startTime: '09:40', planSlot: 2, teacherId: ids.teacher2, substitute: true }).id;
    at('2026-09-22', startFirst);
    assert.equal(call('lesson.start', { pairId: p0922 }, t.teacher1).ok, true);
    // only the first pair is running and it is in its check-in: it is the current one
    assert.equal(call('checkin.current', {}, t.a1).data.pair.id, p0922);
    at('2026-09-22', startSecond);
    const started = call('lesson.start', { pairId: p2 }, t.teacher2);
    assert.equal(started.ok, true);
    const current = call('checkin.current', {}, t.a1).data.pair;
    assert.deepEqual([current.id, current.phase], [p2, 'checkin']);
    assert.equal(call('checkin.mark', { pairId: current.id, device: dev(1), code: started.data.lesson.code.now }, t.a1).data.result, 'ok');
  }
});

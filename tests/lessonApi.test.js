import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_TABLES } from '../backend/lessonData.js';
import { setup } from './journalSetup.js';

// A second pair of sb1 on `date` (slot 2, 09:40) for teacher1.
function secondPair(s, date) {
  const { id, ...row } = s.pairOf(s.sb1, date);
  return s.store.insert('pairs', { ...row, slot: 2, startTime: '09:40', planSlot: 2 }).id;
}
const markA1 = (s, pairId, markedAt) => s.store.insert('attendance', {
  pairId, studentId: s.a1, status: 'present', noCoat: false, activity: null, source: 'code', markedBy: s.a1, markedAt,
});

test('lesson.start: the order of the checks, the codes, the window and the finish', () => {
  const s = setup();
  const { call, t, at, tick, snapshot, store, sb1, p0922 } = s;
  const start = (id = p0922, token = t.teacher1) => call('lesson.start', { pairId: id }, token);
  at('2026-09-22', '07:49');
  assert.equal(start().error.code, 'start_early');
  assert.deepEqual(call('lesson.mine', {}, t.teacher1).data.pairs.map((p) => [p.id, p.lesson, p.problem, p.startFrom]), [[p0922, null, 'start_early', '07:50']]);
  at('2026-09-22', '07:58');
  const before = snapshot();
  for (const token of [t.teacher2, t.teacher3, t.dean, t.prorector, t.admin, t.a1]) assert.equal(start(p0922, token).error.code, 'forbidden');
  for (const bad of [[p0922], 7, ` ${p0922} `, null]) assert.equal(start(bad).error.code, 'not_found');
  assert.deepEqual(snapshot(), before);
  const s0 = start().data.lesson;
  assert.deepEqual([s0.phase, s0.startedAt, s0.checkinLeftMs, s0.attended, s0.total, s0.students.map((x) => x.fullName)],
    ['checkin', '2026-09-22 07:58:00', 300000, 0, 3, ['Асанов Айдар', 'Ёлкин Бакыт', 'Өмүров Канат']]);
  assert.deepEqual([store.get('pairs', p0922).status, store.get('pairs', p0922).checkinUntil], ['running', '2026-09-22 08:03:00']);
  assert.match(s0.code.now, /^\d{4}$/); assert.match(s0.code.qr, /^[0-9a-f]{16}$/);
  assert.equal(s0.code.msToNext, 15000);
  assert.equal(start().data.lesson.startedAt, '2026-09-22 07:58:00');
  assert.deepEqual(call('lesson.mine', {}, t.teacher1).data.pairs.map((p) => [p.lesson, p.problem]), [['open', null]]);
  tick(16000);
  const g = call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual([g.code.now, g.code.msToNext], [s0.code.next, 14000]);
  // nobody but the leader gets the codes
  for (const token of [t.teacher2, t.teacher3, t.dean, t.prorector, t.a1]) assert.equal(call('lesson.get', { pairId: p0922 }, token).error.code, 'forbidden');
  for (const [action, data, token] of [['journal.get', { subjectId: sb1 }, t.dean], ['journal.get', { subjectId: sb1 }, t.teacher1], ['schedule.mine', {}, t.a1],
    ['schedule.list', {}, t.dean], ['student.grades', {}, t.a1], ['lesson.mine', {}, t.teacher1], ['journal.log', {}, t.dean], ['journal.list', {}, t.teacher1]]) {
    const text = JSON.stringify(call(action, data, token).data);
    for (const secret of [g.code.qr, g.code.nextQr, '"code"', '"qr"', 'nextQr']) assert.equal(text.includes(secret), false, action + ' ' + secret);
  }
  // the key of the pair is stored nowhere
  for (const table of ['pairs', 'attendance', 'checkins', 'changeLog']) assert.equal(JSON.stringify(store.list(table)).includes(g.code.qr), false, table);
  // end of the check-in earlier: nobody checked in, so nobody is made absent
  const e = call('lesson.endCheckin', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual([e.phase, e.code, store.get('pairs', p0922).checkinUntil, store.list('attendance').filter((x) => x.pairId === p0922).length], ['lesson', null, '2026-09-22 07:58:16', 0]);
  const afterEnd = snapshot();
  assert.equal(call('lesson.endCheckin', { pairId: p0922 }, t.teacher1).data.lesson.phase, 'lesson');
  assert.deepEqual(snapshot(), afterEnd);
  // finish without marks: not filled again
  assert.equal(call('lesson.finish', { pairId: p0922 }, t.teacher1).data.lesson.phase, 'none');
  assert.deepEqual([store.get('pairs', p0922).status, store.get('pairs', p0922).startedAt], ['planned', '']);
  // started again the same day: a new start, new codes
  tick(4000);
  const s2 = start().data.lesson;
  assert.equal(s2.startedAt, '2026-09-22 07:58:20');
  assert.notEqual(s2.code.qr, s0.code.qr);
  // endCheckin with a mark: the others become absent at the time of the click
  markA1(s, p0922, '2026-09-22 07:58:30');
  tick(10000);
  const e2 = call('lesson.endCheckin', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual([e2.phase, e2.attended, e2.students.map((x) => x.mark && x.mark.status)], ['lesson', 1, ['present', 'absent', 'absent']]);
  assert.deepEqual(store.list('attendance').filter((x) => x.pairId === p0922 && x.source === 'auto').map((x) => x.markedAt), ['2026-09-22 07:58:30', '2026-09-22 07:58:30']);
  // finish with a mark: closed, by teacher1; again: no write; others: forbidden
  const fin = call('lesson.finish', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual([fin.phase, fin.pair.status, store.get('pairs', p0922).finishedBy], ['over', 'closed', s.ids.teacher1]);
  const closed = snapshot();
  assert.equal(call('lesson.finish', { pairId: p0922 }, t.teacher1).data.lesson.phase, 'over');
  assert.equal(call('lesson.finish', { pairId: p0922 }, t.teacher2).error.code, 'forbidden');
  assert.equal(call('lesson.endCheckin', { pairId: p0922 }, t.teacher1).error.code, 'pair_locked');
  assert.equal(start().error.code, 'pair_locked');
  assert.deepEqual(snapshot(), closed);
  // a pair never started
  const p0929 = s.pairOf(sb1, '2026-09-29').id;
  const untouched = snapshot();
  for (const action of ['lesson.finish', 'lesson.endCheckin']) assert.equal(call(action, { pairId: p0929 }, t.teacher1).error.code, 'pair_locked', action);
  assert.deepEqual(snapshot(), untouched);
});

test('lesson.start: a second pair closes the first one, a refusal writes nothing', () => {
  const s = setup();
  const { call, t, at, tick, snapshot, store, sb1, ids } = s;
  const p1006 = s.pairOf(sb1, '2026-10-06').id;
  const p1006b = secondPair(s, '2026-10-06');
  // a refusal while the earlier pair runs leaves it alone
  at('2026-10-06', '07:58');
  assert.equal(call('lesson.start', { pairId: p1006 }, t.teacher1).ok, true);
  tick(60000);
  const before = snapshot();
  assert.equal(call('lesson.start', { pairId: p1006b }, t.teacher1).error.code, 'start_early');
  assert.deepEqual(snapshot(), before);
  assert.equal(store.get('pairs', p1006).status, 'running');
  // the first pair was due already at 09:28: the time of the due closing is taken, not the time of the click
  markA1(s, p1006, '2026-10-06 07:59:10');
  at('2026-10-06', '09:30:00');
  assert.equal(call('lesson.start', { pairId: p1006b }, t.teacher1).ok, true);
  assert.deepEqual([store.get('pairs', p1006).status, store.get('pairs', p1006).finishedAt, store.get('pairs', p1006).finishedBy], ['closed', '2026-10-06 09:28:00', '']);
  // the first pair is still running when the second starts: closed by the leader at that moment
  const p1013 = s.pairOf(sb1, '2026-10-13').id;
  const p1013b = secondPair(s, '2026-10-13');
  at('2026-10-13', '08:10:00');
  assert.equal(call('lesson.start', { pairId: p1013 }, t.teacher1).ok, true);
  markA1(s, p1013, '2026-10-13 08:11:00');
  at('2026-10-13', '09:30:00');
  assert.equal(call('lesson.start', { pairId: p1013b }, t.teacher1).ok, true);
  assert.deepEqual([store.get('pairs', p1013).status, store.get('pairs', p1013).finishedAt, store.get('pairs', p1013).finishedBy], ['closed', '2026-10-13 09:30:00', ids.teacher1]);
  assert.equal(store.get('pairs', p1013b).status, 'running');
  // without a mark the first pair is "not filled" again
  const p1020 = s.pairOf(sb1, '2026-10-20').id;
  const p1020b = secondPair(s, '2026-10-20');
  at('2026-10-20', '08:10:00');
  call('lesson.start', { pairId: p1020 }, t.teacher1);
  at('2026-10-20', '09:30:00');
  assert.equal(call('lesson.start', { pairId: p1020b }, t.teacher1).ok, true);
  assert.deepEqual([store.get('pairs', p1020).status, store.get('pairs', p1020).startedAt], ['planned', '']);
});

test('lesson.start: a substitute leads his pair, the teacher of the subject does not', () => {
  const s = setup();
  const { call, t, at, store, p0915, ids } = s;
  at('2026-09-15', '07:55');
  const before = s.snapshot();
  assert.equal(call('lesson.start', { pairId: p0915 }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('lesson.get', { pairId: p0915 }, t.teacher1).error.code, 'forbidden');
  assert.deepEqual(s.snapshot(), before);
  assert.equal(call('lesson.mine', {}, t.teacher1).data.pairs.length, 0);
  const mine = call('lesson.mine', {}, t.teacher3).data;
  assert.deepEqual([mine.today, mine.pairs.map((p) => [p.id, p.lesson, p.problem])], ['2026-09-15', [[p0915, 'start', null]]]);
  const lesson = call('lesson.start', { pairId: p0915 }, t.teacher3).data.lesson;
  assert.deepEqual([lesson.phase, store.get('pairs', p0915).substitute, store.get('pairs', p0915).startedBy], ['checkin', true, ids.teacher3]);
});

test('lesson.get: a pair not started and a pair of tomorrow have no phase and no code, nothing is written', () => {
  const s = setup();
  const { call, t, at, snapshot, p0922, sb1 } = s;
  at('2026-09-21', '12:00');
  const before = snapshot();
  for (const id of [p0922, s.pairOf(sb1, '2026-09-29').id]) {
    const lesson = call('lesson.get', { pairId: id }, t.teacher1).data.lesson;
    assert.deepEqual([lesson.phase, lesson.code, lesson.startedAt, lesson.checkinLeftMs, lesson.attended], ['none', null, '', null, 0]);
    assert.equal(lesson.pair.id, id);
  }
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(call('lesson.mine', {}, t.teacher1).data, { today: '2026-09-21', pairs: [] });
});

test('lesson: the shape of the answer, the marks and the check-ins of the students', () => {
  const s = setup();
  const { call, t, at, store, a1, a2, a3, a4, p0922, ids } = s;
  at('2026-09-22', '07:58');
  call('lesson.start', { pairId: p0922 }, t.teacher1);
  markA1(s, p0922, '2026-09-22 07:58:30');
  store.insert('checkins', { pairId: p0922, studentId: a1, device: '1'.repeat(32), way: 'code', result: 'ok', at: '2026-09-22 07:58:30' });
  store.insert('checkins', { pairId: p0922, studentId: a2, device: '2'.repeat(32), way: 'code', result: 'wrong', at: '2026-09-22 07:58:40' });
  store.insert('attendance', { pairId: p0922, studentId: a4, status: 'late', noCoat: true, activity: 4, source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-22 07:59:00' });
  const lesson = call('lesson.get', { pairId: p0922 }, t.teacher1).data.lesson;
  assert.deepEqual(Object.keys(lesson), ['now', 'pair', 'phase', 'startedAt', 'checkinLeftMs', 'lessonLeftMs', 'code', 'attended', 'total', 'students', 'scheme']);
  assert.deepEqual(Object.keys(lesson.pair), ['id', 'date', 'slot', 'startTime', 'endTime', 'status', 'subjectId', 'subjectName', 'groupName', 'roomName', 'topicName', 'number', 'lessonType', 'first', 'mode']);
  assert.deepEqual([lesson.pair.id, lesson.pair.endTime, lesson.pair.status, lesson.pair.subjectName, lesson.pair.groupName, lesson.pair.mode], [p0922, '09:30', 'running', 'Информатика', '01-1', 'free']);
  assert.equal(lesson.now, '07:58:00');
  assert.deepEqual(lesson.students.map((x) => [x.id, x.left]), [[a1, false], [a3, false], [a2, false], [a4, true]]);
  assert.deepEqual(lesson.students[0], { id: a1, fullName: 'Асанов Айдар', left: false, mark: { status: 'present', noCoat: false, activity: null, source: 'code' }, checkin: { at: '07:58:30', way: 'code' } });
  assert.deepEqual([lesson.students[2].mark, lesson.students[2].checkin], [null, null]);
  assert.deepEqual(lesson.students[3].mark, { status: 'late', noCoat: true, activity: 4, source: 'teacher' });
  assert.deepEqual([lesson.attended, lesson.total, lesson.scheme], [1, 3, { activity: 10 }]);
});

test('lesson.*: each table is read once, the start writes the pairs at most twice', () => {
  const s = setup();
  const { call, t, at, spy, p0922, sb1 } = s;
  const p1006 = s.pairOf(sb1, '2026-10-06').id;
  const p1006b = secondPair(s, '2026-10-06');
  at('2026-09-22', '07:58');
  spy.reset(); call('lesson.start', { pairId: p0922 }, t.teacher1);
  for (const table of LESSON_TABLES) assert.equal(spy.lists[table], 1, 'start ' + table);
  spy.reset(); call('lesson.get', { pairId: p0922 }, t.teacher1);
  for (const table of LESSON_TABLES) assert.equal(spy.lists[table], 1, 'get ' + table);
  assert.deepEqual(Object.keys(spy.writes), []);
  markA1(s, p0922, '2026-09-22 07:58:30');
  for (const action of ['lesson.endCheckin', 'lesson.finish']) {
    if (action === 'lesson.finish') s.tick(1000);
    spy.reset(); call(action, { pairId: p0922 }, t.teacher1);
    for (const table of LESSON_TABLES) assert.equal(spy.lists[table], 1, action + ' ' + table);
    assert.ok((spy.writes['updateMany:pairs'] || 0) <= 1, action);
  }
  spy.reset(); call('lesson.mine', {}, t.teacher1);
  assert.equal(spy.lists.pairs, 1);
  // a start that closes a running pair and settles the window of it: two batches of pairs at most
  at('2026-10-06', '07:58');
  call('lesson.start', { pairId: p1006 }, t.teacher1);
  markA1(s, p1006, '2026-10-06 07:59:00');
  at('2026-10-06', '09:30');
  spy.reset(); call('lesson.start', { pairId: p1006b }, t.teacher1);
  for (const table of LESSON_TABLES) assert.equal(spy.lists[table], 1, 'second start ' + table);
  assert.ok(spy.writes['updateMany:pairs'] <= 2);
  assert.deepEqual(Object.keys(spy.writes).filter((k) => !['updateMany:pairs', 'insertMany:attendance'].includes(k)), []);
});

test('lesson.start: a second pair started inside the window of the first closes it at that moment', () => {
  const s = setup();
  const { call, t, at, tick, store, sb1, ids, a1, a2, a3 } = s;
  const p1006 = s.pairOf(sb1, '2026-10-06').id;
  const p1006b = secondPair(s, '2026-10-06');
  at('2026-10-06', '09:29:00');
  assert.equal(call('lesson.start', { pairId: p1006 }, t.teacher1).ok, true);
  const code = call('lesson.get', { pairId: p1006 }, t.teacher1).data.lesson.code.now;
  assert.equal(call('checkin.mark', { pairId: p1006, device: '1'.repeat(32), code }, t.a1).data.result, 'ok');
  tick(60000);
  assert.equal(call('lesson.start', { pairId: p1006b }, t.teacher1).ok, true);
  const first = store.get('pairs', p1006);
  assert.deepEqual([first.status, first.finishedAt, first.finishedBy, first.checkinUntil, first.checkinClosed],
    ['closed', '2026-10-06 09:30:00', ids.teacher1, '2026-10-06 09:30:00', true]);
  assert.deepEqual(store.list('attendance').filter((x) => x.pairId === p1006).map((x) => [x.studentId, x.status, x.source, x.markedAt]).sort(),
    [[a1, 'present', 'code', '2026-10-06 09:29:00'], [a2, 'absent', 'auto', '2026-10-06 09:30:00'], [a3, 'absent', 'auto', '2026-10-06 09:30:00']].sort());
  assert.equal(store.get('pairs', p1006b).status, 'running');
});

test('lesson.mine: each table is read at most once', () => {
  const s = setup();
  const { call, t, at, spy } = s;
  at('2026-09-22', '07:58');
  spy.reset();
  assert.equal(call('lesson.mine', {}, t.teacher1).ok, true);
  assert.ok(Object.keys(spy.lists).length > 0);
  for (const [table, n] of Object.entries(spy.lists)) assert.ok(n <= 1, table);
});

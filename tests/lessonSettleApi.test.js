import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

// A started pair written into the store with one mark of a1 made by the code at `markedAt`.
function startWithMark(s, pairId, startedAt, markedAt) {
  s.running(pairId, startedAt);
  s.store.insert('attendance', { pairId, studentId: s.a1, status: 'present', noCoat: false, activity: null, source: 'code', markedBy: s.a1, markedAt });
}

test('settleLessons: the window, the absent marks, the log of a running pair and the closing', () => {
  const s = setup();
  const { call, t, at, tick, running, snapshot, spy, store, a1, a2, a3, a4, b1, sb1, p0922, pairOf } = s;
  const p0929 = pairOf(sb1, '2026-09-29').id;
  const p1006 = pairOf(sb1, '2026-10-06').id;
  const p1013 = pairOf(sb1, '2026-10-13').id;
  at('2026-09-22', '07:58:30');
  startWithMark(s, p0922, '2026-09-22 07:58:00', '2026-09-22 07:59:10');

  at('2026-09-22', '08:02:59');
  spy.reset(); call('journal.get', { subjectId: sb1 }, t.teacher1);
  assert.deepEqual(Object.keys(spy.writes), []);                                                   // the window is still going
  for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, table);
  const j0 = call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal;
  assert.deepEqual([j0.marks[p0922][a1].status, j0.marks[p0922][a2], j0.pairs.find((p) => p.id === p0922).lesson], ['present', undefined, 'open']);
  tick(1000);                                                                                       // 08:03:00
  spy.reset(); call('journal.get', { subjectId: sb1 }, t.teacher1);
  assert.deepEqual([spy.writes['insertMany:attendance'], spy.writes['updateMany:pairs']], [1, 1]);
  for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, table);
  const rowsOf = (id) => store.list('attendance').filter((x) => x.pairId === p0922 && x.studentId === id);
  assert.deepEqual([a2, a3, a4, b1].map((id) => rowsOf(id).map((x) => [x.status, x.source, x.markedAt])),
    [[['absent', 'auto', '2026-09-22 08:03:00']], [['absent', 'auto', '2026-09-22 08:03:00']], [], []]);
  spy.reset(); call('journal.get', { subjectId: sb1 }, t.dean); call('schedule.mine', {}, t.a1);
  assert.deepEqual(Object.keys(spy.writes), []);                                                   // a second settling writes nothing
  // a running pair: the teacher's corrections (Review Focus 8)
  call('journal.savePair', { pairId: p0922, marks: [{ studentId: a2, status: 'late' }, { studentId: a3, status: 'absent' }] }, t.teacher1);
  assert.deepEqual(store.list('changeLog').map((r) => [r.studentId, r.field, r.before, r.after, r.reason]), [[a2, 'status', 'absent', 'late', '']]);
  call('journal.savePair', { pairId: p0922, marks: [{ studentId: a1, status: 'present', activity: 7 }] }, t.teacher1);
  assert.equal(store.list('changeLog').length, 1);                                                  // activity during the pair is not logged
  call('journal.savePair', { pairId: p0922, marks: [{ studentId: a1, status: 'absent' }] }, t.teacher1);   // a false mark taken off
  assert.deepEqual(store.list('changeLog').at(-1), { ...store.list('changeLog').at(-1), studentId: a1, field: 'status', before: 'present', after: 'absent' });
  // closing after 90 minutes: finishedAt is the due time, even if the request comes later
  at('2026-09-22', '11:00');
  call('schedule.mine', {}, t.a1);
  assert.deepEqual([store.get('pairs', p0922).status, store.get('pairs', p0922).finishedAt, store.get('pairs', p0922).finishedBy], ['closed', '2026-09-22 09:28:00', '']);
  // after the closing the rules of unit 3 apply: a correction of activity in time is logged
  call('journal.savePair', { pairId: p0922, marks: [{ studentId: a2, status: 'late', activity: 5 }] }, t.teacher1);
  assert.equal(store.list('changeLog').at(-1).field, 'activity');
  // a pair without a single mark is "not filled" again at the closing
  running(p0929, '2026-09-29 07:55:00'); at('2026-09-29', '09:30');
  const j = call('journal.get', { subjectId: sb1 }, t.teacher1).data.journal;
  assert.deepEqual([store.get('pairs', p0929).status, store.get('pairs', p0929).startedAt, j.pairs.find((p) => p.id === p0929).state], ['planned', '', 'open']);
  // a pair started before the bell takes marks at once (markState)
  running(p1006, '2026-10-06 07:52:00'); at('2026-10-06', '07:55');
  assert.equal(call('journal.savePair', { pairId: p1006, marks: [{ studentId: a1, status: 'present' }] }, t.teacher1).ok, true);
  // a running pair can be neither "missed", reset, moved nor cancelled
  for (const [action, data] of [['journal.missPair', { pairId: p1006, reason: 'x' }], ['journal.reopenPair', { pairId: p1006, reason: 'x' }],
    ['schedule.changePair', { id: p1006, slot: 2 }], ['schedule.cancelPair', { id: p1006 }]]) {
    const before = snapshot();
    assert.equal(call(action, data, t.dean).error.code, 'pair_locked', action);
    assert.deepEqual(snapshot(), before, action);
  }
  // the field lesson: teacher1 on p1013 at 07:50 is 'start'; the deanery null; the substitute teacher3 on his pair of 15.09 is 'start', teacher1 there null
  const lessonOf = (token, pairId) => call('journal.get', { subjectId: sb1 }, token).data.journal.pairs.find((p) => p.id === pairId).lesson;
  at('2026-10-13', '07:50');
  assert.equal(lessonOf(t.teacher1, p1013), 'start');
  assert.equal(lessonOf(t.dean, p1013), null);
  assert.equal(lessonOf(t.prorector, p1013), null);
  at('2026-09-15', '07:50');
  assert.equal(lessonOf(t.teacher3, s.p0915), 'start');
  assert.equal(lessonOf(t.teacher1, s.p0915), null);
  at('2026-10-13', '07:40');
  assert.equal(lessonOf(t.teacher1, p1013), null);                                                   // too early
  // nothing but startedAt and lesson of a pair reaches the journal
  running(p1013, '2026-10-13 07:58:00');
  at('2026-10-13', '08:00');
  const answer = call('journal.get', { subjectId: sb1 }, t.teacher1).data;
  const text = JSON.stringify(answer);
  for (const word of ['startedBy', 'checkinUntil', 'checkinClosed', 'finishedBy', '"code"', '"qr"']) assert.equal(text.includes(word), false, word);
  assert.equal(answer.journal.pairs.find((p) => p.id === p1013).startedAt, '2026-10-13 07:58:00');
});

test('settleLessons: the dean corrects a running pair with a reason; student.grades counts a closed pair', () => {
  const s = setup();
  const { call, t, at, store, a1, sb1, pairOf } = s;
  const p1013 = pairOf(sb1, '2026-10-13').id;
  startWithMark(s, p1013, '2026-10-13 07:58:00', '2026-10-13 07:59:00');
  at('2026-10-13', '08:10');
  const bad = call('journal.savePair', { pairId: p1013, marks: [{ studentId: a1, status: 'present', activity: 6 }] }, t.dean);
  assert.equal(bad.error.code, 'invalid');
  assert.deepEqual(store.list('changeLog'), []);
  assert.equal(call('journal.savePair', { pairId: p1013, marks: [{ studentId: a1, status: 'present', activity: 6 }], reason: 'исправление' }, t.dean).ok, true);
  assert.deepEqual(store.list('changeLog').map((r) => [r.studentId, r.field, r.before, r.after, r.reason]), [[a1, 'activity', '', '6', 'исправление']]);

  // p1013 is due at 09:28: the next request closes it, and the grades of a1 count it
  at('2026-10-13', '09:30');
  const pairs = call('student.grades', {}, t.a1).data.subjects[0].pairs;
  assert.deepEqual([store.get('pairs', p1013).status, store.get('pairs', p1013).finishedAt], ['closed', '2026-10-13 09:28:00']);
  assert.equal(pairs.some((p) => p.date === '2026-10-13'), true);
  const text = JSON.stringify(call('student.grades', {}, t.a1).data);
  for (const word of ['startedBy', 'checkinUntil', 'startedAt']) assert.equal(text.includes(word), false, word);
});

test('settleLessons: a transfer, a cancel or a restore settles a due pair in the same request', () => {
  const s = setup();
  const { call, t, at, store, sb1, pairOf } = s;
  const p1013 = pairOf(sb1, '2026-10-13').id;
  const p1020 = pairOf(sb1, '2026-10-20').id;
  const p1027 = pairOf(sb1, '2026-10-27').id;
  startWithMark(s, p1013, '2026-10-13 07:58:00', '2026-10-13 07:59:00');
  at('2026-10-13', '09:30');
  assert.equal(call('schedule.changePair', { id: p1020, slot: 2 }, t.dean).ok, true);
  assert.deepEqual([store.get('pairs', p1013).status, store.get('pairs', p1013).finishedAt], ['closed', '2026-10-13 09:28:00']);

  const p1006 = pairOf(sb1, '2026-10-06').id;
  startWithMark(s, p1006, '2026-10-06 07:58:00', '2026-10-06 07:59:00');
  assert.equal(call('schedule.cancelPair', { id: p1027 }, t.dean).ok, true);
  assert.equal(store.get('pairs', p1006).status, 'closed');

  const p0929 = pairOf(sb1, '2026-09-29').id;
  startWithMark(s, p0929, '2026-09-29 07:58:00', '2026-09-29 07:59:00');
  assert.equal(call('schedule.restorePair', { id: p1027 }, t.dean).ok, true);
  assert.equal(store.get('pairs', p0929).status, 'closed');
});

test('settleLessons: schedule lists read the pairs once; a due pair adds one read of students and attendance', () => {
  const s = setup();
  const { call, t, at, store, spy, sb1, pairOf } = s;
  const p1013 = pairOf(sb1, '2026-10-13').id;
  at('2026-10-13', '07:40');
  for (const action of ['schedule.mine', 'schedule.list']) {
    spy.reset(); call(action, {}, t.dean);
    assert.equal(spy.lists.pairs, 1, action);
    assert.equal(spy.lists.students, undefined, action);
    assert.equal(spy.lists.attendance, undefined, action);
  }
  startWithMark(s, p1013, '2026-10-13 07:58:00', '2026-10-13 07:59:00');
  at('2026-10-13', '08:10');
  for (const action of ['schedule.mine', 'schedule.list']) {
    store.update('pairs', p1013, { checkinClosed: false });
    store.list('attendance').filter((r) => r.source === 'auto').forEach((r) => store.remove('attendance', r.id));
    spy.reset(); call(action, {}, t.dean);
    assert.deepEqual([spy.lists.pairs, spy.lists.students, spy.lists.attendance], [1, 1, 1], action);
    assert.deepEqual([spy.writes['insertMany:attendance'], spy.writes['updateMany:pairs']], [1, 1], action);
  }
});

test('reopenPair of a closed QR pair clears what the start wrote', () => {
  const s = setup();
  const { call, t, at, store, sb1, pairOf } = s;
  const p1013 = pairOf(sb1, '2026-10-13').id;
  startWithMark(s, p1013, '2026-10-13 07:58:00', '2026-10-13 07:59:00');
  at('2026-10-13', '10:00');
  call('schedule.mine', {}, t.a1);
  assert.equal(store.get('pairs', p1013).status, 'closed');
  assert.equal(call('journal.reopenPair', { pairId: p1013, reason: 'ошибка' }, t.dean).ok, true);
  const p = store.get('pairs', p1013);
  assert.deepEqual([p.status, p.startedAt, p.startedBy, p.checkinUntil, p.checkinClosed, p.finishedAt, p.finishedBy], ['planned', '', '', '', false, '', '']);
});

test('settleLessons: no import of journalData, no timers in the backend', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  assert.equal(/from '[^']*journalData/.test(readFileSync(new URL('../backend/lessonSettle.js', import.meta.url), 'utf8')), false);
  for (const dir of ['../backend/', '../backend/handlers/', '../core/']) {
    for (const name of readdirSync(new URL(dir, import.meta.url)).filter((f) => f.endsWith('.js'))) {
      assert.equal(/setTimeout|setInterval/.test(readFileSync(new URL(dir + name, import.meta.url), 'utf8')), false, dir + name);
    }
  }
});

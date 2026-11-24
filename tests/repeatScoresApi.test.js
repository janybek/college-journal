// The works and the exam of a repeat course, closing it and reopening by the administrator (task 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';

const OLD = ['closures', 'subjectExams', 'examAttempts', 'unitResults', 'attendance', 'requests'];

function ready() {
  const s = setup();
  s.failed();
  s.at('2026-12-21');
  const enrolled = s.call('repeat.enrol', {
    subjectId: s.sb1, planSemester: 1, studentId: s.ids.a2, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1,
  }, s.t.dean);
  const id = enrolled.data.repeat.id;
  s.at('2027-01-20');
  const call = (action, data, token = s.t.teacher1) => s.call(action, { repeatId: id, ...data }, token);
  const old = () => { const all = s.snapshot(); return Object.fromEntries(OLD.map((t) => [t, all[t]])); };
  const logOf = (field) => s.store.list('changeLog').filter((r) => r.entity === 'repeat' && r.field === field);
  return { s, id, call, old, logOf };
}
const works = (call, n, extra = {}) => call('repeat.saveWorks', { works: n, note: 'Реферат', ...extra });
const tryOf = (call, score, extra = {}) => call('repeat.saveAttempt', { date: '2027-01-15', outcome: 'score', score, ...extra });

test('the whole chain: works, a reason for a change, the exam, closing, reopening', () => {
  const { s, id, call, old, logOf } = ready();
  const was = old();
  let r = call('repeat.saveWorks', { works: 45, note: 'Реферат и две практические работы' });
  assert.deepEqual([r.ok, r.data.repeat.result.status, r.data.repeat.result.semester], [true, 'none', 45]);
  assert.deepEqual([logOf('works').length, logOf('works')[0].before, logOf('works')[0].after], [1, '', '45']);
  assert.equal(call('repeat.saveWorks', { works: 50, note: 'Реферат' }).error.fields[0].field, 'reason');
  assert.equal(s.store.list('repeats')[0].works, 45);
  r = call('repeat.saveWorks', { works: 50, note: 'Реферат', reason: 'добавлена третья работа' });
  assert.equal(r.data.repeat.works.value, 50);
  assert.deepEqual([logOf('works').length, logOf('works')[1].before, logOf('works')[1].after, logOf('works')[1].reason], [2, '45', '50', 'добавлена третья работа']);
  // the same value, another note: no reason; nothing changed: no write
  r = call('repeat.saveWorks', { works: 50, note: 'Реферат и доклад' });
  assert.deepEqual([r.ok, r.data.repeat.works.note], [true, 'Реферат и доклад']);
  const b = s.snapshot();
  assert.equal(call('repeat.saveWorks', { works: 50, note: 'Реферат и доклад' }).ok, true);
  assert.deepEqual(s.snapshot(), b);

  r = tryOf(call, 30);
  assert.deepEqual([r.data.repeat.result.total, r.data.repeat.result.word, r.data.repeat.close.outcome], [80, 'good', 'passed']);
  assert.deepEqual([logOf('try1').length, logOf('try1')[0].before, logOf('try1')[0].after], [1, '', '30']);
  r = call('repeat.close', {});
  assert.deepEqual([r.data.repeat.status, r.data.repeat.closedByName !== ''], ['passed', true]);
  assert.deepEqual([logOf('status')[0].before, logOf('status')[0].after], ['open', 'passed']);
  for (const action of ['repeat.close', 'repeat.saveWorks', 'repeat.saveAttempt']) {
    assert.equal(call(action, { works: 1, note: 'x', date: '2027-01-15', outcome: 'absent', score: null }).error.code, 'repeat_closed');
  }
  assert.equal(call('repeat.reopen', { reason: 'ошибка' }, s.t.dean).error.code, 'forbidden');
  r = call('repeat.reopen', { reason: 'закрыт по ошибке' }, s.t.admin);
  assert.deepEqual([r.data.repeat.status, r.data.repeat.closedByName, r.data.repeat.closedAt], ['open', '', '']);
  assert.deepEqual([logOf('status')[1].before, logOf('status')[1].after, logOf('status')[1].reason], ['passed', 'open', 'закрыт по ошибке']);
  assert.equal(s.store.list('repeatAttempts').length, 1);
  assert.deepEqual(old(), was);
  assert.equal(id, s.store.list('repeats')[0].id);
});

test('not admitted, missing and incomplete exam, only-exam cards', () => {
  const { s, call } = ready();
  works(call, 30);
  const r = tryOf(call, 20);
  assert.deepEqual([r.ok, r.error.fields], [false, [{ field: 'repeat', code: 'not_admitted' }]]);
  assert.equal(call('repeat.close', {}).data.repeat.status, 'failed');

  const c2 = s.repeatCard({ studentId: s.ids.a3 });
  const c = (action, data, token = s.t.teacher1) => s.call(action, { repeatId: c2, ...data }, token);
  works(c, 31);
  assert.deepEqual(c('repeat.close', {}).error.fields, [{ field: 'close', code: 'exam_missing' }]);
  tryOf(c, null, { outcome: 'incomplete' });
  assert.deepEqual(c('repeat.close', {}).error.fields, [{ field: 'close', code: 'exam_incomplete' }]);

  const c3 = s.repeatCard({ studentId: s.ids.a1, kind: 'exam', prevSemester: 38 });
  const e = (action, data, token = s.t.teacher1) => s.call(action, { repeatId: c3, ...data }, token);
  assert.deepEqual(works(e, 40).error.fields, [{ field: 'works', code: 'not_needed' }]);
  const r3 = tryOf(e, 22);
  assert.deepEqual([r3.data.repeat.result.total, r3.data.repeat.result.word], [60, 'fair']);
  assert.equal(e('repeat.close', {}).data.repeat.status, 'passed');

  const c4 = s.repeatCard({ studentId: s.ids.b1, kind: 'exam', prevSemester: 38 });
  const f = (action, data, token = s.t.teacher1) => s.call(action, { repeatId: c4, ...data }, token);
  assert.equal(tryOf(f, 21).data.repeat.result.word, 'fail');
  assert.deepEqual(f('repeat.close', {}).error.fields, [{ field: 'acceptFail', code: 'required' }]);
  assert.equal(f('repeat.close', { acceptFail: false }).error.fields[0].field, 'acceptFail');
  assert.equal(f('repeat.close', { acceptFail: true }).data.repeat.status, 'failed');
});

test('the deadline: the last day passes, the next one is deadline_passed even for the administrator', () => {
  const { s, id, call, logOf } = ready();
  works(call, 40);
  s.at('2027-02-02');
  const b = s.snapshot();
  for (const token of [s.t.teacher1, s.t.dean, s.t.admin]) {
    assert.equal(call('repeat.saveWorks', { works: 41, note: 'x', reason: 'ещё работа' }, token).error.code, 'deadline_passed');
    assert.equal(call('repeat.saveAttempt', { date: '2027-01-30', outcome: 'score', score: 30 }, token).error.code, 'deadline_passed');
  }
  assert.deepEqual(s.snapshot(), b);
  s.at('2027-02-01');
  assert.equal(call('repeat.saveAttempt', { date: '2027-02-01', outcome: 'score', score: 30 }, s.t.admin).ok, true);
});

test('the deanery moves the deadline and the works pass again', () => {
  const { s, id, call, logOf } = ready();
  works(call, 40);
  s.at('2027-02-02');
  assert.equal(call('repeat.saveWorks', { works: 41, note: 'x', reason: 'ещё работа' }).error.code, 'deadline_passed');
  assert.equal(s.call('repeat.save', { repeatId: id, orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-03-01', teacherId: s.ids.teacher1 }, s.t.dean).ok, true);
  assert.equal(call('repeat.saveWorks', { works: 41, note: 'x', reason: 'ещё работа' }).ok, true);
  assert.equal(logOf('works').length, 2);
});

test('an overdue card without works: the teacher gets close/no_works, the deanery closes it as failed', () => {
  const { s, id, call } = ready();
  s.at('2027-02-02');
  assert.deepEqual(call('repeat.close', {}).error.fields, [{ field: 'close', code: 'no_works' }]);
  assert.equal(call('repeat.close', {}, s.t.prorector).error.code, 'forbidden');
  const r = call('repeat.close', {}, s.t.dean);
  assert.deepEqual([r.data.repeat.status, s.store.get('repeats', id).closedBy], ['failed', s.ids.dean]);
});

test('the commission: the third try belongs to the deanery', () => {
  const { s, call, logOf } = ready();
  works(call, 40);
  tryOf(call, 10);
  call('repeat.saveAttempt', { date: '2027-01-16', outcome: 'score', score: 11 });
  const b = s.snapshot();
  const third = { date: '2027-01-17', outcome: 'score', score: 25 };
  assert.equal(call('repeat.saveAttempt', third).error.code, 'forbidden');
  assert.deepEqual(call('repeat.saveAttempt', third, s.t.dean).error.fields, [{ field: 'commission', code: 'required' }]);
  assert.deepEqual(s.snapshot(), b);
  const r = call('repeat.saveAttempt', { ...third, commission: 'Комиссия: А., Б., В.' }, s.t.dean);
  assert.deepEqual([r.ok, r.data.repeat.attempts.length, r.data.repeat.result.next], [true, 3, null]);
  assert.equal(logOf('try3').length, 1);
  assert.deepEqual(call('repeat.saveAttempt', { date: '2027-01-18', outcome: 'score', score: 25 }, s.t.dean).error.fields, [{ field: 'repeat', code: 'not_allowed' }]);
});

test('correcting the last try: a reason, the number, the commission, earlier tries stay', () => {
  const { s, call, logOf } = ready();
  works(call, 40);
  tryOf(call, 10);
  let r = call('repeat.saveAttempt', { no: 1, score: 11, reason: 'описка' });
  assert.deepEqual([r.ok, r.data.repeat.attempts[0].score, r.data.repeat.attempts.length], [true, 11, 1]);
  assert.deepEqual([logOf('try1').length, logOf('try1')[1].before, logOf('try1')[1].after, logOf('try1')[1].reason], [2, '10', '11', 'описка']);
  assert.equal(s.store.list('repeatAttempts').length, 1);
  const b = s.snapshot();
  assert.equal(call('repeat.saveAttempt', { no: 1, score: 12 }).error.code, 'invalid');
  assert.deepEqual(s.snapshot(), b);
  // two tries: only the last one
  call('repeat.saveAttempt', { date: '2027-01-16', outcome: 'absent', score: null });
  const c = s.snapshot();
  assert.deepEqual(call('repeat.saveAttempt', { no: 1, score: 5, reason: 'x1' }).error.fields, [{ field: 'no', code: 'bad_value' }]);
  for (const no of [3, 0, '2', [2], {}]) assert.equal(call('repeat.saveAttempt', { no, score: 5, reason: 'x1' }).error.code, 'invalid');
  assert.deepEqual(s.snapshot(), c);
  r = call('repeat.saveAttempt', { no: 2, outcome: 'score', score: 12, reason: 'был, но не отмечен' });
  assert.deepEqual([r.ok, r.data.repeat.attempts.map((a) => a.score)], [true, [11, 12]]);
  assert.deepEqual([logOf('try2')[1].before, logOf('try2')[1].after], ['absent', '12']);
  // the date must stay after the earlier try
  assert.equal(call('repeat.saveAttempt', { no: 2, date: '2027-01-15', reason: 'x1' }).error.code, 'invalid');
  // a try with a commission: the deanery only
  call('repeat.saveAttempt', { date: '2027-01-17', outcome: 'score', score: 20, commission: 'Комиссия' }, s.t.dean);
  assert.equal(call('repeat.saveAttempt', { no: 3, score: 21, reason: 'x1' }).error.code, 'forbidden');
  r = call('repeat.saveAttempt', { no: 3, score: 21, reason: 'x1' }, s.t.dean);
  assert.deepEqual([r.data.repeat.attempts[2].commission, r.data.repeat.attempts.map((a) => a.score)], ['Комиссия', [11, 12, 21]]);
});

test('reopen: only the administrator, only a closed card, not under a newer card', () => {
  const { s, id, call } = ready();
  assert.equal(call('repeat.reopen', { reason: 'ошибка в ведомости' }, s.t.admin).error.code, 'not_closed');
  works(call, 40); tryOf(call, 30);
  call('repeat.close', {});
  assert.equal(call('repeat.reopen', {}, s.t.admin).error.fields[0].field, 'reason');
  for (const token of [s.t.teacher1, s.t.prorector, s.t.a2]) assert.equal(call('repeat.reopen', { reason: 'ошибка в ведомости' }, token).error.code, 'forbidden');
  const newer = s.repeatCard({ createdAt: '2027-01-20 10:00:00' });
  const b = s.snapshot();
  assert.deepEqual(call('repeat.reopen', { reason: 'ошибка в ведомости' }, s.t.admin).error.fields, [{ field: 'repeat', code: 'has_newer' }]);
  assert.deepEqual(s.snapshot(), b);
  s.store.update('repeats', newer, { status: 'cancelled' });
  assert.equal(call('repeat.reopen', { reason: 'ошибка в ведомости' }, s.t.admin).ok, true);
  s.store.update('repeats', id, { status: 'cancelled' });
  assert.equal(call('repeat.reopen', { reason: 'ошибка в ведомости' }, s.t.admin).error.code, 'not_closed');
});

const BODIES = {
  'repeat.saveWorks': { works: 45, note: 'Реферат' },
  'repeat.saveAttempt': { date: '2027-01-15', outcome: 'score', score: 30 },
  'repeat.close': {},
  'repeat.reopen': { reason: 'ошибка в ведомости' },
};

test('bypass: strangers, the current teacher of the subject and the replaced teacher get a refusal and the same tables', () => {
  const { s, id, call } = ready();
  works(call, 40);
  s.store.update('subjects', s.sb1, { teacherId: s.ids.teacher2 });
  const b = s.snapshot();
  // teacher2 teaches the subject now, but the card belongs to teacher1
  for (const token of [s.t.teacher2, s.t.prorector, s.t.a2, s.t.a1]) {
    for (const [action, data] of Object.entries(BODIES)) assert.equal(call(action, data, token).error.code, 'forbidden', action);
  }
  assert.deepEqual(s.snapshot(), b);
  // the deanery replaced the teacher: the former one is out
  assert.equal(s.call('repeat.save', { repeatId: id, orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher3 }, s.t.dean).ok, true);
  const c = s.snapshot();
  for (const [action, data] of Object.entries(BODIES)) assert.equal(call(action, data).error.code, 'forbidden', action);
  assert.deepEqual(s.snapshot(), c);
  // a cancelled card: forbidden for its teacher, not repeat_closed
  const cancelled = s.repeatCard({ studentId: s.ids.a3, status: 'cancelled', closedAt: '2026-12-22 10:00:00', teacherId: s.ids.teacher1 });
  assert.equal(s.call('repeat.close', { repeatId: cancelled }, s.t.teacher1).error.code, 'forbidden');
  assert.equal(s.call('repeat.close', { repeatId: cancelled }, s.t.dean).error.code, 'repeat_closed');
  for (const repeatId of [['x'], 12, {}, ' ' + id + ' ', '__proto__', '', undefined, null]) {
    for (const [action, data] of Object.entries(BODIES)) {
      const r = s.call(action, { ...data, repeatId }, s.t.admin);
      assert.deepEqual([r.ok, r.error.code], [false, 'not_found'], action);
    }
  }
});

test('bad values are invalid, not internal', () => {
  const { s, call } = ready();
  for (const w of ['45', 45.5, -1, 61, null, undefined, [45], {}]) {
    const r = call('repeat.saveWorks', { works: w, note: 'x' });
    assert.deepEqual([r.ok, r.error.code, r.error.fields[0].field], [false, 'invalid', 'works']);
  }
  for (const note of ['', '  ', 5, null, 'я'.repeat(301)]) assert.equal(call('repeat.saveWorks', { works: 40, note }).error.code, 'invalid');
  works(call, 40);
  const b = s.snapshot();
  for (const data of [{ score: 41 }, { score: -1 }, { score: 30.5 }, { score: '30' }, { outcome: 'passed' }, { outcome: 'absent', score: 5 }, { date: '2027-1-15' }, { date: '2027-01-21' }, { date: '2026-12-19' }, { date: undefined }]) {
    const r = call('repeat.saveAttempt', { date: '2027-01-15', outcome: 'score', score: 30, ...data });
    assert.deepEqual([r.ok, r.error.code], [false, 'invalid'], JSON.stringify(data));
  }
  for (const acceptFail of ['true', 1, [], {}]) assert.equal(call('repeat.close', { acceptFail }).error.code, 'invalid');
  assert.equal(call('repeat.close', {}).error.fields[0].code, 'exam_missing');
  assert.deepEqual(s.snapshot(), b);
});

test('the thresholds come from the settings: 50/50/25', () => {
  const { s, call } = ready();
  for (const [key, value] of [['scoreSemester', 50], ['scoreExam', 50], ['scoreAdmission', 25]]) s.store.insert('settings', { key, value });
  assert.equal(works(call, 51).error.fields[0].code, 'bad_value');
  assert.equal(works(call, 25).ok, true);
  assert.deepEqual(tryOf(call, 20).error.fields, [{ field: 'repeat', code: 'not_admitted' }]);
  assert.equal(works(call, 26, { reason: 'ещё работа' }).ok, true);
  assert.equal(tryOf(call, 51).error.code, 'invalid');
  assert.equal(tryOf(call, 50).data.repeat.result.total, 76);
});

test('the old tables stay, the log has a row for every change, every table is read once', () => {
  const { s, call, old, logOf } = ready();
  const was = old();
  s.spy.reset();
  works(call, 40);
  assert.deepEqual(Object.fromEntries(Object.entries(s.spy.lists).filter(([, n]) => n > 1)), {});
  assert.deepEqual(Object.keys(s.spy.writes).filter((k) => !/(insertMany:changeLog|updateMany:repeats)$/.test(k)), []);
  tryOf(call, 30);
  call('repeat.saveAttempt', { no: 1, score: 31, reason: 'описка' });
  call('repeat.saveWorks', { works: 41, note: 'x', reason: 'ещё' });
  call('repeat.close', {});
  call('repeat.reopen', { reason: 'ошибка в ведомости' }, s.t.admin);
  assert.deepEqual(old(), was);
  assert.deepEqual([logOf('works').length, logOf('try1').length, logOf('status').length], [2, 2, 2]);
  assert.equal(s.store.list('changeLog').filter((r) => r.entity === 'repeat' && r.field !== 'enrol').length, 8);   // 2 works, 2 notes (the first fill and the change), 2 tries, 2 statuses
  assert.equal(JSON.stringify(call('repeat.save', {}, s.t.dean)).includes('passwordHash'), false);
});

test('a change of the works and of the note in one request writes both lines of the change log', () => {
  const { call, logOf } = ready();
  call('repeat.saveWorks', { works: 45, note: 'Реферат' });
  const r = call('repeat.saveWorks', { works: 50, note: 'Реферат и доклад', reason: 'добавлен доклад' });
  assert.equal(r.ok, true);
  assert.deepEqual(logOf('works').map((x) => [x.before, x.after, x.reason]), [['', '45', ''], ['45', '50', 'добавлен доклад']]);
  assert.deepEqual(logOf('worksNote').map((x) => [x.before, x.after]), [['', 'Реферат'], ['Реферат', 'Реферат и доклад']]);
});

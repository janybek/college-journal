import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

const snapshotOf = (s) => JSON.stringify(['attendance', 'unitResults', 'changeLog', 'pairs'].map((table) => s.store.list(table)));
const pairId = (s, subjectId, date) => s.pairOf(subjectId, date).id;

test('journal.savePair: the first marks, the refusals and nothing written', () => {
  const s = setup();
  const { call, t, at, store, ids, a1, a2, a3, a4, b1, p0901, p0908 } = s;
  const all = (over = {}) => [a1, a2, a3].map((studentId) => ({ studentId, status: 'present', ...over[studentId] }));
  // the pair 01.09 is made a pair not yet marked
  store.update('pairs', p0901, { status: 'planned' });
  store.removeMany('attendance', store.list('attendance').filter((r) => r.pairId === p0901).map((r) => r.id));
  // before the bell
  at('2026-09-01', '07:59');
  assert.equal(call('journal.savePair', { pairId: p0901, marks: all() }, t.teacher1).error.code, 'too_early');
  // the first marks: all three, the pair becomes held, the change log is empty
  at('2026-09-01', '08:10');
  const first = call('journal.savePair', { pairId: p0901, marks: all({ [a2]: { status: 'absent' }, [a3]: { status: 'excused' } }) }, t.teacher1);
  assert.equal(first.ok, true);
  assert.deepEqual([store.get('pairs', p0901).status, store.list('attendance').filter((r) => r.pairId === p0901).length, store.list('changeLog').length], ['closed', 3, 0]);
  const row = store.list('attendance').find((r) => r.pairId === p0901 && r.studentId === a1);
  assert.deepEqual(row, { id: row.id, pairId: p0901, studentId: a1, status: 'present', noCoat: false, activity: null, source: 'teacher', markedBy: ids.teacher1, markedAt: '2026-09-01 08:10:00' });
  assert.equal(first.data.journal.results[a1].units[0].current, 38);
  // a foreign student, a left one, a double, activity on the first pair, bad ids
  at('2026-09-08', '08:10');
  const before = snapshotOf(s);
  const refuse = (marks, token = t.teacher1, extra = {}) => call('journal.savePair', { pairId: p0908, marks, ...extra }, token).error;
  assert.deepEqual(refuse([...all(), { studentId: b1, status: 'present' }]).fields, [{ index: 3, field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(refuse([...all(), { studentId: a4, status: 'present' }]).fields, [{ index: 3, field: 'studentId', code: 'bad_ref' }]);
  assert.equal(refuse([...all(), { studentId: a1, status: 'absent' }]).code, 'bad_request');
  assert.deepEqual(refuse(all({ [a2]: { status: 'absent', activity: 4 } })).fields, [{ index: 1, field: 'activity', code: 'not_allowed' }]);
  assert.deepEqual(refuse(all({ [a1]: { status: 'был' } })).fields, [{ index: 0, field: 'status', code: 'bad_value' }]);
  for (const bad of [[p0908], 7, ` ${p0908} `, null]) assert.equal(call('journal.savePair', { pairId: bad, marks: all() }, t.teacher1).error.code, 'not_found');
  const tooMany = Array.from({ length: 201 }, () => ({ studentId: a1, status: 'present' }));
  for (const bad of ['x', [], [null], [{ studentId: [a1], status: 'present' }], [{ studentId: 7, status: 'present' }], tooMany]) assert.equal(refuse(bad).code, 'bad_request');
  assert.equal(refuse(all(), t.teacher2).code, 'forbidden');
  assert.equal(refuse(all(), t.prorector).code, 'forbidden');
  assert.equal(refuse(all(), t.a1).code, 'forbidden');
  assert.equal(snapshotOf(s), before);
  // in term: the edit of a saved mark without a reason writes the change log
  call('journal.savePair', { pairId: p0908, marks: all({ [a1]: { activity: 7 }, [a2]: { status: 'late', activity: 5 }, [a3]: { status: 'absent' } }) }, t.teacher1);
  assert.equal(store.list('changeLog').length, 0);
  call('journal.savePair', { pairId: p0908, marks: [{ studentId: a1, status: 'present', activity: 9 }] }, t.teacher1);
  assert.deepEqual(store.list('changeLog').map(({ id, at: when, ...r }) => r), [{ actorId: ids.teacher1, entity: 'mark', subjectId: s.sb1, pairId: p0908, studentId: a1,
    unit: null, field: 'activity', before: '7', after: '9', reason: '', late: false }]);
  call('journal.savePair', { pairId: p0908, marks: [{ studentId: a1, status: 'present', activity: 9 }] }, t.teacher1);
  assert.equal(store.list('changeLog').length, 1);
});

test('journal.savePair: an incomplete list on a pair not yet held', () => {
  const s = setup();
  const { call, t, at, store, a1, a2, a3 } = s;
  const p0922 = pairId(s, s.sb1, '2026-09-22');
  at('2026-09-22', '08:10');
  const before = snapshotOf(s);
  const marks = [a1, a2, a3].map((studentId) => ({ studentId, status: 'present' }));
  assert.deepEqual(call('journal.savePair', { pairId: p0922, marks: marks.slice(0, 2) }, t.teacher1).error.fields, [{ field: 'marks', code: 'incomplete' }]);
  assert.equal(snapshotOf(s), before);
  assert.equal(call('journal.savePair', { pairId: p0922, marks }, t.teacher1).ok, true);
  assert.equal(store.get('pairs', p0922).status, 'closed');
});

test('journal.savePair: after the term the teacher is limited, the dean needs a reason', () => {
  const s = setup();
  const { call, t, at, store, a2, a3, p0901 } = s;
  at('2026-09-08', '08:10');
  const late = (marks, extra = {}, token = t.teacher1) => call('journal.savePair', { pairId: p0901, marks, ...extra }, token);
  const before = snapshotOf(s);
  assert.deepEqual(late([{ studentId: a2, status: 'present' }], { reason: 'ошибся' }).error.fields, [{ index: 0, field: 'status', code: 'locked' }]);
  assert.deepEqual(late([{ studentId: a2, status: 'excused' }]).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(snapshotOf(s), before);
  assert.equal(late([{ studentId: a2, status: 'excused' }], { reason: 'справка' }).ok, true);
  assert.equal(late([{ studentId: a3, status: 'madeup' }], { reason: 'отработал на консультации' }).ok, true);
  assert.deepEqual(store.list('changeLog').slice(-2).map((r) => [r.studentId, r.before, r.after, r.reason, r.late]),
    [[a2, 'absent', 'excused', 'справка', true], [a3, 'excused', 'madeup', 'отработал на консультации', true]]);
  assert.deepEqual(late([{ studentId: a2, status: 'present' }], {}, t.dean).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(late([{ studentId: a2, status: 'present' }], { reason: 'x'.repeat(301) }, t.dean).error.fields[0].code, 'too_long');
  assert.equal(late([{ studentId: a2, status: 'present' }], { reason: 'ошибка преподавателя' }, t.dean).ok, true);
  assert.equal(store.list('changeLog').at(-1).reason, 'ошибка преподавателя');
});

test('journal.savePair: a pair not filled after the term, locked pairs', () => {
  const s = setup();
  const { call, t, at, store, a1, a2, a3 } = s;
  const p0922 = pairId(s, s.sb1, '2026-09-22');
  const p0929 = pairId(s, s.sb1, '2026-09-29');
  const all = [a1, a2, a3].map((studentId) => ({ studentId, status: 'present' }));
  at('2026-10-01', '09:00');
  const before = snapshotOf(s);
  assert.equal(call('journal.savePair', { pairId: p0922, marks: all }, t.teacher1).error.code, 'journal_closed');
  assert.deepEqual(call('journal.savePair', { pairId: p0922, marks: all }, t.dean).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(snapshotOf(s), before);
  assert.equal(call('journal.savePair', { pairId: p0922, marks: all, reason: 'преподаватель болел' }, t.dean).ok, true);
  assert.deepEqual(store.list('changeLog').map((r) => [r.entity, r.field, r.before, r.after, r.reason, r.late]), [['pair', 'status', 'planned', 'closed', 'преподаватель болел', true]]);
  // a cancelled and a missed pair
  store.update('pairs', p0929, { status: 'cancelled' });
  assert.equal(call('journal.savePair', { pairId: p0929, marks: all, reason: 'x' }, t.dean).error.code, 'pair_locked');
  store.update('pairs', p0929, { status: 'missed' });
  assert.equal(call('journal.savePair', { pairId: p0929, marks: all, reason: 'x' }, t.dean).error.code, 'pair_locked');
  assert.equal(store.list('attendance').filter((r) => r.pairId === p0929).length, 0);
});

test('journal.savePair: a substitution', () => {
  const s = setup();
  const { call, t, at, store, a1, a2, a3, p0908, p0915 } = s;
  at('2026-09-15', '08:10');
  const all = [a1, a2, a3].map((studentId) => ({ studentId, status: 'present' }));
  const before = snapshotOf(s);
  assert.equal(call('journal.savePair', { pairId: p0908, marks: all }, t.teacher3).error.code, 'forbidden');
  assert.equal(snapshotOf(s), before);
  const done = call('journal.savePair', { pairId: p0915, marks: all }, t.teacher3);
  assert.equal(done.ok, true);
  const j = done.data.journal;
  assert.deepEqual([j.partial, j.results, j.units, Object.keys(j.marks)], [true, {}, [], [p0915]]);
  assert.equal(JSON.stringify(j).includes('"activity":7'), false);
  assert.deepEqual([store.get('pairs', p0915).status, store.get('pairs', p0915).substitute], ['closed', true]);
  // the teacher of the subject may edit the substitute's pair too
  assert.equal(call('journal.savePair', { pairId: p0915, marks: [{ studentId: a1, status: 'absent' }] }, t.teacher1).ok, true);
  assert.equal(store.get('pairs', p0915).substitute, true);
});

test('journal.savePair: the term ends at the end of the last day, by Bishkek', () => {
  const s = setup();
  const { call, t, at, a1, p0908 } = s;
  at('2026-09-11', '23:59');
  assert.equal(call('journal.savePair', { pairId: p0908, marks: [{ studentId: a1, status: 'present', activity: 9 }] }, t.teacher1).ok, true);
  at('2026-09-12', '00:30');
  const back = [{ studentId: a1, status: 'present', activity: 7 }];
  assert.deepEqual(call('journal.savePair', { pairId: p0908, marks: back }, t.teacher1).error.fields, [{ index: 0, field: 'status', code: 'locked' }]);
});

test('journal.savePair: studentId of a wrong type or with spaces, a student added after the pair', () => {
  const s = setup();
  const { call, t, at, store, a1, g1, ids, p0908 } = s;
  at('2026-09-08', '08:10');
  const before = snapshotOf(s);
  assert.equal(call('journal.savePair', { pairId: p0908, marks: [{ studentId: 7, status: 'present' }] }, t.teacher1).error.code, 'bad_request');
  assert.deepEqual(call('journal.savePair', { pairId: p0908, marks: [{ studentId: ` ${a1} `, status: 'present' }] }, t.teacher1).error.fields, [{ index: 0, field: 'studentId', code: 'bad_ref' }]);
  assert.equal(snapshotOf(s), before);
  const a5 = store.insert('students', { fullName: 'Новиков Эрлан', groupId: g1, cardNo: 'A5', passwordHash: 'x', lang: 'ky', mustChangePassword: false, active: true }).id;
  const added = call('journal.savePair', { pairId: p0908, marks: [{ studentId: a5, status: 'present' }], reason: 'добавлен в группу' }, t.dean);
  assert.equal(added.ok, true);
  assert.deepEqual(store.list('changeLog').map((r) => [r.entity, r.studentId === a5, r.field, r.before, r.after, r.reason, r.actorId === ids.dean]),
    [['mark', true, 'status', '', 'present', 'добавлен в группу', true]]);
  assert.equal(store.list('attendance').find((r) => r.pairId === p0908 && r.studentId === a5).markedBy, ids.dean);
});

test('journal.savePair: each table once, one batch of writes', () => {
  const s = setup();
  const { call, t, at, spy, a1, a2, a3 } = s;
  const p0929 = pairId(s, s.sb1, '2026-09-29');
  at('2026-10-05', '09:00');
  spy.reset();
  const r = call('journal.savePair', { pairId: p0929, marks: [a1, a2, a3].map((studentId) => ({ studentId, status: 'present' })), reason: 'заполнено деканатом' }, t.dean);
  assert.equal(r.ok, true);
  for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, table);
  assert.deepEqual([spy.writes['insertMany:attendance'], spy.writes['insertMany:changeLog']], [1, 1]);
  assert.equal(spy.writes['updateMany:pairs'], 1);
});

test('journal.savePair: a held pair keeps its topic: it cannot be cancelled', () => {
  const s = setup();
  const { call, t, at, p0908 } = s;
  at('2026-09-08', '09:00');
  assert.equal(call('schedule.cancelPair', { id: p0908 }, t.dean).error.code, 'pair_locked');
});

test('journal.savePair: a held pair keeps its topic: a syllabus version without it is not submitted (held_missing)', () => {
  const s = setup();
  const { call, t, at, store, sb1 } = s;
  at('2026-09-09', '09:00');
  call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, t.teacher1);
  const draft = store.list('syllabi').find((x) => x.status === 'draft');
  store.removeMany('topics', [store.list('topics').find((x) => x.syllabusId === draft.id && x.name === 'Тема 1').id]);
  const sent = call('syllabus.submit', { syllabusId: draft.id }, t.teacher1).data;
  assert.equal(sent.submitted, false);
  assert.deepEqual(sent.checks.errors.filter((e) => e.code === 'held_missing'), [{ section: 'plan', code: 'held_missing', name: 'Тема 1', date: '2026-09-01' }]);
  assert.equal(store.get('syllabi', draft.id).status, 'draft');
});

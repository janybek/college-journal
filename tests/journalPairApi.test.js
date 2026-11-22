import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

const snapshotOf = (s) => JSON.stringify(['attendance', 'unitResults', 'changeLog', 'pairs'].map((table) => s.store.list(table)));

function pairSetup() {
  const s = setup();
  const p0922 = s.pairOf(s.sb1, '2026-09-22').id;
  const p0929 = s.pairOf(s.sb1, '2026-09-29').id;
  s.at('2026-09-16', '09:00');                         // 01.09 and 08.09 are held, 15.09 is not
  const miss = (pairId, extra = { reason: 'преподаватель болел' }, token = s.t.dean) => s.call('journal.missPair', { pairId, ...extra }, token);
  const reopen = (pairId, extra = { reason: 'пара была, журнал заполнят' }, token = s.t.dean) => s.call('journal.reopenPair', { pairId, ...extra }, token);
  const topicOf = (id) => s.store.get('pairs', id).topicId;
  return { ...s, p0922, p0929, miss, reopen, topicOf };
}

test('journal.missPair: the pair becomes missed, its topic goes to the next pair, the others keep theirs', () => {
  const s = pairSetup();
  const { store, t, p0901, p0908, p0915, p0922, p0929, miss, topicOf } = s;
  const was = topicOf(p0915);
  assert.notEqual(was, '');
  assert.equal(miss(p0915).ok, true);
  assert.deepEqual([store.get('pairs', p0915).status, topicOf(p0915), topicOf(p0922)], ['missed', '', was]);
  assert.deepEqual([topicOf(p0901) !== '', topicOf(p0908) !== '', topicOf(p0929) !== ''], [true, true, true]);   // relayout got the settings, not the rows of the sheet
  const entry = store.list('changeLog').at(-1);
  assert.deepEqual([entry.entity, entry.subjectId, entry.pairId, entry.field, entry.before, entry.after, entry.reason, entry.late, entry.actorId],
    ['pair', s.sb1, p0915, 'status', 'planned', 'missed', 'преподаватель болел', false, s.ids.dean]);
  assert.equal(miss(p0915).error.code, 'pair_locked');
  assert.equal(miss(p0908).error.code, 'pair_locked');
  assert.equal(miss(p0929).error.code, 'too_early');
  assert.deepEqual(miss(p0922, {}).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(miss(p0922, { reason: 'x'.repeat(301) }).error.fields[0].code, 'too_long');
  for (const token of [t.teacher1, t.prorector, t.a1]) assert.equal(miss(p0922, undefined, token).error.code, 'forbidden');
  for (const bad of [[p0922], 3, ` ${p0922} `, null]) assert.equal(miss(bad).error.code, 'not_found');
});

test('journal.missPair: a pair with a mark, nothing written on a refusal, the answer is the journal', () => {
  const s = pairSetup();
  const { store, t, ids, mark, p0915, miss, call } = s;
  mark(p0915, 'a1', 'present', null, '2026-09-15 08:10:00');
  const before = snapshotOf(s);
  assert.equal(miss(p0915).error.code, 'has_marks');
  assert.equal(snapshotOf(s), before);
  store.removeMany('attendance', store.list('attendance').filter((r) => r.pairId === p0915).map((r) => r.id));
  const done = call('journal.missPair', { pairId: p0915, reason: 'преподаватель болел' }, t.admin);
  assert.equal(done.ok, true);
  assert.equal(done.data.journal.subject.id, s.sb1);
  assert.equal(store.list('changeLog').at(-1).actorId, ids.admin);
  assert.equal(JSON.stringify(done.data).includes('passwordHash'), false);
  assert.deepEqual(Object.keys(done.data), ['journal']);
});

test('journal.missPair and journal.reopenPair: refusals write nothing', () => {
  const s = pairSetup();
  const { t, p0901, p0915, p0922, p0929, miss, reopen } = s;
  const before = snapshotOf(s);
  for (const [fn, id, extra, token] of [
    [miss, p0929, undefined, t.dean], [miss, p0901, undefined, t.dean], [miss, p0922, {}, t.dean], [miss, p0915, undefined, t.teacher1],
    [miss, p0915, undefined, t.prorector], [miss, [p0915], undefined, t.dean], [reopen, p0922, undefined, t.dean], [reopen, p0901, {}, t.dean],
    [reopen, p0901, undefined, t.teacher1], [reopen, p0901, undefined, t.prorector], [reopen, ` ${p0901} `, undefined, t.dean],
  ]) {
    assert.equal(fn(id, extra, token).ok, false);
  }
  assert.equal(snapshotOf(s), before);
});

test('journal.reopenPair: takes a missed pair back, clears the marks of a held one', () => {
  const s = pairSetup();
  const { store, t, p0901, p0908, p0915, p0922, miss, reopen, topicOf } = s;
  const was = topicOf(p0915);
  miss(p0915);
  assert.equal(reopen(p0915).ok, true);
  assert.deepEqual([store.get('pairs', p0915).status, topicOf(p0915), topicOf(p0922) !== was], ['planned', was, true]);
  const back = store.list('changeLog').at(-1);
  assert.deepEqual([back.entity, back.field, back.before, back.after, back.reason], ['pair', 'status', 'missed', 'planned', 'пара была, журнал заполнят']);

  const marksBefore = store.list('attendance').filter((x) => x.pairId === p0908).length;
  assert.equal(marksBefore, 3);
  const logBefore = store.list('changeLog').length;
  const otherMarks = store.list('attendance').filter((x) => x.pairId !== p0908).length;
  s.spy.reset();
  const done = reopen(p0908, { reason: 'отмечена не та пара' });
  assert.equal(done.ok, true);
  assert.deepEqual([store.get('pairs', p0908).status, store.list('attendance').filter((x) => x.pairId === p0908).length], ['planned', 0]);
  assert.equal(store.list('attendance').filter((x) => x.pairId !== p0908).length, otherMarks);
  assert.equal(store.list('changeLog').length >= logBefore + marksBefore + 1, true);
  assert.equal(store.list('changeLog').some((x) => x.entity === 'mark' && x.pairId === p0908 && x.field === 'status' && x.after === '' && x.reason === 'отмечена не та пара'), true);
  // the activity of the marks is logged too (a1 had 7, a2 had 5)
  const activity = store.list('changeLog').filter((x) => x.entity === 'mark' && x.pairId === p0908 && x.field === 'activity').map((x) => [x.before, x.after]).sort();
  assert.deepEqual(activity, [['5', ''], ['7', '']]);
  assert.equal(JSON.stringify(done.data).includes('passwordHash'), false);
  assert.deepEqual([s.spy.writes['removeMany:attendance'], s.spy.writes['insertMany:changeLog'], s.spy.writes['updateMany:pairs']], [1, 1, 1]);
  assert.equal(s.spy.writes['remove:attendance'], undefined);
  for (const table of JOURNAL_TABLES) assert.equal(s.spy.lists[table], 1, table);
  assert.equal(store.get('pairs', p0901).status, 'closed');                 // the other held pair is untouched
  assert.equal(reopen(p0922).error.code, 'pair_locked');
  for (const token of [t.teacher1, t.prorector]) assert.equal(reopen(p0901, undefined, token).error.code, 'forbidden');
});

test('journal.reopenPair: a substitution keeps its flag and teacher, the unit results stay, no marks are left', () => {
  const s = pairSetup();
  const { store, ids, p0915, reopen } = s;
  s.mark(p0915, 'a1', 'present', null, '2026-09-15 08:10:00');
  store.update('pairs', p0915, { status: 'closed' });
  store.insert('unitResults', { subjectId: s.sb1, studentId: s.a1, unit: 1, control: 10, self: 5, currentManual: null });
  const results = JSON.stringify(store.list('unitResults'));
  assert.equal(reopen(p0915, { reason: 'ошибочно отмечена' }).ok, true);
  assert.deepEqual([store.get('pairs', p0915).status, store.get('pairs', p0915).substitute, store.get('pairs', p0915).teacherId], ['planned', true, ids.teacher3]);
  assert.equal(JSON.stringify(store.list('unitResults')), results);
  assert.equal(store.list('attendance').some((r) => r.pairId === p0915), false);       // a planned pair never keeps marks: the restart of the schedule would delete it
});

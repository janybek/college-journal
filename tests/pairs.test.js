import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, pairFlags, canEditPair, canRestorePair, pairPatch, templateHref, topicText, lessonTypeKey, lessonParts } from '../site/js/pairs.js';
import { pairLock } from '../core/schedule.js';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { scheduleHandlers } from '../backend/handlers/schedule.js';

const p = (id, date, slot, extra = {}) => ({ id, date, slot, status: 'planned', substitution: false, moved: false, ...extra });

test('groupByDay: every day in a row from `from`, pairs ordered by slot', () => {
  assert.deepEqual(groupByDay([p('b', '2026-09-08', 2), p('a', '2026-09-08', 1), p('c', '2026-09-10', 1)], '2026-09-07', 4).map(d => [d.date, d.pairs.map(x => x.id)]),
    [['2026-09-07', []], ['2026-09-08', ['a', 'b']], ['2026-09-09', []], ['2026-09-10', ['c']]]);
  assert.equal(groupByDay([], '2026-09-07').length, 7);
});

test('pairFlags: cancelled, substitution, moved in this order', () => {
  assert.deepEqual(pairFlags(p('a', '2026-09-08', 1, { status: 'cancelled', substitution: true, moved: true })), ['cancelled', 'substitution', 'moved']);
  assert.deepEqual(pairFlags(p('a', '2026-09-08', 1)), []);
});

test('canEditPair: a planned pair of today or later', () => {
  assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-08'), true);
  assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-09'), false);
  assert.equal(canEditPair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01'), false);
});

test('canRestorePair: a cancelled pair of today or later', () => {
  assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-08'), true);
  assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-09'), false);   // прошедший день
  assert.equal(canRestorePair(p('a', '2026-09-08', 1), '2026-09-01'), false);                             // не отменена
});

test('canEditPair is the copy of pairLock(pair, today) === null from core', () => {
  for (const [pair, today] of [[p('a', '2026-09-08', 1), '2026-09-08'], [p('a', '2026-09-08', 1), '2026-09-09'],
    [p('a', '2026-09-08', 1, { status: 'closed' }), '2026-09-01'], [p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01'],
    [p('a', '2026-09-08', 1, { status: 'running' }), '2026-09-08']])
    assert.equal(canEditPair(pair, today), pairLock(pair, today) === null);
});

// Whether schedule.restorePair gets past its own check of the pair (status and day) on `today`, noon in Bishkek.
// What it checks after that (the place may be taken) is not the site's to know.
function serverMayRestore(pair, today) {
  const platform = createNodePlatform({ now: () => Date.parse(today + 'T12:00:00+06:00'), secret: 'test' });
  const store = createMemoryStore(SCHEMA, platform, { pairs: [{ ...pair }] });
  try {
    scheduleHandlers['schedule.restorePair']({ id: pair.id }, { store, platform });
    return true;
  } catch (error) {
    return !['pair_locked', 'in_past'].includes(error.code);
  }
}

test('canRestorePair is the copy of the check in schedule.restorePair', () => {
  for (const [pair, today] of [[p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-08'], [p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01'],
    [p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-09'], [p('a', '2026-09-08', 1), '2026-09-01'],
    [p('a', '2026-09-08', 1, { status: 'closed' }), '2026-09-01'], [p('a', '2026-09-08', 1, { status: 'running' }), '2026-09-08']])
    assert.equal(canRestorePair(pair, today), serverMayRestore(pair, today), `${pair.status} ${pair.date} on ${today}`);
});

test('pairPatch: only what differs from the pair, the note trimmed', () => {
  const pair = { teacherId: 'st_1', date: '2026-09-08', slot: 2, roomId: null, note: 'Ремонт' };
  const values = { teacherId: 'st_1', date: '2026-09-08', slot: '2', roomId: '', note: 'Ремонт' };
  assert.deepEqual(pairPatch(values, pair), {});
  assert.deepEqual(pairPatch({ ...values, note: '  Ремонт  ' }, pair), {});
  assert.deepEqual(pairPatch({ ...values, note: '   ' }, { ...pair, note: '' }), {});
  assert.deepEqual(pairPatch(values, { ...pair, roomId: null }), {});
  assert.deepEqual(pairPatch({ ...values, slot: '3' }, pair), { slot: 3 });
  assert.deepEqual(pairPatch({ ...values, roomId: 'rm_1', note: ' Новая ' }, pair), { roomId: 'rm_1', note: 'Новая' });
});

test('templateHref: a weekday of the schedule opens that day of the week template of the group', () => {
  assert.equal(templateHref('g_12ab34cd', '2026-11-16'), '#/template/g_12ab34cd/1');
  assert.equal(templateHref('g_12ab34cd', '2026-11-20'), '#/template/g_12ab34cd/5');
  assert.equal(templateHref('g_12ab34cd', '2026-11-21'), null);       // суббота: в шаблоне её нет
  assert.equal(templateHref('g_12ab34cd', '2026-11-22'), null);
  assert.equal(templateHref('', '2026-11-16'), null);
});

// The topic of a pair view (backend/scheduleData.js pairViews): a lesson of a syllabus row; `controls` — the modules without hours marked on it.
const lesson = (over) => ({ unit: 2, label: '2.3', name: 'Документооборот', kind: 'topic', lessonType: 'practice', part: 1, parts: 2, practiceKind: '', controls: [], ...over });

test('topicText: «№. name», the name alone, or the module of the unit when it has no name', () => {
  assert.deepEqual(topicText(lesson()), { key: 'pairs.topicLabel', params: { label: '2.3', name: 'Документооборот' } });
  assert.deepEqual(topicText(lesson({ label: '' })), { key: 'pairs.topicPlain', params: { name: 'Документооборот' } });
  assert.deepEqual(topicText(lesson({ kind: 'control', label: '', name: 'Экзамен' })), { key: 'pairs.topicPlain', params: { name: 'Экзамен' } });
  assert.deepEqual(topicText(lesson({ kind: 'control', label: '', name: '' })), { key: 'syllabus.controlN', params: { n: 2 } });
});

test('lessonTypeKey: a practice is named by its kind; a lecture and a module by their type', () => {
  assert.deepEqual([lesson(), lesson({ practiceKind: 'seminar' }), lesson({ practiceKind: 'lab' }), lesson({ lessonType: 'lecture', practiceKind: 'seminar' }), lesson({ lessonType: 'control' })].map(lessonTypeKey),
    ['lessonType.practice', 'lessonType.seminar', 'lessonType.lab', 'lessonType.lecture', 'lessonType.control']);
});

test('lessonParts: only when the row has more than one pair of this type', () => {
  assert.deepEqual([lessonParts(lesson()), lessonParts(lesson({ parts: 1 }))], [{ part: 1, parts: 2 }, null]);
});

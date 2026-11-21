import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupByDay, pairFlags, canEditPair, canRestorePair, pairPatch, templateHref, topicText, lessonTypeKey, lessonParts, controlLine,
  weekRows, gridDays, cellPairs, ownTime, hyphenate,
} from '../site/js/pairs.js';
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

test('controlLine: the modules marked on a lesson; the «Модуль» badge only for a mark without a name', () => {
  // «[Модуль] Модуль 1 (рубежный контроль)» said the same twice: two named marks are their names alone
  assert.deepEqual(controlLine([{ name: 'Модуль 1 (рубежный контроль)', unit: 1 }, { name: 'Зачёт', unit: 2 }]), {
    badge: false, names: [{ key: 'pairs.topicPlain', params: { name: 'Модуль 1 (рубежный контроль)' } }, { key: 'pairs.topicPlain', params: { name: 'Зачёт' } }],
  });
  // a mark without a name is the badge
  assert.deepEqual(controlLine([{ name: '', unit: 1 }]), { badge: true, names: [] });
  assert.deepEqual(controlLine([{ name: 'Зачёт', unit: 1 }, { name: '', unit: 2 }]), { badge: true, names: [{ key: 'pairs.topicPlain', params: { name: 'Зачёт' } }] });
  // no marks: an empty array, or anything that is not an array
  for (const none of [[], undefined, null, 'модуль', { name: 'x', unit: 1 }]) assert.deepEqual(controlLine(none), { badge: false, names: [] }, String(none));
  assert.deepEqual(controlLine([null, 'x', { name: 'Зачёт', unit: 1 }]), { badge: false, names: [{ key: 'pairs.topicPlain', params: { name: 'Зачёт' } }] });
});

// The week as a grid: rows are the pair numbers of the week, columns its days. 16 ноября 2026 — понедельник.
const P = (id, date, slot, startTime, endTime, extra = {}) => ({ id, date, slot, startTime, endTime, status: 'planned', ...extra });
const week = [P('a', '2026-11-16', 2, '09:40', '11:10'), P('b', '2026-11-18', 1, '08:00', '09:30'), P('c', '2026-11-17', 2, '09:45', '11:15'),
  P('d', '2026-11-16', 2, '09:40', '11:10', { status: 'cancelled' }), P('e', '2026-11-16', 2, '09:40', '11:10')];

test('weekRows: only the pair numbers of the week, with the time of the earliest pair of each number', () => {
  assert.deepEqual(weekRows(week), [{ slot: 1, startTime: '08:00', endTime: '09:30' }, { slot: 2, startTime: '09:40', endTime: '11:10' }]);
  assert.deepEqual(weekRows([]), []);
  // the bells changed in the middle of the week: the earliest pair by date, then by id, gives the time
  assert.deepEqual(weekRows([P('z', '2026-11-17', 1, '08:05', '09:35'), P('y', '2026-11-17', 1, '08:10', '09:40'), P('x', '2026-11-18', 1, '08:00', '09:30')]),
    [{ slot: 1, startTime: '08:10', endTime: '09:40' }]);
});

test('cellPairs: the pairs of one cell, the cancelled ones last', () => {
  assert.deepEqual(cellPairs(week, '2026-11-16', 2).map((p) => p.id), ['a', 'e', 'd']);            // отменённая — последней
  assert.deepEqual(cellPairs(week, '2026-11-19', 2), []);
});

test('gridDays: Monday to Friday always, Saturday and Sunday only with a pair', () => {
  assert.deepEqual(gridDays(week, '2026-11-16'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual(gridDays([...week, P('s', '2026-11-22', 1, '08:00', '09:30')], '2026-11-16').slice(5), ['2026-11-22']);       // воскресенье с парой; пустой субботы нет
  assert.deepEqual(gridDays([...week, P('s', '2026-11-21', 1, '08:00', '09:30')], '2026-11-16').slice(5), ['2026-11-21']);
  assert.deepEqual(gridDays([], '2026-11-16').length, 5);
});

test('ownTime: the time of a pair differs from the time of its row', () => {
  assert.deepEqual([ownTime(week[2], weekRows(week)[1]), ownTime(week[0], weekRows(week)[1])], [true, false]);
  assert.equal(ownTime(P('f', '2026-11-19', 2, '09:40', '11:15'), weekRows(week)[1]), true);
});

test('hyphenate: long words of a subject get soft hyphens between syllables, so a narrow grid card breaks them properly (T30)', () => {
  const shown = (text) => hyphenate(text).split('\u00AD').join('-');
  assert.equal(shown('Предпринимательство и менеджмент в здравоохранении'), 'Пред-при-ни-ма-тель-ство и ме-нед-жмент в здра-во-ох-ра-не-нии');
  assert.equal(shown('Информационное обеспечение профессиональной деятельности'), 'Ин-фор-ма-ци-он-ное обес-пе-че-ние про-фес-си-ональ-ной де-ятель-нос-ти');
  // short words, digits and signs stay as they are; the text without the soft hyphens is the name itself
  for (const name of ['Анатомия', 'Сүйлөө маданияты', 'ИКТ-2', '«Умные» гаджеты', '']) assert.equal(hyphenate(name).split('\u00AD').join(''), name);
  assert.equal(hyphenate('Химия 1.2'), 'Химия 1.2');
  // no piece shorter than two letters
  for (const word of hyphenate('Электрокардиография Фармакология Communication').split(' ')) {
    for (const piece of word.split('\u00AD')) assert.ok(piece.length >= 2, word);
  }
});

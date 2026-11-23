import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import {
  firstPairId, pairPoints, currentControl, unitTotal, gradeWord, attendanceStats, studentResults,
} from '../core/grades.js';

const S = DEFAULT_SCHEME;
const held = (extra) => ({ status: 'closed', lessonType: 'practice', first: false, ...extra });
const m = (status, activity = null) => ({ status, activity, noCoat: false });

test('points of a pair', () => {
  assert.deepEqual(pairPoints(m('present'), held({ first: true }), S), { earned: 20, possible: 20 });
  assert.deepEqual(pairPoints(m('present', 9), held({ first: true }), S), { earned: 20, possible: 20 });
  assert.deepEqual(pairPoints(m('present', 7), held(), S), { earned: 27, possible: 30 });
  assert.deepEqual(pairPoints(m('present'), held(), S), { earned: 20, possible: 30 });
  assert.deepEqual(pairPoints(m('late', 5), held(), S), { earned: 25, possible: 30 });
  assert.deepEqual(pairPoints(m('absent'), held(), S), { earned: 0, possible: 30 });
  assert.deepEqual(pairPoints(m('absent'), held({ first: true }), S), { earned: 0, possible: 20 });
  assert.deepEqual(pairPoints(m('madeup', 8), held(), S), { earned: 28, possible: 30 });
  assert.deepEqual(pairPoints(m('present', 15), held(), S), { earned: 30, possible: 30 });
  assert.equal(pairPoints(m('excused'), held(), S), null);
  assert.equal(pairPoints(null, held(), S), null);
  assert.equal(pairPoints(m('present', 7), held({ lessonType: 'control' }), S), null);
  assert.equal(pairPoints(m('present', 7), held({ status: 'planned' }), S), null);
  assert.deepEqual(pairPoints(m('present', 7), held({ status: 'running' }), S), { earned: 27, possible: 30 });
});

test('current control, totals, words', () => {
  assert.equal(currentControl([{ earned: 20, possible: 20 }, { earned: 27, possible: 30 }, { earned: 25, possible: 30 }, { earned: 0, possible: 30 }], S), 26);
  assert.equal(currentControl([{ earned: 100, possible: 140 }], S), 29);
  assert.equal(currentControl([{ earned: 25, possible: 80 }], S), 13);
  assert.equal(currentControl([], S), null);
  assert.deepEqual([unitTotal({ current: 29, self: 16, control: 30 }), unitTotal({ current: 29, self: null, control: 30 }), unitTotal({ current: null, self: 16, control: 30 })], [75, null, null]);
  assert.deepEqual([59, 60, 75, 76, 89, 90, 100, null].map((x) => gradeWord(x, S)), ['fail', 'fair', 'fair', 'good', 'good', 'excellent', 'excellent', null]);
});

test('first pair of a subject', () => {
  assert.equal(firstPairId([{ id: 'p2', date: '2026-09-08', slot: 1, status: 'planned' }, { id: 'p1', date: '2026-09-01', slot: 1, status: 'cancelled' }, { id: 'p3', date: '2026-09-08', slot: 2, status: 'closed' }]), 'p2');
  assert.equal(firstPairId([{ id: 'a', date: '2026-09-01', slot: 1, status: 'missed' }]), '');
  assert.equal(firstPairId([{ id: 'b', date: '2026-09-01', slot: 2, status: 'closed' }, { id: 'a', date: '2026-09-01', slot: 2, status: 'closed' }]), 'a');
});

test('attendance stats of nothing', () => {
  assert.deepEqual(attendanceStats([]), { marked: 0, attended: 0, late: 0, absent: 0, excused: 0, madeup: 0, noCoat: 0, percent: null });
});

// unit 1: pairs 1-5, a control pair; one pair without a topic
const pairs = [
  { id: 'p1', status: 'closed', lessonType: 'practice', first: true, unit: 1 },
  { id: 'p2', status: 'closed', lessonType: 'practice', first: false, unit: 1 },
  { id: 'p3', status: 'closed', lessonType: 'practice', first: false, unit: 1 },
  { id: 'p4', status: 'closed', lessonType: 'practice', first: false, unit: 1 },
  { id: 'p5', status: 'closed', lessonType: 'practice', first: false, unit: 1 },
  { id: 'p6', status: 'closed', lessonType: 'control', first: false, unit: 1 },
  { id: 'p7', status: 'closed', lessonType: 'practice', first: false, unit: null },
  { id: 'p8', status: 'planned', lessonType: 'practice', first: false, unit: 1 },
];
const marks = () => new Map([
  ['p1', m('present')], ['p2', m('present', 7)], ['p3', m('late', 5)], ['p4', m('absent')], ['p5', m('excused')],
  ['p6', { status: 'present', activity: null, noCoat: true }], ['p7', m('present', 7)],
]);
const rows = (extra) => new Map([[1, { unit: 1, self: 16, control: 30, currentManual: null, ...extra }]]);
const run = (over = {}) => studentResults({ pairs, marks: marks(), unitRows: rows(), units: [1, 2], scheme: S, ...over });

test('student results: the plan example', () => {
  const r = run();
  assert.deepEqual(r.units[0], { unit: 1, earned: 72, possible: 110, auto: 26, manual: null, current: 26, self: 16, control: 30, total: 72, word: 'fair', currentLow: false, controlLow: false });
  assert.deepEqual(r.units[1], { unit: 2, earned: 0, possible: 0, auto: null, manual: null, current: null, self: null, control: null, total: null, word: null, currentLow: false, controlLow: false });
  assert.deepEqual(r.outside, { earned: 27, possible: 30 });
  assert.deepEqual(r.attendance, { marked: 7, attended: 5, late: 1, absent: 1, excused: 1, madeup: 0, noCoat: 1, percent: 71 });
  assert.equal(r.preliminary, 72);
  assert.equal(r.word, 'fair');
});

test('student results: manual current, low marks, missing parts', () => {
  const manual = run({ unitRows: rows({ currentManual: 23 }) }).units[0];
  assert.equal(manual.current, 23);
  assert.equal(manual.auto, 26);
  assert.equal(manual.manual, 23);
  assert.equal(manual.currentLow, true);
  assert.equal(manual.total, 69);
  const low = run({ unitRows: rows({ control: 20 }) }).units[0];
  assert.equal(low.controlLow, true);
  const noSelf = run({ unitRows: rows({ self: null }) });
  assert.equal(noSelf.units[0].total, null);
  assert.equal(noSelf.preliminary, null);
  assert.equal(noSelf.word, null);
});

test('student results: preliminary is the mean of unit totals', () => {
  const unitRows = new Map([[1, { unit: 1, self: 16, control: 30, currentManual: 29 }], [2, { unit: 2, self: 20, control: 30, currentManual: 30 }]]);
  const r = studentResults({ pairs, marks: marks(), unitRows, units: [1, 2], scheme: S });
  assert.deepEqual([r.units[0].total, r.units[1].total], [75, 80]);
  assert.equal(r.preliminary, 78);
  assert.equal(r.word, 'good');
});

test('student results: self above the maximum is capped, total stays within 100', () => {
  const u = run({ unitRows: rows({ self: 25, control: 40, currentManual: 40 }) }).units[0];
  assert.equal(u.self, 20);
  assert.equal(u.total, 100);
});

test('student results: the minimum is the border of the low flags', () => {
  const at = run({ unitRows: rows({ currentManual: 24, control: 24 }) }).units[0];
  assert.deepEqual([at.currentLow, at.controlLow], [false, false]);
  const below = run({ unitRows: rows({ currentManual: 23, control: 23 }) }).units[0];
  assert.deepEqual([below.currentLow, below.controlLow], [true, true]);
});

test('attendance percent rounds half up', () => {
  assert.equal(attendanceStats([m('present'), m('present'), m('absent')]).percent, 67);
  assert.equal(attendanceStats([m('present'), m('absent'), m('absent'), m('absent'), m('absent'), m('absent'), m('absent'), m('absent')]).percent, 13);
});

test('student results: a shrunk scheme caps stored values, total never above 100', () => {
  const scheme = { ...S, current: 50, self: 20, control: 30 };
  const capped = run({ scheme, unitRows: rows({ control: 40, self: 20, currentManual: 55 }) }).units[0];
  assert.deepEqual([capped.control, capped.self, capped.manual, capped.current, capped.total], [30, 20, 50, 50, 100]);
  const one = [{ id: 'a', status: 'closed', lessonType: 'practice', first: true, unit: 1 }];
  const auto = studentResults({ pairs: one, marks: new Map([['a', m('present')]]), unitRows: rows({ control: 40, self: 20 }), units: [1], scheme }).units[0];
  assert.deepEqual([auto.auto, auto.current, auto.total], [50, 50, 100]);
});

test('half-up rounding is exact: no float error at the .5 boundary', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ status: i < 23 ? 'present' : 'absent' }));
  assert.equal(attendanceStats(items).percent, 58);
  assert.equal(currentControl([{ earned: 58, possible: 200 }], { ...S, current: 50 }), 15);
  assert.equal(currentControl([{ earned: 114, possible: 200 }], { ...S, current: 50 }), 29);
});

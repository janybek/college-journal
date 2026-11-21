import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortDate, unitGroups, describedRows, hasSelfHours, undated, scheduleNotes, mayHaveRenamed, renamedHint, fileName } from '../site/js/syllabus.js';

// A row of the syllabus page as syllabus.get gives it.
const R = (over) => ({ id: 'tp_1', kind: 'topic', unit: 1, label: '', name: 'Т', lectureHours: 2, practiceHours: 0, practiceKind: '', selfHours: null, description: '', planned: 1, pairs: [], ...over });

test('shortDate: day and month', () => {
  assert.equal(shortDate('2026-09-01'), '01.09');
});

test('unitGroups: rows of one unit in a row', () => {
  assert.deepEqual(unitGroups([R({ id: 'a' }), R({ id: 'b' }), R({ id: 'c', unit: 2 })]).map((g) => [g.unit, g.rows.map((r) => r.id)]), [[1, ['a', 'b']], [2, ['c']]]);
  assert.equal(unitGroups([R({}), R({})]).length, 1);
  // the title of a unit is that of its rows; a unit without one has ''
  assert.deepEqual(unitGroups([R({ unitTitle: 'Основы' }), R({ unitTitle: 'Основы' }), R({ unit: 2, unitTitle: '' }), R({ unit: 3 })]).map((g) => [g.unit, g.title]),
    [[1, 'Основы'], [2, ''], [3, '']]);
});

test('describedRows: topics with a description, modules left out', () => {
  assert.deepEqual(describedRows([R({ id: 'a', description: 'О теме' }), R({ id: 'b' }), R({ id: 'c', kind: 'control', description: 'мимо' })]).map((r) => r.id), ['a']);
});

test('hasSelfHours: a number at any row, zero included', () => {
  assert.deepEqual([hasSelfHours([R({})]), hasSelfHours([R({}), R({ selfHours: 0 })])], [false, true]);
});

test('undated: pairs of the row still without a date, only in the current semester', () => {
  assert.deepEqual([undated(R({ planned: 2, pairs: [{}] }), true), undated(R({ planned: 2, pairs: [{}] }), false), undated(R({ planned: 1, pairs: [{}, {}] }), true)], [1, 0, 0]);
});

test('scheduleNotes: how the plan fits the schedule of the semester', () => {
  const view = (schedule, pairs = 18) => ({ syllabus: { totals: { pairs }, schedule } });
  assert.deepEqual(scheduleNotes(view(null)), [{ tone: 'info', key: 'syllabus.otherSemester' }]);
  assert.deepEqual(scheduleNotes(view({ pairs: 0, unplaced: 18, withoutTopic: 0 })), [{ tone: 'info', key: 'syllabus.noSchedule' }]);
  assert.deepEqual(scheduleNotes(view({ pairs: 18, unplaced: 0, withoutTopic: 0 })), [{ tone: 'success', key: 'syllabus.fits', params: { pairs: 18 }, counts: { pairs: 'syllabus.pairsCount' } }]);
  assert.deepEqual(scheduleNotes(view({ pairs: 17, unplaced: 1, withoutTopic: 0 })), [{ tone: 'warning', key: 'syllabus.unplaced', params: { count: 1, planned: 18, scheduled: 17 } }]);
  assert.deepEqual(scheduleNotes(view({ pairs: 20, unplaced: 0, withoutTopic: 2 })), [{ tone: 'info', key: 'syllabus.spare', params: { count: 2 } }]);
});

// A semester of the check window as syllabus.preview gives it: whether it replaces the uploaded one and what it changes.
const S = (over) => ({ planSemester: 1, replaces: true, added: 0, changed: 0, removed: 0, ...over });

test('mayHaveRenamed: a replacing semester that both adds and removes rows may hold a renamed topic', () => {
  assert.deepEqual([S({ added: 1, removed: 1 }), S({ added: 1 }), S({ removed: 1 }), S({ replaces: false, added: 10, removed: 0 }), S({ replaces: false, added: 1, removed: 1 })].map(mayHaveRenamed),
    [true, false, false, false, false]);
});

test('renamedHint: the check window says what happens to a renamed topic when any semester may hold one', () => {
  assert.equal(renamedHint([S({ added: 2 }), S({ planSemester: 2, added: 1, removed: 1 })]), true);
  assert.equal(renamedHint([S({ added: 2 }), S({ planSemester: 2, changed: 3 })]), false);
  assert.equal(renamedHint([]), false);
});

test('fileName: «Силлабус — дисциплина — преподаватель.xlsx» without the characters a file name cannot hold', () => {   // M10
  assert.equal(fileName(['Силлабус', 'Информатика', 'Teacher One']), 'Силлабус — Информатика — Teacher One.xlsx');
  assert.equal(fileName(['Силлабус', 'Химия: органика/неорганика', 'Ли "А." <И>|?*']), 'Силлабус — Химия органика неорганика — Ли А. И.xlsx');
  assert.equal(fileName(['Силлабус', '', '  ']), 'Силлабус.xlsx');
  assert.equal(fileName(['Силлабус', 'Т'.repeat(300)]).length <= 160, true);
});

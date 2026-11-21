import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABS, tabOf, listAdd, listRemove, listMove, emptyItem, sectionData, isDirty, errorMap, tableNumbers, unitHasContent, withoutBlankRows,
} from '../site/js/syllabusForm.js';

const units = [{ unit: 1, title: 'Основы', lecture: [{ id: 'tp_1', name: 'Л', hours: 2, controlForms: '', selfHours: null, description: '', number: 1 }], practice: [], seminar: [], lab: [], control: [] },
  { unit: 2, title: '', lecture: [{ id: '', name: 'Новая', hours: 4, controlForms: '', selfHours: null, description: '' }], practice: [{ id: '', name: 'П', hours: 2, controlForms: '', selfHours: null, description: '' }], seminar: [], lab: [], control: [] }];

test('the tabs of the form; a tab of the address, the title page when it is empty or unknown', () => {
  assert.deepEqual(TABS, ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units', 'order']);
  assert.deepEqual([tabOf('plan'), tabOf(undefined), tabOf('grades')], ['plan', 'title', 'title']);
});

test('list helpers give new arrays and leave the list they got as it was', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual([listAdd(list, 'd'), listRemove(list, 1), listMove(list, 2, -1), listMove(list, 0, -1), listMove(list, 2, 1), list],
    [['a', 'b', 'c', 'd'], ['a', 'c'], ['a', 'c', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']]);
  assert.notEqual(listMove(list, 0, -1), list);
});

test('empty items of the form', () => {
  assert.deepEqual(emptyItem('lesson'), { id: '', name: '', hours: 2, controlForms: '', selfHours: null, description: '' });
  assert.equal(emptyItem('control').hours, 0);
  assert.deepEqual(emptyItem('unit'), { title: '', lecture: [], practice: [], seminar: [], lab: [], control: [] });
  assert.deepEqual(emptyItem('book'), { authors: '', title: '', year: '', publisher: '', availability: '' });
  assert.notEqual(emptyItem('unit').lecture, emptyItem('unit').lecture);
});

test('sectionData leaves out what the server counts itself', () => {
  assert.deepEqual(sectionData('plan', { plan: { manualOrder: false, units } }).units.map((u) => [Object.keys(u).includes('unit'), u.title, u.lecture.map((r) => Object.keys(r).includes('number'))]),
    [[false, 'Основы', [false]], [false, '', [false]]]);
  assert.deepEqual(sectionData('units', { units: { units: [{ unit: 1, title: 'Основы', description: 'О', questions: '', guidance: '', results: '', literature: [] }] } }).units,
    [{ unit: 1, description: 'О', questions: '', guidance: '', results: '', literature: [] }]);
});

test('the form never sends empty rows of a list', () => {
  const goals = { goal: 'Цель', knowledge: ['a', '  ', ''], skill: [], attitude: [''], prerequisite: ['x'], postrequisite: [] };
  assert.deepEqual(sectionData('goals', { goals }), { goal: 'Цель', knowledge: ['a'], skill: [], attitude: [], prerequisite: ['x'], postrequisite: [] });
  const book = { authors: '', title: '', year: '', publisher: '', availability: '' };
  assert.deepEqual(sectionData('units', { units: { units: [{ unit: 1, title: '', description: '', questions: '', guidance: '', results: '', literature: [book, { ...book, title: 'Книга' }] }] } }).units[0].literature,
    [{ ...book, title: 'Книга' }]);
  // a lesson without a name stays: the server names the mistake at its field
  const plan = { units: [{ ...emptyItem('unit'), lecture: [emptyItem('lesson')] }] };
  assert.equal(sectionData('plan', { plan }).units[0].lecture.length, 1);
  // the screen drops the same rows before it saves, so the places of the server's errors are the places on the screen
  assert.deepEqual(withoutBlankRows('goals', goals).knowledge, ['a']);
  assert.equal(withoutBlankRows('plan', plan), plan);
});

test('isDirty compares what would be sent', () => {
  assert.deepEqual([isDirty('goals', { goals: { goal: 'a' } }, { goals: { goal: 'a' } }), isDirty('goals', { goals: { goal: 'b' } }, { goals: { goal: 'a' } })], [false, true]);
  assert.equal(isDirty('goals', { goals: { goal: 'a', knowledge: [''] } }, { goals: { goal: 'a', knowledge: [] } }), false);
  assert.equal(isDirty('plan', { plan: { units } }, { plan: { units: [units[0]] } }), true);
});

test('errorMap: the errors of the server by the keys of the fields on the screen', () => {
  assert.deepEqual([...errorMap([{ field: 'credits', code: 'bad_value' }, { list: 'knowledge', code: 'too_many' }, { list: 'knowledge', index: 2, field: 'text', code: 'too_long' },
    { unit: 1, list: 'lecture', index: 0, field: 'hours', code: 'bad_hours' }, { list: 'units', code: 'required' }])],
  [['credits', 'bad_value'], ['knowledge', 'too_many'], ['knowledge.2.text', 'too_long'], ['u1.lecture.0.hours', 'bad_hours'], ['units', 'required']]);
  assert.deepEqual([...errorMap([{ unit: 2, field: 'title', code: 'too_long' }, { field: 'credits', code: 'required' }, { field: 'credits', code: 'bad_value' }])],
    [['u2.title', 'too_long'], ['credits', 'required']]);
  assert.deepEqual([...errorMap(undefined)], []);
});

test('tableNumbers: Л1, Л2… by kind, one after another through the units', () => {
  assert.deepEqual([...tableNumbers(units)], [['1.lecture.0', 1], ['2.lecture.0', 2], ['2.practice.0', 1]]);
});

test('a unit with a row asks before it is removed', () => {
  assert.deepEqual([unitHasContent(units[0]), unitHasContent(emptyItem('unit'))], [true, false]);
});

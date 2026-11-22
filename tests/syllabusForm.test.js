import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABS, tabOf, listAdd, listRemove, listMove, emptyItem, sectionData, isDirty, errorMap, tableNumbers, unitHasContent, withoutBlankRows,
  pairNumbers, canMove, moveLesson, checkTabs, checkLine, placeErrors, errorsAfterEdit, statusKind,
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

// ---- Task 42: «Порядок пар», the checks before submitting, the fixes after the review of task 41 ----

const lessons = [{ id: 'a', unit: 1, lessonKind: 'lecture', hours: 4 }, { id: 'b', unit: 1, lessonKind: 'practice', hours: 2 }, { id: 'm', unit: 1, lessonKind: 'control', hours: 0 },
  { id: 'c', unit: 2, lessonKind: 'lecture', hours: 2 }];

test('pairNumbers: the pairs a lesson takes, one after another; a control without hours takes none', () => {
  assert.deepEqual(pairNumbers(lessons), [{ id: 'a', from: 1, to: 2 }, { id: 'b', from: 3, to: 3 }, { id: 'm', from: null, to: null }, { id: 'c', from: 4, to: 4 }]);
  assert.deepEqual(pairNumbers([]), []);
});

test('canMove and moveLesson: only inside the unit', () => {
  assert.deepEqual([canMove(lessons, 0, -1), canMove(lessons, 0, 1), canMove(lessons, 2, 1), canMove(lessons, 3, -1)], [false, true, false, false]);     // через границу юнита нельзя
  assert.deepEqual([moveLesson(lessons, 1, -1).map((l) => l.id), moveLesson(lessons, 2, 1).map((l) => l.id)], [['b', 'a', 'm', 'c'], ['a', 'b', 'm', 'c']]);
  assert.notEqual(moveLesson(lessons, 2, 1), lessons);
  // a control without hours is a mark on the last pair of its unit: it never stands first there (the server refuses: control_first)
  const marks = [{ id: 'x', unit: 1, lessonKind: 'lecture', hours: 2 }, { id: 'y', unit: 1, lessonKind: 'control', hours: 0 }, { id: 'z', unit: 1, lessonKind: 'control', hours: 2 }];
  assert.deepEqual([canMove(marks, 1, -1), canMove(marks, 0, 1), canMove(marks, 2, -1), canMove(marks, 1, 1)], [false, false, true, true]);
});

const checks = { errors: [{ section: 'title', field: 'credits', code: 'required' }, { section: 'plan', unit: 2, code: 'unit_empty' }, { section: 'plan', code: 'held_missing', name: 'Введение', date: '2026-09-02' }],
  warnings: [{ section: 'literature', code: 'empty' }] };

test('checkTabs: the errors and the warnings of each tab', () => {
  assert.deepEqual([...checkTabs(checks)], [['title', { errors: 1, warnings: 0 }], ['plan', { errors: 2, warnings: 0 }], ['literature', { errors: 0, warnings: 1 }]]);
  // in the order of the tabs, whatever the order of the list
  assert.deepEqual([...checkTabs({ errors: [{ section: 'selfWork', index: 0, code: 'bad_unit' }, { section: 'goals', field: 'goal', code: 'required' }], warnings: [] }).keys()], ['goals', 'selfWork']);
  assert.deepEqual([...checkTabs(undefined)], []);
});

test('checkLine: the text of a check by its section and field or code', () => {
  assert.deepEqual(checks.errors.map(checkLine).map((x) => x.key), ['sform.checks.title.credits', 'sform.checks.plan.unit_empty', 'sform.checks.plan.held_missing']);
  assert.deepEqual([checkLine({ section: 'goals', field: 'goal', code: 'required' }).key, checkLine({ section: 'selfWork', index: 0, code: 'bad_unit' }).key],
    ['sform.checks.goals.goal', 'sform.checks.selfWork.bad_unit']);
  assert.deepEqual(checkLine(checks.errors[2]).params, { name: 'Введение', date: '2026-09-02', held: undefined, unit: undefined, n: undefined });
  assert.deepEqual([checkLine(checks.errors[1]).params.unit, checkLine({ section: 'selfWork', index: 0, code: 'bad_unit' }).params.n], [2, 1]);
});

test('M1: every error without a place is kept, not only the first', () => {
  const map = errorMap([{ code: 'bad_unit', id: 'tp_1', name: 'Первая' }, { code: 'bad_unit', id: 'tp_2', name: 'Вторая' }, { field: 'credits', code: 'required' }]);
  assert.equal(map.size, 3);
  assert.deepEqual([...map.values()], ['bad_unit', 'bad_unit', 'required']);
});

test('M2: «исправьте отмеченные поля» stays only while a marked field is left', () => {
  const invalid = { kind: 'invalid' };
  assert.deepEqual([statusKind({ status: invalid, errors: 2, dirty: true }), statusKind({ status: invalid, errors: 0, dirty: true }), statusKind({ status: invalid, errors: 0, dirty: false })],
    ['invalid', 'dirty', 'clean']);
  assert.deepEqual([statusKind({ locked: true, status: null, errors: 0, dirty: true }), statusKind({ status: { kind: 'saved' }, errors: 0, dirty: false }),
    statusKind({ status: { kind: 'error' }, errors: 0, dirty: true }), statusKind({ status: null, errors: 0, dirty: true })], ['locked', 'saved', 'error', 'dirty']);
});

test('M3: removing or moving rows drops the errors of the section; adding a row keeps them', () => {
  const errors = { goals: { map: new Map([['knowledge.2.text', 'too_long']]), list: [] }, title: { map: new Map([['credits', 'required']]), list: [] } };
  assert.deepEqual(Object.keys(errorsAfterEdit(errors, 'goals', 'remove')), ['title']);
  assert.deepEqual(Object.keys(errorsAfterEdit(errors, 'goals', 'move')), ['title']);
  assert.equal(errorsAfterEdit(errors, 'goals', 'add'), errors);
  assert.deepEqual(Object.keys(errors), ['goals', 'title']);                     // the object it got stays as it was
});

test('M4: isDirty does not depend on the order of the keys', () => {
  assert.equal(isDirty('title', { title: { department: 'К', course: 1 } }, { title: { course: 1, department: 'К' } }), false);
  assert.equal(isDirty('policies', { policies: { grading: [{ name: 'Текущий', maxPoints: 30 }], behavior: [] } }, { policies: { behavior: [], grading: [{ maxPoints: 30, name: 'Текущий' }] } }), false);
  // a description of a unit typed and erased again is no change
  const saved = { units: { units: [{ unit: 1, title: '', description: 'О', questions: '', guidance: '', results: '', literature: [] }] } };
  const typed = { units: { units: [...saved.units.units, { unit: 2, description: '', questions: '', guidance: '', results: '', literature: [] }] } };
  assert.equal(isDirty('units', typed, saved), false);
  assert.equal(isDirty('units', { units: { units: [{ ...saved.units.units[0], description: '' }] } }, saved), true);
});

test('M5: the form sends without the empty rows but keeps them; the errors of the server land on the rows of the screen', () => {
  const doc = { goals: { goal: 'Цель', knowledge: ['a', '', 'b'], skill: [], attitude: [], prerequisite: [], postrequisite: [] } };
  const before = JSON.stringify(doc);
  assert.deepEqual(sectionData('goals', doc).knowledge, ['a', 'b']);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(placeErrors('goals', doc.goals, [{ list: 'knowledge', index: 1, field: 'text', code: 'too_long' }, { field: 'goal', code: 'too_long' }]),
    [{ list: 'knowledge', index: 2, field: 'text', code: 'too_long' }, { field: 'goal', code: 'too_long' }]);
  const book = { authors: '', title: '', year: '', publisher: '', availability: '' };
  const units = { units: [{ unit: 2, description: '', questions: '', guidance: '', results: '', literature: [book, { ...book, authors: 'Иванов' }] }] };
  assert.deepEqual(placeErrors('units', units, [{ unit: 2, list: 'literature', index: 0, field: 'title', code: 'required' }]),
    [{ unit: 2, list: 'literature', index: 1, field: 'title', code: 'required' }]);
  const lit = { main: [book, { ...book, year: '1999' }], extra: [] };
  assert.deepEqual(placeErrors('literature', lit, [{ list: 'main', index: 0, field: 'title', code: 'required' }]), [{ list: 'main', index: 1, field: 'title', code: 'required' }]);
});

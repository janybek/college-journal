import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABS, tabOf, listAdd, listRemove, listMove, emptyItem, sectionData, isDirty, errorMap, tableNumbers, unitHasContent, unitAbout, withoutBlankRows,
  pairNumbers, canMove, moveLesson, checkTabs, checkLine, placeErrors, errorsAfterEdit, statusKind, keptOrder, submitOutcome,
  syllabusFileProblem, syllabusFileErrorKey, fileDownloadKey, SYLLABUS_FILE_KINDS,
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

test('a unit with a description or books of its own asks too: they go with it', () => {      // final M4
  const about = (fields) => ({ units: [{ unit: 1, title: '', description: '', questions: '', guidance: '', results: '', literature: [] },
    { unit: 2, title: '', description: '', questions: '', guidance: '', results: '', literature: [], ...fields }] });
  assert.deepEqual(unitAbout(about({}), 2), { texts: false, books: 0 });
  assert.deepEqual(unitAbout(about({ questions: ' Вопросы ' }), 2), { texts: true, books: 0 });
  assert.deepEqual(unitAbout(about({ description: '   ', literature: [{ title: 'Книга' }, { title: 'Ещё' }] }), 2), { texts: false, books: 2 });
  assert.deepEqual([unitAbout(about({ results: 'Итог' }), 3), unitAbout(undefined, 1)], [{ texts: false, books: 0 }, { texts: false, books: 0 }]);
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
  assert.deepEqual(checkLine(checks.errors[2]).params, { name: 'Введение', date: '2026-09-02', held: undefined, unit: undefined, n: undefined, course: undefined, a: undefined, b: undefined, groups: undefined });
  const err = { section: 'title', field: 'planSemester', code: 'course_semester', course: 2 };
  assert.deepEqual(checkLine(err, (key) => key === 'sform.checks.title.planSemester.course_semester'),
    { key: 'sform.checks.title.planSemester.course_semester', params: { name: undefined, date: undefined, held: undefined, unit: undefined, n: undefined, course: 2, a: 3, b: 4, groups: undefined } });
  assert.equal(checkLine(err).key, 'sform.checks.title.planSemester');
  assert.equal(checkLine({ section: 'title', field: 'planSemester', code: 'required' }, () => false).key, 'sform.checks.title.planSemester');
  assert.deepEqual([checkLine({ section: 'title', code: 'group_course', groups: ['01-1', '03-1'] }).key, checkLine({ section: 'title', code: 'group_course', groups: ['01-1', '03-1'] }).params.groups],
    ['sform.checks.title.group_course', '01-1, 03-1']);
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

// ---- Task 43: the review of task 42 ----

const L = (id, unit, lessonKind = 'lecture', hours = 2) => ({ id, unit, lessonKind, hours, name: id, number: 1 });

test('M1 (task 42): saving the plan keeps the order the person set on «Порядок пар» and has not saved yet', () => {
  const saved = [L('a', 1), L('b', 1, 'practice'), L('c', 1, 'seminar'), L('d', 2), L('e', 2, 'practice')];
  const unsaved = [saved[2], saved[0], saved[1], saved[4], saved[3]];                       // c a b | e d — moved, not saved
  // the plan saved: «b» renamed (the same id), «x» added at the end of unit 1, «d» removed
  const fresh = [L('a', 1), { ...L('b', 1, 'practice'), name: 'Новое' }, L('c', 1, 'seminar'), L('x', 1, 'lab'), L('e', 2, 'practice')];
  const kept = keptOrder(unsaved, saved, fresh);
  assert.deepEqual(kept.map((l) => l.id), ['c', 'a', 'b', 'x', 'e']);
  assert.equal(kept[2].name, 'Новое');                                                       // the lessons are those of the answer
  // nothing moved by hand: the order of the answer as it is
  assert.deepEqual(keptOrder(saved, saved, fresh).map((l) => l.id), ['a', 'b', 'c', 'x', 'e']);
  assert.deepEqual(keptOrder(null, saved, fresh).map((l) => l.id), ['a', 'b', 'c', 'x', 'e']);
  // a unit would start with a module without hours (its lecture is gone): that unit keeps the order of the answer
  const before = [L('q', 1), L('p', 1, 'practice'), L('m', 1, 'control', 0)];
  const moved = [before[0], before[2], before[1]];                                           // q m p — moved, not saved
  assert.deepEqual(keptOrder(moved, before, [L('p', 1, 'practice'), L('m', 1, 'control', 0)]).map((l) => l.id), ['p', 'm']);
});

test('M2 (task 42): what an answer of syllabus.submit means for the form', () => {
  assert.equal(submitOutcome({ submitted: true, checks: { errors: [], warnings: [] } }), 'sent');
  assert.equal(submitOutcome({ submitted: false, checks: { errors: [{ section: 'goals', field: 'goal', code: 'required' }], warnings: [] } }), 'checks');
  // not sent and nothing to fix: the form must not close silently
  assert.equal(submitOutcome({ submitted: false, checks: { errors: [], warnings: [] } }), 'failed');
  assert.equal(submitOutcome({ submitted: false }), 'failed');
  assert.equal(submitOutcome(null), 'failed');
});

test('the file of a syllabus: kinds, problems before reading, error keys, the download key', () => {
  assert.deepEqual(SYLLABUS_FILE_KINDS, ['pdf', 'docx', 'doc']);
  assert.deepEqual([{ name: 'Силлабус.PDF', size: 10 }, { name: 'a.docx', size: 10485760 }, { name: 'a.doc', size: 1 }].map(syllabusFileProblem), [null, null, null]);
  assert.deepEqual([{ name: 'a.xlsx', size: 1 }, { name: 'a.jpg', size: 1 }, { name: 'a', size: 1 }, { name: 'a.pdf', size: 10485761 }, { name: 'a.pdf', size: 0 }].map(syllabusFileProblem),
    ['sform.file.error.bad_type', 'sform.file.error.bad_type', 'sform.file.error.bad_type', 'sform.file.error.too_big', 'sform.file.error.empty']);
  assert.deepEqual([{ code: 'invalid', fields: [{ field: 'data', code: 'bad_file' }] }, { code: 'syllabus_locked' }, { code: 'too_big' }, { code: 'upload_slow' }, { code: 'network' }, { code: 'forbidden' }]
    .map(syllabusFileErrorKey), ['sform.file.error.bad_file', 'sform.file.error.syllabus_locked', 'sform.file.error.too_big', 'work.upload.error.upload_slow', null, null]);
  assert.deepEqual(['pdf', 'docx', 'doc', 'xlsx', undefined].map(fileDownloadKey),
    ['syllabus.file.download.pdf', 'syllabus.file.download.word', 'syllabus.file.download.word', null, null]);
});

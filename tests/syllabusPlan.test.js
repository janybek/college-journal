import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoOrder, lessonNumbers, planWrites, orderWrites, splitRow, docLessons } from '../core/syllabusPlan.js';
import { parseSyllabus } from '../core/syllabusFile.js';

const row = (id, unit, lessonKind, order, extra = {}) => ({ id, syllabusId: 'sy_1', order, unit, lessonKind, name: id, hours: 2, controlForms: '',
  selfHours: null, description: '', unitTitle: '', sourceId: '', ...extra });
const item = (id, name = id, hours = 2) => ({ id, name, hours, controlForms: '', selfHours: null, description: '' });
const unit = (lists) => ({ title: '', lecture: [], practice: [], seminar: [], lab: [], control: [], ...lists });
const stored = [row('a', 1, 'lecture', 1), row('b', 1, 'practice', 2), row('c', 1, 'lecture', 3), row('m', 1, 'control', 4)];

test('autoOrder and lessonNumbers', () => {
  const rows = [row('c1', 1, 'control', 1), row('p1', 1, 'practice', 2), row('l1', 1, 'lecture', 3), row('l2', 1, 'lecture', 4), row('l3', 1, 'lecture', 5),
    row('s1', 1, 'seminar', 6), row('b1', 1, 'lab', 7), row('x2', 2, 'lecture', 8), row('p2', 1, 'practice', 9)];
  assert.deepEqual(autoOrder(rows), ['l1', 'p1', 's1', 'b1', 'l2', 'p2', 'l3', 'c1', 'x2']);
  const numbers = lessonNumbers(rows);
  assert.deepEqual(['l1', 'l2', 'l3', 'x2', 'p1', 'p2', 's1', 'b1', 'c1'].map((id) => numbers.get(id)), [1, 2, 3, 4, 1, 2, 1, 1, 1]);
});

test('planWrites', () => {
  const auto = planWrites({ units: [unit({ lecture: [item('a'), item('c'), item('', 'Новая')], practice: [item('b')], control: [item('m')] })] }, stored, false);
  assert.deepEqual(auto, { errors: [], units: [{ unit: 1, title: '' }], remove: [], update: [{ id: 'm', patch: { order: 5 } }],
    insert: [{ order: 4, unit: 1, lessonKind: 'lecture', name: 'Новая', hours: 2, controlForms: '', selfHours: null, description: '', unitTitle: '', sourceId: '' }] });
  const hand = [row('a', 1, 'lecture', 1), row('m', 1, 'control', 2), row('b', 1, 'practice', 3), row('c', 1, 'lecture', 4)];
  const manual = planWrites({ units: [unit({ lecture: [item('c'), item('a'), item('', 'Новая')], practice: [item('b')], control: [item('m')] })] }, hand, true);
  assert.deepEqual([manual.update, manual.insert.map((r) => [r.name, r.order])],
    [[{ id: 'c', patch: { order: 1 } }, { id: 'a', patch: { order: 4 } }], [['Новая', 5]]]);
  const moved = planWrites({ units: [unit({ title: 'Основы', lecture: [item('a')] }), unit({ lecture: [item('c', 'Сети', 4)] })] }, stored, false);
  assert.deepEqual([moved.remove, moved.units, moved.update], [['b', 'm'], [{ unit: 1, title: 'Основы' }, { unit: 2, title: '' }],
    [{ id: 'a', patch: { unitTitle: 'Основы' } }, { id: 'c', patch: { order: 2, unit: 2, name: 'Сети', hours: 4 } }]]);
  const foreign = planWrites({ units: [unit({ lecture: [item('zz'), item('a'), item('a')] })] }, stored, false);
  assert.deepEqual([foreign.errors, foreign.insert, foreign.update, foreign.remove],
    [[{ unit: 1, list: 'lecture', index: 0, field: 'id', code: 'bad_ref' }, { unit: 1, list: 'lecture', index: 2, field: 'id', code: 'duplicate' }], [], [], []]);
});

test('orderWrites', () => {
  assert.deepEqual(orderWrites(['a', 'c', 'b', 'm'], stored), { errors: [], update: [{ id: 'c', patch: { order: 2 } }, { id: 'b', patch: { order: 3 } }] });
  assert.deepEqual([orderWrites(['a', 'b'], stored).errors, orderWrites(['a', 'b', 'c', 'zz'], stored).errors],
    [[{ field: 'order', code: 'bad_order' }], [{ field: 'order', code: 'bad_order' }]]);
  assert.deepEqual(orderWrites(['u2', 'a'], [row('a', 1, 'lecture', 1), row('u2', 2, 'lecture', 2)]), { errors: [{ field: 'order', code: 'unit_order' }], update: [] });
  const withMark = [row('a', 1, 'lecture', 1), row('m0', 1, 'control', 2, { hours: 0 }), row('x', 2, 'lecture', 3), row('m2', 2, 'control', 4)];
  assert.deepEqual([orderWrites(['m0', 'a', 'x', 'm2'], withMark), orderWrites(['a', 'm0', 'm2', 'x'], withMark).errors],
    [{ errors: [{ field: 'order', code: 'control_first' }], update: [] }, []]);
});

test('splitRow', () => {
  assert.deepEqual(splitRow({ kind: 'topic', lectureHours: 2, practiceHours: 4, practiceKind: 'lab', selfHours: 2, description: 'О теме' }),
    [{ lessonKind: 'lecture', hours: 2, selfHours: 2, description: 'О теме' }, { lessonKind: 'lab', hours: 4, selfHours: null, description: '' }]);
  assert.deepEqual([splitRow({ kind: 'topic', lectureHours: 0, practiceHours: 2, practiceKind: '' }), splitRow({ kind: 'control', lectureHours: 0, practiceHours: 2, practiceKind: '' })],
    [[{ lessonKind: 'practice', hours: 2, selfHours: null, description: '' }], [{ lessonKind: 'control', hours: 2, selfHours: null, description: '' }]]);
});

test('docLessons', () => {
  const HEAD = ['Юнит', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'СРС, ч', 'Описание'];
  const { doc } = parseSyllabus([{ name: 'Сведения', cells: [['Семестр', 3]] }, { name: 'Тематический план', cells: [HEAD,
    [1, '1.1', 'Жалпы анатомия', 2, 2, 'семинар', 4, 'О теме'], [1, '', 'Сөөктөр', '', 4, 'лабораториялык иш', '', ''], [1, '', '', '', '', 'аралык көзөмөл', '', ''],
    [3, '', 'Жыйынтыктоочу сабак', 2, '', '', '', ''], [3, '', 'Экзамен', '', 2, 'модуль', '', '']] }]);
  const [part, ...rest] = docLessons(doc);
  assert.deepEqual([rest, part.semester, part.planSemester, part.units], [[], 1, 3, [{ unit: 1, title: '' }, { unit: 2, title: '' }, { unit: 3, title: '' }]]);
  assert.deepEqual(part.rows.map((r) => [r.unit, r.lessonKind, r.name, r.hours, r.selfHours, r.description, r.row]), [
    [1, 'lecture', 'Жалпы анатомия', 2, 4, 'О теме', 2], [1, 'seminar', 'Жалпы анатомия', 2, null, '', 2], [1, 'lab', 'Сөөктөр', 4, null, '', 3],
    [1, 'control', '', 0, null, '', 4], [3, 'lecture', 'Жыйынтыктоочу сабак', 2, null, '', 5], [3, 'control', 'Экзамен', 2, null, '', 6]]);
  assert.equal(part.rows.reduce((n, r) => n + r.hours, 0), doc.rows.reduce((n, r) => n + r.lectureHours + r.practiceHours, 0));
  const year = parseSyllabus([{ name: 'Сведения', cells: [['Семестр', '1-2']] }, { name: 'Тематический план', cells: [['Семестр', ...HEAD],
    [1, 1, '', 'Осень', 2, '', '', '', ''], [2, 1, '', 'Весна', '', 2, '', '', ''], [2, 2, '', 'Весна 2', 2, '', '', '', '']] }]).doc;
  assert.deepEqual(docLessons(year).map((p) => [p.semester, p.planSemester, p.units.map((u) => u.unit), p.rows.map((r) => [r.unit, r.lessonKind, r.name])]),
    [[1, 1, [1], [[1, 'lecture', 'Осень']]], [2, 2, [1, 2], [[1, 'practice', 'Весна'], [2, 'lecture', 'Весна 2']]]]);
});

test('autoOrder: more lectures than practices; a row of an unknown kind stays at the end of its unit', () => {      // M1, M4
  const lectures = [row('l1', 1, 'lecture', 1), row('l2', 1, 'lecture', 2), row('l3', 1, 'lecture', 3), row('p1', 1, 'practice', 4), row('m', 1, 'control', 5)];
  assert.deepEqual(autoOrder(lectures), ['l1', 'p1', 'l2', 'l3', 'm']);
  const odd = [row('q', 1, 'экзамен', 1), ...lectures.map((r) => ({ ...r, order: r.order + 1 })), row('x2', 2, 'lecture', 7)];
  assert.deepEqual(autoOrder(odd), ['l1', 'p1', 'l2', 'l3', 'm', 'q', 'x2']);
  assert.equal(lessonNumbers(odd).get('q'), 1);
});

test('planWrites: a stored row of an unknown kind is kept at the end of its unit, and is an error when its unit is gone', () => {      // M1
  const odd = [row('a', 1, 'lecture', 1), row('q', 1, 'экзамен', 2), row('m', 1, 'control', 3), row('x', 2, 'lecture', 4)];
  const kept = planWrites({ units: [unit({ lecture: [item('a'), item('', 'Новая')], control: [item('m')] }), unit({ lecture: [item('x')] })] }, odd, false);
  assert.deepEqual([kept.errors, kept.remove, kept.update, kept.insert.map((r) => [r.name, r.order])],
    [[], [], [{ id: 'q', patch: { order: 4 } }, { id: 'x', patch: { order: 5 } }], [['Новая', 2]]]);
  const orphan = [row('a', 1, 'lecture', 1), row('q', 2, 'экзамен', 2)];
  const lost = planWrites({ units: [unit({ lecture: [item('a')] })] }, orphan, false);
  assert.deepEqual([lost.errors, lost.insert, lost.update, lost.remove], [[{ unit: 2, list: 'экзамен', field: 'id', code: 'unknown_kind', id: 'q' }], [], [], []]);
});

test('planWrites: a row inserted into a unit with a title takes the title; a manual order follows a changed kind', () => {      // M2, M4
  const titled = planWrites({ units: [unit({ title: 'Основы', lecture: [item('a'), item('', 'Новая')], practice: [item('b')], control: [item('m')] })] }, stored, false);
  assert.deepEqual(titled.insert.map((r) => [r.name, r.unitTitle]), [['Новая', 'Основы']]);
  // ручной порядок a, b(практика), c; практика b стала лекцией: у неё больше нет своего места, она встаёт в конец своего юнита
  const hand = [row('a', 1, 'lecture', 1), row('b', 1, 'practice', 2), row('c', 1, 'lecture', 3)];
  const changed = planWrites({ units: [unit({ lecture: [item('a'), item('c'), item('b')] })] }, hand, true);
  assert.deepEqual(changed.update, [{ id: 'c', patch: { order: 2 } }, { id: 'b', patch: { order: 3, lessonKind: 'lecture' } }]);
});

test('docLessons: a control in the middle of the plan stays where the file has it', () => {      // M4
  const { doc } = parseSyllabus([{ name: 'Сведения', cells: [['Семестр', 1]] }, { name: 'Тематический план', cells: [['Юнит', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия'],
    [1, 'Первая', 2, '', ''], [1, '', '', 2, 'модуль'], [2, 'Вторая', 2, '', '']] }]);
  assert.deepEqual(docLessons(doc)[0].rows.map((r) => [r.unit, r.lessonKind, r.name, r.hours]), [[1, 'lecture', 'Первая', 2], [1, 'control', '', 2], [2, 'lecture', 'Вторая', 2]]);
});

test('planWrites, manual order: a new lesson stands before the closing checkpoint of its unit; without one, at the end of the unit', () => {      // final M1
  const hand = [row('a', 1, 'lecture', 1), row('b', 1, 'practice', 2), row('m', 1, 'control', 3), row('x', 2, 'lecture', 4)];
  const plan = planWrites({ units: [
    unit({ lecture: [item('a'), item('', 'Новая лекция')], practice: [item('b'), item('', 'Новая практика')], control: [item('m'), item('', 'Ещё контроль', 0)] }),
    unit({ lecture: [item('x'), item('', 'Вторая')] }),
  ] }, hand, true);
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.insert.map((r) => [r.name, r.unit, r.order]), [['Новая лекция', 1, 3], ['Новая практика', 1, 4], ['Ещё контроль', 1, 6], ['Вторая', 2, 8]]);
  assert.deepEqual(plan.update, [{ id: 'm', patch: { order: 5 } }, { id: 'x', patch: { order: 7 } }]);
  // a unit whose only lesson was its checkpoint: the new lesson comes first
  const lone = planWrites({ units: [unit({ lecture: [item('', 'Первая')], control: [item('m')] })] }, [row('m', 1, 'control', 1)], true);
  assert.deepEqual([lone.insert.map((r) => [r.name, r.order]), lone.update], [[['Первая', 1]], [{ id: 'm', patch: { order: 2 } }]]);
});

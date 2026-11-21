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

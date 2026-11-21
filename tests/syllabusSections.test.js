import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSection, plainId, LIMITS, SECTIONS, SECTION_TABLES } from '../core/syllabusSections.js';

const errorsOf = (section, data, ctx) => checkSection(section, data, ctx).errors;

test('constants', () => {
  assert.deepEqual(LIMITS, { text: 5000, short: 200, description: 1000, list: 100, planRows: 300, units: 20 });
  assert.deepEqual(SECTIONS, ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units', 'order']);
  assert.deepEqual(Object.keys(SECTION_TABLES), SECTIONS);
  assert.deepEqual(SECTION_TABLES.plan, ['topics', 'units', 'literature']);
});

test('title', () => {
  assert.deepEqual(checkSection('title', { department: ' Кафедра ИТ ', academicYear: '2026-2027', course: '1', planSemester: 3, credits: 2 }, { half: 1 }),
    { errors: [], value: { department: 'Кафедра ИТ', faculty: '', academicYear: '2026–2027', course: 1, planSemester: 3, credits: 2, audience: '',
      totalHours: null, classHours: null, selfHours: null, contacts: '', place: '' } });
  assert.deepEqual(errorsOf('title', { academicYear: '2026–2028', course: 9, planSemester: 4, credits: 0, department: 'к'.repeat(201) }, { half: 1 }),
    [{ field: 'department', code: 'too_long' }, { field: 'academicYear', code: 'bad_value' }, { field: 'course', code: 'bad_value' },
      { field: 'planSemester', code: 'semester_half' }, { field: 'credits', code: 'bad_value' }]);
});

test('goals and limits', () => {
  assert.deepEqual(checkSection('goals', { goal: '  Цель\nкурса\n', knowledge: [' знать МИС ', '', '  '] }).value,
    { goal: 'Цель\nкурса', knowledge: ['знать МИС'], skill: [], attitude: [], prerequisite: [], postrequisite: [] });
  assert.deepEqual(errorsOf('goals', { goal: 'я'.repeat(5001), knowledge: Array(101).fill('п'), skill: 'не список', prerequisite: ['д'.repeat(201)] }),
    [{ field: 'goal', code: 'too_long' }, { list: 'knowledge', code: 'too_many' }, { list: 'skill', code: 'bad_value' },
      { list: 'prerequisite', index: 0, field: 'text', code: 'too_long' }]);
  assert.deepEqual([errorsOf('goals', { goal: 'я'.repeat(5000), knowledge: Array(100).fill('п') }), errorsOf('title', { department: 'к'.repeat(200) }, { half: 1 })], [[], []]);
  assert.deepEqual(errorsOf('goals', { knowledge: ['', 'з'.repeat(5001)] }), [{ list: 'knowledge', index: 1, field: 'text', code: 'too_long' }]);
});

test('plan', () => {
  const plan = checkSection('plan', { units: [{ title: 'Основы', lecture: [{ name: 'Жалпы анатомия', hours: 2, selfHours: 2, description: 'О теме', controlForms: 'лишнее' }],
    practice: [{ id: 'tp_1', name: 'Практикум', hours: '4', controlForms: 'опрос' }], control: [{ hours: 0 }] }] });
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.value.units, [{ title: 'Основы',
    lecture: [{ id: '', name: 'Жалпы анатомия', hours: 2, controlForms: '', selfHours: 2, description: 'О теме' }],
    practice: [{ id: 'tp_1', name: 'Практикум', hours: 4, controlForms: 'опрос', selfHours: null, description: '' }],
    seminar: [], lab: [], control: [{ id: '', name: '', hours: 0, controlForms: '', selfHours: null, description: '' }] }]);
  assert.deepEqual(errorsOf('plan', { units: [{ lecture: [{ name: '', hours: 3 }, { name: 'Тема', hours: 2, id: ['tp_1'] }, { name: 'Тема', hours: 2, id: ' tp_1 ' }],
    control: [{ name: 'Модуль', hours: 4 }] }] }),
    [{ unit: 1, list: 'lecture', index: 0, field: 'name', code: 'required' }, { unit: 1, list: 'lecture', index: 0, field: 'hours', code: 'bad_hours' },
      { unit: 1, list: 'lecture', index: 1, field: 'id', code: 'bad_value' }, { unit: 1, list: 'lecture', index: 2, field: 'id', code: 'bad_value' },
      { unit: 1, list: 'control', index: 0, field: 'hours', code: 'bad_hours' }]);
  assert.deepEqual([errorsOf('plan', { units: [] }), errorsOf('plan', { units: Array(21).fill({}) })],
    [[{ list: 'units', code: 'required' }], [{ list: 'units', code: 'too_many' }]]);
  assert.deepEqual(errorsOf('plan', { units: [{ lecture: Array(301).fill({ name: 'Тема', hours: 2 }) }] }), [{ list: 'units', code: 'too_many_rows' }]);
});

test('software, units, order, unknown', () => {
  assert.deepEqual(errorsOf('software', { items: [{ name: 'МИС', link: 'javascript:alert(1)' }, { name: '', link: 'https://example.org' }, { name: '', link: '' }] }),
    [{ list: 'items', index: 0, field: 'link', code: 'bad_value' }, { list: 'items', index: 1, field: 'name', code: 'required' }]);
  assert.deepEqual(errorsOf('units', { units: [{ unit: 1, description: 'О юните' }, { unit: 1 }, { unit: 21 }] }),
    [{ list: 'units', index: 1, field: 'unit', code: 'duplicate' }, { list: 'units', index: 2, field: 'unit', code: 'bad_value' }]);
  assert.deepEqual(errorsOf('order', { order: ['tp_1', 'tp_1', ['tp_2']] }),
    [{ list: 'order', index: 1, field: 'id', code: 'duplicate' }, { list: 'order', index: 2, field: 'id', code: 'bad_value' }]);
  assert.deepEqual([errorsOf('grades', {}), errorsOf('title', [])], [[{ field: 'section', code: 'bad_value' }], [{ field: 'data', code: 'bad_value' }]]);
  assert.deepEqual([plainId('sy_1'), plainId(' sy_1'), plainId(''), plainId(['sy_1']), plainId(7)], ['sy_1', null, null, null, null]);
});

test('selfWork, literature, policies', () => {
  assert.deepEqual(checkSection('selfWork', { items: [{ unit: '2', name: ' Реферат ', tasks: 'Найти\nНаписать', hours: '' }, { unit: null, name: '', tasks: '', hours: null }] }).value,
    { items: [{ unit: 2, name: 'Реферат', tasks: 'Найти\nНаписать', hours: null }] });
  assert.deepEqual(errorsOf('selfWork', { items: [{ unit: 21, name: 'Р', hours: 201 }, { name: '', tasks: 'т'.repeat(5001) }] }),
    [{ list: 'items', index: 0, field: 'unit', code: 'bad_value' }, { list: 'items', index: 0, field: 'hours', code: 'bad_value' },
      { list: 'items', index: 1, field: 'name', code: 'required' }, { list: 'items', index: 1, field: 'tasks', code: 'too_long' }]);
  assert.deepEqual(checkSection('literature', { main: [{ authors: ' Иванов И. ', title: 'Информатика', year: '2020' }], extra: [{}] }).value,
    { main: [{ authors: 'Иванов И.', title: 'Информатика', year: '2020', publisher: '', availability: '' }], extra: [] });
  assert.deepEqual(errorsOf('literature', { main: [{ authors: 'А', title: '' }, { title: 'з'.repeat(201) }], extra: 'нет' }),
    [{ list: 'main', index: 0, field: 'title', code: 'required' }, { list: 'main', index: 1, field: 'title', code: 'too_long' }, { list: 'extra', code: 'bad_value' }]);
  assert.deepEqual(checkSection('policies', { grading: [{ name: 'Текущий', maxPoints: '40', rangeFail: '0–20' }], behavior: [' Не опаздывать ', ''], sanctionBehavior: ' минус 1–10 баллов ' }).value,
    { grading: [{ name: 'Текущий', maxPoints: 40, rangeFail: '0–20', rangeFair: '', rangeGood: '', rangeExcellent: '', criteriaFail: '', criteriaFair: '', criteriaGood: '', criteriaExcellent: '' }],
      behavior: ['Не опаздывать'], ethics: [], sanctionBehavior: 'минус 1–10 баллов', sanctionEthics: '' });
  assert.deepEqual(errorsOf('policies', { grading: [{ name: '', maxPoints: 101 }, { name: 'СРС', criteriaGood: 'к'.repeat(5001) }], ethics: Array(101).fill('п') }),
    [{ list: 'grading', index: 0, field: 'name', code: 'required' }, { list: 'grading', index: 0, field: 'maxPoints', code: 'bad_value' },
      { list: 'grading', index: 1, field: 'criteriaGood', code: 'too_long' }, { list: 'ethics', code: 'too_many' }]);
  assert.deepEqual(errorsOf('units', { units: [{ unit: 2, literature: [{ title: '' }] }] }), [{ unit: 2, list: 'literature', index: 0, field: 'title', code: 'required' }]);
});

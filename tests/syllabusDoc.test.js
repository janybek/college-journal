import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_TABLES, rowsOfVersion, buildDoc, sectionWrites, copyRows, draftVersion } from '../core/syllabusDoc.js';
import { checkSubmit } from '../core/syllabusFlow.js';
import { checkSection } from '../core/syllabusSections.js';

const version = { id: 'sy_1', disciplineId: 'ds_1', teacherId: 'sf_t', semester: 1, status: 'draft', version: 1, manualOrder: false,
  department: 'Кафедра', faculty: '', academicYear: '2026–2027', course: 1, planSemester: 1, credits: 3, audience: '', totalHours: 90, classHours: 60,
  selfHours: 30, contacts: '', place: '', goal: 'Цель' };
const topic = (id, order, unit, lessonKind, name, extra = {}) => ({ id, syllabusId: 'sy_1', order, unit, lessonKind, name, hours: 2, controlForms: '', selfHours: null,
  description: '', unitTitle: unit === 1 ? 'Основы' : '', sourceId: '', ...extra });
const book = (id, kind, unit, order, title, extra = {}) => ({ id, syllabusId: 'sy_1', kind, unit, order, authors: '', title, year: '2020', publisher: '', availability: '', ...extra });
const tables = {
  topics: [topic('tp_1', 1, 1, 'lecture', 'Л1'), topic('tp_2', 2, 1, 'practice', 'П1', { controlForms: 'Тест' }), topic('tp_3', 3, 1, 'lecture', 'Л2'),
    topic('tp_4', 4, 1, 'control', 'Модуль'), topic('tp_5', 5, 2, 'lecture', 'Л3'), { ...topic('tp_9', 1, 1, 'lecture', 'Чужая'), syllabusId: 'sy_2' }],
  units: [{ id: 'un_1', syllabusId: 'sy_1', unit: 1, title: 'Основы', description: 'Описание', questions: '', guidance: '', results: '' },
    { id: 'un_2', syllabusId: 'sy_1', unit: 2, title: '', description: '', questions: '', guidance: '', results: '' }],
  outcomes: [{ id: 'oc_1', syllabusId: 'sy_1', kind: 'knowledge', order: 1, text: 'Знать' }, { id: 'oc_2', syllabusId: 'sy_1', kind: 'prerequisite', order: 1, text: 'Школа' }],
  selfWork: [{ id: 'sw_1', syllabusId: 'sy_1', order: 1, unit: 1, name: 'Работа', tasks: '', hours: 4 }],
  literature: [book('lt_1', 'main', null, 1, 'Книга 1'), book('lt_2', 'main', null, 2, 'Книга 2'), book('lt_3', 'extra', null, 1, 'Книга 3'),
    book('lt_4', 'main', 1, 1, 'Книга юнита 1'), book('lt_5', 'main', 9, 1, 'Книга юнита 9'), book('lt_6', 'main', 2, 1, 'Книга юнита 2')],
  software: [{ id: 'so_1', syllabusId: 'sy_1', order: 1, name: 'Excel', link: 'https://example.org' }],
  grading: [{ id: 'gr_1', syllabusId: 'sy_1', order: 1, name: 'Экзамен', maxPoints: 40, rangeFail: '', rangeFair: '', rangeGood: '', rangeExcellent: '',
    criteriaFail: '', criteriaFair: '', criteriaGood: '', criteriaExcellent: '' }],
  rules: [{ id: 'rl_1', syllabusId: 'sy_1', kind: 'behavior', order: 1, text: 'Не опаздывать' }, { id: 'rl_2', syllabusId: 'sy_1', kind: 'sanction_behavior', order: 1, text: 'Замечание' }],
};
const rows = rowsOfVersion(tables, 'sy_1');
const doc = buildDoc(version, rows);
const changed = (w) => Object.values(w.tables).flatMap((t) => [...t.insert, ...t.update, ...t.remove]);

test('rowsOfVersion: only the rows of the version, in the order of the sheets', () => {
  assert.deepEqual(DOC_TABLES, ['topics', 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules']);
  assert.deepEqual(rows.topics.map((t) => t.id), ['tp_1', 'tp_2', 'tp_3', 'tp_4', 'tp_5']);
  assert.equal(rowsOfVersion(tables, 'sy_2').topics.length, 1);
  assert.equal(rowsOfVersion(tables, 'sy_3').topics.length, 0);
  // листа может не быть
  assert.deepEqual(rowsOfVersion({}, 'sy_1'), Object.fromEntries(DOC_TABLES.map((n) => [n, []])));
  assert.deepEqual(rowsOfVersion({ topics: [{ id: 'x', syllabusId: 'sy_1', order: 2 }, { id: 'y', syllabusId: 'sy_1', order: 1 }] }, 'sy_1').topics.map((t) => t.id), ['y', 'x']);
});

test('buildDoc: the plan by units, the lessons in the order of pairs, the books of the course and of the units', () => {
  assert.deepEqual(doc.plan.units.map((u) => [u.unit, u.title, u.lecture.map((r) => r.number), u.practice.length, u.control.length]), [[1, 'Основы', [1, 2], 1, 1], [2, '', [3], 0, 0]]);
  assert.deepEqual(doc.lessons.map((l) => [l.unit, l.lessonKind, l.number]), [[1, 'lecture', 1], [1, 'practice', 1], [1, 'lecture', 2], [1, 'control', 1], [2, 'lecture', 3]]);
  assert.deepEqual([doc.literature.main.length, doc.literature.extra.length, doc.units.units.map((u) => u.literature.length)], [2, 1, [1, 1]]);
  assert.deepEqual(doc.title.course, 1);
  assert.equal(doc.title.place, '');
  assert.deepEqual(Object.keys(doc.title).length, 12);
  assert.deepEqual([doc.goals.goal, doc.goals.knowledge, doc.goals.prerequisite, doc.goals.skill], ['Цель', ['Знать'], ['Школа'], []]);
  assert.deepEqual([doc.policies.behavior, doc.policies.sanctionBehavior, doc.policies.sanctionEthics, doc.policies.grading[0].maxPoints], [['Не опаздывать'], 'Замечание', '', 40]);
  assert.equal(doc.plan.manualOrder, false);
});

test('buildDoc: a topic of a unit that has no row in «Units» gives a unit without a title; nothing is lost', () => {
  const lone = rowsOfVersion({ topics: [topic('tp_1', 1, 1, 'lecture', 'Л1', { unitTitle: '' }), topic('tp_2', 2, 3, 'lecture', 'Л2', { unitTitle: '' })] }, 'sy_1');
  const d = buildDoc(version, lone);
  assert.deepEqual(d.plan.units.map((u) => [u.unit, u.title, u.lecture.length]), [[1, '', 1], [2, '', 0], [3, '', 1]]);
  assert.deepEqual(d.units.units.map((u) => u.unit), [1, 3]);
});

test('sectionWrites: a section saved unchanged writes nothing', () => {
  for (const section of ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units']) {
    const checked = checkSection(section, doc[section], { half: 1 });
    assert.deepEqual(checked.errors, [], section);
    const w = sectionWrites(section, checked.value, version, rows);
    assert.deepEqual([w.errors, w.syllabus, changed(w)], [[], null, []], section);
  }
});

test('sectionWrites: the title and the goal are patches of the version', () => {
  const title = checkSection('title', { ...doc.title, department: 'Другая', credits: '' }, { half: 1 }).value;
  assert.deepEqual(sectionWrites('title', title, version, rows).syllabus, { department: 'Другая', credits: null });
  const goals = checkSection('goals', { ...doc.goals, goal: 'Новая', knowledge: ['Знать', 'Уметь'], skill: ['Навык'], prerequisite: [] }).value;
  const w = sectionWrites('goals', goals, version, rows);
  assert.deepEqual(w.syllabus, { goal: 'Новая' });
  assert.deepEqual(w.tables.outcomes.insert.map((o) => [o.syllabusId, o.kind, o.order, o.text]), [['sy_1', 'knowledge', 2, 'Уметь'], ['sy_1', 'skill', 1, 'Навык']]);
  assert.deepEqual(w.tables.outcomes.remove, ['oc_2']);
});

test('sectionWrites: the literature of the course is written in place; the books of the units stay', () => {
  const [, , b3] = [doc.literature.main[0], doc.literature.main[1], doc.literature.extra[0]];
  const b1 = doc.literature.main[0];
  const b4 = { authors: '', title: 'Новая книга', year: '', publisher: '', availability: '' };
  const lit = sectionWrites('literature', { main: [{ ...b1, year: '2024' }], extra: [b3, b4] }, version, rows).tables.literature;
  assert.deepEqual([lit.update, lit.remove, lit.insert.map((b) => [b.kind, b.unit, b.order, b.title, b.syllabusId, b.id])],
    [[{ id: 'lt_1', patch: { year: '2024' } }], ['lt_2'], [['extra', null, 2, 'Новая книга', 'sy_1', undefined]]]);
});

test('sectionWrites: fewer units remove their rows and their books; the books of a unit without a row stay', () => {
  const onlyFirst = { units: [doc.plan.units[0]] };
  const shorter = sectionWrites('plan', checkSection('plan', onlyFirst).value, version, rows).tables;
  assert.deepEqual([shorter.units.remove, shorter.literature.remove, shorter.literature.insert, shorter.literature.update], [['un_2'], ['lt_6'], [], []]);
  assert.deepEqual(shorter.topics.remove, ['tp_5']);
  // новый юнит с названием получает строку «Юнитов»
  const longer = { units: [...doc.plan.units, { unit: 3, title: 'Третий', lecture: [{ id: '', name: 'Новая', hours: 2 }], practice: [], seminar: [], lab: [], control: [] }] };
  const w = sectionWrites('plan', checkSection('plan', longer).value, version, rows).tables;
  assert.deepEqual([w.units.insert.map((u) => [u.unit, u.title, u.syllabusId]), w.topics.insert.map((t) => [t.unit, t.name, t.syllabusId, t.sourceId])], [[[3, 'Третий', 'sy_1']], [[3, 'Новая', 'sy_1', '']]]);
});

test('sectionWrites: one id twice in the plan is an error and nothing is written (M5)', () => {
  const twice = structuredClone(doc.plan);
  twice.units[0].lecture[1] = { ...twice.units[0].lecture[1], id: twice.units[0].lecture[0].id };
  const checked = checkSection('plan', twice);
  const w = sectionWrites('plan', checked.value, version, rows);
  assert.deepEqual(w.errors, [{ unit: 1, list: 'lecture', index: 1, field: 'id', code: 'duplicate' }]);
  assert.deepEqual([w.syllabus, changed(w)], [null, []]);
  // тот же id в списке другого вида
  const across = structuredClone(doc.plan);
  across.units[0].practice[0].id = across.units[0].lecture[0].id;
  assert.deepEqual(sectionWrites('plan', checkSection('plan', across).value, version, rows).errors.map((e) => e.code), ['duplicate']);
  // id чужой версии
  const foreign = structuredClone(doc.plan);
  foreign.units[0].lecture[0].id = 'tp_9';
  assert.deepEqual(sectionWrites('plan', checkSection('plan', foreign).value, version, rows).errors.map((e) => e.code), ['bad_ref']);
});

test('sectionWrites: units — fields of a unit, books of a unit with kind main, a unit that does not exist', () => {
  const unitsValue = checkSection('units', doc.units).value;
  unitsValue.units[1].literature.push({ authors: '', title: 'Новая книга юнита', year: '', publisher: '', availability: '' });
  assert.deepEqual(sectionWrites('units', unitsValue, version, rows).tables.literature.insert.map((b) => [b.kind, b.unit, b.title]), [['main', 2, 'Новая книга юнита']]);
  unitsValue.units[0].description = 'Другое';
  assert.deepEqual(sectionWrites('units', unitsValue, version, rows).tables.units.update, [{ id: 'un_1', patch: { description: 'Другое' } }]);
  assert.deepEqual(sectionWrites('units', { units: [{ unit: 7, description: 'x', questions: '', guidance: '', results: '', literature: [] }] }, version, rows).errors,
    [{ list: 'units', index: 0, field: 'unit', code: 'bad_ref' }]);
  const twice = { units: [doc.units.units[0], doc.units.units[0]] };
  assert.deepEqual(sectionWrites('units', checkSection('units', twice).value, version, rows).errors.map((e) => e.code), ['duplicate']);
});

test('sectionWrites: order sets the manual flag once', () => {
  const reversed = ['tp_3', 'tp_2', 'tp_1', 'tp_4', 'tp_5'];
  const w = sectionWrites('order', { order: reversed }, version, rows);
  assert.deepEqual([w.errors, w.syllabus, w.tables.topics.update.length], [[], { manualOrder: true }, 2]);
  assert.equal(sectionWrites('order', { order: reversed }, { ...version, manualOrder: true }, rows).syllabus, null);
  // другой набор id — ничего не пишется
  const bad = sectionWrites('order', { order: ['tp_1', 'tp_1', 'tp_2', 'tp_3', 'tp_4'] }, version, rows);
  assert.deepEqual([bad.errors.map((e) => e.code), bad.syllabus, changed(bad)], [['bad_order'], null, []]);
  const foreign = sectionWrites('order', { order: ['tp_9', 'tp_2', 'tp_1', 'tp_4', 'tp_5'] }, version, rows);
  assert.deepEqual([foreign.errors.map((e) => e.code), changed(foreign)], [['bad_order'], []]);
});

test('sectionWrites: lists of self work, software and policies are written in place', () => {
  const sw = sectionWrites('selfWork', checkSection('selfWork', { items: [{ unit: 1, name: 'Работа', tasks: 'Задание', hours: 4 }, { unit: 2, name: 'Вторая', tasks: '', hours: 2 }] }).value, version, rows).tables.selfWork;
  assert.deepEqual([sw.update, sw.insert.map((r) => [r.order, r.unit, r.name])], [[{ id: 'sw_1', patch: { tasks: 'Задание' } }], [[2, 2, 'Вторая']]]);
  const so = sectionWrites('software', checkSection('software', { items: [] }).value, version, rows).tables.software;
  assert.deepEqual(so.remove, ['so_1']);
  const pol = sectionWrites('policies', checkSection('policies', { ...doc.policies, behavior: [], sanctionBehavior: '', ethics: ['Честность'] }).value, version, rows).tables.rules;
  assert.deepEqual([pol.remove.sort(), pol.insert.map((r) => [r.kind, r.order, r.text])], [['rl_1', 'rl_2'], [['ethics', 1, 'Честность']]]);
  // неизвестный раздел и пустое значение
  assert.deepEqual(sectionWrites('nope', {}, version, rows).errors, [{ field: 'section', code: 'bad_value' }]);
  assert.deepEqual(sectionWrites('title', null, version, rows).errors, [{ field: 'section', code: 'bad_value' }]);
});

test('copyRows: no ids; the topics say where they were copied from', () => {
  const copy = copyRows(rows);
  assert.deepEqual([copy.topics.map((t) => [t.id, t.sourceId]), copy.units.every((u) => u.id === undefined && u.syllabusId === undefined)],
    [rows.topics.map((t) => [undefined, t.id]), true]);
  assert.deepEqual(Object.keys(copy), DOC_TABLES);
  assert.deepEqual(copy.literature.map((b) => b.title), rows.literature.map((b) => b.title));
  assert.equal(copy.topics.every((t) => t.syllabusId === undefined), true);
  // исходные строки не изменены
  assert.equal(rows.topics[0].id, 'tp_1');
});

test('draftVersion: a copy of the approved title and goal, or an empty version with the plan semester and the course', () => {
  const key = { disciplineId: 'ds_1', teacherId: 'sf_t', semester: 1 };
  const args = { key, userId: 'sf_t', today: '2026-09-10', number: 2 };
  const fromApproved = draftVersion({ ...args, approved: { ...version, status: 'approved', manualOrder: true, remark: 'старое', decidedBy: 'sf_d' }, planSemester: 5, course: 3 });
  assert.deepEqual([fromApproved.status, fromApproved.version, fromApproved.editedBy, fromApproved.updated, fromApproved.department, fromApproved.goal, fromApproved.manualOrder,
    fromApproved.planSemester, fromApproved.course, fromApproved.remark, fromApproved.decidedBy, fromApproved.id], ['draft', 2, 'sf_t', '2026-09-10', 'Кафедра', 'Цель', true, 1, 1, '', '', undefined]);
  assert.deepEqual([fromApproved.disciplineId, fromApproved.teacherId, fromApproved.semester], ['ds_1', 'sf_t', 1]);
  const empty = draftVersion({ ...args, approved: null, number: 1, planSemester: 3, course: 2 });
  assert.deepEqual([empty.status, empty.version, empty.planSemester, empty.course, empty.manualOrder, empty.department, empty.goal, empty.credits], ['draft', 1, 3, 2, false, '', '', null]);
});

test('sectionWrites: a topic whose unit is not a whole number from 1 stops the saving of the plan; nothing is dropped silently', () => {
  for (const unit of [null, '', 0, 'abc', 1.5, '2']) {
    const bad = rowsOfVersion({ ...tables, topics: [...tables.topics, topic('tp_x', 6, unit, 'lecture', 'Потерянная')] }, 'sy_1');
    const d = buildDoc(version, bad);
    const w = sectionWrites('plan', checkSection('plan', d.plan).value, version, bad);
    assert.deepEqual(w.errors, [{ code: 'bad_unit', id: 'tp_x', name: 'Потерянная' }], String(unit));
    assert.deepEqual([w.syllabus, changed(w)], [null, []], String(unit));
    assert.equal(w.tables.topics.remove.includes('tp_x'), false);
    assert.deepEqual(checkSubmit(d).errors.filter((e) => e.code === 'bad_unit'), [{ section: 'plan', code: 'bad_unit', id: 'tp_x', name: 'Потерянная' }], String(unit));
  }
});

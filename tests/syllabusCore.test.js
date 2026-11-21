import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_LESSON, layoutLessons } from '../core/topics.js';
import { semesterHalf, syllabusFor, syllabusIndex, subjectScope, syllabusTotals, scheduleFit, planSyllabusUpload } from '../core/syllabus.js';

const blank = { unit: 1, label: '', practiceKind: '', selfHours: null, description: '' };
const topic = (id, order, lectureHours, practiceHours, syllabusId = 'sy_1') => ({ ...blank, id, syllabusId, order, name: id, lectureHours, practiceHours, kind: 'topic' });
const control = (id, order, hours = 0) => ({ ...blank, id, syllabusId: 'sy_1', order, name: '', lectureHours: 0, practiceHours: hours, kind: 'control' });
const L = (topicId, lessonType, part = 1) => ({ topicId, lessonType, part });
const pair = (id, date, status = 'planned', lesson = NO_LESSON, slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, ...lesson });
const rows = [topic('t2', 2, 2, 2), control('c1', 3), topic('t1', 1, 4, 2), topic('t3', 4, 0, 4), control('c2', 5, 2)];
const two = [topic('t1', 1, 2, 2), topic('t2', 2, 2, 0)];

const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
const syllabi = [{ id: 'sy_1', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1 }, { id: 'sy_2', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 2, planSemester: 2 },
  { id: 'sy_3', disciplineId: 'ds_1', teacherId: 'sf_2', semester: 1, planSemester: 1 }];
const all = [topic('a2', 2, 2, 0, 'sy_1'), topic('a1', 1, 2, 0, 'sy_1'), topic('b1', 1, 2, 0, 'sy_2'), topic('c1', 1, 2, 0, 'sy_3'), topic('c2', 2, 2, 0, 'sy_3')];
const index = syllabusIndex(syllabi, all);
const subject = { id: 'sb_1', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1' };

test('semester of the year and the syllabus a subject follows', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 8].map(semesterHalf), [1, 2, 1, 2, 1, 2]);
  assert.deepEqual([syllabusFor(subject, syllabi, 1).id, syllabusFor(subject, syllabi, 2).id, syllabusFor({ ...subject, teacherId: 'sf_2' }, syllabi, 2),
    syllabusFor({ ...subject, disciplineId: '' }, [{ id: 'sy_9', disciplineId: '', teacherId: 'sf_1', semester: 1 }], 1)], ['sy_1', 'sy_2', null, null]);
  assert.deepEqual([index.topicsOf.get('sy_1').map((t) => t.id), index.syllabusOf.get('b1').id], [['a1', 'a2'], 'sy_2']);
});

test('subjectScope: a group changed its teacher, the new syllabus continues from the same place', () => {
  const pairs = [pair('h0', '2026-08-21', 'closed', L('b1', 'lecture')),       // проведена, вне дат, другой семестр
    pair('out', '2026-08-20', 'planned', L('a1', 'lecture')),                   // вне дат, тема текущего силлабуса — очистить
    pair('gone', '2026-08-22', 'planned', L('zz', 'lecture')),                  // вне дат, темы больше нет — очистить
    pair('keep', '2026-08-23', 'planned', L('b1', 'lecture')),                  // вне дат, тема другого семестра — остаётся
    pair('p1', '2026-09-01', 'closed', L('c1', 'lecture')),                     // проведена по силлабусу прежнего преподавателя
    pair('p2', '2026-09-08')];
  const scope = subjectScope(subject, pairs, index, S1);
  assert.deepEqual([scope.syllabus.id, scope.topics.map((t) => t.id), scope.pairs.map((p) => p.id), scope.clear, scope.skip], ['sy_1', ['a1', 'a2'], ['h0', 'p1', 'p2'], ['out', 'gone'], 1]);
  assert.deepEqual(layoutLessons(scope.topics, scope.pairs, scope.skip), { assign: [{ id: 'p2', patch: L('a2', 'lecture') }], unplaced: [], withoutTopic: 0 });
  // у преподавателя нет силлабуса: пары остаются без темы
  const none = subjectScope({ ...subject, teacherId: 'sf_9' }, [pair('p1', '2026-09-01', 'planned', L('a1', 'lecture'))], index, S1);
  assert.deepEqual([none.syllabus, none.topics, none.clear, none.skip], [null, [], [], 0]);
  assert.deepEqual(layoutLessons(none.topics, none.pairs, none.skip), { assign: [{ id: 'p1', patch: NO_LESSON }], unplaced: [], withoutTopic: 1 });
  // второй семестр года: проведённая пара первого занятий не «съедает»
  assert.equal(subjectScope(subject, [pair('p1', '2026-09-01', 'closed', L('a1', 'lecture'))], index, { ...S1, semester: 2 }).skip, 0);
});

test('syllabusTotals and scheduleFit', () => {
  assert.deepEqual(syllabusTotals(rows), { topics: 3, units: 1, lectureHours: 6, practiceHours: 8, controlHours: 2, hours: 16, selfHours: 0, pairs: 8 });
  assert.deepEqual(syllabusTotals([{ ...topic('s', 1, 2, 0), unit: 2, selfHours: 4 }, topic('q', 2, 0, 2)]), { topics: 2, units: 2, lectureHours: 2, practiceHours: 2, controlHours: 0, hours: 4, selfHours: 4, pairs: 2 });
  assert.deepEqual(syllabusTotals([]), { topics: 0, units: 0, lectureHours: 0, practiceHours: 0, controlHours: 0, hours: 0, selfHours: 0, pairs: 0 });
  const fitPairs = [pair('p1', '2026-09-01', 'closed', L('t1', 'lecture')), pair('p2', '2026-09-08', 'planned', L('t1', 'practice')),
    pair('p3', '2026-09-15', 'cancelled'), pair('p4', '2026-09-22'), pair('p0', '2026-08-25')];
  assert.deepEqual(scheduleFit(two, fitPairs, S1), { pairs: 3, unplaced: 1, withoutTopic: 1 });
  assert.deepEqual(scheduleFit(two, fitPairs, S1, 1), { pairs: 3, unplaced: 0, withoutTopic: 1 });
});

const doc = (rows, info = {}) => ({ info: { discipline: '', teacher: '', semester: 1, audience: 'Сестринское дело', credits: 2, totalHours: 60, classHours: 36, selfHours: 24, ...info }, rows });
const fileRow = { semester: 1, unit: 1, label: '', practiceKind: '', selfHours: null, description: '' };
const row = (name, lectureHours, practiceHours, n, extra = {}) => ({ ...fileRow, kind: 'topic', name, lectureHours, practiceHours, row: n, ...extra });
const mod = (n, extra = {}) => ({ ...fileRow, kind: 'control', name: '', lectureHours: 0, practiceHours: 0, row: n, ...extra });
const base = [row('Введение', 2, 2, 2), row('Практикум', 0, 2, 3), mod(4)];
const ctx = (over = {}) => ({ discipline: { id: 'ds_1', name: 'Информатика' }, teacher: { id: 'sf_1', fullName: 'Асанов Айдар' }, syllabi: [], topics: [], pairs: [], today: '2026-08-31', ...over });
const stored = (name, order, lectureHours, practiceHours, extra = {}) => ({ ...blank, syllabusId: null, order, name, lectureHours, practiceHours, kind: 'topic', ...extra });

const first = planSyllabusUpload(doc(base), ctx());
const [p1] = first.parts;
const kept = p1.toInsert.map((r, i) => ({ ...r, syllabusId: 'sy_1', id: 'tp_' + (i + 1) }));       // tp_1 Введение, tp_2 Практикум, tp_3 модуль
const spring = { ...stored('Введение', 1, 2, 0), id: 'tp_9', syllabusId: 'sy_2' };
const have = ctx({ syllabi: syllabi.slice(0, 2), topics: [...kept, spring] });

test('planSyllabusUpload: first upload', () => {
  assert.deepEqual([first.errors, first.warnings, first.parts.length], [[], [], 1]);
  assert.deepEqual([p1.semester, p1.planSemester, p1.toUpdate, p1.toRemove], [1, 1, [], []]);
  assert.deepEqual(p1.toInsert, [stored('Введение', 1, 2, 2), stored('Практикум', 2, 0, 2), stored('', 3, 0, 0, { kind: 'control' })]);
  assert.deepEqual(p1.syllabus, { id: null, row: { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1, audience: 'Сестринское дело', credits: 2, totalHours: 60, classHours: 36, selfHours: 24, updated: '2026-08-31' } });
  assert.deepEqual(p1.summary, { semester: 1, planSemester: 1, replaces: false, topics: 2, units: 1, lectureHours: 2, practiceHours: 4, controlHours: 0, pairs: 3, added: 2, changed: 0, removed: 0 });
});

test('planSyllabusUpload: re-upload matches rows by name', () => {
  // тот же файл ещё раз: темы не пишутся, весенний силлабус в parts не попадает
  const same = planSyllabusUpload(doc(base), have);
  assert.deepEqual([same.parts.length, same.parts[0].toInsert, same.parts[0].toUpdate, same.parts[0].toRemove, same.parts[0].syllabus.id, same.parts[0].summary.replaces], [1, [], [], [], 'sy_1', true]);

  // строка вставлена первой, порядок сдвинулся, одна тема ушла, модуль получил название: сопоставление по названию
  const shifted = planSyllabusUpload(doc([row('Новая тема', 2, 0, 2), row('Введение', 2, 2, 3, { description: 'О предмете' }), mod(4, { name: 'Тест' })]), have).parts[0];
  assert.deepEqual(shifted.toInsert.map((r) => [r.syllabusId, r.order, r.name, r.kind]), [['sy_1', 1, 'Новая тема', 'topic'], ['sy_1', 3, 'Тест', 'control']]);
  assert.deepEqual(shifted.toUpdate, [{ id: 'tp_1', patch: { order: 2, description: 'О предмете' } }]);
  assert.deepEqual(shifted.toRemove, ['tp_2', 'tp_3']);
  assert.deepEqual([shifted.summary.added, shifted.summary.changed, shifted.summary.removed], [1, 1, 1]);

  // одинаковые названия сопоставляются по счёту
  const twins = ctx({ syllabi: syllabi.slice(0, 1), topics: [{ ...stored('Право', 1, 2, 0), id: 'tp_a', syllabusId: 'sy_1' }, { ...stored('Право', 2, 0, 2), id: 'tp_b', syllabusId: 'sy_1' }] });
  const twinPlan = planSyllabusUpload(doc([row('Право', 2, 0, 2), row('Новое', 2, 0, 3), row('Право', 0, 2, 4)]), twins).parts[0];
  assert.deepEqual([twinPlan.toUpdate, twinPlan.toInsert.map((r) => [r.order, r.name]), twinPlan.toRemove], [[{ id: 'tp_b', patch: { order: 3 } }], [[2, 'Новое']], []]);
});

test('planSyllabusUpload: held pairs protect their rows', () => {
  // лекция строки «Введение» проведена в одной из групп (пара другого предмета — sb_7)
  const held = { ...have, pairs: [{ id: 'p_1', subjectId: 'sb_7', date: '2026-09-01', slot: 1, status: 'closed', topicId: 'tp_1', lessonType: 'lecture', part: 1 },
    { id: 'p_2', subjectId: 'sb_7', date: '2026-09-02', slot: 1, status: 'closed', topicId: 'tp_чужая', lessonType: 'lecture', part: 1 }] };
  assert.deepEqual(planSyllabusUpload(doc([row('Новая тема', 2, 0, 2), row('Введение', 2, 2, 3), mod(4)]), held).errors, []);
  const renamed = planSyllabusUpload(doc([row('Введение в предмет', 2, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), held);
  assert.deepEqual([renamed.errors, renamed.warnings], [[], [{ code: 'held_renamed', order: 1, from: 'Введение', to: 'Введение в предмет', date: '2026-09-01' }]]);
  assert.deepEqual(renamed.parts[0].toUpdate, [{ id: 'tp_1', patch: { name: 'Введение в предмет' } }]);
  const gone = planSyllabusUpload(doc([row('Практикум', 0, 2, 2), mod(3)]), held);
  assert.deepEqual(gone.errors, [{ sheet: 'plan', row: 0, field: 'name', code: 'held_missing', name: 'Введение', date: '2026-09-01' }]);
  assert.deepEqual([gone.parts[0].toInsert, gone.parts[0].toUpdate, gone.parts[0].toRemove], [[], [], []]);
  const cut = planSyllabusUpload(doc([row('Введение', 0, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), held);
  assert.deepEqual(cut.errors, [{ sheet: 'plan', row: 2, field: 'lectureHours', code: 'held_hours', held: 2, date: '2026-09-01' }]);
});

test('planSyllabusUpload: other discipline or teacher in the file, semesters', () => {
  // регистр, пробелы и инициалы не считаются
  assert.deepEqual(planSyllabusUpload(doc(base, { discipline: 'Анатомия', teacher: 'Петров П.' }), ctx()).warnings,
    [{ code: 'discipline_differs', file: 'Анатомия', discipline: 'Информатика' }, { code: 'teacher_differs', file: 'Петров П.', teacher: 'Асанов Айдар' }]);
  assert.deepEqual(planSyllabusUpload(doc(base, { discipline: ' информатика ', teacher: 'асанов А. Б., Петров П.' }), ctx()).warnings, []);

  const springRows = base.map((r) => ({ ...r, semester: 2 }));
  const second = planSyllabusUpload(doc(springRows, { semester: 2 }), have);                 // весенний файл осенний силлабус не трогает
  assert.deepEqual(second.parts.map((p) => [p.semester, p.syllabus.id, p.toUpdate, p.toInsert.map((r) => r.name), p.toRemove]), [[2, 'sy_2', [{ id: 'tp_9', patch: { practiceHours: 2 } }], ['Практикум', ''], []]]);
  const year = planSyllabusUpload(doc([row('Осень', 2, 0, 2), row('Весна', 2, 0, 3, { semester: 2 })], { semester: null }), ctx());   // файл на год — две части
  assert.deepEqual(year.parts.map((p) => [p.semester, p.planSemester, p.toInsert.map((r) => [r.order, r.name]), p.summary.pairs]), [[1, 1, [[1, 'Осень']], 1], [2, 2, [[1, 'Весна']], 1]]);
  const third = planSyllabusUpload(doc([row('Тема', 2, 0, 2, { semester: 3 })], { semester: 3 }), have).parts[0];                     // «3 семестр» — это осенний
  assert.deepEqual([third.semester, third.planSemester, third.syllabus.id, third.syllabus.row.planSemester, third.toRemove], [1, 3, 'sy_1', 3, ['tp_1', 'tp_2', 'tp_3']]);
});

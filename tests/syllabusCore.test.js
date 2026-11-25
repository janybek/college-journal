import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_LESSON, layoutLessons } from '../core/topics.js';
import { semesterHalf, syllabusFor, syllabusIndex, subjectScope, syllabusTotals, scheduleFit, planSyllabusUpload } from '../core/syllabus.js';

const blank = { unit: 1, unitTitle: '', controlForms: '', selfHours: null, description: '', sourceId: '' };
const lesson = (id, order, lessonKind, hours = 2, syllabusId = 'sy_1') => ({ ...blank, id, syllabusId, order, lessonKind, name: id, hours });
const L = (topicId, lessonType, part = 1) => ({ topicId, lessonType, part });
const pair = (id, date, status = 'planned', lesson = NO_LESSON, slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, ...lesson });
const rows = [lesson('t2', 2, 'practice'), lesson('c1', 3, 'control', 0), lesson('t1', 1, 'lecture', 4), lesson('t3', 4, 'seminar', 4), lesson('c2', 5, 'control', 2)];
const two = [lesson('t1', 1, 'lecture'), lesson('t1p', 2, 'practice'), lesson('t2', 3, 'lecture')];

const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
const ok = { status: 'approved', version: 1 };
const syllabi = [{ id: 'sy_1', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1, lineId: 'ln_1', ...ok }, { id: 'sy_2', disciplineId: 'ds_1', teacherId: 'sf_1', semester: 2, planSemester: 2, lineId: 'ln_2', ...ok },
  { id: 'sy_3', disciplineId: 'ds_1', teacherId: 'sf_2', semester: 1, planSemester: 1, lineId: 'ln_3', ...ok }];
const joined = (lineId, teacherId, semester) => ({ id: 'm_' + lineId, lineId, disciplineId: 'ds_1', semester, teacherId, state: 'joined', joinedAt: '' });
const members = [joined('ln_1', 'sf_1', 1), joined('ln_2', 'sf_1', 2), joined('ln_3', 'sf_2', 1)];
const all = [lesson('a2', 2, 'lecture', 2, 'sy_1'), lesson('a1', 1, 'lecture', 2, 'sy_1'), lesson('b1', 1, 'lecture', 2, 'sy_2'), lesson('c1', 1, 'lecture', 2, 'sy_3'), lesson('c2', 2, 'lecture', 2, 'sy_3')];
const index = syllabusIndex(syllabi, all, members);
const subject = { id: 'sb_1', disciplineId: 'ds_1', teacherId: 'sf_1', groupId: 'g_1' };

test('semester of the year and the syllabus a subject follows', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 8].map(semesterHalf), [1, 2, 1, 2, 1, 2]);
  assert.deepEqual([syllabusFor(subject, syllabi, 1, members).id, syllabusFor(subject, syllabi, 2, members).id, syllabusFor({ ...subject, teacherId: 'sf_2' }, syllabi, 2, members),
    syllabusFor({ ...subject, disciplineId: '' }, [{ id: 'sy_9', disciplineId: '', teacherId: 'sf_1', semester: 1, lineId: 'ln_1', ...ok }], 1, members)], ['sy_1', 'sy_2', null, null]);
  // only the approved version counts
  const versions = ['archived', 'approved', 'draft'].map((status, i) => ({ id: 'sy_' + i, disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, lineId: 'ln_1', status, version: i + 1 }));
  assert.deepEqual([syllabusFor(subject, versions, 1, members).id, syllabusFor(subject, versions.filter((v) => v.status !== 'approved'), 1, members), syllabusFor(subject, versions, 2, members)], ['sy_1', null, null]);
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
  assert.deepEqual(syllabusTotals(rows), { topics: 3, units: 1, lectureHours: 4, practiceHours: 6, controlHours: 2, hours: 12, selfHours: 0, pairs: 6 });
  assert.deepEqual(syllabusTotals([{ ...lesson('s', 1, 'lecture'), unit: 2, selfHours: 4 }, lesson('q', 2, 'lab')]), { topics: 2, units: 2, lectureHours: 2, practiceHours: 2, controlHours: 0, hours: 4, selfHours: 4, pairs: 2 });
  assert.deepEqual(syllabusTotals([]), { topics: 0, units: 0, lectureHours: 0, practiceHours: 0, controlHours: 0, hours: 0, selfHours: 0, pairs: 0 });
  const fitPairs = [pair('p1', '2026-09-01', 'closed', L('t1', 'lecture')), pair('p2', '2026-09-08', 'planned', L('t1p', 'practice')),
    pair('p3', '2026-09-15', 'cancelled'), pair('p4', '2026-09-22'), pair('p0', '2026-08-25')];
  assert.deepEqual(scheduleFit(two, fitPairs, S1), { pairs: 3, unplaced: 1, withoutTopic: 1 });
  assert.deepEqual(scheduleFit(two, fitPairs, S1, 1), { pairs: 3, unplaced: 0, withoutTopic: 1 });
});

const doc = (rows, info = {}) => ({ info: { discipline: '', teacher: '', semester: 1, course: null, audience: 'Сестринское дело', credits: 2, totalHours: 60, classHours: 36, selfHours: 24, ...info }, rows });
const fileRow = { semester: 1, unit: 1, label: '', practiceKind: '', selfHours: null, description: '' };
const row = (name, lectureHours, practiceHours, n, extra = {}) => ({ ...fileRow, kind: 'topic', name, lectureHours, practiceHours, row: n, ...extra });
const mod = (n, extra = {}) => ({ ...fileRow, kind: 'control', name: '', lectureHours: 0, practiceHours: 0, row: n, ...extra });
const base = [row('Введение', 2, 2, 2), row('Практикум', 0, 2, 3), mod(4)];
const ctx = (over = {}) => ({ discipline: { id: 'ds_1', name: 'Информатика' }, teacher: { id: 'sf_1', fullName: 'Асанов Айдар' }, versions: {}, today: '2026-08-31', ...over });
const stored = (name, order, lessonKind, hours, extra = {}) => ({ ...blank, syllabusId: null, order, name, lessonKind, hours, ...extra });
const part = (syllabus, rows, held = []) => ({ syllabus, rows, held: new Map(held) });
const heldPair = (topicId, lessonType, partNo, date = '2026-09-01') => ({ id: 'p_' + topicId + partNo, subjectId: 'sb_7', date, slot: 1, status: 'closed', topicId, lessonType, part: partNo });

const first = planSyllabusUpload(doc(base), ctx());
const [p1] = first.parts;
// tp_1 Введение (lecture), tp_2 Введение (practice), tp_3 Практикум (practice), tp_4 the module
const kept = p1.toInsert.map((r, i) => ({ ...r, syllabusId: 'sy_1', id: 'tp_' + (i + 1) }));
const spring = { ...stored('Введение', 1, 'lecture', 2), id: 'tp_9', syllabusId: 'sy_2' };
const have = ctx({ versions: { 1: part(syllabi[0], kept), 2: part(syllabi[1], [spring]) } });
const withHeld = (held, rows = kept) => ctx({ versions: { 1: part(syllabi[0], rows, held), 2: part(syllabi[1], [spring]) } });

test('planSyllabusUpload: first upload', () => {
  assert.deepEqual([first.errors, first.warnings, first.parts.length], [[], [], 1]);
  assert.deepEqual([p1.semester, p1.planSemester, p1.toUpdate, p1.toRemove, p1.units], [1, 1, [], [], [{ unit: 1, title: '' }]]);
  assert.deepEqual(p1.toInsert, [stored('Введение', 1, 'lecture', 2), stored('Введение', 2, 'practice', 2), stored('Практикум', 3, 'practice', 2), stored('', 4, 'control', 0)]);
  assert.deepEqual(p1.syllabus, { id: null, row: { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1, updated: '2026-08-31', manualOrder: true,
    audience: 'Сестринское дело', credits: 2, totalHours: 60, classHours: 36, selfHours: 24 } });
  assert.deepEqual(p1.summary, { semester: 1, planSemester: 1, replaces: false, topics: 3, units: 1, lectureHours: 2, practiceHours: 4, controlHours: 0, pairs: 3, added: 3, changed: 0, removed: 0 });
  // a field the file leaves empty is not in the row (it would erase what the journal holds); the course comes along when the file has it
  const sparse = planSyllabusUpload(doc(base, { audience: '', credits: null, totalHours: null, classHours: null, selfHours: null, course: 2 }), ctx()).parts[0];
  assert.deepEqual(sparse.syllabus.row, { disciplineId: 'ds_1', teacherId: 'sf_1', semester: 1, planSemester: 1, updated: '2026-08-31', manualOrder: true, course: 2 });
});

test('planSyllabusUpload: a row of lecture and practice is two lessons in a row; a changed kind of practice is a change', () => {
  const both = planSyllabusUpload(doc([row('Сети', 2, 2, 2, { description: 'О сетях', selfHours: 2 })]), ctx()).parts[0];
  assert.deepEqual(both.toInsert, [
    { syllabusId: null, order: 1, unit: 1, unitTitle: '', lessonKind: 'lecture', name: 'Сети', hours: 2, controlForms: '', selfHours: 2, description: 'О сетях', sourceId: '' },
    { syllabusId: null, order: 2, unit: 1, unitTitle: '', lessonKind: 'practice', name: 'Сети', hours: 2, controlForms: '', selfHours: null, description: '', sourceId: '' }]);
  const seminar = planSyllabusUpload(doc([row('Введение', 2, 0, 2), row('Введение', 0, 2, 3, { practiceKind: 'seminar' }), row('Практикум', 0, 2, 4), mod(5)]), have).parts[0];
  assert.deepEqual([seminar.toUpdate, seminar.toInsert, seminar.toRemove], [[{ id: 'tp_2', patch: { lessonKind: 'seminar' } }], [], []]);
  assert.deepEqual([seminar.summary.added, seminar.summary.changed, seminar.summary.removed], [0, 1, 0]);
});

test('planSyllabusUpload: re-upload matches rows by kind of lesson and name', () => {
  // тот же файл ещё раз: темы не пишутся, весенний силлабус в parts не попадает
  const same = planSyllabusUpload(doc(base), have);
  assert.deepEqual([same.parts.length, same.parts[0].toInsert, same.parts[0].toUpdate, same.parts[0].toRemove, same.parts[0].syllabus.id, same.parts[0].summary.replaces], [1, [], [], [], 'sy_1', true]);

  // строка вставлена первой, порядок сдвинулся, одна тема ушла, модуль получил название
  const shifted = planSyllabusUpload(doc([row('Новая тема', 2, 0, 2), row('Введение', 2, 2, 3, { description: 'О предмете' }), mod(4, { name: 'Тест' })]), have).parts[0];
  assert.deepEqual(shifted.toInsert.map((r) => [r.syllabusId, r.order, r.name, r.lessonKind]), [['sy_1', 1, 'Новая тема', 'lecture'], ['sy_1', 4, 'Тест', 'control']]);
  assert.deepEqual(shifted.toUpdate, [{ id: 'tp_1', patch: { order: 2, description: 'О предмете' } }, { id: 'tp_2', patch: { order: 3 } }]);
  assert.deepEqual(shifted.toRemove, ['tp_3', 'tp_4']);
  assert.deepEqual([shifted.summary.added, shifted.summary.changed, shifted.summary.removed], [1, 1, 1]);

  // одинаковые названия одного вида сопоставляются по счёту
  const twins = ctx({ versions: { 1: part(syllabi[0], [{ ...stored('Право', 1, 'lecture', 2), id: 'tp_a', syllabusId: 'sy_1' }, { ...stored('Право', 2, 'lecture', 2), id: 'tp_b', syllabusId: 'sy_1' }]) } });
  const twinPlan = planSyllabusUpload(doc([row('Право', 2, 0, 2), row('Новое', 2, 0, 3), row('Право', 2, 0, 4)]), twins).parts[0];
  assert.deepEqual([twinPlan.toUpdate, twinPlan.toInsert.map((r) => [r.order, r.name]), twinPlan.toRemove], [[{ id: 'tp_b', patch: { order: 3 } }], [[2, 'Новое']], []]);
  // the forms of the current control are not in the file: a new upload leaves them where they are
  const forms = withHeld([], kept.map((r) => (r.id === 'tp_1' ? { ...r, controlForms: 'опрос' } : r)));
  assert.deepEqual(planSyllabusUpload(doc(base), forms).parts[0].toUpdate, []);
});

test('planSyllabusUpload: held pairs protect their rows', () => {
  // лекция «Введение» проведена в одной из групп (пара другого предмета — sb_7)
  const held = withHeld([['tp_1', [heldPair('tp_1', 'lecture', 1)]]]);
  assert.deepEqual(planSyllabusUpload(doc([row('Новая тема', 2, 0, 2), row('Введение', 2, 2, 3), mod(4)]), held).errors, []);
  const renamed = planSyllabusUpload(doc([row('Введение в предмет', 2, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), held);
  assert.deepEqual([renamed.errors, renamed.warnings], [[], [{ code: 'held_renamed', order: 1, from: 'Введение', to: 'Введение в предмет', date: '2026-09-01' }]]);
  assert.deepEqual(renamed.parts[0].toUpdate, [{ id: 'tp_1', patch: { name: 'Введение в предмет' } }]);
  // the rename takes only a lesson of the same kind on the same place
  const otherKind = planSyllabusUpload(doc([row('Введение в предмет', 0, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), held);
  assert.deepEqual(otherKind.errors, [{ sheet: 'plan', row: 0, field: 'name', code: 'held_missing', name: 'Введение', date: '2026-09-01' }]);
  const gone = planSyllabusUpload(doc([row('Практикум', 0, 2, 2), mod(3)]), held);
  assert.deepEqual(gone.errors, [{ sheet: 'plan', row: 0, field: 'name', code: 'held_missing', name: 'Введение', date: '2026-09-01' }]);
  assert.deepEqual([gone.parts[0].toInsert, gone.parts[0].toUpdate, gone.parts[0].toRemove], [[], [], []]);
});

test('planSyllabusUpload: a held part of a lesson that the file cuts short is an error named by the column of the file', () => {
  const lecture4 = [{ ...kept[0], hours: 4 }, ...kept.slice(1)];
  const cut = planSyllabusUpload(doc([row('Введение', 2, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), withHeld([['tp_1', [heldPair('tp_1', 'lecture', 1), heldPair('tp_1', 'lecture', 2, '2026-09-08')]]], lecture4));
  assert.deepEqual(cut.errors, [{ sheet: 'plan', row: 2, field: 'lectureHours', code: 'held_hours', held: 4, date: '2026-09-01' }]);
  assert.deepEqual(cut.parts[0].toInsert, []);
  const practice4 = [kept[0], { ...kept[1], hours: 4 }, ...kept.slice(2)];
  const cutPractice = planSyllabusUpload(doc(base), withHeld([['tp_2', [heldPair('tp_2', 'practice', 2)]]], practice4));
  assert.deepEqual(cutPractice.errors, [{ sheet: 'plan', row: 2, field: 'practiceHours', code: 'held_hours', held: 4, date: '2026-09-01' }]);
  const control = planSyllabusUpload(doc(base), withHeld([['tp_4', [heldPair('tp_4', 'control', 2)]]]));
  assert.deepEqual(control.errors, [{ sheet: 'plan', row: 4, field: 'practiceHours', code: 'held_hours', held: 4, date: '2026-09-01' }]);
  // the lecture hours of the row are taken away altogether: the lecture is gone from the lessons, but the row is still named in the file
  const noLecture = planSyllabusUpload(doc([row('Введение', 0, 2, 2), row('Практикум', 0, 2, 3), mod(4)]), withHeld([['tp_1', [heldPair('tp_1', 'lecture', 1)]]]));
  assert.deepEqual(noLecture.errors, [{ sheet: 'plan', row: 2, field: 'lectureHours', code: 'held_hours', held: 2, date: '2026-09-01' }]);
  // the same hours (a held pair without its part counts as the first): nothing to say
  assert.deepEqual(planSyllabusUpload(doc(base), withHeld([['tp_1', [heldPair('tp_1', 'lecture', null)]]])).errors, []);
});

test('planSyllabusUpload: all-or-nothing across semesters; a row inserted at the top only shifts the order', () => {
  const heldAutumn = withHeld([['tp_1', [heldPair('tp_1', 'lecture', 1)]]]);
  const bad = planSyllabusUpload(doc([row('Практикум', 0, 2, 2), row('Весна', 2, 0, 3, { semester: 2 })], { semester: null }), heldAutumn);
  assert.equal(bad.errors.length, 1);
  assert.deepEqual(bad.parts.map((p) => [p.semester, p.toInsert, p.toUpdate, p.toRemove]), [[1, [], [], []], [2, [], [], []]]);
  const five = ctx({ versions: { 1: part(syllabi[0], [1, 2, 3, 4, 5].map((n) => ({ ...stored('T' + n, n, 'lecture', 2), id: 'tp_' + n, syllabusId: 'sy_1' }))) } });
  const top = planSyllabusUpload(doc([row('Новая', 2, 0, 2), ...[1, 2, 3, 4, 5].map((n) => row('T' + n, 2, 0, 2 + n))]), five).parts[0];
  assert.deepEqual([top.summary.added, top.summary.changed, top.summary.removed, top.toUpdate.length], [1, 0, 0, 5]);
});

test('subjectScope clears the old lesson of another syllabus of the same semester outside the dates', () => {
  const sc = subjectScope(subject, [pair('old', '2026-08-20', 'planned', L('c1', 'lecture')), pair('hold', '2026-08-21', 'closed', L('c1', 'lecture'))], index, S1);
  assert.deepEqual(sc.clear, ['old']);
});

test('planSyllabusUpload: other discipline or teacher in the file, semesters', () => {
  // регистр, пробелы и инициалы не считаются
  assert.deepEqual(planSyllabusUpload(doc(base, { discipline: 'Анатомия', teacher: 'Петров П.' }), ctx()).warnings,
    [{ code: 'discipline_differs', file: 'Анатомия', discipline: 'Информатика' }, { code: 'teacher_differs', file: 'Петров П.', teacher: 'Асанов Айдар' }]);
  assert.deepEqual(planSyllabusUpload(doc(base, { teacher: 'Колин А.' }), ctx({ teacher: { id: 'sf_1', fullName: 'Ли Анна' } })).warnings, [{ code: 'teacher_differs', file: 'Колин А.', teacher: 'Ли Анна' }]);
  assert.deepEqual(planSyllabusUpload(doc(base, { discipline: ' информатика ', teacher: 'асанов А. Б., Петров П.' }), ctx()).warnings, []);

  const springRows = base.map((r) => ({ ...r, semester: 2 }));
  const second = planSyllabusUpload(doc(springRows, { semester: 2 }), have);                 // весенний файл осенний силлабус не трогает
  assert.deepEqual(second.parts.map((p) => [p.semester, p.syllabus.id, p.toUpdate, p.toInsert.map((r) => [r.order, r.name]), p.toRemove]), [[2, 'sy_2', [], [[2, 'Введение'], [3, 'Практикум'], [4, '']], []]]);
  const year = planSyllabusUpload(doc([row('Осень', 2, 0, 2), row('Весна', 2, 0, 3, { semester: 2 })], { semester: null }), ctx());   // файл на год — две части
  assert.deepEqual(year.parts.map((p) => [p.semester, p.planSemester, p.toInsert.map((r) => [r.order, r.name]), p.summary.pairs]), [[1, 1, [[1, 'Осень']], 1], [2, 2, [[1, 'Весна']], 1]]);
  const third = planSyllabusUpload(doc([row('Тема', 2, 0, 2, { semester: 3 })], { semester: 3 }), have).parts[0];                     // «3 семестр» — это осенний
  assert.deepEqual([third.semester, third.planSemester, third.syllabus.id, third.syllabus.row.planSemester, third.toRemove], [1, 3, 'sy_1', 3, ['tp_1', 'tp_2', 'tp_3', 'tp_4']]);
});

test('planSyllabusUpload: a file of another curriculum semester over the stored one warns which groups it replaces', () => {   // I3
  const groups = ['01-1', '02-1'];
  const third = planSyllabusUpload(doc([row('Тема', 2, 0, 2, { semester: 3 })], { semester: 3 }), { ...have, groups });
  assert.deepEqual(third.warnings, [{ code: 'semester_replaces', stored: 1, file: 3, groups }]);
  assert.deepEqual(planSyllabusUpload(doc(base), { ...have, groups }).warnings, []);                              // the same semester again
  assert.deepEqual(planSyllabusUpload(doc([row('Тема', 2, 0, 2, { semester: 3 })], { semester: 3 }), ctx({ groups })).warnings, []);   // nothing stored yet
  // a year file: only the half that differs says so
  const year = planSyllabusUpload(doc([row('Осень', 2, 0, 2, { semester: 3 }), row('Весна', 2, 0, 3, { semester: 4 })], { semester: null }), { ...have, groups });
  assert.deepEqual(year.warnings, [{ code: 'semester_replaces', stored: 1, file: 3, groups }, { code: 'semester_replaces', stored: 2, file: 4, groups }]);
  // a stored row without its semester of the curriculum says nothing it cannot know
  const unknown = { ...have, groups, versions: { 1: part({ ...syllabi[0], planSemester: null }, kept) } };
  assert.deepEqual(planSyllabusUpload(doc([row('Тема', 2, 0, 2, { semester: 3 })], { semester: 3 }), unknown).warnings, []);
});

test('planSyllabusUpload: the unit title is a field of the row; a new title is a change', () => {                 // R3
  const titled = planSyllabusUpload(doc([row('Введение', 2, 2, 2, { unitTitle: 'Основы' }), row('Практикум', 0, 2, 3, { unitTitle: 'Основы' }), mod(4, { unitTitle: 'Основы' })]), have).parts[0];
  assert.deepEqual(titled.toUpdate, [1, 2, 3, 4].map((n) => ({ id: 'tp_' + n, patch: { unitTitle: 'Основы' } })));
  assert.deepEqual([titled.summary.added, titled.summary.changed, titled.summary.removed, titled.units], [0, 3, 0, [{ unit: 1, title: 'Основы' }]]);
  assert.equal(first.parts[0].toInsert[0].unitTitle, '');
});

test('subjectScope: a held pair without a lesson counts only inside the semester dates', () => {
  const held = pair('h', '2026-06-01', 'closed');
  const first = pair('n', '2026-09-01', 'planned');
  const sc = subjectScope(subject, [held, first], index, S1);
  assert.deepEqual(sc.pairs.map((p) => p.id), ['n']);
  assert.deepEqual(layoutLessons(sc.topics, sc.pairs, sc.skip).assign.map((x) => [x.id, x.patch.topicId]), [['n', 'a1']]);
  assert.deepEqual(subjectScope(subject, [pair('h2', '2026-06-01', 'closed', L('a1', 'lecture'))], index, S1).pairs.map((p) => p.id), ['h2']);
  assert.deepEqual(subjectScope(subject, [pair('h3', '2026-09-02', 'closed')], index, S1).pairs.map((p) => p.id), ['h3']);
});

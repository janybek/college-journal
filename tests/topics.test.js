import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as topics from '../core/topics.js';
import { inSemester, HOURS_PER_PAIR, NO_LESSON, lessonKey, lessonTypeOf, partsOf, lessonsOf, controlMarks, layoutLessons } from '../core/topics.js';

test('the module offers only the syllabus helpers', () => {
  assert.deepEqual(Object.keys(topics).sort(), ['HOURS_PER_PAIR', 'NO_LESSON', 'controlMarks', 'inSemester', 'layoutLessons', 'lessonKey', 'lessonTypeOf', 'lessonsOf', 'partsOf']);
});

test('inSemester', () => {
  const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
  assert.deepEqual(['2026-08-31', '2026-09-01', '2026-12-25', '2026-12-26'].map(d => inSemester(d, S1)), [false, true, true, false]);
  assert.equal(inSemester('2030-01-01', { semesterStart: '', semesterEnd: '' }), true);
});

test('lessons of plan rows and their layout over pairs', () => {
  const blank = { syllabusId: 'sy_1', unit: 1, controlForms: '', selfHours: null, description: '', unitTitle: '', sourceId: '' };
  const lesson = (id, order, lessonKind, hours = 2) => ({ ...blank, id, order, lessonKind, name: id, hours });
  const control = (id, order, hours = 0) => lesson(id, order, 'control', hours);
  const L = (topicId, lessonType, part = 1) => ({ topicId, lessonType, part });
  const pair = (id, date, status = 'planned', lesson = NO_LESSON, slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, ...lesson });
  const rows = [lesson('t2', 2, 'practice'), lesson('c1', 3, 'control', 0), lesson('t1', 1, 'lecture', 4), lesson('t3', 4, 'seminar', 4), lesson('c2', 5, 'control', 2)];

  assert.equal(HOURS_PER_PAIR, 2);
  // порядок строк — порядок пар; 4 часа — две пары подряд; контроль без часов пары не занимает
  assert.deepEqual(lessonsOf(rows).map(lessonKey), ['t1|lecture|1', 't1|lecture|2', 't2|practice|1', 't3|practice|1', 't3|practice|2', 'c2|control|1']);
  assert.deepEqual([partsOf(rows[2], 'lecture'), partsOf(rows[2], 'practice'), partsOf(rows[3], 'practice'), partsOf(rows[1], 'control'), partsOf(rows[4], 'control')], [2, 0, 2, 0, 1]);
  assert.deepEqual(['lecture', 'practice', 'seminar', 'lab', 'control', 'экзамен', undefined].map((lessonKind) => lessonTypeOf({ lessonKind })),
    ['lecture', 'practice', 'practice', 'practice', 'control', '', '']);
  assert.deepEqual([partsOf({ lessonKind: 'экзамен', hours: 2 }, ''), partsOf({ lessonKind: 'lecture', hours: 3 }, 'lecture')], [0, 1]);
  assert.deepEqual([...controlMarks(rows)].map(([key, list]) => [key, list.map((row) => row.id)]), [['t2|practice|1', ['c1']]]);
  assert.deepEqual([...controlMarks([lesson('t1', 1, 'lecture'), control('ca', 2), control('cb', 3)])].map(([key, list]) => [key, list.map((row) => row.id)]), [['t1|lecture|1', ['ca', 'cb']]]);
  assert.equal(controlMarks([control('c0', 1), lesson('t1', 2, 'lecture')]).size, 0);
  assert.deepEqual(lessonsOf([{ id: 'old', subjectId: 'sb_1', unit: 1, order: 1, name: 'Старая', lessonType: 'lecture' }]), []);
  assert.deepEqual([lessonKey(NO_LESSON), lessonKey(undefined), lessonKey({ topicId: '', lessonType: 'lecture', part: 1 }), lessonKey(L('t1', 'lecture', 2))], ['', '', '', 't1|lecture|2']);

  const two = [lesson('t1', 1, 'lecture'), lesson('t1p', 2, 'practice'), lesson('t2', 3, 'lecture')];      // занятия: t1 лекция, t1p практика, t2 лекция
  // по датам
  assert.deepEqual(layoutLessons(two, [pair('p2', '2026-09-08'), pair('p1', '2026-09-01')]),
    { assign: [{ id: 'p1', patch: L('t1', 'lecture') }, { id: 'p2', patch: L('t1p', 'practice') }], unplaced: [L('t2', 'lecture')], withoutTopic: 0 });
  // отменённая отдаёт занятие следующей, проведённая держит своё
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'closed', L('t1', 'lecture')), pair('p2', '2026-09-08', 'cancelled', L('t1p', 'practice')),
    pair('p3', '2026-09-15', 'planned', L('t2', 'lecture')), pair('p4', '2026-09-22')]),
    { assign: [{ id: 'p2', patch: NO_LESSON }, { id: 'p3', patch: L('t1p', 'practice') }, { id: 'p4', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 0 });
  // практика проведена раньше лекции: лекция всё равно встаёт один раз, практика второй раз не выдаётся
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'running', L('t1p', 'practice')), pair('p2', '2026-09-08'), pair('p3', '2026-09-15'), pair('p4', '2026-09-22')]),
    { assign: [{ id: 'p2', patch: L('t1', 'lecture') }, { id: 'p3', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 1 });
  // тема на две пары (4 часа): проведена первая часть, отменённая вторая отдаёт её следующей паре
  assert.deepEqual(layoutLessons([lesson('t3', 1, 'practice', 4)], [pair('p1', '2026-09-01', 'closed', L('t3', 'practice', 1)), pair('p2', '2026-09-08', 'cancelled', L('t3', 'practice', 2)), pair('p3', '2026-09-15')]),
    { assign: [{ id: 'p2', patch: NO_LESSON }, { id: 'p3', patch: L('t3', 'practice', 2) }], unplaced: [], withoutTopic: 0 });
  // уже разложено: писать нечего; пара без занятия с пустыми полями из таблицы равна NO_LESSON
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'planned', L('t1', 'lecture')),
    { id: 'p2', subjectId: 'sb_1', date: '2026-09-08', slot: 1, status: 'missed', topicId: '', lessonType: '', part: undefined }]),
    { assign: [], unplaced: [L('t1p', 'practice'), L('t2', 'lecture')], withoutTopic: 0 });
  // две пары в один день идут по номеру пары
  assert.deepEqual(layoutLessons(two, [pair('p2', '2026-09-01', 'planned', NO_LESSON, 2), pair('p1', '2026-09-01', 'planned', NO_LESSON, 1)]).assign.map((a) => a.id), ['p1', 'p2']);
  assert.deepEqual(layoutLessons([], [pair('p1', '2026-09-01'), pair('p2', '2026-09-08', 'cancelled')]), { assign: [], unplaced: [], withoutTopic: 1 });
  // skip: два первых свободных занятия считаются пройденными
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01')], 2), { assign: [{ id: 'p1', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 0 });
});

test('layoutLessons: a held pair without a lesson takes the next free one', () => {
  const rows = [{ id: 't1', order: 1, lessonKind: 'lecture', hours: 2 }, { id: 't2', order: 2, lessonKind: 'lecture', hours: 2 }, { id: 't3', order: 3, lessonKind: 'lecture', hours: 2 }];
  const P = (id, date, status, topicId = '') => ({ id, date, slot: 1, status, topicId, lessonType: topicId ? 'lecture' : '', part: topicId ? 1 : null });
  const ids = (pairs, r = rows) => layoutLessons(r, pairs).assign.map((x) => [x.id, x.patch.topicId]);
  assert.deepEqual(ids([P('a', '2026-09-01', 'closed'), P('b', '2026-09-08', 'closed'), P('c', '2026-09-15', 'planned')]), [['a', 't1'], ['b', 't2'], ['c', 't3']]);
  assert.deepEqual(ids([P('a', '2026-09-01', 'closed', 't2'), P('b', '2026-09-08', 'closed'), P('c', '2026-09-15', 'planned')]), [['b', 't1'], ['c', 't3']]);
  assert.deepEqual(layoutLessons([], [P('a', '2026-09-01', 'closed')]).assign, []);
});

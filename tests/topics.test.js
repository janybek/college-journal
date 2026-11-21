import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTopics, semesterOf, inSemester, semesterScope, HOURS_PER_PAIR, NO_LESSON, lessonKey, partsOf, lessonsOf, controlMarks, layoutLessons } from '../core/topics.js';

const topics = [1, 2, 3, 4].map(n => ({ id: 't' + n, subjectId: 'sb_1', unit: 1, order: n, name: 'Т' + n, lessonType: 'lecture' }));
const pair = (id, date, status = 'planned', topicId = '', slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, topicId });

test('topics go to planned pairs in date order', () => {
  assert.deepEqual(layoutTopics(topics, [pair('p2', '2026-09-08'), pair('p1', '2026-09-01'), pair('p3', '2026-09-15')]),
    { assign: [{ id: 'p1', topicId: 't1' }, { id: 'p2', topicId: 't2' }, { id: 'p3', topicId: 't3' }], unplaced: ['t4'], withoutTopic: 0 });
});

test('a cancelled pair gives its topic to the next pair; a held pair keeps its own', () => {
  const afterCancel = [pair('p1', '2026-09-01', 'closed', 't1'), pair('p2', '2026-09-08', 'cancelled', 't2'), pair('p3', '2026-09-15', 'planned', 't3'),
    pair('p4', '2026-09-22', 'planned', 't4'), pair('p5', '2026-09-29')];
  assert.deepEqual(layoutTopics(topics, afterCancel),
    { assign: [{ id: 'p2', topicId: '' }, { id: 'p3', topicId: 't2' }, { id: 'p4', topicId: 't3' }, { id: 'p5', topicId: 't4' }], unplaced: [], withoutTopic: 0 });
});

test('a held pair out of order: its topic is not handed out twice', () => {
  assert.deepEqual(layoutTopics(topics, [pair('p1', '2026-09-01', 'running', 't3'), pair('p2', '2026-09-08'), pair('p3', '2026-09-15'), pair('p4', '2026-09-22'), pair('p5', '2026-09-29')]),
    { assign: [{ id: 'p2', topicId: 't1' }, { id: 'p3', topicId: 't2' }, { id: 'p4', topicId: 't4' }], unplaced: [], withoutTopic: 1 });
});

test('already laid out: nothing to assign; missed acts like cancelled', () => {
  assert.deepEqual(layoutTopics(topics, [pair('p1', '2026-09-01', 'planned', 't1'), pair('p2', '2026-09-08', 'planned', 't2')]),
    { assign: [], unplaced: ['t3', 't4'], withoutTopic: 0 });
  assert.deepEqual(layoutTopics(topics, [pair('p1', '2026-09-01', 'missed', 't1'), pair('p2', '2026-09-08')]),
    { assign: [{ id: 'p1', topicId: '' }, { id: 'p2', topicId: 't1' }], unplaced: ['t2', 't3', 't4'], withoutTopic: 0 });
});

test('two pairs on one day go by slot; no topics -> withoutTopic counts planned pairs', () => {
  assert.deepEqual(layoutTopics(topics, [pair('p2', '2026-09-01', 'planned', '', 2), pair('p1', '2026-09-01', 'planned', '', 1)]).assign,
    [{ id: 'p1', topicId: 't1' }, { id: 'p2', topicId: 't2' }]);
  assert.deepEqual(layoutTopics([], [pair('p1', '2026-09-01'), pair('p2', '2026-09-08'), pair('p3', '2026-09-15', 'cancelled')]),
    { assign: [], unplaced: [], withoutTopic: 2 });
});

test('semesterOf and inSemester', () => {
  assert.deepEqual([{ semester: 2 }, { semester: 1 }, { semester: null }, {}, { semester: 3 }].map(semesterOf), [2, 1, 1, 1, 1]);
  const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
  assert.deepEqual(['2026-08-31', '2026-09-01', '2026-12-25', '2026-12-26'].map(d => inSemester(d, S1)), [false, true, true, false]);
  assert.equal(inSemester('2030-01-01', { semesterStart: '', semesterEnd: '' }), true);
});

const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
const S2 = { semesterStart: '2027-02-01', semesterEnd: '2027-06-18', semester: 2 };
const T = (id, semester, order) => ({ id, subjectId: 'sb_1', ...(semester ? { semester } : {}), unit: 1, order, name: id, lessonType: 'lecture' });
const year = [T('a1', 1, 1), T('a2', 1, 2), T('old', null, 3), T('b1', 2, 1), T('b2', 2, 2)];     // 'old' has no semester
const P = (id, date, status = 'planned', topicId = '') => ({ id, subjectId: 'sb_1', date, slot: 1, status, topicId });
const yearPairs = [P('h1', '2026-09-01', 'closed', 'a1'), P('o1', '2026-12-22', 'planned', 'a2'), P('n1', '2027-02-02'), P('n2', '2027-02-09'), P('n3', '2027-02-16')];

test('semesterScope: second semester takes its own topics and pairs', () => {
  const second = semesterScope(year, yearPairs, S2);
  assert.deepEqual([second.topics.map(t => t.id), second.pairs.map(p => p.id)], [['b1', 'b2'], ['h1', 'n1', 'n2', 'n3']]);
  assert.deepEqual(second.clear, []);
  assert.deepEqual(layoutTopics(second.topics, second.pairs),
    { assign: [{ id: 'n1', topicId: 'b1' }, { id: 'n2', topicId: 'b2' }], unplaced: [], withoutTopic: 1 });
});

test('semesterScope: first semester includes the row without a semester', () => {
  const first = semesterScope(year, yearPairs, S1);
  assert.deepEqual([first.topics.map(t => t.id), first.pairs.map(p => p.id)], [['a1', 'a2', 'old'], ['h1', 'o1']]);
  assert.deepEqual(layoutTopics(first.topics, first.pairs), { assign: [], unplaced: ['old'], withoutTopic: 0 });
  assert.deepEqual(first.clear, []);
});

test('semesterScope: a held pair outside the dates keeps its topic busy; one topic, one pair', () => {
  const held = semesterScope(year, [P('h9', '2026-08-20', 'closed', 'b1'), P('n1', '2027-02-02')], S2);
  assert.deepEqual(held.clear, []);
  assert.deepEqual(layoutTopics(held.topics, held.pairs).assign, [{ id: 'n1', topicId: 'b2' }]);
  const moved = semesterScope(year, [P('h0', '2026-08-25', 'closed', 'old'), P('e1', '2026-09-01', 'planned', 'a1'),
    P('e2', '2026-09-08', 'planned', 'a2'), P('e3', '2026-08-31', 'planned', 'b1')], { ...S1, semesterStart: '2026-09-04' });
  assert.deepEqual([moved.pairs.map(p => p.id), moved.clear], [['h0', 'e2'], ['e1']]);
  assert.deepEqual(layoutTopics(moved.topics, moved.pairs).assign, [{ id: 'e2', topicId: 'a1' }]);
  const switched = semesterScope(year, [P('s1', '2026-10-19', 'planned', 'b1'), P('n1', '2027-02-02')], S2);
  assert.deepEqual([switched.pairs.map(p => p.id), switched.clear], [['n1'], ['s1']]);
  assert.deepEqual(layoutTopics(switched.topics, switched.pairs).assign, [{ id: 'n1', topicId: 'b1' }]);
  assert.equal(semesterScope(year, yearPairs, { semesterStart: '', semesterEnd: '', semester: 1 }).pairs.length, 5);
});

test('lessons of plan rows and their layout over pairs', () => {
  const blank = { unit: 1, label: '', practiceKind: '', selfHours: null, description: '' };
  const topic = (id, order, lectureHours, practiceHours, syllabusId = 'sy_1') => ({ ...blank, id, syllabusId, order, name: id, lectureHours, practiceHours, kind: 'topic' });
  const control = (id, order, hours = 0) => ({ ...blank, id, syllabusId: 'sy_1', order, name: '', lectureHours: 0, practiceHours: hours, kind: 'control' });
  const L = (topicId, lessonType, part = 1) => ({ topicId, lessonType, part });
  const pair = (id, date, status = 'planned', lesson = NO_LESSON, slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, ...lesson });
  const rows = [topic('t2', 2, 2, 2), control('c1', 3), topic('t1', 1, 4, 2), topic('t3', 4, 0, 4), control('c2', 5, 2)];

  assert.equal(HOURS_PER_PAIR, 2);
  // порядок строк — порядок пар; у строки лекции раньше практик; 4 часа — две пары подряд; модуль без часов пары не занимает
  assert.deepEqual(lessonsOf(rows).map(lessonKey),
    ['t1|lecture|1', 't1|lecture|2', 't1|practice|1', 't2|lecture|1', 't2|practice|1', 't3|practice|1', 't3|practice|2', 'c2|control|1']);
  assert.deepEqual([partsOf(rows[2], 'lecture'), partsOf(rows[2], 'practice'), partsOf(rows[2], 'control'), partsOf(rows[4], 'control'), partsOf(rows[4], 'practice')], [2, 1, 0, 1, 0]);
  assert.deepEqual([...controlMarks(rows)].map(([key, list]) => [key, list.map((row) => row.id)]), [['t2|practice|1', ['c1']]]);
  assert.deepEqual([...controlMarks([topic('t1', 1, 2, 0), control('ca', 2), control('cb', 3)])].map(([key, list]) => [key, list.map((row) => row.id)]), [['t1|lecture|1', ['ca', 'cb']]]);
  assert.equal(controlMarks([control('c0', 1), topic('t1', 2, 2, 0)]).size, 0);
  assert.deepEqual(lessonsOf([{ id: 'old', subjectId: 'sb_1', unit: 1, order: 1, name: 'Старая', lessonType: 'lecture' }]), []);
  assert.deepEqual([lessonKey(NO_LESSON), lessonKey(undefined), lessonKey({ topicId: '', lessonType: 'lecture', part: 1 }), lessonKey(L('t1', 'lecture', 2))], ['', '', '', 't1|lecture|2']);

  const two = [topic('t1', 1, 2, 2), topic('t2', 2, 2, 0)];      // занятия: t1 лекция, t1 практика, t2 лекция
  // по датам
  assert.deepEqual(layoutLessons(two, [pair('p2', '2026-09-08'), pair('p1', '2026-09-01')]),
    { assign: [{ id: 'p1', patch: L('t1', 'lecture') }, { id: 'p2', patch: L('t1', 'practice') }], unplaced: [L('t2', 'lecture')], withoutTopic: 0 });
  // отменённая отдаёт занятие следующей, проведённая держит своё
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'closed', L('t1', 'lecture')), pair('p2', '2026-09-08', 'cancelled', L('t1', 'practice')),
    pair('p3', '2026-09-15', 'planned', L('t2', 'lecture')), pair('p4', '2026-09-22')]),
    { assign: [{ id: 'p2', patch: NO_LESSON }, { id: 'p3', patch: L('t1', 'practice') }, { id: 'p4', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 0 });
  // практика проведена раньше лекции: лекция всё равно встаёт один раз, практика второй раз не выдаётся
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'running', L('t1', 'practice')), pair('p2', '2026-09-08'), pair('p3', '2026-09-15'), pair('p4', '2026-09-22')]),
    { assign: [{ id: 'p2', patch: L('t1', 'lecture') }, { id: 'p3', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 1 });
  // тема на две пары (4 часа): проведена первая часть, отменённая вторая отдаёт её следующей паре
  assert.deepEqual(layoutLessons([topic('t3', 1, 0, 4)], [pair('p1', '2026-09-01', 'closed', L('t3', 'practice', 1)), pair('p2', '2026-09-08', 'cancelled', L('t3', 'practice', 2)), pair('p3', '2026-09-15')]),
    { assign: [{ id: 'p2', patch: NO_LESSON }, { id: 'p3', patch: L('t3', 'practice', 2) }], unplaced: [], withoutTopic: 0 });
  // уже разложено: писать нечего; пара без занятия с пустыми полями из таблицы равна NO_LESSON
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01', 'planned', L('t1', 'lecture')),
    { id: 'p2', subjectId: 'sb_1', date: '2026-09-08', slot: 1, status: 'missed', topicId: '', lessonType: '', part: undefined }]),
    { assign: [], unplaced: [L('t1', 'practice'), L('t2', 'lecture')], withoutTopic: 0 });
  // две пары в один день идут по номеру пары
  assert.deepEqual(layoutLessons(two, [pair('p2', '2026-09-01', 'planned', NO_LESSON, 2), pair('p1', '2026-09-01', 'planned', NO_LESSON, 1)]).assign.map((a) => a.id), ['p1', 'p2']);
  assert.deepEqual(layoutLessons([], [pair('p1', '2026-09-01'), pair('p2', '2026-09-08', 'cancelled')]), { assign: [], unplaced: [], withoutTopic: 1 });
  // skip: два первых свободных занятия считаются пройденными
  assert.deepEqual(layoutLessons(two, [pair('p1', '2026-09-01')], 2), { assign: [{ id: 'p1', patch: L('t2', 'lecture') }], unplaced: [], withoutTopic: 0 });
});

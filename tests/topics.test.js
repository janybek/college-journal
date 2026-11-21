import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as topics from '../core/topics.js';
import { inSemester, HOURS_PER_PAIR, NO_LESSON, lessonKey, partsOf, lessonsOf, controlMarks, layoutLessons } from '../core/topics.js';

test('the module offers only the syllabus helpers', () => {
  assert.deepEqual(Object.keys(topics).sort(), ['HOURS_PER_PAIR', 'NO_LESSON', 'controlMarks', 'inSemester', 'layoutLessons', 'lessonKey', 'lessonsOf', 'partsOf']);
});

test('inSemester', () => {
  const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
  assert.deepEqual(['2026-08-31', '2026-09-01', '2026-12-25', '2026-12-26'].map(d => inSemester(d, S1)), [false, true, true, false]);
  assert.equal(inSemester('2030-01-01', { semesterStart: '', semesterEnd: '' }), true);
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

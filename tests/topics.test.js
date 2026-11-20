import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTopics, semesterOf, inSemester, semesterScope } from '../core/topics.js';

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

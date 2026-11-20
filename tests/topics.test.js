import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTopics } from '../core/topics.js';

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

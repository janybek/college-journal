import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semesterTopics, nextTopic, planWarnings } from '../site/js/syllabus.js';

const topic = (semester, order, unit, pair = null) => ({ id: `t${semester}_${order}`, semester, order, unit, name: 'Т', lessonType: 'lecture', pair });
const plan = { semester: 1, withoutTopic: 2,
  topics: [topic(1, 1, 1, { date: '2026-09-01' }), topic(1, 2, 2), topic(2, 1, 1), topic(2, 2, 1), topic(2, 5, 2)] };

test('semesterTopics: the topics of one semester, in order', () => {
  assert.deepEqual(semesterTopics(plan, 1).map((t) => t.id), ['t1_1', 't1_2']);
  assert.deepEqual(semesterTopics(plan, 2).map((t) => t.order), [1, 2, 5]);
  // The server sorts them already; the screen does not rely on it.
  const shuffled = { ...plan, topics: [topic(2, 5, 2), topic(1, 2, 2), topic(2, 1, 1)] };
  assert.deepEqual(semesterTopics(shuffled, 2).map((t) => t.order), [1, 5]);
});

test('nextTopic: the number after the largest and the module of the last topic', () => {
  assert.deepEqual(nextTopic(semesterTopics(plan, 2)), { order: 6, unit: 2 });
  assert.deepEqual(nextTopic([]), { order: 1, unit: 1 });
});

test('planWarnings: only the current semester warns', () => {
  assert.deepEqual(planWarnings(plan, 1), { notPlaced: 1, withoutTopic: 2 });
  assert.deepEqual(planWarnings(plan, 2), { notPlaced: 0, withoutTopic: 0 });     // не текущий семестр: предупреждений нет
});

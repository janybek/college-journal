import { FIXED_STATUSES } from './schema.js';

export const DEFAULT_SEMESTER = 1;
export const HOURS_PER_PAIR = 2;

// A row without a semester (or with a wrong one) belongs to semester 1.
export const semesterOf = (topic) => (topic && topic.semester === 2 ? 2 : DEFAULT_SEMESTER);

// The date lies inside the semester dates (inclusive); without both dates everything counts.
export const inSemester = (date, settings) =>
  !settings.semesterStart || !settings.semesterEnd || (date >= settings.semesterStart && date <= settings.semesterEnd);

// Narrows the topics and pairs of ONE subject to the current semester, for layoutTopics.
// `clear`: ids of not-held pairs outside the dates that hold a topic of the current semester (the caller empties their topicId).
export function semesterScope(topics, pairs, settings) {
  const current = (topics || []).filter(t => semesterOf(t) === settings.semester);
  const currentIds = new Set(current.map(t => t.id));
  const all = pairs || [];
  const fixed = (p) => FIXED_STATUSES.includes(p.status);
  return {
    topics: current,
    pairs: all.filter(p => fixed(p) || inSemester(p.date, settings)),
    clear: all.filter(p => !fixed(p) && !inSemester(p.date, settings) && currentIds.has(p.topicId)).map(p => p.id),
  };
}

// Lays the topics of ONE subject over its pairs. Returns only the pairs whose topic changes.
export function layoutTopics(topics, pairs) {
  const orderedTopics = [...(topics || [])].sort((a, b) => a.order - b.order);
  const orderedPairs = [...(pairs || [])].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const used = new Set(orderedPairs.filter(p => FIXED_STATUSES.includes(p.status)).map(p => p.topicId));
  const free = orderedTopics.filter(t => !used.has(t.id)).map(t => t.id);

  const assign = [];
  let withoutTopic = 0;
  for (const pair of orderedPairs) {
    let topicId;
    if (pair.status === 'planned') {
      topicId = free.length ? free.shift() : '';
      if (!topicId) withoutTopic++;
    } else if (pair.status === 'cancelled' || pair.status === 'missed') topicId = '';
    else continue;
    if ((pair.topicId || '') !== topicId) assign.push({ id: pair.id, topicId });
  }
  return { assign, unplaced: free, withoutTopic };
}

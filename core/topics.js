import { FIXED_STATUSES } from './schema.js';

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

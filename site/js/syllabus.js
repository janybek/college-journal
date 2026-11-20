// The topic plan of a subject split into semesters (no DOM). Each semester has its own numbers and modules;
// the server lays only the topics of the current semester (`plan.semester`) on pairs.

// The topics of one semester, by number.
export function semesterTopics(plan, semester) {
  return plan.topics.filter((topic) => topic.semester === semester).sort((a, b) => a.order - b.order);
}

// Number and module for a new topic of a semester: the number after the largest one, the module of the last topic.
export function nextTopic(topics) {
  if (topics.length === 0) return { order: 1, unit: 1 };
  const last = topics.reduce((a, b) => (b.order > a.order ? b : a));
  return { order: last.order + 1, unit: last.unit };
}

// What to warn about on the tab of a semester. Only the current semester stands on pairs, so another one has
// nothing to warn about: its topics wait for the switch of the semester.
export function planWarnings(plan, semester) {
  if (semester !== plan.semester) return { notPlaced: 0, withoutTopic: 0 };
  return {
    notPlaced: semesterTopics(plan, semester).filter((topic) => topic.pair === null).length,
    withoutTopic: plan.withoutTopic,
  };
}

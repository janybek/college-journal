import { FIXED_STATUSES } from './schema.js';

export const HOURS_PER_PAIR = 2;

// The date lies inside the semester dates (inclusive); without both dates everything counts.
export const inSemester = (date, settings) =>
  !settings.semesterStart || !settings.semesterEnd || (date >= settings.semesterStart && date <= settings.semesterEnd);

// ---- Lessons of a syllabus: what stands on a pair (a plan row + the kind of the pair + the part among pairs of this kind). ----

export const NO_LESSON = Object.freeze({ topicId: '', lessonType: '', part: null });

// 'tp_1|lecture|2'; '' for a pair without a lesson.
export function lessonKey(x) {
  return x && x.topicId ? `${x.topicId}|${x.lessonType}|${x.part}` : '';
}

// How many pairs of this kind a plan row takes (whole pairs; no hours — 0).
export function partsOf(row, lessonType) {
  const pairs = (hours) => Math.floor((Number(hours) || 0) / HOURS_PER_PAIR);
  if (row.kind === 'control') return lessonType === 'control' ? pairs(row.practiceHours) : 0;
  if (lessonType === 'lecture') return pairs(row.lectureHours);
  if (lessonType === 'practice') return pairs(row.practiceHours);
  return 0;
}

const byOrder = (a, b) => a.order - b.order;

// Rows of ONE syllabus -> lessons in teaching order: by `order`; a topic gives its lectures, then its practices;
// a module with hours gives its own pairs; a module without hours gives none.
export function lessonsOf(rows) {
  const lessons = [];
  for (const row of [...(rows || [])].sort(byOrder)) {
    const types = row.kind === 'control' ? ['control'] : ['lecture', 'practice'];
    for (const lessonType of types) {
      for (let part = 1; part <= partsOf(row, lessonType); part++) lessons.push({ topicId: row.id, lessonType, part });
    }
  }
  return lessons;
}

// Modules without hours: Map(lessonKey -> [module rows in row order]); the mark sits on the last lesson of the nearest earlier row that has lessons.
export function controlMarks(rows) {
  const marks = new Map();
  let last = null;
  for (const row of [...(rows || [])].sort(byOrder)) {
    const own = lessonsOf([row]);
    if (own.length) last = own[own.length - 1];
    else if (row.kind === 'control' && last) {
      const key = lessonKey(last);
      marks.set(key, [...(marks.get(key) || []), row]);
    }
  }
  return marks;
}

// Lays the lessons of ONE syllabus over the pairs of ONE subject. Returns only the pairs whose lesson changes.
// The lessons of held pairs are taken; of the free ones the first `skip` count as already passed and are not handed out.
export function layoutLessons(rows, pairs, skip = 0) {
  const ordered = [...(pairs || [])].sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set(ordered.filter(p => FIXED_STATUSES.includes(p.status)).map(lessonKey));
  const free = lessonsOf(rows).filter(l => !used.has(lessonKey(l))).slice(skip);

  const assign = [];
  let withoutTopic = 0;
  for (const pair of ordered) {
    let lesson;
    if (pair.status === 'planned') {
      lesson = free.shift();
      if (!lesson) withoutTopic++;
    } else if (pair.status === 'cancelled' || pair.status === 'missed') lesson = undefined;
    else continue;
    if (lessonKey(pair) !== lessonKey(lesson)) assign.push({ id: pair.id, patch: lesson ? { ...lesson } : { ...NO_LESSON } });
  }
  return { assign, unplaced: free, withoutTopic };
}

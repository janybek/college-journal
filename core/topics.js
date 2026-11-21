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

// The kind of the pair a plan row gives: 'lecture', 'practice' (practice, seminar, lab), 'control'; '' for an unknown kind of lesson.
export function lessonTypeOf(row) {
  const kind = row && row.lessonKind;
  if (kind === 'lecture' || kind === 'control') return kind;
  return kind === 'practice' || kind === 'seminar' || kind === 'lab' ? 'practice' : '';
}

// How many pairs of this kind a plan row takes: its hours in whole pairs when the kind is the kind of the row, otherwise 0.
export function partsOf(row, lessonType) {
  const own = lessonTypeOf(row);
  return own !== '' && own === lessonType ? Math.floor((Number(row.hours) || 0) / HOURS_PER_PAIR) : 0;
}

const byOrder = (a, b) => a.order - b.order;

// Rows of ONE syllabus -> lessons in teaching order: by `order`; a row gives the pairs of its own kind, a control without hours gives none.
export function lessonsOf(rows) {
  const lessons = [];
  for (const row of [...(rows || [])].sort(byOrder)) {
    const lessonType = lessonTypeOf(row);
    for (let part = 1; part <= partsOf(row, lessonType); part++) lessons.push({ topicId: row.id, lessonType, part });
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
    else if (row.lessonKind === 'control' && last) {
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

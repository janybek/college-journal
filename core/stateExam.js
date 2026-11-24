import { isDate } from './dates.js';
import { gradeWord } from './grades.js';

export const STATE_EXAM = Object.freeze({ nameMax: 200, scoreMax: 100, itemsMax: 200 });

export function checkStateExam(input, { groups, old = null, hasScores = false }) {
  const src = input || {};
  const problems = [];
  let groupId = '';
  if (typeof src.groupId !== 'string' || !groups.some((g) => g.id === src.groupId)) problems.push({ field: 'groupId', code: 'bad_ref' });
  else if (hasScores && old && src.groupId !== old.groupId) problems.push({ field: 'groupId', code: 'locked' });
  else groupId = src.groupId;
  const name = typeof src.name === 'string' ? src.name.trim() : '';
  if (!name) problems.push({ field: 'name', code: 'empty' });
  else if (name.length > STATE_EXAM.nameMax) problems.push({ field: 'name', code: 'too_long' });
  if (typeof src.date !== 'string' || !isDate(src.date)) problems.push({ field: 'date', code: 'bad_value' });
  if (problems.length) return { value: null, problems };
  return { value: { groupId, name, date: src.date }, problems };
}

export function checkScore(value) {
  if (value === null) return null;
  if (Number.isInteger(value) && value >= 0 && value <= STATE_EXAM.scoreMax) return null;
  return 'bad_value';
}

export function examStats(scores, scheme) {
  const stats = { total: scores.length, entered: 0, fail: 0, fair: 0, good: 0, excellent: 0, average: null };
  let sum = 0;
  for (const s of scores) {
    if (s === null || s === undefined) continue;
    stats.entered += 1;
    sum += s;
    stats[gradeWord(s, scheme)] += 1;
  }
  if (stats.entered) stats.average = Math.round(sum / stats.entered);
  return stats;
}

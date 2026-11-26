// Rules of the progress figures in the directories (group, discipline, student and staff cards). Pure functions, no storage.
import { pairEnd } from './dirInfo.js';
import { inSemester, HOURS_PER_PAIR } from './topics.js';

export const PERSON_TABLES = ['students', 'staff'];
export const PROGRESS_TABLES = ['groups', 'disciplines'];
export const COUNTED_STATES = ['risk', 'fail', 'notAdmitted', 'absent', 'incomplete'];

export function meanOf(numbers) {
  return numbers.length ? Math.round(numbers.reduce((sum, n) => sum + n, 0) / numbers.length) : null;
}

export function attendanceTotal(list) {
  let marked = 0;
  let attended = 0;
  let absent = 0;
  for (const item of list) {
    marked += item.marked;
    attended += item.attended;
    absent += item.absent;
  }
  return { marked, attended, absent, percent: marked > 0 ? Math.round((attended * 100) / marked) : null };
}

const FINAL_STATES = { not_admitted: 'notAdmitted', absent: 'absent', incomplete: 'incomplete' };

// State of one subject of one student. A closed final sheet decides alone; before it, "risk" is a unit below "fair" or a semester at or under the admission.
export function subjectState(result, final, { scheme, split }) {
  if (final) {
    if (final.status === 'done') return final.word === 'fail' ? 'fail' : 'passed';
    return FINAL_STATES[final.status] || 'noExam';
  }
  const totals = result.units.map((u) => u.total).filter((t) => t !== null);
  if (!totals.length) return 'going';
  if ((result.semester !== null && result.semester <= split.admission) || totals.some((t) => t < scheme.fair)) return 'risk';
  return 'going';
}

export function stateCounts(states) {
  const counts = { risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 };
  for (const state of states) if (COUNTED_STATES.includes(state)) counts[state] += 1;
  return counts;
}

export function figuresOf(items) {
  const totals = [];
  for (const item of items) for (const unit of item.units) if (unit.total !== null) totals.push(unit.total);
  return {
    attendance: attendanceTotal(items.map((item) => item.attendance)),
    average: meanOf(totals),
    risk: items.filter((item) => item.state === 'risk').length,
  };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The debt of one past half: the row of halfResults + the repeat cards of this student, subject and half.
export function debtOf(row, cards) {
  if (row.status === 'none') return null;
  if (row.status === 'done' && row.word !== 'fail') return null;
  if (cards.some((card) => card.status === 'passed')) return null;
  const state = row.status === 'done' ? 'fail' : FINAL_STATES[row.status];
  if (!state) return null;
  const live = cards.filter((card) => card.status !== 'cancelled')
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  return { state, total: row.total ?? null, repeat: live.length ? live[live.length - 1].status : null };
}

export function workCounts(items) {
  const counts = { checked: 0, submitted: 0, returned: 0, missing: 0 };
  for (const item of items) {
    if (item.state === 'checked') counts.checked += 1;
    else if (item.state === 'submitted') counts.submitted += 1;
    else if (item.state === 'returned') counts.returned += 1;
    else if (item.state === 'none' && item.overdue) counts.missing += 1;
  }
  return counts;
}

export function pairEnded(pair, today, time) {
  return pair.date < today || (pair.date === today && pairEnd(pair) <= time);
}

export function unfilledPair(pair, { today, time, settings }) {
  return pair.status === 'planned' && inSemester(pair.date, settings) && pairEnded(pair, today, time);
}

// A unit whose pairs are over but whose control or self-work points are still missing for someone who has not left.
export function unitGap({ unit, pairs, closedUnits, students, today, time, scheme }) {
  if (closedUnits.includes(unit)) return null;
  const own = pairs.filter((pair) => pair.unit === unit && pair.status !== 'cancelled');
  if (!own.length || own.some((pair) => !pairEnded(pair, today, time))) return null;
  let control = 0;
  let self = 0;
  for (const student of students) {
    if (student.left !== false) continue;
    const entry = student.units.find((u) => u.unit === unit);
    if (scheme.control !== 0 && (!entry || entry.control === null)) control += 1;
    if (scheme.self !== 0 && (!entry || entry.self === null)) self += 1;
  }
  return control === 0 && self === 0 ? null : { unit, control, self };
}

export function roleList(roles) {
  if (typeof roles !== 'string') return [];
  const out = [];
  for (const part of roles.split(',')) {
    const role = part.trim();
    if (role && !out.includes(role)) out.push(role);
  }
  return out;
}

export function hoursOf(weekPairs) {
  return weekPairs * HOURS_PER_PAIR;
}

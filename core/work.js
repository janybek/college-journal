// Rules of assignments (homework and self-work), their checking and the self-work points counted from them.
// Pure functions: time comes in as nowMs.
import { isDate, isTime, parseLocalDateTime, localDate, addDays } from './dates.js';

const KINDS = ['hw', 'srs'];

export const WORK = Object.freeze({ titleMax: 200, descriptionMax: 5000, textMax: 5000, commentMax: 2000, pointsMax: 100, soonMs: 172800000, farMs: 366 * 86400000 });

const isInt = (v) => Number.isInteger(v);

export function checkAssignment(input, { units, topics, nowMs, old = null, locked = false, maxGiven = null }) {
  const src = input || {};
  const problems = [];
  const add = (field, code) => problems.push({ field, code });

  const kind = src.kind;
  const kindOk = KINDS.includes(kind);
  if (!kindOk) add('kind', 'bad_value');

  const topicId = typeof src.topicId === 'string' ? src.topicId : '';
  const unitIn = src.unit === undefined ? null : src.unit;
  const unitEff = unitIn === null ? (kind === 'hw' && topicId !== '' && old && topicId === old.topicId ? old.unit : null) : unitIn;
  const unchanged = !!old && kindOk && kind === old.kind && topicId === old.topicId && unitEff === old.unit;

  let unit = null;
  let unitProblem = null;
  let topicProblem = null;
  if (unchanged) {
    unit = old.unit;
  } else if (kindOk) {
    const topic = topicId === '' ? null : (topics || []).find((t) => t.id === topicId) || null;
    if (topicId !== '') {
      if (!topic || (unitIn !== null && unitIn !== topic.unit)) topicProblem = 'bad_ref';
    }
    if (kind === 'srs') {
      if (isInt(unitIn) && (units || []).includes(unitIn)) unit = unitIn;
      else unitProblem = 'bad_value';
    } else if (unitIn === null) {
      unit = topic ? topic.unit : null;
    } else if (isInt(unitIn) && (units || []).includes(unitIn)) {
      unit = unitIn;
    } else {
      unitProblem = 'bad_value';
    }
  }

  if (locked && old) {
    if (kindOk && kind !== old.kind) { problems.length = 0; add('kind', 'locked'); }
    if (unitProblem || (!unchanged && unit !== old.unit)) unitProblem = 'locked';
    if (!unchanged && topicId !== old.topicId) topicProblem = 'locked';
  }
  if (unitProblem) add('unit', unitProblem);
  if (topicProblem) add('topicId', topicProblem);

  const title = typeof src.title === 'string' ? src.title.trim() : '';
  if (title === '') add('title', 'empty');
  else if (title.length > WORK.titleMax) add('title', 'too_long');

  const description = typeof src.description === 'string' ? src.description : '';
  if (description.length > WORK.descriptionMax) add('description', 'too_long');

  let dueAt = null;
  if (!isDate(src.dueDate) || !isTime(src.dueTime)) {
    add('due', 'bad_value');
  } else {
    dueAt = src.dueDate + ' ' + src.dueTime + ':00';
    if (!old || dueAt !== old.dueAt) {
      const ms = parseLocalDateTime(dueAt);
      if (ms <= nowMs) add('due', 'due_past');
      else if (ms > nowMs + WORK.farMs) add('due', 'too_far');
    }
  }

  const maxPoints = src.maxPoints;
  if (!isInt(maxPoints) || maxPoints < 1 || maxPoints > WORK.pointsMax) add('maxPoints', 'bad_value');
  else if (maxGiven !== null && maxGiven !== undefined && maxPoints < maxGiven) add('maxPoints', 'below_points');

  if (problems.length) return { value: null, problems };
  return { value: { kind, unit, topicId, title, description, dueAt, maxPoints }, problems };
}

// The attempt with the biggest n (the bigger id on a tie) of one pair "assignment + student".
export function currentAttempt(list) {
  let best = null;
  for (const a of list || []) {
    if (!best || a.n > best.n || (a.n === best.n && a.id > best.id)) best = a;
  }
  return best;
}

export function workState(assignment, attempt, nowMs) {
  const state = attempt && ['submitted', 'checked', 'returned'].includes(attempt.status) ? attempt.status : 'none';
  const late = !!attempt && !attempt.paper && attempt.submittedAt > assignment.dueAt;
  const overdue = state === 'none' && nowMs > parseLocalDateTime(assignment.dueAt);
  return { state, late, overdue };
}

export function checkGrade({ verdict, points, comment }, { maxPoints }) {
  const problems = [];
  if (verdict !== 'checked' && verdict !== 'returned') {
    problems.push({ field: 'verdict', code: 'bad_value' });
    return problems;
  }
  if (verdict === 'checked') {
    if (!isInt(points) || points < 0 || points > maxPoints) problems.push({ field: 'points', code: 'bad_value' });
  } else {
    if (points !== null && points !== undefined) problems.push({ field: 'points', code: 'bad_value' });
    if (typeof comment !== 'string' || comment.trim() === '') problems.push({ field: 'comment', code: 'empty' });
  }
  if (comment !== undefined && comment !== null && (typeof comment !== 'string' || comment.length > WORK.commentMax)) {
    if (!problems.some((p) => p.field === 'comment')) problems.push({ field: 'comment', code: 'too_long' });
  }
  return problems;
}

// Self-work points of one unit counted from its assignments. earned/max in points of the assignments, value in points of the scheme.
export function selfByWork({ assignments, attemptOf, nowMs, self }) {
  if (!assignments || assignments.length === 0) return null;
  let earned = 0;
  let max = 0;
  let pending = 0;
  for (const a of assignments) {
    const attempt = attemptOf.get(a.id) || null;
    max += a.maxPoints;
    if (!attempt) {
      if (!(nowMs > parseLocalDateTime(a.dueAt))) pending += 1;
    } else if (attempt.status === 'checked') {
      earned += attempt.points || 0;
    } else {
      pending += 1;
    }
  }
  return { earned, max, pending, value: max > 0 ? Math.round((earned * self) / max) : null };
}

export function taskCounts(tasks, nowMs) {
  const tomorrow = addDays(localDate(nowMs), 1);
  const counts = { fresh: 0, soon: 0, overdue: 0, returned: 0 };
  for (const t of tasks) {
    if (t.state === 'returned') counts.returned += 1;
    if (t.state !== 'none') continue;
    if (nowMs > parseLocalDateTime(t.dueAt)) {
      counts.overdue += 1;
    } else {
      counts.fresh += 1;
      if (t.dueAt.slice(0, 10) <= tomorrow) counts.soon += 1;
    }
  }
  return counts;
}

// Points of the journal: of a pair, current control, unit total, attendance. Pure functions; nothing is stored.
import { ATTENDED_STATUSES, FIXED_STATUSES } from './schema.js';

const isFixed = (pair) => FIXED_STATUSES.includes(pair.status);
const cap = (value, max) => (value === null || value === undefined ? null : Math.min(value, max));

export function firstPairId(pairs) {
  const live = (pairs || []).filter((p) => ['planned', 'running', 'closed'].includes(p.status));
  let best = null;
  for (const p of live) {
    if (!best || p.date < best.date || (p.date === best.date && (p.slot < best.slot || (p.slot === best.slot && p.id < best.id)))) best = p;
  }
  return best ? best.id : '';
}

export function pairPoints(mark, pair, scheme) {
  if (!mark || !isFixed(pair) || pair.lessonType === 'control') return null;
  if (mark.status === 'excused') return null;
  const possible = pair.first ? scheme.attendance : scheme.attendance + scheme.activity;
  if (!ATTENDED_STATUSES.includes(mark.status)) return { earned: 0, possible };
  const activity = pair.first ? 0 : Math.min(Math.max(Number(mark.activity) || 0, 0), scheme.activity);
  return { earned: scheme.attendance + activity, possible };
}

export function currentControl(points, scheme) {
  let earned = 0;
  let possible = 0;
  for (const p of points) {
    earned += p.earned;
    possible += p.possible;
  }
  return possible > 0 ? Math.round((earned / possible) * scheme.current) : null;
}

export function unitTotal({ current, self, control }) {
  if (current === null || current === undefined || self === null || self === undefined || control === null || control === undefined) return null;
  return current + self + control;
}

export function gradeWord(total, scheme) {
  if (total === null || total === undefined) return null;
  if (total >= scheme.excellent) return 'excellent';
  if (total >= scheme.good) return 'good';
  if (total >= scheme.fair) return 'fair';
  return 'fail';
}

export function attendanceStats(items) {
  const stats = { marked: items.length, attended: 0, late: 0, absent: 0, excused: 0, madeup: 0, noCoat: 0, percent: null };
  for (const it of items) {
    if (ATTENDED_STATUSES.includes(it.status)) stats.attended += 1;
    if (it.status === 'late') stats.late += 1;
    if (it.status === 'absent') stats.absent += 1;
    if (it.status === 'excused') stats.excused += 1;
    if (it.status === 'madeup') stats.madeup += 1;
    if (it.noCoat) stats.noCoat += 1;
  }
  if (stats.marked > 0) stats.percent = Math.round((stats.attended / stats.marked) * 100);
  return stats;
}

const sumPoints = (list) => list.reduce((acc, p) => ({ earned: acc.earned + p.earned, possible: acc.possible + p.possible }), { earned: 0, possible: 0 });
const num = (v) => (v === null || v === undefined ? null : Number(v));

export function studentResults({ pairs, marks, unitRows, units, scheme }) {
  const held = pairs.filter(isFixed);
  const pointsOf = (list) => list.map((p) => pairPoints(marks.get(p.id) || null, p, scheme)).filter((x) => x !== null);
  const totals = [];
  const result = units.map((unit) => {
    const points = pointsOf(held.filter((p) => p.unit === unit));
    const { earned, possible } = sumPoints(points);
    const row = unitRows.get(unit) || null;
    const auto = currentControl(points, scheme);
    const manual = cap(num(row && row.currentManual), scheme.current);
    const current = manual !== null ? manual : auto;
    const self = cap(num(row && row.self), scheme.self);
    const control = cap(num(row && row.control), scheme.control);
    const total = unitTotal({ current, self, control });
    if (total !== null) totals.push(total);
    return {
      unit, earned, possible, auto, manual, current, self, control, total, word: gradeWord(total, scheme),
      currentLow: current !== null && current < scheme.minimum,
      controlLow: control !== null && control < scheme.minimum,
    };
  });
  const outside = sumPoints(pointsOf(held.filter((p) => p.unit === null || p.unit === undefined)));
  const preliminary = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : null;
  const items = held.filter((p) => marks.has(p.id)).map((p) => marks.get(p.id));
  return { units: result, outside, preliminary, word: gradeWord(preliminary, scheme), attendance: attendanceStats(items) };
}

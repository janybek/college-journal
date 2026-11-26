// 'dir.progress': the progress of a group or a discipline for its card. Read-only; the numbers come from the journal of each subject (progressData.js).
import { AppError } from '../core/errors.js';
import { readSettings } from '../core/settings.js';
import { compareNames } from '../core/names.js';
import { PROGRESS_TABLES, figuresOf, meanOf, stateCounts } from '../core/progress.js';
import { EXAM_SHEETS, PROGRESS_SHEETS, halfOf, readSheets, subjectProgress } from './progressData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ZERO = { risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 };

// The figures of one subject: `active` are the students who have not left; a subject outside the current half has none.
function figuresOfSubject(rows, platform, subject, user, settings) {
  const half = halfOf(rows, subject, settings);
  if (half === null) return { subject, inHalf: false, progress: null, active: [], attendance: null, average: null, counts: { ...ZERO } };
  const progress = subjectProgress(rows, platform, subject, user);
  const active = progress.students.filter((s) => !s.left);
  const figures = figuresOf(active);
  return { subject, inHalf: true, progress, active, attendance: figures.attendance.percent, average: figures.average, counts: stateCounts(active.map((s) => s.state)) };
}

function groupProgress(rows, platform, user, group, settings) {
  const subjects = rows.subjects.filter((s) => s.groupId === group.id)
    .sort((a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id))
    .map((s) => figuresOfSubject(rows, platform, s, user, settings));
  const students = rows.students.filter((s) => s.groupId === group.id && s.active === true)
    .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));
  const mine = new Map(students.map((s) => [s.id, []]));
  const all = [];
  for (const item of subjects) {
    for (const entry of item.active) {
      if (!mine.has(entry.id)) continue;
      mine.get(entry.id).push(entry);
      all.push(entry);
    }
  }
  const perStudent = students.map((s) => ({ id: s.id, ...figuresOf(mine.get(s.id)) }));
  const total = figuresOf(all);
  return {
    table: 'groups', id: group.id, semester: settings.semester,
    totals: { attendance: total.attendance.percent, average: total.average, risk: perStudent.filter((f) => f.risk > 0).length },
    subjects: subjects.map((i) => ({ subjectId: i.subject.id, inHalf: i.inHalf, attendance: i.attendance, average: i.average, counts: i.counts })),
    students: perStudent.map((f) => ({ id: f.id, attendance: f.attendance.percent, average: f.average })),
  };
}

function disciplineProgress(rows, platform, user, discipline, settings) {
  const groupName = new Map(rows.groups.map((g) => [g.id, g.name]));
  const items = rows.subjects.filter((s) => s.disciplineId === discipline.id)
    .sort((a, b) => compareNames(groupName.get(a.groupId) || '', groupName.get(b.groupId) || '') || cmp(a.id, b.id))
    .map((s) => figuresOfSubject(rows, platform, s, user, settings));
  const lines = items.map((i) => ({
    subjectId: i.subject.id, groupId: i.subject.groupId, inHalf: i.inHalf,
    students: rows.students.filter((s) => s.groupId === i.subject.groupId && s.active === true).length,
    attendance: i.attendance, average: i.average, counts: i.counts,
    units: i.inHalf ? i.progress.units.map((unit) => ({ unit, closed: i.progress.closedUnits.includes(unit) })) : [],
  }));
  const inHalf = items.filter((i) => i.inHalf);
  const pooled = figuresOf(inHalf.flatMap((i) => i.active));
  const numbers = [...new Set(inHalf.flatMap((i) => i.progress.units))].sort((a, b) => a - b);
  const units = numbers.map((unit) => {
    const own = inHalf.filter((i) => i.progress.units.includes(unit));
    const totals = [];
    for (const i of own) for (const s of i.active) for (const u of s.units) if (u.unit === unit && u.total !== null) totals.push(u.total);
    return { unit, groups: own.length, closedGroups: own.filter((i) => i.progress.closedUnits.includes(unit)).length, average: meanOf(totals) };
  });
  return {
    table: 'disciplines', id: discipline.id, semester: settings.semester,
    totals: { groups: lines.length, attendance: pooled.attendance.percent, average: pooled.average, risk: lines.reduce((sum, l) => sum + l.counts.risk, 0) },
    rows: lines, units,
  };
}

export function dirProgress(store, platform, user, data) {
  const input = data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {};
  if (typeof input.table !== 'string' || !PROGRESS_TABLES.includes(input.table)) throw new AppError('bad_request');
  if (typeof input.id !== 'string' || input.id === '') throw new AppError('bad_request');
  const { table, id } = input;
  const rows = readSheets(store, [...PROGRESS_SHEETS, ...EXAM_SHEETS, ...(table === 'disciplines' ? ['disciplines'] : [])]);
  const record = rows[table].find((r) => r.id === id);
  if (!record) throw new AppError('not_found');
  const settings = readSettings(rows.settings);
  return table === 'groups' ? groupProgress(rows, platform, user, record, settings) : disciplineProgress(rows, platform, user, record, settings);
}

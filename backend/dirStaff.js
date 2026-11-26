// The staff of the directories: the list with what each leads, the card with the subjects, unfilled pairs and units, and the week. Read-only.
// The numbers are the ones of the journal (progressData.js); the new rules are in core/progress.js.
import { AppError } from '../core/errors.js';
import { localDate, localTime, mondayOf, addDays } from '../core/dates.js';
import { readSettings, readExtra } from '../core/settings.js';
import { readScheme } from '../core/scoring.js';
import { compareNames } from '../core/names.js';
import { isSubstitution } from '../core/schedule.js';
import { mainLine } from '../core/disciplineSyllabus.js';
import { pairEnd, syllabusState } from '../core/dirInfo.js';
import { hoursOf, roleList, unfilledPair, unitGap } from '../core/progress.js';
import { halfOf, readSheets, subjectProgress } from './progressData.js';
import { pairUnitClosed } from './journalData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function staffList(store, platform, user) {
  const rows = readSheets(store, ['staff', 'subjects', 'weekTemplate']);
  const template = new Map();
  for (const w of rows.weekTemplate) template.set(w.subjectId, (template.get(w.subjectId) || 0) + 1);
  return {
    table: 'staff',
    rows: rows.staff.map((person) => {
      const mine = rows.subjects.filter((s) => s.teacherId === person.id);
      return {
        id: person.id,
        subjects: [...new Set(mine.map((s) => s.name))].sort(compareNames),
        weekPairs: mine.reduce((sum, s) => sum + (template.get(s.id) || 0), 0),
      };
    }),
  };
}

const TEACHER_SHEETS = ['subjects', 'groups', 'rooms', 'weekTemplate', 'pairs', 'settings', 'syllabi', 'syllabusLines', 'students', 'topics',
  'attendance', 'unitResults', 'assignments', 'submissions', 'closures'];

export function staffCard(store, platform, user, id, from) {
  const staff = store.list('staff');
  const person = staff.find((p) => p.id === id);
  if (!person) throw new AppError('not_found');
  const nowMs = platform.now();
  const today = localDate(nowMs);
  const head = {
    table: 'staff', today, time: localTime(nowMs), semester: null,
    person: { id: person.id, fullName: person.fullName, roles: roleList(person.roles), active: person.active === true },
    teacher: null,
  };
  if (!head.person.roles.includes('teacher')) return head;
  const rows = readSheets(store, TEACHER_SHEETS);
  rows.staff = staff;
  const settings = readSettings(rows.settings);
  const extra = readExtra(rows.settings);
  const scheme = readScheme(rows.settings);
  const { time } = head;
  const viewer = { id: user.id, roles: Array.isArray(user.roles) ? user.roles : [] };
  const groupName = new Map(rows.groups.map((g) => [g.id, g.name]));
  const roomName = new Map(rows.rooms.map((r) => [r.id, r.name]));
  const subjects = new Map(rows.subjects.map((s) => [s.id, s]));
  const template = new Map();
  for (const w of rows.weekTemplate) template.set(w.subjectId, (template.get(w.subjectId) || 0) + 1);
  const gname = (groupId) => groupName.get(groupId) || '';

  const mine = rows.subjects.filter((s) => s.teacherId === id);
  const subjectRows = mine.map((s) => ({
    subjectId: s.id, disciplineId: s.disciplineId, name: s.name, groupId: s.groupId, groupName: gname(s.groupId), weekPairs: template.get(s.id) || 0,
    syllabus: s.disciplineId
      ? syllabusState(rows.syllabi, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: settings.semester }, viewer, rows.syllabusLines)
      : { approved: false, open: null },
    responsible: mainLine(rows.syllabusLines, s.disciplineId)?.responsibleId === id,
  })).sort((a, b) => compareNames(a.name, b.name) || compareNames(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));
  const weekPairs = subjectRows.reduce((sum, r) => sum + r.weekPairs, 0);

  const unfilledPairs = rows.pairs
    .filter((p) => p.teacherId === id && unfilledPair(p, { today, time, settings }) && !pairUnitClosed(rows, subjects.get(p.subjectId), p))
    .sort((a, b) => cmp(b.date, a.date) || b.slot - a.slot)
    .map((p) => ({
      pairId: p.id, subjectId: p.subjectId, date: p.date, slot: p.slot, startTime: p.startTime,
      groupName: gname(p.groupId), subjectName: subjects.get(p.subjectId)?.name || '',
    }));

  const unfilledUnits = [];
  for (const s of [...mine].sort((a, b) => compareNames(a.name, b.name) || compareNames(gname(a.groupId), gname(b.groupId)))) {
    if (halfOf(rows, s, settings) === null) continue;
    const progress = subjectProgress(rows, platform, s, user);
    for (const unit of progress.units) {
      const gap = unitGap({ unit, pairs: progress.pairs, closedUnits: progress.closedUnits, students: progress.students, today, time, scheme });
      if (gap) unfilledUnits.push({ subjectId: s.id, name: s.name, groupName: gname(s.groupId), unit: gap.unit, control: gap.control, self: gap.self });
    }
  }

  const monday = from === undefined ? mondayOf(today) : mondayOf(from);
  const to = addDays(monday, 6);
  const pairs = rows.pairs.filter((p) => p.teacherId === id && p.date >= monday && p.date <= to)
    .sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot)
    .map((p) => ({
      id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, endTime: pairEnd(p), status: p.status,
      groupId: p.groupId, groupName: gname(p.groupId), subjectId: p.subjectId, subjectName: subjects.get(p.subjectId)?.name || '',
      roomName: roomName.get(p.roomId) || '', substitution: isSubstitution(p, subjects.get(p.subjectId)),
      moved: p.date !== p.planDate || p.slot !== p.planSlot, planDate: p.planDate, planSlot: p.planSlot,
    }));

  return {
    ...head,
    semester: settings.semester,
    teacher: {
      weekPairs, hours: hoursOf(weekPairs), subjects: subjectRows.length, unfilled: unfilledPairs.length + unfilledUnits.length,
      rows: subjectRows, unfilledPairs, unfilledUnits,
      from: monday, to, bells: settings.bells, exam: { start: extra.examStart, end: extra.examEnd },
      holidays: settings.holidays.filter((d) => d >= monday && d <= to), pairs,
    },
  };
}

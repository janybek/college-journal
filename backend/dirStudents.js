// The students of the directories: the list with attendance and average, the card with subjects, works, debts and repeats. Read-only.
// The numbers are the ones of the journal (progressData.js) and of the past halves (repeatSnapshot.js); the new rules are in core/progress.js.
import { AppError } from '../core/errors.js';
import { localDate } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { compareNames } from '../core/names.js';
import { currentAttempt, workState } from '../core/work.js';
import { debtOf, figuresOf, meanOf, workCounts } from '../core/progress.js';
import { EXAM_SHEETS, PROGRESS_SHEETS, halfOf, readSheets, subjectProgress } from './progressData.js';
import { halfResults, halvesOf } from './repeatSnapshot.js';
import { studentRepeats } from './repeatData.js';
import { isCurrent } from './workData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id);

// The subjects of the group of the student that count in the current half, each counted once.
function halfSubjects(rows, platform, user, settings, groupId) {
  return rows.subjects.filter((s) => s.groupId === groupId && halfOf(rows, s, settings) !== null).sort(byName)
    .map((subject) => ({ subject, progress: subjectProgress(rows, platform, subject, user) }));
}

// The row of the student in the subject; a student who is not in the journal (switched off, no marks) has an empty one.
function rowOf(progress, studentId) {
  return progress.students.find((x) => x.id === studentId) || {
    id: studentId, left: true, units: progress.units.map((unit) => ({ unit, total: null, control: null, self: null })),
    semester: null, attendance: { marked: 0, attended: 0, absent: 0, percent: null }, state: 'going', total: null,
  };
}

// The list takes from the subjects only the risk, the attendance and the average; the final sheets (EXAM_SHEETS) are not read here:
// the state and the total of a closed final sheet may be wrong in this count, and the risk is not affected by them.
export function studentsList(store, platform, user) {
  const rows = readSheets(store, PROGRESS_SHEETS);
  const settings = readSettings(rows.settings);
  const byGroup = new Map();
  const subjectsOf = (groupId) => {
    if (!byGroup.has(groupId)) byGroup.set(groupId, halfSubjects(rows, platform, user, settings, groupId));
    return byGroup.get(groupId);
  };
  return {
    table: 'students', semester: settings.semester,
    rows: rows.students.map((student) => {
      const figures = figuresOf(subjectsOf(student.groupId).map((item) => rowOf(item.progress, student.id)));
      return { id: student.id, attendance: figures.attendance.percent, average: figures.average, risk: figures.risk };
    }),
  };
}

// Assignments of the subjects of the group (any half) in the counts of the student.
function worksOf(rows, student, settings, nowMs) {
  const out = [];
  for (const subject of rows.subjects.filter((s) => s.groupId === student.groupId)) {
    const items = [];
    for (const a of rows.assignments) {
      if (a.subjectId !== subject.id || !isCurrent(a, settings)) continue;
      const attempt = currentAttempt(rows.submissions.filter((x) => x.assignmentId === a.id && x.studentId === student.id));
      items.push(workState(a, attempt, nowMs));
    }
    const counts = workCounts(items);
    if (counts.checked + counts.submitted + counts.returned + counts.missing > 0) out.push({ id: subject.id, subjectId: subject.id, name: subject.name, ...counts });
  }
  return out.sort(byName).map(({ id, ...rest }) => rest);
}

// The past halves with a closed final sheet that ended badly, unless a repeat card has passed (core/progress.js debtOf).
function debtsOf(rows, platform, user, student, settings) {
  const traced = new Set();
  const pairSubject = new Map(rows.pairs.map((p) => [p.id, p.subjectId]));
  for (const r of rows.attendance) if (r.studentId === student.id && pairSubject.has(r.pairId)) traced.add(pairSubject.get(r.pairId));
  for (const r of rows.unitResults) if (r.studentId === student.id) traced.add(r.subjectId);
  for (const r of rows.examAttempts) if (r.studentId === student.id) traced.add(r.subjectId);
  const groupName = new Map(rows.groups.map((g) => [g.id, g.name]));
  const out = [];
  // The ledger lists every active student of the group, with or without marks; a student without a trace is added to the past half
  // by an empty unit row (all fields empty), so halfResults counts him by the same rules and halfResults itself stays as it is.
  const own = (subject) => student.active === true && subject.groupId === student.groupId;
  const empty = (subject, planSemester) => ({ ...rows, unitResults: [...rows.unitResults, {
    subjectId: subject.id, studentId: student.id, planSemester, unit: 0, control: null, self: null, currentManual: null, updatedBy: '', updatedAt: '',
  }] });
  for (const subject of rows.subjects.filter((s) => traced.has(s.id) || own(s))) {
    const now = halfOf(rows, subject, settings);
    for (const half of halvesOf(rows, subject)) {
      if (half.current || half.planSemester === (now ? now.planSemester : undefined)) continue;
      const base = traced.has(subject.id) || !own(subject) ? rows : empty(subject, half.planSemester);
      const row = halfResults(base, platform, subject, half.planSemester, user).students.find((x) => x.id === student.id);
      if (!row) continue;
      const cards = rows.repeats.filter((c) => c.studentId === student.id && c.subjectId === subject.id && c.planSemester === half.planSemester);
      const debt = debtOf(row, cards);
      if (debt) out.push({ subjectId: subject.id, name: subject.name, groupName: groupName.get(subject.groupId) || '', planSemester: half.planSemester, ...debt });
    }
  }
  return out.sort((a, b) => compareNames(a.name, b.name) || a.planSemester - b.planSemester || cmp(a.subjectId, b.subjectId));
}

export function studentCard(store, platform, user, id) {
  const rows = readSheets(store, [...PROGRESS_SHEETS, ...EXAM_SHEETS, 'repeats', 'repeatAttempts']);
  const student = rows.students.find((r) => r.id === id);
  if (!student) throw new AppError('not_found');
  const settings = readSettings(rows.settings);
  const staffName = new Map(rows.staff.map((r) => [r.id, r.fullName]));
  const group = rows.groups.find((g) => g.id === student.groupId);
  const items = halfSubjects(rows, platform, user, settings, student.groupId).map(({ subject, progress }) => ({ subject, progress, row: rowOf(progress, student.id) }));
  const figures = figuresOf(items.map((i) => i.row));
  const repeats = studentRepeats(rows, platform, student.id);
  const debts = debtsOf(rows, platform, user, student, settings);
  return {
    table: 'students', today: localDate(platform.now()), semester: settings.semester,
    student: { id: student.id, fullName: student.fullName, cardNo: student.cardNo, groupId: student.groupId, groupName: group ? group.name : '', active: student.active === true },
    totals: { attendance: figures.attendance.percent, absent: figures.attendance.absent, average: figures.average, risk: figures.risk, repeats: repeats.length, debts: debts.length },
    subjects: items.map(({ subject, progress, row }) => ({
      subjectId: subject.id, name: subject.name, teacherName: staffName.get(subject.teacherId) || '', planSemester: progress.planSemester,
      attendance: { percent: row.attendance.percent, absent: row.attendance.absent, marked: row.attendance.marked },
      units: row.units.map((u) => ({ unit: u.unit, total: u.total })),
      average: meanOf(row.units.map((u) => u.total).filter((t) => t !== null)), state: row.state, total: row.total,
    })),
    works: worksOf(rows, student, settings, platform.now()),
    debts, repeats,
  };
}

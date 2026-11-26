// The syllabus of a discipline on the server: which line a version is on, what a person is on it, where a new draft goes and the view of the line
// for the screens. Pure functions over rows the request has already read (the only writes are the ones of openLine). No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { compareNames } from '../core/names.js';
import { localDateTime } from '../core/dates.js';
import { draftTarget, lineSubjects, partOf, teacherSubjects } from '../core/disciplineSyllabus.js';

export const LINE_TABLES = ['syllabusLines'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameMap = (rows) => new Map((rows || []).map((r) => [r.id, r]));
const HALVES = [1, 2];

// The line of a version; a version with no line (or with a line that is not there) is not found.
export function lineOfVersion(lines, version) {
  const line = version && version.lineId ? (lines || []).find((l) => l.id === version.lineId) : undefined;
  if (!line) throw new AppError('not_found');
  return line;
}

// What rightsOn needs to know about the person: the id, the roles, the place on the line and whether the line is only a history.
export function viewerOf(user, line, subjects, lines) {
  return { id: user.id, roles: user.roles, part: partOf(line, user.id, subjects, lines), archived: line.kind === 'archived' };
}

export const isManagerUser = (user) => user.roles.includes('admin') || user.roles.includes('dean');

// Who works on a version: the deanery, the administrator and the responsible teacher. Nobody works on a line of the history.
export function worksOn(viewer) {
  if (viewer.archived === true) return false;
  const roles = Array.isArray(viewer.roles) ? viewer.roles : [];
  if (roles.includes('admin') || roles.includes('dean')) return true;
  return roles.includes('teacher') && viewer.part === 'responsible';
}

// true: the groups of more than one teacher follow the line in this half (the errors name the group then).
export function manyTeachers(subjects, line, lines, half) {
  return new Set(lineSubjects(subjects, line, lines, half).map((s) => s.teacherId)).size > 1;
}

// The groups of the line for a page of the version: the deanery, the administrator and the prorector see every group of the line (the teacher is named
// when there is more than one), a teacher only his own. rows: { subjects, groups, staff, syllabusLines }; the subject of the page is always there.
export function lineGroups(rows, line, user, half, subject = null) {
  const all = user.roles.some((r) => ['admin', 'dean', 'prorector'].includes(r));
  const taught = all ? lineSubjects(rows.subjects, line, rows.syllabusLines, half) : teacherSubjects(rows.subjects, line.disciplineId, user.id);
  const list = subject && !taught.some((s) => s.id === subject.id) ? [...taught, subject] : taught;
  const named = all && manyTeachers(rows.subjects, line, rows.syllabusLines, half);
  const groups = nameMap(rows.groups);
  const staff = nameMap(rows.staff);
  return list.map((s) => ({
    subjectId: s.id, groupName: (groups.get(s.groupId) || { name: '' }).name,
    ...(named ? { teacherName: (staff.get(s.teacherId) || { fullName: '' }).fullName } : {}),
  })).sort((a, b) => cmp(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));
}

// [{ name, course }]: the groups that follow the line in this half, from sheets the request has already read.
export function groupsOfLine(line, lines, subjects, groups, half) {
  const ids = new Set(lineSubjects(subjects, line, lines, half).map((s) => s.groupId));
  return (groups || []).filter((g) => ids.has(g.id)).map((g) => ({ name: g.name, course: g.course }));
}

// The line where a new draft of the half goes (draftTarget); the line is made, or the responsible is written into it, when needed.
// rows: { syllabusLines, syllabi, subjects } as read by the request; rows.syllabusLines is updated, so the caller may go on with the same object.
// An error of draftTarget is thrown with its own code ('forbidden', 'choose_first'). -> the row of the line
export function openLine(store, platform, { disciplineId, teacherId, semester }, user, rows) {
  const target = draftTarget(rows.syllabusLines, rows.syllabi, rows.subjects, { disciplineId, teacherId, semester }, user);
  if (target.code !== 'ok') throw new AppError(target.code);
  if (target.make) {
    const [line] = store.insertMany('syllabusLines', [{
      disciplineId, kind: 'main', semester: null, teacherId: '', responsibleId: target.make.responsibleId, dueDate: '', reviewDue: '',
      createdBy: user.id, createdAt: localDateTime(platform.now()),
    }]);
    rows.syllabusLines = [...rows.syllabusLines, line];
    return line;
  }
  if (target.claim) {
    const [line] = store.updateMany('syllabusLines', [{ id: target.line.id, patch: { responsibleId: user.id } }]);
    rows.syllabusLines = rows.syllabusLines.map((l) => (l.id === line.id ? line : l));
    return line;
  }
  return target.line;
}

// The view of the line. rows: { syllabusLines, subjects, staff, groups }. A student gets only the teacher of the subject of his group (subject).
export function lineView(rows, line, user, subject = null) {
  const staff = nameMap(rows.staff);
  const nameOf = (id) => (staff.get(id) || { fullName: '' }).fullName;
  if (user.kind === 'student') return { teachers: subject ? [{ fullName: nameOf(subject.teacherId) }] : [] };

  const groups = nameMap(rows.groups);
  const followers = new Map();
  for (const half of HALVES) for (const s of lineSubjects(rows.subjects, line, rows.syllabusLines, half)) followers.set(s.id, s);
  const byTeacher = new Map();
  for (const s of followers.values()) {
    if (!byTeacher.has(s.teacherId)) byTeacher.set(s.teacherId, []);
    byTeacher.get(s.teacherId).push((groups.get(s.groupId) || { name: '' }).name);
  }
  const teachers = [...byTeacher].map(([id, names]) => ({ id, fullName: nameOf(id), groups: names.sort(compareNames) }))
    .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));
  return {
    id: line.id, disciplineId: line.disciplineId, kind: line.kind, responsibleId: line.responsibleId || '', responsibleName: nameOf(line.responsibleId),
    teachers, mine: partOf(line, user.id, rows.subjects, rows.syllabusLines),
  };
}

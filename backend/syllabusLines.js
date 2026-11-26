// The syllabus of a discipline on the server: which line a version is on, what a person is on it, where a new draft goes and the view of the line
// for the screens. Functions over rows the request has already read; the writes are those of openLine, assignResponsible and setReviewDue. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { compareNames } from '../core/names.js';
import { isDate, localDateTime } from '../core/dates.js';
import { plainId } from '../core/syllabusSections.js';
import { draftTarget, lineSubjects, mainLine, partOf, reviewRows, teacherSubjects, waitingHalves } from '../core/disciplineSyllabus.js';
import { rolesOf } from './users.js';

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
  const waiting = waitingHalves(rows.syllabusLines, line.disciplineId);
  const manager = isManagerUser(user);
  return {
    id: line.id, disciplineId: line.disciplineId, kind: line.kind, responsibleId: line.responsibleId || '', responsibleName: nameOf(line.responsibleId),
    dueDate: line.dueDate || '', reviewDue: line.reviewDue || '', waiting,
    teachers, mine: partOf(line, user.id, rows.subjects, rows.syllabusLines),
    can: { assign: manager, setReviewDue: manager, choose: manager && waiting.length > 0 },
  };
}

const isDay = (value) => value === '' || isDate(value);
const isManagerRoles = (user) => Array.isArray(user.roles) && (user.roles.includes('admin') || user.roles.includes('dean'));

// 'syllabus.assign' { disciplineId, teacherId, dueDate } -> { line }: the responsible for the syllabus of the discipline and the date of its development
// (teacherId '' - nobody; dueDate '' - no date). Writes the 'main' row of the discipline (made when it is not there). «Силлабусы» and «Пары» are not read.
export function assignResponsible(store, platform, data, user) {
  const disciplineId = plainId(data.disciplineId);
  const teacherId = data.teacherId === '' ? '' : plainId(data.teacherId);
  if (disciplineId === null || teacherId === null || typeof data.dueDate !== 'string' || !isDay(data.dueDate)) throw new AppError('bad_request');
  if (!isManagerRoles(user)) throw new AppError('forbidden');
  if (!store.list('disciplines').some((d) => d.id === disciplineId)) throw new AppError('not_found');
  const lines = store.list('syllabusLines');
  if (lines.some((l) => l.kind === 'own' && l.disciplineId === disciplineId)) throw new AppError('choose_first');
  const staff = store.list('staff');
  if (teacherId !== '') {
    const person = staff.find((r) => r.id === teacherId);
    if (!person || person.active === false || !rolesOf(person, 'staff').includes('teacher')) throw new AppError('not_teacher');
  }
  const main = mainLine(lines, disciplineId);
  let line;
  if (main) {
    [line] = store.updateMany('syllabusLines', [{ id: main.id, patch: { responsibleId: teacherId, dueDate: data.dueDate } }]);
  } else {
    [line] = store.insertMany('syllabusLines', [{
      disciplineId, kind: 'main', semester: null, teacherId: '', responsibleId: teacherId, dueDate: data.dueDate, reviewDue: '',
      createdBy: user.id, createdAt: localDateTime(platform.now()),
    }]);
  }
  const after = lines.some((l) => l.id === line.id) ? lines.map((l) => (l.id === line.id ? line : l)) : [...lines, line];
  return { line: lineView({ syllabusLines: after, subjects: store.list('subjects'), staff, groups: store.list('groups') }, line, user) };
}

// 'syllabus.setReviewDue' { lineId, date } -> { line }: the date by which the deanery looks at the versions of the line on approval ('' clears it).
export function setReviewDue(store, platform, data, user) {
  const lineId = plainId(data.lineId);
  if (lineId === null || typeof data.date !== 'string' || !isDay(data.date)) throw new AppError('bad_request');
  if (!isManagerRoles(user)) throw new AppError('forbidden');
  const lines = store.list('syllabusLines');
  const found = lines.find((l) => l.id === lineId);
  if (!found || found.kind === 'archived') throw new AppError('not_found');
  if (reviewRows(store.list('syllabi'), found.id).length === 0) throw new AppError('syllabus_locked');
  const [line] = store.updateMany('syllabusLines', [{ id: found.id, patch: { reviewDue: data.date } }]);
  const after = lines.map((l) => (l.id === line.id ? line : l));
  return { line: lineView({ syllabusLines: after, subjects: store.list('subjects'), staff: store.list('staff'), groups: store.list('groups') }, line, user) };
}

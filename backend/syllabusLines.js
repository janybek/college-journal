// The line of a syllabus version on the server: which line a version is on, what a person is on it, and the view of the line for the screens.
// Pure functions over rows the request has already read. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { compareNames } from '../core/names.js';
import { invitedOf, isLive, joinedLineId, joinedOf, lineSubjects, partOf, teacherSubjects, teachingOf } from '../core/syllabusLines.js';

export const LINE_TABLES = ['syllabusLines', 'syllabusMembers'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rolesOf = (row) => String(row.roles ?? '').split(',').map((r) => r.trim());
const nameMap = (rows) => new Map((rows || []).map((r) => [r.id, r]));

// The line of a version; a version with no line (or with a line that is not there) is not found.
export function lineOfVersion(lines, version) {
  const line = version && version.lineId ? (lines || []).find((l) => l.id === version.lineId) : undefined;
  if (!line) throw new AppError('not_found');
  return line;
}

// What rightsOn needs to know about the person: the id, the roles, whether they teach the discipline of the line now and their place on the line.
export function viewerOf(user, line, members, subjects) {
  const teaches = (subjects || []).some((s) => s.disciplineId === line.disciplineId && s.teacherId === user.id);
  return { id: user.id, roles: user.roles, teaches, part: partOf(line, members, user.id) };
}

export const isManagerUser = (user) => user.roles.includes('admin') || user.roles.includes('dean');

// Who works on a version (the deanery, the administrator, a teacher of the discipline who is the author or a member of the line).
export function worksOn(viewer) {
  const roles = Array.isArray(viewer.roles) ? viewer.roles : [];
  if (roles.includes('admin') || roles.includes('dean')) return true;
  return roles.includes('teacher') && viewer.teaches === true && (viewer.part === 'author' || viewer.part === 'member');
}

// The groups of the line for a page of the version: the deanery, the administrator and the prorector see every group of the line
// (a shared line also names the teacher), a teacher only his own. rows: { subjects, groups, staff }; the subject of the page is always there.
export function lineGroups(rows, line, members, user, subject = null) {
  const all = user.roles.some((r) => ['admin', 'dean', 'prorector'].includes(r));
  const taught = all ? lineSubjects(rows.subjects, line, members) : teacherSubjects(rows.subjects, line.disciplineId, user.id);
  const list = subject && !taught.some((s) => s.id === subject.id) ? [...taught, subject] : taught;
  const shared = all && teachingOf(members, line, rows.subjects).length > 1;
  const groups = nameMap(rows.groups);
  const staff = nameMap(rows.staff);
  return list.map((s) => ({
    subjectId: s.id, groupName: (groups.get(s.groupId) || { name: '' }).name,
    ...(shared ? { teacherName: (staff.get(s.teacherId) || { fullName: '' }).fullName } : {}),
  })).sort((a, b) => cmp(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));
}

// [{ name, course }]: the groups where the line is led now, from sheets the request has already read.
export function groupsOfLine(line, members, subjects, groups) {
  const ids = new Set(lineSubjects(subjects, line, members).map((s) => s.groupId));
  return (groups || []).filter((g) => ids.has(g.id)).map((g) => ({ name: g.name, course: g.course }));
}

// The view of the line. rows: { syllabusLines, syllabusMembers, subjects, staff, groups }.
export function lineView(rows, line, user) {
  const members = rows.syllabusMembers;
  const teaching = teachingOf(members, line, rows.subjects);
  const staff = nameMap(rows.staff);
  const nameOf = (id) => (staff.get(id) || { fullName: '' }).fullName;
  if (user.kind === 'student') return { shared: teaching.length > 1, teachers: teaching.map((m) => ({ fullName: nameOf(m.teacherId) })) };

  const groups = nameMap(rows.groups);
  const groupsOf = (teacherId) => teacherSubjects(rows.subjects, line.disciplineId, teacherId).map((s) => (groups.get(s.groupId) || { name: '' }).name).sort(compareNames);
  const joined = joinedOf(members, line.id);
  const invited = invitedOf(members, line.id);
  const ended = (members || []).filter((m) => m.lineId === line.id && ['left', 'declined', 'withdrawn'].includes(m.state))
    .sort((a, b) => cmp(b.endedAt || '', a.endedAt || '') || cmp(b.id, a.id));
  const mine = partOf(line, members, user.id);
  const viewer = viewerOf(user, line, members, rows.subjects);
  const manager = isManagerUser(user);
  const author = mine === 'author' && viewer.teaches;
  const live = isLive(line, members);
  const can = {
    invite: author && live, add: manager && live, remove: manager || author, withdraw: manager || author,
    leave: (mine === 'author' || mine === 'member') && joined.length > 1, join: mine === 'invited' && live, decline: mine === 'invited',
    setAuthor: manager && joined.length > 0,
  };
  const view = {
    id: line.id, disciplineId: line.disciplineId, semester: line.semester, authorId: line.authorId || '', authorName: nameOf(line.authorId),
    teachers: teaching.map((m) => ({ id: m.teacherId, fullName: nameOf(m.teacherId) })), shared: teaching.length > 1,
    members: joined.map((m) => ({ teacherId: m.teacherId, fullName: nameOf(m.teacherId), author: line.authorId === m.teacherId, joinedAt: m.joinedAt || '', byName: nameOf(m.byId), groups: groupsOf(m.teacherId) })),
    invited: invited.map((m) => ({ teacherId: m.teacherId, fullName: nameOf(m.teacherId), invitedAt: m.invitedAt || '', byName: nameOf(m.byId) })),
    history: ended.map((m) => ({
      teacherId: m.teacherId, fullName: nameOf(m.teacherId), state: m.state, invitedAt: m.invitedAt || '', joinedAt: m.joinedAt || '', endedAt: m.endedAt || '', endedByName: nameOf(m.endedBy),
    })),
    mine, can,
  };
  if (can.invite || can.add) {
    const busy = new Set([...joined, ...invited].map((m) => m.teacherId));
    view.candidates = (rows.staff || [])
      .filter((p) => p.active !== false && rolesOf(p).includes('teacher') && !busy.has(p.id) && teacherSubjects(rows.subjects, line.disciplineId, p.id).length > 0)
      .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id))
      .map((p) => ({ id: p.id, fullName: p.fullName, groups: groupsOf(p.id) }));
  }
  return view;
}

// {} or { shared: true, members: N }: how many teachers lead the line where this teacher leads the discipline now (more than one: shared).
export function sharedMark(members, subjects, { disciplineId, teacherId, semester }) {
  const lineId = joinedLineId(members, { disciplineId, teacherId, semester });
  if (lineId === null) return {};
  const n = teachingOf(members, { id: lineId, disciplineId }, subjects).length;
  return n > 1 ? { shared: true, members: n } : {};
}

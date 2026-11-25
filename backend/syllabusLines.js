// The line of a syllabus version on the server: which line a version is on, what a person is on it, and the view of the line for the screens.
// Pure functions over rows the request has already read. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { compareNames } from '../core/names.js';
import { localDateTime } from '../core/dates.js';
import { plainId } from '../core/syllabusSections.js';
import { rightsOn } from '../core/syllabusFlow.js';
import { invitedOf, isLive, joinedLineId, joinedOf, lineSubjects, partOf, teacherSubjects, teachingOf, versionsOfLine } from '../core/syllabusLines.js';
import { createDraft } from './syllabusDraft.js';

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

// ---- members of a line without a switch: call, withdraw, decline, the author, a ready syllabus of the deanery ----

export const MEMBER_TABLES = ['syllabusLines', 'syllabusMembers', 'subjects', 'staff', 'groups'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const readRows = (store, names) => Object.fromEntries(names.map((n) => [n, store.list(n)]));

// The line of a request: the id is a plain string (else bad_request), the line is there (else not_found).
function requestLine(lines, id) {
  const lineId = plainId(id);
  if (lineId === null) throw new AppError('bad_request');
  const line = lines.find((l) => l.id === lineId);
  if (!line) throw new AppError('not_found');
  return line;
}
const teachesIt = (rows, line, id) => teacherSubjects(rows.subjects, line.disciplineId, id).length > 0;
const isAuthor = (rows, line, user) => partOf(line, rows.syllabusMembers, user.id) === 'author' && teachesIt(rows, line, user.id);

// The line view for the caller after a write; rows are the sheets the request read, with what it wrote.
const answer = (rows, line, user) => ({ line: lineView(rows, rows.syllabusLines.find((l) => l.id === line.id), user) });
const replaced = (list, row) => list.map((x) => (x.id === row.id ? row : x));

// 'syllabus.invite' { lineId, teacherId } -> { line }: the author of the line calls a colleague who teaches the discipline.
export function inviteMember(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const lineId = plainId(d.lineId);
  const teacherId = plainId(d.teacherId);
  if (lineId === null || teacherId === null) throw new AppError('bad_request');
  const rows = readRows(store, MEMBER_TABLES);
  const line = requestLine(rows.syllabusLines, lineId);
  if (!isLive(line, rows.syllabusMembers)) throw new AppError('not_found');
  if (!isAuthor(rows, line, user)) throw new AppError('forbidden');
  const target = rows.staff.find((p) => p.id === teacherId);
  if (!target || target.active === false || !rolesOf(target).includes('teacher') || !teachesIt(rows, line, teacherId)) throw new AppError('not_teaching');
  if (partOf(line, rows.syllabusMembers, teacherId) !== null) throw new AppError('already_member');
  const [member] = store.insertMany('syllabusMembers', [{
    lineId: line.id, disciplineId: line.disciplineId, semester: line.semester, teacherId, state: 'invited', byId: user.id,
    invitedAt: localDateTime(platform.now()), joinedAt: '', endedAt: '', endedBy: '',
  }]);
  rows.syllabusMembers = [...rows.syllabusMembers, member];
  return answer(rows, line, user);
}

// 'syllabus.withdraw' { lineId, teacherId } -> { line }: the deanery, the administrator or the author takes back a waiting invitation.
export function withdrawInvite(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const lineId = plainId(d.lineId);
  const teacherId = plainId(d.teacherId);
  if (lineId === null || teacherId === null) throw new AppError('bad_request');
  const rows = readRows(store, MEMBER_TABLES);
  const line = requestLine(rows.syllabusLines, lineId);
  if (!(isManagerUser(user) || isAuthor(rows, line, user))) throw new AppError('forbidden');
  const row = invitedOf(rows.syllabusMembers, line.id).find((m) => m.teacherId === teacherId);
  if (!row) throw new AppError('not_found');
  const [done] = store.updateMany('syllabusMembers', [{ id: row.id, patch: { state: 'withdrawn', endedAt: localDateTime(platform.now()), endedBy: user.id } }]);
  rows.syllabusMembers = replaced(rows.syllabusMembers, done);
  return answer(rows, line, user);
}

// 'syllabus.decline' { lineId } -> { declined: true }: an invited teacher says no.
export function declineInvite(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const lineId = plainId(d.lineId);
  if (lineId === null) throw new AppError('bad_request');
  const line = requestLine(store.list('syllabusLines'), lineId);
  const row = invitedOf(store.list('syllabusMembers'), line.id).find((m) => m.teacherId === user.id);
  if (!row) throw new AppError('forbidden');
  store.updateMany('syllabusMembers', [{ id: row.id, patch: { state: 'declined', endedAt: localDateTime(platform.now()), endedBy: user.id } }]);
  return { declined: true };
}

// 'syllabus.setAuthor' { lineId, teacherId } -> { line }: the deanery or the administrator names a member who leads the line the author.
export function setAuthor(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const lineId = plainId(d.lineId);
  const teacherId = plainId(d.teacherId);
  if (lineId === null || teacherId === null) throw new AppError('bad_request');
  if (!isManagerUser(user)) throw new AppError('forbidden');
  const rows = readRows(store, MEMBER_TABLES);
  const line = requestLine(rows.syllabusLines, lineId);
  if (!joinedOf(rows.syllabusMembers, line.id).some((m) => m.teacherId === teacherId)) throw new AppError('not_found');
  const [done] = store.updateMany('syllabusLines', [{ id: line.id, patch: { authorId: teacherId } }]);
  rows.syllabusLines = replaced(rows.syllabusLines, done);
  return answer(rows, line, user);
}

// 'syllabus.newLine' { disciplineId, semester } -> { lineId, syllabusId }: the deanery starts a syllabus nobody leads yet (an empty draft; people come later).
export function newLine(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const disciplineId = plainId(d.disciplineId);
  if (disciplineId === null || (d.semester !== 1 && d.semester !== 2)) throw new AppError('bad_request');
  if (!isManagerUser(user)) throw new AppError('forbidden');
  if (!store.list('disciplines').some((x) => x.id === disciplineId)) throw new AppError('not_found');
  const syllabi = store.list('syllabi');
  const [line] = store.insertMany('syllabusLines', [{ disciplineId, semester: d.semester, authorId: '', createdBy: user.id, createdAt: localDateTime(platform.now()) }]);
  const { version } = createDraft(store, platform, { line, approved: null, group: null, userId: user.id }, { syllabi });
  return { lineId: line.id, syllabusId: version.id };
}

// 'syllabus.invitations' {} -> { invitations: [row] }: what a teacher is called to, only lines that are alive and disciplines he still teaches.
export function myInvitations(store, platform, user) {
  const rows = readRows(store, MEMBER_TABLES);
  const mine = rows.syllabusMembers.filter((m) => m.state === 'invited' && m.teacherId === user.id);
  if (mine.length === 0) return { invitations: [] };
  const disciplines = nameMap(store.list('disciplines'));
  const syllabi = store.list('syllabi');
  const staff = nameMap(rows.staff);
  const groups = nameMap(rows.groups);
  const nameOf = (id) => (staff.get(id) || { fullName: '' }).fullName;
  const groupName = (s) => (groups.get(s.groupId) || { name: '' }).name;
  const invitations = [];
  for (const m of [...mine].sort((a, b) => cmp(a.invitedAt || '', b.invitedAt || '') || cmp(a.id, b.id))) {
    const line = rows.syllabusLines.find((l) => l.id === m.lineId);
    const own = line ? teacherSubjects(rows.subjects, line.disciplineId, user.id) : [];
    if (!line || !isLive(line, rows.syllabusMembers) || own.length === 0) continue;
    const { approved, open } = versionsOfLine(syllabi, line.id);
    const seen = open && rightsOn(open, { id: user.id, roles: user.roles, teaches: true, part: 'invited' }).see;
    const hisNow = versionsOfLine(syllabi, joinedLineId(rows.syllabusMembers, { disciplineId: line.disciplineId, teacherId: user.id, semester: line.semester })).approved;
    const first = [...own].sort((a, b) => cmp(groupName(a), groupName(b)) || cmp(a.id, b.id))[0];
    invitations.push({
      lineId: line.id, disciplineId: line.disciplineId, disciplineName: (disciplines.get(line.disciplineId) || { name: '' }).name, semester: line.semester,
      authorName: nameOf(line.authorId), byName: nameOf(m.byId), invitedAt: m.invitedAt || '',
      hasApproved: approved !== null, approvedId: approved ? approved.id : '', openId: seen ? open.id : '', subjectId: first.id,
      losesTopics: approved === null && hisNow !== null,
    });
  }
  return { invitations };
}

// {} or { shared: true, members: N }: how many teachers lead the line where this teacher leads the discipline now (more than one: shared).
export function sharedMark(members, subjects, { disciplineId, teacherId, semester }) {
  const lineId = joinedLineId(members, { disciplineId, teacherId, semester });
  if (lineId === null) return {};
  const n = teachingOf(members, { id: lineId, disciplineId }, subjects).length;
  return n > 1 ? { shared: true, members: n } : {};
}

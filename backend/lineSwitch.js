// A teacher moves onto a shared syllabus line: he accepts a call ('syllabus.join') or the deanery adds him at once ('syllabus.add').
// Every sheet is read once, before the first write; the writes go in an order that a repeat of the same request can finish after a break.
// No Node or Apps Script objects here. Imported functions are called only inside functions (backend/syllabusLines.js and syllabusDraft.js import each other).
import { AppError } from '../core/errors.js';
import { localDateTime } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { inSemester } from '../core/topics.js';
import { plainId } from '../core/syllabusSections.js';
import { OPEN_STATUSES } from '../core/schema.js';
import { invitedOf, isLive, joinedLineId, joinedOf, partOf, successor, switchLock, teacherSubjects, teachingOf, versionsOfLine } from '../core/syllabusLines.js';
import { relayout } from './scheduleData.js';
import { closedOfSubject } from './journalData.js';
import { isManagerUser, lineView } from './syllabusLines.js';

export const SWITCH_TABLES = ['syllabusLines', 'syllabusMembers', 'syllabi', 'subjects', 'staff', 'groups', 'topics', 'pairs', 'settings', 'closures', 'subjectExams', 'examAttempts'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const planOf = (version) => (Number.isInteger(version.planSemester) ? version.planSemester : null);

// What stops the teacher from leaving the line `from` for the line `to` (either may be null; at least one is there): per group of his, a closed unit or an exam row
// of the plan semesters of the two approved versions and, when the half of `to` is the current one, of the plan semester his groups follow now.
// rows: syllabi, syllabusMembers, topics, pairs, subjects, groups, closures, subjectExams, examAttempts. -> fields of line_locked ([] - free to go)
export function switchLocks(rows, settings, teacherId, lines) {
  const [from, to] = lines;
  const line = to || from;
  if (!line) return [];
  const names = new Map((rows.groups || []).map((g) => [g.id, g.name]));
  const fields = [];
  for (const subject of teacherSubjects(rows.subjects, line.disciplineId, teacherId)) {
    const planSemesters = new Set();
    for (const l of [from, to]) {
      const approved = l ? versionsOfLine(rows.syllabi, l.id).approved : null;
      if (approved) planSemesters.add(planOf(approved));
    }
    if (to && to.semester === settings.semester) {
      const own = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
      planSemesters.add(closedOfSubject(rows, subject, settings, own).planSemester);
    }
    const code = switchLock(subject.id, planSemesters, rows);
    if (code !== null) fields.push({ field: 'group', code, name: names.get(subject.groupId) ?? '' });
  }
  return fields.sort((a, b) => cmp(a.name, b.name) || cmp(a.code, b.code));
}

// The common part of both requests. `who` is the teacher who moves; `byManager` tells the deanery adds him (no call is needed).
function moveTo(store, platform, d, user, byManager) {
  const lineId = plainId(d.lineId);
  const who = byManager ? plainId(d.teacherId) : user.id;
  if (lineId === null || who === null || (d.confirm !== undefined && typeof d.confirm !== 'boolean')) throw new AppError('bad_request');
  const rows = Object.fromEntries(SWITCH_TABLES.map((n) => [n, store.list(n)]));
  const settings = readSettings(rows.settings);
  const line = rows.syllabusLines.find((l) => l.id === lineId);
  if (!line || !isLive(line, rows.syllabusMembers)) throw new AppError('not_found');
  const members = rows.syllabusMembers;
  const part = partOf(line, members, who);
  if (byManager) {
    if (!isManagerUser(user)) throw new AppError('forbidden');
    if (part === 'author' || part === 'member') throw new AppError('already_member');
  } else if (part === 'author' || part === 'member') throw new AppError('already_member');
  else if (part !== 'invited') throw new AppError('forbidden');
  const person = rows.staff.find((p) => p.id === who);
  const roles = person ? String(person.roles ?? '').split(',').map((r) => r.trim()) : [];
  if (!person || person.active === false || !roles.includes('teacher') || teacherSubjects(rows.subjects, line.disciplineId, who).length === 0) throw new AppError('not_teaching');

  const fromId = joinedLineId(members, { disciplineId: line.disciplineId, teacherId: who, semester: line.semester });
  const from = fromId === null ? null : rows.syllabusLines.find((l) => l.id === fromId) ?? null;
  const locks = switchLocks(rows, settings, who, [from, line]);
  if (locks.length > 0) throw new AppError('line_locked', { fields: locks });
  if (versionsOfLine(rows.syllabi, line.id).approved === null && from && versionsOfLine(rows.syllabi, from.id).approved !== null && d.confirm !== true) {
    throw new AppError('needs_confirm', { fields: [{ field: 'line', code: 'no_approved' }] });
  }

  const now = localDateTime(platform.now());
  const leaving = from ? joinedOf(members, from.id).filter((m) => m.teacherId === who) : [];
  const staying = from ? joinedOf(members, from.id).filter((m) => m.teacherId !== who) : [];
  const entering = invitedOf(members, line.id).find((m) => m.teacherId === who);
  const leftPatch = { state: 'left', endedAt: now, endedBy: user.id };
  const enterPatch = { state: 'joined', joinedAt: now };
  const patches = new Map(leaving.map((m) => [m.id, leftPatch]));
  if (entering) patches.set(entering.id, enterPatch);
  const fresh = entering ? null : {
    lineId: line.id, disciplineId: line.disciplineId, semester: line.semester, teacherId: who, state: 'joined', byId: user.id,
    invitedAt: '', joinedAt: now, endedAt: '', endedBy: '',
  };

  // «Пары»: the layout as it will be when the teacher leads the new line.
  const after = members.map((m) => (patches.has(m.id) ? { ...m, ...patches.get(m.id) } : m));
  const ids = teacherSubjects(rows.subjects, line.disciplineId, who).map((s) => s.id);
  const result = relayout(store, ids, { subjects: rows.subjects, syllabi: rows.syllabi, syllabusMembers: fresh ? [...after, { ...fresh, id: '' }] : after, topics: rows.topics, pairs: rows.pairs, settings }, []);

  // «Силлабусы»: the drafts of a line nobody leads any more go to the archive; the approved version keeps its status.
  const emptied = from !== null && staying.length === 0;
  if (emptied) {
    const open = rows.syllabi.filter((s) => s.lineId === from.id && OPEN_STATUSES.includes(s.status));
    if (open.length > 0) store.updateMany('syllabi', open.map((s) => ({ id: s.id, patch: { status: 'archived' } })));
  }

  // «Линии»: the author who leaves hands the line to the one who joined earliest among those who lead the discipline; nobody of them - the deanery.
  let lines = rows.syllabusLines;
  if (from && from.authorId === who && staying.length > 0) {
    const teaching = new Set(teachingOf(members, from, rows.subjects).map((m) => m.teacherId));
    const authorId = successor(members, from.id, who, teaching) ?? '';
    const [done] = store.updateMany('syllabusLines', [{ id: from.id, patch: { authorId } }]);
    lines = lines.map((l) => (l.id === done.id ? done : l));
  }

  // «Участники»: first «вышел» (and the calls into a line nobody leads are taken back), then «ведёт».
  let written = members;
  const apply = (done) => { const by = new Map(done.map((m) => [m.id, m])); written = written.map((m) => by.get(m.id) ?? m); };
  const firstWrite = [...leaving.map((m) => ({ id: m.id, patch: leftPatch }))];
  if (emptied) firstWrite.push(...invitedOf(members, from.id).map((m) => ({ id: m.id, patch: { state: 'withdrawn', endedAt: now, endedBy: user.id } })));
  if (firstWrite.length > 0) apply(store.updateMany('syllabusMembers', firstWrite));
  if (entering) apply(store.updateMany('syllabusMembers', [{ id: entering.id, patch: enterPatch }]));
  else written = [...written, ...store.insertMany('syllabusMembers', [fresh])];

  const view = lineView({ syllabusLines: lines, syllabusMembers: written, subjects: rows.subjects, staff: rows.staff, groups: rows.groups }, lines.find((l) => l.id === line.id), user);
  return { line: view, changedPairs: result.changed };
}

// 'syllabus.join' { lineId, confirm? } -> { line, changedPairs }: an invited teacher moves onto the line.
export function joinLine(store, platform, data, user) {
  return moveTo(store, platform, isObject(data) ? data : {}, user, false);
}

// 'syllabus.add' { lineId, teacherId, confirm? } -> { line, changedPairs }: the deanery or the administrator puts a teacher on the line at once.
export function addMember(store, platform, data, user) {
  return moveTo(store, platform, isObject(data) ? data : {}, user, true);
}

// A teacher moves onto a shared syllabus line: he accepts a call ('syllabus.join') or the deanery adds him at once ('syllabus.add').
// Every sheet is read once, before the first write; the writes go in an order that a repeat of the same request can finish after a break.
// No Node or Apps Script objects here. Imported functions are called only inside functions (backend/syllabusLines.js and syllabusDraft.js import each other).
import { AppError } from '../core/errors.js';
import { localDateTime } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { NO_LESSON, inSemester } from '../core/topics.js';
import { plainId } from '../core/syllabusSections.js';
import { OPEN_STATUSES } from '../core/schema.js';
import { compareNames } from '../core/names.js';
import { DOC_TABLES } from '../core/syllabusDoc.js';
import { copiesOf } from '../core/syllabusFlow.js';
import { invitedOf, isLive, joinedLineId, joinedOf, partOf, successor, switchLock, teacherSubjects, teachingOf, versionsOfLine } from '../core/syllabusLines.js';
import { relayout, todayOf } from './scheduleData.js';
import { closedOfSubject } from './journalData.js';
import { createDraft } from './syllabusDraft.js';
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
  if (byManager && !isManagerUser(user)) throw new AppError('forbidden');
  if (part === 'author' || part === 'member') throw new AppError('already_member');
  if (!byManager && part !== 'invited') throw new AppError('forbidden');
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

export const LEAVE_TABLES = [...SWITCH_TABLES, 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules'];

// The line a broken exit of the teacher left behind: authored by him, no member rows, and a version made for this exit (a copy of `approved`, draft or already
// approved; without an approved version - a draft with no source) - or no version at all yet. null if there is none.
function unfinishedLine(rows, line, who, approved) {
  const taken = new Set(rows.syllabusMembers.map((m) => m.lineId));
  const made = rows.syllabusLines
    .filter((l) => l.id !== line.id && l.disciplineId === line.disciplineId && l.semester === line.semester && l.authorId === who && !taken.has(l.id))
    .sort((a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.id, b.id));
  const fits = (v) => (approved ? v.sourceId === approved.id && (v.status === 'draft' || v.status === 'approved') : v.status === 'draft' && !v.sourceId);
  for (const l of made) {
    const version = rows.syllabi.filter((v) => v.lineId === l.id && fits(v)).sort((a, b) => cmp(a.version, b.version))[0];
    if (version) return { line: l, version };
  }
  const bare = made.find((l) => !rows.syllabi.some((v) => v.lineId === l.id));
  return bare ? { line: bare, version: null } : null;
}

// The common part of 'syllabus.leave' and 'syllabus.remove': `who` leaves the line, `actor` pressed the button (`byActor`: it is a removal).
// Order of the writes: the new line and the copy, «Пары», the statuses of «Силлабусы», the author of «Линии», «Участники» («вышел», then «ведёт»).
function leaveCore(store, platform, lineId, who, actor, byActor) {
  const rows = Object.fromEntries(LEAVE_TABLES.map((n) => [n, store.list(n)]));
  const settings = readSettings(rows.settings);
  const line = rows.syllabusLines.find((l) => l.id === lineId);
  if (!line || !isLive(line, rows.syllabusMembers)) throw new AppError('not_found');
  const members = rows.syllabusMembers;
  const { approved } = versionsOfLine(rows.syllabi, line.id);

  if (byActor) {
    const author = partOf(line, members, actor.id) === 'author' && teacherSubjects(rows.subjects, line.disciplineId, actor.id).length > 0;
    if (!(isManagerUser(actor) || author)) throw new AppError('forbidden');
    if (who === actor.id) throw new AppError('bad_request');
  }
  const mine = joinedOf(members, line.id).filter((m) => m.teacherId === who);
  const wasHere = mine.length > 0 || members.some((m) => m.lineId === line.id && m.teacherId === who && m.state === 'left');
  const broken = wasHere ? unfinishedLine(rows, line, who, approved) : null;
  if (mine.length === 0 && broken === null) throw new AppError(byActor ? 'not_found' : 'forbidden');
  if (mine.length > 0 && joinedOf(members, line.id).length === 1) throw new AppError('last_member');
  const locks = switchLocks(rows, settings, who, [line, null]);
  if (locks.length > 0) throw new AppError('line_locked', { fields: locks });

  const now = localDateTime(platform.now());
  const today = todayOf(platform);
  const mySubjects = teacherSubjects(rows.subjects, line.disciplineId, who);
  const leftPatch = { state: 'left', endedAt: now, endedBy: actor.id };

  // New: the line and the copy (nobody refers to them yet). The repeat of a broken exit takes the ones that are there.
  let target = broken ? broken.line : null;
  let version = broken ? broken.version : null;
  let written = [];
  if (target === null) [target] = store.insertMany('syllabusLines', [{ disciplineId: line.disciplineId, semester: line.semester, authorId: who, createdBy: actor.id, createdAt: now }]);
  if (version === null) {
    const first = approved ? null : mySubjects.map((s) => ({ s, g: rows.groups.find((x) => x.id === s.groupId) || null }))
      .sort((a, b) => compareNames(a.g ? a.g.name : '', b.g ? b.g.name : '') || cmp(a.s.id, b.s.id))[0];
    const made = createDraft(store, platform, { line: target, approved, group: first ? first.g : null, userId: actor.id }, rows);
    version = made.version;
    written = made.rows.topics || [];
  }
  const copyTopics = written.length > 0 ? written : rows.topics.filter((t) => t.syllabusId === version.id);

  // «Пары»: the pairs on the rows of the approved version move to the copy of their row; the layout is laid as it will be.
  const afterMembers = members.map((m) => (mine.some((x) => x.id === m.id) ? { ...m, ...leftPatch } : m));
  const joinedRow = {
    lineId: target.id, disciplineId: line.disciplineId, semester: line.semester, teacherId: who, state: 'joined', byId: actor.id,
    invitedAt: '', joinedAt: now, endedAt: '', endedBy: '',
  };
  const mineIds = new Set(mySubjects.map((s) => s.id));
  const approvedTopics = approved ? rows.topics.filter((t) => t.syllabusId === approved.id) : [];
  const copies = copiesOf(copyTopics, approvedTopics);
  const old = new Set(approvedTopics.map((t) => t.id));
  const moves = rows.pairs.filter((p) => mineIds.has(p.subjectId) && p.topicId && old.has(p.topicId))
    .map((p) => ({ id: p.id, patch: copies.has(p.topicId) ? { topicId: copies.get(p.topicId).id } : { ...NO_LESSON } }));
  const moved = new Map(moves.map((m) => [m.id, m.patch]));
  const approvedPatch = { status: 'approved', decidedBy: actor.id, decidedAt: today, remark: '' };
  const syllabiAfter = [...rows.syllabi.filter((v) => v.id !== version.id), approved ? { ...version, ...approvedPatch } : version];
  const result = relayout(store, mySubjects.map((s) => s.id), {
    subjects: rows.subjects, syllabi: syllabiAfter, syllabusMembers: [...afterMembers, { ...joinedRow, id: '' }], topics: [...rows.topics, ...written],
    pairs: rows.pairs.map((p) => (moved.has(p.id) ? { ...p, ...moved.get(p.id) } : p)), settings,
  }, moves);

  // «Силлабусы»: the copy becomes approved; what he had approved under his old key goes to the archive when nobody leads that line any more.
  if (approved) {
    const patches = new Map();
    if (version.status !== 'approved') patches.set(version.id, approvedPatch);
    const leftLines = new Set([...members.filter((m) => m.teacherId === who && m.state === 'left').map((m) => m.lineId), line.id]);
    for (const v of rows.syllabi) {
      if (v.id === version.id || v.status !== 'approved' || v.disciplineId !== line.disciplineId || v.teacherId !== who || v.semester !== line.semester) continue;
      if (leftLines.has(v.lineId) && joinedOf(afterMembers, v.lineId).length === 0) patches.set(v.id, { status: 'archived' });
    }
    if (patches.size > 0) store.updateMany('syllabi', [...patches].map(([id, patch]) => ({ id, patch })));
  }

  // «Линии»: the author who leaves hands the line to the one who joined earliest among those who lead the discipline.
  let lines = [...rows.syllabusLines, ...(broken ? [] : [target])];
  if (line.authorId === who) {
    const teaching = new Set(teachingOf(afterMembers, line, rows.subjects).map((m) => m.teacherId));
    const [done] = store.updateMany('syllabusLines', [{ id: line.id, patch: { authorId: successor(afterMembers, line.id, who, teaching) ?? '' } }]);
    lines = lines.map((l) => (l.id === done.id ? done : l));
  }

  // «Участники»: first «вышел», then «ведёт».
  let after = members;
  if (mine.length > 0) {
    const done = new Map(store.updateMany('syllabusMembers', mine.map((m) => ({ id: m.id, patch: leftPatch }))).map((m) => [m.id, m]));
    after = members.map((m) => done.get(m.id) ?? m);
  }
  after = [...after, ...store.insertMany('syllabusMembers', [joinedRow])];
  return {
    rows: { ...rows, syllabusLines: lines, syllabusMembers: after }, line, target, version, copied: approved !== null, changedPairs: result.changed,
  };
}

// 'syllabus.leave' { lineId } -> { lineId (the new one), syllabusId (the copy or the draft), copied, changedPairs }: a teacher leaves the shared line for a line of his own.
export function leaveLine(store, platform, data, user) {
  const lineId = plainId((isObject(data) ? data : {}).lineId);
  if (lineId === null) throw new AppError('bad_request');
  const r = leaveCore(store, platform, lineId, user.id, user, false);
  return { lineId: r.target.id, syllabusId: r.version.id, copied: r.copied, changedPairs: r.changedPairs };
}

// 'syllabus.remove' { lineId, teacherId } -> { line, left: { lineId, syllabusId, copied }, changedPairs }: the author or the deanery takes a teacher off the line.
export function removeMember(store, platform, data, user) {
  const d = isObject(data) ? data : {};
  const lineId = plainId(d.lineId);
  const teacherId = plainId(d.teacherId);
  if (lineId === null || teacherId === null) throw new AppError('bad_request');
  const r = leaveCore(store, platform, lineId, teacherId, user, true);
  const line = lineView(r.rows, r.rows.syllabusLines.find((l) => l.id === lineId), user);
  return { line, left: { lineId: r.target.id, syllabusId: r.version.id, copied: r.copied }, changedPairs: r.changedPairs };
}

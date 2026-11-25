// Shared syllabus lines: who leads a discipline on which line, which rows belong to a line, what blocks a switch,
// and how old versions move onto lines. Pure functions over rows; no storage, no network.
import { versionsIn, versionsOf } from './syllabusFlow.js';

export const LIVE_STATES = ['invited', 'joined'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const by = (field) => (a, b) => cmp(a[field] || '', b[field] || '') || cmp(a.id, b.id);
const rowsOf = (members, lineId, state) => (members || []).filter((m) => m.lineId === lineId && m.state === state);
const sameKey = (m, { disciplineId, teacherId, semester }) => m.disciplineId === disciplineId && m.teacherId === teacherId && m.semester === semester;

// The line where the teacher leads the discipline in this half of the year ('joined'); null if none. Of several: the earlier joinedAt, then id.
export function joinedLineId(members, key) {
  const rows = (members || []).filter((m) => m.state === 'joined' && sameKey(m, key)).sort(by('joinedAt'));
  return rows.length ? rows[0].lineId : null;
}

export const joinedOf = (members, lineId) => rowsOf(members, lineId, 'joined').sort(by('joinedAt'));
export const invitedOf = (members, lineId) => rowsOf(members, lineId, 'invited').sort(by('invitedAt'));

// 'author' | 'member' | 'invited' | null
export function partOf(line, members, teacherId) {
  if (!line || typeof teacherId !== 'string' || teacherId === '') return null;
  if (joinedOf(members, line.id).some((m) => m.teacherId === teacherId)) return line.authorId === teacherId ? 'author' : 'member';
  if (invitedOf(members, line.id).some((m) => m.teacherId === teacherId)) return 'invited';
  return null;
}

// { approved, open, last } of the versions of a line (as versionsOf, but by lineId).
export function versionsOfLine(syllabi, lineId) {
  if (!lineId) return versionsIn([]);
  return versionsIn((syllabi || []).filter((s) => s.lineId === lineId));
}

// The number of a new version: 1 + the greater of the last number on the line and the last number under the old key «discipline + teacher + half».
export function nextVersion(syllabi, lineId, key) {
  return 1 + Math.max(versionsOfLine(syllabi, lineId).last, versionsOf(syllabi, key).last);
}

export function teacherSubjects(subjects, disciplineId, teacherId) {
  return (subjects || []).filter((s) => s.disciplineId === disciplineId && s.teacherId === teacherId);
}

// The subjects of the line's discipline whose teacher leads the line.
export function lineSubjects(subjects, line, members) {
  const leading = new Set(joinedOf(members, line.id).map((m) => m.teacherId));
  return (subjects || []).filter((s) => s.disciplineId === line.disciplineId && leading.has(s.teacherId));
}

// The 'joined' rows of the line whose teacher has a subject of the line's discipline now.
export function teachingOf(members, line, subjects) {
  return joinedOf(members, line.id).filter((m) => teacherSubjects(subjects, line.disciplineId, m.teacherId).length > 0);
}

// The teacher who joined earliest, except the leaving one; teaching - Set of the ids who lead the discipline (null: everybody).
export function successor(members, lineId, leavingId, teaching = null) {
  const next = joinedOf(members, lineId).find((m) => m.teacherId !== leavingId && (teaching === null || teaching.has(m.teacherId)));
  return next ? next.teacherId : null;
}

// Alive: somebody leads it, or nobody has ever led or left it (a ready syllabus of the deanery that waits for people).
export function isLive(line, members) {
  const rows = (members || []).filter((m) => m.lineId === line.id);
  if (rows.some((m) => m.state === 'joined')) return true;
  return !rows.some((m) => m.state === 'left');
}

// Keys «discipline|teacher|half» that have more than one 'joined' row (must be []).
export function oneJoined(members) {
  const count = new Map();
  for (const m of members || []) {
    if (m.state !== 'joined') continue;
    const key = `${m.disciplineId}|${m.teacherId}|${m.semester}`;
    count.set(key, (count.get(key) || 0) + 1);
  }
  return [...count].filter(([, n]) => n > 1).map(([key]) => key).sort();
}

// What stops the subject from switching: a closed unit (not reopened) or an exam row of one of the plan semesters.
// planSemesters: Set (null inside is allowed). -> 'unit_closed' | 'exam_exists' | null
export function switchLock(subjectId, planSemesters, { closures = [], subjectExams = [], examAttempts = [] } = {}) {
  if (!planSemesters || planSemesters.size === 0) return null;
  const inSet = (row) => planSemesters.has(row.planSemester ?? null);
  if (closures.some((c) => c.subjectId === subjectId && !c.reopenedAt && inSet(c))) return 'unit_closed';
  if (subjectExams.some((x) => x.subjectId === subjectId && inSet(x)) || examAttempts.some((x) => x.subjectId === subjectId && inSet(x))) return 'exam_exists';
  return null;
}

// The move of old versions (without lineId) onto lines. -> { groups: [{ key, versionIds, lineId, member }], skipped }
export function linesMigration(syllabi, lines, members) {
  const groups = new Map();
  const skipped = [];
  for (const s of syllabi || []) {
    if (s.lineId) continue;
    if (!s.disciplineId || !s.teacherId || (s.semester !== 1 && s.semester !== 2)) { skipped.push(s.id); continue; }
    const id = `${s.disciplineId}|${s.teacherId}|${s.semester}`;
    if (!groups.has(id)) groups.set(id, { key: { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: s.semester }, versions: [] });
    groups.get(id).versions.push(s);
  }
  const out = [];
  for (const { key, versions } of groups.values()) {
    const same = (lines || []).filter((l) => l.disciplineId === key.disciplineId && l.semester === key.semester);
    const mine = same.filter((l) => joinedOf(members, l.id).some((m) => m.teacherId === key.teacherId));
    const hasApproved = versions.some((v) => v.status === 'approved');
    const target = mine.find((l) => {
      const joined = joinedOf(members, l.id);
      if (!(l.authorId === key.teacherId || joined.length === 1)) return false;
      const approved = versionsOfLine(syllabi, l.id).approved;
      return !hasApproved || !approved || approved.teacherId === key.teacherId;
    });
    const result = { key, versionIds: versions.map((v) => v.id) };
    if (target) out.push({ ...result, lineId: target.id, member: null });
    else if (mine.length) out.push({ ...result, lineId: null, member: 'left' });
    else out.push({ ...result, lineId: null, member: 'joined' });
  }
  return { groups: out, skipped };
}

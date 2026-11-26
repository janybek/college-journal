// The «Documents» screen: the syllabi of the disciplines in three tabs (approved, on approval, in development) and the card of one discipline.
// Reads only; every sheet at most once per request. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { compareNames } from '../core/names.js';
import { plainId } from '../core/syllabusSections.js';
import { rightsOn } from '../core/syllabusFlow.js';
import { draftTarget, lineFor, lineSubjects, mainLine, ownLines, reviewRows, versionsOfLine, waitingHalves } from '../core/disciplineSyllabus.js';
import { todayOf } from './scheduleData.js';
import { lineView, viewerOf } from './syllabusLines.js';
import { rolesOf } from './users.js';

export const DOCS_TABLES = ['disciplines', 'subjects', 'staff', 'groups', 'syllabi', 'syllabusLines'];

const HALVES = [1, 2];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ORDER = ['review', 'returned', 'draft'];

// { admin, dean, prorector, teacher } flags of the person; `all`: sees every discipline.
function scopeOf(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const manager = roles.includes('admin') || roles.includes('dean');
  return { manager, all: manager || roles.includes('prorector'), teacher: roles.includes('teacher') };
}

function readRows(store) {
  const rows = {};
  for (const name of DOCS_TABLES) rows[name] = store.list(name);
  return rows;
}

// What the viewer needs to know about one discipline: its lines, the halves that wait for the choice, the subjects.
function lookAt(rows, user, discipline) {
  const { subjects, syllabi, syllabusLines: lines } = rows;
  const main = mainLine(lines, discipline.id);
  const waiting = waitingHalves(lines, discipline.id);
  const own = lines.filter((l) => l.kind === 'own' && l.disciplineId === discipline.id);
  const best = waiting.length > 0 ? own : main ? [main] : own;
  const mine = subjects.filter((s) => s.disciplineId === discipline.id);
  const seen = (line, version) => rightsOn(version, viewerOf(user, line, subjects, lines)).see;
  const approved = [];
  const open = [];       // { line, version, visible }
  const review = [];     // { line, versions: the versions on approval the viewer sees }
  for (const line of best) {
    for (const half of HALVES) {
      const found = versionsOfLine(syllabi, line.id, half);
      if (found.approved) approved.push({ semester: half, syllabusId: found.approved.id, version: found.approved.version, decidedAt: found.approved.decidedAt || '' });
      if (found.open) open.push({ line, version: found.open, visible: seen(line, found.open) });
    }
    const onApproval = reviewRows(syllabi, line.id);
    if (onApproval.length > 0) review.push({ line, versions: onApproval.filter((v) => seen(line, v)) });
  }
  approved.sort((a, b) => a.semester - b.semester || cmp(a.syllabusId, b.syllabusId));
  return { discipline, main, waiting, own, best, mine, approved, open, review };
}

// The status of the best open version the viewer sees (review, then returned, then draft), or null.
function nextOf(look) {
  const seen = look.open.filter((o) => o.visible).map((o) => o.version.status);
  return ORDER.find((status) => seen.includes(status)) ?? null;
}

// Does the person take part in the discipline: leads a subject, is the responsible or owns an old own syllabus.
function involved(look, userId) {
  return look.mine.some((s) => s.teacherId === userId) || (look.main !== null && look.main.responsibleId === userId)
    || look.own.some((l) => l.teacherId === userId);
}

// The subject a person opens the page of the syllabus by: the first by the name of the group among those open to him ('' - none).
function openSubject(look, rows, user, scope) {
  const groups = new Map(rows.groups.map((g) => [g.id, g.name]));
  const mine = look.mine.filter((s) => scope.all || s.teacherId === user.id)
    .sort((a, b) => compareNames(groups.get(a.groupId) ?? '', groups.get(b.groupId) ?? '') || cmp(a.id, b.id));
  return mine.length > 0 ? mine[0].id : '';
}

const nameMap = (rows) => new Map(rows.map((r) => [r.id, r]));

// 'docs.syllabi' {} -> { today, can, approved, review, development }
export function documentsBoard(store, platform, user) {
  const scope = scopeOf(user);
  if (!scope.all && !scope.teacher) throw new AppError('forbidden');
  const rows = readRows(store);
  const staff = nameMap(rows.staff);
  const nameOf = (id) => (staff.get(id) || { fullName: '' }).fullName;
  const approvedRows = [];
  const reviewTab = [];
  const development = [];
  let anyWaiting = false;
  const disciplines = [...rows.disciplines].sort((a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id));
  for (const discipline of disciplines) {
    const look = lookAt(rows, user, discipline);
    if (look.waiting.length > 0) anyWaiting = true;
    if (!scope.all && !involved(look, user.id)) continue;
    const waiting = look.waiting.length > 0;
    const base = { disciplineId: discipline.id, disciplineName: discipline.name, subjectId: openSubject(look, rows, user, scope) };
    const lineId = look.main ? look.main.id : '';
    if (look.approved.length > 0) {
      const teachers = [...new Set(look.mine.map((s) => s.teacherId))].map(nameOf).sort(compareNames);
      approvedRows.push({ ...base, lineId, waiting, halves: look.approved, teachers, next: nextOf(look) });
    }
    for (const group of look.review) {
      const first = group.versions[0];
      if (!first) continue;
      const who = group.line.kind === 'main' ? group.line.responsibleId : group.line.teacherId;
      reviewTab.push({
        ...base, lineId: group.line.id, syllabusId: first.id, halves: group.versions.map((v) => v.semester), version: first.version,
        submittedAt: first.submittedAt || '', submittedByName: nameOf(first.submittedBy), teacherName: nameOf(who),
        reviewDue: group.line.reviewDue || '', waiting,
      });
    }
    if (look.approved.length === 0 && look.review.length === 0
      && (look.mine.length > 0 || (look.main !== null && look.main.responsibleId !== '') || look.open.length > 0)) {
      const state = nextOf(look);
      const shown = look.open.find((o) => o.visible && o.version.status === state);
      development.push({
        ...base, lineId, syllabusId: shown ? shown.version.id : '', state: state ?? 'none',
        responsibleId: look.main ? look.main.responsibleId : '', responsibleName: look.main ? nameOf(look.main.responsibleId) : '',
        dueDate: look.main ? look.main.dueDate || '' : '', waiting,
      });
    }
  }
  reviewTab.sort((a, b) => cmp(a.submittedAt, b.submittedAt) || cmp(a.disciplineName, b.disciplineName) || cmp(a.syllabusId, b.syllabusId));
  return {
    today: todayOf(platform),
    can: { assign: scope.manager, setReviewDue: scope.manager, choose: scope.manager && anyWaiting },
    approved: approvedRows, review: reviewTab, development,
  };
}

// 'docs.discipline' { disciplineId } -> the card of the syllabus of one discipline
export function disciplineDoc(store, platform, data, user) {
  const disciplineId = plainId(data.disciplineId);
  if (disciplineId === null) throw new AppError('bad_request');
  const scope = scopeOf(user);
  if (!scope.all && !scope.teacher) throw new AppError('forbidden');
  const rows = readRows(store);
  const discipline = rows.disciplines.find((d) => d.id === disciplineId);
  if (!discipline) throw new AppError('not_found');
  const look = lookAt(rows, user, discipline);
  if (!scope.all && !involved(look, user.id)) throw new AppError('forbidden');
  const { subjects, syllabi, staff, groups, syllabusLines: lines } = rows;
  const staffById = nameMap(staff);
  const nameOf = (id) => (staffById.get(id) || { fullName: '' }).fullName;
  const groupName = (id) => (groups.find((g) => g.id === id) || { name: '' }).name;
  const seen = (line, version) => rightsOn(version, viewerOf(user, line, subjects, lines)).see;

  const halves = [];
  for (const half of HALVES) {
    if (look.waiting.includes(half)) continue;
    const lineId = lineFor(lines, { disciplineId, teacherId: '', semester: half });
    const line = lineId === null ? null : lines.find((l) => l.id === lineId);
    if (!line) continue;
    const found = versionsOfLine(syllabi, line.id, half);
    const open = found.open && seen(line, found.open) ? found.open : null;
    if (!found.approved && !open) continue;
    halves.push({
      semester: half, lineId: line.id,
      approved: found.approved ? { syllabusId: found.approved.id, version: found.approved.version, decidedAt: found.approved.decidedAt || '', planSemester: found.approved.planSemester ?? null } : null,
      open: open ? { syllabusId: open.id, status: open.status, version: open.version, submittedAt: open.submittedAt || '', remark: open.remark || '' } : null,
    });
  }

  const byTeacher = new Map();
  for (const s of look.mine) {
    if (!byTeacher.has(s.teacherId)) byTeacher.set(s.teacherId, []);
    byTeacher.get(s.teacherId).push(groupName(s.groupId));
  }
  const teachers = [...byTeacher].map(([id, names]) => ({ id, fullName: nameOf(id), groups: names.sort(compareNames) }))
    .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));

  const candidates = {};
  for (const half of look.waiting) {
    candidates[half] = ownLines(lines, disciplineId, half).map((line) => {
      const found = versionsOfLine(syllabi, line.id, half);
      const shown = found.approved || (found.open && seen(line, found.open) ? found.open : null);
      return {
        lineId: line.id, teacherId: line.teacherId, teacherName: nameOf(line.teacherId), status: shown ? shown.status : 'none',
        version: shown ? shown.version : null, planSemester: shown ? shown.planSemester ?? null : null, course: shown ? shown.course ?? null : null,
        groups: lineSubjects(subjects, line, lines, half).map((s) => groupName(s.groupId)).sort(compareNames),
      };
    });
  }

  const history = [];
  if (scope.all) {
    const archived = new Set(lines.filter((l) => l.kind === 'archived' && l.disciplineId === disciplineId).map((l) => l.id));
    for (const v of syllabi) {
      if (v.disciplineId !== disciplineId) continue;
      const former = archived.has(v.lineId);
      if (!former && v.status !== 'archived') continue;
      history.push({ syllabusId: v.id, semester: v.semester, version: v.version, status: v.status, decidedAt: v.decidedAt || '', former, teacherName: nameOf(v.teacherId) });
    }
    history.sort((a, b) => a.semester - b.semester || (Number(b.version) || 0) - (Number(a.version) || 0) || cmp(a.syllabusId, b.syllabusId));
  }

  const start = HALVES.some((half) => draftTarget(lines, syllabi, subjects, { disciplineId, teacherId: '', semester: half }, user).code === 'ok');
  const can = { assign: scope.manager, setReviewDue: scope.manager, choose: scope.manager && look.waiting.length > 0, start };
  const leading = new Set(look.mine.map((s) => s.teacherId));
  return {
    today: todayOf(platform), discipline: { id: discipline.id, name: discipline.name },
    line: look.main ? lineView({ syllabusLines: lines, subjects, staff, groups }, look.main, user) : null,
    waiting: look.waiting, halves, teachers, candidates, history,
    ...(can.assign ? {
      staff: staff.filter((p) => p.active !== false && rolesOf(p, 'staff').includes('teacher'))
        .map((p) => ({ id: p.id, fullName: p.fullName, teaches: leading.has(p.id) })).sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id)),
    } : {}),
    can,
  };
}

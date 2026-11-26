// Submitting, approving and returning a syllabus version, and the queue of versions under review. Every sheet is read at most once per request,
// writes go in batches. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { LIMITS, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, rowsOfVersion } from '../core/syllabusDoc.js';
import { approvalPlan, checkSubmit, rightsOn } from '../core/syllabusFlow.js';
import { lineSubjects, openRows, reviewRows, versionsOfLine } from '../core/disciplineSyllabus.js';
import { loadSettings, relayout, todayOf } from './scheduleData.js';
import { heldErrors, readTables, startedOf, versionOf } from './syllabusDraft.js';
import { groupsOfLine, lineOfVersion, viewerOf, worksOn } from './syllabusLines.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');
const byHalf = (a, b) => a.semester - b.semester;

// The version of the request with its line and the sheets that decide who may do what: { syllabi, version, subjects, line, lines }.
function load(store, data) {
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const lines = store.list('syllabusLines');
  const line = lineOfVersion(lines, version);
  return { syllabi, version, subjects, line, lines };
}

// The rights of the user on the version for one action. Someone who may not even see the version, or who never does this action, gets `forbidden`;
// someone who does it in general but not with a version in this status gets `syllabus_locked`. The deanery, the administrator and the responsible submit.
function allow(ctx, user, action) {
  const viewer = viewerOf(user, ctx.line, ctx.subjects, ctx.lines);
  const rights = rightsOn(ctx.version, viewer);
  if (!rights.see) throw new AppError('forbidden');
  const may = action === 'submit' ? worksOn(viewer) : isManager(user);
  if (!may) throw new AppError('forbidden');
  if (!rights[action === 'return' ? 'giveBack' : action]) throw new AppError('syllabus_locked');
}

// The versions an action takes: the rows of the line, one per half, ordered by half; the version of the request is always among them.
function withRequest(rows, version) {
  return (rows.some((s) => s.id === version.id) ? rows : [...rows, version]).sort(byHalf);
}

// The number the versions of one send or approval get: their own when it is one, else 1 + the greatest on the line (null: nothing to change).
function commonNumber(targets, syllabi, lineId) {
  if (new Set(targets.map((s) => Number(s.version) || 0)).size < 2) return null;
  return 1 + Math.max(0, ...syllabi.filter((s) => s.lineId === lineId).map((s) => Number(s.version) || 0));
}

// The dates of the line after the decision of the deanery: written only when there is something to clear (a repeated «approve» leaves them as they are).
function clearDates(store, line, patch) {
  const filled = Object.keys(patch).filter((key) => line[key]);
  if (filled.length > 0) store.updateMany('syllabusLines', [{ id: line.id, patch: Object.fromEntries(filled.map((key) => [key, ''])) }]);
}

// The checks before submitting and approving, per target: the version against the approved one of its half of the line and the held pairs of every group of the line.
// Several targets: every error and warning names its half. -> { pairs, parts: [{ version, approved, rows, previous }], checks }
function examine(store, ctx, tables, targets) {
  const { line, lines, subjects, syllabi } = ctx;
  const pairs = store.list('pairs');
  const groups = store.list('groups');
  const held = { subjects, groups, line, lines, cache: {} };
  const errors = [];
  const warnings = [];
  const parts = targets.map((version) => {
    const { approved } = versionsOfLine(syllabi, line.id, version.semester);
    const rows = rowsOfVersion(tables, version.id);
    const previous = approved && approved.id !== version.id ? rowsOfVersion(tables, approved.id) : null;
    const heldList = previous ? heldErrors(store, held, version, approved, rows, previous, pairs) : [];
    const checks = checkSubmit(buildDoc(version, rows), heldList, groupsOfLine(line, lines, subjects, groups, version.semester));
    const tag = (e) => (targets.length > 1 ? { ...e, semester: version.semester } : e);
    errors.push(...checks.errors.map(tag));
    warnings.push(...checks.warnings.map(tag));
    return { version, approved: previous ? approved : null, rows, previous };
  });
  return { pairs, parts, checks: { errors, warnings } };
}

// 'syllabus.submit' { syllabusId, dryRun? } -> { submitted, checks, halves }
// Every open half of the line that is a draft or returned and is started goes with the one asked; a half that is not started stays out.
export function submitSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || (data.dryRun !== undefined && typeof data.dryRun !== 'boolean')) throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version, syllabi, line } = ctx;
  allow(ctx, user, 'submit');
  const tables = readTables(store, DOC_TABLES);
  const targets = withRequest(openRows(syllabi, line.id).filter((s) => ['draft', 'returned'].includes(s.status)
    && (s.id === version.id || startedOf(s, syllabi, tables.topics))), version);
  const { checks } = examine(store, ctx, tables, targets);
  const halves = targets.map((s) => s.semester);
  if (checks.errors.length > 0 || data.dryRun === true) return { submitted: false, checks, halves };
  const number = commonNumber(targets, syllabi, line.id);
  store.updateMany('syllabi', targets.map((s) => ({
    id: s.id, patch: { status: 'review', submittedBy: user.id, submittedAt: todayOf(platform), ...(number !== null ? { version: number } : {}) },
  })));
  return { submitted: true, checks, halves };
}

// 'syllabus.approve' { syllabusId } -> { approved, checks, changedPairs, halves }
// A version on approval: every version of the line on approval is approved, the other half stays as it is. A draft or a returned version: it and every other open
// started half of the line, whatever its status.
export function approveSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null) throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version, syllabi, subjects, line, lines } = ctx;
  allow(ctx, user, 'approve');
  const tables = readTables(store, DOC_TABLES);
  const open = openRows(syllabi, line.id);
  const targets = withRequest(version.status === 'review' ? open.filter((s) => s.status === 'review')
    : open.filter((s) => s.id === version.id || startedOf(s, syllabi, tables.topics)), version);
  const { pairs, parts, checks } = examine(store, ctx, tables, targets);
  const halves = targets.map((s) => s.semester);
  if (checks.errors.length > 0) return { approved: false, checks, changedPairs: 0, halves };
  const settings = loadSettings(store);                     // every read goes before the first write

  const number = commonNumber(targets, syllabi, line.id);
  const today = todayOf(platform);
  const plans = parts.map((p) => approvalPlan({ version: p.version, approved: p.approved, topics: p.rows.topics, approvedTopics: p.previous ? p.previous.topics : [], pairs, userId: user.id, today }));
  const patches = plans.flatMap((plan) => plan.syllabi).map((u) => (number !== null && targets.some((t) => t.id === u.id) ? { ...u, patch: { ...u.patch, version: number } } : u));
  const movedPairs = plans.flatMap((plan) => plan.pairs);
  const patched = new Map(patches.map((u) => [u.id, u.patch]));
  const after = syllabi.map((s) => (patched.has(s.id) ? { ...s, ...patched.get(s.id) } : s));
  const moved = new Map(movedPairs.map((u) => [u.id, u.patch]));
  const afterPairs = pairs.map((p) => (moved.has(p.id) ? { ...p, ...moved.get(p.id) } : p));

  // «Пары» go first, «Силлабусы» second: if the second write fails, the versions stay open with the pairs already on their rows,
  // and «Утвердить» again finishes the job (approvalPlan moves nothing, the layout is the same).
  const ids = [...new Set(targets.flatMap((s) => lineSubjects(subjects, line, lines, s.semester)).map((s) => s.id))];   // the groups that follow the line in these halves at this moment
  const result = relayout(store, ids, { subjects, syllabi: after, syllabusLines: lines, topics: tables.topics, pairs: afterPairs, settings }, movedPairs);
  store.updateMany('syllabi', patches);
  clearDates(store, line, { dueDate: '', reviewDue: '' });
  return { approved: true, checks, changedPairs: result.changed, halves };
}

// 'syllabus.return' { syllabusId, remark } -> { returned: true, halves }   (every version of the line on approval goes back with the one remark)
export function returnSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || typeof data.remark !== 'string') throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version, syllabi, line } = ctx;
  allow(ctx, user, 'return');
  const remark = data.remark.trim();
  if (remark === '') throw new AppError('invalid', { fields: [{ field: 'remark', code: 'required' }] });
  if (remark.length > LIMITS.text) throw new AppError('invalid', { fields: [{ field: 'remark', code: 'too_long' }] });
  const targets = withRequest(reviewRows(syllabi, line.id), version);
  store.updateMany('syllabi', targets.map((s) => ({ id: s.id, patch: { status: 'returned', remark, decidedBy: user.id, decidedAt: todayOf(platform) } })));
  clearDates(store, line, { reviewDue: '' });
  return { returned: true, halves: targets.map((s) => s.semester) };
}

// 'syllabus.queue' { countOnly? } -> { today, count, rows } or { count }
// The versions on approval of the lines that are not a history; count is the number of lines (two halves of one line are one decision). teacherName: the responsible (the syllabus of the discipline) or the teacher (an old own one), '' - nobody.
export function reviewQueue(store, platform, data) {
  if (data.countOnly !== undefined && typeof data.countOnly !== 'boolean') throw new AppError('bad_request');
  const lines = store.list('syllabusLines');
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  const queue = store.list('syllabi').filter((s) => s.status === 'review' && !(lineOf.has(s.lineId) && lineOf.get(s.lineId).kind === 'archived'));
  const lineCount = new Set(queue.map((s) => s.lineId || s.id)).size;
  if (data.countOnly === true) return { count: lineCount };
  const subjects = store.list('subjects');
  const disciplines = store.list('disciplines');
  const staff = store.list('staff');
  const groups = store.list('groups');
  const nameOf = (rows, id, field) => (rows.find((r) => r.id === id) || {})[field] ?? '';
  const rows = queue.map((s) => {
    const line = lineOf.get(s.lineId);
    const first = line ? lineSubjects(subjects, line, lines, s.semester)
      .map((x) => ({ id: x.id, group: nameOf(groups, x.groupId, 'name') })).sort((a, b) => cmp(a.group, b.group) || cmp(a.id, b.id))[0] : undefined;
    const who = !line ? s.teacherId : line.kind === 'main' ? line.responsibleId : line.teacherId;
    return {
      syllabusId: s.id, lineId: s.lineId || '', disciplineId: s.disciplineId, reviewDue: line ? line.reviewDue || '' : '',
      subjectId: first ? first.id : '', disciplineName: nameOf(disciplines, s.disciplineId, 'name'), teacherName: nameOf(staff, who, 'fullName'),
      semester: s.semester, planSemester: s.planSemester ?? null, version: s.version, submittedAt: s.submittedAt ?? '', submittedByName: nameOf(staff, s.submittedBy, 'fullName'),
    };
  }).sort((a, b) => cmp(a.submittedAt, b.submittedAt) || cmp(a.disciplineName, b.disciplineName) || cmp(a.syllabusId, b.syllabusId));
  return { today: todayOf(platform), count: lineCount, rows };
}

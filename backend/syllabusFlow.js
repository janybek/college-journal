// Submitting, approving and returning a syllabus version, and the queue of versions under review. Every sheet is read at most once per request,
// writes go in batches. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { LIMITS, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, rowsOfVersion } from '../core/syllabusDoc.js';
import { approvalPlan, checkSubmit, rightsOn } from '../core/syllabusFlow.js';
import { lineSubjects, versionsOfLine } from '../core/disciplineSyllabus.js';
import { loadSettings, relayout, todayOf } from './scheduleData.js';
import { heldErrors, readTables, versionOf } from './syllabusDraft.js';
import { groupsOfLine, lineOfVersion, viewerOf, worksOn } from './syllabusLines.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');

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

// The checks before submitting and approving: the version against the approved one of its half of the line and the held pairs of every group of the line.
function examine(store, ctx) {
  const { version, line, lines, subjects, syllabi } = ctx;
  const tables = readTables(store, DOC_TABLES);
  const pairs = store.list('pairs');
  const groups = store.list('groups');
  const { approved } = versionsOfLine(syllabi, line.id, version.semester);
  const rows = rowsOfVersion(tables, version.id);
  const previous = approved && approved.id !== version.id ? rowsOfVersion(tables, approved.id) : null;
  const held = previous ? heldErrors(store, { subjects, groups, line, lines }, version, approved, rows, previous, pairs) : [];
  return {
    tables, pairs, approved: previous ? approved : null, rows, previous,
    checks: checkSubmit(buildDoc(version, rows), held, groupsOfLine(line, lines, subjects, groups, version.semester)),
  };
}

// 'syllabus.submit' { syllabusId, dryRun? } -> { submitted, checks }
export function submitSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || (data.dryRun !== undefined && typeof data.dryRun !== 'boolean')) throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version } = ctx;
  allow(ctx, user, 'submit');
  const { checks } = examine(store, ctx);
  if (checks.errors.length > 0 || data.dryRun === true) return { submitted: false, checks };
  store.updateMany('syllabi', [{ id: version.id, patch: { status: 'review', submittedBy: user.id, submittedAt: todayOf(platform) } }]);
  return { submitted: true, checks };
}

// 'syllabus.approve' { syllabusId } -> { approved, checks, changedPairs }
export function approveSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null) throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version, syllabi, subjects, line, lines } = ctx;
  allow(ctx, user, 'approve');
  const { tables, pairs, approved, rows, previous, checks } = examine(store, ctx);
  if (checks.errors.length > 0) return { approved: false, checks, changedPairs: 0 };
  const settings = loadSettings(store);                     // every read goes before the first write

  const plan = approvalPlan({ version, approved, topics: rows.topics, approvedTopics: previous ? previous.topics : [], pairs, userId: user.id, today: todayOf(platform) });
  const patched = new Map(plan.syllabi.map((u) => [u.id, u.patch]));
  const after = syllabi.map((s) => (patched.has(s.id) ? { ...s, ...patched.get(s.id) } : s));
  const moved = new Map(plan.pairs.map((u) => [u.id, u.patch]));
  const afterPairs = pairs.map((p) => (moved.has(p.id) ? { ...p, ...moved.get(p.id) } : p));

  // «Пары» go first, «Силлабусы» second: if the second write fails, the version stays open with the pairs already on its rows,
  // and «Утвердить» again finishes the job (approvalPlan moves nothing, the layout is the same).
  const ids = lineSubjects(subjects, line, lines, version.semester).map((s) => s.id);   // the groups that follow the line in this half at this moment
  const result = relayout(store, ids, { subjects, syllabi: after, syllabusLines: lines, topics: tables.topics, pairs: afterPairs, settings }, plan.pairs);
  store.updateMany('syllabi', plan.syllabi);
  return { approved: true, checks, changedPairs: result.changed };
}

// 'syllabus.return' { syllabusId, remark } -> { returned: true }
export function returnSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || typeof data.remark !== 'string') throw new AppError('bad_request');
  const ctx = load(store, data);
  const { version } = ctx;
  allow(ctx, user, 'return');
  const remark = data.remark.trim();
  if (remark === '') throw new AppError('invalid', { fields: [{ field: 'remark', code: 'required' }] });
  if (remark.length > LIMITS.text) throw new AppError('invalid', { fields: [{ field: 'remark', code: 'too_long' }] });
  store.updateMany('syllabi', [{ id: version.id, patch: { status: 'returned', remark, decidedBy: user.id, decidedAt: todayOf(platform) } }]);
  return { returned: true };
}

// 'syllabus.queue' { countOnly? } -> { today, count, rows } or { count }
// The versions on approval of the lines that are not a history. teacherName: the responsible (the syllabus of the discipline) or the teacher (an old own one), '' - nobody.
export function reviewQueue(store, platform, data) {
  if (data.countOnly !== undefined && typeof data.countOnly !== 'boolean') throw new AppError('bad_request');
  const lines = store.list('syllabusLines');
  const lineOf = new Map(lines.map((l) => [l.id, l]));
  const queue = store.list('syllabi').filter((s) => s.status === 'review' && !(lineOf.has(s.lineId) && lineOf.get(s.lineId).kind === 'archived'));
  if (data.countOnly === true) return { count: queue.length };
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
      syllabusId: s.id, subjectId: first ? first.id : '', disciplineName: nameOf(disciplines, s.disciplineId, 'name'), teacherName: nameOf(staff, who, 'fullName'),
      semester: s.semester, planSemester: s.planSemester ?? null, version: s.version, submittedAt: s.submittedAt ?? '', submittedByName: nameOf(staff, s.submittedBy, 'fullName'),
    };
  }).sort((a, b) => cmp(a.submittedAt, b.submittedAt) || cmp(a.disciplineName, b.disciplineName) || cmp(a.syllabusId, b.syllabusId));
  return { today: todayOf(platform), count: rows.length, rows };
}

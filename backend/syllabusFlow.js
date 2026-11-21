// Submitting, approving and returning a syllabus version, and the queue of versions under review. Every sheet is read at most once per request,
// writes go in batches. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { LIMITS, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, rowsOfVersion } from '../core/syllabusDoc.js';
import { approvalPlan, checkHeld, checkSubmit, rightsOn, versionsOf } from '../core/syllabusFlow.js';
import { loadSettings, relayout, todayOf } from './scheduleData.js';
import { readTables, versionOf, viewerOf } from './syllabusDraft.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');

// The rights of the user on the version for one action. Someone who may not even see the version, or who never does this action, gets `forbidden`;
// someone who does it in general but not with a version in this status gets `syllabus_locked`.
function allow(version, user, subjects, action) {
  const viewer = viewerOf(user, version, subjects);
  const rights = rightsOn(version, viewer);
  if (!rights.see) throw new AppError('forbidden');
  const owner = viewer.roles.includes('teacher') && viewer.teaches && version.teacherId === user.id;
  const may = action === 'submit' ? isManager(user) || owner : isManager(user);
  if (!may) throw new AppError('forbidden');
  if (!rights[action === 'return' ? 'giveBack' : action]) throw new AppError('syllabus_locked');
}

// The checks before submitting and approving: the version against the approved one of its key and the held pairs.
function examine(store, version, syllabi) {
  const tables = readTables(store, DOC_TABLES);
  const pairs = store.list('pairs');
  const { approved } = versionsOf(syllabi, { disciplineId: version.disciplineId, teacherId: version.teacherId, semester: version.semester });
  const rows = rowsOfVersion(tables, version.id);
  const previous = approved && approved.id !== version.id ? rowsOfVersion(tables, approved.id) : null;
  const held = previous ? checkHeld(rows.topics, previous.topics, pairs) : [];
  return { tables, pairs, approved: previous ? approved : null, rows, previous, checks: checkSubmit(buildDoc(version, rows), held) };
}

// 'syllabus.submit' { syllabusId, dryRun? } -> { submitted, checks }
export function submitSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || (data.dryRun !== undefined && typeof data.dryRun !== 'boolean')) throw new AppError('bad_request');
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, syllabusId);
  const subjects = store.list('subjects');
  allow(version, user, subjects, 'submit');
  const { checks } = examine(store, version, syllabi);
  if (checks.errors.length > 0 || data.dryRun === true) return { submitted: false, checks };
  store.updateMany('syllabi', [{ id: version.id, patch: { status: 'review', submittedBy: user.id, submittedAt: todayOf(platform) } }]);
  return { submitted: true, checks };
}

// 'syllabus.approve' { syllabusId } -> { approved, checks, changedPairs }
export function approveSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null) throw new AppError('bad_request');
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, syllabusId);
  const subjects = store.list('subjects');
  allow(version, user, subjects, 'approve');
  const { tables, pairs, approved, rows, previous, checks } = examine(store, version, syllabi);
  if (checks.errors.length > 0) return { approved: false, checks, changedPairs: 0 };

  const plan = approvalPlan({ version, approved, topics: rows.topics, approvedTopics: previous ? previous.topics : [], pairs, userId: user.id, today: todayOf(platform) });
  const changed = store.updateMany('syllabi', plan.syllabi);
  const patched = new Map(plan.syllabi.map((u) => [u.id, u.patch]));
  const after = syllabi.map((s) => changed.find((c) => c.id === s.id) ?? (patched.has(s.id) ? { ...s, ...patched.get(s.id) } : s));
  const moved = new Map(plan.pairs.map((u) => [u.id, u.patch]));
  const afterPairs = pairs.map((p) => (moved.has(p.id) ? { ...p, ...moved.get(p.id) } : p));

  const ids = subjects.filter((s) => s.disciplineId === version.disciplineId && s.teacherId === version.teacherId).map((s) => s.id);
  const result = relayout(store, ids, { subjects, syllabi: after, topics: tables.topics, pairs: afterPairs, settings: loadSettings(store) }, plan.pairs);
  return { approved: true, checks, changedPairs: result.changed };
}

// 'syllabus.return' { syllabusId, remark } -> { returned: true }
export function returnSyllabus(store, platform, data, user) {
  const syllabusId = plainId(data.syllabusId);
  if (syllabusId === null || typeof data.remark !== 'string') throw new AppError('bad_request');
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, syllabusId);
  const subjects = store.list('subjects');
  allow(version, user, subjects, 'return');
  const remark = data.remark.trim();
  if (remark === '') throw new AppError('invalid', { fields: [{ field: 'remark', code: 'required' }] });
  if (remark.length > LIMITS.text) throw new AppError('invalid', { fields: [{ field: 'remark', code: 'too_long' }] });
  store.updateMany('syllabi', [{ id: version.id, patch: { status: 'returned', remark, decidedBy: user.id, decidedAt: todayOf(platform) } }]);
  return { returned: true };
}

// 'syllabus.queue' { countOnly? } -> { today, count, rows } or { count }
export function reviewQueue(store, platform, data) {
  if (data.countOnly !== undefined && typeof data.countOnly !== 'boolean') throw new AppError('bad_request');
  const queue = store.list('syllabi').filter((s) => s.status === 'review');
  if (data.countOnly === true) return { count: queue.length };
  const subjects = store.list('subjects');
  const disciplines = store.list('disciplines');
  const staff = store.list('staff');
  const groups = store.list('groups');
  const nameOf = (rows, id, field) => (rows.find((r) => r.id === id) || {})[field] ?? '';
  const rows = queue.map((s) => {
    const first = subjects.filter((x) => x.disciplineId === s.disciplineId && x.teacherId === s.teacherId)
      .map((x) => ({ id: x.id, group: nameOf(groups, x.groupId, 'name') })).sort((a, b) => cmp(a.group, b.group) || cmp(a.id, b.id))[0];
    return {
      syllabusId: s.id, subjectId: first ? first.id : '', disciplineName: nameOf(disciplines, s.disciplineId, 'name'), teacherName: nameOf(staff, s.teacherId, 'fullName'),
      semester: s.semester, planSemester: s.planSemester ?? null, version: s.version, submittedAt: s.submittedAt ?? '', submittedByName: nameOf(staff, s.submittedBy, 'fullName'),
    };
  }).sort((a, b) => cmp(a.submittedAt, b.submittedAt) || cmp(a.disciplineName, b.disciplineName) || cmp(a.syllabusId, b.syllabusId));
  return { today: todayOf(platform), count: rows.length, rows };
}

// A syllabus draft on the server: start one, read the form, save a section. Every sheet is read at most once per request, writes go in batches.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { SECTIONS, SECTION_TABLES, checkSection, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, copyRows, draftVersion, rowsOfVersion, sectionWrites } from '../core/syllabusDoc.js';
import { checkHeld, checkSubmit, rightsOn, versionsOf } from '../core/syllabusFlow.js';
import { todayOf } from './scheduleData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');
const isHalf = (v) => v === 1 || v === 2;

// { <sheet>: store.list(<sheet>) }: every named sheet once.
export function readTables(store, names) {
  const out = {};
  for (const name of names) out[name] = store.list(name);
  return out;
}

// What rightsOn needs to know about the person: the id, the roles and whether they teach the discipline of the version now.
export function viewerOf(user, version, subjects) {
  const teaches = subjects.some((s) => s.disciplineId === version.disciplineId && s.teacherId === user.id);
  return { id: user.id, roles: user.roles, teaches };
}

const keyOfVersion = (v) => ({ disciplineId: v.disciplineId, teacherId: v.teacherId, semester: v.semester });

// Writes the row of a new version of a key and, when the key has an approved version, a copy of its sections (one insertMany per non-empty sheet).
// tables: at least `syllabi`; with an approved version also the sheets of DOC_TABLES. -> { version, rows }
export function createDraft(store, platform, { key, approved, group, userId }, tables) {
  const { last } = versionsOf(tables.syllabi, key);
  const course = group && Number.isInteger(group.course) ? group.course : null;
  const planSemester = course !== null && course >= 1 && course <= 4 ? (course - 1) * 2 + key.semester : null;
  const row = draftVersion({ key, approved, planSemester, course, userId, today: todayOf(platform), number: last + 1 });
  const [version] = store.insertMany('syllabi', [row]);
  const rows = {};
  if (approved) {
    const copy = copyRows(rowsOfVersion(tables, approved.id));
    for (const name of DOC_TABLES) {
      rows[name] = copy[name].length > 0 ? store.insertMany(name, copy[name].map((r) => ({ ...r, syllabusId: version.id }))) : [];
    }
  }
  return { version, rows };
}

// 'syllabus.startDraft' { subjectId, semester } -> { syllabusId, created }
export function startDraft(store, platform, data, user) {
  const subjectId = plainId(data.subjectId);
  if (subjectId === null || !isHalf(data.semester)) throw new AppError('bad_request');
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  if (!(isManager(user) || (user.roles.includes('teacher') && subject.teacherId === user.id))) throw new AppError('forbidden');
  if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
    throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  }

  const key = { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: data.semester };
  const syllabi = store.list('syllabi');
  const { approved, open } = versionsOf(syllabi, key);
  if (open) return { syllabusId: open.id, created: false };

  const group = approved ? null : store.list('groups').find((g) => g.id === subject.groupId) || null;
  const tables = { syllabi, ...(approved ? readTables(store, DOC_TABLES) : {}) };
  const { version } = createDraft(store, platform, { key, approved, group, userId: user.id }, tables);
  return { syllabusId: version.id, created: true };
}

// The version of a request: the id is a plain string (else bad_request), the row exists (else not_found).
function versionOf(syllabi, id) {
  const syllabusId = plainId(id);
  if (syllabusId === null) throw new AppError('bad_request');
  const version = syllabi.find((s) => s.id === syllabusId);
  if (!version) throw new AppError('not_found');
  return version;
}

// 'syllabus.form' { syllabusId } -> the version, its subject, what the viewer may do, the document and the checks before submitting.
export function draftForm(store, platform, data, user) {
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const viewer = viewerOf(user, version, subjects);
  const rights = rightsOn(version, viewer);
  const owner = viewer.roles.includes('teacher') && viewer.teaches && version.teacherId === user.id;
  if (!(rights.see && (isManager(user) || owner || user.roles.includes('prorector')))) throw new AppError('forbidden');

  const staff = store.list('staff');
  const groups = store.list('groups');
  const tables = readTables(store, DOC_TABLES);
  const pairs = store.list('pairs');

  const { approved } = versionsOf(syllabi, keyOfVersion(version));
  const rows = rowsOfVersion(tables, version.id);
  const doc = buildDoc(version, rows);
  const held = approved && approved.id !== version.id ? checkHeld(rows.topics, rowsOfVersion(tables, approved.id).topics, pairs) : [];

  const groupName = (id) => (groups.find((g) => g.id === id) || { name: '' }).name;
  const mine = subjects.filter((s) => s.disciplineId === version.disciplineId && s.teacherId === version.teacherId)
    .map((s) => ({ subjectId: s.id, groupName: groupName(s.groupId) })).sort((a, b) => cmp(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));
  const named = mine.length > 0 ? subjects.find((s) => s.id === mine[0].subjectId) : subjects.find((s) => s.disciplineId === version.disciplineId);
  const teacher = staff.find((s) => s.id === version.teacherId);

  return {
    today: todayOf(platform),
    syllabus: {
      id: version.id, status: version.status, version: version.version, semester: version.semester, planSemester: version.planSemester ?? null,
      remark: version.remark ?? '', updated: version.updated ?? '', submittedAt: version.submittedAt ?? '', decidedAt: version.decidedAt ?? '',
      copyOfApproved: approved !== null,
    },
    subject: {
      id: mine.length > 0 ? mine[0].subjectId : '', name: named ? named.name : '', disciplineId: version.disciplineId, teacherId: version.teacherId,
      teacherName: teacher ? teacher.fullName : '', groups: mine,
    },
    can: { edit: rights.edit, submit: rights.submit, approve: rights.approve, giveBack: rights.giveBack },
    doc,
    checks: checkSubmit(doc, held),
  };
}

// The rows of the sheets after the writes of a section: removed ones gone, changed ones as the store gave them back, new ones added.
function afterWrites(before, removed, changed, added) {
  const gone = new Set(removed);
  const byId = new Map(changed.map((r) => [r.id, r]));
  return [...before.filter((r) => !gone.has(r.id)).map((r) => byId.get(r.id) ?? r), ...added];
}

// 'syllabus.saveSection' { syllabusId, section, data } -> { doc, lessons, manualOrder, updated }
export function saveSection(store, platform, data, user) {
  const { section } = data;
  if (typeof section !== 'string' || !SECTIONS.includes(section) || plainId(data.syllabusId) === null) throw new AppError('bad_request');
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const rights = rightsOn(version, viewerOf(user, version, subjects));
  if (!rights.see) throw new AppError('forbidden');
  if (!rights.edit) throw new AppError('syllabus_locked');

  const checked = checkSection(section, data.data, { half: version.semester });
  if (checked.errors.length > 0) throw new AppError('invalid', { fields: checked.errors });

  const names = [...SECTION_TABLES[section]];
  const tables = readTables(store, names);
  let plan = sectionWrites(section, checked.value, version, rowsOfVersion(tables, version.id));
  // a unit that has no row of its own yet (no title) is known only from the plan: read it when the first try does not find a unit
  if (section === 'units' && plan.errors.some((e) => e.code === 'bad_ref')) {
    names.push('topics');
    tables.topics = store.list('topics');
    plan = sectionWrites(section, checked.value, version, rowsOfVersion(tables, version.id));
  }
  if (plan.errors.length > 0) throw new AppError('invalid', { fields: plan.errors });

  const today = todayOf(platform);
  const after = {};
  let changed = plan.syllabus !== null;
  for (const name of SECTION_TABLES[section]) {
    const { insert, update, remove } = plan.tables[name];
    if (remove.length > 0) store.removeMany(name, remove);
    const updated = update.length > 0 ? store.updateMany(name, update) : [];
    const added = insert.length > 0 ? store.insertMany(name, insert) : [];
    after[name] = afterWrites(tables[name], remove, updated, added);
    if (insert.length + update.length + remove.length > 0) changed = true;
  }
  if (names.includes('topics') && !after.topics) after.topics = tables.topics;

  let current = version;
  if (changed) {
    const [row] = store.updateMany('syllabi', [{ id: version.id, patch: { ...(plan.syllabus || {}), updated: today, editedBy: user.id } }]);
    current = row;
  }

  const built = buildDoc(current, rowsOfVersion({ ...tables, ...after }, version.id));
  const withLessons = section === 'plan' || section === 'order';
  return {
    doc: section === 'order' ? built.lessons : built[section],
    lessons: withLessons ? built.lessons : null,
    manualOrder: current.manualOrder === true,
    updated: current.updated ?? '',
  };
}

// A syllabus draft on the server: start one, read the form, save a section. Every sheet is read at most once per request, writes go in batches.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { SECTIONS, SECTION_TABLES, checkSection, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, copyRows, draftVersion, rowsOfVersion, sectionWrites } from '../core/syllabusDoc.js';
import { checkHeld, checkSubmit, rightsOn } from '../core/syllabusFlow.js';
import { lineSubjects, nextVersion, teacherSubjects, versionTeacher, versionsOfLine } from '../core/disciplineSyllabus.js';
import { compareNames } from '../core/names.js';
import { todayOf } from './scheduleData.js';
import { groupsOfLine, lineGroups, lineOfVersion, lineView, manyTeachers, openLine, viewerOf, worksOn } from './syllabusLines.js';

const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');
const isHalf = (v) => v === 1 || v === 2;

// { <sheet>: store.list(<sheet>) }: every named sheet once.
export function readTables(store, names) {
  const out = {};
  for (const name of names) out[name] = store.list(name);
  return out;
}

// The file of a version for the screen: { name, kind, size, at } or null. An empty fileId reads nothing; else the sheet «Файлы» once.
export function fileMetaOf(store, version) {
  if (typeof version.fileId !== 'string' || version.fileId === '') return null;
  const row = store.list('files').find((f) => f.id === version.fileId && f.state === 'syllabus');
  return row ? { name: row.name, kind: row.kind, size: row.size, at: row.at } : null;
}

// The teacher for the column «teacher» of a new version of the line (versionTeacher); the pairs are read (pairs() gives them) only when the count of pairs decides.
export function teacherOfNew(line, subjects, pairs, userId) {
  if (line.kind !== 'main') return line.teacherId;
  const ofDiscipline = (subjects || []).filter((s) => s.disciplineId === line.disciplineId);
  if (line.responsibleId && teacherSubjects(ofDiscipline, line.disciplineId, line.responsibleId).length > 0) return line.responsibleId;
  return versionTeacher(line, ofDiscipline, ofDiscipline.length > 0 ? pairs() : [], userId);
}

// Writes the row of a new version of a line in one half of the year and, when the half has an approved version, a copy of its sections (one insertMany per
// non-empty sheet). teacherId — the column «teacher» (teacherOfNew). tables: at least `syllabi`; with an approved version also the sheets of DOC_TABLES.
// -> { version, rows }
export function createDraft(store, platform, { line, half, approved, group, userId, teacherId }, tables) {
  const number = nextVersion(tables.syllabi, line.id, { disciplineId: line.disciplineId, teacherId });
  const course = group && Number.isInteger(group.course) ? group.course : null;
  const planSemester = course !== null && course >= 1 && course <= 4 ? (course - 1) * 2 + half : null;
  const row = draftVersion({ line, half, teacherId, approved, planSemester, course, userId, today: todayOf(platform), number });
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
// The line where the draft of the half goes (openLine: the syllabus of the discipline is made when there is none); its open version, else a new one
// (a copy of the approved version of the half when there is one).
export function startDraft(store, platform, data, user) {
  if (data.lineId !== undefined) throw new AppError('bad_request');
  const subjectId = plainId(data.subjectId);
  if (subjectId === null || !isHalf(data.semester)) throw new AppError('bad_request');
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
    throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  }
  const syllabi = store.list('syllabi');
  const rows = { syllabusLines: store.list('syllabusLines'), syllabi, subjects };
  const line = openLine(store, platform, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: data.semester }, user, rows);
  const { approved, open } = versionsOfLine(syllabi, line.id, data.semester);
  if (open) return { syllabusId: open.id, created: false };
  const tables = { syllabi, ...(approved ? readTables(store, DOC_TABLES) : {}) };
  const group = approved ? null : store.list('groups').find((g) => g.id === subject.groupId) || null;
  const teacherId = teacherOfNew(line, subjects, () => store.list('pairs'), user.id);
  const { version } = createDraft(store, platform, { line, half: data.semester, approved, group, userId: user.id, teacherId }, tables);
  return { syllabusId: version.id, created: true };
}

// The version of a request: the id is a plain string (else bad_request), the row exists (else not_found).
export function versionOf(syllabi, id) {
  const syllabusId = plainId(id);
  if (syllabusId === null) throw new AppError('bad_request');
  const version = syllabi.find((s) => s.id === syllabusId);
  if (!version) throw new AppError('not_found');
  return version;
}

// The errors of the held pairs of the approved version against the new one: lessons, hours, kind (checkHeld), the closed units and the half of the plan.
// A closed unit or the exam of the old half is never moved by a new version (final review, I1). The pairs on the rows of the approved version count whoever's they are;
// a line followed by the groups of more than one teacher names the group in each error. ctx: { subjects, groups, line, lines } as read by the request.
export function heldErrors(store, ctx, version, approved, rows, previous, pairs) {
  if (!approved || approved.id === version.id) return [];
  const { subjects, groups, line, lines } = ctx;
  const shared = manyTeachers(subjects, line, lines, version.semester);
  const groupOf = (subjectId) => {
    const subject = subjects.find((s) => s.id === subjectId);
    return (groups.find((g) => subject && g.id === subject.groupId) || { name: '' }).name;
  };
  const closures = store.list('closures');
  const old = approved.planSemester ?? null;
  const errors = checkHeld(rows.topics, previous.topics, pairs, closures, old, { withSubject: shared })
    .map(({ subjectId, ...rest }) => (shared ? { ...rest, group: groupOf(subjectId) } : rest));
  if ((version.planSemester ?? null) !== old) {
    const exams = store.list('subjectExams');
    const attempts = store.list('examAttempts');
    const standing = lineSubjects(subjects, line, lines, version.semester).filter((s) => {
      const inOld = (r) => r.subjectId === s.id && (r.planSemester ?? null) === old;
      return closures.some((c) => inOld(c) && c.reopenedAt === '') || exams.some(inOld) || attempts.some(inOld);
    });
    if (standing.length > 0) {
      const names = [...new Set(standing.map((s) => groupOf(s.id)))].sort(compareNames);
      errors.push({ section: 'title', code: 'semester_closed', ...(shared ? { groups: names } : {}) });
    }
  }
  return errors;
}

// 'syllabus.form' { syllabusId } -> the version, its subject, what the viewer may do, the line, the document and the checks before submitting.
// Who reads it: the deanery, the administrator, the prorector (by rightsOn), and a teacher who is on the syllabus of the discipline (responsible or leads it).
export function draftForm(store, platform, data, user) {
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const lines = store.list('syllabusLines');
  const line = lineOfVersion(lines, version);
  const viewer = viewerOf(user, line, subjects, lines);
  const rights = rightsOn(version, viewer);
  const teacher = user.roles.includes('teacher') && viewer.part !== null;
  if (!(rights.see && (isManager(user) || teacher || user.roles.includes('prorector')))) throw new AppError('forbidden');

  const staff = store.list('staff');
  const groups = store.list('groups');
  const tables = readTables(store, DOC_TABLES);
  const pairs = store.list('pairs');

  const { approved } = versionsOfLine(syllabi, line.id, version.semester);
  const rows = rowsOfVersion(tables, version.id);
  const doc = buildDoc(version, rows);
  const held = approved && approved.id !== version.id
    ? heldErrors(store, { subjects, groups, line, lines }, version, approved, rows, rowsOfVersion(tables, approved.id), pairs) : [];

  const mine = lineGroups({ subjects, groups, staff, syllabusLines: lines }, line, user, version.semester);
  const named = mine.length > 0 ? subjects.find((s) => s.id === mine[0].subjectId) : subjects.find((s) => s.disciplineId === version.disciplineId);
  const author = staff.find((s) => s.id === version.teacherId);

  return {
    today: todayOf(platform),
    syllabus: {
      id: version.id, status: version.status, version: version.version, semester: version.semester, planSemester: version.planSemester ?? null,
      remark: version.remark ?? '', updated: version.updated ?? '', submittedAt: version.submittedAt ?? '', decidedAt: version.decidedAt ?? '',
      copyOfApproved: approved !== null, file: fileMetaOf(store, version),
    },
    subject: {
      id: mine.length > 0 ? mine[0].subjectId : '', name: named ? named.name : '', disciplineId: version.disciplineId, teacherId: version.teacherId,
      teacherName: author ? author.fullName : '', groups: mine,
    },
    can: { edit: rights.edit, submit: rights.submit, approve: rights.approve, giveBack: rights.giveBack },
    line: lineView({ syllabusLines: lines, subjects, staff, groups }, line, user),
    doc,
    checks: checkSubmit(doc, held, groupsOfLine(line, lines, subjects, groups, version.semester)),
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
  const lines = store.list('syllabusLines');
  const viewer = viewerOf(user, lineOfVersion(lines, version), subjects, lines);
  const rights = rightsOn(version, viewer);
  if (!rights.see || !worksOn(viewer)) throw new AppError('forbidden');
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

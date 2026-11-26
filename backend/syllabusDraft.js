// A syllabus draft on the server: start one, read the form, save a section. Every sheet is read at most once per request, writes go in batches.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { SECTIONS, SECTION_TABLES, checkSection, plainId } from '../core/syllabusSections.js';
import { DOC_TABLES, buildDoc, copyRows, draftVersion, rowsOfVersion, sectionWrites } from '../core/syllabusDoc.js';
import { checkHeld, checkSubmit, rightsOn } from '../core/syllabusFlow.js';
import { lineSubjects, nextVersion, openRows, teacherSubjects, versionTeacher, versionsOfLine } from '../core/disciplineSyllabus.js';
import { OPEN_STATUSES } from '../core/schema.js';
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

// Writes the rows of the new versions of a line, one per spec { half, approved, number }: one insertMany for «Силлабусы» and one per sheet of the document
// for the copies of the approved versions. teacherId — the column «teacher» (teacherOfNew); group — the group of an empty draft or null.
// tables: at least `syllabi`; with an approved version in a spec also the sheets of DOC_TABLES. -> [{ half, version, rows }] in the order of the specs
function createDrafts(store, platform, { line, specs, group, userId, teacherId }, tables) {
  const course = group && Number.isInteger(group.course) ? group.course : null;
  const today = todayOf(platform);
  const rows = specs.map(({ half, approved, number }) => {
    const planSemester = course !== null && course >= 1 && course <= 4 ? (course - 1) * 2 + half : null;
    return draftVersion({ line, half, teacherId, approved, planSemester, course, userId, today, number });
  });
  const versions = store.insertMany('syllabi', rows);
  const copies = specs.map(({ approved }) => (approved ? copyRows(rowsOfVersion(tables, approved.id)) : null));
  const written = {};
  for (const name of DOC_TABLES) {
    const all = [];
    copies.forEach((copy, i) => { if (copy) for (const r of copy[name]) all.push({ ...r, syllabusId: versions[i].id }); });
    written[name] = all.length > 0 ? store.insertMany(name, all) : [];
  }
  return specs.map(({ half, approved }, i) => ({
    half, version: versions[i],
    rows: approved ? Object.fromEntries(DOC_TABLES.map((name) => [name, written[name].filter((r) => r.syllabusId === versions[i].id)])) : {},
  }));
}

// The row of a new version of a line in one half of the year and, when the half has an approved version, a copy of its sections.
// number: the number of the version; without it nextVersion. -> { version, rows }
export function createDraft(store, platform, { line, half, approved, group, userId, teacherId, number }, tables) {
  const n = number ?? nextVersion(tables.syllabi, line.id, { disciplineId: line.disciplineId, teacherId });
  const [made] = createDrafts(store, platform, { line, specs: [{ half, approved, number: n }], group, userId, teacherId }, tables);
  return { version: made.version, rows: made.rows };
}

// A half is started when its open row has a row of the plan or the half has an approved version (the draft is its copy).
export function startedOf(version, syllabi, topics) {
  return topics.some((t) => t.syllabusId === version.id) || versionsOfLine(syllabi, version.lineId, version.semester).approved !== null;
}

// The open rows of the line for the halves `halves`; what is not there is made. -> Map(half -> version) with `created` (Set of the halves made now)
// and `rows` (Map half -> the rows copied for it).
//   no open row on the line: a draft for every half that has an approved version (a copy) and for every asked half (empty or a copy), one number (nextVersion);
//   open rows exist: the asked half has one — it is taken; none and a row of the line is on approval — syllabus_locked; else a draft, with the number of an open
//   row of the other half when that is greater than every number of this half, else nextVersion. A line «own» has one half.
// group: the group of an empty draft or null. pairs: the pairs or a function that reads them (only the count of pairs decides the teacher of the version).
// tables: syllabi (+ the sheets of DOC_TABLES when there is something to copy).
export function openDrafts(store, platform, { line, halves, group, user, subjects, pairs }, tables) {
  const syllabi = tables.syllabi;
  const own = line.kind === 'own';
  const lineHalves = own ? [line.semester] : [1, 2];
  const wanted = lineHalves.filter((h) => own || halves.includes(h));
  const state = new Map(lineHalves.map((h) => [h, versionsOfLine(syllabi, line.id, h)]));
  const out = new Map();
  out.created = new Set();
  out.rows = new Map();
  const openNow = lineHalves.map((h) => state.get(h).open).filter(Boolean);
  const teacherId = teacherOfNew(line, subjects, typeof pairs === 'function' ? pairs : () => pairs, user.id);
  const base = nextVersion(syllabi, line.id, { disciplineId: line.disciplineId, teacherId });
  const specs = [];
  if (openNow.length === 0) {
    for (const half of lineHalves) if (wanted.includes(half) || state.get(half).approved) specs.push({ half, approved: state.get(half).approved, number: base });
  } else {
    for (const half of wanted) {
      const { open, approved } = state.get(half);
      if (open) { out.set(half, open); continue; }
      if (openNow.some((s) => s.status === 'review')) throw new AppError('syllabus_locked');
      const here = Math.max(0, ...syllabi.filter((s) => s.lineId === line.id && s.semester === half).map((s) => Number(s.version) || 0));
      const other = Math.max(...openNow.map((s) => Number(s.version) || 0));
      specs.push({ half, approved, number: other > here ? other : base });
    }
  }
  if (specs.length > 0) {
    for (const made of createDrafts(store, platform, { line, specs, group, userId: user.id, teacherId }, tables)) {
      out.set(made.half, made.version);
      out.created.add(made.half);
      out.rows.set(made.half, made.rows);
    }
  }
  return out;
}

// The group of the first subject of the discipline by the name of the group (an empty draft by the discipline has no subject of its own): the group or null.
export function firstGroup(groups, subjects, disciplineId) {
  const ids = new Set(subjects.filter((s) => s.disciplineId === disciplineId).map((s) => s.groupId));
  return groups.filter((g) => ids.has(g.id)).sort((a, b) => compareNames(a.name, b.name) || (a.id < b.id ? -1 : 1))[0] || null;
}

// 'syllabus.startDraft' { subjectId, semester } | { disciplineId, semester } -> { syllabusId, created }
// The line where the draft of the half goes (openLine: the syllabus of the discipline is made when there is none); its open version, else the new versions of
// the halves (openDrafts). By the discipline there is no subject: the teacher of the version is the responsible, an empty draft takes the first group of the discipline.
export function startDraft(store, platform, data, user) {
  if (data.lineId !== undefined) throw new AppError('bad_request');
  const bySubject = data.subjectId !== undefined;
  if (bySubject === (data.disciplineId !== undefined) || !isHalf(data.semester)) throw new AppError('bad_request');
  const id = plainId(bySubject ? data.subjectId : data.disciplineId);
  if (id === null) throw new AppError('bad_request');
  const subjects = store.list('subjects');
  let subject;
  if (bySubject) {
    subject = subjects.find((s) => s.id === id);
    if (!subject) throw new AppError('not_found');
    if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
      throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
    }
  } else {
    if (!store.list('disciplines').some((d) => d.id === id)) throw new AppError('not_found');
    subject = { id: '', disciplineId: id, teacherId: '', groupId: '' };
  }
  const syllabi = store.list('syllabi');
  const rows = { syllabusLines: store.list('syllabusLines'), syllabi, subjects };
  const line = openLine(store, platform, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: data.semester }, user, rows);
  const { approved, open } = versionsOfLine(syllabi, line.id, data.semester);
  if (open) return { syllabusId: open.id, created: false };
  const anyApproved = [1, 2].some((half) => versionsOfLine(syllabi, line.id, half).approved !== null);
  const tables = { syllabi, ...(anyApproved ? readTables(store, DOC_TABLES) : {}) };
  let group = null;
  if (!approved) {
    const groups = store.list('groups');
    group = bySubject ? groups.find((g) => g.id === subject.groupId) || null : firstGroup(groups, subjects, subject.disciplineId);
  }
  const made = openDrafts(store, platform, { line, halves: [data.semester], group, user, subjects, pairs: () => store.list('pairs') }, tables);
  return { syllabusId: made.get(data.semester).id, created: made.created.has(data.semester) };
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
// a line followed by the groups of more than one teacher names the group in each error. ctx: { subjects, groups, line, lines } as read by the request;
// ctx.cache (an object kept by the request) makes the closed units, the exams and the attempts be read once for several versions.
export function heldErrors(store, ctx, version, approved, rows, previous, pairs) {
  if (!approved || approved.id === version.id) return [];
  const { subjects, groups, line, lines } = ctx;
  const shared = manyTeachers(subjects, line, lines, version.semester);
  const groupOf = (subjectId) => {
    const subject = subjects.find((s) => s.id === subjectId);
    return (groups.find((g) => subject && g.id === subject.groupId) || { name: '' }).name;
  };
  const cache = ctx.cache || {};
  const read = (name) => (name in cache ? cache[name] : (cache[name] = store.list(name)));
  const closures = read('closures');
  const old = approved.planSemester ?? null;
  const errors = checkHeld(rows.topics, previous.topics, pairs, closures, old, { withSubject: shared })
    .map(({ subjectId, ...rest }) => (shared ? { ...rest, group: groupOf(subjectId) } : rest));
  if ((version.planSemester ?? null) !== old) {
    const exams = read('subjectExams');
    const attempts = read('examAttempts');
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

// The halves of a version for the form: the open rows of its line, by half; of an approved version — the approved ones.
function halvesOf(syllabi, line, version) {
  const rows = OPEN_STATUSES.includes(version.status)
    ? openRows(syllabi, line.id) : [1, 2].map((half) => versionsOfLine(syllabi, line.id, half).approved).filter(Boolean);
  return rows.map((s) => ({ semester: s.semester, syllabusId: s.id, status: s.status }));
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
    halves: halvesOf(syllabi, line, version),
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

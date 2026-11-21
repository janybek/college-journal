// Uploading the syllabus of «discipline + teacher»: read the sheets once, plan, write in batches, lay the lessons over every group.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate } from '../core/dates.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { planSyllabusUpload, scheduleFit, subjectScope, syllabusFor, syllabusIndex, syllabusTotals } from '../core/syllabus.js';
import { controlMarks, lessonKey, lessonTypeOf, lessonsOf } from '../core/topics.js';
import { versionsOf } from '../core/syllabusFlow.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { FIXED_STATUSES } from '../core/schema.js';
import { can } from '../core/permissions.js';
import { loadSettings, relayout, todayOf } from './scheduleData.js';

const MAX_SHEETS = 10;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A cell is text, a finite number, a boolean or empty: an object or an array would be stored as «[object Object]» or «a,b».
const isCell = (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// The request carries the subject (a plain non-empty string, not trimmed) and 1-10 sheets of cells.
function checkRequest(data) {
  const { subjectId, sheets } = isObject(data) ? data : {};
  if (typeof subjectId !== 'string' || subjectId === '') throw new AppError('bad_request');
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > MAX_SHEETS) throw new AppError('bad_request');
  for (const sheet of sheets) {
    if (!isObject(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.cells) || sheet.cells.some((row) => !Array.isArray(row) || !row.every(isCell))) {
      throw new AppError('bad_request');
    }
  }
  return { subjectId, sheets };
}

// The syllabus belongs to the discipline of the subject and its teacher.
function ownerOf(staff, subject) {
  const teacher = staff.find((s) => s.id === subject.teacherId);
  return { discipline: { id: subject.disciplineId, name: subject.name }, teacher: { id: subject.teacherId, fullName: teacher ? teacher.fullName : '' } };
}

// Where the file goes in each half of the year: the approved version of the key «discipline + teacher», its rows and the held pairs of them.
function planFor(doc, sheets, owner, platform) {
  const { discipline, teacher } = owner;
  const versions = {};
  for (const half of [1, 2]) {
    const { approved } = versionsOf(sheets.syllabi, { disciplineId: discipline.id, teacherId: teacher.id, semester: half });
    if (!approved) continue;
    const rows = sheets.topics.filter((t) => t.syllabusId === approved.id);
    const own = new Set(rows.map((t) => t.id));
    const held = new Map();
    for (const p of sheets.pairs) {
      if (!own.has(p.topicId) || !FIXED_STATUSES.includes(p.status)) continue;
      if (!held.has(p.topicId)) held.set(p.topicId, []);
      held.get(p.topicId).push(p);
    }
    versions[half] = { syllabus: approved, rows, held };
  }
  const groupName = new Map(sheets.groups.map((g) => [g.id, g.name]));
  const groups = sheets.subjects.filter((s) => s.disciplineId === discipline.id && s.teacherId === teacher.id)
    .map((s) => groupName.get(s.groupId) ?? '').filter((name) => name !== '').sort();
  return planSyllabusUpload(doc, { discipline, teacher, versions, today: localDate(platform.now()), groups });
}

// Writes a plan that has no errors: syllabus rows, then topic rows (removed, changed, new), then the lessons of every group of the teacher.
// Sheets are kept as they are after the write, so the layout reads nothing again.
function writePlan(store, platform, plan, sheets, subject) {
  const settings = loadSettings(store);
  const fresh = plan.parts.filter((p) => p.syllabus.id === null);
  const known = plan.parts.filter((p) => p.syllabus.id !== null);

  const created = fresh.length > 0 ? store.insertMany('syllabi', fresh.map((p) => ({ ...p.syllabus.row, status: 'approved', version: 1 }))) : [];
  const changed = known.length > 0 ? store.updateMany('syllabi', known.map((p) => ({ id: p.syllabus.id, patch: p.syllabus.row }))) : [];
  const idOfHalf = new Map([...fresh.map((p, i) => [p.semester, created[i].id]), ...known.map((p) => [p.semester, p.syllabus.id])]);
  const syllabi = [...sheets.syllabi.map((s) => changed.find((c) => c.id === s.id) ?? s), ...created];

  const removed = new Set(plan.parts.flatMap((p) => p.toRemove));
  const updates = plan.parts.flatMap((p) => p.toUpdate);
  const inserts = plan.parts.flatMap((p) => p.toInsert.map((row) => ({ ...row, syllabusId: idOfHalf.get(p.semester) })));
  if (removed.size > 0) store.removeMany('topics', [...removed]);
  const updated = updates.length > 0 ? store.updateMany('topics', updates) : [];
  const added = inserts.length > 0 ? store.insertMany('topics', inserts) : [];
  const byId = new Map(updated.map((t) => [t.id, t]));
  const topics = [...sheets.topics.filter((t) => !removed.has(t.id)).map((t) => byId.get(t.id) ?? t), ...added];

  const ids = sheets.subjects.filter((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId).map((s) => s.id);
  relayout(store, ids, { subjects: sheets.subjects, syllabi, topics, pairs: sheets.pairs, settings });
}

// -> { ok, applied, found, summaries, errors, warnings }. `write`: save the file (when it has no errors), otherwise only check it.
export function uploadSyllabus(store, platform, data, write) {
  const { subjectId, sheets: cells } = checkRequest(data);
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
    throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  }

  const parsed = parseSyllabus(cells);
  if (parsed.doc === null) return { ok: false, applied: false, found: parsed.found, summaries: [], errors: parsed.errors, warnings: parsed.warnings };

  const sheets = { subjects, staff: store.list('staff'), groups: store.list('groups'), syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs') };
  const plan = planFor(parsed.doc, sheets, ownerOf(sheets.staff, subject), platform);
  const errors = [...parsed.errors, ...plan.errors];
  const ok = errors.length === 0;
  const applied = write === true && ok;
  if (applied) writePlan(store, platform, plan, sheets, subject);
  return {
    ok, applied, found: parsed.found, summaries: plan.parts.map((p) => p.summary), errors, warnings: [...parsed.warnings, ...plan.warnings],
  };
}

// For the dev stand: the same plan and the same writes from a ready document. Throws when the plan has errors.
export function saveSyllabusDoc(store, platform, subjectId, doc) {
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject || !subject.disciplineId) throw new Error(`saveSyllabusDoc: no subject with a discipline: ${subjectId}`);
  const sheets = { subjects, staff: store.list('staff'), groups: store.list('groups'), syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs') };
  const plan = planFor(doc, sheets, ownerOf(sheets.staff, subject), platform);
  if (plan.errors.length > 0) throw new Error('saveSyllabusDoc: ' + JSON.stringify(plan.errors));
  writePlan(store, platform, plan, sheets, subject);
}

// ---- Reading: the page of a syllabus and the subjects of a student. Every sheet is read once; nothing is written. ----

const MANAGER_ROLES = ['admin', 'dean', 'prorector'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hours = (v) => Number(v) || 0;
const nullable = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The semester of the year to show: the asked one, else the current one if it has a syllabus, else the only one there is, else the current.
function shownSemester(asked, current, loaded) {
  if (asked !== undefined) return asked;
  if (loaded.some((s) => s.semester === current)) return current;
  return loaded.length === 1 ? loaded[0].semester : current;
}

// One row of the page: fields by name, hours as numbers, the pairs of THIS subject that stand on it. Besides the fields of a lesson
// the row keeps the earlier fields (kind, label, lectureHours, practiceHours, practiceKind) for the screens that still read them.
function pageRow(row, own, marks, numbers) {
  const mine = [];
  for (const p of own) {
    if (p.status === 'cancelled' || p.status === 'missed' || !p.topicId) continue;
    const onRow = p.topicId === row.id || (marks.get(lessonKey(p)) || []).includes(row);
    if (onRow) mine.push(p);
  }
  mine.sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot);
  const type = lessonTypeOf(row);
  return {
    id: row.id, lessonKind: row.lessonKind, number: numbers.get(row.id), unit: row.unit, unitTitle: row.unitTitle ?? '', name: row.name,
    hours: hours(row.hours), controlForms: row.controlForms ?? '', selfHours: nullable(row.selfHours), description: row.description,
    kind: type === 'control' ? 'control' : 'topic', label: '', lectureHours: type === 'lecture' ? hours(row.hours) : 0,
    practiceHours: type === 'practice' || type === 'control' ? hours(row.hours) : 0,
    practiceKind: row.lessonKind === 'seminar' || row.lessonKind === 'lab' ? row.lessonKind : '',
    planned: lessonsOf([row]).length,
    pairs: mine.map((p) => ({ date: p.date, lessonType: p.lessonType, part: p.part, status: p.status })),
  };
}

// 'syllabus.get': the syllabus of the subject's discipline and teacher, with the dates of THIS subject's group.
export function syllabusPage(store, platform, data, user) {
  const { subjectId, semester: asked } = data;
  if (typeof subjectId !== 'string') throw new AppError('bad_request');
  if (asked !== undefined && asked !== 1 && asked !== 2) throw new AppError('bad_request');

  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  const groups = store.list('groups');
  const staff = store.list('staff');
  const syllabi = store.list('syllabi');
  const topics = store.list('topics');
  const pairs = store.list('pairs');
  const settings = loadSettings(store);

  const isManager = user.roles.some((r) => MANAGER_ROLES.includes(r));
  const isTeacher = user.kind === 'staff' && user.roles.includes('teacher');
  const isOwnTeacher = isTeacher && subject.teacherId === user.id;
  const covers = isTeacher && pairs.some((p) => p.subjectId === subject.id && p.teacherId === user.id);
  const ownGroup = user.kind === 'student' && typeof subject.groupId === 'string' && subject.groupId !== '' && subject.groupId === user.row.groupId;
  if (!(isManager || isOwnTeacher || covers || ownGroup)) throw new AppError('forbidden');

  const groupName = (id) => (groups.find((g) => g.id === id) || { name: '' }).name;
  const group = groups.find((g) => g.id === subject.groupId);
  const teacher = staff.find((s) => s.id === subject.teacherId);
  const hasDiscipline = typeof subject.disciplineId === 'string' && subject.disciplineId !== '';
  const sameCourse = hasDiscipline ? subjects.filter((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId) : [subject];
  const seeAllGroups = isManager || isOwnTeacher;
  const shownGroups = (seeAllGroups ? sameCourse : [subject])
    .map((s) => ({ subjectId: s.id, groupName: groupName(s.groupId) }))
    .sort((a, b) => cmp(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));

  const loaded = hasDiscipline
    ? syllabi.filter((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId && s.status === 'approved')
      .map((s) => ({ semester: s.semester, planSemester: s.planSemester })).sort((a, b) => a.semester - b.semester)
    : [];
  const semester = shownSemester(asked, settings.semester, loaded);

  const index = syllabusIndex(syllabi, topics);
  const row = syllabusFor(subject, syllabi, semester);
  const rows = row ? index.topicsOf.get(row.id) || [] : [];
  const own = pairs.filter((p) => p.subjectId === subject.id);
  let syllabus = null;
  if (row) {
    const marks = controlMarks(rows);
    const numbers = lessonNumbers(rows);
    const current = semester === settings.semester;
    syllabus = {
      planSemester: row.planSemester, audience: row.audience, credits: row.credits, totalHours: row.totalHours,
      classHours: row.classHours, selfHours: row.selfHours, updated: row.updated,
      rows: rows.map((r) => pageRow(r, own, marks, numbers)),
      totals: syllabusTotals(rows),
      schedule: current ? scheduleFit(rows, own, settings, subjectScope(subject, own, index, settings).skip) : null,
    };
  }
  return {
    today: todayOf(platform), currentSemester: settings.semester,
    subject: {
      id: subject.id, name: subject.name, disciplineId: subject.disciplineId, groupId: subject.groupId, groupName: group ? group.name : '',
      course: group ? group.course : null, teacherId: subject.teacherId, teacherName: teacher ? teacher.fullName : '',
    },
    groups: shownGroups, semesters: loaded, semester, canUpload: can(user.roles, 'syllabus.apply'), syllabus,
  };
}

// 'student.subjects': the subjects of the student's group by name; a syllabus exists when the teacher has one for the discipline in any semester.
export function studentSubjects(store, user) {
  const subjects = store.list('subjects');
  const staff = store.list('staff');
  const syllabi = store.list('syllabi');
  const groupId = user.row.groupId;
  const mine = typeof groupId === 'string' && groupId !== '' ? subjects.filter((s) => s.groupId === groupId) : [];
  const teacherName = (id) => (staff.find((s) => s.id === id) || { fullName: '' }).fullName;
  const has = (s) => typeof s.disciplineId === 'string' && s.disciplineId !== '' && syllabi.some((y) => y.disciplineId === s.disciplineId && y.teacherId === s.teacherId && y.status === 'approved');
  return {
    subjects: mine.sort((a, b) => cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase()) || cmp(a.id, b.id))
      .map((s) => ({ id: s.id, name: s.name, teacherName: teacherName(s.teacherId), hasSyllabus: has(s) })),
  };
}

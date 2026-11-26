// Reading: the page of a syllabus and the subjects of a student. Every sheet is read once; nothing is written.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { scheduleFit, subjectScope, syllabusIndex, syllabusTotals } from '../core/syllabus.js';
import { controlMarks, lessonKey, lessonsOf } from '../core/topics.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { DOC_TABLES, buildDoc, rowsOfVersion } from '../core/syllabusDoc.js';
import { rightsOn } from '../core/syllabusFlow.js';
import { draftTarget, lineFor, partOf, versionsOfLine } from '../core/disciplineSyllabus.js';
import { loadSettings, todayOf } from './scheduleData.js';
import { fileMetaOf, readTables } from './syllabusDraft.js';
import { lineGroups, lineView, viewerOf } from './syllabusLines.js';

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

// One row of the page: fields by name, hours as numbers, the pairs of THIS subject that stand on it.
function pageRow(row, own, marks, numbers) {
  const mine = [];
  for (const p of own) {
    if (p.status === 'cancelled' || p.status === 'missed' || !p.topicId) continue;
    const onRow = p.topicId === row.id || (marks.get(lessonKey(p)) || []).includes(row);
    if (onRow) mine.push(p);
  }
  mine.sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot);
  return {
    id: row.id, lessonKind: row.lessonKind, number: numbers.get(row.id), unit: row.unit, unitTitle: row.unitTitle ?? '', name: row.name,
    hours: hours(row.hours), controlForms: row.controlForms ?? '', selfHours: nullable(row.selfHours), description: row.description,
    planned: lessonsOf([row]).length,
    pairs: mine.map((p) => ({ date: p.date, lessonType: p.lessonType, part: p.part, status: p.status })),
  };
}

// The page of one version: the earlier summary fields stay for the screens that still read them; the sections come from the document.
function shownVersion(store, version, rows, own, settings, subject, index, current) {
  const marks = controlMarks(rows.topics);
  const numbers = lessonNumbers(rows.topics);
  const doc = buildDoc(version, rows);
  return {
    id: version.id, planSemester: version.planSemester, audience: version.audience, credits: version.credits, totalHours: version.totalHours,
    classHours: version.classHours, selfHours: version.selfHours, updated: version.updated,
    rows: rows.topics.map((r) => pageRow(r, own, marks, numbers)),
    totals: syllabusTotals(rows.topics),
    schedule: current ? scheduleFit(rows.topics, own, settings, subjectScope(subject, own, index, settings).skip) : null,
    title: doc.title, goals: doc.goals, selfWork: doc.selfWork, literature: doc.literature, software: doc.software, policies: doc.policies, units: doc.units,
    file: fileMetaOf(store, version),
  };
}

// 'syllabus.get' { subjectId, semester?, version? }: the syllabus of the line the subject follows (the syllabus of the discipline), with the dates of THIS subject's group.
// version: 'approved' (default) or 'open'.
export function syllabusPage(store, platform, data, user) {
  const { subjectId, disciplineId, semester: asked, version: want = 'approved' } = data;
  const byDiscipline = disciplineId !== undefined;
  if (byDiscipline === (subjectId !== undefined) || typeof (byDiscipline ? disciplineId : subjectId) !== 'string') throw new AppError('bad_request');
  if (asked !== undefined && asked !== 1 && asked !== 2) throw new AppError('bad_request');
  if (want !== 'approved' && want !== 'open') throw new AppError('bad_request');

  const subjects = store.list('subjects');
  let subject;
  if (byDiscipline) {
    // the page of the syllabus of a discipline needs no subject: the deanery, the administrator, the prorector and the teachers of the discipline read it
    if (user.kind !== 'staff') throw new AppError('forbidden');
    const discipline = store.list('disciplines').find((d) => d.id === disciplineId);
    if (!discipline) throw new AppError('not_found');
    subject = { id: '', name: discipline.name, disciplineId, groupId: '', teacherId: '' };
  } else {
    subject = subjects.find((s) => s.id === subjectId);
    if (!subject) throw new AppError('not_found');
  }
  const groups = store.list('groups');
  const staff = store.list('staff');
  const syllabi = store.list('syllabi');
  const lines = store.list('syllabusLines');
  const pairs = store.list('pairs');
  const settings = loadSettings(store);
  const tables = readTables(store, DOC_TABLES);

  const isManager = user.roles.some((r) => MANAGER_ROLES.includes(r));
  const isTeacher = user.kind === 'staff' && user.roles.includes('teacher');
  const isOwnTeacher = isTeacher && subject.teacherId === user.id;
  const covers = isTeacher && pairs.some((p) => p.subjectId === subject.id && p.teacherId === user.id);
  const isStudent = user.kind === 'student';
  const ownGroup = isStudent && typeof subject.groupId === 'string' && subject.groupId !== '' && subject.groupId === user.row.groupId;
  if (!byDiscipline && !(isManager || isOwnTeacher || covers || ownGroup)) throw new AppError('forbidden');

  const groupName = (id) => (groups.find((g) => g.id === id) || { name: '' }).name;
  const group = groups.find((g) => g.id === subject.groupId);
  const teacher = staff.find((s) => s.id === subject.teacherId);
  const hasDiscipline = typeof subject.disciplineId === 'string' && subject.disciplineId !== '';
  const seeAllGroups = isManager || isOwnTeacher;

  // both halves of the year: the line the subject follows, its approved version of the half, the open one and what this person may do with the open one
  const halves = {};
  for (const half of [1, 2]) {
    const lineId = hasDiscipline ? lineFor(lines, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: half }) : null;
    const line = lineId === null ? null : lines.find((l) => l.id === lineId) || null;
    const { approved, open } = line ? versionsOfLine(syllabi, line.id, half) : { approved: null, open: null };
    halves[half] = { line, approved, open, rights: open ? rightsOn(open, viewerOf(user, line, subjects, lines)) : null };
  }
  // by the discipline a teacher reads it when he is on the line of a half (responsible or leads it), nobody else but the staff who see everything
  if (byDiscipline && !isManager && !(isTeacher && [1, 2].some((h) => halves[h].line && partOf(halves[h].line, user.id, subjects, lines) !== null))) {
    throw new AppError('forbidden');
  }
  const seenOpen = (half) => halves[half].rights !== null && halves[half].rights.see;
  // the half hidden from a student stays in the list: else he would be shown the other half instead of «updating»
  const loaded = [1, 2].filter((h) => halves[h].approved || seenOpen(h))
    .map((h) => ({ semester: h, planSemester: (halves[h].approved || halves[h].open).planSemester }));
  const semester = shownSemester(asked, settings.semester, loaded);
  const { line, approved, open } = halves[semester];

  // the groups: the staff who see everything get every group of the line (the teachers are named when there are several), a teacher his own, the others only this one
  const sameCourse = hasDiscipline ? subjects.filter((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId) : [subject];
  let shownGroups;
  if (byDiscipline) shownGroups = line ? lineGroups({ subjects, groups, staff, syllabusLines: lines }, line, user, semester) : [];
  else if (line && seeAllGroups) shownGroups = lineGroups({ subjects, groups, staff, syllabusLines: lines }, line, user, semester, subject);
  else {
    shownGroups = (seeAllGroups ? sameCourse : [subject])
      .map((s) => ({ subjectId: s.id, groupName: groupName(s.groupId) }))
      .sort((a, b) => cmp(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId));
  }

  // a new draft of the half: where it would go and whether this person may start it (draftTarget; a student never)
  const mayCreate = hasDiscipline && !isStudent
    && draftTarget(lines, syllabi, subjects, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester }, user).code === 'ok';
  let shown = 'approved';
  let version = approved;
  let hidden = false;
  if (want === 'open') {
    // nobody but the deanery, the administrator and the teacher of the subject may learn that an open version does not exist
    if (seenOpen(semester)) version = open;
    else if (user.roles.includes('admin') || user.roles.includes('dean') || isOwnTeacher) version = null;
    else throw new AppError('forbidden');
    shown = 'open';
  } else if (isStudent && approved && open && open.status === 'review') {
    hidden = true;
    version = null;
  }

  const index = syllabusIndex(syllabi, tables.topics, lines);
  let syllabus = null;
  if (version) {
    const own = shown === 'open' ? [] : pairs.filter((p) => p.subjectId === subject.id);
    syllabus = shownVersion(store, version, rowsOfVersion(tables, version.id), own, settings, subject, index, !byDiscipline && shown === 'approved' && semester === settings.semester);
  }
  const rights = halves[semester].rights || { edit: false, submit: false, approve: false, giveBack: false };
  const can = {
    fill: mayCreate && !approved && !open, edit: open ? rights.edit : mayCreate,
    submit: rights.submit, approve: rights.approve, giveBack: rights.giveBack,
  };
  return {
    today: todayOf(platform), currentSemester: settings.semester,
    subject: {
      id: subject.id, name: subject.name, disciplineId: subject.disciplineId, groupId: subject.groupId, groupName: group ? group.name : '',
      course: group ? group.course : null, teacherId: subject.teacherId, teacherName: teacher ? teacher.fullName : '',
    },
    groups: shownGroups, semesters: loaded, semester, shown, hidden,
    ...(line ? { line: lineView({ syllabusLines: lines, subjects, staff, groups }, line, user, subject) } : {}),
    state: {
      approved: approved ? { version: approved.version, decidedAt: approved.decidedAt ?? '' } : null,
      open: seenOpen(semester)
        ? { syllabusId: open.id, status: open.status, version: open.version, remark: open.remark ?? '', submittedAt: open.submittedAt ?? '', updated: open.updated ?? '' }
        : null,
    },
    can, syllabus,
  };
}

// 'student.subjects': the subjects of the student's group by name; a syllabus exists when the teacher has one for the discipline in any semester.
// hasSyllabus: an approved version of a half of the year is shown; updating: none is shown, but one is hidden while its new version is under review.
export function studentSubjects(store, user) {
  const subjects = store.list('subjects');
  const staff = store.list('staff');
  const syllabi = store.list('syllabi');
  const lines = store.list('syllabusLines');
  const groupId = user.row.groupId;
  const mine = typeof groupId === 'string' && groupId !== '' ? subjects.filter((s) => s.groupId === groupId) : [];
  const teacherName = (id) => (staff.find((s) => s.id === id) || { fullName: '' }).fullName;
  // the approved versions of both halves of the year on the line the subject follows: 'shown', 'hidden' (the open version of that half is under review) or null
  const states = (s) => (typeof s.disciplineId === 'string' && s.disciplineId !== '' ? [1, 2] : []).map((semester) => {
    const { approved, open } = versionsOfLine(syllabi, lineFor(lines, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester }), semester);
    if (approved === null) return null;
    return open !== null && open.status === 'review' ? 'hidden' : 'shown';
  });
  const row = (s) => {
    const halves = states(s);
    const hasSyllabus = halves.includes('shown');
    return { id: s.id, name: s.name, teacherName: teacherName(s.teacherId), hasSyllabus, updating: !hasSyllabus && halves.includes('hidden') };
  };
  return { subjects: mine.sort((a, b) => cmp(String(a.name).toLowerCase(), String(b.name).toLowerCase()) || cmp(a.id, b.id)).map(row) };
}

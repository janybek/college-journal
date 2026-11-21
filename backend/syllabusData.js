// Reading: the page of a syllabus and the subjects of a student. Every sheet is read once; nothing is written.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { scheduleFit, subjectScope, syllabusFor, syllabusIndex, syllabusTotals } from '../core/syllabus.js';
import { controlMarks, lessonKey, lessonTypeOf, lessonsOf } from '../core/topics.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { can } from '../core/permissions.js';
import { loadSettings, todayOf } from './scheduleData.js';

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

// Assignments (homework and self-work) as the staff sees them: overview, list, give, change, remove, read.
// Only the teacher of the subject gives, changes and removes; the office reads. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { syllabusFor } from '../core/syllabus.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { compareNames } from '../core/names.js';
import { checkAssignment, currentAttempt, workState } from '../core/work.js';
import { closedUnitsOf } from '../core/ledger.js';
import { viewerOf } from './journalData.js';

export const WORK_TABLES = ['subjects', 'groups', 'staff', 'students', 'syllabi', 'syllabusMembers', 'topics', 'units', 'settings', 'pairs', 'assignments', 'submissions', 'files', 'closures'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const LESSON_LETTER = { lecture: 'Л', practice: 'П', control: 'М', seminar: 'С', lab: 'ЛР' };

// Every table of the assignments, each read once. `settings` stays the rows of the sheet.
export function readWorkRows(store) {
  const rows = {};
  for (const table of WORK_TABLES) rows[table] = store.list(table);
  return rows;
}

// True when the assignment is self-work of a closed unit: nobody changes it, nobody hands it in.
export function srsClosed(rows, assignment) {
  if (assignment.kind !== 'srs' || !Number.isInteger(assignment.unit)) return false;
  return closedUnitsOf(rows.closures, assignment.subjectId, assignment.planSemester ?? null).units.includes(assignment.unit);
}

// -> { read, manage }: manage is the teacher of the subject now; read adds the office.
export function subjectRights(subject, user) {
  const viewer = viewerOf(user);
  const manage = viewer.teacher && subject.teacherId === viewer.id;
  return { read: manage || viewer.manager || viewer.reader, manage };
}

export function isCurrent(assignment, settings) {
  return settings.semesterStart === '' || assignment.dueAt.slice(0, 10) >= settings.semesterStart;
}

const isStr = (v) => typeof v === 'string';

function subjectOf(rows, id) {
  const subject = isStr(id) ? rows.subjects.find((s) => s.id === id) : undefined;
  if (!subject) throw new AppError('not_found');
  return subject;
}

function assignmentOf(rows, id) {
  const assignment = isStr(id) ? rows.assignments.find((a) => a.id === id) : undefined;
  if (!assignment) throw new AppError('not_found');
  return assignment;
}

// The subject of the assignment with the rights of the user on it.
function rightsOf(rows, assignment, user) {
  const subject = rows.subjects.find((s) => s.id === assignment.subjectId);
  if (!subject) throw new AppError('not_found');
  return { subject, rights: subjectRights(subject, user) };
}

const nameOf = (list, id) => (list.find((r) => r.id === id) || { fullName: '' }).fullName;
const groupNameOf = (rows, subject) => (rows.groups.find((g) => g.id === subject.groupId) || { name: '' }).name;

// attempts of one assignment: studentId -> its attempts
function attemptsByStudent(rows, assignmentId) {
  const map = new Map();
  for (const row of rows.submissions) {
    if (row.assignmentId !== assignmentId) continue;
    if (!map.has(row.studentId)) map.set(row.studentId, []);
    map.get(row.studentId).push(row);
  }
  return map;
}

// The units and the topics of the current approved syllabus of the subject (empty without one).
function planOf(rows, subject, settings) {
  const syllabus = syllabusFor(subject, rows.syllabi, settings.semester, rows.syllabusMembers);
  const topics = syllabus ? rows.topics.filter((t) => t.syllabusId === syllabus.id).sort((a, b) => a.order - b.order) : [];
  const titles = new Map(syllabus ? rows.units.filter((u) => u.syllabusId === syllabus.id).map((u) => [u.unit, u.title ?? '']) : []);
  const numbers = syllabus ? lessonNumbers(topics) : new Map();
  const units = [...new Set(topics.map((t) => t.unit))].sort((a, b) => a - b).map((unit) => ({ unit, title: titles.get(unit) ?? '' }));
  return { syllabus, topics, units, numbers };
}

export function workOverview(store, platform, user) {
  const rows = readWorkRows(store);
  const nowMs = platform.now();
  const settings = readSettings(rows.settings);
  const subjects = [];
  for (const subject of rows.subjects) {
    const rights = subjectRights(subject, user);
    if (!rights.read) continue;
    const current = rows.assignments.filter((a) => a.subjectId === subject.id && isCurrent(a, settings));
    let toCheck = 0;
    for (const a of current) {
      for (const list of attemptsByStudent(rows, a.id).values()) {
        const last = currentAttempt(list);
        if (last && last.status === 'submitted') toCheck += 1;
      }
    }
    subjects.push({
      subjectId: subject.id, name: subject.name, groupName: groupNameOf(rows, subject), teacherName: nameOf(rows.staff, subject.teacherId),
      own: rights.manage, assignments: current.length, toCheck,
    });
  }
  subjects.sort((a, b) => compareNames(a.groupName, b.groupName) || compareNames(a.name, b.name) || cmp(a.subjectId, b.subjectId));
  return { today: localDate(nowMs), subjects };
}

export function workList(store, platform, data, user) {
  const rows = readWorkRows(store);
  const subject = subjectOf(rows, data.subjectId);
  const rights = subjectRights(subject, user);
  if (!rights.read) throw new AppError('forbidden');
  const nowMs = platform.now();
  const settings = readSettings(rows.settings);
  const plan = planOf(rows, subject, settings);
  const topicOf = new Map(rows.topics.map((t) => [t.id, t]));
  const active = rows.students.filter((s) => s.groupId === subject.groupId && s.active === true);

  const assignments = rows.assignments.filter((a) => a.subjectId === subject.id).map((a) => {
    const byStudent = attemptsByStudent(rows, a.id);
    const counts = { total: active.length, none: 0, submitted: 0, checked: 0, returned: 0 };
    for (const student of active) {
      const state = workState(a, currentAttempt(byStudent.get(student.id) || []), nowMs).state;
      counts[state] += 1;
    }
    const topic = a.topicId ? topicOf.get(a.topicId) : undefined;
    return {
      id: a.id, kind: a.kind, unit: a.unit, topicId: a.topicId, topicName: topic ? topic.name : '', pairId: a.pairId, title: a.title, dueAt: a.dueAt,
      maxPoints: a.maxPoints, current: isCurrent(a, settings), locked: byStudent.size > 0, counts,
      ...(srsClosed(rows, a) ? { closed: true } : {}),
    };
  }).sort((a, b) => cmp(b.dueAt, a.dueAt) || cmp(a.id, b.id));

  return {
    today: localDate(nowMs), now: localDateTime(nowMs),
    subject: {
      id: subject.id, name: subject.name, groupName: groupNameOf(rows, subject), teacherName: nameOf(rows.staff, subject.teacherId),
      planSemester: plan.syllabus && Number.isInteger(plan.syllabus.planSemester) ? plan.syllabus.planSemester : null, hasSyllabus: plan.syllabus !== null,
    },
    can: { manage: rights.manage },
    units: plan.units,
    topics: plan.topics.map((t) => ({ id: t.id, unit: t.unit, name: t.name, number: (LESSON_LETTER[t.lessonKind] || '') + plan.numbers.get(t.id) })),
    assignments,
  };
}

const FIELDS = ['kind', 'unit', 'topicId', 'title', 'description', 'dueAt', 'maxPoints'];

export function saveAssignment(store, platform, data, user) {
  const rows = readWorkRows(store);
  const subject = subjectOf(rows, data.subjectId);
  if (!subjectRights(subject, user).manage) throw new AppError('forbidden');
  const nowMs = platform.now();
  const at = localDateTime(nowMs);
  const settings = readSettings(rows.settings);
  const plan = planOf(rows, subject, settings);

  let old = null;
  let attempts = [];
  if (data.id !== undefined) {
    old = assignmentOf(rows, data.id);
    if (old.subjectId !== subject.id) throw new AppError('bad_request');
    attempts = rows.submissions.filter((r) => r.assignmentId === old.id);
    if (srsClosed(rows, old)) throw new AppError('unit_closed');
  }

  // a pair gives its own topic and the unit of the topic; the data of the request for them are not read
  let input = data;
  let pair = null;
  if (old === null && data.pairId !== undefined) {
    pair = isStr(data.pairId) ? rows.pairs.find((p) => p.id === data.pairId && p.subjectId === subject.id) : undefined;
    if (!pair) throw new AppError('not_found');
    const topic = pair.topicId ? rows.topics.find((t) => t.id === pair.topicId) : undefined;
    if (topic) input = { ...data, topicId: topic.id, unit: topic.unit };
  }

  const locked = attempts.length > 0;
  const given = attempts.filter((a) => Number.isInteger(a.points)).map((a) => a.points);
  const maxGiven = given.length > 0 ? Math.max(...given) : null;
  const { value, problems } = checkAssignment(input, {
    units: plan.units.map((u) => u.unit), topics: plan.topics.map((t) => ({ id: t.id, unit: t.unit })), nowMs, old, locked, maxGiven,
  });
  if (problems.length > 0) throw new AppError('invalid', { fields: problems });
  const planSemester = old ? old.planSemester ?? null : plan.syllabus && Number.isInteger(plan.syllabus.planSemester) ? plan.syllabus.planSemester : null;
  if (srsClosed(rows, { subjectId: subject.id, planSemester, kind: value.kind, unit: value.unit })) throw new AppError('unit_closed');

  if (old === null) {
    const [row] = store.insertMany('assignments', [{
      subjectId: subject.id, ...value, planSemester,
      pairId: pair ? pair.id : '', createdBy: user.id, createdAt: at, updatedBy: '', updatedAt: '',
    }]);
    return { assignment: { id: row.id } };
  }

  const patch = {};
  for (const field of FIELDS) if (value[field] !== old[field]) patch[field] = value[field];
  if (Object.keys(patch).length === 0) return { assignment: { id: old.id } };
  store.updateMany('assignments', [{ id: old.id, patch: { ...patch, updatedBy: user.id, updatedAt: at } }]);
  if (locked) {
    const log = ['maxPoints', 'dueAt'].filter((field) => field in patch).map((field) => ({
      at, actorId: user.id, entity: 'work', assignmentId: old.id, subjectId: subject.id, studentId: '', unit: old.unit,
      field, before: String(old[field]), after: String(patch[field]), reason: '', late: false, pairId: '',
    }));
    if (log.length > 0) store.insertMany('changeLog', log);
  }
  return { assignment: { id: old.id } };
}

export function removeAssignment(store, platform, data, user) {
  const rows = readWorkRows(store);
  const assignment = assignmentOf(rows, data.assignmentId);
  const { rights } = rightsOf(rows, assignment, user);
  if (!rights.manage) throw new AppError('forbidden');
  if (srsClosed(rows, assignment)) throw new AppError('unit_closed');
  if (rows.submissions.some((r) => r.assignmentId === assignment.id)) throw new AppError('in_use');
  store.removeMany('assignments', [assignment.id]);
  const pending = rows.files.filter((f) => f.assignmentId === assignment.id && f.state === 'pending');
  if (pending.length > 0) store.updateMany('files', pending.map((f) => ({ id: f.id, patch: { state: 'dropped' } })));
  return {};
}

// The topic of the assignment and the title of its unit in the syllabus it follows.
export function assignmentPlace(rows, subject, assignment, settings) {
  const topic = assignment.topicId ? rows.topics.find((t) => t.id === assignment.topicId) : undefined;
  const syllabus = topic ? rows.syllabi.find((s) => s.id === topic.syllabusId) : syllabusFor(subject, rows.syllabi, settings.semester, rows.syllabusMembers);
  const unitRow = syllabus ? rows.units.find((u) => u.syllabusId === syllabus.id && u.unit === assignment.unit) : undefined;
  return { topic, unitTitle: unitRow ? unitRow.title ?? '' : '' };
}

// The answer of 'work.get' to the staff: the students of the group with their attempts. Pending and dropped files are never shown.
export function staffWorkView(rows, platform, assignment, user) {
  const { subject, rights } = rightsOf(rows, assignment, user);
  if (!rights.read) throw new AppError('forbidden');
  const nowMs = platform.now();
  const settings = readSettings(rows.settings);
  const byStudent = attemptsByStudent(rows, assignment.id);
  const { topic, unitTitle } = assignmentPlace(rows, subject, assignment, settings);
  const shut = srsClosed(rows, assignment);

  const filesOf = new Map();
  for (const f of rows.files) {
    if (f.state !== 'attached' || f.assignmentId !== assignment.id) continue;
    if (!filesOf.has(f.submissionId)) filesOf.set(f.submissionId, []);
    filesOf.get(f.submissionId).push(f);
  }
  const attemptView = (a) => ({
    id: a.id, n: a.n, text: a.text, paper: a.paper === true, submittedAt: a.submittedAt, late: a.paper !== true && a.submittedAt > assignment.dueAt,
    status: a.status, points: a.points ?? null, comment: a.comment, checkedAt: a.checkedAt, checkedByName: a.checkedBy ? nameOf(rows.staff, a.checkedBy) : '',
    files: (filesOf.get(a.id) || []).sort((x, y) => cmp(x.at, y.at) || cmp(x.id, y.id)).map((f) => ({ id: f.id, name: f.name, kind: f.kind, size: f.size })),
  });
  const studentView = (s, left) => {
    const list = byStudent.get(s.id) || [];
    const last = currentAttempt(list);
    const state = workState(assignment, last, nowMs);
    return {
      id: s.id, fullName: s.fullName, left, state: state.state, late: state.late, overdue: state.overdue,
      points: last && last.status === 'checked' ? last.points ?? null : null,
      attempts: [...list].sort((x, y) => y.n - x.n || cmp(y.id, x.id)).map(attemptView),
    };
  };
  const byName = (a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id);
  const listed = rows.students.filter((s) => s.groupId === subject.groupId && s.active === true).sort(byName);
  const listedIds = new Set(listed.map((s) => s.id));
  const left = rows.students.filter((s) => !listedIds.has(s.id) && byStudent.has(s.id)).sort(byName);

  return {
    now: localDateTime(nowMs),
    assignment: {
      id: assignment.id, subjectId: subject.id, subjectName: subject.name, groupName: groupNameOf(rows, subject), teacherName: nameOf(rows.staff, subject.teacherId),
      kind: assignment.kind, unit: assignment.unit, unitTitle, topicId: assignment.topicId, topicName: topic ? topic.name : '',
      title: assignment.title, description: assignment.description, dueAt: assignment.dueAt, maxPoints: assignment.maxPoints, createdAt: assignment.createdAt,
      locked: byStudent.size > 0,
    },
    can: shut ? { manage: false, grade: false, ...(rights.manage ? { request: true } : {}) } : { manage: rights.manage, grade: rights.manage },
    ...(shut ? { closed: true } : {}),
    students: [...listed.map((s) => studentView(s, false)), ...left.map((s) => studentView(s, true))],
  };
}

// Work of a student: his tasks, the view of one task, handing in. Only his own rows ever reach the answer.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime, parseLocalDateTime } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { FILE_LIMITS } from '../core/files.js';
import { WORK, currentAttempt, taskCounts, workState } from '../core/work.js';
import { assignmentPlace, isCurrent, readWorkRows } from './workData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isStr = (v) => typeof v === 'string';
const ORDER = { returned: 0, none: 1, submitted: 2, checked: 3 };

// The assignment of the request and its subject, when the subject is one of the group of the student now; else `not_found`.
export function studentTask(rows, id, user) {
  const assignment = isStr(id) ? rows.assignments.find((a) => a.id === id) : undefined;
  const subject = assignment ? rows.subjects.find((s) => s.id === assignment.subjectId) : undefined;
  if (!assignment || !subject || subject.groupId !== user.row.groupId) throw new AppError('not_found');
  return { assignment, subject };
}

// A pending file is usable for 24 hours; after that the sweep may take it (the same count as the sweep: older = more than 24 hours).
export function isYoung(file, nowMs) {
  return nowMs - parseLocalDateTime(file.at) <= FILE_LIMITS.keepPendingMs;
}

const byAt = (x, y) => cmp(x.at, y.at) || cmp(x.id, y.id);
const fileView = (f) => ({ id: f.id, name: f.name, kind: f.kind, size: f.size });

export function workMine(store, platform, user) {
  const rows = readWorkRows(store);
  const nowMs = platform.now();
  const settings = readSettings(rows.settings);
  const subjects = new Map(rows.subjects.filter((s) => s.groupId === user.row.groupId).map((s) => [s.id, s]));
  const attempts = new Map();
  for (const r of rows.submissions) {
    if (r.studentId !== user.id) continue;
    if (!attempts.has(r.assignmentId)) attempts.set(r.assignmentId, []);
    attempts.get(r.assignmentId).push(r);
  }
  const tasks = [];
  for (const a of rows.assignments) {
    const subject = subjects.get(a.subjectId);
    if (!subject || !isCurrent(a, settings)) continue;
    const last = currentAttempt(attempts.get(a.id) || []);
    const { state, late, overdue } = workState(a, last, nowMs);
    tasks.push({
      id: a.id, subjectId: subject.id, subjectName: subject.name, kind: a.kind, unit: a.unit, title: a.title, dueAt: a.dueAt, maxPoints: a.maxPoints,
      state, late, overdue, points: state === 'checked' ? last.points ?? null : null,
    });
  }
  tasks.sort((a, b) => ORDER[a.state] - ORDER[b.state] || cmp(a.dueAt, b.dueAt) || cmp(a.id, b.id));
  return { today: localDate(nowMs), now: localDateTime(nowMs), counts: taskCounts(tasks, nowMs), tasks };
}

// The answer of 'work.get' to the student: the task, his attempts with their files, his pending files of this task.
export function studentWorkView(rows, platform, assignment, user) {
  const { subject } = studentTask(rows, assignment.id, user);
  const nowMs = platform.now();
  const settings = readSettings(rows.settings);
  const { topic, unitTitle } = assignmentPlace(rows, subject, assignment, settings);
  const teacher = rows.staff.find((s) => s.id === subject.teacherId);

  const own = rows.files.filter((f) => f.ownerId === user.id && f.assignmentId === assignment.id);
  const filesOf = new Map();
  for (const f of own.filter((x) => x.state === 'attached').sort(byAt)) {
    if (!filesOf.has(f.submissionId)) filesOf.set(f.submissionId, []);
    filesOf.get(f.submissionId).push(fileView(f));
  }
  const list = rows.submissions.filter((r) => r.assignmentId === assignment.id && r.studentId === user.id);
  const last = currentAttempt(list);
  const state = workState(assignment, last, nowMs);
  return {
    now: localDateTime(nowMs),
    assignment: {
      id: assignment.id, subjectId: subject.id, subjectName: subject.name, teacherName: teacher ? teacher.fullName : '', kind: assignment.kind,
      unit: assignment.unit, unitTitle, topicName: topic ? topic.name : '', title: assignment.title, description: assignment.description,
      dueAt: assignment.dueAt, maxPoints: assignment.maxPoints,
    },
    mine: {
      state: state.state, late: state.late, overdue: state.overdue, points: state.state === 'checked' ? last.points ?? null : null,
      attempts: [...list].sort((x, y) => y.n - x.n || cmp(y.id, x.id)).map((a) => ({
        id: a.id, n: a.n, text: a.text, paper: a.paper === true, submittedAt: a.submittedAt, late: a.paper !== true && a.submittedAt > assignment.dueAt,
        status: a.status, points: a.points ?? null, comment: a.comment, checkedAt: a.checkedAt, files: filesOf.get(a.id) || [],
      })),
      pending: own.filter((f) => f.state === 'pending' && isYoung(f, nowMs)).sort(byAt).map(fileView),
    },
    canSubmit: !last || last.status !== 'checked',
  };
}

export function submitWork(store, platform, data, user) {
  const rows = readWorkRows(store);
  const { assignment } = studentTask(rows, data.assignmentId, user);
  const text = isStr(data.text) ? data.text.trim() : null;
  const ids = data.fileIds;
  if (text === null || text.length > WORK.textMax) throw new AppError('bad_request');
  if (!Array.isArray(ids) || ids.length > FILE_LIMITS.perWork || !ids.every(isStr) || new Set(ids).size !== ids.length) throw new AppError('bad_request');
  const list = rows.submissions.filter((r) => r.assignmentId === assignment.id && r.studentId === user.id);
  const last = currentAttempt(list);
  if (last && last.status === 'checked') throw new AppError('already_checked');

  const nowMs = platform.now();
  const young = new Map(rows.files.filter((f) => f.ownerId === user.id && f.assignmentId === assignment.id && f.state === 'pending' && isYoung(f, nowMs)).map((f) => [f.id, f]));
  const bad = [];
  ids.forEach((id, index) => { if (!young.has(id)) bad.push({ field: 'fileIds', index, code: 'bad_ref' }); });
  if (bad.length > 0) throw new AppError('invalid', { fields: bad });
  if (text === '' && ids.length === 0) throw new AppError('invalid', { fields: [{ field: 'text', code: 'empty' }] });

  const at = localDateTime(nowMs);
  let submissions = rows.submissions;
  if (last && last.status === 'submitted') {
    store.updateMany('submissions', [{ id: last.id, patch: { status: 'replaced' } }]);
    submissions = submissions.map((r) => (r.id === last.id ? { ...r, status: 'replaced' } : r));
  }
  const [made] = store.insertMany('submissions', [{
    assignmentId: assignment.id, studentId: user.id, n: (last ? last.n : 0) + 1, text, paper: false, submittedAt: at, status: 'submitted',
    points: null, comment: '', checkedBy: '', checkedAt: '',
  }]);
  let files = rows.files;
  if (ids.length > 0) {
    store.updateMany('files', ids.map((id) => ({ id, patch: { state: 'attached', submissionId: made.id } })));
    const taken = new Set(ids);
    files = files.map((f) => (taken.has(f.id) ? { ...f, state: 'attached', submissionId: made.id } : f));
  }
  return { work: studentWorkView({ ...rows, submissions: [...submissions, made], files }, platform, assignment, user) };
}

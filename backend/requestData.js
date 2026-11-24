// Requests to change the closed data of the journal: filed by the teacher of the subject, approved by the deanery and the vice-rector,
// applied by the journal itself. The only module that writes 'Заявки'. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { REQUEST_KINDS } from '../core/schema.js';
import { REQUEST, markText, mayDecide, parseMarkText, parsePointsText, pointsText, sameTarget } from '../core/requests.js';
import { checkMark, checkReason, checkResultValue, limitedAllowed, markChanges } from '../core/journal.js';
import { checkResult, examText, parseExamText } from '../core/exam.js';
import { currentAttempt } from '../core/work.js';
import { journalView, lastOf, pairUnitClosed, viewerOf, writeMarks, writeUnitResult } from './journalData.js';
import { LEDGER_TABLES, examRowsOf, readLedgerRows } from './ledgerData.js';
import { writeExamResult } from './examData.js';
import { applyPoints } from './workGrade.js';
import { srsClosed } from './workData.js';

export const REQUEST_TABLES = [...LEDGER_TABLES, 'requests'];
const VIEW_TABLES = ['requests', 'subjects', 'groups', 'staff', 'students', 'pairs', 'assignments', 'examAttempts'];
const UNIT_KINDS = ['current', 'self', 'control'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const bad = (field, code) => new AppError('invalid', { fields: [{ field, code }] });
const isOpen = (r) => r.status === 'dean' || r.status === 'prorector';
const nameOf = (list, id) => (list.find((r) => r.id === id) || { fullName: '' }).fullName;

function readRows(store, tables) {
  const rows = {};
  for (const table of tables) rows[table] = store.list(table);
  return rows;
}

// The person from the base: the roles come from the row of the staff, a switched-off person is nobody. -> { id, roles } | null
function actorOf(rows, user) {
  const row = rows.staff.find((s) => s.id === user.id);
  if (!row || row.active !== true) return null;
  return { id: row.id, roles: String(row.roles).split(',').map((r) => r.trim()).filter((r) => r !== '') };
}

// The request as the answer shows it: field by field, names of deleted people and subjects are empty.
function requestView(rows, r, actor) {
  const subject = rows.subjects.find((s) => s.id === r.subjectId);
  const group = subject ? rows.groups.find((g) => g.id === subject.groupId) : undefined;
  const pair = r.pairId ? rows.pairs.find((p) => p.id === r.pairId) : undefined;
  const assignment = r.assignmentId ? rows.assignments.find((a) => a.id === r.assignmentId) : undefined;
  const attempt = r.kind === 'exam' && r.attemptId ? rows.examAttempts.find((a) => a.id === r.attemptId) : undefined;
  return {
    id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt,
    subjectId: r.subjectId, subjectName: subject ? subject.name : '', groupName: group ? group.name : '',
    unit: r.unit ?? null, studentId: r.studentId, studentName: nameOf(rows.students, r.studentId),
    pairId: r.pairId || '', pairDate: pair ? pair.date : '', pairSlot: pair ? pair.slot : null,
    assignmentTitle: assignment ? assignment.title : '', attemptNo: attempt ? attempt.no : null,
    before: r.before, after: r.after, reason: r.reason,
    authorName: nameOf(rows.staff, r.authorId), deanName: nameOf(rows.staff, r.deanBy), deanAt: r.deanAt || '',
    finalName: nameOf(rows.staff, r.finalBy), finalAt: r.finalAt || '', closedAt: r.closedAt || '', closeNote: r.closeNote || '',
    can: { decide: actor !== null && mayDecide(r, actor, rows.staff), withdraw: actor !== null && isOpen(r) && r.authorId === actor.id },
  };
}

// The target of a request against the data as they are now. Throws the refusals of the filing; `decide` takes any of them as "stale".
// t: { kind, unit, pairId, assignmentId, studentId, after }. -> { now, attemptId, unit, ...what the application needs }
function inspect(rows, view, subject, t) {
  const student = typeof t.studentId === 'string' ? view.students.find((s) => s.id === t.studentId) : undefined;
  if (!student) throw bad('studentId', 'bad_ref');
  const { planSemester } = view.subject;

  if (UNIT_KINDS.includes(t.kind)) {
    const item = Number.isInteger(t.unit) ? view.units.find((u) => u.unit === t.unit) : undefined;
    if (!item) throw bad('unit', 'bad_value');
    if (!view.closed.units.includes(t.unit)) throw new AppError('not_needed');
    if (t.kind === 'self' && item.byWork === true) throw bad('unit', 'self_by_work');
    const column = t.kind === 'current' ? 'currentManual' : t.kind;
    const row = lastOf(rows.unitResults.filter((r) => r.subjectId === subject.id && r.studentId === student.id && (r.planSemester ?? null) === planSemester && r.unit === t.unit), 'updatedAt');
    const value = parsePointsText(t.after);
    if (value === undefined || checkResultValue(t.kind, value, view.scheme) !== null) throw bad('after', 'bad_value');
    return { now: pointsText(row ? row[column] : null), after: pointsText(value), attemptId: '', unit: t.unit, value };
  }

  if (t.kind === 'mark') {
    const pair = typeof t.pairId === 'string' ? view.pairs.find((p) => p.id === t.pairId) : undefined;
    if (!pair) throw new AppError('not_found');
    if (pair.status !== 'closed') throw new AppError('pair_locked');
    const raw = rows.pairs.find((p) => p.id === pair.id);
    const existing = lastOf(rows.attendance.filter((r) => r.pairId === pair.id && r.studentId === student.id), 'markedAt');
    const old = existing ? { status: existing.status, noCoat: existing.noCoat === true, activity: existing.activity ?? null } : null;
    const next = parseMarkText(t.after);
    if (!pairUnitClosed(rows, subject, raw)) {
      // an open unit: the teacher does it himself while the term lasts and for the two small changes after it
      if (pair.state !== 'late') throw new AppError('not_needed');
      if (next && old && limitedAllowed(old, next)) throw new AppError('not_needed');
    }
    if (!next) throw bad('after', 'bad_value');
    const problems = checkMark(old, next, { mode: 'reason', pair: { first: pair.first, lessonType: pair.lessonType }, scheme: view.scheme });
    if (problems.length > 0) throw bad('after', problems[0].code);
    return { now: markText(old), after: markText(next), attemptId: '', unit: pair.unit, pair: raw, existing, old, next };
  }

  if (t.kind === 'work') {
    const assignment = typeof t.assignmentId === 'string' ? rows.assignments.find((a) => a.id === t.assignmentId && a.subjectId === subject.id) : undefined;
    if (!assignment) throw new AppError('not_found');
    if (!srsClosed(rows, assignment)) throw new AppError('not_needed');
    const current = currentAttempt(rows.submissions.filter((r) => r.assignmentId === assignment.id && r.studentId === student.id));
    const value = parsePointsText(t.after);
    if (value === undefined || value === null || value > assignment.maxPoints) throw bad('after', 'bad_value');
    return { now: current ? pointsText(current.points) : '', after: pointsText(value), attemptId: current ? current.id : '', unit: assignment.unit, assignment, current, value };
  }

  // the result of the exam: the final sheet is closed and the target is the last attempt of the student
  if (!view.closed.final) throw new AppError('not_needed');
  const attempts = examRowsOf(rows, subject.id, planSemester).attempts.get(student.id) || [];
  const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  if (!last) throw bad('studentId', 'no_attempt');
  const result = parseExamText(t.after);
  if (!result || checkResult(result, view.split) !== null) throw bad('after', 'bad_value');
  return { now: examText(last), after: examText(result), attemptId: last.id, unit: null, attempt: last, result };
}

// 'request.create' { kind, subjectId, unit, pairId, assignmentId, studentId, before, after, reason } -> { request }
export function createRequest(store, platform, data, user) {
  const rows = { ...readLedgerRows(store, platform), requests: store.list('requests') };
  if (!REQUEST_KINDS.includes(data.kind) || typeof data.before !== 'string' || typeof data.after !== 'string') throw new AppError('bad_request');
  const subject = typeof data.subjectId === 'string' ? rows.subjects.find((s) => s.id === data.subjectId) : undefined;
  if (!subject) throw new AppError('not_found');
  if (!viewerOf(user).teacher || subject.teacherId !== user.id) throw new AppError('forbidden');
  const view = journalView(rows, platform, subject.id, user);
  if (!view.subject.hasSyllabus) throw new AppError('no_syllabus');

  const found = inspect(rows, view, subject, data);
  if (data.before !== found.now) throw bad('before', 'changed');
  if (found.after === found.now) throw bad('after', 'same');
  const code = checkReason(data.reason);
  if (code) throw bad('reason', code);

  const { planSemester } = view.subject;
  const target = {
    kind: data.kind, subjectId: subject.id, planSemester, unit: found.unit ?? null,
    pairId: data.kind === 'mark' ? data.pairId : '', assignmentId: data.kind === 'work' ? data.assignmentId : '', studentId: data.studentId,
  };
  const open = rows.requests.filter(isOpen);
  if (open.some((r) => sameTarget(r, target))) throw new AppError('request_exists');
  if (open.filter((r) => r.authorId === user.id).length >= REQUEST.openMax) throw new AppError('too_many');

  const at = localDateTime(platform.now());
  const [saved] = store.insertMany('requests', [{
    ...target, attemptId: found.attemptId, before: data.before, after: found.after, reason: data.reason.trim(), authorId: user.id, createdAt: at,
    status: 'dean', deanBy: '', deanAt: '', finalBy: '', finalAt: '', closedAt: '', closeNote: '',
  }]);
  return { request: requestView({ ...rows, requests: [...rows.requests, saved] }, saved, actorOf(rows, user)) };
}

// 'request.mine' {} -> { today, requests }: the requests of the person for the subjects he leads now.
export function myRequests(store, platform, user) {
  const rows = readRows(store, VIEW_TABLES);
  const actor = actorOf(rows, user);
  const led = new Set(rows.subjects.filter((s) => s.teacherId === user.id).map((s) => s.id));
  const list = rows.requests.filter((r) => r.authorId === user.id && led.has(r.subjectId))
    .sort((a, b) => cmp(b.createdAt, a.createdAt) || cmp(b.id, a.id)).slice(0, REQUEST.listMax);
  return { today: localDate(platform.now()), requests: list.map((r) => requestView(rows, r, actor)) };
}

// 'request.queue' {} -> { today, waiting, requests }: every request, the open ones first (the oldest on top), then the closed ones (the newest on top).
export function requestQueue(store, platform, user) {
  const rows = readRows(store, VIEW_TABLES);
  const actor = actorOf(rows, user);
  const views = rows.requests.map((r) => ({ r, view: requestView(rows, r, actor) }));
  const open = views.filter((v) => isOpen(v.r)).sort((a, b) => cmp(a.r.createdAt, b.r.createdAt) || cmp(a.r.id, b.r.id));
  const shut = views.filter((v) => !isOpen(v.r)).sort((a, b) => cmp(b.r.closedAt || b.r.createdAt, a.r.closedAt || a.r.createdAt) || cmp(b.r.id, a.r.id));
  return {
    today: localDate(platform.now()), waiting: open.filter((v) => v.view.can.decide).length,
    requests: [...open, ...shut].slice(0, REQUEST.listMax).map((v) => v.view),
  };
}

// The request against the data now; null when it does not match any more.
function recheck(rows, platform, request, user) {
  try {
    const subject = rows.subjects.find((s) => s.id === request.subjectId);
    if (!subject) return null;
    const view = journalView(rows, platform, subject.id, user);
    if (!view.subject.hasSyllabus || view.subject.planSemester !== (request.planSemester ?? null)) return null;
    const found = inspect(rows, view, subject, request);
    if (found.now !== request.before || found.attemptId !== (request.attemptId || '')) return null;
    return { subject, found };
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

// The data, then the rows of the change log, then the state of the request: in this order, in one request.
function applyRequest(store, request, { subject, found }, at) {
  const studentId = request.studentId;
  const actorId = request.authorId;
  const entry = {
    at, actorId, subjectId: subject.id, pairId: '', assignmentId: '', studentId, unit: request.unit ?? null, reason: request.reason, late: true, requestId: request.id,
  };
  let log;
  if (request.kind === 'mark') {
    const existing = new Map(found.existing ? [[studentId, found.existing]] : []);
    writeMarks(store, { pair: found.pair, subject, items: [{ studentId, ...found.next }], existing, actorId, at });
    log = markChanges(found.old, found.next).map((c) => ({ ...entry, entity: 'mark', pairId: found.pair.id, ...c }));
  } else if (UNIT_KINDS.includes(request.kind)) {
    const { old } = writeUnitResult(store, { rows: found.rows, subject, planSemester: request.planSemester ?? null, unit: request.unit, studentId, field: request.kind, value: found.value, actorId, at });
    log = [{ ...entry, entity: 'unit', field: request.kind, before: pointsText(old), after: pointsText(found.value) }];
  } else if (request.kind === 'work') {
    const done = applyPoints(store, { assignment: found.assignment, studentId, current: found.current, points: found.value, actorId, at });
    const work = { ...entry, entity: 'work', assignmentId: found.assignment.id };
    log = [{ ...work, field: 'points', before: pointsText(done.before), after: pointsText(found.value) }];
    if (done.created || done.statusBefore !== 'checked') log.push({ ...work, field: 'status', before: done.statusBefore, after: 'checked' });
  } else {
    const { before } = writeExamResult(store, { attempt: found.attempt, result: found.result, actorId, at });
    log = [{ ...entry, entity: 'subjectExam', field: 'try' + found.attempt.no, before, after: examText(found.result), unit: null }];
  }
  if (log.length > 0) store.insertMany('changeLog', log);
}

// 'request.decide' { requestId, step, verdict, note } -> { request, stale }
export function decideRequest(store, platform, data, user) {
  const rows = { ...readLedgerRows(store, platform), requests: store.list('requests') };
  const request = typeof data.requestId === 'string' ? rows.requests.find((r) => r.id === data.requestId) : undefined;
  if (!request) throw new AppError('not_found');
  if (!isOpen(request)) throw new AppError('request_closed');
  if (data.step !== request.status) throw new AppError('request_changed');
  const actor = actorOf(rows, user);
  if (!actor || !mayDecide(request, actor, rows.staff)) throw new AppError('forbidden');
  if (data.verdict !== 'approve' && data.verdict !== 'reject') throw new AppError('bad_request');

  const at = localDateTime(platform.now());
  const onDean = request.status === 'dean';
  const signed = onDean ? { deanBy: user.id, deanAt: at } : { finalBy: user.id, finalAt: at };
  const save = (patch, stale) => {
    const [saved] = store.updateMany('requests', [{ id: request.id, patch }]);
    return { request: requestView({ ...rows, requests: rows.requests.map((r) => (r.id === saved.id ? saved : r)) }, saved, actor), stale };
  };

  if (data.verdict === 'reject') {
    const code = checkReason(data.note);
    if (code) throw bad('note', code);
    return save({ status: 'rejected', closeNote: data.note.trim(), closedAt: at, ...signed }, false);
  }
  const found = recheck(rows, platform, request, user);
  if (!found) return save({ status: 'stale', closedAt: at }, true);
  if (onDean) return save({ status: 'prorector', ...signed }, false);
  applyRequest(store, request, { subject: found.subject, found: { ...found.found, rows: rows.unitResults } }, at);
  return save({ status: 'applied', closedAt: at, ...signed }, false);
}

// 'request.withdraw' { requestId } -> { request }
export function withdrawRequest(store, platform, data, user) {
  const rows = readRows(store, VIEW_TABLES);
  const request = typeof data.requestId === 'string' ? rows.requests.find((r) => r.id === data.requestId) : undefined;
  if (!request) throw new AppError('not_found');
  if (request.authorId !== user.id) throw new AppError('forbidden');
  if (!isOpen(request)) throw new AppError('request_closed');
  const [saved] = store.updateMany('requests', [{ id: request.id, patch: { status: 'withdrawn', closedAt: localDateTime(platform.now()) } }]);
  return { request: requestView({ ...rows, requests: rows.requests.map((r) => (r.id === saved.id ? saved : r)) }, saved, actorOf(rows, user)) };
}

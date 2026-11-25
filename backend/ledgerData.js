// The ledger of a subject: the list, the sheet with the admission and the exam, closing a unit and the final sheet, reopening.
// The numbers are the ones of the journal (journalView); the only formula here is the subject total of core/exam.js.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { readSettings, readExtra } from '../core/settings.js';
import { syllabusFor } from '../core/syllabus.js';
import { compareNames } from '../core/names.js';
import { checkReason } from '../core/journal.js';
import { FINAL_UNIT, activeClosure, closeProblems, closedUnitsOf } from '../core/ledger.js';
import { finalProblems, liveAttempts, subjectResult } from '../core/exam.js';
import { settleLessons } from './lessonSettle.js';
import { JOURNAL_TABLES, journalView, lastOf, viewerOf } from './journalData.js';
import { attemptsOfCard, repeatMark, shownCard } from './repeatData.js';

export const LEDGER_LIST_TABLES = ['subjects', 'groups', 'staff', 'syllabi', 'syllabusMembers', 'topics', 'settings', 'closures'];
export const LEDGER_TABLES = [...JOURNAL_TABLES, 'subjectExams', 'examAttempts', 'repeats', 'repeatAttempts'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const nameOf = (list, id) => (list.find((r) => r.id === id) || { fullName: '' }).fullName;
const isAdmin = (user) => Array.isArray(user.roles) && user.roles.includes('admin');
export const isOwner = (viewer, subject) => viewer.teacher && subject.teacherId === viewer.id;

// Every table of the ledger, each read once; the started pairs are settled in the same request.
export function readLedgerRows(store, platform) {
  const rows = {};
  for (const table of LEDGER_TABLES) rows[table] = store.list(table);
  return settleLessons(store, platform, rows);
}

// Without a syllabus in force (the teacher changed): the closures of the half with the closed final sheet, else with the most closed units.
function closedWithoutSyllabus(closures, subjectId) {
  const halves = new Set(closures.filter((c) => c.subjectId === subjectId).map((c) => c.planSemester ?? null));
  let best = { units: [], final: false };
  let weight = -1;
  for (const half of halves) {
    const c = closedUnitsOf(closures, subjectId, half);
    const w = (c.final ? 1000 : 0) + c.units.length;
    if (w > weight) { weight = w; best = c; }
  }
  return best;
}

// 'ledger.list': the subjects the person may open with the closed units; no journal numbers are counted.
export function ledgerList(store, platform, user) {
  const rows = {};
  for (const table of LEDGER_LIST_TABLES) rows[table] = store.list(table);
  const viewer = viewerOf(user);
  const settings = readSettings(rows.settings);
  const extra = readExtra(rows.settings);
  const unitsOf = new Map();
  for (const t of rows.topics) {
    if (!Number.isInteger(t.unit)) continue;
    if (!unitsOf.has(t.syllabusId)) unitsOf.set(t.syllabusId, new Set());
    unitsOf.get(t.syllabusId).add(t.unit);
  }
  const list = [];
  for (const subject of rows.subjects) {
    const own = isOwner(viewer, subject);
    if (!viewer.manager && !viewer.reader && !own) continue;
    const syllabus = syllabusFor(subject, rows.syllabi, settings.semester, rows.syllabusMembers);
    const planSemester = syllabus && Number.isInteger(syllabus.planSemester) ? syllabus.planSemester : null;
    const closed = syllabus ? closedUnitsOf(rows.closures, subject.id, planSemester) : closedWithoutSyllabus(rows.closures, subject.id);
    const units = syllabus ? [...(unitsOf.get(syllabus.id) || [])].sort((a, b) => a - b) : closed.units;
    const group = rows.groups.find((g) => g.id === subject.groupId);
    list.push({
      subjectId: subject.id, name: subject.name, groupName: group ? group.name : '', teacherName: nameOf(rows.staff, subject.teacherId),
      own, hasSyllabus: syllabus !== null, units: units.map((unit) => ({ unit, closed: closed.units.includes(unit) })), final: closed.final,
    });
  }
  list.sort((a, b) => compareNames(a.groupName, b.groupName) || compareNames(a.name, b.name) || cmp(a.subjectId, b.subjectId));
  return { today: localDate(platform.now()), examWeek: { start: extra.examStart, end: extra.examEnd }, subjects: list };
}

// The head and the live attempts of the exam of a subject in the half of the plan. -> { head | null, attempts: Map(student id -> live attempts) }
export function examRowsOf(rows, subjectId, planSemester) {
  const sem = planSemester ?? null;
  const mine = (r) => r.subjectId === subjectId && (r.planSemester ?? null) === sem;
  const head = lastOf(rows.subjectExams.filter(mine), 'updatedAt');
  const byStudent = new Map();
  for (const r of rows.examAttempts) {
    if (!mine(r)) continue;
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId).push(r);
  }
  return { head, attempts: new Map([...byStudent].map(([id, list]) => [id, liveAttempts(list)])) };
}

// A teacher without a role of the office may not close the final sheet before the credit week.
const tooEarly = (viewer, extra, today) => !viewer.manager && extra.examStart !== '' && today < extra.examStart;

// 'ledger.get': { ledger }. Rows are the ledger tables, settled.
export function ledgerView(rows, platform, subjectId, user) {
  const view = journalView(rows, platform, subjectId, user);
  if (view.partial) throw new AppError('forbidden');
  const viewer = viewerOf(user);
  const subject = rows.subjects.find((s) => s.id === view.subject.id);
  const { planSemester } = view.subject;
  const owner = isOwner(viewer, subject);
  const extra = readExtra(rows.settings);
  const group = rows.groups.find((g) => g.id === subject.groupId);
  const closed = closedUnitsOf(rows.closures, subject.id, planSemester);
  const { head, attempts } = examRowsOf(rows, subject.id, planSemester);
  const can = {
    close: viewer.manager || owner, reopen: isAdmin(user), request: owner, exam: viewer.manager || owner, commission: viewer.manager,
  };

  const units = view.units.map((u) => {
    const c = activeClosure(rows.closures, subject.id, planSemester, u.unit);
    const base = { unit: u.unit, title: u.title, byWork: u.byWork === true };
    if (c) return { ...base, closed: true, closedAt: c.closedAt, closedByName: nameOf(rows.staff, c.closedBy), blocking: [], missing: 0 };
    const problems = closeProblems({ unit: u.unit, pairs: view.pairs, students: view.students, results: view.results });
    return { ...base, closed: false, closedAt: '', closedByName: '', blocking: problems.blocking, missing: problems.missing };
  });

  const students = view.students.map((s) => {
    const r = view.results[s.id];
    const live = attempts.get(s.id) || [];
    const res = subjectResult({ semester: r.semester, admitted: r.admitted === true && Number.isInteger(r.semester), attempts: live, scheme: view.scheme });
    const card = shownCard(rows.repeats, s.id, subject.id, planSemester);
    const repeat = card ? repeatMark(card, attemptsOfCard({ repeatAttempts: rows.repeatAttempts || [] }, card), view.scheme, view.split) : null;
    return {
      id: s.id, fullName: s.fullName, left: s.left,
      units: r.units.map((u) => ({
        unit: u.unit, current: u.current, manual: u.manual !== null, self: u.selfWork ? u.selfWork.value : u.self, selfPending: u.selfWork ? u.selfWork.pending : 0,
        control: u.control, total: u.total, word: u.word, currentLow: u.currentLow, controlLow: u.controlLow,
      })),
      preliminary: r.preliminary, semester: r.semester, complete: r.complete, admitted: r.admitted, attempts: live,
      status: res.status, tries: res.tries, exam: res.exam, total: res.total, word: res.word, next: s.left || repeat ? null : res.next,
      ...(repeat ? { repeat } : {}),
    };
  });

  const finalClosure = activeClosure(rows.closures, subject.id, planSemester, FINAL_UNIT);
  const final = finalClosure
    ? { closed: true, closedAt: finalClosure.closedAt, closedByName: nameOf(rows.staff, finalClosure.closedBy), early: false, blocking: [] }
    : {
      closed: false, closedAt: '', closedByName: '', early: can.close && tooEarly(viewer, extra, view.today),
      blocking: finalProblems({ units: units.map((u) => u.unit), closed: closed.units, head, rows: students.map((s) => ({ left: s.left, admitted: s.admitted, attempts: s.attempts })) }),
    };

  return {
    today: view.today, examWeek: { start: extra.examStart, end: extra.examEnd }, collegeName: extra.collegeName,
    subject: {
      id: subject.id, name: subject.name, groupName: view.subject.groupName, course: group && Number.isInteger(group.course) ? group.course : null,
      teacherName: view.subject.teacherName, semester: view.subject.semester, planSemester, hasSyllabus: view.subject.hasSyllabus,
    },
    scheme: {
      current: view.scheme.current, self: view.scheme.self, control: view.scheme.control, minimum: view.scheme.minimum,
      fair: view.scheme.fair, good: view.scheme.good, excellent: view.scheme.excellent,
    },
    split: view.split, can, units,
    exam: {
      ready: units.length > 0 && units.every((u) => u.closed), date: head ? head.date : '', examiner: head ? head.examiner : '',
      assistants: head ? head.assistants : '', strict: can.exam && !viewer.manager && extra.examStart !== '',
    },
    final, students,
  };
}

export function findSubject(rows, subjectId) {
  const subject = typeof subjectId === 'string' ? rows.subjects.find((s) => s.id === subjectId) : undefined;
  if (!subject) throw new AppError('not_found');
  return subject;
}

function mayClose(user, subject) {
  const viewer = viewerOf(user);
  if (!viewer.manager && !isOwner(viewer, subject)) throw new AppError('forbidden');
  return viewer;
}

const logEntry = (at, user, subject, unit, field, before, after, reason = '') => ({
  at, actorId: user.id, entity: 'ledger', subjectId: subject.id, pairId: '', studentId: '', unit, field, before, after, reason, late: false,
});

// 'ledger.closeUnit' { subjectId, unit, acceptMissing } -> { ledger }
export function closeUnit(store, platform, data, user) {
  const rows = readLedgerRows(store, platform);
  const subject = findSubject(rows, data.subjectId);
  mayClose(user, subject);
  const ledger = ledgerView(rows, platform, subject.id, user);
  if (!ledger.subject.hasSyllabus) throw new AppError('no_syllabus');
  const item = Number.isInteger(data.unit) ? ledger.units.find((u) => u.unit === data.unit) : undefined;
  if (!item) throw new AppError('invalid', { fields: [{ field: 'unit', code: 'bad_value' }] });
  if (item.closed) throw new AppError('already_closed');
  if (item.blocking.length > 0) throw new AppError('invalid', { fields: [{ field: 'unit', code: item.blocking[0].code }] });
  if (item.missing > 0 && data.acceptMissing !== true) throw new AppError('invalid', { fields: [{ field: 'acceptMissing', code: 'required' }] });

  const at = localDateTime(platform.now());
  const inserted = store.insertMany('closures', [{ subjectId: subject.id, planSemester: ledger.subject.planSemester, unit: item.unit, closedBy: user.id, closedAt: at, reopenedBy: '', reopenedAt: '' }]);
  store.insertMany('changeLog', [logEntry(at, user, subject, item.unit, 'closed', 'open', 'closed')]);
  return { ledger: ledgerView({ ...rows, closures: [...rows.closures, ...inserted] }, platform, subject.id, user) };
}

// 'ledger.closeFinal' { subjectId } -> { ledger }. The open units are not closed by it.
export function closeFinal(store, platform, data, user) {
  const rows = readLedgerRows(store, platform);
  const subject = findSubject(rows, data.subjectId);
  mayClose(user, subject);
  const ledger = ledgerView(rows, platform, subject.id, user);
  if (ledger.final.early) throw new AppError('exam_not_started');
  if (ledger.final.closed) throw new AppError('already_closed');
  if (ledger.final.blocking.length > 0) {
    const { code, n } = ledger.final.blocking[0];
    throw new AppError('invalid', { fields: [{ field: 'final', code, n }] });
  }

  const at = localDateTime(platform.now());
  const inserted = store.insertMany('closures', [{ subjectId: subject.id, planSemester: ledger.subject.planSemester, unit: FINAL_UNIT, closedBy: user.id, closedAt: at, reopenedBy: '', reopenedAt: '' }]);
  store.insertMany('changeLog', [logEntry(at, user, subject, null, 'final', 'open', 'closed')]);
  return { ledger: ledgerView({ ...rows, closures: [...rows.closures, ...inserted] }, platform, subject.id, user) };
}

// 'ledger.reopen' { subjectId, unit, reason } -> { ledger }. The administrator only; the closing rows stay, they get the time of opening.
export function reopenUnit(store, platform, data, user) {
  if (!isAdmin(user)) throw new AppError('forbidden');
  const rows = readLedgerRows(store, platform);
  const subject = findSubject(rows, data.subjectId);
  const ledger = ledgerView(rows, platform, subject.id, user);
  if (!Number.isInteger(data.unit) || data.unit < 0) throw new AppError('invalid', { fields: [{ field: 'unit', code: 'bad_value' }] });
  const { planSemester } = ledger.subject;
  const target = activeClosure(rows.closures, subject.id, planSemester, data.unit);
  if (!target) throw new AppError('not_closed');
  const code = checkReason(data.reason);
  if (code) throw new AppError('invalid', { fields: [{ field: 'reason', code }] });
  const reason = data.reason.trim();

  const at = localDateTime(platform.now());
  const stamp = { reopenedBy: user.id, reopenedAt: at };
  const patches = [{ id: target.id, patch: stamp }];
  const log = [data.unit === FINAL_UNIT ? logEntry(at, user, subject, null, 'final', 'closed', 'open', reason) : logEntry(at, user, subject, data.unit, 'closed', 'closed', 'open', reason)];
  const final = data.unit >= 1 ? activeClosure(rows.closures, subject.id, planSemester, FINAL_UNIT) : null;
  if (final) {
    patches.push({ id: final.id, patch: stamp });
    log.push(logEntry(at, user, subject, null, 'final', 'closed', 'open', reason));
  }
  const updated = store.updateMany('closures', patches);
  store.insertMany('changeLog', log);
  const replaced = new Map(updated.map((r) => [r.id, r]));
  return { ledger: ledgerView({ ...rows, closures: rows.closures.map((r) => replaced.get(r.id) || r) }, platform, subject.id, user) };
}

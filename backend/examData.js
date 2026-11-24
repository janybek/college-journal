// The exam of a subject: the head, the results of the first sitting, the retakes as new attempts.
// The only module that writes 'Экзамены предметов' and 'Попытки экзамена'.
import { AppError } from '../core/errors.js';
import { localDateTime } from '../core/dates.js';
import { readExtra } from '../core/settings.js';
import { checkReason } from '../core/journal.js';
import { EXAM, checkAttempt, checkHead, checkResult, examText } from '../core/exam.js';
import { lastOf, viewerOf } from './journalData.js';
import { examRowsOf, findSubject, isOwner, ledgerView, readLedgerRows } from './ledgerData.js';

const invalid = (fields) => new AppError('invalid', { fields });

// The teacher of the subject, the dean or the administrator; the ledger of the subject is built for them.
function openExam(store, platform, data, user) {
  const rows = readLedgerRows(store, platform);
  const subject = findSubject(rows, data.subjectId);
  const viewer = viewerOf(user);
  if (!viewer.manager && !isOwner(viewer, subject)) throw new AppError('forbidden');
  const ledger = ledgerView(rows, platform, subject.id, user);
  if (!ledger.subject.hasSyllabus) throw new AppError('no_syllabus');
  return { rows, subject, viewer, ledger };
}

const withRows = (rows, table, list, changed) => {
  const replaced = new Map(changed.map((r) => [r.id, r]));
  return { ...rows, [table]: list.map((r) => replaced.get(r.id) || r) };
};

const logRow = (at, user, subject, studentId, field, before, after, reason) => ({
  at, actorId: user.id, entity: 'subjectExam', subjectId: subject.id, pairId: '', studentId, unit: null, field, before, after, reason, late: false,
});

// 'ledger.saveExam' { subjectId, date, examiner, assistants, items: [{ studentId, outcome, score }], reason } -> { ledger }
export function saveExam(store, platform, data, user) {
  const { rows, subject, viewer, ledger } = openExam(store, platform, data, user);
  if (ledger.final.closed) throw new AppError('final_closed');
  if (!ledger.exam.ready) throw new AppError('units_open');

  const items = data.items;
  if (!Array.isArray(items) || items.length > EXAM.itemsMax) throw new AppError('bad_request');
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.studentId !== 'string' || seen.has(item.studentId)) throw new AppError('bad_request');
    seen.add(item.studentId);
  }

  const { planSemester } = ledger.subject;
  const { head } = examRowsOf(rows, subject.id, planSemester);
  const strict = !viewer.manager && (!head || head.date !== data.date);
  const checked = checkHead({ date: data.date, examiner: data.examiner, assistants: data.assistants }, { exam: readExtra(rows.settings), strict });
  const problems = [...checked.problems];
  const hasFirst = ledger.students.some((s) => s.attempts.some((a) => a.no === 1));
  if (checked.value && checked.value.date > ledger.today && (items.length > 0 || hasFirst)) problems.push({ field: 'date', code: 'in_future' });

  const byId = new Map(ledger.students.map((s) => [s.id, s]));
  const changes = [];
  items.forEach((item, index) => {
    const student = byId.get(item.studentId);
    if (!student || student.left) { problems.push({ index, field: 'studentId', code: 'bad_ref' }); return; }
    if (student.admitted !== true) { problems.push({ index, field: 'studentId', code: 'not_admitted' }); return; }
    if (student.attempts.some((a) => a.no > 1)) { problems.push({ index, field: 'studentId', code: 'has_retake' }); return; }
    const score = item.score === undefined ? null : item.score;
    let result = null;
    if (item.outcome === null) {
      if (score !== null) { problems.push({ index, field: 'score', code: 'bad_value' }); return; }
    } else {
      const bad = checkResult({ outcome: item.outcome, score }, ledger.split);
      if (bad) { problems.push({ index, ...bad }); return; }
      result = { outcome: item.outcome, score };
    }
    const current = student.attempts.find((a) => a.no === 1);
    const before = current ? examText(current) : '';
    const after = result ? examText(result) : '';
    if (before !== after) changes.push({ studentId: student.id, result, before, after });
  });
  if (problems.length > 0) throw invalid(problems);

  let reason = '';
  if (changes.some((c) => c.before !== '')) {
    const code = checkReason(data.reason);
    if (code) throw invalid([{ field: 'reason', code }]);
    reason = data.reason.trim();
  }

  const value = checked.value;
  const headChanged = !head || head.date !== value.date || head.examiner !== value.examiner || head.assistants !== value.assistants;
  const dateMoved = head !== null && head.date !== value.date;
  if (!headChanged && changes.length === 0) return { ledger };

  const at = localDateTime(platform.now());
  const stamp = { updatedBy: user.id, updatedAt: at };
  const patches = new Map();
  const inserts = [];
  if (dateMoved) {
    for (const s of ledger.students) {
      const first = s.attempts.find((a) => a.no === 1);
      if (first) patches.set(first.id, { date: value.date, ...stamp });
    }
  }
  for (const c of changes) {
    const mine = rows.examAttempts.filter((r) => r.subjectId === subject.id && (r.planSemester ?? null) === planSemester && r.studentId === c.studentId && r.no === 1);
    const raw = lastOf(mine, 'updatedAt');
    const body = { date: value.date, outcome: c.result ? c.result.outcome : '', score: c.result ? c.result.score : null, ...stamp };
    if (raw) patches.set(raw.id, { ...(patches.get(raw.id) || {}), ...body });
    else inserts.push({ subjectId: subject.id, planSemester, studentId: c.studentId, no: 1, commission: '', ...body });
  }

  let next = rows;
  if (headChanged) {
    const body = { date: value.date, examiner: value.examiner, assistants: value.assistants, ...stamp };
    if (head) next = withRows(next, 'subjectExams', next.subjectExams, store.updateMany('subjectExams', [{ id: head.id, patch: body }]));
    else next = { ...next, subjectExams: [...next.subjectExams, ...store.insertMany('subjectExams', [{ subjectId: subject.id, planSemester, ...body }])] };
  }
  if (patches.size > 0) next = withRows(next, 'examAttempts', next.examAttempts, store.updateMany('examAttempts', [...patches].map(([id, patch]) => ({ id, patch }))));
  if (inserts.length > 0) next = { ...next, examAttempts: [...next.examAttempts, ...store.insertMany('examAttempts', inserts)] };
  if (changes.length > 0) {
    store.insertMany('changeLog', changes.map((c) => logRow(at, user, subject, c.studentId, 'try1', c.before, c.after, c.before !== '' ? reason : '')));
  }
  return { ledger: ledgerView(next, platform, subject.id, user) };
}

// 'ledger.addAttempt' { subjectId, studentId, date, outcome, score, commission } -> { ledger }
export function addAttempt(store, platform, data, user) {
  const { rows, subject, viewer, ledger } = openExam(store, platform, data, user);
  if (!ledger.final.closed) throw new AppError('not_closed');
  const student = typeof data.studentId === 'string' ? ledger.students.find((s) => s.id === data.studentId) : undefined;
  if (!student || student.left) throw invalid([{ field: 'studentId', code: 'bad_ref' }]);
  if (student.repeat) throw invalid([{ field: 'studentId', code: 'on_repeat' }]);
  const next = student.next;
  if (!next) throw invalid([{ field: 'studentId', code: 'not_allowed' }]);
  if (next.commission && !viewer.manager) throw new AppError('forbidden');

  const last = student.attempts.length > 0 ? student.attempts[student.attempts.length - 1] : null;
  const checked = checkAttempt(
    { date: data.date, outcome: data.outcome, score: data.score === undefined ? null : data.score, commission: data.commission },
    { next, last, exam: readExtra(rows.settings), today: ledger.today, split: ledger.split },
  );
  if (checked.problems.length > 0) throw invalid(checked.problems);

  const { date, outcome, score, commission } = checked.value;
  const at = localDateTime(platform.now());
  const { planSemester } = ledger.subject;
  const inserted = store.insertMany('examAttempts', [{
    subjectId: subject.id, planSemester, studentId: student.id, no: next.no, date, outcome, score: outcome === 'score' ? score : null, commission, updatedBy: user.id, updatedAt: at,
  }]);
  store.insertMany('changeLog', [logRow(at, user, subject, student.id, 'try' + next.no, '', examText(inserted[0]), '')]);
  return { ledger: ledgerView({ ...rows, examAttempts: [...rows.examAttempts, ...inserted] }, platform, subject.id, user) };
}

// For the request of the exam (task 14): the live row of the attempt gets the new result. -> { before }
export function writeExamResult(store, { attempt, result, actorId, at }) {
  const before = examText(attempt);
  const patch = { outcome: result.outcome, score: result.outcome === 'score' ? result.score : null, updatedBy: actorId, updatedAt: at };
  store.updateMany('examAttempts', [{ id: attempt.id, patch }]);
  return { before };
}

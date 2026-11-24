// Checking of the works: the teacher of the subject gives points or returns a work. Every change of the points or the status
// writes rows of the change log in the same request. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDateTime } from '../core/dates.js';
import { checkReason } from '../core/journal.js';
import { checkGrade, currentAttempt } from '../core/work.js';
import { readWorkRows, srsClosed, staffWorkView, subjectRights } from './workData.js';

const isStr = (v) => typeof v === 'string';
const logText = (value) => (value === null || value === undefined ? '' : String(value));

// 'work.grade' { assignmentId, studentId, attemptId, verdict, points, comment, reason } -> { work: the view of 'work.get' }
export function gradeWork(store, platform, data, user) {
  const rows = readWorkRows(store);
  const assignment = isStr(data.assignmentId) ? rows.assignments.find((a) => a.id === data.assignmentId) : undefined;
  const subject = assignment ? rows.subjects.find((s) => s.id === assignment.subjectId) : undefined;
  if (!assignment || !subject) throw new AppError('not_found');
  if (!subjectRights(subject, user).manage) throw new AppError('forbidden');
  if (srsClosed(rows, assignment)) throw new AppError('unit_closed');

  const list = isStr(data.studentId) ? rows.submissions.filter((r) => r.assignmentId === assignment.id && r.studentId === data.studentId) : [];
  const student = isStr(data.studentId) ? rows.students.find((s) => s.id === data.studentId) : undefined;
  if (!student || !((student.groupId === subject.groupId && student.active === true) || list.length > 0)) {
    throw new AppError('invalid', { fields: [{ field: 'studentId', code: 'bad_ref' }] });
  }
  const problems = checkGrade(data, { maxPoints: assignment.maxPoints });
  if (!isStr(data.attemptId)) problems.push({ field: 'attemptId', code: 'bad_value' });
  if (problems.length > 0) throw new AppError('invalid', { fields: problems });

  const current = currentAttempt(list);
  if (data.attemptId !== (current ? current.id : '')) throw new AppError('attempt_changed');

  const nowMs = platform.now();
  const at = localDateTime(nowMs);
  const verdict = data.verdict;
  const points = verdict === 'checked' ? data.points : null;
  const comment = isStr(data.comment) ? data.comment : '';
  const entry = { at, actorId: user.id, entity: 'work', subjectId: subject.id, assignmentId: assignment.id, studentId: student.id, unit: assignment.unit, late: false, pairId: '' };

  if (!current) {
    if (verdict === 'returned') throw new AppError('nothing_to_return');
    const [row] = store.insertMany('submissions', [{
      assignmentId: assignment.id, studentId: student.id, n: 1, text: '', paper: true, submittedAt: at, status: 'checked',
      points, comment, checkedBy: user.id, checkedAt: at,
    }]);
    store.insertMany('changeLog', [
      { ...entry, field: 'points', before: '', after: logText(points), reason: '' },
      { ...entry, field: 'status', before: '', after: 'checked', reason: '' },
    ]);
    return { work: staffWorkView({ ...rows, submissions: [...rows.submissions, row] }, platform, assignment, user) };
  }

  const oldPoints = current.points ?? null;
  const pointsChanged = oldPoints !== points;
  const statusChanged = current.status !== verdict;
  if (!pointsChanged && !statusChanged && current.comment === comment) return { work: staffWorkView(rows, platform, assignment, user) };

  let reason = '';
  if ((oldPoints !== null && pointsChanged) || (current.status === 'checked' && verdict === 'returned')) {
    const code = checkReason(data.reason);
    if (code) throw new AppError('invalid', { fields: [{ field: 'reason', code }] });
    reason = data.reason.trim();
  }

  // only the comment changes: "who checked and when" belongs to the grade, so it stays
  const patch = !pointsChanged && !statusChanged ? { comment } : { status: verdict, points, comment, checkedBy: user.id, checkedAt: at };
  const [saved] = store.updateMany('submissions', [{ id: current.id, patch }]);
  const log = [];
  if (pointsChanged) log.push({ ...entry, field: 'points', before: logText(oldPoints), after: logText(points), reason });
  if (statusChanged) log.push({ ...entry, field: 'status', before: current.status, after: verdict, reason });
  if (log.length > 0) store.insertMany('changeLog', log);
  return { work: staffWorkView({ ...rows, submissions: rows.submissions.map((r) => (r.id === current.id ? saved : r)) }, platform, assignment, user) };
}

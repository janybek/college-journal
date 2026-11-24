// The works and the exam of the repeat course, closing the card and opening it again (the administrator).
// Writes the tables 'Повторный курс' and 'Попытки экзамена повтора' and the change log; the finished tables of the ledger are not touched.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { readSplit, readScheme } from '../core/scoring.js';
import { checkReason } from '../core/journal.js';
import { examText } from '../core/exam.js';
import { checkRepeatAttempt, checkWorks, closeState, isOverdue, repeatResult } from '../core/repeat.js';
import { viewerOf } from './journalData.js';
import { attemptsOfCard, cardView, findCard, logRow, mayScore, readRepeatRows } from './repeatData.js';

const invalid = (fields) => new AppError('invalid', { fields });
const isAdmin = (user) => Array.isArray(user.roles) && user.roles.includes('admin');
const reasonProblem = (reason) => {
  const code = checkReason(reason);
  return code ? { field: 'reason', code } : null;
};

// not_found -> forbidden -> repeat_closed (-> deadline_passed for the works and the tries)
function scoreCard(rows, platform, data, user, { dated }) {
  const card = findCard(rows, data.repeatId);
  const viewer = viewerOf(user);
  if (!mayScore(viewer, card)) throw new AppError('forbidden');
  if (card.status !== 'open') throw new AppError('repeat_closed');
  const today = localDate(platform.now());
  if (dated && isOverdue(card, today)) throw new AppError('deadline_passed');
  return { card, viewer, today, attempts: attemptsOfCard(rows, card), split: readSplit(rows.settings), scheme: readScheme(rows.settings) };
}

const saved = (store, card, patch) => {
  const [row] = store.updateMany('repeats', [{ id: card.id, patch }]);
  return row || { ...card, ...patch };
};

// 'repeat.saveWorks' { repeatId, works, note, reason } -> { repeat }
export function saveWorks(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const { card, attempts, split } = scoreCard(rows, platform, data, user, { dated: true });
  const checked = checkWorks(data, { card, split, hasAttempts: attempts.length > 0 });
  if (checked.problems.length > 0) throw invalid(checked.problems);
  const { works, note } = checked.value;
  const had = Number.isInteger(card.works);
  const valueChanged = works !== card.works;
  const noteChanged = note !== (card.worksNote || '');
  if (!valueChanged && !noteChanged) return { repeat: cardView(rows, platform, card, user) };
  let reason = '';
  if (had && valueChanged) {
    const problem = reasonProblem(data.reason);
    if (problem) throw invalid([problem]);
    reason = data.reason.trim();
  }
  const at = localDateTime(platform.now());
  const row = saved(store, card, { works, worksNote: note, updatedBy: user.id, updatedAt: at });
  const log = [];
  if (valueChanged) log.push(logRow(at, user, card, 'works', had ? String(card.works) : '', String(works), reason));
  if (noteChanged) log.push(logRow(at, user, card, 'worksNote', card.worksNote || '', note));
  store.insertMany('changeLog', log);
  return { repeat: cardView(rows, platform, row, user) };
}

// 'repeat.saveAttempt' { repeatId, no?, date, outcome, score, commission, reason } -> { repeat }
export function saveAttempt(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const { card, viewer, today, attempts, split, scheme } = scoreCard(rows, platform, data, user, { dated: true });
  const at = localDateTime(platform.now());
  if (data.no === undefined || data.no === null) {
    const result = repeatResult({ card, attempts, scheme, split });
    if (result.admitted !== true) throw invalid([{ field: 'repeat', code: 'not_admitted' }]);
    const next = result.next;
    if (next === null) throw invalid([{ field: 'repeat', code: 'not_allowed' }]);
    if (next.commission && !viewer.manager) throw new AppError('forbidden');
    const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;
    const checked = checkRepeatAttempt(
      { date: data.date, outcome: data.outcome, score: data.score === undefined ? null : data.score, commission: data.commission },
      { card, next, last, today, split },
    );
    if (checked.problems.length > 0) throw invalid(checked.problems);
    const { date, outcome, score, commission } = checked.value;
    const inserted = store.insertMany('repeatAttempts', [{
      repeatId: card.id, no: next.no, date, outcome, score: outcome === 'score' ? score : null, commission, updatedBy: user.id, updatedAt: at,
    }]);
    store.insertMany('changeLog', [logRow(at, user, card, 'try' + next.no, '', examText(inserted[0]))]);
    return { repeat: cardView({ ...rows, repeatAttempts: [...rows.repeatAttempts, ...inserted] }, platform, card, user) };
  }

  // a correction: only the last live try
  const target = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  if (!target || data.no !== target.no) throw invalid([{ field: 'no', code: 'bad_value' }]);
  if (target.commission && !viewer.manager) throw new AppError('forbidden');
  const outcome = data.outcome === undefined ? target.outcome : data.outcome;
  let score = data.score;
  if (score === undefined) score = outcome === 'score' && target.outcome === 'score' ? target.score : null;
  const last = attempts.length > 1 ? attempts[attempts.length - 2] : null;
  const checked = checkRepeatAttempt(
    { date: data.date === undefined ? target.date : data.date, outcome, score, commission: data.commission === undefined ? target.commission : data.commission },
    { card, next: { no: target.no, retake: target.no > 1, commission: Boolean(target.commission) }, last, today, split },
  );
  const problems = [...checked.problems];
  const problem = reasonProblem(data.reason);
  if (problem) problems.push(problem);
  if (problems.length > 0) throw invalid(problems);
  const value = checked.value;
  const before = examText(target);
  const after = examText({ outcome: value.outcome, score: value.score });
  if (before === after && value.date === target.date && value.commission === (target.commission || '')) {
    return { repeat: cardView(rows, platform, card, user) };
  }
  const patch = { date: value.date, outcome: value.outcome, score: value.outcome === 'score' ? value.score : null, commission: value.commission, updatedBy: user.id, updatedAt: at };
  store.updateMany('repeatAttempts', [{ id: target.id, patch }]);
  store.insertMany('changeLog', [logRow(at, user, card, 'try' + target.no, before, after, data.reason.trim())]);
  const next = rows.repeatAttempts.map((a) => (a.id === target.id ? { ...a, ...patch } : a));
  return { repeat: cardView({ ...rows, repeatAttempts: next }, platform, card, user) };
}

// 'repeat.close' { repeatId, acceptFail } -> { repeat }
export function closeRepeat(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const { card, viewer, today, attempts, split, scheme } = scoreCard(rows, platform, data, user, { dated: false });
  const result = repeatResult({ card, attempts, scheme, split });
  const state = closeState({ card, result });
  const force = viewer.manager && isOverdue(card, today);
  if (state.blocking.length > 0 && !force) throw invalid([{ field: 'close', code: state.blocking[0].code }]);
  if (state.retakesLeft && data.acceptFail !== true) throw invalid([{ field: 'acceptFail', code: 'required' }]);
  const at = localDateTime(platform.now());
  const row = saved(store, card, { status: state.outcome, closedBy: user.id, closedAt: at, updatedBy: user.id, updatedAt: at });
  store.insertMany('changeLog', [logRow(at, user, card, 'status', 'open', state.outcome)]);
  return { repeat: cardView(rows, platform, row, user) };
}

// 'repeat.reopen' { repeatId, reason } -> { repeat }; the administrator only
export function reopenRepeat(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const card = findCard(rows, data.repeatId);
  if (!isAdmin(user)) throw new AppError('forbidden');
  if (card.status !== 'passed' && card.status !== 'failed') throw new AppError('not_closed');
  const stamp = (c) => (c.createdAt || '');
  const newer = rows.repeats.some((c) => c.id !== card.id && c.status !== 'cancelled' && c.studentId === card.studentId && c.subjectId === card.subjectId
    && c.planSemester === card.planSemester && (stamp(c) > stamp(card) || (stamp(c) === stamp(card) && c.id > card.id)));
  if (newer) throw invalid([{ field: 'repeat', code: 'has_newer' }]);
  const problem = reasonProblem(data.reason);
  if (problem) throw invalid([problem]);
  const at = localDateTime(platform.now());
  const row = saved(store, card, { status: 'open', closedBy: '', closedAt: '', updatedBy: user.id, updatedAt: at });
  store.insertMany('changeLog', [logRow(at, user, card, 'status', card.status, 'open', data.reason.trim())]);
  return { repeat: cardView(rows, platform, row, user) };
}

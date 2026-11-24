// Repeat course of a subject: enrolment, the new total, admission, closing, the snapshot as text.
// Pure rules: no Google, files, network or clock. Thresholds come from `scheme`, maxima from `split`.
import { isDate, addDays } from './dates.js';
import { REPEAT_KINDS } from './schema.js';
import { subjectResult, checkAttempt, examText, parseExamText } from './exam.js';

export const REPEAT = Object.freeze({ orderMax: 40, noteMax: 300, deadlineDaysMax: 366 });

export function attemptsText(attempts) {
  return attempts.map((a) => `${a.no}|${a.date}|${examText(a)}`).join(';');
}

export function parseAttemptsText(text) {
  if (typeof text !== 'string' || text === '') return [];
  const out = [];
  for (const part of text.split(';')) {
    const bits = part.split('|');
    if (bits.length !== 3 || !/^\d+$/.test(bits[0]) || !isDate(bits[1])) return [];
    const result = parseExamText(bits[2]);
    if (!result) return [];
    out.push({ no: Number(bits[0]), date: bits[1], outcome: result.outcome, score: result.score });
  }
  return out;
}

export function snapshotOf(result) {
  return {
    prevSemester: result.semester,
    prevAdmitted: result.admitted,
    prevStatus: result.status,
    prevExam: result.exam,
    prevTotal: result.total,
    prevWord: result.word === null || result.word === undefined ? '' : result.word,
    prevAttempts: attemptsText(result.attempts),
  };
}

export function prevOf(card) {
  return {
    semester: card.prevSemester,
    admitted: card.prevAdmitted,
    status: card.prevStatus,
    exam: card.prevExam,
    total: card.prevTotal,
    word: card.prevWord === '' || card.prevWord === undefined ? null : card.prevWord,
    attempts: parseAttemptsText(card.prevAttempts),
  };
}

export function canRepeat(prev) {
  if (prev.status === 'not_admitted' || prev.status === 'absent' || prev.status === 'incomplete') return true;
  return prev.status === 'done' && prev.word === 'fail';
}

export function suggestKind(prev) {
  return prev.admitted === true ? null : 'full';
}

function lastClosed(cards) {
  let last = null;
  for (const c of cards) {
    if (!isMain(c)) continue;
    const a = c.closedAt || '', b = last ? last.closedAt || '' : '';
    if (!last || a > b || (a === b && String(c.id) > String(last.id))) last = c;
  }
  return last;
}

export function enrolProblem({ prev, kind, cards, fromRepeat = false }) {
  if (!REPEAT_KINDS.includes(kind)) return { field: 'kind', code: 'bad_value' };
  if (cards.some((c) => c.status === 'open')) return { field: 'studentId', code: 'has_open' };
  const last = lastClosed(cards);
  if (last && last.status === 'passed') return { field: 'studentId', code: 'passed' };
  if (!fromRepeat && !canRepeat(prev)) return { field: 'studentId', code: 'not_failed' };
  if (kind === 'exam' && prev.admitted !== true) return { field: 'kind', code: 'not_admitted' };
  return null;
}

export function checkOrder(input, { today }) {
  const src = input && typeof input === 'object' ? input : {};
  const problems = [];
  let orderNo = '';
  if (typeof src.orderNo !== 'string') problems.push({ field: 'orderNo', code: 'bad_value' });
  else {
    orderNo = src.orderNo.trim();
    if (!orderNo) problems.push({ field: 'orderNo', code: 'required' });
    else if (orderNo.length > REPEAT.orderMax) problems.push({ field: 'orderNo', code: 'too_long' });
  }
  if (!isDate(src.orderDate)) problems.push({ field: 'orderDate', code: 'bad_value' });
  else if (src.orderDate > today) problems.push({ field: 'orderDate', code: 'in_future' });
  if (!isDate(src.deadline)) problems.push({ field: 'deadline', code: 'bad_value' });
  else if (src.deadline < today) problems.push({ field: 'deadline', code: 'in_past' });
  else if (src.deadline > addDays(today, REPEAT.deadlineDaysMax)) problems.push({ field: 'deadline', code: 'too_far' });
  if (problems.length) return { value: null, problems };
  return { value: { orderNo, orderDate: src.orderDate, deadline: src.deadline }, problems };
}

export function repeatResult({ card, attempts, scheme, split }) {
  let semester, admitted;
  if (card.kind === 'full') {
    semester = card.works === undefined ? null : card.works;
    admitted = Number.isInteger(card.works) && card.works > split.admission;
  } else {
    semester = card.prevSemester;
    admitted = card.prevAdmitted === true && Number.isInteger(card.prevSemester);
  }
  return { semester, admitted, ...subjectResult({ semester, admitted, attempts, scheme }) };
}

export function checkWorks(input, { card, split, hasAttempts }) {
  const src = input && typeof input === 'object' ? input : {};
  const problems = [];
  let works = null;
  if (card.kind === 'exam') problems.push({ field: 'works', code: 'not_needed' });
  else if (!Number.isInteger(src.works) || src.works < 0 || src.works > split.semester) problems.push({ field: 'works', code: 'bad_value' });
  else if (hasAttempts && src.works <= split.admission) problems.push({ field: 'works', code: 'has_attempts' });
  else works = src.works;
  let note = '';
  if (typeof src.note !== 'string') problems.push({ field: 'note', code: 'bad_value' });
  else {
    note = src.note.trim();
    if (!note) problems.push({ field: 'note', code: 'required' });
    else if (note.length > REPEAT.noteMax) problems.push({ field: 'note', code: 'too_long' });
  }
  if (problems.length) return { value: null, problems };
  return { value: { works, note }, problems };
}

export function checkRepeatAttempt(input, { card, next, last, today, split }) {
  const checked = checkAttempt(input, { next, last, exam: { examStart: '', examEnd: '' }, today, split });
  const src = input && typeof input === 'object' ? input : {};
  if (checked.problems.some((p) => p.field === 'date')) return checked;
  let extra = null;
  if (src.date < card.orderDate) extra = { field: 'date', code: 'before_order' };
  else if (src.date > card.deadline) extra = { field: 'date', code: 'after_deadline' };
  if (!extra) return checked;
  return { value: null, problems: [extra, ...checked.problems] };
}

export function closeState({ card, result }) {
  const blocking = [];
  if (card.kind === 'full' && !Number.isInteger(card.works)) blocking.push({ code: 'no_works' });
  else if (result.status === 'none') blocking.push({ code: 'exam_missing' });
  else if (result.status === 'incomplete') blocking.push({ code: 'exam_incomplete' });
  const outcome = result.status === 'done' && result.word !== 'fail' ? 'passed' : 'failed';
  const retakesLeft = outcome === 'failed' && result.status !== 'not_admitted' && result.next !== null && blocking.length === 0;
  return { blocking, outcome, retakesLeft };
}

export function isOverdue(card, today) {
  return card.status === 'open' && today > card.deadline;
}

export function shownCard(cards) {
  let last = null;
  for (const c of cards) {
    if (c.status === 'cancelled') continue;
    const a = c.createdAt || '', b = last ? last.createdAt || '' : '';
    if (!last || a > b || (a === b && String(c.id) > String(last.id))) last = c;
  }
  return last;
}

export const isMain = (card) => card.status === 'passed' || card.status === 'failed';

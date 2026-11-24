// Exam of a subject: a result, attempts and retakes, the subject total.
// Pure rules: no Google, files, network or clock. Thresholds come from `scheme`, the exam maximum from `split`.
import { gradeWord } from './grades.js';
import { isDate } from './dates.js';

// Task 7 replaces this with the import of EXAM_OUTCOMES.
const OUTCOMES = ['score', 'absent', 'incomplete'];

export const EXAM = Object.freeze({ triesMax: 3, rowsMax: 6, examinerMax: 120, textMax: 300, itemsMax: 200 });

export function examText(result) {
  if (!result || !result.outcome) return '';
  if (result.outcome === 'score') return String(result.score);
  return result.outcome;
}

export function parseExamText(text) {
  if (typeof text !== 'string') return undefined;
  if (text === '') return null;
  if (text === 'absent' || text === 'incomplete') return { outcome: text, score: null };
  if (/^\d{1,3}$/.test(text)) return { outcome: 'score', score: Number(text) };
  return undefined;
}

export function checkResult(result, split) {
  if (!result || typeof result !== 'object' || !OUTCOMES.includes(result.outcome)) return { field: 'outcome', code: 'bad_value' };
  if (result.outcome === 'score') {
    const ok = Number.isInteger(result.score) && result.score >= 0 && result.score <= split.exam;
    return ok ? null : { field: 'score', code: 'bad_value' };
  }
  return result.score === null ? null : { field: 'score', code: 'bad_value' };
}

function checkText(value, max, field, problems) {
  const text = value === undefined ? '' : value;
  if (typeof text !== 'string') { problems.push({ field, code: 'bad_value' }); return ''; }
  const trimmed = text.trim();
  if (trimmed.length > max) problems.push({ field, code: 'too_long' });
  return trimmed;
}

export function checkHead(input, { exam, strict }) {
  const src = input && typeof input === 'object' ? input : {};
  const problems = [];
  if (!isDate(src.date)) problems.push({ field: 'date', code: 'bad_value' });
  else if (strict && exam.examStart && exam.examEnd && (src.date < exam.examStart || src.date > exam.examEnd)) {
    problems.push({ field: 'date', code: 'out_of_exam' });
  }
  const examiner = checkText(src.examiner, EXAM.examinerMax, 'examiner', problems);
  const assistants = checkText(src.assistants, EXAM.textMax, 'assistants', problems);
  return { value: problems.length ? null : { date: src.date, examiner, assistants }, problems };
}

export function liveAttempts(rows) {
  const latest = new Map();
  for (const row of rows) {
    const had = latest.get(row.no);
    if (!had) { latest.set(row.no, row); continue; }
    const a = row.updatedAt || '', b = had.updatedAt || '';
    if (a > b || (a === b && row.id > had.id)) latest.set(row.no, row);
  }
  return [...latest.values()]
    .filter((row) => row.outcome)
    .sort((x, y) => x.no - y.no)
    .map((row) => ({ id: row.id, no: row.no, date: row.date, outcome: row.outcome, score: row.score, commission: row.commission }));
}

export function subjectResult({ semester, admitted, attempts, scheme, penalty = 0 }) {
  if (admitted !== true) return { status: 'not_admitted', tries: 0, exam: null, total: null, word: null, next: null };
  const tries = attempts.filter((a) => a.outcome === 'score' || a.outcome === 'absent').length;
  let last = null;
  for (const a of attempts) if (!last || a.no > last.no) last = a;
  let status = 'none', exam = null, total = null, word = null;
  if (last) {
    if (last.outcome === 'score') {
      status = 'done';
      exam = last.score;
      total = Math.max(0, semester + exam - penalty);
      word = gradeWord(total, scheme);
    } else {
      status = last.outcome;
    }
  }
  const closed = (status === 'done' && word !== 'fail') || tries >= EXAM.triesMax || attempts.length >= EXAM.rowsMax;
  const next = closed ? null : { no: (last ? last.no : 0) + 1, retake: tries > 0, commission: tries === EXAM.triesMax - 1 };
  return { status, tries, exam, total, word, next };
}

export function checkAttempt(input, { next, last, exam, today, split }) {
  const src = input && typeof input === 'object' ? input : {};
  const problems = [];
  const date = src.date;
  if (!isDate(date)) problems.push({ field: 'date', code: 'bad_value' });
  else if (date > today) problems.push({ field: 'date', code: 'in_future' });
  else if (last && date <= last.date) problems.push({ field: 'date', code: 'order' });
  else if (next.retake && exam.examStart && exam.examEnd && date >= exam.examStart && date <= exam.examEnd) {
    problems.push({ field: 'date', code: 'in_session' });
  }
  const bad = checkResult(src, split);
  if (bad) problems.push(bad);
  let commission = '';
  if (next.commission) {
    const text = typeof src.commission === 'string' ? src.commission.trim() : '';
    if (!text) problems.push({ field: 'commission', code: 'required' });
    else if (text.length > EXAM.textMax) problems.push({ field: 'commission', code: 'too_long' });
    else commission = text;
  }
  if (problems.length) return { value: null, problems };
  return { value: { date, outcome: src.outcome, score: src.score, commission }, problems };
}

export function finalProblems({ units, closed, head, rows }) {
  const out = [];
  if (!units.length) out.push({ code: 'no_units', n: 0 });
  const open = units.filter((u) => !closed.includes(u)).length;
  if (open) out.push({ code: 'units_open', n: open });
  if (!head || !head.date) out.push({ code: 'no_date', n: 0 });
  const missing = rows.filter((r) => !r.left && r.admitted && r.attempts.length === 0).length;
  if (missing) out.push({ code: 'exam_missing', n: missing });
  return out;
}

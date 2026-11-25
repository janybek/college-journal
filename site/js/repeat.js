// The screens of the repeat course (#/repeats, #/repeat/<id>): states, filters, lines of text. Pure, no DOM, for tests.
// The numbers are the server's (repeat.*): the screen has no formula of its own; the maxima come from the answer's `split`.
import { wordTone } from './ledger.js';

export const REPEAT_STATES = ['all', 'open', 'overdue', 'passed', 'failed', 'cancelled'];

const STATE_TONES = { open: 'primary', overdue: 'warning', passed: 'success', failed: 'danger', cancelled: 'neutral' };
const DASH = '—';

// How many sittings an exam allows in all (the first and two retakes): the same number as core/exam.js EXAM.triesMax,
// the site cannot load core/; tests/siteRepeat.test.js checks they are equal. Only for «остались пересдачи: N».
export const EXAM_TRIES_MAX = 3;

export const stateOf = (row) => (row.status === 'open' && row.overdue === true ? 'overdue' : row.status);

export const stateBadge = (row) => {
  const state = stateOf(row);
  return { key: 'repeat.state.' + state, tone: STATE_TONES[state] ?? 'neutral' };
};

const names = (list, field) => [...new Set(list.map((row) => row[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));

export const filterOptions = (repeats) => ({ groups: names(repeats, 'groupName'), subjects: names(repeats, 'subjectName') });

export function filterRepeats(repeats, { group = '', subject = '', state = 'all', own = false } = {}) {
  return repeats.filter((row) => (group === '' || row.groupName === group)
    && (subject === '' || row.subjectName === subject)
    && (state === 'all' || stateOf(row) === state)
    && (!own || row.own === true));
}

const num = (value) => (value === null || value === undefined ? DASH : value);

// The previous result in one line.
export function prevLine(prev, split) {
  const semester = num(prev.semester);
  switch (prev.status) {
    case 'done': return { key: 'repeat.prev.done', params: { total: num(prev.total), max: split.semester + split.exam, semester, exam: num(prev.exam) } };
    case 'not_admitted': return { key: 'repeat.prev.notAdmitted', params: { semester } };
    case 'absent': return { key: 'repeat.prev.absent', params: { semester } };
    default: return { key: 'repeat.prev.incomplete', params: { semester } };
  }
}

// The total of the card: the word of the answer in the tone of the ledger; null while there is nothing to show.
export function totalLine(view) {
  const { result } = view;
  if (result.status === 'done') {
    return {
      key: view.status === 'open' ? 'repeat.total.preliminary' : 'repeat.total', params: { total: result.total, max: view.split.semester + view.split.exam },
      tone: wordTone(result.word), word: result.word,
    };
  }
  if (result.status === 'not_admitted') return { key: 'repeat.total.notAdmitted', params: {}, tone: 'danger', word: null };
  return null;
}

export const enrolDraft = (candidate, subject, today) => ({
  kind: candidate.suggest || 'full', orderNo: '', orderDate: today, deadline: '', teacherId: subject.teacherId,
});

// How many retakes of the exam a student still has (for «остались пересдачи: N»); 0 when none.
// The first sitting is not a retake, so at most EXAM_TRIES_MAX - 1 remain: tries 0 -> 2, 1 -> 2, 2 -> 1, 3 -> 0.
export const retakesLeft = (prev) => (prev.retakesLeft === true ? Math.max(0, Math.min(EXAM_TRIES_MAX - 1, EXAM_TRIES_MAX - (prev.tries || 0))) : 0);

// ---- The card of the teacher of the repeat: the works, the exam, the closing ----

// The block «Работы повтора»: only for the whole subject; the maximum is the answer's, a number that stands needs a reason to change.
export const worksState = (view) => ({
  show: view.kind === 'full', value: view.works.value, note: view.works.note, max: view.split.semester,
  edit: view.can.works === true, needReason: Number.isInteger(view.works.value),
});

// The line under the works: admitted or not, from the answer's `admitted`; no line for «только экзамен» or without works.
export function admissionLine(view) {
  if (view.kind !== 'full' || !Number.isInteger(view.works.value)) return null;
  if (view.result.admitted === true) return { key: 'repeat.admission.yes', params: {}, tone: 'success' };
  return { key: 'repeat.admission.low', params: { need: view.split.admission }, tone: 'danger' };
}

// What the exam block offers to enter: null when there is nothing to enter; canEnter — this person may enter it
// (the sitting by a commission is the deanery's).
export function attemptForm(view) {
  const { next } = view.result;
  if (next === null || next === undefined || view.result.admitted !== true) return null;
  return { no: next.no, retake: next.retake === true, commission: next.commission === true, canEnter: view.can.attempt === true && (!next.commission || view.can.commission === true) };
}

// The last sitting that may be corrected. can.attempt goes false once the exam is passed (nothing is left to enter), but the server
// still corrects the last one until the card is closed: so the right is `can.close` (may score, open) without the overdue deadline.
export function fixTarget(view) {
  if (view.can.close !== true || view.overdue === true || view.attempts.length === 0) return null;
  const last = view.attempts[view.attempts.length - 1];
  if (last.commission && view.can.commission !== true) return null;
  return last;
}

// The line of the closing block: who closed it, what stops it, or what the closing will give.
export function closeNote(view) {
  if (view.status === 'passed' || view.status === 'failed') {
    return { key: 'repeat.closed.' + view.status, params: { date: dayOf((view.closedAt || '').slice(0, 10)), name: view.closedByName || DASH }, tone: view.status === 'passed' ? 'success' : 'danger' };
  }
  if (view.status !== 'open') return null;
  const { blocking, outcome, retakesLeft: left } = view.close;
  if (blocking.length > 0) return { key: 'repeat.block.' + blocking[0].code, params: {}, tone: 'warning' };
  if (left === true) return { key: 'repeat.close.retakesLeft', params: {}, tone: 'warning' };
  return { key: 'repeat.close.ready.' + outcome, params: {}, tone: 'neutral' };
}

export const canClose = (view) => view.can.close === true && (view.close.blocking.length === 0 || view.can.force === true);

// The block of the home screen of the teacher: their own open cards and how many of them are past the deadline.
export function homeRepeats(repeats) {
  const open = repeats.filter((row) => row.own === true && row.status === 'open');
  return { open: open.length, overdue: open.filter((row) => row.overdue === true).length };
}

export const dayOf = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');
export const orderLine = (no, date) => (no ? { key: 'repeat.order', params: { no, date: dayOf(date) } } : null);

// ---- The sheet of a repeat course (A4, portrait) ----

const SIGN_LINE = '____________';
const signLine = (label, name) => (name ? `${label} ${SIGN_LINE} / ${name}` : `${label} ${SIGN_LINE}`);
const JOIN = ' · ';

// The same shape as examSheet (ledgerFile.js), so printSheet prints it. labels: { t, title, draft }.
// A number of a sitting is a number in the table; «не явился(ась)» and «I» stand as words.
export function repeatSheet(view, labels) {
  const { t } = labels;
  const { split, prev, result } = view;
  const max = split.semester + split.exam;
  const open = view.status === 'open';
  const prevText = prevLine(prev, split);
  const prevWord = prev.word ? t('journal.grade.' + prev.word) : '';
  const order = orderLine(view.order.no, view.order.date);
  const full = view.kind === 'full';

  let works;
  if (full) {
    const value = Number.isInteger(view.works.value) ? t('repeat.print.worksOf', { works: view.works.value, max: split.semester }) : '';
    works = [t('repeat.works.title'), [value, view.works.note].filter((part) => part !== '').join('. ')];
  } else {
    const semester = prev.semester === null || prev.semester === undefined ? '' : t('repeat.print.worksOf', { works: prev.semester, max: split.semester });
    works = [t('repeat.print.prevSemester'), semester];
  }

  const totalText = result.status === 'done'
    ? [t('repeat.print.totalOf', { total: result.total, max }), result.word ? t('journal.grade.' + result.word) : ''].filter((part) => part !== '').join(JOIN)
    : result.status === 'not_admitted' ? t('repeat.total.notAdmitted') : '';

  const facts = [
    [t('repeat.fact.student'), view.student.fullName],
    [t('repeat.fact.group'), view.student.groupName],
    [t('repeat.print.course'), view.student.course === null || view.student.course === undefined ? '' : String(view.student.course)],
    [t('repeat.fact.subject'), view.subject.name],
    [t('repeat.fact.semester'), view.subject.planSemester === null || view.subject.planSemester === undefined ? '' : String(view.subject.planSemester)],
    [t('repeat.fact.kind'), t('repeat.kind.' + view.kind)],
    [t('repeat.fact.order'), order ? t(order.key, order.params) : ''],
    [t('repeat.fact.deadline'), dayOf(view.deadline)],
    [t('repeat.fact.teacher'), view.teacher.fullName],
    [t('repeat.prev.title'), [t(prevText.key, prevText.params), prevWord].filter((part) => part !== '').join(JOIN)],
    works,
    [t('repeat.print.total'), totalText],
    [t('repeat.print.result'), view.status === 'passed' || view.status === 'failed' ? t('repeat.print.' + view.status) : ''],
  ];

  const sitting = (a) => [a.no, dayOf(a.date), a.outcome === 'score' ? a.score : a.outcome === 'absent' ? t('ledger.exam.absent') : t('ledger.exam.incomplete'), a.commission || ''];
  const body = view.attempts.length > 0 ? view.attempts.map(sitting) : [['', '', '', '']];

  return {
    college: view.collegeName || '',
    title: labels.title,
    draft: open ? labels.draft : '',
    facts,
    head: [[t('ledger.print.no'), t('ledger.exam.date'), t('repeat.print.result'), t('ledger.attempt.commissionField')]],
    merges: [], body, low: [], counts: null, retakes: null,
    signs: [signLine(t('ledger.print.signTeacher'), view.teacher.fullName), signLine(t('repeat.print.signDean'), '')],
  };
}

// ---- The student: the card on the home screen and in «Оценки» ----

const fullMax = (split) => split.semester + split.exam;

// One own card of a student (an item of `repeats` of student.grades / repeat.mine) as lines of text, in the order of the screen.
// The maxima come from `split`; the attempts are drawn by the screen with attemptLines (ledger.js).
export function studentCard(item, split) {
  const lines = [{ key: 'grades.repeat.kind.' + item.kind, params: {}, tone: 'primary' }];
  const order = item.orderNo ? { key: 'grades.repeat.order', params: { no: item.orderNo, date: dayOf(item.orderDate) }, tone: 'neutral' } : null;
  if (order) lines.push(order);
  if (item.deadline) {
    const late = item.status === 'open' && item.overdue === true;
    lines.push({ key: late ? 'grades.repeat.overdue' : 'grades.repeat.deadline', params: { date: dayOf(item.deadline) }, tone: late ? 'warning' : 'neutral' });
  }
  if (item.teacherName) lines.push({ key: 'grades.repeat.teacher', params: { name: item.teacherName }, tone: 'neutral' });
  if (item.kind === 'full') {
    const has = Number.isInteger(item.works.value);
    if (has) {
      lines.push({ key: 'grades.repeat.works', params: { value: item.works.value, max: split.semester }, tone: 'neutral' });
      if (item.works.note) lines.push({ key: 'grades.repeat.worksNote', params: { note: item.works.note }, tone: 'neutral' });
    } else lines.push({ key: 'grades.repeat.worksNone', params: {}, tone: 'neutral' });
  } else if (Number.isInteger(item.prev.semester)) {
    lines.push({ key: 'grades.repeat.prevSemester', params: { value: item.prev.semester, max: split.semester }, tone: 'neutral' });
  }
  const hasTotal = Number.isInteger(item.total);
  if (item.attempts.length === 0 && item.status === 'open') lines.push({ key: 'grades.repeat.examNone', params: {}, tone: 'neutral' });
  if (hasTotal) {
    lines.push({
      key: item.status === 'open' ? 'grades.repeat.totalPreliminary' : 'grades.repeat.total', params: { total: item.total, max: fullMax(split) },
      tone: wordTone(item.word), word: item.word,
    });
  } else if (item.status === 'failed') lines.push({ key: 'grades.repeat.failedNoTotal', params: {}, tone: 'danger' });
  lines.push(Number.isInteger(item.prev.total)
    ? { key: 'grades.repeat.prev', params: { total: item.prev.total, max: fullMax(split) }, tone: 'muted' }
    : { key: 'grades.repeat.prevNone', params: {}, tone: 'muted' });
  return { title: item.subjectName, lines };
}

// «Оценки», the total of a subject that has a repeat card: the repeat is the main total once it is closed (main), else it only «goes».
export function finalWithRepeat(subject, split) {
  const repeat = subject.repeat;
  if (!repeat) return null;
  const max = fullMax(split);
  if (!repeat.main) return { key: 'grades.repeat.pending', params: { total: repeat.total, max }, tone: 'primary', word: null };
  if (!Number.isInteger(repeat.total)) return { key: 'grades.repeat.mainNone', params: {}, tone: 'danger', word: null };
  return { key: 'grades.repeat.main', params: { total: repeat.total, max }, tone: wordTone(repeat.word), word: repeat.word };
}

// The home screen of a student: how many repeats go and the nearest deadline (an overdue one is the nearest), or null.
export function homeRepeat(repeats) {
  const open = repeats.filter((row) => row.status === 'open')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  if (open.length === 0) return null;
  const [first] = open;
  return { count: open.length, nearest: { subjectName: first.subjectName, deadline: first.deadline, overdue: first.overdue === true } };
}

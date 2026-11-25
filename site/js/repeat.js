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

export const dayOf = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');
export const orderLine = (no, date) => (no ? { key: 'repeat.order', params: { no, date: dayOf(date) } } : null);

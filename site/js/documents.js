import { t } from './i18n.js';

// The screen «Документы › Силлабусы» without the DOM: tabs, counts, overdue dates, the words of states, names, addresses.

export const DOC_TABS = ['approved', 'review', 'development'];

// A tab from the address part; an unknown one is the first.
export function tabOf(part) {
  return DOC_TABS.includes(part) ? part : 'approved';
}

// The number beside every tab: the rows of the answer of docs.syllabi.
export function tabCounts(board) {
  const count = (rows) => (Array.isArray(rows) ? rows.length : 0);
  return { approved: count(board?.approved), review: count(board?.review), development: count(board?.development) };
}

// True when the date is set and earlier than today (both 'YYYY-MM-DD'). The server only gives the date; the colour is the site's.
export function overdue(date, today) {
  return typeof date === 'string' && date !== '' && typeof today === 'string' && date < today;
}

// What waits for the next version of an approved syllabus: the label key, or null.
export function nextKey(next) {
  if (next === 'draft' || next === 'returned') return 'docs.next.draft';
  if (next === 'review') return 'docs.next.review';
  return null;
}

// The state of a syllabus in development: the label key.
export function stateKey(state) {
  if (state === 'draft') return 'docs.state.draft';
  if (state === 'returned') return 'docs.state.returned';
  return 'docs.state.none';
}

// 'Иванова Анна Сергеевна' -> 'Иванова А. С.'; the surname alone stays.
function shortened(fullName) {
  const words = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return [words[0], ...words.slice(1).map((word) => Array.from(word)[0] + '.')].join(' ');
}

// «Иванова А. С., Петров Б. К.»
export function teachersLine(names) {
  return (Array.isArray(names) ? names : []).map(shortened).filter(Boolean).join(', ');
}

export const shortFio = shortened;

// The page of the syllabus of a discipline in a half of the year (draft: the open version); the list of the syllabi
// when the row has no discipline.
export function openHref(row) {
  if (!row || !row.disciplineId) return '#/documents/syllabi';
  const half = row.semester === 1 || row.semester === 2 ? '/' + row.semester + (row.draft ? '/draft' : '') : '';
  return '#/syllabus/d/' + encodeURIComponent(row.disciplineId) + half;
}

export const cardHref = (disciplineId) => '#/documents/discipline/' + encodeURIComponent(disciplineId);

// ---- The window «Выберите силлабус»: one candidate (a row of `candidates` of docs.discipline), the words of the refusals ----

const STATUS_KEYS = { approved: 'docs.candidate.approved', review: 'docs.candidate.review', returned: 'docs.candidate.returned', draft: 'docs.candidate.draft' };
const statusText = (status) => t(STATUS_KEYS[status] ?? 'docs.candidate.none');
const groupsOf = (row) => (Array.isArray(row.groups) ? row.groups : []);

// The two lines of the window: «Фамилия И. · утверждён · версия 2» and «1 семестр · 1 курс · 01-1, 02-1».
export function candidateParts(row) {
  const head = [shortened(row.teacherName), statusText(row.status), row.version ? t('docs.version', { n: row.version }) : ''].filter(Boolean);
  const meta = [
    Number.isInteger(row.planSemester) ? t('docs.candidate.semester', { n: row.planSemester }) : '',
    Number.isInteger(row.course) ? t('docs.candidate.course', { n: row.course }) : '',
    groupsOf(row).join(', '),
  ].filter(Boolean);
  return { head: head.join(' · '), meta: meta.join(' · ') };
}

// One line for a screen reader and the like: «Иванова А. С. · утверждён, версия 2 · 1 семестр, 1 курс · группы: 01-1, 02-1».
export function candidateLine(row) {
  const state = [statusText(row.status), row.version ? t('docs.version', { n: row.version }) : ''].filter(Boolean).join(', ');
  const plan = [
    Number.isInteger(row.planSemester) ? t('docs.candidate.semester', { n: row.planSemester }) : '',
    Number.isInteger(row.course) ? t('docs.candidate.course', { n: row.course }) : '',
  ].filter(Boolean).join(', ');
  const groups = groupsOf(row);
  return [shortened(row.teacherName), state, plan, groups.length > 0 ? t('docs.candidate.groups', { groups: groups.join(', ') }) : ''].filter(Boolean).join(' · ');
}

// What the window says to a refused choice: { key, params }. line_locked names the groups and why (a closed unit, an exam);
// needs_confirm is the warning with the button «Всё равно выбрать» (confirm: true). Any other code is its own error text.
export function chooseError(error) {
  const code = error && typeof error.code === 'string' ? error.code : 'internal';
  if (code === 'needs_confirm') return { key: 'docs.choose.warning', params: {}, confirm: true };
  if (code === 'line_locked') {
    const fields = Array.isArray(error.fields) ? error.fields : [];
    const reasons = [...new Set(fields.map((f) => f.code))].map((reason) => t('docs.choose.reason.' + reason));
    return { key: 'docs.choose.locked', params: { groups: fields.map((f) => f.name).filter(Boolean).join(', '), reason: reasons.join('; ') } };
  }
  return { key: 'error.' + code, params: {} };
}

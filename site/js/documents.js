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

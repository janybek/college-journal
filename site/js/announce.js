// Pieces of the announcement screens that need no DOM (tests/siteAnnounce.test.js). Everything shown comes from the answer of the server.

export const TITLE_MAX = 120;
export const TEXT_MAX = 2000;
export const PER_DAY = 20; // announcements one person may write in a day (the server counts)

const PROBLEM_CODES = ['empty', 'too_long', 'bad_ref', 'bad_value', 'in_past', 'too_far'];

// To whom the announcement is: { key, params } for t().
export function audienceText(item) {
  if (item.audience === 'teachers') return { key: 'announce.to.teachers', params: {} };
  if (item.audience === 'group') return { key: 'announce.to.group', params: { group: item.groupName || '—' } };
  return { key: 'announce.to.all', params: {} };
}

// «показывается до …»: the last day, by the date of the server («today» is never taken from the device).
export function untilText(item, today) {
  if (item.until === today) return { key: 'announce.until.today', params: {} };
  return { key: 'announce.until.date', params: { date: `${String(item.until).slice(8, 10)}.${String(item.until).slice(5, 7)}` } };
}

export function topItems(items, n = 3) {
  return Array.isArray(items) ? items.slice(0, n) : [];
}

// The first line that has any text, for the block on the home screen.
export function firstLine(text) {
  return String(text ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '') ?? '';
}

// The fields of an `invalid` answer: Map(field -> dictionary key). The first problem of a field wins.
export function announceProblems(fields) {
  const map = new Map();
  for (const item of Array.isArray(fields) ? fields : []) {
    if (item && typeof item.field === 'string' && !map.has(item.field)) map.set(item.field, 'announce.form.error.' + (PROBLEM_CODES.includes(item.code) ? item.code : 'bad_value'));
  }
  return map;
}

// «ДД.ММ.ГГГГ» of a date or of a date with time.
export function dayText(value) {
  return typeof value === 'string' && value.length >= 10 ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : '';
}

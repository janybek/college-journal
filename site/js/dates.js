// Dates 'YYYY-MM-DD' and times 'HH:MM' as strings. No DOM, no Intl: day and month names come from the
// dictionaries. Only site/ is published and the site cannot load core/, so this copies what it needs from
// core/dates.js; tests/siteDates.test.js checks that both give the same answers.

const DAY_MS = 86400000;
const parseDate = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
const formatDate = (ms) => new Date(ms).toISOString().slice(0, 10);

// 'YYYY-MM-DD' that exists in the calendar.
export function isDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return formatDate(parseDate(text)) === text;
}

export function addDays(date, n) {
  return formatDate(parseDate(date) + n * DAY_MS);
}

// 1 = Monday ... 7 = Sunday.
export function weekday(date) {
  return ((new Date(parseDate(date)).getUTCDay() + 6) % 7) + 1;
}

export function mondayOf(date) {
  return addDays(date, 1 - weekday(date));
}

// 'HH:MM' from 00:00 to 23:59.
export function isTime(text) {
  return typeof text === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

export function minutesOf(time) {
  return +time.slice(0, 2) * 60 + +time.slice(3, 5);
}

// Never wraps past midnight: callers keep the result within the day.
export function addMinutes(time, n) {
  const total = minutesOf(time) + n;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// '2026-11-21' -> { day: 21, month: 11, weekday: 6 }: numbers to look the names up in the dictionaries.
export function dayParts(date) {
  return { day: +date.slice(8, 10), month: +date.slice(5, 7), weekday: weekday(date) };
}

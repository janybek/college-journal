// Asia/Bishkek: UTC+6 all year, no daylight saving time.
export const TZ_OFFSET_MS = 6 * 3600000;

// Calendar date 'YYYY-MM-DD' of a timestamp (ms) in Bishkek.
export function localDate(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

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

// b minus a, in days.
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
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

// 'HH:MM' of a timestamp (ms) in Bishkek.
export function localTime(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(11, 16);
}

// 'YYYY-MM-DD HH:MM:SS' of a timestamp (ms) in Bishkek.
export function localDateTime(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

// 'YYYY-MM-DD HH:MM:SS' in Bishkek to a timestamp (ms); NaN for anything else.
export function parseLocalDateTime(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(text)) return NaN;
  if (!isDate(text.slice(0, 10))) return NaN;
  return parseDate(text.slice(0, 10)) + (+text.slice(11, 13) * 3600 + +text.slice(14, 16) * 60 + +text.slice(17, 19)) * 1000 - TZ_OFFSET_MS;
}

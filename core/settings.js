// Semester settings: reading from sheet rows, validation, and writing back as rows.
import { isDate, isTime, daysBetween, minutesOf } from './dates.js';

export const PAIR_MINUTES = 90;
export const MAX_SLOTS = 8;
export const MAX_HOLIDAYS = 60;
export const MAX_SEMESTER_DAYS = 200;
export const DEFAULT_BELLS = ['08:00', '09:40', '11:20', '13:30', '15:10', '16:50'];
export const SETTING_KEYS = ['semesterStart', 'semesterEnd', 'holidays', 'bells', 'semester'];

const LAST_MINUTE = 23 * 60 + 59;

const splitList = (text) => (typeof text === 'string' && text !== '' ? text.split(',').map((x) => x.trim()) : []);
const uniqueSorted = (list) => [...new Set(list)].sort();

function bellsValid(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SLOTS) return false;
  if (!list.every((x) => isTime(x))) return false;
  for (let i = 1; i < list.length; i++) {
    if (minutesOf(list[i]) < minutesOf(list[i - 1]) + PAIR_MINUTES) return false;
  }
  return minutesOf(list[list.length - 1]) + PAIR_MINUTES <= LAST_MINUTE;
}

export function readSettings(rows) {
  const byKey = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row && SETTING_KEYS.includes(row.key)) byKey[row.key] = typeof row.value === 'string' ? row.value : String(row.value ?? '');
  }
  const date = (key) => (isDate(byKey[key]) ? byKey[key] : '');
  const holidayList = splitList(byKey.holidays);
  const bellList = splitList(byKey.bells);
  return {
    semesterStart: date('semesterStart'),
    semesterEnd: date('semesterEnd'),
    holidays: holidayList.every((x) => isDate(x)) ? uniqueSorted(holidayList) : [],
    bells: bellsValid(bellList) ? bellList : DEFAULT_BELLS,
    semester: byKey.semester === '2' ? 2 : 1,
  };
}

export function validateSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];
  const value = {};

  const dateErrors = {};
  for (const field of ['semesterStart', 'semesterEnd']) {
    const raw = src[field];
    value[field] = typeof raw === 'string' ? raw.trim() : '';
    if (value[field] === '') dateErrors[field] = 'required';
    else if (!isDate(value[field])) dateErrors[field] = 'bad_value';
  }
  if (!dateErrors.semesterStart && !dateErrors.semesterEnd) {
    const days = daysBetween(value.semesterStart, value.semesterEnd);
    if (days < 0) dateErrors.semesterEnd = 'bad_value';
    else if (days > MAX_SEMESTER_DAYS) dateErrors.semesterEnd = 'too_long';
  }
  for (const field of ['semesterStart', 'semesterEnd']) {
    if (dateErrors[field]) errors.push({ field, code: dateErrors[field] });
  }

  const holidays = src.holidays;
  if (!Array.isArray(holidays) || !holidays.every((x) => isDate(x))) {
    value.holidays = [];
    errors.push({ field: 'holidays', code: 'bad_value' });
  } else {
    value.holidays = uniqueSorted(holidays);
    if (value.holidays.length > MAX_HOLIDAYS) errors.push({ field: 'holidays', code: 'too_long' });
  }

  if (bellsValid(src.bells)) value.bells = [...src.bells];
  else {
    value.bells = [];
    errors.push({ field: 'bells', code: 'bad_value' });
  }

  if (src.semester !== undefined) {
    const semester = typeof src.semester === 'string' ? src.semester.trim() : src.semester;
    if (semester === 1 || semester === 2 || semester === '1' || semester === '2') value.semester = Number(semester);
    else errors.push({ field: 'semester', code: 'bad_value' });
  }
  return { value, errors };
}

export function settingsToRows(value) {
  return SETTING_KEYS.filter((key) => key in value)
    .map((key) => ({ key, value: Array.isArray(value[key]) ? value[key].join(',') : String(value[key]) }));
}

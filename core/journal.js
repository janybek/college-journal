// Rules of marking: the editing term and what may be changed. Pure functions, no time of their own.
import { addDays } from './dates.js';
import { ATTENDANCE_STATUSES, ATTENDED_STATUSES, FIXED_STATUSES, RESULT_FIELDS } from './schema.js';
import { REASON_MAX } from './scoring.js';

// now: { date: 'YYYY-MM-DD', time: 'HH:MM' } in Bishkek. The term ends with the last day (till 23:59).
export function markState(pair, now, scheme) {
  if (pair.status === 'cancelled') return 'cancelled';
  if (pair.status === 'missed') return 'missed';
  if (now.date < pair.date || (now.date === pair.date && now.time < pair.startTime)) return 'future';
  return now.date <= addDays(pair.date, scheme.editDays) ? 'open' : 'late';
}

export function markMode({ state, held, teacher, manager }) {
  if (state === 'future' || state === 'cancelled' || state === 'missed') return 'none';
  if (teacher && state === 'open') return 'free';
  if (manager) return 'reason';
  if (teacher && state === 'late' && held) return 'limited';
  return 'none';
}

export function normalizeMark(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  if (typeof input.status !== 'string') return null;
  if (input.noCoat !== undefined && typeof input.noCoat !== 'boolean') return null;
  if (input.activity !== undefined && input.activity !== null && !Number.isInteger(input.activity)) return null;
  return { status: input.status, noCoat: input.noCoat === true, activity: input.activity === undefined ? null : input.activity };
}

const same = (a, b) => a.status === b.status && a.noCoat === b.noCoat && a.activity === b.activity;

function limitedAllowed(old, next) {
  if (!old || old.noCoat !== next.noCoat) return false;
  if (old.status === 'absent' && next.status === 'excused') return true;
  return (old.status === 'absent' || old.status === 'excused') && next.status === 'madeup';
}

export function checkMark(old, next, { mode, pair, scheme }) {
  if (old && same(old, next)) return [];
  if (!ATTENDANCE_STATUSES.includes(next.status)) return [{ field: 'status', code: 'bad_value' }];
  if (mode === 'none') return [{ field: 'status', code: 'locked' }];
  if (mode === 'limited' && !limitedAllowed(old, next)) return [{ field: 'status', code: 'locked' }];
  const errors = [];
  if (next.activity !== null) {
    if (!ATTENDED_STATUSES.includes(next.status) || pair.first || pair.lessonType === 'control') errors.push({ field: 'activity', code: 'not_allowed' });
    else if (!Number.isInteger(next.activity) || next.activity < 0 || next.activity > scheme.activity) errors.push({ field: 'activity', code: 'bad_value' });
  }
  return errors;
}

export function markChanges(old, next) {
  const out = [];
  const add = (field, before, after) => { if (before !== after) out.push({ field, before, after }); };
  const text = { status: (m) => m.status, noCoat: (m) => (m.noCoat ? 'yes' : 'no'), activity: (m) => (m.activity === null ? '' : String(m.activity)) };
  for (const field of ['status', 'noCoat', 'activity']) {
    const after = text[field](next);
    if (old) add(field, text[field](old), after);
    else if (field === 'status' || (field === 'noCoat' && next.noCoat) || (field === 'activity' && next.activity !== null)) out.push({ field, before: '', after });
  }
  return out;
}

export function checkReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return 'required';
  return text.length > REASON_MAX ? 'too_long' : null;
}

export function checkResultValue(field, value, scheme) {
  if (!RESULT_FIELDS.includes(field)) return 'bad_value';
  if (value === null) return null;
  return Number.isInteger(value) && value >= 0 && value <= scheme[field] ? null : 'bad_value';
}

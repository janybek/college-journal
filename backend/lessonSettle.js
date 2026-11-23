// Settling of started pairs at the beginning of a request: there are no alarms on the server, every request does the arithmetic.
// The end of a check-in window and the closing of a pair are written with the time they were due (not the time of the request).
// Does not import the journal module (no circular import). No Node or Apps Script objects here.
import { parseLocalDateTime } from '../core/dates.js';
import { LESSON, settlePlan } from '../core/lesson.js';

const MIN_MS = 60000;

// A started pair whose window has ended or whose 90 minutes are over. A pair with an unreadable start is left alone.
function isDue(pair, nowMs) {
  if (pair.status !== 'running') return false;
  const startedMs = pair.startedAt ? parseLocalDateTime(pair.startedAt) : NaN;
  if (Number.isNaN(startedMs)) return false;
  if (nowMs >= startedMs + LESSON.autoCloseMinutes * MIN_MS) return true;
  if (pair.checkinClosed) return false;
  const until = parseLocalDateTime(pair.checkinUntil);
  return nowMs >= (Number.isNaN(until) ? startedMs + LESSON.checkinMinutes * MIN_MS : until);
}

// `rows` holds sheets the request has already read (they are not read again). `endCheckin`, `finish`: ids of pairs to settle now.
// -> { ...rows, pairs } and, when something was written, also students and attendance as they stand after the write.
export function settleLessons(store, platform, rows = {}, { endCheckin = [], finish = [], actorId = '' } = {}) {
  const pairs = rows.pairs ?? store.list('pairs');
  const nowMs = platform.now();
  if (endCheckin.length === 0 && finish.length === 0 && !pairs.some((p) => isDue(p, nowMs))) return { ...rows, pairs };
  const students = rows.students ?? store.list('students');
  const attendance = rows.attendance ?? store.list('attendance');
  const { marks, patches } = settlePlan({ pairs, students, attendance, nowMs, endCheckin, finish, actorId });
  const inserted = marks.length > 0 ? store.insertMany('attendance', marks) : [];
  if (patches.length > 0) store.updateMany('pairs', patches);
  const patchOf = new Map(patches.map(({ id, patch }) => [id, patch]));
  return {
    ...rows,
    pairs: patches.length > 0 ? pairs.map((p) => (patchOf.has(p.id) ? { ...p, ...patchOf.get(p.id) } : p)) : pairs,
    students,
    attendance: inserted.length > 0 ? [...attendance, ...inserted] : attendance,
  };
}

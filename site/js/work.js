import { addDays } from './dates.js';

// Rules of the assignments screens that need no DOM: file kinds and how to open them, sizes, deadlines, states of a
// work, the default deadline and the texts of the server's field errors. The server decides everything; this only shows.

const OFFICE = 'application/vnd.openxmlformats-officedocument.';

// The type of a Blob by the kind that the server gave (never by the name of the file and never from the answer).
export const FILE_MIME = Object.freeze({
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  docx: OFFICE + 'wordprocessingml.document',
  xlsx: OFFICE + 'spreadsheetml.sheet',
  pptx: OFFICE + 'presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
});

const known = (kind) => typeof kind === 'string' && Object.prototype.hasOwnProperty.call(FILE_MIME, kind);

export function mimeOf(kind) {
  return known(kind) ? FILE_MIME[kind] : 'application/octet-stream';
}

// 'image': shown on the page; 'open': in a new tab; 'download': saved.
export function viewWay(kind) {
  if (kind === 'jpg' || kind === 'png') return 'image';
  return kind === 'pdf' ? 'open' : 'download';
}

// The name a downloaded file gets: the name without its extension, no signs a file system dislikes, then the kind.
export function downloadName(name, kind) {
  const text = typeof name === 'string' ? name : '';
  const dot = text.lastIndexOf('.');
  const base = (dot > 0 ? text.slice(0, dot) : dot === 0 ? '' : text).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_');
  return (base || 'file') + '.' + (known(kind) ? kind : 'bin');
}

// The size of a file: { key, params } for t(). Up to 1 МБ in whole килобайт (rounded up), above it in мегабайт with a comma.
export function sizeText(bytes) {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (size < 1048576) return { key: 'work.size.kb', params: { n: Math.max(1, Math.ceil(size / 1024)) } };
  return { key: 'work.size.mb', params: { n: (size / 1048576).toFixed(1).replace('.', ',') } };
}

const dateOf = (text) => String(text).slice(0, 10);
const timeOf = (text) => String(text).slice(11, 16);

// The deadline as a line with a tone. dueAt and now are strings of the server ('YYYY-MM-DD HH:MM:SS').
export function dueText(dueAt, now) {
  const time = timeOf(dueAt);
  if (dueAt < now) return { key: 'work.due.overdue', params: {}, tone: 'danger' };
  const today = dateOf(now);
  if (dateOf(dueAt) === today) return { key: 'work.due.today', params: { time }, tone: 'warning' };
  if (dateOf(dueAt) === addDays(today, 1)) return { key: 'work.due.tomorrow', params: { time }, tone: 'warning' };
  const [, month, day] = dateOf(dueAt).split('-');
  return { key: 'work.due.date', params: { date: day + '.' + month, time }, tone: 'neutral' };
}

const STATE_TONES = { none: 'neutral', submitted: 'primary', checked: 'success', returned: 'warning' };

export function stateView(state, late) {
  const view = { key: 'work.state.' + state, tone: STATE_TONES[state] ?? 'neutral' };
  if (late === true) view.lateKey = 'work.state.late';
  return view;
}

const KIND_BY_EXT = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', doc: 'doc', xls: 'xls', ppt: 'ppt',
};

// The same as kindByName of core/files.js (the site does not import core/): the kind by the last extension, or null.
export function kindOfName(name) {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.prototype.hasOwnProperty.call(KIND_BY_EXT, ext) ? KIND_BY_EXT[ext] : null;
}

// What a new assignment is given as its deadline: a week from today (a date of the server), the end of the day.
export function defaultDue(today) {
  return { dueDate: addDays(today, 7), dueTime: '23:59' };
}

// The server's errors of the fields [{ field, code }] -> Map(field -> key of the text); the first error of a field wins.
export function formProblems(fields) {
  const map = new Map();
  for (const item of Array.isArray(fields) ? fields : []) {
    if (item && typeof item.field === 'string' && typeof item.code === 'string' && !map.has(item.field)) {
      map.set(item.field, 'work.form.error.' + item.code);
    }
  }
  return map;
}

// ---- Checking of the works ----

// The attempt with the biggest n of a student of work.get (the server lists them from the newest; the site does not rely on it).
export function currentOf(student) {
  let best = null;
  for (const a of student && Array.isArray(student.attempts) ? student.attempts : []) if (!best || a.n > best.n) best = a;
  return best;
}

// What the grade form starts with: the points and the comment of the current attempt, or nothing for a student who handed nothing in.
export function gradeDraft(student) {
  const current = currentOf(student);
  return { verdict: 'checked', points: current && Number.isInteger(current.points) ? current.points : null, comment: current && typeof current.comment === 'string' ? current.comment : '' };
}

const pointsOf = (value) => (value === null || value === undefined || value === '' ? null : /^\d+$/.test(String(value).trim()) ? Number(String(value).trim()) : NaN);

// The same rule as the server's: points that were already given and change, or a checked work that is returned, need a reason.
// A comment alone changes nothing that needs one. (The server decides; this only shows the field.)
export function gradeNeedsReason(student, draft) {
  const current = currentOf(student);
  if (!current) return false;
  if (current.status === 'checked' && draft.verdict === 'returned') return true;
  if (!Number.isInteger(current.points)) return false;
  return (draft.verdict === 'checked' ? pointsOf(draft.points) : null) !== current.points;
}

export function base64ToBytes(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

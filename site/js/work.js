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

// The deadline of a work that is already handed in: only the date and the time (it is no longer «overdue» for him).
export function dueDateText(dueAt) {
  const [, month, day] = dateOf(dueAt).split('-');
  return { key: 'work.due.date', params: { date: day + '.' + month, time: timeOf(dueAt) }, tone: 'neutral' };
}

// What the student sees as the deadline of his work: the live line until the work is handed in or after it is sent back, the date after.
export const dueOfWork = (dueAt, now, state) => (state === 'none' || state === 'returned' ? dueText(dueAt, now) : dueDateText(dueAt));

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

// ---- The student: the card on the home screen, the choice of files, the failures of an upload ----

const MAX_FILE_BYTES = 10485760;
const MAX_FILES = 5;

// The lines of the card «Задания» of the home screen from the counts of work.mine: only the ones that are not zero.
export function homeCardLines(counts) {
  const c = counts && typeof counts === 'object' ? counts : {};
  const rows = [['fresh', 'neutral'], ['soon', 'warning'], ['overdue', 'danger'], ['returned', 'warning']];
  return rows.filter(([name]) => Number.isInteger(c[name]) && c[name] > 0)
    .map(([name, tone]) => ({ key: 'work.home.' + name, params: { n: c[name] }, tone }));
}

// A photo is any file the phone calls an image (HEIC of an iPhone too): it is shrunk and sent as JPEG.
export const isPhoto = (file) => !!file && typeof file.type === 'string' && file.type.startsWith('image/');

// What is wrong with a chosen file before it is read: its kind (kindOfName of the name; a photo needs none), its size
// (a photo is shrunk first, so its size is not checked), the count (`count` files are already in the list).
export function pickProblem(file, kind, count) {
  if (!isPhoto(file)) {
    if (kind === null || kind === undefined) return 'work.pick.badType';
    if (file.size > MAX_FILE_BYTES) return 'work.pick.tooBig';
  }
  return count >= MAX_FILES ? 'work.pick.tooMany' : null;
}

// The failures of an upload that have a text of their own for the student.
const UPLOAD_ERRORS = ['bad_type', 'bad_file', 'too_big', 'too_many', 'empty', 'upload_limit', 'photo_unreadable', 'already_checked', 'files_unavailable', 'network', 'upload_slow'];
const FIELD_CODES = ['bad_type', 'bad_file', 'too_big', 'too_many', 'empty'];

// The code of a failure: the code of the first fitting field of an `invalid` answer, else the code of the error itself.
export function uploadErrorCode(error) {
  if (!error) return 'internal';
  if (error.code === 'invalid' && Array.isArray(error.fields)) {
    const found = error.fields.find((f) => f && FIELD_CODES.includes(f.code));
    if (found) return found.code;
  }
  return typeof error.code === 'string' ? error.code : typeof error.message === 'string' && UPLOAD_ERRORS.includes(error.message) ? error.message : 'internal';
}

export const uploadErrorKey = (code) => (UPLOAD_ERRORS.includes(code) ? 'work.upload.error.' + code : null);

// May a queued upload still be sent: its screen is still the open one and the person who chose the files is still signed in.
export const mayStillSend = (sameScreen, ownerToken, token) => sameScreen === true && typeof token === 'string' && token !== '' && token === ownerToken;

// ---- The office reads, the teacher works ----

// The buttons of a staff screen: giving, changing and grading only in the role «teacher» (the server answers `can` for
// the person; a man with the roles dean and teacher in the role «Деканат» only reads).
export function staffMay(can, role) {
  const teacher = role === 'teacher' && !!can;
  return { manage: teacher && can.manage === true, grade: teacher && can.grade === true };
}

// The subjects of work.overview for the active role: the teacher role keeps the own subjects; a group (its name) and a
// search by the name of the subject or of the teacher narrow them further.
export function overviewRows(subjects, { role, group = '', query = '' }) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (Array.isArray(subjects) ? subjects : []).filter((s) => {
    if (role === 'teacher' && s.own !== true) return false;
    if (group !== '' && s.groupName !== group) return false;
    const hay = `${s.name || ''} ${s.teacherName || ''}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

// The names of the groups of the subjects, sorted, each once.
export function overviewGroups(subjects) {
  return [...new Set((Array.isArray(subjects) ? subjects : []).map((s) => s.groupName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}

// The file of a syllabus version: attach (or replace), remove, read. The disk box is `files`; the sheet «Файлы» keeps only the row (state 'syllabus').
// Nothing here takes a file off the disk: only the sweep does. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { FILE_LIMITS, SYLLABUS_FILE_KINDS, base64Bytes, cleanFileName, isStoredName, kindByName, sniffKind } from '../core/files.js';
import { rightsOn } from '../core/syllabusFlow.js';
import { lineSubjects, versionsOfLine } from '../core/disciplineSyllabus.js';
import { todayOf } from './scheduleData.js';
import { versionOf } from './syllabusDraft.js';
import { lineOfVersion, viewerOf, worksOn } from './syllabusLines.js';

const MANAGER_ROLES = ['admin', 'dean', 'prorector'];

// The version of the request, when the person may change it (the part both writing actions share).
function editableVersion(store, data, user) {
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const lines = store.list('syllabusLines');
  const viewer = viewerOf(user, lineOfVersion(lines, version), subjects, lines);
  const rights = rightsOn(version, viewer);
  if (!rights.see || !worksOn(viewer)) throw new AppError('forbidden');
  if (!rights.edit) throw new AppError('syllabus_locked');
  return version;
}

// 'syllabus.attachFile' { syllabusId, name, data } -> { file: { name, kind, size, at } }
export function attachSyllabusFile(store, platform, files, data, user) {
  if (!files) throw new AppError('files_unavailable');
  const version = editableVersion(store, data, user);

  const name = cleanFileName(data.name);
  const kind = kindByName(name);
  if (kind === null || !SYLLABUS_FILE_KINDS.includes(kind)) throw new AppError('invalid', { fields: [{ field: 'name', code: 'bad_type' }] });
  const size = base64Bytes(data.data);
  if (size === null) throw new AppError('bad_request');
  if (size === 0) throw new AppError('invalid', { fields: [{ field: 'data', code: 'empty' }] });
  if (size > FILE_LIMITS.maxBytes) throw new AppError('invalid', { fields: [{ field: 'data', code: 'too_big' }] });

  const nowMs = platform.now();
  const today = localDate(nowMs);
  const day = store.list('files').filter((f) => f.ownerId === user.id && String(f.at).slice(0, 10) === today);
  if (day.length >= FILE_LIMITS.perDayCount || day.reduce((sum, f) => sum + (Number(f.size) || 0), 0) + size > FILE_LIMITS.perDayBytes) throw new AppError('upload_limit');

  const bytes = files.decode(data.data);
  if (sniffKind(bytes, kind) === null) throw new AppError('invalid', { fields: [{ field: 'data', code: 'bad_file' }] });
  const stored = platform.randomHex(16) + '.bin';
  files.put(stored, bytes);
  const at = localDateTime(nowMs);
  const [row] = store.insertMany('files', [{ assignmentId: '', submissionId: '', ownerId: user.id, state: 'syllabus', name, kind, size: bytes.length, stored, at }]);
  store.updateMany('syllabi', [{ id: version.id, patch: { fileId: row.id, updated: todayOf(platform), editedBy: user.id } }]);
  return { file: { name, kind, size: bytes.length, at } };
}

// 'syllabus.dropFile' { syllabusId } -> { file: null }
export function dropSyllabusFile(store, platform, files, data, user) {
  if (!files) throw new AppError('files_unavailable');
  const version = editableVersion(store, data, user);
  if (!version.fileId) return { file: null };
  store.updateMany('syllabi', [{ id: version.id, patch: { fileId: '', updated: todayOf(platform), editedBy: user.id } }]);
  return { file: null };
}

// A student reads the file of the approved version of the line his group's subject follows in that half (not while a new version of the half is under review).
function studentMayRead(version, line, lines, syllabi, subjects, user) {
  if (version.status !== 'approved') return false;
  const groupId = user.row.groupId;
  if (typeof groupId !== 'string' || groupId === '') return false;
  if (!lineSubjects(subjects, line, lines, version.semester).some((s) => s.groupId === groupId)) return false;
  const { open } = versionsOfLine(syllabi, line.id, version.semester);
  return open === null || open.status !== 'review';
}

// A teacher who leads a pair of a subject that follows the line in the half of the version (a replacement); the pairs are read only here.
function covers(store, line, lines, version, subjects, user) {
  const ids = new Set(lineSubjects(subjects, line, lines, version.semester).map((s) => s.id));
  return store.list('pairs').some((p) => p.teacherId === user.id && ids.has(p.subjectId));
}

// 'syllabus.file' { syllabusId } -> { file: { name, kind, size, data } }
export function readSyllabusFile(store, platform, files, data, user) {
  if (!files) throw new AppError('files_unavailable');
  const syllabi = store.list('syllabi');
  const version = versionOf(syllabi, data.syllabusId);
  const subjects = store.list('subjects');
  const lines = store.list('syllabusLines');
  const line = lineOfVersion(lines, version);
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (user.kind === 'student') {
    if (!studentMayRead(version, line, lines, syllabi, subjects, user)) throw new AppError('not_found');
  } else {
    const viewer = viewerOf(user, line, subjects, lines);
    let may = false;
    if (version.status === 'approved') {
      // the file of a line of the history is for the deanery and the administrator only
      may = viewer.archived ? roles.includes('admin') || roles.includes('dean')
        : roles.some((r) => MANAGER_ROLES.includes(r)) || (roles.includes('teacher') && (viewer.part !== null || covers(store, line, lines, version, subjects, user)));
    } else {
      may = rightsOn(version, viewer).see;
    }
    if (!may) throw new AppError('forbidden');
  }
  if (!version.fileId) throw new AppError('not_found');
  const row = store.list('files').find((f) => f.id === version.fileId);
  if (!row || row.state !== 'syllabus' || !SYLLABUS_FILE_KINDS.includes(row.kind) || !isStoredName(row.stored)) throw new AppError('file_missing');
  const bytes = files.read(row.stored);
  if (bytes === null) throw new AppError('file_missing');
  return { file: { name: row.name, kind: row.kind, size: row.size, data: files.encode(bytes) } };
}

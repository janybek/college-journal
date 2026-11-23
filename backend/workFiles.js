// Files of the works: a student uploads and drops his own, staff and student read through the same check. Nothing here takes a file off the disk.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { FILE_KINDS, FILE_LIMITS, base64Bytes, cleanFileName, isStoredName, kindByName, sniffKind } from '../core/files.js';
import { currentAttempt } from '../core/work.js';
import { subjectRights, readWorkRows } from './workData.js';
import { isYoung, studentTask } from './workStudent.js';

const isStr = (v) => typeof v === 'string';

export function uploadFile(store, platform, files, data, user) {
  if (!files) throw new AppError('files_unavailable');
  const rows = readWorkRows(store);
  const { assignment } = studentTask(rows, data.assignmentId, user);
  const last = currentAttempt(rows.submissions.filter((r) => r.assignmentId === assignment.id && r.studentId === user.id));
  if (last && last.status === 'checked') throw new AppError('already_checked');

  const name = cleanFileName(data.name);
  const kind = kindByName(name);
  if (kind === null) throw new AppError('invalid', { fields: [{ field: 'name', code: 'bad_type' }] });
  const size = base64Bytes(data.data);
  if (size === null) throw new AppError('bad_request');
  if (size === 0) throw new AppError('invalid', { fields: [{ field: 'data', code: 'empty' }] });
  if (size > FILE_LIMITS.maxBytes) throw new AppError('invalid', { fields: [{ field: 'data', code: 'too_big' }] });

  const nowMs = platform.now();
  const own = rows.files.filter((f) => f.ownerId === user.id);
  if (own.filter((f) => f.assignmentId === assignment.id && f.state === 'pending' && isYoung(f, nowMs)).length >= FILE_LIMITS.perWork) {
    throw new AppError('invalid', { fields: [{ field: 'files', code: 'too_many' }] });
  }
  const today = localDate(nowMs);
  const day = own.filter((f) => f.at.slice(0, 10) === today);
  if (day.length >= FILE_LIMITS.perDayCount || day.reduce((sum, f) => sum + f.size, 0) + size > FILE_LIMITS.perDayBytes) throw new AppError('upload_limit');

  const bytes = files.decode(data.data);
  if (sniffKind(bytes, kind) === null) throw new AppError('invalid', { fields: [{ field: 'data', code: 'bad_file' }] });
  const stored = platform.randomHex(16) + '.bin';
  files.put(stored, bytes);
  const [row] = store.insertMany('files', [{
    assignmentId: assignment.id, submissionId: '', ownerId: user.id, state: 'pending', name, kind, size: bytes.length, stored, at: localDateTime(nowMs),
  }]);
  return { file: { id: row.id, name, kind, size: bytes.length } };
}

export function dropFile(store, platform, files, data, user) {
  const rows = store.list('files');
  const file = isStr(data.fileId) ? rows.find((f) => f.id === data.fileId) : undefined;
  if (!file || file.ownerId !== user.id || file.state !== 'pending') throw new AppError('not_found');
  store.updateMany('files', [{ id: file.id, patch: { state: 'dropped' } }]);
  return {};
}

export function readFile(store, platform, files, data, user) {
  if (!files) throw new AppError('files_unavailable');
  const rows = readWorkRows(store);
  const file = isStr(data.fileId) ? rows.files.find((f) => f.id === data.fileId) : undefined;
  if (!file) throw new AppError('not_found');
  const assignment = rows.assignments.find((a) => a.id === file.assignmentId);
  const subject = assignment ? rows.subjects.find((s) => s.id === assignment.subjectId) : undefined;
  if (user.kind === 'student') {
    if (file.ownerId !== user.id || (file.state !== 'pending' && file.state !== 'attached')) throw new AppError('not_found');
    if (!subject || subject.groupId !== user.row.groupId) throw new AppError('not_found');
  } else {
    if (file.state !== 'attached' || !subject) throw new AppError('not_found');
    if (!subjectRights(subject, user).read) throw new AppError('forbidden');
  }
  if (!isStoredName(file.stored) || !FILE_KINDS.includes(file.kind)) throw new AppError('file_missing');
  const bytes = files.read(file.stored);
  if (bytes === null) throw new AppError('file_missing');
  return { file: { id: file.id, name: file.name, kind: file.kind, size: file.size, data: files.encode(bytes) } };
}

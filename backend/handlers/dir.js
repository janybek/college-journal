import { AppError } from '../../core/errors.js';
import { normalizeRow, validateRow } from '../../core/validate.js';
import { generateTempPassword, hashPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { readSettings } from '../../core/settings.js';
import { USER_TABLES } from '../users.js';
import { teacherHandover } from '../../core/schedule.js';
import { lineFor, partOf, versionsOfLine } from '../../core/disciplineSyllabus.js';
import { rightsOn } from '../../core/syllabusFlow.js';
import { viewerOf } from '../syllabusLines.js';
import { dirSummary, dirCard } from '../dirInfo.js';
import { loadSettings, relayout, todayOf } from '../scheduleData.js';

const DIR_TABLES = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'weekTemplate'];
const LOGIN_TABLES = ['students', 'staff'];

function tableOf(data, allowed = DIR_TABLES) {
  if (typeof data.table !== 'string' || !allowed.includes(data.table)) throw new AppError('bad_request');
  return data.table;
}

// The one place that removes the password hash from rows sent to the site.
function withoutHash(row) {
  const { passwordHash, ...rest } = row;
  return rest;
}

// Sheets each table's validation needs.
const DB_SHEETS = {
  groups: ['groups'],
  students: ['groups', 'students', 'staff'],
  staff: ['staff', 'students'],
  disciplines: ['disciplines'],
  subjects: ['subjects', 'staff', 'groups', 'disciplines'],
  rooms: ['rooms'],
  weekTemplate: ['weekTemplate', 'subjects', 'rooms'],
};

// Reads only the sheets `table` needs plus `extra`, each once.
export function loadDb(store, table, extra = []) {
  const db = {};
  for (const name of [...DB_SHEETS[table], ...extra]) {
    if (!(name in db)) db[name] = store.list(name);
  }
  if (table === 'weekTemplate') db.slotCount = readSettings(store.list('settings')).bells.length;
  return db;
}

// Fresh temporary password: the plain text (shown once) and the fields to store.
export function issueTempPassword(platform) {
  const tempPassword = generateTempPassword(platform);
  return { tempPassword, stored: { passwordHash: hashPassword(platform, tempPassword, undefined, TEMP_HASH_ROUNDS), mustChangePassword: true } };
}

const isActiveAdmin = (row) => row.active === true
  && String(row.roles ?? '').split(',').map((r) => r.trim()).includes('admin');

function list(data, ctx) {
  const table = tableOf(data);
  return { rows: ctx.store.list(table).map(withoutHash) };
}

const isId = (v) => typeof v === 'string' && v !== '';

// A subject that stands in the week template or in the pairs keeps its group and its discipline.
function checkSubjectKeys(old, row, db) {
  const fields = ['groupId', 'disciplineId'].filter((field) => row[field] !== old[field]).map((field) => ({ field, code: 'in_use' }));
  if (fields.length === 0) return;
  const used = db.weekTemplate.some((r) => r.subjectId === old.id) || db.pairs.some((p) => p.subjectId === old.id);
  if (used) throw new AppError('invalid', { fields });
}

// Renaming a discipline renames its subjects: one read of the sheet, one batch write.
function renameSubjects(store, saved) {
  const patches = store.list('subjects')
    .filter((s) => s.disciplineId === saved.id && s.name !== saved.name)
    .map((s) => ({ id: s.id, patch: { name: saved.name } }));
  if (patches.length > 0) store.updateMany('subjects', patches);
}

function save(data, ctx) {
  const table = tableOf(data);
  const { store, platform } = ctx;
  const input = data.row !== null && typeof data.row === 'object' && !Array.isArray(data.row) ? data.row : {};
  const extra = table === 'subjects' ? ['weekTemplate', 'pairs'] : [];
  const db = loadDb(store, table, extra);
  const old = isId(input.id) ? db[table].find((r) => r.id === input.id) ?? null : null;
  if (isId(input.id) && !old) throw new AppError('not_found');

  const row = normalizeRow(table, { ...old, ...input, id: old ? old.id : undefined, passwordHash: old ? old.passwordHash : undefined });
  if (table === 'subjects') {
    // The name belongs to the discipline: whatever the request says, the server sets it.
    const discipline = db.disciplines.find((d) => d.id === row.disciplineId);
    row.name = discipline ? discipline.name : '';
    if (old) checkSubjectKeys(old, row, db);
  }
  const fields = validateRow(table, row, db);
  if (fields.length > 0) throw new AppError('invalid', { fields });

  if (old) {
    const saved = store.update(table, old.id, row);
    if (table === 'disciplines' && saved.name !== old.name) renameSubjects(store, saved);
    // A new teacher of a group takes its future pairs and the group follows that teacher's syllabus: one batch of pairs.
    if (table === 'subjects' && saved.teacherId !== old.teacherId) {
      const { patches, skippedBusy } = teacherHandover(db.pairs, saved, todayOf(platform), old.teacherId);
      relayout(store, [saved.id], { subjects: db.subjects.map((s) => (s.id === saved.id ? saved : s)), pairs: db.pairs }, patches);
      return { row: withoutHash(saved), skippedBusy };
    }
    return { row: withoutHash(saved) };
  }

  if (!LOGIN_TABLES.includes(table)) return { row: withoutHash(store.insert(table, row)) };
  const { tempPassword, stored } = issueTempPassword(platform);
  const created = store.insert(table, { ...row, ...stored });
  return { row: withoutHash(created), tempPassword };
}

// What blocks deleting a row: [sheet, test(row)] pairs, each sheet read once. A stored syllabus keeps its discipline and its teacher.
const BLOCKERS = {
  disciplines: (id) => [['subjects', (r) => r.disciplineId === id], ['syllabi', (r) => r.disciplineId === id], ['syllabusLines', (r) => r.disciplineId === id]],
  groups: (id) => [['students', (r) => r.groupId === id], ['subjects', (r) => r.groupId === id], ['pairs', (r) => r.groupId === id],
    ['stateExams', (r) => r.groupId === id], ['announcements', (r) => r.groupId === id],
  ],
  students: (id) => [
    ['attendance', (r) => r.studentId === id], ['checkins', (r) => r.studentId === id], ['unitResults', (r) => r.studentId === id], ['changeLog', (r) => r.studentId === id],
    ['submissions', (r) => r.studentId === id], ['files', (r) => r.ownerId === id],
    ['requests', (r) => r.studentId === id], ['stateExamResults', (r) => r.studentId === id], ['examAttempts', (r) => r.studentId === id],
    ['repeats', (r) => r.studentId === id],
  ],
  staff: (id) => [
    ['subjects', (r) => r.teacherId === id], ['pairs', (r) => r.teacherId === id], ['syllabi', (r) => r.teacherId === id],
    ['syllabusLines', (r) => r.teacherId === id || r.responsibleId === id || r.createdBy === id],
    ['attendance', (r) => r.markedBy === id], ['unitResults', (r) => r.updatedBy === id], ['changeLog', (r) => r.actorId === id],
    ['assignments', (r) => r.createdBy === id], ['assignments', (r) => r.updatedBy === id], ['submissions', (r) => r.checkedBy === id],
    ['closures', (r) => r.closedBy === id || r.reopenedBy === id], ['requests', (r) => r.authorId === id || r.deanBy === id || r.finalBy === id],
    ['announcements', (r) => r.authorId === id || r.removedBy === id], ['stateExams', (r) => r.createdBy === id || r.updatedBy === id],
    ['stateExamResults', (r) => r.updatedBy === id], ['subjectExams', (r) => r.updatedBy === id], ['examAttempts', (r) => r.updatedBy === id],
    ['repeats', (r) => r.teacherId === id || r.createdBy === id || r.updatedBy === id || r.closedBy === id], ['repeatAttempts', (r) => r.updatedBy === id],
  ],
  subjects: (id) => [['weekTemplate', (r) => r.subjectId === id], ['pairs', (r) => r.subjectId === id], ['unitResults', (r) => r.subjectId === id], ['assignments', (r) => r.subjectId === id],
    ['closures', (r) => r.subjectId === id], ['requests', (r) => r.subjectId === id], ['subjectExams', (r) => r.subjectId === id], ['examAttempts', (r) => r.subjectId === id],
    ['repeats', (r) => r.subjectId === id],
  ],
  rooms: (id) => [['weekTemplate', (r) => r.roomId === id], ['pairs', (r) => r.roomId === id]],
};

// `read` returns a sheet's rows and reads each sheet once per request.
function usedBy(read, table, id) {
  const blockers = Object.prototype.hasOwnProperty.call(BLOCKERS, table) ? BLOCKERS[table](id) : [];
  return blockers.some(([sheet, test]) => read(sheet).some(test));
}

function remove(data, ctx, user) {
  const table = tableOf(data);
  const { store } = ctx;
  if (table === USER_TABLES[user.kind] && data.id === user.id) throw new AppError('forbidden');
  const sheets = new Map();
  const read = (name) => {
    if (!sheets.has(name)) sheets.set(name, store.list(name));
    return sheets.get(name);
  };
  const rows = read(table);
  const row = rows.find((r) => r.id === data.id);
  if (!row) throw new AppError('not_found');
  if (usedBy(read, table, row.id)) throw new AppError('in_use');
  if (table === 'staff' && isActiveAdmin(row) && !rows.some((s) => s.id !== row.id && isActiveAdmin(s))) {
    throw new AppError('invalid', { fields: [{ field: 'roles', code: 'last_admin' }] });
  }
  store.remove(table, row.id);
  return {};
}

function resetPassword(data, ctx) {
  const table = tableOf(data, LOGIN_TABLES);
  const { store, platform } = ctx;
  const row = store.get(table, data.id);
  if (!row) throw new AppError('not_found');
  const { tempPassword, stored } = issueTempPassword(platform);
  store.update(table, row.id, stored);
  return { tempPassword };
}

function mySubjects(data, ctx, user) {
  const { store } = ctx;
  const groups = store.list('groups');
  const students = store.list('students').filter((s) => s.active === true);
  const all = store.list('subjects');
  const mine = all.filter((s) => s.teacherId === user.id);
  const syllabi = store.list('syllabi');
  const lines = store.list('syllabusLines');
  const half = loadSettings(store).semester;
  const subjects = mine.map((s) => {
    const group = groups.find((g) => g.id === s.groupId);
    const lineId = s.disciplineId ? lineFor(lines, { disciplineId: s.disciplineId, teacherId: s.teacherId, semester: half }) : null;
    const line = lineId === null ? null : lines.find((l) => l.id === lineId);
    const { approved, open } = line ? versionsOfLine(syllabi, line.id, half) : { approved: null, open: null };
    const seen = open && rightsOn(open, viewerOf(user, line, all, lines)).see ? open : null;
    const part = line ? partOf(line, user.id, all, lines) : null;
    return {
      id: s.id,
      name: s.name,
      groupId: s.groupId,
      groupName: group ? group.name : '',
      studentCount: students.filter((st) => st.groupId === s.groupId).length,
      syllabus: { approved: approved !== null, open: seen ? seen.status : null, ...(part !== null ? { mine: part } : {}) },
    };
  });
  return { subjects };
}

function overrides(data, ctx) {
  return { rows: ctx.store.list('translations').map(({ key, ky, ru, en }) => ({ key, ky, ru, en })) };
}

export const dirHandlers = {
  'dir.list': list,
  'dir.summary': (data, ctx, user) => dirSummary(ctx.store, ctx.platform, user, data.table),
  'dir.card': (data, ctx, user) => dirCard(ctx.store, ctx.platform, user, data),
  'dir.save': save,
  'dir.remove': remove,
  'dir.resetPassword': resetPassword,
  'teacher.mySubjects': mySubjects,
  'i18n.overrides': overrides,
};

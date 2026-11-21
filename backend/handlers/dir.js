import { AppError } from '../../core/errors.js';
import { normalizeRow, validateRow } from '../../core/validate.js';
import { generateTempPassword, hashPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { readSettings } from '../../core/settings.js';
import { FIXED_STATUSES } from '../../core/schema.js';
import { semesterOf } from '../../core/topics.js';
import { USER_TABLES, canEditSubjectTopics } from '../users.js';
import { relayout } from '../scheduleData.js';

const DIR_TABLES = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms', 'weekTemplate', 'topics'];
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
  topics: ['topics', 'subjects'],
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

function save(data, ctx, user) {
  const table = tableOf(data);
  const { store, platform } = ctx;
  const input = data.row !== null && typeof data.row === 'object' && !Array.isArray(data.row) ? data.row : {};
  const extra = table === 'subjects' ? ['weekTemplate', 'pairs'] : table === 'topics' ? ['pairs'] : [];
  const db = loadDb(store, table, extra);
  const old = isId(input.id) ? db[table].find((r) => r.id === input.id) ?? null : null;
  if (isId(input.id) && !old) throw new AppError('not_found');

  const row = normalizeRow(table, { ...old, ...input, id: old ? old.id : undefined, passwordHash: old ? old.passwordHash : undefined });
  if (table === 'topics') {
    // Checked on the cleaned value that is validated and stored, so ' sb2 ' or ['sb2'] cannot slip past.
    const subject = db.subjects.find((r) => r.id === (old ? old.subjectId : row.subjectId));
    // A new topic of an unknown subject is left to validateRow (bad_ref); an existing orphan is staff-only.
    if ((subject || old) && !canEditSubjectTopics(user, subject)) throw new AppError('forbidden');
  }
  if (table === 'subjects') {
    // The name belongs to the discipline: whatever the request says, the server sets it.
    const discipline = db.disciplines.find((d) => d.id === row.disciplineId);
    row.name = discipline ? discipline.name : '';
    if (old) checkSubjectKeys(old, row, db);
  }
  if (old && table === 'topics' && row.subjectId !== old.subjectId) {
    throw new AppError('invalid', { fields: [{ field: 'subjectId', code: 'bad_value' }] });
  }
  if (old && table === 'topics' && row.semester !== semesterOf(old)) {
    throw new AppError('invalid', { fields: [{ field: 'semester', code: 'bad_value' }] });
  }
  const fields = validateRow(table, row, db);
  if (fields.length > 0) throw new AppError('invalid', { fields });

  if (old) {
    const saved = store.update(table, old.id, row);
    if (table === 'disciplines' && saved.name !== old.name) renameSubjects(store, saved);
    if (table === 'topics') relayout(store, [saved.subjectId], { topics: db.topics.map((t) => (t.id === saved.id ? saved : t)), pairs: db.pairs });
    return { row: withoutHash(saved) };
  }

  if (table === 'topics') {
    const created = store.insert(table, row);
    relayout(store, [created.subjectId], { topics: [...db.topics, created], pairs: db.pairs });
    return { row: created };
  }
  if (!LOGIN_TABLES.includes(table)) return { row: withoutHash(store.insert(table, row)) };
  const { tempPassword, stored } = issueTempPassword(platform);
  const created = store.insert(table, { ...row, ...stored });
  return { row: withoutHash(created), tempPassword };
}

// What blocks deleting a row: [sheet, test(row)] pairs, each sheet read once.
const BLOCKERS = {
  disciplines: (id) => [['subjects', (r) => r.disciplineId === id]],
  groups: (id) => [['students', (r) => r.groupId === id], ['subjects', (r) => r.groupId === id], ['pairs', (r) => r.groupId === id]],
  staff: (id) => [['subjects', (r) => r.teacherId === id], ['pairs', (r) => r.teacherId === id]],
  subjects: (id) => [['topics', (r) => r.subjectId === id], ['weekTemplate', (r) => r.subjectId === id], ['pairs', (r) => r.subjectId === id]],
  rooms: (id) => [['weekTemplate', (r) => r.roomId === id], ['pairs', (r) => r.roomId === id]],
  topics: (id) => [['pairs', (r) => r.topicId === id && FIXED_STATUSES.includes(r.status)]],
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
  if (table === 'topics') {
    const subject = read('subjects').find((r) => r.id === row.subjectId);
    if (!canEditSubjectTopics(user, subject)) throw new AppError('forbidden');
  }
  if (usedBy(read, table, row.id)) throw new AppError('in_use');
  if (table === 'staff' && isActiveAdmin(row) && !rows.some((s) => s.id !== row.id && isActiveAdmin(s))) {
    throw new AppError('invalid', { fields: [{ field: 'roles', code: 'last_admin' }] });
  }
  store.remove(table, row.id);
  if (table === 'topics') {
    relayout(store, [row.subjectId], { topics: rows.filter((r) => r.id !== row.id), pairs: read('pairs') });
  }
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
  const subjects = store.list('subjects')
    .filter((s) => s.teacherId === user.id)
    .map((s) => {
      const group = groups.find((g) => g.id === s.groupId);
      return {
        id: s.id,
        name: s.name,
        groupId: s.groupId,
        groupName: group ? group.name : '',
        studentCount: students.filter((st) => st.groupId === s.groupId).length,
      };
    });
  return { subjects };
}

function overrides(data, ctx) {
  return { rows: ctx.store.list('translations').map(({ key, ky, ru, en }) => ({ key, ky, ru, en })) };
}

export const dirHandlers = {
  'dir.list': list,
  'dir.save': save,
  'dir.remove': remove,
  'dir.resetPassword': resetPassword,
  'teacher.mySubjects': mySubjects,
  'i18n.overrides': overrides,
};

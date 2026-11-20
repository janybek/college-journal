import { AppError } from '../../core/errors.js';
import { normalizeRow, validateRow } from '../../core/validate.js';
import { generateTempPassword, hashPassword, TEMP_HASH_ROUNDS } from '../../core/auth.js';
import { USER_TABLES } from '../users.js';

const DIR_TABLES = ['groups', 'students', 'staff', 'subjects', 'rooms'];
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

export function loadDb(store) {
  return {
    groups: store.list('groups'),
    students: store.list('students'),
    staff: store.list('staff'),
    subjects: store.list('subjects'),
    rooms: store.list('rooms'),
  };
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

function save(data, ctx) {
  const table = tableOf(data);
  const { store, platform } = ctx;
  const input = data.row !== null && typeof data.row === 'object' && !Array.isArray(data.row) ? data.row : {};
  const old = typeof input.id === 'string' && input.id !== '' ? store.get(table, input.id) : null;
  if (typeof input.id === 'string' && input.id !== '' && !old) throw new AppError('not_found');

  const row = normalizeRow(table, { ...old, ...input, id: old ? old.id : undefined, passwordHash: old ? old.passwordHash : undefined });
  const fields = validateRow(table, row, loadDb(store));
  if (fields.length > 0) throw new AppError('invalid', { fields });

  if (old) return { row: withoutHash(store.update(table, old.id, row)) };

  if (!LOGIN_TABLES.includes(table)) return { row: withoutHash(store.insert(table, row)) };
  const { tempPassword, stored } = issueTempPassword(platform);
  const created = store.insert(table, { ...row, ...stored });
  return { row: withoutHash(created), tempPassword };
}

function usedBy(store, table, id) {
  if (table === 'groups') {
    return store.list('students').some((s) => s.groupId === id) || store.list('subjects').some((s) => s.groupId === id);
  }
  if (table === 'staff') return store.list('subjects').some((s) => s.teacherId === id);
  return false;
}

function remove(data, ctx, user) {
  const table = tableOf(data);
  const { store } = ctx;
  if (table === USER_TABLES[user.kind] && data.id === user.id) throw new AppError('forbidden');
  const row = store.get(table, data.id);
  if (!row) throw new AppError('not_found');
  if (usedBy(store, table, row.id)) throw new AppError('in_use');
  if (table === 'staff' && isActiveAdmin(row) && !store.list('staff').some((s) => s.id !== row.id && isActiveAdmin(s))) {
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

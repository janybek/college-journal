import { DEFAULT_LANG, LANGS } from '../core/schema.js';
import { listPermissions } from '../core/permissions.js';

// Shared user helpers for the request pipeline and handlers. No Node-only APIs (bundled for Apps Script).
export const USER_TABLES = { staff: 'staff', student: 'students' };

export function rolesOf(row, kind) {
  if (kind === 'student') return ['student'];
  return String(row.roles ?? '').split(',').map((r) => r.trim()).filter((r) => r !== '');
}

// The value the person types to log in: staff login or student card number.
export function loginOf(row, kind) {
  return kind === 'student' ? row.cardNo : row.login;
}

// A row may log in only when it is active and has a stored password hash.
export function isUsable(row) {
  return row.active === true && typeof row.passwordHash === 'string' && row.passwordHash !== '';
}

// Name of the group with this id, or null when there is no id, no store to look in, or the group no longer exists.
function groupNameOf(store, groupId) {
  if (!store || groupId === null) return null;
  const group = store.get('groups', groupId);
  return group ? group.name : null;
}

// The user object sent to the site. Never contains passwordHash.
// `store` resolves a student's group name; without it `groupName` is null.
export function publicUser(row, kind, store) {
  const roles = rolesOf(row, kind);
  const groupId = kind === 'student' ? (row.groupId ?? null) : null;
  return {
    id: row.id,
    kind,
    fullName: row.fullName,
    roles,
    lang: LANGS.includes(row.lang) ? row.lang : DEFAULT_LANG,
    mustChangePassword: row.mustChangePassword === true,
    groupId,
    groupName: groupNameOf(store, groupId),
    permissions: listPermissions(roles),
  };
}

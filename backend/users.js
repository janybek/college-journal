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

// The user object sent to the site. Never contains passwordHash.
export function publicUser(row, kind) {
  const roles = rolesOf(row, kind);
  return {
    id: row.id,
    kind,
    fullName: row.fullName,
    roles,
    lang: LANGS.includes(row.lang) ? row.lang : DEFAULT_LANG,
    mustChangePassword: row.mustChangePassword === true,
    groupId: kind === 'student' ? (row.groupId ?? null) : null,
    permissions: listPermissions(roles),
  };
}

// Permission matrix. Pure data plus lookups; roles come from the user's row.

const ALL_TABLES = ['groups', 'students', 'staff', 'subjects', 'rooms'];
const DEAN_TABLES = ['groups', 'students', 'subjects', 'rooms'];

const PUBLIC_ACTIONS = ['auth.login', 'i18n.overrides'];
const ANY_ACTIONS = ['auth.me', 'auth.changePassword', 'user.setLang'];

// action -> role -> allowed tables (or true for actions without a table)
const ROLE_ACTIONS = {
  'dir.list': { admin: ALL_TABLES, dean: ALL_TABLES, prorector: ALL_TABLES },
  'dir.save': { admin: ALL_TABLES, dean: DEAN_TABLES },
  'dir.remove': { admin: ALL_TABLES, dean: DEAN_TABLES },
  'import.preview': { admin: ALL_TABLES, dean: DEAN_TABLES },
  'import.apply': { admin: ALL_TABLES, dean: DEAN_TABLES },
  'dir.resetPassword': { admin: ['students', 'staff'], dean: ['students'] },
  'teacher.mySubjects': { teacher: true },
};

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// 'public' (no token), 'any' (any logged-in user), 'role' (needs a role) or null (unknown action).
export function actionKind(action) {
  if (PUBLIC_ACTIONS.includes(action)) return 'public';
  if (ANY_ACTIONS.includes(action)) return 'any';
  if (typeof action === 'string' && has(ROLE_ACTIONS, action)) return 'role';
  return null;
}

export function can(roles, action, table) {
  const kind = actionKind(action);
  if (kind === 'public') return true;
  const list = Array.isArray(roles) ? roles : [];
  if (kind === 'any') return list.length > 0;
  if (kind !== 'role') return false;
  return list.some((role) => {
    const allowed = has(ROLE_ACTIONS[action], role) ? ROLE_ACTIONS[action][role] : undefined;
    if (allowed === true) return true;
    return Array.isArray(allowed) && allowed.includes(table);
  });
}

// Role-gated permissions only: 'action:table' or a bare action name, sorted, no duplicates.
export function listPermissions(roles) {
  const list = Array.isArray(roles) ? roles : [];
  const result = new Set();
  for (const [action, byRole] of Object.entries(ROLE_ACTIONS)) {
    for (const role of list) {
      if (!has(byRole, role)) continue;
      const allowed = byRole[role];
      if (allowed === true) result.add(action);
      else for (const table of allowed) result.add(action + ':' + table);
    }
  }
  return [...result].sort();
}

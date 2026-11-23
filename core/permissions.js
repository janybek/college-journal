// Permission matrix. Pure data plus lookups; roles come from the user's row.

const ALL_TABLES = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms'];
const DEAN_TABLES = ['groups', 'students', 'disciplines', 'subjects', 'rooms'];
const SCHEDULE_TABLES = ['weekTemplate'];
const LIST_TABLES = [...ALL_TABLES, ...SCHEDULE_TABLES];
const DEAN_EDIT_TABLES = [...DEAN_TABLES, ...SCHEDULE_TABLES];
const IMPORT_TABLES = ALL_TABLES;
const DEAN_IMPORT_TABLES = DEAN_TABLES;

const PUBLIC_ACTIONS = ['auth.login', 'i18n.overrides', 'checkin.pass'];
const ANY_ACTIONS = ['auth.me', 'auth.changePassword', 'user.setLang'];

// action -> role -> allowed tables (or true for actions without a table)
const ROLE_ACTIONS = {
  'dir.list': { admin: LIST_TABLES, dean: LIST_TABLES, prorector: LIST_TABLES },
  'dir.save': { admin: LIST_TABLES, dean: DEAN_EDIT_TABLES },
  'dir.remove': { admin: LIST_TABLES, dean: DEAN_EDIT_TABLES },
  'syllabus.preview': { admin: true, dean: true, teacher: true },
  'syllabus.apply': { admin: true, dean: true, teacher: true },
  'import.preview': { admin: IMPORT_TABLES, dean: DEAN_IMPORT_TABLES },
  'import.apply': { admin: IMPORT_TABLES, dean: DEAN_IMPORT_TABLES },
  'dir.resetPassword': { admin: ['students', 'staff'], dean: ['students'] },
  'subjects.add': { admin: true, dean: true },
  'subjects.overview': { admin: true, dean: true, prorector: true },
  'teacher.mySubjects': { teacher: true },
  'settings.get': { admin: true, dean: true, prorector: true },
  'settings.save': { admin: true, dean: true },
  'schedule.list': { admin: true, dean: true, prorector: true },
  'schedule.generate': { admin: true, dean: true },
  'schedule.changePair': { admin: true, dean: true },
  'schedule.cancelPair': { admin: true, dean: true },
  'schedule.restorePair': { admin: true, dean: true },
  'syllabus.get': { admin: true, dean: true, prorector: true, teacher: true, student: true },
  'syllabus.form': { admin: true, dean: true, prorector: true, teacher: true },
  'syllabus.startDraft': { admin: true, dean: true, teacher: true },
  'syllabus.saveSection': { admin: true, dean: true, teacher: true },
  'syllabus.submit': { admin: true, dean: true, teacher: true },
  'syllabus.approve': { admin: true, dean: true },
  'syllabus.return': { admin: true, dean: true },
  'syllabus.queue': { admin: true, dean: true, prorector: true },
  'student.subjects': { student: true },
  'schedule.mine': { teacher: true, student: true },
  'scoring.get': { admin: true, dean: true, prorector: true },
  'scoring.save': { admin: true, dean: true },
  'journal.list': { admin: true, dean: true, prorector: true, teacher: true },
  'journal.get': { admin: true, dean: true, prorector: true, teacher: true },
  'journal.savePair': { admin: true, dean: true, teacher: true },
  'journal.saveResults': { admin: true, dean: true, teacher: true },
  'journal.missPair': { admin: true, dean: true },
  'journal.reopenPair': { admin: true, dean: true },
  'journal.log': { admin: true, dean: true, prorector: true, teacher: true },
  'student.grades': { student: true },
  'lesson.mine': { teacher: true },
  'lesson.get': { teacher: true },
  'lesson.start': { teacher: true },
  'lesson.endCheckin': { teacher: true },
  'lesson.finish': { teacher: true },
  'checkin.current': { student: true },
  'checkin.mark': { student: true },
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

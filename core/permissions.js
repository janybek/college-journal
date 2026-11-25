// Permission matrix. Pure data plus lookups; roles come from the user's row.

const ALL_TABLES = ['groups', 'students', 'staff', 'disciplines', 'subjects', 'rooms'];
const DEAN_TABLES = ['groups', 'students', 'disciplines', 'subjects', 'rooms'];
const SCHEDULE_TABLES = ['weekTemplate'];
const LIST_TABLES = [...ALL_TABLES, ...SCHEDULE_TABLES];
const DEAN_EDIT_TABLES = [...DEAN_TABLES, ...SCHEDULE_TABLES];
const CARD = ['groups', 'rooms', 'disciplines'];
const IMPORT_TABLES = ALL_TABLES;
const DEAN_IMPORT_TABLES = DEAN_TABLES;

const PUBLIC_ACTIONS = ['auth.login', 'i18n.overrides', 'checkin.pass'];
const ANY_ACTIONS = ['auth.me', 'auth.changePassword', 'user.setLang'];

// action -> role -> allowed tables (or true for actions without a table)
const ROLE_ACTIONS = {
  'dir.list': { admin: LIST_TABLES, dean: LIST_TABLES, prorector: LIST_TABLES },
  'dir.summary': { admin: CARD, dean: CARD, prorector: CARD },
  'dir.card': { admin: CARD, dean: CARD, prorector: CARD },
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
  'syllabus.attachFile': { admin: true, dean: true, teacher: true },
  'syllabus.dropFile': { admin: true, dean: true, teacher: true },
  'syllabus.file': { admin: true, dean: true, prorector: true, teacher: true, student: true },
  'syllabus.approve': { admin: true, dean: true },
  'syllabus.return': { admin: true, dean: true },
  'syllabus.queue': { admin: true, dean: true, prorector: true },
  'syllabus.invite': { teacher: true },
  'syllabus.join': { teacher: true },
  'syllabus.decline': { teacher: true },
  'syllabus.leave': { teacher: true },
  'syllabus.invitations': { teacher: true },
  'syllabus.withdraw': { admin: true, dean: true, teacher: true },
  'syllabus.remove': { admin: true, dean: true, teacher: true },
  'syllabus.add': { admin: true, dean: true },
  'syllabus.setAuthor': { admin: true, dean: true },
  'syllabus.newLine': { admin: true, dean: true },
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
  'work.overview': { admin: true, dean: true, prorector: true, teacher: true },
  'work.list': { admin: true, dean: true, prorector: true, teacher: true },
  'work.get': { admin: true, dean: true, prorector: true, teacher: true, student: true },
  'work.save': { teacher: true },
  'work.remove': { teacher: true },
  'work.grade': { teacher: true },
  'work.mine': { student: true },
  'work.upload': { student: true },
  'work.dropFile': { student: true },
  'work.submit': { student: true },
  'work.file': { admin: true, dean: true, prorector: true, teacher: true, student: true },
  'ledger.list': { admin: true, dean: true, prorector: true, teacher: true },
  'ledger.get': { admin: true, dean: true, prorector: true, teacher: true },
  'ledger.closeUnit': { admin: true, dean: true, teacher: true },
  'ledger.closeFinal': { admin: true, dean: true, teacher: true },
  'ledger.reopen': { admin: true },
  'ledger.saveExam': { admin: true, dean: true, teacher: true },
  'ledger.addAttempt': { admin: true, dean: true, teacher: true },
  'request.create': { teacher: true },
  'request.mine': { teacher: true },
  'request.withdraw': { teacher: true },
  'request.queue': { admin: true, dean: true, prorector: true },
  'request.decide': { admin: true, dean: true, prorector: true },
  'stateExam.list': { admin: true, dean: true, prorector: true, teacher: true },
  'stateExam.get': { admin: true, dean: true, prorector: true, teacher: true },
  'stateExam.save': { admin: true, dean: true },
  'stateExam.saveScores': { admin: true, dean: true },
  'stateExam.remove': { admin: true, dean: true },
  'repeat.list': { admin: true, dean: true, prorector: true, teacher: true },
  'repeat.get': { admin: true, dean: true, prorector: true, teacher: true },
  'repeat.candidates': { admin: true, dean: true },
  'repeat.enrol': { admin: true, dean: true },
  'repeat.save': { admin: true, dean: true },
  'repeat.cancel': { admin: true, dean: true },
  'repeat.saveWorks': { admin: true, dean: true, teacher: true },
  'repeat.saveAttempt': { admin: true, dean: true, teacher: true },
  'repeat.close': { admin: true, dean: true, teacher: true },
  'repeat.reopen': { admin: true },
  'repeat.mine': { student: true },
  'announce.list': { admin: true, dean: true, prorector: true, teacher: true, student: true },
  'announce.save': { admin: true, dean: true, teacher: true },
  'announce.remove': { admin: true, dean: true, teacher: true },
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

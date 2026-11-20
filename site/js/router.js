import { DIR_TABLES } from './views/directoryConfig.js';

// Maps the address (#/...) and the signed-in user to a screen. Pure: no DOM, no storage.
// Tables such as topics and weekTemplate are listed through dir.* too, but have screens of their own:
// only the directories of DIR_TABLES open on the directory screen.
export function resolveRoute(hash, user) {
  if (!user) return { view: 'login', params: {} };
  if (user.mustChangePassword === true) return { view: 'changePassword', params: {} };
  const path = String(hash ?? '').replace(/^#/, '');
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const dir = /^\/dir\/([^/]+)$/.exec(path);
  if (dir && DIR_TABLES.includes(dir[1]) && permissions.includes('dir.list:' + dir[1])) return { view: 'directory', params: { table: dir[1] } };
  if (path === '/import' && permissions.some((p) => p.startsWith('import.apply:'))) return { view: 'import', params: {} };
  // #/syllabus/<subjectId>: the import screen for the syllabus of one subject (its teacher and the deanery).
  const syllabus = /^\/syllabus\/([^/]+)$/.exec(path);
  if (syllabus && permissions.includes('syllabus.apply')) return { view: 'import', params: { subjectId: syllabus[1] } };
  if (path === '/schedule' && permissions.includes('schedule.list')) return { view: 'schedule', params: {} };
  // #/template, #/template/<groupId>, #/template/<groupId>/<weekday 1–5>: the group to show and the day to mark.
  const template = /^\/template(?:\/([^/]+)(?:\/([1-5]))?)?$/.exec(path);
  if (template && permissions.includes('dir.list:weekTemplate')) {
    const params = {};
    if (template[1]) params.groupId = template[1];
    if (template[2]) params.weekday = Number(template[2]);
    return { view: 'weekTemplate', params };
  }
  // #/topics, #/topics/<subjectId>: the deanery's «Темы», with that subject chosen.
  const topics = /^\/topics(?:\/([^/]+))?$/.exec(path);
  if (topics && permissions.includes('dir.list:topics')) return { view: 'topics', params: topics[1] ? { subjectId: topics[1] } : {} };
  if (path === '/settings' && permissions.includes('settings.get')) return { view: 'settings', params: {} };
  if (path === '/my' && permissions.includes('schedule.mine')) return { view: 'mySchedule', params: {} };
  const plan = /^\/plan\/([^/]+)$/.exec(path);
  if (plan && permissions.includes('topics.plan')) return { view: 'plan', params: { subjectId: plan[1] } };
  return { view: 'home', params: {} };
}

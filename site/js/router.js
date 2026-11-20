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
  if (path === '/schedule' && permissions.includes('schedule.list')) return { view: 'schedule', params: {} };
  if (path === '/template' && permissions.includes('dir.list:weekTemplate')) return { view: 'weekTemplate', params: {} };
  if (path === '/topics' && permissions.includes('dir.list:topics')) return { view: 'topics', params: {} };
  if (path === '/settings' && permissions.includes('settings.get')) return { view: 'settings', params: {} };
  return { view: 'home', params: {} };
}

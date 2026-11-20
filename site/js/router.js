// Maps the address (#/...) and the signed-in user to a screen. Pure: no DOM, no storage.
export function resolveRoute(hash, user) {
  if (!user) return { view: 'login', params: {} };
  if (user.mustChangePassword === true) return { view: 'changePassword', params: {} };
  const path = String(hash ?? '').replace(/^#/, '');
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const dir = /^\/dir\/([^/]+)$/.exec(path);
  if (dir && permissions.includes('dir.list:' + dir[1])) return { view: 'directory', params: { table: dir[1] } };
  if (path === '/import' && permissions.some((p) => p.startsWith('import.apply:'))) return { view: 'import', params: {} };
  return { view: 'home', params: {} };
}

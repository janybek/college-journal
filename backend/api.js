import { AppError } from '../core/errors.js';
import { readToken, passwordVersion } from '../core/auth.js';
import { actionKind, can } from '../core/permissions.js';
import { USER_TABLES, isUsable, rolesOf } from './users.js';
import { authHandlers } from './handlers/auth.js';

// Single entry point of the server. No Node-only APIs: this file is bundled for Apps Script.
export { publicUser } from './users.js';

const ALLOWED_WHILE_MUST_CHANGE = ['auth.me', 'auth.changePassword', 'user.setLang'];
const handlers = {};

export function registerHandlers(map) {
  Object.assign(handlers, map);
}
registerHandlers(authHandlers);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseRequest(raw) {
  let request = raw;
  if (typeof raw === 'string') {
    try { request = JSON.parse(raw); } catch (error) { throw new AppError('bad_request'); }
  }
  if (!isPlainObject(request) || typeof request.action !== 'string') throw new AppError('bad_request');
  return { action: request.action, token: request.token, data: isPlainObject(request.data) ? request.data : {} };
}

// Resolves the token to { id, kind, roles, row }, or throws `unauthorized`.
function authenticate(ctx, token) {
  const claims = readToken(ctx.platform, token);
  if (!claims || !Object.prototype.hasOwnProperty.call(USER_TABLES, claims.kind)) throw new AppError('unauthorized');
  const row = ctx.store.get(USER_TABLES[claims.kind], claims.uid);
  if (!row || !isUsable(row) || claims.pv !== passwordVersion(row.passwordHash)) throw new AppError('unauthorized');
  return { id: row.id, kind: claims.kind, roles: rolesOf(row, claims.kind), row };
}

function dispatch(request, ctx) {
  const { action, token, data } = request;
  const kind = actionKind(action);
  if (kind === null) throw new AppError('bad_request');
  let user = null;
  if (kind !== 'public') {
    user = authenticate(ctx, token);
    if (!can(user.roles, action, data.table)) throw new AppError('forbidden');
    if (user.row.mustChangePassword === true && !ALLOWED_WHILE_MUST_CHANGE.includes(action)) {
      throw new AppError('must_change_password');
    }
  }
  const handler = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
  if (!handler) throw new AppError('bad_request');
  return handler(data, ctx, user);
}

// Never throws. Always returns { ok, data | error, serverTime }.
export function handleRequest(raw, ctx) {
  const serverTime = ctx.platform.now();
  try {
    const data = dispatch(parseRequest(raw), ctx);
    return { ok: true, data, serverTime };
  } catch (error) {
    if (error instanceof AppError) {
      const body = { code: error.code };
      if (error.fields !== undefined) body.fields = error.fields;
      return { ok: false, error: body, serverTime };
    }
    if (typeof ctx.log === 'function') {
      try { ctx.log(error); } catch (logError) { /* logging must never break the response */ }
    }
    return { ok: false, error: { code: 'internal' }, serverTime };
  }
}

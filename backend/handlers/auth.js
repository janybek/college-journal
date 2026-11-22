import { AppError } from '../../core/errors.js';
import { LANGS } from '../../core/schema.js';
import { loginKey } from '../../core/loginGuard.js';
import { hashPassword, verifyPassword, passwordVersion, passwordProblem, issueToken } from '../../core/auth.js';
import { USER_TABLES, isUsable, loginOf, publicUser } from '../users.js';

const sameText = (a, b) => String(a ?? '').trim().toLowerCase() === b;

function findByLogin(store, login) {
  if (login === '') return null;
  const staff = store.list('staff').find((row) => sameText(row.login, login));
  if (staff) return { row: staff, kind: 'staff' };
  const student = store.list('students').find((row) => sameText(row.cardNo, login));
  return student ? { row: student, kind: 'student' } : null;
}

function sessionFor(ctx, row, kind) {
  const token = issueToken(ctx.platform, { uid: row.id, kind, pv: passwordVersion(row.passwordHash) });
  return { token, user: publicUser(row, kind, ctx.store) };
}

// ctx.loginGuard is optional: Apps Script has none and login works there as before.
function login(data, ctx) {
  const guard = ctx.loginGuard;
  const key = loginKey(data.login);
  const now = ctx.platform.now();
  if (guard && guard.blockedFor(key, now) > 0) throw new AppError('too_many_attempts');
  const typed = typeof data.login === 'string' ? data.login.trim().toLowerCase() : '';
  const found = findByLogin(ctx.store, typed);
  const ok = found !== null && isUsable(found.row) && verifyPassword(ctx.platform, data.password, found.row.passwordHash);
  if (!ok) {
    if (guard) guard.fail(key, now);
    throw new AppError('bad_credentials');
  }
  if (guard) guard.success(key);
  return sessionFor(ctx, found.row, found.kind);
}

function me(data, ctx, user) {
  return { user: publicUser(user.row, user.kind, ctx.store) };
}

function changePassword(data, ctx, user) {
  if (!verifyPassword(ctx.platform, data.oldPassword, user.row.passwordHash)) throw new AppError('bad_credentials');
  const newPasswordError = (code) => new AppError('invalid', { fields: [{ field: 'newPassword', code }] });
  if (typeof data.newPassword !== 'string') throw newPasswordError('invalid');
  // The first password is printed on the dean's list: keeping it would leave the account open to whoever saw it.
  if (data.newPassword === data.oldPassword) throw newPasswordError('same_as_old');
  const problem = passwordProblem(data.newPassword, loginOf(user.row, user.kind));
  if (problem) throw newPasswordError(problem);
  const row = ctx.store.update(USER_TABLES[user.kind], user.id, {
    passwordHash: hashPassword(ctx.platform, data.newPassword),
    mustChangePassword: false,
  });
  return sessionFor(ctx, row, user.kind);
}

function setLang(data, ctx, user) {
  if (!LANGS.includes(data.lang)) throw new AppError('invalid', { fields: [{ field: 'lang', code: 'invalid' }] });
  const row = ctx.store.update(USER_TABLES[user.kind], user.id, { lang: data.lang });
  return { user: publicUser(row, user.kind, ctx.store) };
}

export const authHandlers = {
  'auth.login': login,
  'auth.me': me,
  'auth.changePassword': changePassword,
  'user.setLang': setLang,
};

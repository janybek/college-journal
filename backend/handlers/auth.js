import { AppError } from '../../core/errors.js';
import { LANGS } from '../../core/schema.js';
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

function login(data, ctx) {
  const typed = typeof data.login === 'string' ? data.login.trim().toLowerCase() : '';
  const found = findByLogin(ctx.store, typed);
  const ok = found !== null && isUsable(found.row) && verifyPassword(ctx.platform, data.password, found.row.passwordHash);
  if (!ok) throw new AppError('bad_credentials');
  return sessionFor(ctx, found.row, found.kind);
}

function me(data, ctx, user) {
  return { user: publicUser(user.row, user.kind, ctx.store) };
}

function changePassword(data, ctx, user) {
  if (!verifyPassword(ctx.platform, data.oldPassword, user.row.passwordHash)) throw new AppError('bad_credentials');
  const problem = passwordProblem(data.newPassword, loginOf(user.row, user.kind));
  if (problem) throw new AppError('invalid', { fields: [{ field: 'newPassword', code: problem }] });
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

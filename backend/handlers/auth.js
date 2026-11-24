import { AppError } from '../../core/errors.js';
import { LANGS } from '../../core/schema.js';
import { loginKey } from '../../core/loginGuard.js';
import { hashPassword, verifyPassword, passwordVersion, passwordProblem, issueToken, needsRehash, HASH_ROUNDS, TEMP_HASH_ROUNDS } from '../../core/auth.js';
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

// Never matches: only there so that a missing account costs one hash of the usual strength.
const DUMMY_V2 = 'v2$14$8$1$' + '0123456789abcdef'.repeat(2) + '$' + 'f'.repeat(64);
const DUMMY_V1 = 'v1$100$0123456789abcdef$' + 'f'.repeat(64);
const dummyHash = (platform) => (typeof platform.scryptHex === 'function' ? DUMMY_V2 : DUMMY_V1);

// An old v1 hash is rewritten as scrypt after a good login (the typed password is known only now).
// A failed write is no reason to refuse the login: the old hash still works and the token is made for it.
function rehashed(password, found, ctx) {
  const { row, kind } = found;
  if (!needsRehash(ctx.platform, row.passwordHash)) return row;
  try {
    const rounds = row.mustChangePassword ? TEMP_HASH_ROUNDS : HASH_ROUNDS;
    return ctx.store.update(USER_TABLES[kind], row.id, { passwordHash: hashPassword(ctx.platform, password, undefined, rounds) });
  } catch (error) {
    if (typeof ctx.log === 'function') ctx.log(error);
    return row;
  }
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
    // an unknown login costs the same time as a wrong password: the answer does not tell which logins exist
    if (found === null || !isUsable(found.row)) verifyPassword(ctx.platform, data.password, dummyHash(ctx.platform));
    if (guard) guard.fail(key, now);
    throw new AppError('bad_credentials');
  }
  if (guard) guard.success(key);
  return sessionFor(ctx, rehashed(data.password, found, ctx), found.kind);
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

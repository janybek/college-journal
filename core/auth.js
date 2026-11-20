// Password hashing and session tokens. Pure: all time, randomness and hashing come from `platform`.

export const HASH_ROUNDS = 500;
export const MIN_PASSWORD = 6;
export const TOKEN_TTL_MS = { staff: 7 * 86400000, student: 30 * 86400000 };

const MAX_STORED_ROUNDS = 100000;
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const COMMON_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '111111', '000000',
  'qwerty', 'password', 'parol', 'пароль',
];

// Compares whole strings without an early exit on the first difference.
function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function hashPassword(platform, password, salt, rounds = HASH_ROUNDS) {
  const usedSalt = salt === undefined ? platform.randomHex(8) : salt;
  let h = platform.sha256Hex(usedSalt + ':' + password);
  for (let i = 1; i < rounds; i++) h = platform.sha256Hex(h + ':' + usedSalt);
  return 'v1$' + rounds + '$' + usedSalt + '$' + h;
}

export function verifyPassword(platform, password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  if (!/^[1-9][0-9]*$/.test(parts[1])) return false;
  const rounds = Number(parts[1]);
  if (rounds > MAX_STORED_ROUNDS) return false;
  return constantTimeEqual(hashPassword(platform, password, parts[2], rounds), stored);
}

export function passwordVersion(stored) {
  return String(stored).slice(-8);
}

export function passwordProblem(password, login) {
  const text = String(password ?? '');
  if (text.length < MIN_PASSWORD) return 'too_short';
  const lower = text.toLowerCase();
  if (login !== undefined && login !== null && lower === String(login).toLowerCase()) return 'same_as_login';
  if (COMMON_PASSWORDS.includes(lower) || /^(.)\1*$/u.test(text)) return 'too_simple';
  return null;
}

export function generateTempPassword(platform) {
  const hex = platform.randomHex(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += TEMP_ALPHABET[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % TEMP_ALPHABET.length];
  }
  return out;
}

export function issueToken(platform, { uid, kind, pv }) {
  if (!Object.prototype.hasOwnProperty.call(TOKEN_TTL_MS, kind)) throw new Error('unknown token kind: ' + kind);
  const exp = platform.now() + TOKEN_TTL_MS[kind];
  const body = encodeURIComponent(JSON.stringify({ uid, kind, pv, exp }));
  return body + '.' + platform.hmacSha256Hex(platform.secret(), body);
}

// Returns { uid, kind, pv, exp } or null; never throws.
export function readToken(platform, token) {
  try {
    if (typeof token !== 'string') return null;
    const dot = token.lastIndexOf('.');
    if (dot < 0) return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!constantTimeEqual(platform.hmacSha256Hex(platform.secret(), body), signature)) return null;
    const data = JSON.parse(decodeURIComponent(body));
    if (data === null || typeof data !== 'object') return null;
    const { uid, kind, pv, exp } = data;
    if (typeof uid !== 'string' || typeof pv !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(TOKEN_TTL_MS, kind)) return null;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= platform.now()) return null;
    return { uid, kind, pv, exp };
  } catch (error) {
    return null;
  }
}

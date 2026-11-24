// Password hashing and session tokens. Pure: all time, randomness and hashing come from `platform`.
// Hashing is scrypt (v2) where the platform has `scryptHex`; on Apps Script it is v1 (salted SHA-256 rounds).
// Both formats are accepted when verifying.

export const HASH_ROUNDS = 100;
// Temporary passwords (random, must be changed at first login) are hashed lighter.
// With scrypt these two values only choose the strength: own password or temporary password.
export const TEMP_HASH_ROUNDS = 20;
export const SCRYPT = {
  own: { logN: 14, r: 8, p: 1, keylen: 32 },
  temp: { logN: 12, r: 8, p: 1, keylen: 32 },
};
export const MIN_PASSWORD = 6;
export const TOKEN_TTL_MS = { staff: 7 * 86400000, student: 30 * 86400000 };

const MAX_STORED_ROUNDS = 100000;
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const COMMON_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '111111', '000000',
  'qwerty', 'password', 'parol', 'пароль',
];

// Compares whole strings without an early exit on the first difference.
export function constantTimeEqual(a, b) {
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
  if (typeof platform.scryptHex === 'function') {
    const usedSalt = salt === undefined ? platform.randomHex(16) : salt;
    const o = rounds === TEMP_HASH_ROUNDS ? SCRYPT.temp : SCRYPT.own;
    const hex = platform.scryptHex(password, usedSalt, o);
    return 'v2$' + o.logN + '$' + o.r + '$' + o.p + '$' + usedSalt + '$' + hex;
  }
  return hashV1(platform, password, salt, rounds);
}

function hashV1(platform, password, salt, rounds) {
  const usedSalt = salt === undefined ? platform.randomHex(8) : salt;
  let h = platform.sha256Hex(usedSalt + ':' + password);
  for (let i = 1; i < rounds; i++) h = platform.sha256Hex(h + ':' + usedSalt);
  return 'v1$' + rounds + '$' + usedSalt + '$' + h;
}

function verifyV2(platform, password, parts) {
  if (typeof platform.scryptHex !== 'function' || parts.length !== 6) return false;
  const [, logNText, rText, pText, salt, hash] = parts;
  if (!/^[0-9]{1,2}$/.test(logNText) || !/^[0-9]{1,2}$/.test(rText) || !/^[0-9]$/.test(pText)) return false;
  const logN = Number(logNText);
  const r = Number(rText);
  const p = Number(pText);
  if (logN < 10 || logN > 16 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  if (!/^[0-9a-f]{16,64}$/.test(salt) || !/^[0-9a-f]{64}$/.test(hash)) return false;
  const hex = platform.scryptHex(password, salt, { logN, r, p, keylen: 32 });
  return typeof hex === 'string' && constantTimeEqual(hex, hash);
}

export function verifyPassword(platform, password, stored) {
  if (typeof stored !== 'string' || typeof password !== 'string') return false;
  try {
    const parts = stored.split('$');
    if (parts[0] === 'v2') return verifyV2(platform, password, parts);
    if (parts.length !== 4 || parts[0] !== 'v1') return false;
    if (!/^[1-9][0-9]*$/.test(parts[1])) return false;
    const rounds = Number(parts[1]);
    if (rounds > MAX_STORED_ROUNDS) return false;
    return constantTimeEqual(hashV1(platform, password, parts[2], rounds), stored);
  } catch (error) {
    return false;
  }
}

// True when the stored hash is the old v1 and this platform can make scrypt: rewrite it after a good login.
export function needsRehash(platform, stored) {
  return typeof platform.scryptHex === 'function' && typeof stored === 'string' && stored.startsWith('v1$');
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

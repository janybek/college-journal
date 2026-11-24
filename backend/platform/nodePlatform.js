import { createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';

// Node implementation of the platform object: time, randomness, hashing, secret.
export function createNodePlatform({ now, secret } = {}) {
  return {
    now: now || (() => new Date().getTime()),
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    sha256Hex: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
    hmacSha256Hex: (key, text) => createHmac('sha256', key).update(text, 'utf8').digest('hex'),
    // scrypt of the password; the salt is the hex text itself. Apps Script has no such function and keeps the v1 hashes.
    scryptHex: (password, salt, { logN, r, p, keylen }) =>
      scryptSync(password, salt, keylen, { N: 2 ** logN, r, p, maxmem: 64 * 1024 * 1024 }).toString('hex'),
    secret: () => secret ?? (process.env.JOURNAL_SECRET || 'dev-secret'),
  };
}

import { createHash, createHmac, randomBytes } from 'node:crypto';

// Node implementation of the platform object: time, randomness, hashing, secret.
export function createNodePlatform({ now, secret } = {}) {
  return {
    now: now || (() => new Date().getTime()),
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
    sha256Hex: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
    hmacSha256Hex: (key, text) => createHmac('sha256', key).update(text, 'utf8').digest('hex'),
    secret: () => secret ?? (process.env.JOURNAL_SECRET || 'dev-secret'),
  };
}

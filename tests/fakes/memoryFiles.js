import { isStoredName } from '../../core/files.js';

// The file box in memory: the same device as the disk box (backend/node/files.js), plus names().
export function createMemoryFiles() {
  const files = new Map();
  const check = (stored) => {
    if (!isStoredName(stored)) throw new Error('bad stored name');
  };
  return {
    put(stored, bytes) {
      check(stored);
      files.set(stored, Uint8Array.from(bytes));
    },
    read(stored) {
      check(stored);
      return files.has(stored) ? Uint8Array.from(files.get(stored)) : null;
    },
    decode: (base64) => new Uint8Array(Buffer.from(base64, 'base64')),
    encode: (bytes) => Buffer.from(bytes).toString('base64'),
    names: () => [...files.keys()].sort(),
  };
}

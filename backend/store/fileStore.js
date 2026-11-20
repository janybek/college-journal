import fs from 'node:fs';
import path from 'node:path';
import { createMemoryStore } from './memoryStore.js';

// memoryStore that rewrites a JSON file after every change (Node only, synchronous).
export function createFileStore(schema, platform, filePath) {
  const data = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : {};
  const store = createMemoryStore(schema, platform, data);

  const save = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  };
  const persisted = (fn) => (...args) => {
    const result = fn(...args);
    save();
    return result;
  };

  return {
    ...store,
    insert: persisted(store.insert),
    insertMany: persisted(store.insertMany),
    update: persisted(store.update),
    updateMany: persisted(store.updateMany),
    remove: persisted(store.remove),
    removeMany: persisted(store.removeMany),
  };
}

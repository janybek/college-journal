import { AppError } from '../../core/errors.js';

// Shared helpers (also used by sheetsStore). No Node-only APIs: this file is bundled for Apps Script.
export function getTable(schema, table) {
  if (!Object.prototype.hasOwnProperty.call(schema, table)) throw new AppError('bad_request');
  return schema[table];
}

// prefix + '_' + 8 hex chars, regenerated until it is not in `taken` (a Set of ids).
export function generateId(def, platform, taken) {
  let id;
  do { id = `${def.prefix}_${platform.randomHex(4)}`; } while (taken.has(id));
  return id;
}

export function createMemoryStore(schema, platform, data = {}) {
  const rowsOf = (table) => {
    getTable(schema, table);
    if (!data[table]) data[table] = [];
    return data[table];
  };

  function prepare(table, row, taken) {
    const def = getTable(schema, table);
    const copy = { ...row };
    if (copy.id === undefined || copy.id === null || copy.id === '') {
      copy.id = generateId(def, platform, taken);
    } else if (taken.has(copy.id)) {
      throw new AppError('bad_request');
    }
    taken.add(copy.id);
    return copy;
  }

  const idsOf = (table) => new Set(rowsOf(table).map((r) => r.id));
  const indexOf = (table, id) => {
    const i = rowsOf(table).findIndex((r) => r.id === id);
    if (i < 0) throw new AppError('not_found');
    return i;
  };

  return {
    list: (table) => rowsOf(table).map((r) => ({ ...r })),
    get(table, id) {
      const row = rowsOf(table).find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    insert(table, row) {
      const rows = rowsOf(table);
      const copy = prepare(table, row, idsOf(table));
      rows.push(copy);
      return { ...copy };
    },
    insertMany(table, newRows) {
      const rows = rowsOf(table);
      const taken = idsOf(table);
      const copies = newRows.map((r) => prepare(table, r, taken));
      rows.push(...copies);
      return copies.map((r) => ({ ...r }));
    },
    update(table, id, patch) {
      const rows = rowsOf(table);
      const i = indexOf(table, id);
      rows[i] = { ...rows[i], ...patch, id };
      return { ...rows[i] };
    },
    remove(table, id) {
      rowsOf(table).splice(indexOf(table, id), 1);
    },
  };
}

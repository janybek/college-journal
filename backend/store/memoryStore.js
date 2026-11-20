import { AppError } from '../../core/errors.js';
import { shapeRow } from './rowShape.js';

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

  // Rows are kept in the shared shape; an old file with partial rows is shaped on the way out.
  function prepare(table, row, taken) {
    const def = getTable(schema, table);
    const copy = shapeRow(def, row);
    if (copy.id === '') {
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
  const shaped = (table, row) => shapeRow(getTable(schema, table), row);

  function updateMany(table, items) {
    const rows = rowsOf(table);
    const def = getTable(schema, table);
    const positions = items.map((item) => indexOf(table, item.id));
    return items.map((item, n) => {
      const i = positions[n];
      rows[i] = shapeRow(def, { ...rows[i], ...item.patch, id: item.id });
      return { ...rows[i] };
    });
  }

  return {
    list: (table) => rowsOf(table).map((r) => shaped(table, r)),
    get(table, id) {
      const row = rowsOf(table).find((r) => r.id === id);
      return row ? shaped(table, row) : null;
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
    update: (table, id, patch) => updateMany(table, [{ id, patch }])[0],
    updateMany,
    remove(table, id) {
      rowsOf(table).splice(indexOf(table, id), 1);
    },
    removeMany(table, ids) {
      const unique = [...new Set(ids)];
      unique.forEach((id) => indexOf(table, id));
      const gone = new Set(unique);
      data[table] = rowsOf(table).filter((r) => !gone.has(r.id));
    },
  };
}

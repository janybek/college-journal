import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../core/errors.js';
import { shapeRow } from './rowShape.js';
import { getTable, generateId } from './memoryStore.js';

// The fourth store: SQLite on the owner's computer. Node only (node:sqlite): this file is not bundled for Apps Script.
// Table names and column names come only from the schema and are always quoted; values go only as parameters.

const quote = (name) => `"${name}"`;
const SQL_TYPES = { string: "TEXT NOT NULL DEFAULT ''", int: 'INTEGER', bool: 'INTEGER NOT NULL DEFAULT 0' };
const columnSql = (c) => `${quote(c.key)} ${c.key === 'id' ? 'TEXT PRIMARY KEY' : SQL_TYPES[c.type]}`;

export function openDatabase(filePath, { readOnly = false } = {}) {
  const db = new DatabaseSync(filePath, { readOnly });
  if (!readOnly) db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000');
  return db;
}

// Adds what is missing (a table, a column), never removes or changes anything.
export function ensureTables(schema, db) {
  const created = [];
  const added = [];
  for (const [name, def] of Object.entries(schema)) {
    const have = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map((c) => c.name);
    if (have.length === 0) {
      db.exec(`CREATE TABLE ${quote(name)} (${def.columns.map(columnSql).join(', ')})`);
      created.push(name);
      continue;
    }
    for (const c of def.columns) {
      if (have.includes(c.key)) continue;
      db.exec(`ALTER TABLE ${quote(name)} ADD COLUMN ${columnSql(c)}`);
      added.push([name, c.key]);
    }
  }
  return { created, added };
}

export function createSqliteStore(schema, platform, db) {
  let depth = 0;

  // BEGIN IMMEDIATE ... COMMIT; an error rolls back and is thrown on. A nested call joins the outer transaction.
  function transaction(fn) {
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      depth = 0;
    }
  }

  // A batch is atomic on its own: a transaction outside one, a savepoint inside one.
  function atomic(fn) {
    if (depth === 0) return transaction(fn);
    db.exec('SAVEPOINT batch');
    try {
      const result = fn();
      db.exec('RELEASE batch');
      return result;
    } catch (error) {
      db.exec('ROLLBACK TO batch; RELEASE batch');
      throw error;
    }
  }

  const columnList = (def) => def.columns.map((c) => quote(c.key)).join(', ');
  const toParams = (def, row) => def.columns.map((c) => (c.type === 'bool' ? (row[c.key] ? 1 : 0) : row[c.key]));

  function get(table, id) {
    const def = getTable(schema, table);
    if (typeof id !== 'string') return null;
    const raw = db.prepare(`SELECT ${columnList(def)} FROM ${quote(table)} WHERE "id" = ?`).get(id);
    return raw ? shapeRow(def, raw) : null;
  }

  function list(table) {
    const def = getTable(schema, table);
    return db.prepare(`SELECT ${columnList(def)} FROM ${quote(table)} ORDER BY rowid`).all().map((r) => shapeRow(def, r));
  }

  function insertMany(table, rows) {
    const def = getTable(schema, table);
    return atomic(() => {
      const taken = new Set(db.prepare(`SELECT "id" FROM ${quote(table)}`).all().map((r) => r.id));
      const insert = db.prepare(`INSERT INTO ${quote(table)} (${columnList(def)}) VALUES (${def.columns.map(() => '?').join(', ')})`);
      return rows.map((row) => {
        const copy = shapeRow(def, row);
        if (copy.id === '') copy.id = generateId(def, platform, taken);
        else if (taken.has(copy.id)) throw new AppError('bad_request');
        taken.add(copy.id);
        insert.run(...toParams(def, copy));
        return copy;
      });
    });
  }

  function updateMany(table, items) {
    const def = getTable(schema, table);
    const update = `UPDATE ${quote(table)} SET ${def.columns.map((c) => `${quote(c.key)} = ?`).join(', ')} WHERE "id" = ?`;
    return atomic(() => items.map((item) => {
      const old = get(table, item.id);
      if (!old) throw new AppError('not_found');
      const next = shapeRow(def, { ...old, ...item.patch, id: item.id });
      db.prepare(update).run(...toParams(def, next), item.id);
      return next;
    }));
  }

  function removeMany(table, ids) {
    getTable(schema, table);
    atomic(() => {
      for (const id of new Set(ids)) {
        if (!get(table, id)) throw new AppError('not_found');
        db.prepare(`DELETE FROM ${quote(table)} WHERE "id" = ?`).run(id);
      }
    });
  }

  return {
    list,
    get,
    insert: (table, row) => insertMany(table, [row])[0],
    insertMany,
    update: (table, id, patch) => updateMany(table, [{ id, patch }])[0],
    updateMany,
    remove: (table, id) => removeMany(table, [id]),
    removeMany,
    transaction,
  };
}

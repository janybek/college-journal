import { AppError } from '../../core/errors.js';
import { getTable, generateId } from './memoryStore.js';
import { shapeValue, shapeRow } from './rowShape.js';
import { localDate } from '../../core/dates.js';

// Store on top of a Google Spreadsheet (or a fake with the same methods).
// Row 1 holds headers; columns are found by title, foreign columns are never touched.
// No Node-only APIs: this file is bundled for Apps Script.

const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

// A date cell in a string column (hand-edited, or turned into a date by Sheets) reads as its Bishkek date.
function readValue(type, v) {
  if (type === 'string' && isDate(v)) return localDate(v.getTime());
  return shapeValue(type, v);
}

function writeValue(type, v) {
  const shaped = shapeValue(type, v);
  return shaped === null ? '' : shaped;
}

export function createSheetsStore(schema, platform, spreadsheet, withLock = (fn) => fn()) {
  // Reads the sheet once: header positions plus every non-empty-id row with its sheet row number.
  function load(table) {
    const def = getTable(schema, table);
    const sheet = spreadsheet.getSheetByName(def.sheet);
    if (!sheet) throw new AppError('internal');
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const cols = {};
    const entries = [];
    let values = [];
    if (lastRow >= 1 && lastCol >= 1) {
      values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      values[0].forEach((h, i) => { cols[String(h).trim()] = i; });
      const at = (c) => cols[c.title];
      const idColumn = def.columns.find((c) => c.key === 'id');
      const idIndex = at(idColumn);
      for (let r = 1; r < values.length; r++) {
        if (idIndex === undefined || readValue('string', values[r][idIndex]) === '') continue;
        const row = {};
        for (const c of def.columns) {
          const i = at(c);
          row[c.key] = readValue(c.type, i === undefined ? '' : values[r][i]);
        }
        entries.push({ row, sheetRow: r + 1 });
      }
    }
    return { def, sheet, cols, values, lastRow, lastCol, entries };
  }

  const toCells = (def, cols, width, row) => {
    const cells = new Array(width).fill('');
    for (const c of def.columns) {
      if (cols[c.title] !== undefined) cells[cols[c.title]] = writeValue(c.type, row[c.key]);
    }
    return cells;
  };

  function insertRows(table, rows, useAppend) {
    return withLock(() => {
      const { def, sheet, cols, lastRow, lastCol, entries } = load(table);
      const taken = new Set(entries.map((e) => e.row.id));
      const created = rows.map((r) => {
        const copy = shapeRow(def, r);
        if (copy.id === '') {
          copy.id = generateId(def, platform, taken);
        } else if (taken.has(copy.id)) {
          throw new AppError('bad_request');
        }
        taken.add(copy.id);
        return copy;
      });
      if (created.length > 0) {
        const width = Math.max(lastCol, 1);
        const block = created.map((r) => toCells(def, cols, width, r));
        if (useAppend) {
          sheet.appendRow(block[0]);
        } else {
          // setValues does not grow the grid (appendRow does), so add the missing rows first.
          const missing = lastRow + block.length - sheet.getMaxRows();
          if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
          sheet.getRange(lastRow + 1, 1, block.length, width).setValues(block);
        }
      }
      return created.map((r) => readBack(def, r));
    });
  }

  // Normalise a row the way a later read would return it.
  const readBack = (def, row) => {
    const out = {};
    for (const c of def.columns) out[c.key] = readValue(c.type, writeValue(c.type, row[c.key]));
    return out;
  };

  const find = (loaded, id) => loaded.entries.find((e) => e.row.id === id);

  // One read, then one setValues per changed schema column (first to last changed row of that column).
  function updateRows(table, items) {
    return withLock(() => {
      const loaded = load(table);
      const { def, sheet, cols, values } = loaded;
      const hits = items.map((item) => {
        const hit = find(loaded, item.id);
        if (!hit) throw new AppError('not_found');
        return hit;
      });
      const current = new Map(hits.map((h) => [h.sheetRow, { ...h.row }]));
      const changed = new Map(); // column title -> Map(sheetRow -> new cell value)
      const results = items.map((item, n) => {
        const row = current.get(hits[n].sheetRow);
        for (const c of def.columns) {
          if (c.key === 'id' || cols[c.title] === undefined
            || !Object.prototype.hasOwnProperty.call(item.patch, c.key)) continue;
          const cell = writeValue(c.type, item.patch[c.key]);
          row[c.key] = readValue(c.type, cell);
          if (!changed.has(c.title)) changed.set(c.title, new Map());
          changed.get(c.title).set(hits[n].sheetRow, cell);
        }
        return { ...row };
      });
      for (const [title, cells] of changed) {
        const rowsChanged = [...cells.keys()];
        const first = Math.min(...rowsChanged);
        const last = Math.max(...rowsChanged);
        const col = cols[title];
        const block = [];
        for (let r = first; r <= last; r++) block.push([cells.has(r) ? cells.get(r) : values[r - 1][col]]);
        sheet.getRange(first, col + 1, block.length, 1).setValues(block);
      }
      return results;
    });
  }

  function removeRows(table, ids) {
    withLock(() => {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return;
      const loaded = load(table);
      const positions = unique.map((id) => {
        const hit = find(loaded, id);
        if (!hit) throw new AppError('not_found');
        return hit.sheetRow;
      }).sort((a, b) => b - a);
      // Bottom to top, one deleteRows per run of neighbouring rows.
      let i = 0;
      while (i < positions.length) {
        let j = i;
        while (j + 1 < positions.length && positions[j + 1] === positions[j] - 1) j++;
        loaded.sheet.deleteRows(positions[j], j - i + 1);
        i = j + 1;
      }
    });
  }

  return {
    list: (table) => load(table).entries.map((e) => e.row),
    get(table, id) {
      const hit = find(load(table), id);
      return hit ? hit.row : null;
    },
    insert: (table, row) => insertRows(table, [row], true)[0],
    insertMany: (table, rows) => insertRows(table, rows, false),
    update: (table, id, patch) => updateRows(table, [{ id, patch }])[0],
    updateMany: (table, items) => updateRows(table, items),
    remove: (table, id) => removeRows(table, [id]),
    removeMany: (table, ids) => removeRows(table, ids),
  };
}

// Plain-text format on string columns, so Sheets does not turn '01-1' or '0012' into dates or numbers.
function markTextColumns(def, sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map((h) => String(h).trim());
  for (const c of def.columns) {
    const i = headers.indexOf(c.title);
    if (c.type === 'string' && i >= 0) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
  }
}

// Creates missing sheets and appends missing header columns. Safe to run repeatedly.
export function ensureSheets(schema, spreadsheet) {
  const created = [];
  const addedColumns = [];
  for (const table of Object.keys(schema)) {
    const def = schema[table];
    let sheet = spreadsheet.getSheetByName(def.sheet);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(def.sheet);
      sheet.appendRow(def.columns.map((c) => c.title));
      created.push(def.sheet);
      markTextColumns(def, sheet);
      continue;
    }
    const width = sheet.getLastColumn();
    const headers = sheet.getLastRow() >= 1 && width >= 1
      ? sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim())
      : [];
    const missing = def.columns.filter((c) => !headers.includes(c.title));
    if (missing.length > 0) {
      const lack = headers.length + missing.length - sheet.getMaxColumns();
      if (lack > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), lack);
      sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing.map((c) => c.title)]);
      for (const c of missing) addedColumns.push(`${def.sheet}.${c.title}`);
    }
    markTextColumns(def, sheet);
  }
  return { created, addedColumns };
}

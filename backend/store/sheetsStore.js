import { AppError } from '../../core/errors.js';
import { getTable, generateId } from './memoryStore.js';

// Store on top of a Google Spreadsheet (or a fake with the same methods).
// Row 1 holds headers; columns are found by title, foreign columns are never touched.
// No Node-only APIs: this file is bundled for Apps Script.

const TRUE_STRINGS = ['true', 'да'];

const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';

function readValue(type, v) {
  if (type === 'bool') {
    if (v === true || v === 1) return true;
    return typeof v === 'string' && TRUE_STRINGS.includes(v.trim().toLowerCase());
  }
  if (type === 'int') {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    const text = String(v).trim();
    return /^-?\d+$/.test(text) ? parseInt(text, 10) : null;
  }
  // Safety net for hand-edited cells that Sheets turned into dates.
  if (isDate(v)) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function writeValue(type, v) {
  if (v === null || v === undefined) return '';
  if (type === 'bool') return v === true;
  return v;
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
    if (lastRow >= 1 && lastCol >= 1) {
      const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      values[0].forEach((h, i) => { cols[String(h).trim()] = i; });
      const at = (c) => cols[c.title];
      for (let r = 1; r < values.length; r++) {
        const idIndex = at(def.columns[0]);
        if (idIndex === undefined || String(values[r][idIndex]).trim() === '') continue;
        const row = {};
        for (const c of def.columns) {
          const i = at(c);
          row[c.key] = readValue(c.type, i === undefined ? '' : values[r][i]);
        }
        entries.push({ row, sheetRow: r + 1 });
      }
    }
    return { def, sheet, cols, lastRow, lastCol, entries };
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
        const copy = { ...r };
        if (copy.id === undefined || copy.id === null || copy.id === '') {
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

  return {
    list: (table) => load(table).entries.map((e) => e.row),
    get(table, id) {
      const hit = find(load(table), id);
      return hit ? hit.row : null;
    },
    insert: (table, row) => insertRows(table, [row], true)[0],
    insertMany: (table, rows) => insertRows(table, rows, false),
    update(table, id, patch) {
      return withLock(() => {
        const loaded = load(table);
        const hit = find(loaded, id);
        if (!hit) throw new AppError('not_found');
        for (const c of loaded.def.columns) {
          const col = loaded.cols[c.title];
          if (c.key === 'id' || col === undefined || !Object.prototype.hasOwnProperty.call(patch, c.key)) continue;
          loaded.sheet.getRange(hit.sheetRow, col + 1, 1, 1).setValues([[writeValue(c.type, patch[c.key])]]);
        }
        return readBack(loaded.def, { ...hit.row, ...patch, id });
      });
    },
    remove(table, id) {
      withLock(() => {
        const loaded = load(table);
        const hit = find(loaded, id);
        if (!hit) throw new AppError('not_found');
        loaded.sheet.deleteRow(hit.sheetRow);
      });
    },
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

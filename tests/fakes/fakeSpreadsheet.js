// Fake of the Apps Script Spreadsheet API: enough behaviour to catch mistakes in sheetsStore.
const isBlank = (v) => v === '' || v === null || v === undefined;

const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// A fake sheet with a finite grid (like real Sheets) and per-column text format.
// Writing a numeric-looking or ISO-date string into a column that is not text-formatted
// stores a number or a Date, as Google Sheets does.
function createFakeSheet(name, rows, grid = {}) {
  const data = rows.map((r) => r.slice());
  let maxRows = grid.maxRows ?? Math.max(data.length, 1);
  let maxColumns = grid.maxColumns ?? Math.max(1, ...data.map((r) => r.length));
  const textColumns = new Set();

  const convert = (colIndex, v) => {
    if (typeof v !== 'string' || textColumns.has(colIndex)) return v;
    if (NUMERIC.test(v)) return Number(v);
    if (ISO_DATE.test(v)) return new Date(`${v}T00:00:00Z`);
    return v;
  };

  const lastRow = () => {
    for (let i = data.length - 1; i >= 0; i--) if (data[i].some((v) => !isBlank(v))) return i + 1;
    return 0;
  };
  const lastColumn = () => {
    let max = 0;
    for (const r of data) {
      for (let c = r.length - 1; c >= 0; c--) {
        if (!isBlank(r[c])) { max = Math.max(max, c + 1); break; }
      }
    }
    return max;
  };
  const checkRange = (row, col, nr, nc) => {
    if (![row, col, nr, nc].every(Number.isInteger) || row < 1 || col < 1 || nr < 1 || nc < 1) {
      throw new Error(`Invalid range: ${row},${col},${nr},${nc}`);
    }
    if (row + nr - 1 > maxRows || col + nc - 1 > maxColumns) {
      throw new Error(`The coordinates of the range are outside the dimensions of the sheet: ${row},${col},${nr},${nc}`);
    }
  };

  return {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: lastColumn,
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxColumns,
    insertRowsAfter(after, n) {
      if (!Number.isInteger(after) || !Number.isInteger(n) || after < 0 || after > maxRows || n < 1) {
        throw new Error(`Invalid insertRowsAfter: ${after},${n}`);
      }
      maxRows += n;
    },
    insertColumnsAfter(after, n) {
      if (!Number.isInteger(after) || !Number.isInteger(n) || after < 0 || after > maxColumns || n < 1) {
        throw new Error(`Invalid insertColumnsAfter: ${after},${n}`);
      }
      maxColumns += n;
    },
    getRange(row, col, nr = 1, nc = 1) {
      checkRange(row, col, nr, nc);
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < nr; r++) {
            const line = [];
            for (let c = 0; c < nc; c++) {
              const v = (data[row - 1 + r] || [])[col - 1 + c];
              line.push(v === undefined || v === null ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setNumberFormat(format) {
          for (let c = 0; c < nc; c++) {
            if (format === '@') textColumns.add(col - 1 + c); else textColumns.delete(col - 1 + c);
          }
        },
        getNumberFormat: () => (textColumns.has(col - 1) ? '@' : 'General'),
        setValues(values) {
          const ok = Array.isArray(values) && values.length === nr
            && values.every((l) => Array.isArray(l) && l.length === nc);
          if (!ok) throw new Error(`The data dimensions do not match the range dimensions (${nr}x${nc})`);
          for (let r = 0; r < nr; r++) {
            while (data.length < row + r) data.push([]);
            const line = data[row - 1 + r];
            while (line.length < col - 1 + nc) line.push('');
            for (let c = 0; c < nc; c++) line[col - 1 + c] = convert(col - 1 + c, values[r][c]);
          }
        },
      };
    },
    appendRow(arr) {
      const at = lastRow();
      data.splice(at, data.length - at);
      data.push(arr.map((v, c) => convert(c, v)));
      maxRows = Math.max(maxRows, data.length);
      maxColumns = Math.max(maxColumns, arr.length);
    },
    deleteRow(n) {
      if (!Number.isInteger(n) || n < 1 || n > data.length) throw new Error(`Invalid row: ${n}`);
      data.splice(n - 1, 1);
    },
    dump: () => data.map((r) => r.slice()),
  };
}

// grids: optional { [sheetName]: { maxRows, maxColumns } } for sheets passed in `sheets`
// (default: the grid is sized to fit the given rows). Inserted sheets get 1000 x 26.
export function createFakeSpreadsheet(sheets = {}, grids = {}) {
  const map = new Map(Object.entries(sheets).map(([n, rows]) => [n, createFakeSheet(n, rows, grids[n])]));
  return {
    getSheetByName: (name) => map.get(name) || null,
    insertSheet(name) {
      if (map.has(name)) throw new Error(`Sheet already exists: ${name}`);
      const sheet = createFakeSheet(name, [], { maxRows: 1000, maxColumns: 26 });
      map.set(name, sheet);
      return sheet;
    },
    dump(name) {
      const sheet = map.get(name);
      if (!sheet) throw new Error(`No sheet: ${name}`);
      return sheet.dump();
    },
  };
}

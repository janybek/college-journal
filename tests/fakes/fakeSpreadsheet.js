// Fake of the Apps Script Spreadsheet API: enough behaviour to catch mistakes in sheetsStore.
const isBlank = (v) => v === '' || v === null || v === undefined;

function createFakeSheet(name, rows) {
  const data = rows.map((r) => r.slice());

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
  };

  return {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: lastColumn,
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
        setValues(values) {
          const ok = Array.isArray(values) && values.length === nr
            && values.every((l) => Array.isArray(l) && l.length === nc);
          if (!ok) throw new Error(`The data dimensions do not match the range dimensions (${nr}x${nc})`);
          for (let r = 0; r < nr; r++) {
            while (data.length < row + r) data.push([]);
            const line = data[row - 1 + r];
            while (line.length < col - 1 + nc) line.push('');
            for (let c = 0; c < nc; c++) line[col - 1 + c] = values[r][c];
          }
        },
      };
    },
    appendRow(arr) {
      const at = lastRow();
      data.splice(at, data.length - at);
      data.push(arr.slice());
    },
    deleteRow(n) {
      if (!Number.isInteger(n) || n < 1 || n > data.length) throw new Error(`Invalid row: ${n}`);
      data.splice(n - 1, 1);
    },
    dump: () => data.map((r) => r.slice()),
  };
}

export function createFakeSpreadsheet(sheets = {}) {
  const map = new Map(Object.entries(sheets).map(([n, rows]) => [n, createFakeSheet(n, rows)]));
  return {
    getSheetByName: (name) => map.get(name) || null,
    insertSheet(name) {
      if (map.has(name)) throw new Error(`Sheet already exists: ${name}`);
      const sheet = createFakeSheet(name, []);
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

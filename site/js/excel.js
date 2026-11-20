// Pure helpers around SheetJS for the import screen. SheetJS itself is passed in (`XLSX`): the screen loads it
// on demand in the browser, tests take it from node_modules.

// Empty rows of a template whose text columns are formatted as Text.
export const TEMPLATE_ROWS = 500;

// Options for reading an Excel file: a cell Excel stores as a date arrives as a date (type 'd'), not as a number.
export const READ_OPTIONS = { cellDates: true };

// Template sheet: the titles in row 1, then TEMPLATE_ROWS rows in which the cells of text columns are empty and
// formatted as Text. Excel then keeps "01-1" and "0012" as typed instead of turning them into a date and 12.
// textColumns[i] tells whether column i holds text.
export function templateSheet(XLSX, titles, textColumns) {
  const sheet = XLSX.utils.aoa_to_sheet([titles]);
  for (let r = 1; r <= TEMPLATE_ROWS; r++) {
    titles.forEach((title, c) => {
      if (textColumns[c]) sheet[XLSX.utils.encode_cell({ r, c })] = { t: 's', v: '', z: '@' };
    });
  }
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEMPLATE_ROWS, c: titles.length - 1 } });
  return sheet;
}

// The first cell Excel stored as a date, row by row: { row, column } with the row number as Excel shows it and
// the title of the column from the first used row (its letter when the title is empty). null when there is none.
export function findDateCell(XLSX, sheet) {
  if (!sheet['!ref']) return null;
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'd') return { row: r + 1, column: columnTitle(XLSX, sheet, range.s.r, c) };
    }
  }
  return null;
}

function columnTitle(XLSX, sheet, headerRow, c) {
  const title = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
  const text = title && title.t === 's' ? String(title.v).trim() : '';
  return text !== '' ? text : XLSX.utils.encode_col(c);
}

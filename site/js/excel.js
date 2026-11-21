// Pure helpers around SheetJS for the import screen and the syllabus file. SheetJS itself is passed in (`XLSX`):
// the screen loads it on demand in the browser (xlsxLoader.js), tests take it from node_modules.

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

// ---- A whole book: every sheet with data (the syllabus file has two) ----

export const MAX_BOOK_SHEETS = 10;

const isBlankRow = (row) => !Array.isArray(row) || row.every((cell) => String(cell).trim() === '');

// The sheets of the book that hold data, in the order of the book: [{ name, cells, firstRow }]. cells: the rows as
// the import reads them, from the first row with data to the last one; firstRow: the empty rows above the data
// (the used range of a sheet may start above it), to add to a row number of the server so that it is the row Excel
// shows. dateCell: { sheet, row, column } of the first cell Excel stored as a date, on the first sheet that has one
// (such a file is not sent); its column is named by the first row of data. tooMany: the book has more than
// MAX_BOOK_SHEETS sheets with data; only the first MAX_BOOK_SHEETS are returned.
export function bookSheets(XLSX, book) {
  const sheets = [];
  let dateCell = null;
  let tooMany = false;
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet || !sheet['!ref']) continue;
    const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    while (cells.length > 0 && isBlankRow(cells[cells.length - 1])) cells.pop();
    if (cells.length === 0) continue;
    if (sheets.length === MAX_BOOK_SHEETS) {
      tooMany = true;
      break;
    }
    let lead = 0;
    while (isBlankRow(cells[lead])) lead += 1;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const firstRow = range.s.r + lead;
    if (dateCell === null) {
      const date = findDateCell(XLSX, { ...sheet, '!ref': XLSX.utils.encode_range({ s: { r: firstRow, c: range.s.c }, e: range.e }) });
      if (date) dateCell = { sheet: name, ...date };
    }
    sheets.push({ name, cells: cells.slice(lead), firstRow });
  }
  return { sheets, dateCell, tooMany };
}

// ---- The syllabus file: «Сведения» and «Тематический план» ----

const INFO_KEYS = ['discipline', 'teacher', 'course', 'semester', 'audience', 'credits', 'totalHours', 'classHours', 'selfHours'];
const INFO_TEXT = ['discipline', 'teacher', 'audience'];
// Without «Семестр»: the file holds one semester, and it is written in «Сведения».
const PLAN_KEYS = ['unit', 'label', 'name', 'lectureHours', 'practiceHours', 'practiceKind', 'selfHours', 'description'];
const PLAN_TEXT = ['label', 'name', 'practiceKind', 'description'];
const PLAN_WIDTHS = { unit: 7, label: 8, name: 46, lectureHours: 12, practiceHours: 12, practiceKind: 14, selfHours: 8, description: 60 };

const absent = (value) => value === null || value === undefined || value === '';
// A cell formatted as Text: Excel keeps «1.10» and «01-1» as typed in it.
const textCell = (value) => ({ t: 's', v: absent(value) ? '' : String(value), z: '@' });
const valueCell = (value) => (typeof value === 'number' ? { t: 'n', v: value } : { t: 's', v: String(value) });

// The value of one cell of a plan row; null leaves the cell empty. Hours of zero are an empty cell (the parser reads
// both alike); a zero of СРС stays a zero, because the page tells «0» from «not given».
function planValue(row, key, kinds) {
  if (key === 'practiceKind') return row.kind === 'control' ? kinds.control : kinds[row.practiceKind] ?? '';
  if (key === 'lectureHours' || key === 'practiceHours') return Number(row[key]) > 0 ? Number(row[key]) : null;
  if (PLAN_TEXT.includes(key)) return absent(row[key]) ? '' : String(row[key]);
  return absent(row[key]) ? null : row[key];
}

// The book of a syllabus in the order «Сведения», «Тематический план». labels: the titles of the sheets, of the
// lines of «Сведения», of the columns of the plan and the words of the kinds, in the language of the screen
// (fileLabels in syllabus.js). data: null — an empty template; otherwise { info, rows } (fileData in syllabus.js).
// The text cells of both sheets are formatted as Text, those of the plan for TEMPLATE_ROWS rows.
export function syllabusBook(XLSX, labels, data = null) {
  const info = data && data.info ? data.info : {};
  const rows = data && Array.isArray(data.rows) ? data.rows : [];

  const infoSheet = {};
  INFO_KEYS.forEach((key, r) => {
    infoSheet[XLSX.utils.encode_cell({ r, c: 0 })] = { t: 's', v: labels.info[key] };
    const ref = XLSX.utils.encode_cell({ r, c: 1 });
    if (INFO_TEXT.includes(key)) infoSheet[ref] = textCell(info[key]);
    else if (!absent(info[key])) infoSheet[ref] = valueCell(info[key]);
  });
  infoSheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: INFO_KEYS.length - 1, c: 1 } });
  infoSheet['!cols'] = [{ wch: Math.max(...INFO_KEYS.map((key) => labels.info[key].length)) + 2 }, { wch: 44 }];

  const titles = PLAN_KEYS.map((key) => labels.plan[key]);
  const plan = templateSheet(XLSX, titles, PLAN_KEYS.map((key) => PLAN_TEXT.includes(key)));
  rows.forEach((row, i) => {
    PLAN_KEYS.forEach((key, c) => {
      const ref = XLSX.utils.encode_cell({ r: i + 1, c });
      const value = planValue(row, key, labels.kinds);
      if (PLAN_TEXT.includes(key)) plan[ref] = textCell(value);
      else if (value === null) delete plan[ref];
      else plan[ref] = valueCell(value);
    });
  });
  plan['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(TEMPLATE_ROWS, rows.length), c: titles.length - 1 } });
  plan['!cols'] = PLAN_KEYS.map((key, c) => ({ wch: Math.max(PLAN_WIDTHS[key], titles[c].length + 2) }));

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, infoSheet, labels.sheets.info);
  XLSX.utils.book_append_sheet(book, plan, labels.sheets.plan);
  return book;
}

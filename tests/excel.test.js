import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { TEMPLATE_ROWS, templateSheet, findDateCell, READ_OPTIONS } from '../site/js/excel.js';

// Writes a sheet to .xlsx bytes and reads it back the way the import screen does.
function roundTrip(sheet, bookType = 'xlsx') {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Лист');
  const bytes = new Uint8Array(XLSX.write(book, { type: 'array', bookType }));
  const back = XLSX.read(bytes, { type: 'array', ...READ_OPTIONS });
  return back.Sheets[back.SheetNames[0]];
}

test('template: text columns are Text-formatted for many rows, other columns stay General', () => {
  const sheet = templateSheet(XLSX, ['Название', 'Курс'], [true, false]);
  assert.equal(sheet['!ref'], 'A1:B' + (TEMPLATE_ROWS + 1));
  assert.ok(TEMPLATE_ROWS >= 300);
  assert.deepEqual(sheet.A2, { t: 's', v: '', z: '@' });
  assert.deepEqual(sheet['A' + (TEMPLATE_ROWS + 1)], { t: 's', v: '', z: '@' });
  assert.equal(sheet.B2, undefined);
  assert.equal(sheet.A1.v, 'Название');
  const back = XLSX.read(new Uint8Array(XLSX.write({ SheetNames: ['g'], Sheets: { g: sheet } }, { type: 'array', bookType: 'xlsx' })),
    { type: 'array', cellNF: true });
  assert.equal(back.Sheets.g.A300.z, '@');
});

test('template read back: the empty formatted cells add only blank rows, which the reader drops', () => {
  const sheet = roundTrip(templateSheet(XLSX, ['ФИО', '№ студ. билета'], [true, true]));
  const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  assert.deepEqual(cells[0], ['ФИО', '№ студ. билета']);
  assert.ok(cells.slice(1).every((row) => row.every((cell) => cell === '')));
  assert.equal(findDateCell(XLSX, sheet), null);
});

test('findDateCell: the first date cell with its Excel row number and the title of its column', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Название', 'Курс'], ['02-1', 2], ['x', 1]]);
  sheet.A3 = { t: 'n', v: 46023, z: 'd-mmm' };
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 3, column: 'Название' });
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet, 'biff8')), { row: 3, column: 'Название' });
});

test('findDateCell: a column without a title is named by its letter; a sheet with no dates gives null', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['', 'Курс'], [46023, 1]]);
  sheet.A2.z = 'dd.mm.yyyy';
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 2, column: 'A' });
  const plain = roundTrip(XLSX.utils.aoa_to_sheet([['Название', 'Курс'], ['01-1', 1], [12, 2]]));
  assert.equal(findDateCell(XLSX, plain), null);
  assert.equal(findDateCell(XLSX, {}), null);
});

test('findDateCell: rows are counted from the top of the sheet even when the data starts lower', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Название', 'Курс'], [46023, 1]], { origin: 'B3' });
  sheet.B4.z = 'd-mmm';
  sheet['!ref'] = 'B3:C4'; // as in a file whose used range starts at B3
  assert.deepEqual(findDateCell(XLSX, roundTrip(sheet)), { row: 4, column: 'Название' });
});

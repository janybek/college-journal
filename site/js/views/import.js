import { call } from '../api.js';
import { t, tCount } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, hasText, dataTable, holdOnLeave, markBusy, modal, showModal, focusById, refresh,
  note, pageHeader,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { IMPORT_TABLES, IMPORT_COLUMNS, FIELDS } from './directoryConfig.js';
import { templateSheet, findDateCell, READ_OPTIONS } from '../excel.js';
import { loadXlsx } from '../xlsxLoader.js';

// Excel import (#/import): five numbered steps on one page — directory, template, file, check, import.
// SheetJS is loaded only when this screen needs it. Drawn from `state`; the one-time passwords of an import live
// only there, and while they are shown the screen asks before it is left. (The syllabus of a subject is uploaded
// on its own page: views/syllabusUpload.js.)

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 200;

const blank = (table = null) => ({
  table,                 // the directory the file goes into
  warmed: false,         // SheetJS was requested on this visit
  ticket: 0,             // bumps with every file read and check; answers to older requests are dropped
  file: null,            // { name, size }
  cells: null,           // the first sheet as rows of cells, sent to the server as they are
  firstRow: 0,           // empty rows above the sheet's used range, added to the server's row numbers
  reading: false,
  fileErrorKey: null,
  fileErrorParams: null,  // { row, column } of a cell Excel turned into a date
  templateErrorKey: null,
  checking: false,
  checkErrorKey: null,
  preview: null,
  applying: false,
  applyErrorKey: null,
  applyLost: false,      // the connection dropped during the import: some rows may be in already
  result: null,
  passwordsErrorKey: null,
  ask: null,             // open question before passwords leave the screen: { kind: 'leave' | 'again', resolve, promise }
});
let state = blank();

const warnBeforeUnload = (event) => {
  event.preventDefault();
  event.returnValue = '';
};

function holdPasswords() {
  holdOnLeave(() => ask('leave'));
  window.addEventListener('beforeunload', warnBeforeUnload);
}

function releasePasswords() {
  holdOnLeave(null);
  window.removeEventListener('beforeunload', warnBeforeUnload);
}

function reset() {
  releasePasswords();
  if (state.ask) state.ask.resolve(false);
  state = blank();
}

export function leave() {
  reset();
}

function warm() {
  if (state.warmed) return;
  state.warmed = true;
  loadXlsx().catch(() => { /* reported when a step needs it */ });
}

export function render(root) {
  const tables = IMPORT_TABLES.filter((table) => permissions().includes('import.apply:' + table));
  if (state.table !== null && !tables.includes(state.table)) state = blank();
  if (state.table === null && tables.length === 1) state.table = tables[0];
  warm();
  const passwords = passwordsSection();
  root.append(
    pageHeader({ id: 'import-title', title: t('import.title'), lead: t('import.lead') }),
    el('ol', { class: 'card steps' }, stepTable(tables), stepTemplate(), stepFile(), stepCheck(), stepApply()));
  if (passwords) {
    root.append(passwords);
    // Printing this screen prints only the passwords (see the print rules in app.css).
    root.classList.add('has-printable');
  }
  if (state.ask) showModal(root, questionDialog(state.ask));
}

// Steps

// A numbered step; a step that waits for the previous ones shows only its title.
function step(number, titleKey, open, ...body) {
  const id = 'import-step-' + number;
  return el('li', { class: 'step' + (open ? '' : ' step--waiting'), 'aria-labelledby': id },
    el('span', { class: 'step__number', 'aria-hidden': 'true' }, String(number)),
    el('div', { class: 'step__body' },
      el('h2', { class: 'step__title', id }, t(titleKey)),
      open ? body : null));
}

// After an import (or while it runs) the directory and file are fixed; "Upload another file" starts over.
const settled = () => state.applying || state.result !== null;

function stepTable(tables) {
  return step(1, 'import.step.table', true,
    el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'import-step-1' }, tables.map((table) => el('button', {
      type: 'button', id: 'import-table-' + table, class: 'segmented__button', 'aria-pressed': String(table === state.table),
      disabled: settled(), onclick: () => chooseTable(table),
    }, t('dir.' + table)))),
    el('p', { class: 'step__hint' }, t('import.order')));
}

function stepTemplate() {
  const { table } = state;
  if (table === null) return step(2, 'import.step.template', false);
  const hinted = IMPORT_COLUMNS[table].filter(({ key }) => hasText(`import.colHint.${table}.${key}`));
  return step(2, 'import.step.template', true,
    el('p', {}, t('import.template.text')),
    headerPreview(table),
    hinted.length > 0 ? el('dl', { class: 'col-hints' }, hinted.map(({ key }) => el('div', { class: 'col-hints__row' },
      el('dt', { class: 'col-hints__name' }, columnTitle(key)),
      el('dd', {}, t(`import.colHint.${table}.${key}`))))) : null,
    el('p', { class: 'step__hint' }, t('import.matchBy.' + table)),
    el('button', { type: 'button', id: 'import-template', class: 'button button--secondary', onclick: downloadTemplate },
      icon('download'), t('import.template.download')),
    state.templateErrorKey ? note('error', t(state.templateErrorKey), { role: 'alert' }) : null);
}

// Row 1 of the file as it looks in Excel: column letters, the titles, and which ones must be filled.
function headerPreview(table) {
  const columns = IMPORT_COLUMNS[table];
  return el('div', { class: 'xl' },
    el('table', { class: 'xl__table' },
      el('caption', { class: 'visually-hidden' }, t('import.template.caption')),
      el('thead', { 'aria-hidden': 'true' }, el('tr', {},
        el('th', { class: 'xl__corner' }),
        columns.map((column, i) => el('th', { class: 'xl__letter' }, String.fromCharCode(65 + i))))),
      el('tbody', {},
        el('tr', {},
          el('th', { class: 'xl__index', 'aria-hidden': 'true' }, '1'),
          columns.map(({ key }) => el('td', { class: 'xl__cell' }, columnTitle(key)))),
        el('tr', { class: 'xl__marks' },
          el('th', { class: 'xl__index xl__index--blank', 'aria-hidden': 'true' }),
          columns.map(({ required }) => el('td', { class: required ? 'xl__mark xl__mark--required' : 'xl__mark' },
            t(required ? 'import.required' : 'import.optional')))))));
}

function stepFile() {
  if (state.table === null) return step(3, 'import.step.file', false);
  const input = el('input', {
    type: 'file', id: 'import-file', class: 'file__input', accept: '.xlsx,.xls,.csv', disabled: settled(),
    onchange: () => { if (input.files[0]) readFile(input.files[0]); },
  });
  return step(3, 'import.step.file', true,
    el('div', { class: 'file' },
      input,
      el('label', { for: 'import-file', class: 'button button--secondary file__button' },
        icon('upload'), t(state.file ? 'import.file.another' : 'import.file.choose')),
      state.file ? el('p', { class: 'file__name' },
        icon('sheet', 'file__icon'),
        el('span', { class: 'file__title' }, state.file.name),
        el('span', { class: 'muted' }, t('import.file.size', { size: Math.max(1, Math.ceil(state.file.size / 1024)) }))) : null),
    el('p', { class: 'step__hint' }, t('import.file.hint')),
    state.reading ? el('p', { class: 'loading', role: 'status' }, t('import.file.reading')) : null,
    state.fileErrorKey ? note('error', t(state.fileErrorKey, state.fileErrorParams), { role: 'alert' }) : null);
}

function stepCheck() {
  if (state.cells === null) return step(4, 'import.step.check', false);
  const preview = state.preview;
  return step(4, 'import.step.check', true,
    state.checking ? el('p', { class: 'loading', role: 'status' }, t('import.check.busy')) : null,
    state.checkErrorKey ? [
      note('error', t(state.checkErrorKey), { role: 'alert' }),
      el('button', { type: 'button', class: 'button button--secondary', onclick: check }, t('import.check.again')),
    ] : null,
    preview ? previewBody(preview) : null);
}

// The file cannot be imported at all: required columns are missing or it has too many rows.
const blocked = (report) => report.missingColumns.length > 0 || report.errors.some((error) => error.row === 0);

function previewBody(preview) {
  const tooMany = preview.errors.some((error) => error.row === 0);
  const usable = !blocked(preview);
  return [
    preview.missingColumns.length > 0
      ? note('error', t('import.missing', { columns: preview.missingColumns.map(columnTitle).join(', ') }), { role: 'alert' })
      : null,
    tooMany ? note('error', t('import.error.tooManyRows'), { role: 'alert' }) : null,
    preview.unknownColumns.length > 0
      ? note('warning', t('import.unknown', { columns: preview.unknownColumns.join(', ') }))
      : null,
    usable ? tally([
      [preview.newCount, 'import.tally.new'],
      [preview.updateCount, 'import.tally.update'],
      [preview.total - preview.valid, 'import.tally.errors', true],
    ]) : null,
    usable && preview.total === 0 ? note('info', t('import.check.nothing')) : null,
    errorsBlock(preview.errors),
  ];
}

function stepApply() {
  if (state.result) return step(5, 'import.step.apply', true, resultBody(state.result));
  const preview = state.preview;
  if (preview === null) return step(5, 'import.step.apply', false);
  const ready = !blocked(preview) && preview.valid > 0;
  const button = el('button', {
    type: 'button', id: 'import-apply', class: 'button button--primary', disabled: !ready, onclick: apply,
  }, tCount('import.apply', preview.valid));
  if (state.applying) markBusy(button, 'import.apply.busy');
  let hint = null;
  if (!ready) hint = t('import.apply.blocked');
  else if (preview.total > preview.valid) hint = t('import.apply.skipNote');
  return step(5, 'import.step.apply', true,
    button,
    hint ? el('p', { class: 'step__hint' }, hint) : null,
    state.applyErrorKey ? note('error', t(state.applyErrorKey), { role: 'alert' }) : null,
    state.applyLost ? [
      note('warning', t('import.apply.lost')),
      el('button', { type: 'button', class: 'button button--secondary', onclick: check }, t('import.check.again')),
    ] : null);
}

function resultBody(result) {
  return [
    note('success', t('import.done'), { role: 'status' }),
    tally([
      [result.inserted, 'import.done.inserted'],
      [result.updated, 'import.done.updated'],
      [result.skipped, 'import.done.skipped', true],
    ]),
    // A subjects import gave groups other teachers; pairs at a time the new teacher already teaches stayed with the old one.
    result.skippedBusy > 0 ? note('warning', t('import.done.busy', { count: result.skippedBusy })) : null,
    errorsBlock(result.errors),
    el('button', { type: 'button', id: 'import-again', class: 'button button--secondary', onclick: startOver }, icon('upload'), t('import.again')),
  ];
}

// Counts with their labels; `bad` counts turn red when they are not zero.
function tally(items) {
  return el('dl', { class: 'tally' }, items.map(([count, key, bad]) => el('div', { class: 'tally__item' + (bad && count > 0 ? ' tally__item--bad' : '') },
    el('dt', { class: 'tally__label' }, t(key)),
    el('dd', { class: 'tally__count' }, String(count)))));
}

const columnTitle = (key) => (hasText(`import.col.${state.table}.${key}`) ? t(`import.col.${state.table}.${key}`) : key);

// Errors by Excel row number (the title row is 1), column title and what is wrong.
function errorsBlock(errors) {
  const rows = errors.filter((error) => error.row > 0);
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_ERRORS_SHOWN);
  return el('div', { class: 'stack stack--tight' },
    dataTable({
      caption: t('import.errors.title'),
      className: 'table-scroll--framed',
      columns: [{ label: t('import.errors.row'), className: 'table__num' }, { label: t('import.errors.column') }, { label: t('import.errors.problem') }],
      rows: shown.map((error) => [
        String(error.row + state.firstRow),
        columnTitle(error.field),
        t(fieldErrorKey(state.table, error.field, error.code, 'import')),
      ]),
    }),
    rows.length > shown.length ? el('p', { class: 'step__hint' }, t('import.errors.more', { count: rows.length - shown.length })) : null,
    el('p', { class: 'step__hint' }, t('import.errors.note')));
}

function passwordsSection() {
  const result = state.result;
  if (!result || result.passwords.length === 0) return null;
  return el('section', { class: 'card passwords printable', 'aria-labelledby': 'passwords-title' },
    el('p', { class: 'print-only' }, t('app.name')),
    el('h2', { class: 'card__title', id: 'passwords-title' }, t('import.passwords.heading', { table: t('dir.' + state.table) })),
    note('warning', t('import.passwords.warning'), { class: 'no-print' }),
    el('p', { class: 'print-only' }, t('import.passwords.printNote')),
    el('div', { class: 'actions no-print' },
      el('button', { type: 'button', id: 'passwords-download', class: 'button button--primary', onclick: downloadPasswords },
        icon('download'), t('import.passwords.download')),
      el('button', { type: 'button', id: 'passwords-print', class: 'button button--secondary', onclick: () => window.print() },
        icon('printer'), t('import.passwords.print'))),
    state.passwordsErrorKey ? note('error', t(state.passwordsErrorKey), { class: 'no-print', role: 'alert' }) : null,
    dataTable({
      className: 'table-scroll--framed table--slips',
      columns: [{ label: t('field.login'), className: 'table__id' }, { label: t('field.fullName') }, { label: t('field.password'), className: 'table__secret' }],
      rows: result.passwords.map((person) => [person.login, person.fullName, person.tempPassword]),
    }));
}

function questionDialog(question) {
  const leaving = question.kind === 'leave';
  const dialog = modal({ id: 'import-ask', labelledBy: 'import-ask-title', className: 'dialog--confirm', onClose: () => answer(false) },
    el('h2', { class: 'dialog__title', id: 'import-ask-title' }, t(leaving ? 'import.leave.title' : 'import.again.title')),
    el('p', {}, t('import.leave.text')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => answer(true) }, t(leaving ? 'import.leave.go' : 'import.again.go')),
      el('button', { type: 'button', class: 'button button--primary', autofocus: true, onclick: () => dialog.close() }, t('import.leave.stay'))));
  return dialog;
}

// Actions

function chooseTable(table) {
  if (state.table === table || settled()) return;
  state.table = table;
  state.templateErrorKey = null;
  // A file already read is checked again against the new directory; there is no need to choose it again.
  if (state.cells !== null) check();
  else refresh();
}

async function readFile(file) {
  const owner = state;
  const ticket = ++owner.ticket;
  Object.assign(owner, {
    file: { name: file.name, size: file.size }, cells: null, firstRow: 0, reading: true, fileErrorKey: null, fileErrorParams: null,
    preview: null, checking: false, checkErrorKey: null, applyErrorKey: null, applyLost: false,
  });
  refresh();
  const current = () => state === owner && owner.ticket === ticket;
  const fail = (key, params = null) => {
    if (!current()) return;
    owner.reading = false;
    owner.fileErrorKey = key;
    owner.fileErrorParams = params;
    refresh();
  };
  if (file.size > MAX_FILE_BYTES) return fail('import.error.tooBig');
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    return fail('import.error.library');
  }
  let sheet;
  try {
    sheet = await readFirstSheet(XLSX, file);
  } catch (error) {
    return fail('import.error.unreadable');
  }
  if (sheet.dateCell) return fail('import.error.dateCell', sheet.dateCell);
  if (sheet.cells.length === 0) return fail('import.error.empty');
  if (!current()) return;
  owner.reading = false;
  owner.cells = sheet.cells;
  owner.firstRow = sheet.firstRow;
  check();
}

async function readFirstSheet(XLSX, file) {
  let book;
  if (/\.csv$/i.test(file.name)) {
    book = XLSX.read(await csvText(file), { type: 'string', raw: true }); // raw: "01-1" stays text, not a date
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // An .xlsx file is a ZIP archive. Anything else under that name would be read as plain text and show garbage.
    if (/\.xlsx$/i.test(file.name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not an xlsx file');
    book = XLSX.read(bytes, { type: 'array', ...READ_OPTIONS });
  }
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet || !sheet['!ref']) return { cells: [], firstRow: 0 };
  // Excel turns "01-1" typed into a General cell into a date; its serial number must not reach the directory.
  const dateCell = findDateCell(XLSX, sheet);
  if (dateCell) return { dateCell };
  const cells = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
  while (cells.length > 0 && isBlankRow(cells[cells.length - 1])) cells.pop();
  return { cells, firstRow: XLSX.utils.decode_range(sheet['!ref']).s.r };
}

const isBlankRow = (row) => !Array.isArray(row) || row.every((cell) => String(cell).trim() === '');

// A CSV saved by Excel is UTF-8 or the Windows Cyrillic code page; invalid UTF-8 means the latter.
async function csvText(file) {
  const bytes = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('�') ? new TextDecoder('windows-1251').decode(bytes) : utf8;
}

// The file to the server, into the directory chosen.
const send = (owner, kind) => call('import.' + kind, { table: owner.table, cells: owner.cells });

async function check() {
  const owner = state;
  const ticket = ++owner.ticket;
  Object.assign(owner, { checking: true, preview: null, checkErrorKey: null, applyErrorKey: null, applyLost: false });
  refresh();
  try {
    const preview = await send(owner, 'preview');
    if (state !== owner || owner.ticket !== ticket) return;
    owner.preview = preview;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.checkErrorKey = errorKey(error.code);
  }
  owner.checking = false;
  refresh();
}

async function apply() {
  const owner = state;
  if (owner.applying || owner.preview === null || blocked(owner.preview) || owner.preview.valid === 0) return;
  owner.applying = true;
  owner.applyErrorKey = null;
  owner.applyLost = false;
  refresh();
  try {
    const result = await send(owner, 'apply');
    if (state !== owner) return;
    owner.result = result;
    if (result.passwords.length > 0) holdPasswords();
  } catch (error) {
    if (state !== owner) return;
    owner.applyErrorKey = errorKey(error.code);
    // A dropped connection or a server failure may leave part of the rows written.
    owner.applyLost = error.code === 'network' || error.code === 'internal';
  }
  owner.applying = false;
  refresh();
  if (owner.result) focusById(owner.result.passwords.length > 0 ? 'passwords-download' : 'import-again');
}

// Asks before the passwords leave the screen. Several requests while the question is open share one answer.
function ask(kind) {
  if (!state.ask) {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    state.ask = { kind, resolve, promise };
    refresh();
  }
  return state.ask.promise;
}

function answer(agree) {
  const question = state.ask;
  if (!question) return;
  state.ask = null;
  if (agree) releasePasswords();
  question.resolve(agree);
  // After "leave" the next screen replaces this one; after "stay" the question closes here.
  if (!agree) refresh();
}

async function startOver() {
  if (state.result && state.result.passwords.length > 0 && !(await ask('again'))) return;
  state = { ...blank(state.table), warmed: true };
  refresh();
  focusById('import-file');
}

async function downloadTemplate() {
  const { table } = state;
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    state.templateErrorKey = 'import.error.library';
    refresh();
    return;
  }
  const columns = IMPORT_COLUMNS[table];
  const titles = columns.map(({ key }) => columnTitle(key));
  const sheet = templateSheet(XLSX, titles, columns.map(({ key }) => FIELDS[key].kind !== 'number'));
  saveWorkbook(XLSX, t('dir.' + table), sheet, [titles], `template-${table}.xlsx`);
  if (state.templateErrorKey) {
    state.templateErrorKey = null;
    refresh();
  }
}

async function downloadPasswords() {
  const { table, result } = state;
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    state.passwordsErrorKey = 'import.error.library';
    refresh();
    return;
  }
  const rows = [
    [t('field.login'), t('field.fullName'), t('field.password')],
    ...result.passwords.map((person) => [person.login, person.fullName, person.tempPassword]),
  ];
  saveWorkbook(XLSX, t('dir.' + table), XLSX.utils.aoa_to_sheet(rows), rows, `passwords-${table}.xlsx`);
}

// `rows`: the text of the sheet, used to size the columns.
function saveWorkbook(XLSX, sheetName, sheet, rows, fileName) {
  sheet['!cols'] = rows[0].map((title, i) => ({ wch: Math.max(14, ...rows.map((row) => String(row[i] ?? '').length + 2)) }));
  const book = XLSX.utils.book_new();
  // Excel sheet names: at most 31 characters, none of : \ / ? * [ ]
  XLSX.utils.book_append_sheet(book, sheet, sheetName.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31));
  XLSX.writeFile(book, fileName);
}

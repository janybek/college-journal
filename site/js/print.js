import { el } from './ui.js';

// Printing a sheet on A4: the page rule, and the block that is printed. The block is built when the button is pressed and
// removed when the printing is over; while it stands, the rest of the screen is hidden by `has-printable` (screens.css).

export function pageRule(orientation) {
  return `@page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 12mm; }`;
}

// With the columns of the semester, the admission, the exam and the total two units do not fit a portrait page.
export function ledgerOrientation(unitCount) {
  return unitCount <= 1 ? 'portrait' : 'landscape';
}

// Puts the page rule in <head>, prints, and removes the rule (and the block) after the printing. host: the element whose
// other children are hidden meanwhile; block: the element that is printed (a child of host).
export function printPage(orientation, host = null, block = null) {
  document.getElementById('print-page')?.remove();
  const style = el('style', { id: 'print-page' });
  style.textContent = pageRule(orientation);
  document.head.append(style);
  if (host) host.classList.add('has-printable');
  const done = () => {
    window.removeEventListener('afterprint', done);
    style.remove();
    if (host) host.classList.remove('has-printable');
    if (block) block.remove();
  };
  window.addEventListener('afterprint', done);
  window.print();
}

const text = (tag, className, value) => el(tag, { class: className }, value);

// A table of rows of values with the merged cells of its head; the numbers of the cells are those of the sheet.
function table(head, merges, body, low) {
  const covered = new Set();
  const spanOf = new Map();
  for (const { s, e } of merges) {
    spanOf.set(`${s.r}:${s.c}`, { rows: e.r - s.r + 1, cols: e.c - s.c + 1 });
    for (let r = s.r; r <= e.r; r += 1) for (let c = s.c; c <= e.c; c += 1) if (r !== s.r || c !== s.c) covered.add(`${r}:${c}`);
  }
  const headRows = head.map((row, r) => el('tr', {}, row.flatMap((value, c) => {
    if (covered.has(`${r}:${c}`)) return [];
    const span = spanOf.get(`${r}:${c}`);
    return [el('th', { scope: span && span.cols > 1 ? 'colgroup' : 'col', rowspan: span && span.rows > 1 ? String(span.rows) : null, colspan: span && span.cols > 1 ? String(span.cols) : null }, String(value))];
  })));
  const bodyRows = body.map((row, r) => el('tr', {}, row.map((value, c) => {
    const classes = [typeof value === 'number' ? 'print-num' : 'print-text', low[r] && low[r][c] ? 'print-low' : ''].filter(Boolean).join(' ');
    return el(c === 1 ? 'th' : 'td', { class: classes, scope: c === 1 ? 'row' : null }, String(value));
  })));
  return el('table', { class: 'print-table' }, el('thead', {}, headRows), el('tbody', {}, bodyRows));
}

// The block of a sheet (the structure of ledgerSheet / examSheet in ledgerFile.js). Every text goes in as text.
export function printBlock(sheet) {
  return el('div', { class: 'print-sheet printable' },
    sheet.college ? text('p', 'print-college', sheet.college) : null,
    text('h2', 'print-title', sheet.title),
    sheet.draft ? text('p', 'print-draft', sheet.draft) : null,
    el('dl', { class: 'print-facts' }, sheet.facts.map(([label, value]) => el('div', {}, el('dt', {}, label), el('dd', {}, value === '' ? '—' : value)))),
    table(sheet.head, sheet.merges, sheet.body, sheet.low),
    sheet.counts ? text('p', 'print-counts', sheet.counts) : null,
    sheet.retakes ? el('div', { class: 'print-retakes' },
      text('h3', 'print-subtitle', sheet.retakes.title),
      el('ul', {}, sheet.retakes.rows.map((row) => el('li', {}, row.filter((v) => v !== '').join(' · '))))) : null,
    el('div', { class: 'print-signs' }, sheet.signs.map((line) => text('p', 'print-sign', line))));
}

// Prints a sheet of the screen: the block stands in host while the browser prints.
export function printSheet(host, sheet, orientation) {
  const block = printBlock(sheet);
  host.append(block);
  printPage(orientation, host, block);
}

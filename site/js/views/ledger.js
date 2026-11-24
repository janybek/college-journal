import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, focusById, markBusy, modal, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { semesterCell } from '../journal.js';
import { permissions } from '../shell.js';
import {
  ledgerColumns, unitCellText, isLow, admissionCell, examCell, finalCell, closeNote, canCloseUnit, examNote, unitBlockNote,
} from '../ledger.js';
import { examSection, examTd as examEditTd, studentExtra, countsList, reset as resetExam, sheetTools, textLabels } from './ledgerExam.js';
import { ledgerOrientation } from '../print.js';
import { ledgerSheet, ledgerBook, ledgerFileName } from '../ledgerFile.js';

// The ledger of a subject (#/ledger/<subjectId>, ledger.get): the numbers of the journal for every unit, then the semester
// points, the admission, the exam, the total and the grade. Every number is the server's; the screen only chooses words
// and tones. Closing a unit and reopening (the administrator, with a reason) ask in a window and draw the ledger again
// from the answer. Names and reasons are only ever text. The exam part (its head, the results, closing the final sheet, the retakes) is in ledgerExam.js.

const FINAL = 0;                 // the unit number of the final sheet in ledger.reopen
const REASON_MAX = 300;

const blank = (subjectId = null) => ({
  subjectId,
  data: null,          // the ledger of the answer; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
});
let state = blank();

export function leave() {
  resetExam();
  state = blank();
}

export function render(root, params) {
  if (state.subjectId !== params.subjectId) state = blank(params.subjectId);
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const view = state.data;
  const header = pageHeader({
    id: 'ledger-title',
    title: view ? `${view.subject.name} · ${view.subject.groupName}` : t('ledger.title'),
    lead: view ? t('ledger.leadSemester', { teacher: view.subject.teacherName || '—', n: view.subject.planSemester ?? view.subject.semester }) : null,
    actions: view ? links(view) : null,
  });
  header.classList.add('no-print');
  root.append(header, view === null ? loadingBody() : body(view));
}

function links(view) {
  const allowed = permissions();
  return [
    allowed.includes('journal.get') ? el('a', { class: 'button button--secondary', id: 'ledger-journal-link', href: '#/journal/' + encodeURIComponent(view.subject.id) }, t('ledger.link.journal')) : null,
    allowed.includes('journal.log') ? el('a', { class: 'button button--secondary', id: 'ledger-log-link', href: '#/journal-log/' + encodeURIComponent(view.subject.id) }, t('journalLog.title')) : null,
  ];
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('ledger.get', { subjectId: owner.subjectId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data: data.ledger, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code || 'internal';
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.errorCode = null;
  load();
  refresh();
}

function loadingBody() {
  const code = state.errorCode;
  if (code === null) return el('p', { class: 'loading' }, t('ledger.loading'));
  const back = el('a', { class: 'button button--secondary', href: '#/ledger' }, t('ledger.back'));
  const key = code === 'not_found' ? 'ledger.notFound' : errorKey(code);
  const failure = emptyState('alert', el('p', {}, t(key)),
    code === 'not_found' || code === 'forbidden' ? back
      : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

const dayOf = (at) => (at.length >= 10 ? `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}` : '');

function body(view) {
  const week = examNote(view.examWeek, view.today, view.final);
  const parts = [week ? note('info', t(week.key, week.params), { id: 'ledger-exam-note' }) : null];
  if (!view.subject.hasSyllabus || view.units.length === 0) {
    parts.push(note('warning', t('ledger.noSyllabus'), { id: 'ledger-no-syllabus' }));
    return el('div', { class: 'ledger', id: 'ledger-root' }, parts);
  }
  if (view.students.length === 0) {
    parts.push(emptyState('table', el('p', { class: 'empty__title' }, t('ledger.emptyStudents'))));
    return el('div', { class: 'ledger', id: 'ledger-root' }, parts);
  }
  const owner = state;
  const host = {
    owner,
    alive: () => state === owner,
    apply: (ledger) => { if (state !== owner) return false; owner.data = ledger; return true; },
    redraw: refresh,
    dialogShell,
  };
  parts.push(summary(view), finalBar(view), tools(view), grid(view, host), examSection(view, host));
  return el('div', { class: 'ledger', id: 'ledger-root' }, parts);
}

// ---- Print and Excel of the ledger ----

function tools(view) {
  return sheetTools({
    id: 'ledger-sheet', printKey: 'ledger.print.button', host: 'ledger-root',
    sheet: () => ledgerSheet(view, textLabels('ledger.file.sheet')), orientation: () => ledgerOrientation(view.units.length),
    file: (XLSX) => ({ book: ledgerBook(XLSX, view, textLabels('ledger.file.sheet')), name: ledgerFileName(view, t('ledger.file.prefix')) }),
  });
}

// ---- The line of the group: how many have each word (only when every unit is closed) ----

function summary(view) {
  return view.exam.ready ? countsList(view.students, 'ledger-counts') : null;
}

// ---- The final sheet: its state, and «Открыть заново» for the administrator ----

function finalBar(view) {
  const { final } = view;
  if (!final.closed && !view.exam.ready) return null;
  return el('div', { class: 'lg-final' + (final.closed ? ' is-closed' : '') },
    icon(final.closed ? 'checkCircle' : 'clock', 'lg-final__icon'),
    el('span', { class: 'lg-final__text', id: 'ledger-final-state' }, final.closed
      ? t('ledger.final.stateClosed', { date: dayOf(final.closedAt), name: final.closedByName || '—' })
      : t('ledger.final.stateOpen')),
    final.closed && view.can.reopen ? reopenMenu('final', FINAL) : null);
}

// The «…» menu with one item; a native <details>, so it opens with the keyboard too.
function reopenMenu(id, unit) {
  const details = el('details', { class: 'lg-menu', id: 'ledger-menu-' + id });
  const item = el('button', {
    type: 'button', class: 'lg-menu__item', id: 'ledger-reopen-' + id,
    onclick: () => { details.open = false; openReopen(unit); },
  }, t('ledger.reopen.item'));
  details.append(el('summary', { class: 'lg-menu__button', 'aria-label': t('ledger.menu'), title: t('ledger.menu') }, '…'), el('div', { class: 'lg-menu__list' }, item));
  details.addEventListener('focusout', (event) => { if (!details.contains(event.relatedTarget)) details.open = false; });
  return details;
}

// ---- The grid ----

function grid(view, host) {
  const columns = ledgerColumns(view);
  const { scheme, split } = view;
  const max = { current: scheme.current, self: scheme.self, control: scheme.control, total: 100 };
  const ready = view.exam.ready;
  const closed = view.final.closed;
  const unitCols = columns.filter((c) => c.type === 'unit');
  const students = [...view.students.filter((s) => !s.left), ...view.students.filter((s) => s.left)];
  const sumHead = (key, params, className) => el('th', { scope: 'col', rowspan: '2', class: 'lg-sum-head ' + className }, t(key, params));

  const head = el('thead', {},
    el('tr', {},
      el('th', { scope: 'col', rowspan: '2', class: 'lg-name' }, t('ledger.col.student')),
      unitCols.map((c) => unitHead(view, c)),
      sumHead('ledger.col.semester', { max: split.semester }, 'lg-sum-head--semester'),
      sumHead('ledger.col.admission', {}, ''),
      sumHead('ledger.col.exam', { max: split.exam }, ''),
      sumHead('ledger.col.final', { max: split.semester + split.exam }, ''),
      sumHead('ledger.col.word', {}, '')),
    el('tr', {}, unitCols.map((c) => c.fields.map((field) => el('th', {
      scope: 'col', class: `lg-field lg-field--${field}`, title: t('journal.tip.' + field, { max: max[field] }),
    }, t('journal.col.' + field))))));

  const colCount = 1 + unitCols.length * 4 + 5;
  const rows = students.flatMap((student, index) => [
    studentRow(view, student, index + 1, unitCols, { ready, closed, max, min: scheme.minimum }, host),
    studentExtra(view, student, colCount, host),
  ]).filter(Boolean);
  const scroller = el('div', { class: 'table-scroll lg-scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'ledger-title' },
    el('table', { class: 'lg-grid', id: 'ledger-grid' }, head, el('tbody', {}, rows)));
  return el('section', { class: 'card lg-card-grid', 'aria-labelledby': 'ledger-title' }, scroller);
}

// The head of a unit: its name, its state, and then the button that closes it, what stops the closing, or when it was closed.
function unitHead(view, column) {
  const unit = view.units.find((u) => u.unit === column.unit);
  const title = column.title ? t('ledger.unit.head', { n: unit.unit, title: column.title }) : t('ledger.unit.headPlain', { n: unit.unit });
  const hint = closeNote(unit);
  let action = null;
  if (canCloseUnit(unit, view.can)) {
    action = el('button', { type: 'button', class: 'button button--primary button--small lg-close', id: 'ledger-close-' + unit.unit, onclick: () => openClose(unit.unit) },
      t('ledger.close.button', { n: unit.unit }));
  }
  return el('th', { scope: 'colgroup', colspan: String(column.fields.length), class: 'lg-unit-head' + (unit.closed ? ' is-closed' : ''), id: 'ledger-unit-' + unit.unit },
    el('span', { class: 'lg-unit-head__title' }, title),
    el('span', { class: 'lg-unit-head__state' },
      badge(t(unit.closed ? 'ledger.unit.closed' : 'ledger.unit.open'), unit.closed ? 'success' : 'neutral', true),
      unit.closed && view.can.reopen ? reopenMenu('unit-' + unit.unit, unit.unit) : null),
    action,
    !action && hint ? el('span', { class: `lg-unit-head__note lg-unit-head__note--${hint.tone}`, id: 'ledger-note-' + unit.unit }, t(hint.key, hint.params)) : null,
    action && hint && hint.key === 'ledger.missing' ? el('span', { class: 'lg-unit-head__note lg-unit-head__note--neutral' }, t(hint.key, hint.params)) : null);
}

function studentRow(view, student, number, unitCols, { ready, closed, max, min }, host) {
  const cells = [];
  for (const column of unitCols) {
    const row = student.units.find((u) => u.unit === column.unit);
    for (const field of column.fields) cells.push(row ? unitCell(row, field, max, min) : el('td', { class: 'lg-num lg-pts lg-empty' }, '—'));
  }
  cells.push(semesterTd(student, view.split), admissionTd(student, ready, view.split), examEditTd(view, student, host) ?? examTd(student), finalTd(student, ready, closed), wordTd(student, ready, closed));
  return el('tr', { class: student.left ? 'is-left' : null },
    el('th', { scope: 'row', class: 'lg-name' },
      el('span', { class: 'lg-name__no' }, String(number)),
      el('span', { class: 'lg-name__text', title: student.fullName }, student.fullName || '—'),
      student.left ? el('span', { class: 'lg-name__left' }, t('ledger.left')) : null),
    cells);
}

function unitCell(row, field, max, min) {
  const low = isLow(row, field);
  let text = unitCellText(row, field);
  const classes = ['lg-num', 'lg-pts'];
  if (field === 'total') classes.push('lg-total');
  if (low) classes.push('is-low');
  const tips = [t('journal.tip.' + field, { max: max[field] })];
  if (low && field !== 'total') tips.push(t('ledger.low', { min }));
  if (field === 'current' && row.manual) { tips.push(t('ledger.manual')); text += '*'; }
  if (field === 'self' && row.selfPending > 0) { classes.push('is-provisional'); tips.push(t('ledger.selfPending')); }
  if (field === 'total' && row.word) tips.push(t('journal.grade.' + row.word));
  return el('td', { class: classes.join(' '), title: tips.join(', ') }, text);
}

function semesterTd(student, split) {
  const cell = semesterCell(student, split);
  return el('td', { class: `lg-num lg-sum lg-sum--semester${cell.tone === 'danger' ? ' is-low' : ''}`, title: cell.key ? t(cell.key, cell.params) : null }, cell.text);
}

function admissionTd(student, ready, split) {
  const cell = admissionCell(student, ready, split);
  return el('td', { class: 'lg-adm' }, cell.key ? badge(t(cell.key, cell.params), cell.tone) : '—');
}

function examTd(student) {
  const cell = examCell(student);
  if (cell.key === null) return el('td', { class: 'lg-num lg-sum' + (cell.text === '—' ? ' lg-empty' : '') }, cell.text);
  const tone = cell.key === 'ledger.exam.absent' ? 'danger' : 'warning';
  return el('td', { class: 'lg-sum', title: cell.key === 'ledger.exam.incomplete' ? t('ledger.exam.incompleteTip') : null }, badge(t(cell.key), tone));
}

function finalTd(student, ready, closed) {
  const cell = finalCell(student, { ready, closed });
  const low = student.status === 'done' && student.word === 'fail';
  return el('td', { class: `lg-num lg-sum lg-total${low ? ' is-low' : ''}${cell.draft ? ' is-draft' : ''}${cell.text === '—' ? ' lg-empty' : ''}`, title: cell.draft ? t('ledger.draft') : null }, cell.text);
}

// «Оценка»: the word as a label; while the final sheet is open, «предварительно» under it.
function wordTd(student, ready, closed) {
  const cell = finalCell(student, { ready, closed });
  if (cell.key === null) return el('td', { class: 'lg-word lg-empty' }, '—');
  return el('td', { class: 'lg-word' },
    badge(t(cell.key), cell.tone),
    cell.draft ? el('span', { class: 'lg-draft' }, t('ledger.draft')) : null);
}

// ---- Closing a unit ----

function dialogShell(id, onClose, canCancel, ...children) {
  document.getElementById(id)?.remove();
  const onHash = () => dialog.close();
  const dialog = modal({
    id, labelledBy: id + '-title', className: 'dialog--confirm',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); onClose(); },
    canCancel,
  }, ...children);
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function openClose(unitNumber) {
  const owner = state;
  const view = owner.data;
  const unit = view.units.find((u) => u.unit === unitNumber);
  if (!unit) return;
  const needAccept = unit.missing > 0;
  let busy = false;
  const problem = el('div', { class: 'mk-problem' });
  const accept = needAccept ? el('input', { type: 'checkbox', id: 'ledger-close-accept', class: 'check__input' }) : null;
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'ledger-close-confirm', 'aria-disabled': needAccept ? 'true' : null }, t('ledger.close.confirm'));
  if (accept) accept.addEventListener('change', () => confirm.setAttribute('aria-disabled', String(!accept.checked)));

  const submit = async () => {
    if (busy || confirm.getAttribute('aria-disabled') === 'true') return;
    busy = true;
    problem.replaceChildren();
    markBusy(confirm, 'ledger.close.busy');
    try {
      const data = await call('ledger.closeUnit', { subjectId: view.subject.id, unit: unit.unit, ...(needAccept ? { acceptMissing: true } : {}) });
      if (state === owner) owner.data = data.ledger;
      dialog.close();
      refresh();
    } catch (error) {
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('ledger.close.confirm');
      problem.replaceChildren(note('error', failText(error, view, unit.unit), { role: 'alert' }));
    }
  };
  confirm.addEventListener('click', submit);
  const dialog = dialogShell('ledger-close-dialog', () => focusById('ledger-close-' + unit.unit, 'ledger-unit-' + unit.unit), () => !busy,
    el('h2', { class: 'dialog__title', id: 'ledger-close-dialog-title' }, t('ledger.close.title', { n: unit.unit })),
    el('p', { class: 'lg-dialog__text' }, t('ledger.close.body')),
    needAccept ? el('p', { class: 'lg-dialog__text lg-dialog__warn', id: 'ledger-close-missing' }, t('ledger.close.missing', { n: unit.missing })) : null,
    needAccept ? el('label', { class: 'lg-accept', for: 'ledger-close-accept' }, accept, t('ledger.close.accept')) : null,
    problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'ledger-close-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
      confirm));
  focusById(needAccept ? 'ledger-close-accept' : 'ledger-close-confirm');
}

// The text of a failed request; a stop of the closing is told as in the head of the unit.
function failText(error, view, unitNumber) {
  const stop = unitBlockNote(error, view.units, unitNumber);
  return stop ? t(stop.key, stop.params) : t(failKey(error));
}

// The key of the text of the other failures.
function failKey(error) {
  if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields[0]) {
    const { field, code } = error.fields[0];
    if (field === 'acceptMissing') return 'ledger.close.needAccept';
    if (field === 'reason') return code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required';
  }
  return errorKey(error.code);
}

// ---- Reopening (the administrator): a reason is required ----

function openReopen(unitNumber) {
  const owner = state;
  const view = owner.data;
  const isFinal = unitNumber === FINAL;
  let busy = false;
  const problem = el('div', { class: 'mk-problem' });
  const area = el('textarea', {
    id: 'ledger-reopen-reason', name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': 'ledger-reopen-hint', 'aria-required': 'true',
  });
  const error = el('p', { class: 'field__error', id: 'ledger-reopen-error', hidden: true });
  const clear = () => { error.hidden = true; area.removeAttribute('aria-invalid'); };
  area.addEventListener('input', clear);
  const showError = (key) => {
    error.replaceChildren(icon('alert'), t(key));
    error.hidden = false;
    area.setAttribute('aria-invalid', 'true');
    area.focus();
  };
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'ledger-reopen-confirm' }, t('ledger.reopen.confirm'));
  confirm.addEventListener('click', async () => {
    if (busy) return;
    const reason = area.value.trim();
    if (reason === '') return showError('journal.marks.error.reason.required');
    if (reason.length > REASON_MAX) return showError('journal.marks.error.reason.too_long');
    busy = true;
    problem.replaceChildren();
    markBusy(confirm, 'ledger.reopen.busy');
    try {
      const data = await call('ledger.reopen', { subjectId: view.subject.id, unit: unitNumber, reason });
      if (state === owner) owner.data = data.ledger;
      dialog.close();
      refresh();
    } catch (failure) {
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('ledger.reopen.confirm');
      problem.replaceChildren(note('error', t(failKey(failure)), { role: 'alert' }));
    }
  });
  const menuId = isFinal ? 'final' : 'unit-' + unitNumber;
  const dialog = dialogShell('ledger-reopen-dialog', () => focusById('ledger-menu-' + menuId, 'ledger-grid'), () => !busy,
    el('h2', { class: 'dialog__title', id: 'ledger-reopen-dialog-title' }, isFinal ? t('ledger.reopen.title.final') : t('ledger.reopen.title.unit', { n: unitNumber })),
    el('p', { class: 'lg-dialog__text' }, t(isFinal ? 'ledger.reopen.body.final' : 'ledger.reopen.body.unit')),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'ledger-reopen-reason' }, t('ledger.reopen.reason')),
      el('p', { class: 'field__hint', id: 'ledger-reopen-hint' }, t('ledger.reopen.reasonHint')),
      el('div', { class: 'field__control' }, area),
      error),
    problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'ledger-reopen-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
      confirm));
  focusById('ledger-reopen-reason');
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import {
  el, badge, emptyState, errorKey, focusById, focusFirstInvalid, hasText, holdOnLeave, markBusy, modal, note, refresh, showModal, unmarkField,
} from '../ui.js';
import { icon } from '../icons.js';
import { dayParts, isDate } from '../dates.js';
import {
  PLAN_KINDS, TABS, checkLine, checkTabs, emptyItem, errorKeyOf, errorMap, errorsAfterEdit, isDirty, keptOrder, placeErrors, sameValue, sectionData, statusKind,
  submitOutcome, unitAbout,
} from '../syllabusForm.js';
import { draftFileData, fileLabels, fileName } from '../syllabus.js';
import { syllabusBook } from '../excel.js';
import { loadXlsx } from '../xlsxLoader.js';
import { renderTab } from './syllabusFormTabs.js';
import { leaveUpload, renderUpload, startUpload } from './syllabusUpload.js';
import { refreshReviewCount } from '../reviewCount.js';

// The form of a syllabus version (#/syllabus-form/<syllabusId>/<tab>): the head with the status and the buttons of the
// version (the file into the draft, the draft as a file, «Отправить на утверждение»), the remark of the deanery on a
// returned version, what to fix before submitting, nine tabs, the body of the shown tab and its «Сохранить». Each tab
// is a section of the document and is saved on its own (syllabus.saveSection); the tabs with unsaved changes carry a
// dot, and leaving the screen asks first. The values live in the state below: typing changes the state and nothing is
// redrawn; adding, removing, moving and saving redraw the screen, and every field has a fixed id, so focus comes back
// to it. The server decides who may do what; a version that may not be edited is shown with its fields off.

const STATUS_TONES = { draft: 'neutral', review: 'primary', returned: 'warning', approved: 'success', archived: 'neutral' };
const FINAL_ERRORS = { forbidden: 'sform.forbidden', not_found: 'sform.notFound' };

const blank = () => ({
  syllabusId: null,
  tab: 'title',
  shownTab: null,      // the tab drawn last: a new one is scrolled into view in the row of tabs
  form: null,          // the answer of syllabus.form: { syllabus, subject, can, … }
  doc: null,           // the document being edited
  saved: null,         // the document as the server last gave it
  loading: false,
  errorKey: null,
  errorCode: null,
  ticket: 0,
  errors: {},          // section -> { map: errorMap of the last save, list: the errors as they came, placed on the screen }
  status: {},          // section -> { kind: 'saved' | 'invalid' | 'locked' | 'error', key }
  saving: null,        // the section being saved
  locked: false,       // the version was sent or approved elsewhere: nothing can be saved any more
  details: new WeakMap(),  // lesson row -> «СРС и описание» opened (true) or closed (false) by hand
  confirm: null,       // { unit }: removing the last unit, which has lessons
  ask: null,           // the open question before leaving: { resolve, promise }
  checks: null,        // { errors, warnings } of the last check before submitting that found errors
  cleared: false,      // the errors of that check are all fixed now
  submitting: null,    // 'check' | 'send': a request of «Отправить на утверждение» is on its way
  submitAsk: null,     // { warnings }: the question before the version is sent
  actionError: null,   // a dictionary key: «Отправить», «Скачать» or the file did not work
});
let state = blank();

const copy = (value) => JSON.parse(JSON.stringify(value));

const warnBeforeUnload = (event) => {
  event.preventDefault();
  event.returnValue = '';
};

function release() {
  holdOnLeave(null);
  window.removeEventListener('beforeunload', warnBeforeUnload);
}

export function leave() {
  release();
  if (state.ask) state.ask.resolve(false);
  leaveUpload();
  state = blank();
}

// Another tab of the same version is not leaving: main.js does not ask then.
export function keepsHold(params) {
  return params.syllabusId === state.syllabusId;
}

export function render(root, params) {
  if (state.syllabusId !== params.syllabusId) {
    leave();
    state.syllabusId = params.syllabusId;
  }
  state.tab = params.tab;
  if (!state.form && !state.loading && state.errorKey === null) load(state);

  if (state.errorKey) {
    root.append(backLink(), failure());
    return;
  }
  if (!state.form) {
    root.append(backLink(), el('p', { class: 'loading' }, t('common.loading')));
    return;
  }
  root.append(screen());
  if (state.confirm) showModal(root, confirmDialog(state.confirm));
  if (state.submitAsk) showModal(root, submitDialog(state.submitAsk));
  if (state.ask) showModal(root, leaveDialog());
  renderUpload(root);
  if (state.shownTab !== state.tab) {
    state.shownTab = state.tab;
    document.getElementById('sf-tab-' + state.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  syncHold();
}

// The plan without units: the form shows one (the server wants at least one), and the same unit counts as saved, so
// an untouched draft has nothing unsaved.
function withUnit(plan) {
  const out = copy(plan);
  if (!Array.isArray(out.units) || out.units.length === 0) out.units = [emptyItem('unit')];
  return out;
}

function prepared(doc) {
  return { ...copy(doc), plan: withUnit(doc.plan) };
}

async function load(owner) {
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const form = await call('syllabus.form', { syllabusId: owner.syllabusId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { form, doc: prepared(form.doc), saved: prepared(form.doc) });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { errorKey: FINAL_ERRORS[error.code] ?? errorKey(error.code), errorCode: error.code });
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function failure() {
  const final = Object.prototype.hasOwnProperty.call(FINAL_ERRORS, state.errorCode);
  const body = emptyState('alert',
    el('p', {}, t(state.errorKey)),
    final ? null : el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorKey = null; refresh(); } }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// The syllabus page of the subject, in the half of the year of this version; a version of a teacher who has no group
// with the discipline any more goes back to «Предметы».
function pageHref() {
  const form = state.form;
  if (form && form.subject.id) return `#/syllabus/${form.subject.id}/${form.syllabus.semester}`;
  return form ? '#/subjects' : '#/';
}

function backLink() {
  const form = state.form;
  const key = form && form.subject.id ? 'sform.back' : form ? 'syllabus.back.office' : 'common.toHome';
  return el('a', { class: 'back-link', href: pageHref() }, icon('chevron'), t(key));
}

const dayText = (date) => {
  if (!isDate(date)) return '';
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
};

const editable = () => state.form.can.edit === true;
const planDirty = () => isDirty('plan', state.doc, state.saved);

function screen() {
  const section = state.tab;
  const errors = (state.errors[section] && state.errors[section].map) || new Map();
  const placed = new Set();
  const body = renderTab(section, context(section, errors, placed));
  return el('div', { class: 'sform' },
    backLink(),
    head(),
    remark(),
    editable() ? null : note('info', t(readOnlyKey()), { class: 'sform-readonly', id: 'sf-readonly' }),
    checksPanel(),
    tabs(),
    el('section', { class: 'card sform-panel', id: 'sf-panel', 'aria-labelledby': 'sf-panel-title' },
      el('h2', { class: 'sform-panel__title', id: 'sf-panel-title' }, t('sform.tab.' + section)),
      el('div', { class: 'sform-panel__body' }, body)),
    editable() ? saveBar(section, placed) : null);
}

// The discipline, who teaches it and in which groups, the status and the number of the version; the buttons of the version.
function head() {
  const { subject, syllabus } = state.form;
  const groups = subject.groups.map((group) => group.groupName).filter(Boolean);
  return el('header', { class: 'sform-head' },
    el('div', { class: 'sform-head__main' },
      el('p', { class: 'sform-head__kicker' }, t('syllabus.title')),
      el('h1', { class: 'page-title', id: 'sf-title' }, subject.name || '—'),
      el('div', { class: 'sform-head__meta' },
        badge(t('syllabus.status.' + syllabus.status), STATUS_TONES[syllabus.status] ?? 'neutral', true),
        el('span', { class: 'sform-head__version' }, t('sform.version', { n: syllabus.version })),
        subject.teacherName ? el('span', { class: 'sform-head__who' }, icon('briefcase'), subject.teacherName) : null,
        groups.length > 0 ? el('span', { class: 'badges', 'aria-label': t('sform.title.groups') }, groups.map((name) => badge(name, 'primary'))) : null)),
    actions());
}

// «Загрузить из Excel», «Скачать (Excel)» and «Отправить на утверждение» for a version that is edited. The file and the
// sending wait until every tab is saved: the file replaces what the form shows, the server checks what is stored.
function actions() {
  if (!editable()) return null;
  const { can, subject } = state.form;
  const dirty = dirtyTabs();
  const waiting = dirty.length > 0;
  const hintId = 'sf-actions-hint';
  const described = waiting ? hintId : null;
  const upload = el('button', {
    type: 'button', id: 'sf-upload', class: 'button button--secondary', disabled: waiting || state.locked || !subject.id, 'aria-describedby': described,
    onclick: uploadFile,
  }, icon('upload'), t('sform.file.upload'));
  const download = el('button', { type: 'button', id: 'sf-download', class: 'button button--secondary', onclick: downloadDraft },
    icon('download'), t('syllabus.download'));
  const submit = can.submit ? el('button', {
    type: 'button', id: 'sf-submit', class: 'button button--primary', disabled: waiting || state.locked, 'aria-describedby': described,
    onclick: checkBeforeSubmit,
  }, icon('checkCircle'), t('sform.submit')) : null;
  if (submit && state.submitting === 'check') markBusy(submit, 'sform.submit.checking');
  return el('div', { class: 'sform-actions', id: 'sf-actions' },
    el('div', { class: 'sform-actions__buttons' }, upload, download, submit),
    waiting ? el('p', { class: 'sform-actions__hint', id: hintId }, icon('info'),
      el('span', {}, t('sform.actions.saveFirst', { tabs: dirty.map((tab) => t('sform.tab.' + tab)).join(', ') }))) : null,
    state.actionError ? note('error', t(state.actionError), { role: 'alert', class: 'sform-actions__error' }) : null);
}

// A returned version: what the deanery wants changed, as it was written (line breaks kept).
function remark() {
  const { syllabus } = state.form;
  if (syllabus.status !== 'returned' || !syllabus.remark) return null;
  const when = dayText(syllabus.decidedAt);
  return el('section', { class: 'sform-remark', 'aria-labelledby': 'sf-remark-title' },
    el('span', { class: 'sform-remark__icon', 'aria-hidden': 'true' }, icon('pencil')),
    el('div', { class: 'sform-remark__body' },
      el('h2', { class: 'sform-remark__title', id: 'sf-remark-title' }, t('sform.remark.title'),
        when ? el('span', { class: 'sform-remark__when' }, t('sform.remark.when', { date: when })) : null),
      el('p', { class: 'sform-remark__text' }, syllabus.remark)));
}

function readOnlyKey() {
  const { status } = state.form.syllabus;
  return ['review', 'approved', 'archived'].includes(status) ? 'sform.readonly.' + status : 'sform.readonly.other';
}

// The nine tabs; one with unsaved changes carries a dot and says so to a screen reader. After a check before
// submitting, a tab carries the number of its errors (or of its warnings).
function tabs() {
  const counts = checkTabs(state.checks);
  return el('nav', { class: 'sform-tabs', 'aria-label': t('sform.tabs') },
    el('ol', { class: 'sform-tabs__list' }, TABS.map((tab, i) => {
      const dirty = isDirty(tab, state.doc, state.saved);
      const count = counts.get(tab);
      const shown = count ? (count.errors > 0 ? { n: count.errors, tone: 'error' } : { n: count.warnings, tone: 'warning' }) : null;
      return el('li', {}, el('a', {
        id: 'sf-tab-' + tab, class: 'sform-tab' + (dirty ? ' is-dirty' : ''), href: `#/syllabus-form/${state.syllabusId}/${tab}`,
        'aria-current': tab === state.tab ? 'page' : null,
      },
      tab === 'order' ? null : el('span', { class: 'sform-tab__no', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'sform-tab__name' }, t('sform.tab.' + tab)),
      shown ? el('span', { class: 'sform-tab__count is-' + shown.tone, 'aria-hidden': 'true' }, String(shown.n)) : null,
      shown ? el('span', { class: 'visually-hidden' }, ', ' + t(shown.tone === 'error' ? 'sform.checks.tabErrors' : 'sform.checks.tabWarnings', { n: shown.n })) : null,
      el('span', { class: 'sform-tab__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden sform-tab__unsaved', hidden: !dirty }, ', ' + t('sform.unsaved'))));
    })));
}

// ---- What to fix before submitting ----

function checkText(item) {
  const { key, params } = checkLine(item);
  return t(hasText(key) ? key : 'sform.checks.other', { ...params, date: dayText(params.date) });
}

function checkItem(item, tone) {
  const tab = TABS.includes(item.section) ? item.section : 'title';
  return el('li', { class: 'sform-check is-' + tone },
    el('a', { class: 'sform-check__link', href: `#/syllabus-form/${state.syllabusId}/${tab}`, 'aria-current': tab === state.tab ? 'page' : null },
      el('span', { class: 'sform-check__tab' }, t('sform.tab.' + tab)),
      el('span', { class: 'sform-check__text' }, checkText(item)),
      icon('chevron', 'sform-check__go')));
}

// The errors of the last check, each a link to its tab; the warnings under them. When the errors are fixed, a line says so.
function checksPanel() {
  if (state.cleared) {
    return note('success', t('sform.checks.cleared'), { class: 'sform-checks-cleared', role: 'status' });
  }
  if (!state.checks) return null;
  const { errors, warnings } = state.checks;
  return el('section', { class: 'sform-checks', 'aria-labelledby': 'sf-checks-title', id: 'sf-checks' },
    el('div', { class: 'sform-checks__head' },
      el('h2', { class: 'sform-checks__title', id: 'sf-checks-title', tabindex: '-1' },
        icon('alert', 'sform-checks__icon'), el('span', {}, t('sform.checks.title')), el('span', { class: 'sform-checks__count' }, String(errors.length))),
      el('p', { class: 'sform-checks__lead' }, t('sform.checks.lead'))),
    el('ul', { class: 'sform-checks__list' }, errors.map((item) => checkItem(item, 'error'))),
    warnings.length > 0 ? el('h3', { class: 'sform-checks__sub' }, t('sform.checks.warnings')) : null,
    warnings.length > 0 ? el('ul', { class: 'sform-checks__list' }, warnings.map((item) => checkItem(item, 'warning'))) : null);
}

// ---- The tab's context (see syllabusFormParts.js) ----

// The text of an error at a field: for a lesson, for this field, for the code; the general text of the code at last.
function errorText(key, code, params) {
  const field = String(key).startsWith('!') ? '' : String(key).split('.').filter((part) => !/^\d+$/.test(part)).pop() || '';
  const keys = [
    /^u\d+\./.test(key) ? `sform.error.lesson.${field}.${code}` : null,
    field ? `sform.error.${field}.${code}` : null,
    `sform.error.${code}`,
  ].filter(Boolean);
  return t(keys.find(hasText) ?? errorKey(code), params);
}

function context(section, errors, placed) {
  return {
    doc: state.doc,
    saved: state.saved,
    form: state.form,
    readOnly: !editable(),
    planDirty: planDirty(),
    error: (key) => {
      const code = errors.get(key) ?? null;
      if (code) placed.add(key);
      return code;
    },
    peek: (key) => errors.get(key) ?? null,
    errorText: (key, code) => errorText(key, code),
    typed: (key, errorId, control) => {
      if (key && errors.has(key)) {
        errors.delete(key);
        unmarkField(errorId, control);
      }
      if (state.status[section] && state.status[section].kind === 'saved') delete state.status[section];
      syncDirty();
    },
    change: (fn, focusId, edit) => {
      fn();
      state.errors = errorsAfterEdit(state.errors, section, edit);
      if (state.status[section] && state.status[section].kind === 'saved') delete state.status[section];
      refresh();
      if (focusId) focusById(focusId);
    },
    isOpen: (row, fallback) => (state.details.has(row) ? state.details.get(row) : fallback),
    toggle: (row, open) => state.details.set(row, open),
    confirmRemoveUnit: (unit) => {
      state.confirm = { unit };
      refresh();
    },
  };
}

// ---- Unsaved changes ----

const dirtyTabs = () => (state.doc ? TABS.filter((tab) => isDirty(tab, state.doc, state.saved)) : []);

// What the line beside «Сохранить» says: { kind, text }.
function statusOf(section) {
  const status = state.status[section] || null;
  const marks = state.errors[section] ? state.errors[section].map.size : 0;
  const kind = statusKind({ locked: state.locked, status, errors: marks, dirty: isDirty(section, state.doc, state.saved) });
  if (kind === 'locked') return { kind: 'error', text: t('sform.status.locked') };
  if (kind === 'invalid') return { kind: 'error', text: t('sform.status.invalid') };
  if (kind === 'error') return { kind: 'error', text: t(status.key) };
  if (kind === 'dirty') return { kind: 'dirty', text: t('sform.status.dirty') };
  if (kind === 'saved') return { kind: 'saved', text: t('sform.status.saved') };
  const when = dayText(state.form.syllabus.updated);
  return { kind: 'clean', text: when ? t('sform.status.savedOn', { date: when }) : t('sform.status.clean') };
}

function statusLine(section) {
  const { kind, text } = statusOf(section);
  return el('p', { class: 'savebar__status is-' + kind, id: 'sf-status', role: 'status' },
    kind === 'saved' ? icon('checkCircle') : kind === 'error' ? icon('alert') : null, el('span', {}, text));
}

// After typing: the marks of the tabs, the buttons of the version and the line beside «Сохранить» change in place.
function syncDirty() {
  for (const tab of TABS) {
    const dirty = isDirty(tab, state.doc, state.saved);
    const link = document.getElementById('sf-tab-' + tab);
    if (!link) continue;
    link.classList.toggle('is-dirty', dirty);
    const hidden = link.querySelector('.sform-tab__unsaved');
    if (hidden) hidden.hidden = !dirty;
  }
  const buttons = document.getElementById('sf-actions');
  const next = actions();
  if (buttons && next) buttons.replaceWith(next);
  document.getElementById('sf-status')?.replaceWith(statusLine(state.tab));
  syncHold();
}

function syncHold() {
  if (dirtyTabs().length > 0) {
    holdOnLeave(askLeave);
    window.addEventListener('beforeunload', warnBeforeUnload);
  } else release();
}

function askLeave() {
  if (!state.ask) {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    state.ask = { resolve, promise };
    refresh();
  }
  return state.ask.promise;
}

function answer(agree) {
  const question = state.ask;
  if (!question) return;
  state.ask = null;
  if (agree) release();
  question.resolve(agree);
  // After «leave» the next screen replaces this one; after «stay» the question closes here.
  if (!agree) refresh();
}

function leaveDialog() {
  const names = dirtyTabs().map((tab) => t('sform.tab.' + tab)).join(', ');
  const dialog = modal({ id: 'sf-leave', labelledBy: 'sf-leave-title', className: 'dialog--confirm', onClose: () => answer(false) },
    el('h2', { class: 'dialog__title', id: 'sf-leave-title' }, t('sform.leave.title')),
    el('p', {}, t('sform.leave.text', { tabs: names })),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => answer(true) }, t('sform.leave.go')),
      el('button', { type: 'button', class: 'button button--primary', autofocus: true, onclick: () => dialog.close() }, t('sform.leave.stay'))));
  return dialog;
}

// Removing the last unit that has lessons, a description or books: they go with it when the tab is saved.
function confirmDialog({ unit }) {
  const units = state.doc.plan.units;
  const rows = PLAN_KINDS.reduce((n, kind) => n + (units[unit - 1][kind] || []).length, 0);
  const about = unitAbout(state.doc.units, unit);
  const close = (focusId) => {
    state.confirm = null;
    refresh();
    focusById(focusId, 'sf-plan-add-unit');
  };
  const dialog = modal({ id: 'sf-confirm', labelledBy: 'sf-confirm-title', className: 'dialog--confirm', onClose: () => close('sf-plan-remove-unit') },
    el('h2', { class: 'dialog__title', id: 'sf-confirm-title' }, t('sform.plan.removeUnit.title', { n: unit })),
    rows > 0 ? el('p', {}, t('sform.plan.removeUnit.text', { n: unit, count: rows })) : null,
    about.texts || about.books > 0 ? el('p', {}, t('sform.plan.removeUnit.about', { n: unit })) : null,
    about.books > 0 ? el('p', {}, t('sform.plan.removeUnit.books', { count: about.books })) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', autofocus: true, onclick: () => dialog.close() }, t('common.cancel')),
      el('button', {
        type: 'button', class: 'button button--danger',
        onclick: () => {
          state.doc.plan.units = state.doc.plan.units.slice(0, unit - 1);
          state.errors = errorsAfterEdit(state.errors, 'plan', 'remove');
          delete state.status.plan;
          close('sf-plan-remove-unit');
        },
      }, t('sform.plan.removeUnit.go'))));
  return dialog;
}

// ---- Saving ----

// The line beside «Сохранить» and the errors that have no field on the screen (every one of them).
function saveBar(section, placed) {
  const entry = state.errors[section];
  const unplaced = [];
  if (entry) {
    const seen = new Set();
    entry.list.forEach((error, i) => {
      const key = errorKeyOf(error, i);
      if (seen.has(key) || placed.has(key) || !entry.map.has(key)) return;
      seen.add(key);
      unplaced.push(note('error', errorText(key, error.code, error)));
    });
  }
  const order = section === 'order';
  const blocked = order && planDirty();
  const submit = el('button', {
    type: 'button', id: 'sf-save', class: 'button button--primary', disabled: state.locked || blocked,
    'aria-describedby': blocked ? 'sf-order-blocked' : null, onclick: () => save(section),
  }, icon('check'), t(order ? 'sform.order.save' : 'common.save'));
  if (state.saving === section) markBusy(submit, 'common.saving');
  return [
    unplaced.length > 0 ? el('div', { class: 'notes sform-unplaced', role: 'alert' }, unplaced) : null,
    el('div', { class: 'savebar sform-savebar' }, statusLine(section), submit),
  ];
}

// The units of the saved plan count for the descriptions of the units: those of removed units are gone on the server too.
function keepUnits(doc, count) {
  doc.units.units = doc.units.units.filter((unit) => unit.unit <= count);
}

async function save(section) {
  if (state.saving || state.locked || !editable()) return;
  if (section === 'order' && planDirty()) return;
  const owner = state;
  // The form sends the section without the rows nobody filled in and keeps them on the screen; the places of the
  // server's errors are turned back into the places on the screen.
  const shown = copy(owner.doc[section] ?? null);
  const data = sectionData(section, owner.doc);
  owner.saving = section;
  delete owner.status[section];
  refresh();
  let invalid = false;
  let saved = false;
  try {
    const result = await call('syllabus.saveSection', { syllabusId: owner.syllabusId, section, data });
    if (state !== owner) return;
    // What was typed while the answer was on its way stays on the screen (and stays unsaved).
    const untouched = sameValue(sectionData(section, owner.doc), data);
    if (section === 'order') {
      owner.saved.lessons = copy(result.doc);
      if (untouched) owner.doc.lessons = copy(result.doc);
    } else if (section === 'plan') {
      owner.saved.plan = withUnit(result.doc);
      if (untouched) owner.doc.plan = withUnit(result.doc);
      for (const doc of [owner.saved, owner.doc]) keepUnits(doc, result.doc.units.length);
    } else {
      owner.saved[section] = copy(result.doc);
      if (untouched) owner.doc[section] = copy(result.doc);
    }
    if (result.lessons) {
      // An order set on «Порядок пар» and not saved yet stays (still unsaved) on the lessons of the new plan.
      owner.doc.lessons = copy(keptOrder(owner.doc.lessons, owner.saved.lessons, result.lessons));
      owner.saved.lessons = copy(result.lessons);
    }
    for (const doc of [owner.saved, owner.doc]) doc.plan.manualOrder = result.manualOrder === true;
    owner.form.syllabus.updated = result.updated;
    delete owner.errors[section];
    owner.status[section] = { kind: 'saved' };
    saved = true;
  } catch (error) {
    if (state !== owner) return;
    if (error.code === 'invalid') {
      const fields = placeErrors(section, shown, error.fields);
      owner.errors[section] = { map: errorMap(fields), list: fields };
      owner.status[section] = { kind: 'invalid' };
      invalid = true;
    } else if (error.code === 'syllabus_locked') {
      owner.locked = true;
      owner.status[section] = { kind: 'locked' };
    } else {
      owner.status[section] = { kind: 'error', key: errorKey(error.code) };
    }
  } finally {
    if (state === owner) owner.saving = null;
  }
  refresh();
  if (invalid) focusFirstInvalid();
  // The list of what to fix is checked again: a fixed line goes from it.
  if (saved && owner.checks) recheck(owner);
}

// ---- Sending for approval ----

function failSubmit(owner, error) {
  if (error.code === 'syllabus_locked') {
    owner.locked = true;
    owner.actionError = 'sform.status.locked';
  } else {
    owner.actionError = FINAL_ERRORS[error.code] ?? errorKey(error.code);
  }
}

// «Отправить на утверждение»: the server checks the version first (dryRun). Errors: the list of what to fix, the
// tabs with their numbers. None: the question before sending, with what is left empty.
async function checkBeforeSubmit() {
  if (state.submitting || state.locked || dirtyTabs().length > 0) return;
  const owner = state;
  Object.assign(owner, { submitting: 'check', actionError: null, cleared: false });
  refresh();
  try {
    const result = await call('syllabus.submit', { syllabusId: owner.syllabusId, dryRun: true });
    if (state !== owner) return;
    if (result.checks.errors.length > 0) owner.checks = result.checks;
    else Object.assign(owner, { checks: null, submitAsk: { warnings: result.checks.warnings } });
  } catch (error) {
    if (state !== owner) return;
    failSubmit(owner, error);
  } finally {
    if (state === owner) owner.submitting = null;
  }
  refresh();
  if (owner.checks) focusById('sf-checks-title');
}

// After a tab is saved while the list of what to fix is shown: the list as it stands now.
async function recheck(owner) {
  try {
    const result = await call('syllabus.submit', { syllabusId: owner.syllabusId, dryRun: true });
    if (state !== owner || !owner.checks) return;
    if (result.checks.errors.length > 0) owner.checks = result.checks;
    else Object.assign(owner, { checks: null, cleared: true });
    refresh();
  } catch (error) {
    // the list stays as it was; «Отправить» checks again anyway
  }
}

async function send() {
  if (state.submitting) return;
  const owner = state;
  Object.assign(owner, { submitting: 'send', actionError: null });
  refresh();
  try {
    const result = await call('syllabus.submit', { syllabusId: owner.syllabusId });
    // The queue grew: the number of the menu is read again (only by those who have the queue; reviewCount.js checks).
    if (submitOutcome(result) === 'sent') refreshReviewCount();
    if (state !== owner) return;
    const outcome = submitOutcome(result);
    if (outcome === 'sent') {
      owner.submitAsk = null;
      release();
      location.hash = pageHref();
      return;
    }
    // Something changed since the check: the list says what. Not sent with nothing to fix: the head says so.
    Object.assign(owner, { submitAsk: null, checks: outcome === 'checks' ? result.checks : null, actionError: outcome === 'failed' ? 'sform.submit.notSent' : null });
  } catch (error) {
    if (state !== owner) return;
    owner.submitAsk = null;
    failSubmit(owner, error);
  } finally {
    if (state === owner) owner.submitting = null;
  }
  refresh();
  if (owner.checks) focusById('sf-checks-title');
}

function submitDialog({ warnings }) {
  const empty = [...new Set(warnings.map((item) => item.section))].filter((tab) => TABS.includes(tab)).map((tab) => t('sform.tab.' + tab));
  const close = () => {
    if (state.submitting) return;
    state.submitAsk = null;
    refresh();
    focusById('sf-submit');
  };
  const go = el('button', { type: 'button', id: 'sf-send', class: 'button button--primary', onclick: send },
    icon('checkCircle'), t(empty.length > 0 ? 'sform.submit.anyway' : 'sform.submit.go'));
  if (state.submitting === 'send') markBusy(go, 'sform.submit.sending');
  const dialog = modal({ id: 'sf-submit-ask', labelledBy: 'sf-submit-title', className: 'dialog--confirm', onClose: close, canCancel: () => !state.submitting },
    el('h2', { class: 'dialog__title', id: 'sf-submit-title' }, t('sform.submit.title')),
    empty.length > 0 ? el('p', { class: 'sform-submit__empty' }, icon('alert'), el('span', {}, t('sform.submit.empty', { tabs: empty.join(', ') }))) : null,
    el('p', {}, t('sform.submit.text')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', autofocus: true, onclick: () => dialog.close() }, t('common.cancel')),
      go));
  return dialog;
}

// ---- The file ----

// The draft as a file: what is saved, one lesson per row in the order of the pairs.
async function downloadDraft() {
  const owner = state;
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    if (state !== owner) return;
    owner.actionError = 'import.error.library';
    refresh();
    return;
  }
  if (state !== owner) return;
  const { subject } = owner.form;
  XLSX.writeFile(syllabusBook(XLSX, fileLabels(t), draftFileData({ ...owner.form, doc: owner.saved })),
    fileName([t('syllabus.title'), subject.name, subject.teacherName]));
  if (owner.actionError) {
    owner.actionError = null;
    refresh();
  }
}

// A file of the template fills the title and the plan of the draft (the check window of syllabusUpload.js); then
// the form is read again and opens «Тематические планы» of the version the file filled.
function uploadFile() {
  if (dirtyTabs().length > 0 || state.locked) return;
  const { subject } = state.form;
  const owner = state;
  startUpload({
    subjectId: subject.id, disciplineName: subject.name, teacherName: subject.teacherName, groupNames: subject.groups.map((g) => g.groupName).filter(Boolean),
  }, (result) => {
    if (state !== owner) return;
    const drafts = (result && result.drafts) || [];
    const target = (drafts.find((d) => d.syllabusId === owner.syllabusId) || drafts[0] || { syllabusId: owner.syllabusId }).syllabusId;
    const next = `#/syllabus-form/${target}/plan`;
    if (target === owner.syllabusId) {
      // the same version: read it again here
      Object.assign(owner, { form: null, doc: null, saved: null, errors: {}, status: {}, checks: null, cleared: false, actionError: null, shownTab: null });
    }
    if (location.hash === next) refresh();
    else location.hash = next;
  }, 'sf-upload', { intoDraft: true });
}

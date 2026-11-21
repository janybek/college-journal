import { call } from '../api.js';
import { t } from '../i18n.js';
import {
  el, badge, emptyState, errorKey, focusById, focusFirstInvalid, hasText, holdOnLeave, markBusy, modal, note, refresh, showModal, unmarkField,
} from '../ui.js';
import { icon } from '../icons.js';
import { dayParts, isDate } from '../dates.js';
import { PLAN_KINDS, TABS, emptyItem, errorMap, isDirty, sectionData, withoutBlankRows } from '../syllabusForm.js';
import { renderTab } from './syllabusFormTabs.js';

// The form of a syllabus version (#/syllabus-form/<syllabusId>/<tab>): the head with the status, the remark of the
// deanery on a returned version, nine tabs, the body of the shown tab and its «Сохранить». Each tab is a section of
// the document and is saved on its own (syllabus.saveSection); the tabs with unsaved changes carry a dot, and leaving
// the screen asks first. The values live in the state below: typing changes the state and nothing is redrawn; adding,
// removing, moving and saving redraw the screen, and every field has a fixed id, so focus comes back to it.
// The server decides who may do what; a version that may not be edited is shown with its fields off.

const STATUS_TONES = { draft: 'neutral', review: 'primary', returned: 'warning', approved: 'success', archived: 'neutral' };
const FINAL_ERRORS = { forbidden: 'sform.forbidden', not_found: 'sform.notFound' };
const READY = ['title', 'goals', 'plan'];   // the tabs drawn so far; the others say they come next

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
  errors: {},          // section -> { map: errorMap of the last save, list: the errors as they came }
  status: {},          // section -> { kind: 'saved' | 'invalid' | 'locked' | 'error', key }
  saving: null,        // the section being saved
  locked: false,       // the version was sent or approved elsewhere: nothing can be saved any more
  details: new WeakMap(),  // lesson row -> «СРС и описание» opened (true) or closed (false) by hand
  confirm: null,       // { unit }: removing the last unit, which has lessons
  ask: null,           // the open question before leaving: { resolve, promise }
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
  if (state.ask) showModal(root, leaveDialog());
  if (state.shownTab !== state.tab) {
    state.shownTab = state.tab;
    document.getElementById('sf-tab-' + state.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  syncHold();
}

// The plan of a new draft has no unit yet: the form starts with one (the server wants at least one), and the same
// unit counts as saved, so an untouched draft has nothing unsaved.
function prepared(doc) {
  const out = copy(doc);
  if (!Array.isArray(out.plan.units) || out.plan.units.length === 0) out.plan.units = [emptyItem('unit')];
  return out;
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

// Back to the syllabus page of the subject, in the half of the year of this version; a version of a teacher who
// has no group with the discipline any more goes back to «Предметы».
function backLink() {
  const form = state.form;
  if (form && form.subject.id) {
    return el('a', { class: 'back-link', href: `#/syllabus/${form.subject.id}/${form.syllabus.semester}` }, icon('chevron'), t('sform.back'));
  }
  return el('a', { class: 'back-link', href: form ? '#/subjects' : '#/' }, icon('chevron'), t(form ? 'syllabus.back.office' : 'common.toHome'));
}

const dayText = (date) => {
  if (!isDate(date)) return '';
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
};

const editable = () => state.form.can.edit === true;

function screen() {
  const section = state.tab;
  const ready = READY.includes(section);
  const errors = (state.errors[section] && state.errors[section].map) || new Map();
  const placed = new Set();
  const body = ready ? renderTab(section, context(section, errors, placed)) : renderTab(section, null);
  return el('div', { class: 'sform' },
    backLink(),
    head(),
    remark(),
    editable() ? null : note('info', t(readOnlyKey()), { class: 'sform-readonly', id: 'sf-readonly' }),
    tabs(),
    el('section', { class: 'card sform-panel', id: 'sf-panel', 'aria-labelledby': 'sf-panel-title' },
      el('h2', { class: 'sform-panel__title', id: 'sf-panel-title' }, t('sform.tab.' + section)),
      el('div', { class: 'sform-panel__body' }, body)),
    ready && editable() ? saveBar(section, [...errors.keys()].filter((key) => !placed.has(key))) : null);
}

// The discipline, who teaches it and in which groups, the status and the number of the version.
function head() {
  const { subject, syllabus } = state.form;
  const groups = subject.groups.map((group) => group.groupName).filter(Boolean);
  return el('header', { class: 'sform-head' },
    el('p', { class: 'sform-head__kicker' }, t('syllabus.title')),
    el('h1', { class: 'page-title', id: 'sf-title' }, subject.name || '—'),
    el('div', { class: 'sform-head__meta' },
      badge(t('syllabus.status.' + syllabus.status), STATUS_TONES[syllabus.status] ?? 'neutral', true),
      el('span', { class: 'sform-head__version' }, t('sform.version', { n: syllabus.version })),
      subject.teacherName ? el('span', { class: 'sform-head__who' }, icon('briefcase'), subject.teacherName) : null,
      groups.length > 0 ? el('span', { class: 'badges', 'aria-label': t('sform.title.groups') }, groups.map((name) => badge(name, 'primary'))) : null));
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

// The nine tabs; one with unsaved changes carries a dot and says so to a screen reader.
function tabs() {
  return el('nav', { class: 'sform-tabs', 'aria-label': t('sform.tabs') },
    el('ol', { class: 'sform-tabs__list' }, TABS.map((tab, i) => {
      const dirty = isDirty(tab, state.doc, state.saved);
      return el('li', {}, el('a', {
        id: 'sf-tab-' + tab, class: 'sform-tab' + (dirty ? ' is-dirty' : ''), href: `#/syllabus-form/${state.syllabusId}/${tab}`,
        'aria-current': tab === state.tab ? 'page' : null,
      },
      tab === 'order' ? null : el('span', { class: 'sform-tab__no', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'sform-tab__name' }, t('sform.tab.' + tab)),
      el('span', { class: 'sform-tab__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'visually-hidden sform-tab__unsaved', hidden: !dirty }, ', ' + t('sform.unsaved'))));
    })));
}

// ---- The tab's context (see syllabusFormParts.js) ----

// The text of an error at a field: for a lesson, for this field, for the code; the general text of the code at last.
function errorText(key, code, params) {
  const field = String(key).split('.').filter((part) => !/^\d+$/.test(part)).pop() || '';
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
    form: state.form,
    readOnly: !editable(),
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
    change: (fn, focusId) => {
      fn();
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
  const status = state.status[section];
  if (state.locked) return { kind: 'error', text: t('sform.status.locked') };
  if (status && status.kind === 'invalid') return { kind: 'error', text: t('sform.status.invalid') };
  if (status && status.kind === 'error') return { kind: 'error', text: t(status.key) };
  if (isDirty(section, state.doc, state.saved)) return { kind: 'dirty', text: t('sform.status.dirty') };
  if (status && status.kind === 'saved') return { kind: 'saved', text: t('sform.status.saved') };
  const when = dayText(state.form.syllabus.updated);
  return { kind: 'clean', text: when ? t('sform.status.savedOn', { date: when }) : t('sform.status.clean') };
}

function statusLine(section) {
  const { kind, text } = statusOf(section);
  return el('p', { class: 'savebar__status is-' + kind, id: 'sf-status', role: 'status' },
    kind === 'saved' ? icon('checkCircle') : kind === 'error' ? icon('alert') : null, el('span', {}, text));
}

// After typing: the marks of the tabs and the line beside «Сохранить» change in place.
function syncDirty() {
  for (const tab of TABS) {
    const dirty = isDirty(tab, state.doc, state.saved);
    const link = document.getElementById('sf-tab-' + tab);
    if (!link) continue;
    link.classList.toggle('is-dirty', dirty);
    const hidden = link.querySelector('.sform-tab__unsaved');
    if (hidden) hidden.hidden = !dirty;
  }
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

// Removing the last unit that has lessons: they go with it when the tab is saved.
function confirmDialog({ unit }) {
  const units = state.doc.plan.units;
  const rows = PLAN_KINDS.reduce((n, kind) => n + (units[unit - 1][kind] || []).length, 0);
  const close = (focusId) => {
    state.confirm = null;
    refresh();
    focusById(focusId, 'sf-plan-add-unit');
  };
  const dialog = modal({ id: 'sf-confirm', labelledBy: 'sf-confirm-title', className: 'dialog--confirm', onClose: () => close('sf-plan-remove-unit') },
    el('h2', { class: 'dialog__title', id: 'sf-confirm-title' }, t('sform.plan.removeUnit.title', { n: unit })),
    el('p', {}, t('sform.plan.removeUnit.text', { n: unit, count: rows })),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', autofocus: true, onclick: () => dialog.close() }, t('common.cancel')),
      el('button', {
        type: 'button', class: 'button button--danger',
        onclick: () => {
          state.doc.plan.units = state.doc.plan.units.slice(0, unit - 1);
          delete state.status.plan;
          close('sf-plan-remove-unit');
        },
      }, t('sform.plan.removeUnit.go'))));
  return dialog;
}

// ---- Saving ----

function saveBar(section, unplaced) {
  const list = (state.errors[section] && state.errors[section].list) || [];
  const keyOf = (error) => [...errorMap([error]).keys()][0];
  const submit = el('button', {
    type: 'button', id: 'sf-save', class: 'button button--primary', disabled: state.locked, onclick: () => save(section),
  }, icon('check'), t('common.save'));
  if (state.saving === section) markBusy(submit, 'common.saving');
  return [
    unplaced.length > 0 ? el('div', { class: 'notes sform-unplaced', role: 'alert' }, unplaced.map((key) => {
      const error = list.find((item) => keyOf(item) === key) || {};
      return note('error', errorText(key, error.code, error));
    })) : null,
    el('div', { class: 'savebar sform-savebar' }, statusLine(section), submit),
  ];
}

async function save(section) {
  if (state.saving || state.locked || !editable()) return;
  const owner = state;
  // Rows nobody filled in go before sending: the places of the server's errors are then the places on the screen.
  owner.doc[section] = withoutBlankRows(section, owner.doc[section]);
  const data = sectionData(section, owner.doc);
  const sent = JSON.stringify(data);
  owner.saving = section;
  delete owner.status[section];
  refresh();
  let invalid = false;
  try {
    const result = await call('syllabus.saveSection', { syllabusId: owner.syllabusId, section, data });
    if (state !== owner) return;
    // What was typed while the answer was on its way stays on the screen (and stays unsaved).
    const untouched = JSON.stringify(sectionData(section, owner.doc)) === sent;
    if (section === 'order') {
      owner.saved.lessons = copy(result.doc);
      if (untouched) owner.doc.lessons = copy(result.doc);
    } else {
      owner.saved[section] = copy(result.doc);
      if (untouched) owner.doc[section] = copy(result.doc);
    }
    if (result.lessons) {
      owner.saved.lessons = copy(result.lessons);
      owner.doc.lessons = copy(result.lessons);
    }
    owner.form.syllabus.updated = result.updated;
    delete owner.errors[section];
    owner.status[section] = { kind: 'saved' };
  } catch (error) {
    if (state !== owner) return;
    if (error.code === 'invalid') {
      owner.errors[section] = { map: errorMap(error.fields), list: error.fields || [] };
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
}

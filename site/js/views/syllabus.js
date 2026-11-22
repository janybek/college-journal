import { call } from '../api.js';
import { getUser } from '../session.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, focusById, hasText, markBusy, modal, note, refresh, showModal } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole, menuParts } from '../shell.js';
import { dayParts, isDate } from '../dates.js';
import {
  shortDate, unitGroups, describedRows, hasSelfHours, undated, scheduleNotes, versionLine, pageActions, linesOf, safeLink, keptDone,
} from '../syllabus.js';
import { TABS, checkLine, submitOutcome } from '../syllabusForm.js';
import { topicText, lessonTypeKey } from '../pairs.js';
import { uploadControls, renderUpload, leaveUpload, forgetUploadNote } from './syllabusUpload.js';
import { refreshReviewCount } from '../reviewCount.js';

// The syllabus of a subject (#/syllabus/<subjectId>/<1|2>, and its new version …/draft), the same page for the
// deanery, the teacher and the student. Every section of the version shown, under a list of the sections: the title
// page, the aim and the outcomes, the thematic plan in the order of the pairs with the dates of the group, the units,
// СРС, the reading list, the software, the policies; a section with nothing in it is left out. The staff see a bar
// with the status of the version and what they may do with it (pageActions: into the form, send it, approve it or
// return it with remarks, the other version); the student sees the approved version only, and nothing while a new
// one is under review. Nothing is edited on the page: the form does that. The server decides who may see and do
// what; `forbidden` and `not_found` are explained with a way back. Everything written in the syllabus goes in as text.

const LESSON_TYPES = ['lecture', 'practice', 'control'];
const FINAL_ERRORS = { forbidden: 'syllabus.forbidden', not_found: 'syllabus.notFound' };
const REMARK_MAX = 5000;
const GRADES = [['fail', 'Fail'], ['fair', 'Fair'], ['good', 'Good'], ['excellent', 'Excellent']];

const blank = () => ({
  key: null,           // 'subjectId|semester|version' of the address; the semester part is empty when the address has none
  shownKey: null,      // the key `view` was read for
  view: null,          // the answer of syllabus.get being drawn
  loadingKey: null,
  errorKey: null,
  errorCode: null,
  ticket: 0,
  starting: false,     // syllabus.startDraft is on its way
  busy: null,          // 'check' | 'send' | 'approve': a request of a button of the bar is on its way
  checks: null,        // { errors, warnings } of the check before sending that found errors
  submitAsk: null,     // { warnings }: the question before the version is sent
  approveAsk: null,    // { errors, errorKey }: the window «Утвердить силлабус?»
  actionError: null,   // a dictionary key: a button of the bar did not work
  done: null,          // { key, at }: what the last decision did («Силлабус утверждён…») and the address key it is shown on
});
let state = blank();

const present = (value) => value !== null && value !== undefined && value !== '';
const filled = (text) => typeof text === 'string' && text.trim() !== '';

export function leave() {
  state = blank();
  leaveUpload();
}

export function render(root, params) {
  const { subjectId, semester = null, version = 'approved' } = params;
  const user = getUser();
  const key = [subjectId, semester ?? '', version].join('|');
  if (state.key !== key) {
    // The note of a decision stays only where the page went right after it (keptDone): not on another half of the year.
    Object.assign(state, { key, errorKey: null, errorCode: null, actionError: null, checks: null, done: keptDone(state.done, key) });
    forgetUploadNote();
  }
  if (state.shownKey !== key && state.loadingKey !== key && state.errorKey === null) load(state, subjectId, semester, version);

  root.append(backLink(user), body(user, key));
  if (state.view && state.submitAsk) showModal(root, submitDialog(state.submitAsk));
  if (state.view && state.approveAsk) showModal(root, approveDialog(state.approveAsk));
  renderUpload(root);
}

function body(user, key) {
  if (state.errorKey) return failure();
  if (!state.view) return el('p', { class: 'loading' }, t('common.loading'));
  // Another group, semester or version (or the page after a decision) is on its way: the page shown stays, dimmed, until it comes.
  const stale = state.shownKey !== key;
  return el('div', { class: 'syllabus' + (stale ? ' is-stale' : ''), 'aria-busy': stale ? 'true' : null }, page(state.view, user));
}

// After a decision the page is read again; the old one stays on screen until the new one comes.
function reload() {
  state.shownKey = null;
  refresh();
}

async function load(owner, subjectId, semester, version) {
  const ticket = ++owner.ticket;
  const key = owner.key;
  owner.loadingKey = key;
  const data = { subjectId };
  if (semester !== null) data.semester = semester;
  if (version === 'open') data.version = 'open';
  try {
    const view = await call('syllabus.get', data);
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { view, shownKey: key, errorKey: null, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    // The view kept is no longer known to be current: going back to its address reads it again.
    Object.assign(owner, { errorKey: FINAL_ERRORS[error.code] ?? errorKey(error.code), errorCode: error.code, shownKey: null });
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loadingKey = null;
  }
  refresh();
}

// The deanery goes back to its «Предметы»; the teacher and the student to their home, where their subjects are.
function backLink(user) {
  const office = user.kind !== 'student' && menuParts(activeRole(user)).includes('office');
  return el('a', { class: 'back-link', href: office ? '#/subjects' : '#/' }, icon('chevron'), t(office ? 'syllabus.back.office' : 'common.toHome'));
}

function failure() {
  const final = Object.prototype.hasOwnProperty.call(FINAL_ERRORS, state.errorCode);
  const body = emptyState('alert',
    el('p', {}, t(state.errorKey)),
    final
      ? null
      : el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorKey = null; refresh(); } }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// The addresses of the two versions of the half of the year shown.
const approvedHref = (view) => `#/syllabus/${view.subject.id}/${view.semester}`;
const openHref = (view) => approvedHref(view) + '/draft';

const dayText = (date) => {
  if (!isDate(date)) return '';
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
};

// ---- The page ----

function page(view, user) {
  const staff = user.kind !== 'student';
  const { syllabus } = view;
  return [
    head(view),
    staff ? versionBar(view) : null,
    state.done ? note('success', t(state.done.key), { role: 'status', class: 'syllabus-done' }) : null,
    staff ? checksPanel(view) : null,
    staff ? remark(view) : null,
    switches(view),
    view.hidden ? hiddenState() : syllabus === null ? noSyllabus(view, user) : sections(view),
  ];
}

// The title, and for the staff the file on its right.
function head(view) {
  const { subject } = view;
  return el('header', { class: 'syllabus-head' },
    el('div', { class: 'syllabus-head__text' },
      el('p', { class: 'syllabus-head__kicker' }, t('syllabus.title')),
      el('h1', { class: 'page-title', id: 'syllabus-title' }, subject.name),
      subject.groupName || subject.teacherName ? el('p', { class: 'syllabus-head__who' },
        subject.groupName ? badge(subject.groupName, 'primary') : null,
        subject.teacherName ? el('span', { class: 'syllabus-head__teacher' }, icon('briefcase'), subject.teacherName) : null) : null),
    uploadControls(view));
}

// ---- The bar of the version: its status, the other version, the buttons ----

// One button is the main one: «Утвердить» where the deanery decides, otherwise the first of the person's buttons.
const ACTION_BUTTONS = {
  fill: { label: 'sform.fill', icon: 'pencil', id: 'syllabus-form-open' },
  continue: { label: 'sform.continue', icon: 'pencil', id: 'syllabus-form-open' },
  edit: { label: 'sform.change', icon: 'pencil', id: 'syllabus-form-open' },
  submit: { label: 'sform.submit', icon: 'checkCircle', id: 'syllabus-submit' },
  approve: { label: 'syllabus.action.approve', icon: 'check', id: 'syllabus-approve' },
  giveBack: { label: 'syllabus.action.giveBack', icon: 'pencil', id: 'syllabus-give-back' },
};

function versionBar(view) {
  const line = versionLine(view);
  const actions = pageActions(view);
  const shown = actions.filter((action) => ACTION_BUTTONS[action]);
  const main = shown.includes('approve') ? 'approve' : shown[0];
  const buttons = shown.map((action) => actionButton(view, action, action === main));
  const toggle = actions.includes('showOpen') || actions.includes('showApproved') ? versionSwitch(view) : null;
  return el('section', { class: 'version-bar', 'data-tone': line.tone, 'aria-labelledby': 'syllabus-status', id: 'syllabus-version' },
    el('p', { class: 'version-bar__status' },
      el('span', { class: 'version-bar__dot', 'aria-hidden': 'true' }),
      el('span', { class: 'version-bar__text', id: 'syllabus-status' }, t(line.key, line.params))),
    toggle,
    buttons.length > 0 ? el('div', { class: 'version-bar__actions' }, buttons) : null,
    state.actionError ? note('error', t(state.actionError), { role: 'alert', class: 'version-bar__error' }) : null);
}

// «Утверждённая / Новая версия»: two addresses of the same half of the year; the new one says where it stands.
function versionSwitch(view) {
  const { open } = view.state;
  const current = view.shown;
  return el('nav', { class: 'segmented version-switch', 'aria-label': t('syllabus.version.switch') },
    el('a', { class: 'segmented__button', id: 'syllabus-show-approved', href: approvedHref(view), 'aria-current': current === 'approved' ? 'page' : null },
      t('syllabus.version.approved')),
    el('a', { class: 'segmented__button', id: 'syllabus-show-open', href: openHref(view), 'aria-current': current === 'open' ? 'page' : null },
      t('syllabus.version.open'),
      open ? el('span', { class: 'version-switch__status', 'data-status': open.status }, t('syllabus.status.' + open.status)) : null));
}

function actionButton(view, action, main) {
  const spec = ACTION_BUTTONS[action];
  const handlers = {
    fill: () => openForm(view), continue: () => openForm(view), edit: () => openForm(view),
    submit: () => checkBeforeSubmit(view),
    approve: () => { state.approveAsk = { errors: null, errorKey: null }; state.actionError = null; refresh(); },
    giveBack: () => openReturnDialog(view.state.open.syllabusId, () => {
      if (state.view !== view) return;
      Object.assign(state, { done: { key: 'syllabus.return.done', at: state.key }, checks: null });
      refreshReviewCount();
      reload();
    }),
  };
  const button = el('button', { type: 'button', id: spec.id, class: 'button button--' + (main ? 'primary' : 'secondary'), onclick: handlers[action] }, icon(spec.icon), t(spec.label));
  if (state.starting && spec.id === 'syllabus-form-open') markBusy(button, 'sform.opening');
  if (state.busy === 'check' && action === 'submit') markBusy(button, 'sform.submit.checking');
  return button;
}

async function openForm(view) {
  if (state.starting) return;
  const owner = state;
  Object.assign(owner, { starting: true, actionError: null });
  refresh();
  try {
    const { syllabusId } = await call('syllabus.startDraft', { subjectId: view.subject.id, semester: view.semester });
    if (state !== owner) return;
    owner.starting = false;
    location.hash = '#/syllabus-form/' + syllabusId;
  } catch (error) {
    if (state !== owner) return;
    Object.assign(owner, { starting: false, actionError: errorKey(error.code) });
    refresh();
  }
}

// A returned version: what the deanery wants changed, as it was written (line breaks kept), on both versions of
// the page: this is where its teacher learns it.
function remark(view) {
  const { open } = view.state;
  if (!open || open.status !== 'returned' || !filled(open.remark)) return null;
  return el('section', { class: 'sform-remark syllabus-remark', 'aria-labelledby': 'syllabus-remark-title' },
    el('span', { class: 'sform-remark__icon', 'aria-hidden': 'true' }, icon('pencil')),
    el('div', { class: 'sform-remark__body' },
      el('h2', { class: 'sform-remark__title', id: 'syllabus-remark-title' }, t('sform.remark.title')),
      el('p', { class: 'sform-remark__text' }, open.remark)));
}

// ---- Sending for approval (as in the form: the check first) ----

async function checkBeforeSubmit(view) {
  if (state.busy) return;
  const owner = state;
  Object.assign(owner, { busy: 'check', actionError: null, done: null });
  refresh();
  try {
    const result = await call('syllabus.submit', { syllabusId: view.state.open.syllabusId, dryRun: true });
    if (state !== owner) return;
    if (submitOutcome(result) === 'checks') owner.checks = result.checks;
    else Object.assign(owner, { checks: null, submitAsk: { warnings: (result.checks && result.checks.warnings) || [] } });
  } catch (error) {
    if (state !== owner) return;
    owner.actionError = errorKey(error.code);
  } finally {
    if (state === owner) owner.busy = null;
  }
  refresh();
  if (owner.checks) focusById('syllabus-checks-title');
}

async function send() {
  if (state.busy) return;
  const owner = state;
  const view = owner.view;
  owner.busy = 'send';
  refresh();
  try {
    const result = await call('syllabus.submit', { syllabusId: view.state.open.syllabusId });
    if (state !== owner) return;
    const outcome = submitOutcome(result);
    Object.assign(owner, {
      submitAsk: null, busy: null,
      checks: outcome === 'checks' ? result.checks : null,
      actionError: outcome === 'failed' ? 'sform.submit.notSent' : null,
      done: outcome === 'sent' ? { key: 'syllabus.submit.done', at: owner.key } : null,
    });
    if (outcome === 'sent') {
      refreshReviewCount();
      reload();
      return;
    }
  } catch (error) {
    if (state !== owner) return;
    Object.assign(owner, { submitAsk: null, actionError: errorKey(error.code) });
  } finally {
    if (state === owner) owner.busy = null;
  }
  refresh();
  if (owner.checks) focusById('syllabus-checks-title');
}

function submitDialog({ warnings }) {
  const empty = [...new Set(warnings.map((item) => item.section))].filter((tab) => TABS.includes(tab)).map((tab) => t('sform.tab.' + tab));
  const close = () => {
    if (state.busy) return;
    state.submitAsk = null;
    refresh();
    focusById('syllabus-submit');
  };
  const go = el('button', { type: 'button', id: 'syllabus-send', class: 'button button--primary', onclick: send },
    icon('checkCircle'), t(empty.length > 0 ? 'sform.submit.anyway' : 'sform.submit.go'));
  if (state.busy === 'send') markBusy(go, 'sform.submit.sending');
  const dialog = modal({ id: 'syllabus-submit-ask', labelledBy: 'syllabus-submit-title', className: 'dialog--confirm', onClose: close, canCancel: () => !state.busy },
    el('h2', { class: 'dialog__title', id: 'syllabus-submit-title' }, t('sform.submit.title')),
    empty.length > 0 ? el('p', { class: 'sform-submit__empty' }, icon('alert'), el('span', {}, t('sform.submit.empty', { tabs: empty.join(', ') }))) : null,
    el('p', {}, t('sform.submit.text')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', autofocus: true, onclick: () => dialog.close() }, t('common.cancel')),
      go));
  return dialog;
}

// What a check found, each line a link to its tab of the form (the version can be changed only there).
function checkText(item) {
  const { key, params } = checkLine(item);
  return t(hasText(key) ? key : 'sform.checks.other', { ...params, date: dayText(params.date) });
}

function checkList(items, syllabusId, tone) {
  return el('ul', { class: 'sform-checks__list' }, items.map((item) => {
    const tab = TABS.includes(item.section) ? item.section : 'title';
    return el('li', { class: 'sform-check is-' + tone },
      el('a', { class: 'sform-check__link', href: `#/syllabus-form/${syllabusId}/${tab}` },
        el('span', { class: 'sform-check__tab' }, t('sform.tab.' + tab)),
        el('span', { class: 'sform-check__text' }, checkText(item)),
        icon('chevron', 'sform-check__go')));
  }));
}

function checksPanel(view) {
  if (!state.checks || !view.state.open) return null;
  const { errors, warnings } = state.checks;
  const id = view.state.open.syllabusId;
  return el('section', { class: 'sform-checks', 'aria-labelledby': 'syllabus-checks-title' },
    el('div', { class: 'sform-checks__head' },
      el('h2', { class: 'sform-checks__title', id: 'syllabus-checks-title', tabindex: '-1' },
        icon('alert', 'sform-checks__icon'), el('span', {}, t('sform.checks.title')), el('span', { class: 'sform-checks__count' }, String(errors.length))),
      el('p', { class: 'sform-checks__lead' }, t('sform.checks.lead'))),
    checkList(errors, id, 'error'),
    warnings.length > 0 ? el('h3', { class: 'sform-checks__sub' }, t('sform.checks.warnings')) : null,
    warnings.length > 0 ? checkList(warnings, id, 'warning') : null);
}

// ---- «Утвердить» ----

async function approve() {
  if (state.busy) return;
  const owner = state;
  const view = owner.view;
  Object.assign(owner, { busy: 'approve' });
  owner.approveAsk = { errors: null, errorKey: null };
  refresh();
  try {
    const result = await call('syllabus.approve', { syllabusId: view.state.open.syllabusId });
    if (state !== owner) return;
    owner.busy = null;
    if (result.approved === true) {
      // The version approved is the one the approved address shows now: the note goes there with the page.
      const at = view.shown === 'open' ? [view.subject.id, view.semester, 'approved'].join('|') : owner.key;
      Object.assign(owner, { approveAsk: null, done: { key: 'syllabus.approve.done', at }, checks: null });
      refreshReviewCount();
      if (view.shown === 'open') location.hash = approvedHref(view);
      else reload();
      return;
    }
    owner.approveAsk = { errors: (result.checks && result.checks.errors) || [], errorKey: null };
  } catch (error) {
    if (state !== owner) return;
    owner.approveAsk = { errors: null, errorKey: FINAL_ERRORS[error.code] ?? errorKey(error.code) };
  } finally {
    if (state === owner) owner.busy = null;
  }
  refresh();
  focusById('syllabus-approve-close', 'syllabus-approve-go');
}

// The question before the version takes effect; when the server finds what stops it, the list of it, as in the form.
function approveDialog(ask) {
  const id = state.view.state.open ? state.view.state.open.syllabusId : '';
  const blocked = Array.isArray(ask.errors) && ask.errors.length > 0;
  const close = () => {
    if (state.busy) return;
    state.approveAsk = null;
    refresh();
    focusById('syllabus-approve', 'syllabus-status');
  };
  const go = blocked ? null : el('button', { type: 'button', id: 'syllabus-approve-go', class: 'button button--primary', onclick: approve },
    icon('check'), t('syllabus.approve.go'));
  if (go && state.busy === 'approve') markBusy(go, 'syllabus.approve.busy');
  const dialog = modal({ id: 'syllabus-approve-ask', labelledBy: 'syllabus-approve-title', className: 'dialog--confirm dialog--approve', onClose: close, canCancel: () => !state.busy },
    el('h2', { class: 'dialog__title', id: 'syllabus-approve-title' }, t('syllabus.approve.title')),
    el('p', {}, t('syllabus.approve.text')),
    blocked ? el('div', { class: 'approve-checks', role: 'alert' },
      el('p', { class: 'approve-checks__lead' }, icon('alert'), el('span', {}, t('syllabus.approve.failed'))),
      checkList(ask.errors, id, 'error'),
      el('p', { class: 'approve-checks__hint' }, t('syllabus.approve.fixHint'))) : null,
    ask.errorKey ? note('error', t(ask.errorKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: 'syllabus-approve-close', class: 'button button--secondary', autofocus: !blocked ? true : null, onclick: () => dialog.close() },
        t(blocked ? 'common.close' : 'common.cancel')),
      go));
  return dialog;
}

// ---- «Вернуть с замечаниями»: a window of its own, opened here and from «Силлабусы на утверждении» ----

// The window lives on the document, not on the screen: the screens under it are drawn again freely. It goes away
// when the person leaves the address. onDone(): after the version is returned.
export function openReturnDialog(syllabusId, onDone) {
  document.getElementById('syllabus-return')?.remove();
  let busy = false;
  const max = REMARK_MAX;
  const area = el('textarea', {
    id: 'syllabus-return-text', name: 'remark', class: 'field__input field__textarea', rows: '7', maxlength: String(max),
    'aria-describedby': 'syllabus-return-hint syllabus-return-count', 'aria-required': 'true',
  });
  const count = el('span', { class: 'return-count', id: 'syllabus-return-count', 'aria-live': 'polite' }, t('syllabus.return.count', { n: 0, max }));
  const fieldError = el('p', { class: 'field__error', id: 'syllabus-return-error', hidden: true });
  const problem = el('div', { class: 'return-failure' });
  const showFieldError = (key) => {
    fieldError.replaceChildren(icon('alert'), t(key));
    fieldError.hidden = false;
    area.setAttribute('aria-invalid', 'true');
    area.setAttribute('aria-describedby', 'syllabus-return-hint syllabus-return-count syllabus-return-error');
    area.focus();
  };
  area.addEventListener('input', () => {
    count.textContent = t('syllabus.return.count', { n: area.value.length, max });
    if (!fieldError.hidden) {
      fieldError.hidden = true;
      area.removeAttribute('aria-invalid');
      area.setAttribute('aria-describedby', 'syllabus-return-hint syllabus-return-count');
    }
  });
  const go = el('button', { type: 'button', id: 'syllabus-return-go', class: 'button button--primary' }, icon('pencil'), t('syllabus.return.go'));
  const idle = () => {
    busy = false;
    go.classList.remove('is-busy');
    go.removeAttribute('aria-disabled');
    go.removeAttribute('aria-busy');
    go.replaceChildren(icon('pencil'), t('syllabus.return.go'));
  };
  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'syllabus-return', labelledBy: 'syllabus-return-title', className: 'dialog--return',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
    },
    canCancel: () => !busy,
  },
  el('h2', { class: 'dialog__title', id: 'syllabus-return-title' }, t('syllabus.return.title')),
  el('p', { class: 'return-lead' }, t('syllabus.return.lead')),
  el('div', { class: 'field' },
    el('label', { class: 'field__label', for: 'syllabus-return-text' }, t('syllabus.return.label')),
    el('p', { class: 'field__hint', id: 'syllabus-return-hint' }, t('syllabus.return.hint')),
    el('div', { class: 'field__control' }, area),
    el('div', { class: 'return-under' }, fieldError, count)),
  problem,
  el('div', { class: 'dialog__actions' },
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
    go));
  go.addEventListener('click', async () => {
    if (busy) return;
    problem.replaceChildren();
    const remarkText = area.value.trim();
    if (remarkText === '') return showFieldError('syllabus.return.required');
    if (remarkText.length > max) return showFieldError('syllabus.return.tooLong');
    busy = true;
    markBusy(go, 'syllabus.return.busy');
    try {
      await call('syllabus.return', { syllabusId, remark: area.value });
      busy = false;
      dialog.close();
      onDone();
    } catch (error) {
      if (!dialog.isConnected) return;
      idle();
      const field = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields.find((f) => f.field === 'remark') : null;
      if (field) showFieldError(field.code === 'too_long' ? 'syllabus.return.tooLong' : 'syllabus.return.required');
      else problem.replaceChildren(note('error', t(FINAL_ERRORS[error.code] ?? errorKey(error.code)), { role: 'alert' }));
    }
  });
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  area.focus();
}

// ---- What the page shows instead of a syllabus ----

// A student while the new version is under review: the approved one is not shown either.
function hiddenState() {
  return emptyState('clock',
    el('p', { class: 'empty__title' }, t('syllabus.hidden')),
    el('p', {}, t('syllabus.hiddenHint')));
}

// No syllabus: who should do something about it. On the address of the new version: there is none, the way back.
function noSyllabus(view, user) {
  if (view.shown === 'open') {
    return emptyState('book',
      el('p', { class: 'empty__title' }, t('syllabus.noOpen')),
      view.state.approved ? el('a', { class: 'button button--secondary', href: approvedHref(view) }, t('syllabus.toApproved')) : null);
  }
  // Nothing approved yet, but a new version the person may see: the way to it.
  if (view.state && view.state.open) {
    return emptyState('book',
      el('p', { class: 'empty__title' }, t('syllabus.state.none')),
      el('a', { class: 'button button--secondary', id: 'syllabus-to-open', href: openHref(view) }, t('syllabus.toOpen')));
  }
  let hint = null;
  if (user.kind === 'student') hint = 'syllabus.emptyHint.student';
  else if (view.can && (view.can.fill || view.can.edit)) hint = 'syllabus.emptyHint.staff';
  return emptyState('book',
    el('p', { class: 'empty__title' }, t('syllabus.none')),
    hint ? el('p', {}, t(hint)) : null);
}

// The group (when the teacher has the discipline in several) and the semester of the year (when both have a syllabus).
function switches(view) {
  const draft = view.shown === 'open' ? '/draft' : '';
  const groups = view.groups.length > 1 ? el('div', { class: 'syllabus-switch' },
    el('nav', { class: 'segmented syllabus-switch__links', 'aria-label': t('field.groupId'), 'aria-describedby': 'syllabus-groups-hint' },
      view.groups.map((group) => el('a', {
        id: 'syllabus-group-' + group.subjectId,
        class: 'segmented__button',
        href: '#/syllabus/' + group.subjectId + '/' + view.semester + draft,
        'aria-current': group.subjectId === view.subject.id ? 'page' : null,
      }, group.groupName))),
    el('p', { class: 'syllabus-switch__hint', id: 'syllabus-groups-hint' }, t('syllabus.groups'))) : null;
  const semesters = view.semesters.length === 2 ? el('div', { class: 'syllabus-switch' },
    el('nav', { class: 'segmented syllabus-switch__links', 'aria-label': t('syllabus.semesterSwitch') },
      view.semesters.map(({ semester: n }) => el('a', {
        id: 'syllabus-semester-' + n,
        class: 'segmented__button semester-tab',
        href: '#/syllabus/' + view.subject.id + '/' + n,
        'aria-current': n === view.semester ? 'page' : null,
      },
      el('span', { class: 'semester-tab__name' }, t('syllabus.semesterN', { n })),
      n === view.currentSemester ? el('span', { class: 'semester-tab__now' }, t('syllabus.semesterNow')) : null)))) : null;
  return groups || semesters ? el('div', { class: 'syllabus-switches' }, groups, semesters) : null;
}

// ---- The document: the list of sections, then each that has something in it ----

const SECTIONS = [
  ['title', 'syllabus.sec.title', titleSection],
  ['goals', 'syllabus.sec.goals', goalsSection],
  ['plan', 'syllabus.plan', planSection],
  ['units', 'syllabus.sec.units', unitsSection],
  ['selfWork', 'syllabus.sec.selfWork', selfWorkSection],
  ['literature', 'syllabus.sec.literature', literatureSection],
  ['software', 'syllabus.sec.software', softwareSection],
  ['policies', 'syllabus.sec.policies', policiesSection],
];

const sectionId = (name) => 'syllabus-sec-' + name;

function sections(view) {
  const built = SECTIONS.map(([name, titleKey, make]) => ({ name, titleKey, body: make(view) })).filter((section) => section.body !== null);
  return [
    view.shown === 'open' ? note('info', t('syllabus.openNote'), { class: 'syllabus-open-note' }) : null,
    built.length > 1 ? contents(built) : null,
    built.map(({ name, titleKey, body }) => el('section', { class: 'card syllabus-sec syllabus-sec--' + name + (name === 'plan' ? ' syllabus-plan' : ''), id: sectionId(name), 'aria-labelledby': sectionId(name) + '-title' },
      el('h2', { class: 'syllabus-card__title', id: sectionId(name) + '-title', tabindex: '-1' }, t(titleKey)),
      body)),
  ];
}

// «Разделы»: a button for each section shown; it scrolls to the section and puts focus on its title. (The address
// is the screen, so the sections are not links.)
function contents(sections) {
  return el('nav', { class: 'syllabus-toc', 'aria-label': t('syllabus.toc') },
    el('p', { class: 'syllabus-toc__title' }, t('syllabus.toc')),
    el('ol', { class: 'syllabus-toc__list' }, sections.map(({ name, titleKey }) => el('li', {},
      el('button', {
        type: 'button', class: 'syllabus-toc__link', id: 'syllabus-toc-' + name,
        onclick: () => {
          const target = document.getElementById(sectionId(name) + '-title');
          if (!target) return;
          target.focus({ preventScroll: true });
          target.closest('section')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        },
      }, t(titleKey))))));
}

// A list of «label — value» lines; the empty ones are left out. pre: the value keeps its line breaks.
function factList(facts) {
  const shown = facts.filter(([, value]) => present(value));
  if (shown.length === 0) return null;
  return el('dl', { class: 'facts' }, shown.map(([label, value, pre]) => el('div', { class: 'fact' + (pre ? ' fact--wide' : '') },
    el('dt', { class: 'fact__label' }, t(label)),
    el('dd', { class: 'fact__value' + (pre ? ' is-pre' : '') }, String(value)))));
}

// «Титул»: the facts of the title page of the version.
function titleSection(view) {
  const { subject, syllabus } = view;
  const title = syllabus.title || {};
  const course = present(title.course) ? title.course : subject.course;
  const semester = present(title.planSemester) ? title.planSemester : syllabus.planSemester;
  let courseText = null;
  if (present(course) && present(semester)) courseText = t('syllabus.info.courseValue', { course, semester });
  else if (present(semester)) courseText = t('syllabus.semesterN', { n: semester });
  const pick = (name) => (present(title[name]) ? title[name] : syllabus[name]);
  const volume = [
    present(pick('credits')) ? t('syllabus.info.credits', { n: pick('credits') }) : null,
    present(pick('totalHours')) ? t('syllabus.info.hours', { n: pick('totalHours') }) : null,
  ].filter(Boolean).join(', ');
  const split = present(pick('classHours')) || present(pick('selfHours'))
    ? t('syllabus.info.splitValue', { classHours: present(pick('classHours')) ? pick('classHours') : '—', selfHours: present(pick('selfHours')) ? pick('selfHours') : '—' }) : null;
  return factList([
    ['sform.field.department', title.department],
    ['sform.field.faculty', title.faculty],
    ['syllabus.info.year', title.academicYear],
    ['syllabus.info.course', courseText],
    ['syllabus.info.groups', view.groups.map((group) => group.groupName).filter(Boolean).join(', ')],
    ['syllabus.info.audience', pick('audience')],
    ['syllabus.info.volume', volume],
    ['syllabus.info.split', split],
    ['syllabus.info.teacher', subject.teacherName],
    ['sform.field.contacts', title.contacts, true],
    ['sform.field.place', title.place],
  ]);
}

// A titled list of points; nothing when it is empty.
function pointBlock(titleKey, items, ordered = false) {
  const points = (Array.isArray(items) ? items : []).filter(filled);
  if (points.length === 0) return null;
  return el('div', { class: 'syl-points' },
    el('h3', { class: 'syl-points__title' }, t(titleKey)),
    el(ordered ? 'ol' : 'ul', { class: 'syl-points__list' }, points.map((point) => el('li', {}, point))));
}

// «Цель и результаты»: the aim, then the outcomes (knowledge, skills, attitudes), then the links with other subjects.
function goalsSection(view) {
  const goals = view.syllabus.goals || {};
  const outcomes = ['knowledge', 'skill', 'attitude'].map((kind) => pointBlock('sform.list.' + kind, goals[kind])).filter(Boolean);
  const links = ['prerequisite', 'postrequisite'].map((kind) => pointBlock('sform.list.' + kind, goals[kind])).filter(Boolean);
  if (!filled(goals.goal) && outcomes.length === 0 && links.length === 0) return null;
  return el('div', { class: 'syllabus-sec__body' },
    filled(goals.goal) ? el('div', { class: 'goal' },
      el('h3', { class: 'goal__title' }, t('sform.goal')),
      el('p', { class: 'goal__text' }, goals.goal)) : null,
    outcomes.length > 0 ? el('div', { class: 'outcomes' },
      el('h3', { class: 'outcomes__title' }, t('syllabus.goals.results')),
      el('div', { class: 'outcomes__grid' }, outcomes)) : null,
    links.length > 0 ? el('div', { class: 'outcomes' },
      el('h3', { class: 'outcomes__title' }, t('syllabus.goals.links')),
      el('div', { class: 'outcomes__grid' }, links)) : null);
}

// ---- «Тематический план»: one table in the order of the pairs, unit by unit ----

const dated = (view) => view.syllabus.schedule !== null && view.syllabus.schedule.pairs > 0;
const PRACTICAL = ['practice', 'seminar', 'lab'];

// A param named in counts is a number of something and is written with its word («18 пар»).
function notes(view) {
  return el('div', { class: 'notes syllabus-notes' }, scheduleNotes(view).map(({ tone, key, params, counts = {} }) => note(tone, t(key, params && Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, counts[name] ? tCount(counts[name], value) : value]))))));
}

function planSection(view) {
  const { rows, totals } = view.syllabus;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const self = hasSelfHours(rows);
  const groups = unitGroups(rows);
  const unitTitles = new Map(((view.syllabus.units && view.syllabus.units.units) || []).map((unit) => [unit.unit, unit.title]));
  const columns = [
    ['syllabus.col.topic', 'plan-table__topic'],
    ['syllabus.col.kind', 'plan-table__kind'],
    ['syllabus.col.hours', 'num'],
    self ? ['syllabus.col.self', 'num'] : null,
    ['syllabus.col.pairs', 'plan-table__pairs'],
  ].filter(Boolean);
  // A unit has a head when the plan has several, or when it has a title: «Юнит 1. Техническое и программное обеспечение».
  const bodies = groups.map((group) => {
    const title = group.title || unitTitles.get(group.unit) || '';
    return el('tbody', { class: 'plan-unit' },
      groups.length > 1 || title ? el('tr', { class: 'plan-unit__head' },
        el('th', { scope: 'rowgroup', colspan: String(columns.length), class: title ? 'has-title' : null },
          title ? t('syllabus.unitTitled', { n: group.unit, title }) : t('syllabus.unitN', { n: group.unit }))) : null,
      group.rows.map((row) => planRow(row, view, self)));
  });
  return [
    view.shown === 'approved' ? notes(view) : null,
    el('div', { class: 'table-scroll' },
      el('table', { class: 'table plan-table', 'aria-labelledby': sectionId('plan') + '-title' },
        el('thead', {}, el('tr', {}, columns.map(([key, className]) => el('th', { scope: 'col', class: className }, t(key))))),
        bodies,
        el('tfoot', {}, el('tr', { class: 'plan-total' },
          el('th', { scope: 'row', class: 'plan-table__topic' },
            el('span', { class: 'plan-row__name' }, t('syllabus.total')),
            hoursSummary(null, totals.hours, self ? totals.selfHours : null)),
          el('td', { class: 'plan-table__kind' }),
          el('td', { class: 'num' }, hours(totals.hours)),
          self ? el('td', { class: 'num' }, hours(totals.selfHours)) : null,
          el('td', { class: 'plan-table__pairs' }, el('span', { class: 'plan-total__pairs' }, tCount('syllabus.pairsCount', totals.pairs))))))),
  ];
}

// «Л1» in the colour of its kind, then the name; a module without a name is «Модуль N (рубежный контроль)».
function lessonTitle(row) {
  const text = topicText(row);
  return el('span', { class: 'plan-row__title' },
    text.label ? el('span', { class: 'lesson-no', 'data-kind': row.lessonKind }, t(text.label.key) + text.label.number) : null,
    el('span', { class: 'plan-row__name' }, text.label ? row.name : t(text.key, text.params)));
}

function planRow(row, view, self) {
  const control = row.lessonKind === 'control';
  const type = t(lessonTypeKey(row));
  return el('tr', { class: 'plan-row' + (control ? ' is-control' : ''), 'data-kind': row.lessonKind },
    el('td', { class: 'plan-table__topic' },
      lessonTitle(row),
      PRACTICAL.includes(row.lessonKind) && filled(row.controlForms)
        ? el('span', { class: 'plan-row__forms' }, t('syllabus.controlForms', { forms: row.controlForms })) : null,
      hoursSummary(type, row.hours, self ? row.selfHours : null)),
    el('td', { class: 'plan-table__kind' }, el('span', { class: 'plan-row__kind' }, type)),
    el('td', { class: 'num' }, hours(row.hours)),
    self ? el('td', { class: 'num' }, hours(row.selfHours)) : null,
    el('td', { class: 'plan-table__pairs' }, pairDates(row, view)));
}

// A number of hours in its column; none — a quiet dash.
function hours(n) {
  return typeof n === 'number' && n > 0 ? String(n) : el('span', { class: 'plan-none' }, '—');
}

// «Семинар · 2 ч · СРС 2 ч»: the kind and the hours of a row where the columns are not shown (a narrow screen).
// A line breaks only between the pieces, never inside «СРС 2 ч».
function hoursSummary(type, n, self) {
  const parts = [
    type,
    typeof n === 'number' && n > 0 ? t('syllabus.info.hours', { n }) : null,
    typeof self === 'number' && self > 0 ? t('syllabus.hoursOf', { type: t('syllabus.self'), n: self }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return el('span', { class: 'plan-row__summary' },
    parts.map((part, i) => [i > 0 ? ' · ' : null, el('span', { class: 'plan-row__hours' }, part)]));
}

// The dates of the group's pairs on the row, each with the letter of its type; a held pair carries a tick. Where
// the semester has no dates yet (or the version is not on the pairs), the number of pairs the row takes.
function pairDates(row, view) {
  const control = row.lessonKind === 'control';
  const pairs = Array.isArray(row.pairs) ? row.pairs : [];
  const missing = view.shown === 'approved' ? undated(row, dated(view)) : 0;
  if (pairs.length === 0 && missing === 0) {
    return row.planned > 0
      ? el('span', { class: 'plan-row__planned' }, tCount('syllabus.pairsCount', row.planned))
      : el('span', { class: 'plan-none' }, '—');
  }
  return el('ul', { class: 'dates' },
    pairs.map((pair) => {
      const type = control ? 'control' : pair.lessonType;
      const held = pair.status === 'closed';
      return el('li', { class: 'date' + (held ? ' is-held' : ''), 'data-type': LESSON_TYPES.includes(type) ? type : null },
        LESSON_TYPES.includes(type) ? el('abbr', { class: 'date__type', title: t('lessonType.' + type) }, t('lessonType.short.' + type)) : null,
        el('span', { class: 'date__day' }, shortDate(pair.date)),
        held ? [icon('checkCircle', 'date__held'), el('span', { class: 'visually-hidden' }, ', ' + t('syllabus.held'))] : null);
    }),
    missing > 0 ? el('li', { class: 'date is-missing' }, tCount('syllabus.undated', missing)) : null);
}

// ---- «Описание юнитов»: what each unit is about, its key questions, guidance, outcomes, books, described topics ----

function unitsSection(view) {
  const units = (view.syllabus.units && view.syllabus.units.units) || [];
  const described = describedRows(view.syllabus.rows || []);
  const numbers = [...new Set([...units.map((unit) => unit.unit), ...described.map((row) => row.unit)])].sort((a, b) => a - b);
  const cards = numbers.map((n) => unitCard(units.find((unit) => unit.unit === n) || { unit: n, title: '' }, described.filter((row) => row.unit === n))).filter(Boolean);
  return cards.length > 0 ? el('div', { class: 'unit-cards' }, cards) : null;
}

function unitCard(unit, described) {
  const questions = linesOf(unit.questions);
  const books = (unit.literature || []).filter(bookFilled);
  const has = filled(unit.description) || questions.length > 0 || filled(unit.guidance) || filled(unit.results) || books.length > 0 || described.length > 0;
  if (!has) return null;
  const textBlock = (key, text) => (filled(text) ? el('div', { class: 'unit-card__block' },
    el('h4', { class: 'unit-card__label' }, t(key)),
    el('p', { class: 'unit-card__text' }, text)) : null);
  return el('article', { class: 'unit-card' },
    el('h3', { class: 'unit-card__title' },
      el('span', { class: 'unit-card__no' }, t('syllabus.unitN', { n: unit.unit })),
      filled(unit.title) ? el('span', { class: 'unit-card__name' }, unit.title) : null),
    filled(unit.description) ? el('p', { class: 'unit-card__lead' }, unit.description) : null,
    questions.length > 0 ? el('div', { class: 'unit-card__block' },
      el('h4', { class: 'unit-card__label' }, t('sform.units.questions')),
      el('ol', { class: 'unit-card__questions' }, questions.map((question) => el('li', {}, question)))) : null,
    textBlock('sform.units.guidance', unit.guidance),
    textBlock('sform.units.results', unit.results),
    books.length > 0 ? el('div', { class: 'unit-card__block' },
      el('h4', { class: 'unit-card__label' }, t('sform.units.literature')),
      bookList(books)) : null,
    described.length > 0 ? el('div', { class: 'unit-card__block' },
      el('h4', { class: 'unit-card__label' }, t('syllabus.descriptions')),
      el('dl', { class: 'about' }, described.map((row) => el('div', { class: 'about__item' },
        el('dt', { class: 'about__topic' }, lessonTitle(row)),
        el('dd', { class: 'about__text' }, row.description))))) : null);
}

// ---- «СРС» ----

function selfWorkSection(view) {
  const items = ((view.syllabus.selfWork && view.syllabus.selfWork.items) || []).filter((item) => filled(item.name) || filled(item.tasks) || present(item.hours));
  if (items.length === 0) return null;
  return el('ol', { class: 'self-works' }, items.map((item, i) => {
    const tasks = linesOf(item.tasks);
    return el('li', { class: 'self-work' },
      el('div', { class: 'self-work__head' },
        el('h3', { class: 'self-work__name' }, filled(item.name) ? item.name : t('sform.self.item', { n: i + 1 })),
        el('p', { class: 'self-work__meta' },
          badge(present(item.unit) ? t('syllabus.self.unit', { n: item.unit }) : t('sform.self.wholeCourse'), 'neutral'),
          present(item.hours) ? badge(t('syllabus.info.hours', { n: item.hours }), 'primary') : null)),
      tasks.length > 0 ? el('ul', { class: 'self-work__tasks' }, tasks.map((task) => el('li', {}, task))) : null);
  }));
}

// ---- «Литература» ----

const bookFilled = (book) => book && ['authors', 'title', 'year', 'publisher', 'availability'].some((key) => filled(String(book[key] ?? '')));

// A book as a library card writes it: the authors, the title, then the publisher and the year; whether the library has it.
function bookList(books) {
  return el('ul', { class: 'books' }, books.map((book) => {
    const imprint = [book.publisher, book.year].map((part) => String(part ?? '').trim()).filter(Boolean).join(', ');
    return el('li', { class: 'book' },
      filled(book.authors) ? el('span', { class: 'book__authors' }, book.authors) : null,
      filled(book.title) ? el('span', { class: 'book__title' }, book.title) : null,
      imprint ? el('span', { class: 'book__imprint' }, imprint) : null,
      filled(book.availability) ? el('span', { class: 'book__have' }, icon('book'), t('syllabus.book.availability', { text: book.availability })) : null);
  }));
}

function literatureSection(view) {
  const literature = view.syllabus.literature || {};
  const lists = ['main', 'extra'].map((kind) => [kind, (literature[kind] || []).filter(bookFilled)]).filter(([, books]) => books.length > 0);
  if (lists.length === 0) return null;
  return el('div', { class: 'syllabus-sec__body' }, lists.map(([kind, books]) => el('div', { class: 'books-block' },
    el('h3', { class: 'syl-points__title' }, t('sform.literature.' + kind)),
    bookList(books))));
}

// ---- «Программное обеспечение»: a link only when it is http(s) (safeLink); anything else is its text ----

function softwareSection(view) {
  const items = ((view.syllabus.software && view.syllabus.software.items) || []).filter((item) => filled(item.name) || filled(item.link));
  if (items.length === 0) return null;
  return el('ul', { class: 'software' }, items.map((item) => {
    const href = safeLink(item.link);
    return el('li', { class: 'software__item' },
      el('span', { class: 'software__name' }, filled(item.name) ? item.name : item.link),
      href ? el('a', { class: 'software__link', href, target: '_blank', rel: 'noopener noreferrer' },
        el('span', { class: 'software__url' }, href), el('span', { class: 'visually-hidden' }, ' (' + t('syllabus.software.newTab') + ')'))
        : filled(item.link) && filled(item.name) ? el('span', { class: 'software__url is-text' }, item.link) : null);
  }));
}

// ---- «Политики»: the grading scale of each kind of control, the rules of behaviour and of academic ethics ----

function policiesSection(view) {
  const policies = view.syllabus.policies || {};
  const grading = (policies.grading || []).filter((row) => Object.values(row).some((value) => present(value)));
  const behavior = ruleBlock('sform.policies.behavior', policies.behavior, policies.sanctionBehavior);
  const ethics = ruleBlock('sform.policies.ethics', policies.ethics, policies.sanctionEthics);
  if (grading.length === 0 && !behavior && !ethics) return null;
  return el('div', { class: 'syllabus-sec__body' },
    grading.length > 0 ? gradingTable(grading) : null,
    behavior || ethics ? el('div', { class: 'rules' }, behavior, ethics) : null);
}

function gradingTable(rows) {
  return el('div', { class: 'grading' },
    el('h3', { class: 'syl-points__title', id: 'syllabus-grading-title' }, t('sform.grading.title')),
    el('div', { class: 'table-scroll' },
      el('table', { class: 'table grading-table', 'aria-labelledby': 'syllabus-grading-title' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, t('sform.grading.name')),
          el('th', { scope: 'col', class: 'num' }, t('sform.grading.maxPoints')),
          GRADES.map(([grade]) => el('th', { scope: 'col', class: 'grading-table__grade', 'data-grade': grade }, t('sform.grading.grade.' + grade))))),
        el('tbody', {}, rows.map((row) => el('tr', {},
          el('th', { scope: 'row', class: 'grading-table__name' }, filled(row.name) ? row.name : '—'),
          el('td', { class: 'num grading-table__max' },
            el('span', { class: 'grade-cell__name', 'aria-hidden': 'true' }, t('sform.grading.maxPoints')),
            present(row.maxPoints) ? String(row.maxPoints) : el('span', { class: 'plan-none' }, '—')),
          GRADES.map(([grade, suffix]) => el('td', { class: 'grading-table__grade', 'data-grade': grade },
            el('span', { class: 'grade-cell__name', 'aria-hidden': 'true' }, t('sform.grading.grade.' + grade)),
            filled(row['range' + suffix]) ? el('span', { class: 'grade-cell__range' }, row['range' + suffix]) : null,
            filled(row['criteria' + suffix]) ? el('span', { class: 'grade-cell__criteria' }, row['criteria' + suffix]) : null))))))));
}

function ruleBlock(titleKey, items, sanction) {
  const rules = (Array.isArray(items) ? items : []).filter(filled);
  if (rules.length === 0 && !filled(sanction)) return null;
  return el('div', { class: 'rule-block' },
    el('h3', { class: 'syl-points__title' }, t(titleKey)),
    rules.length > 0 ? el('ol', { class: 'syl-points__list' }, rules.map((rule) => el('li', {}, rule))) : null,
    filled(sanction) ? el('p', { class: 'rule-block__sanction' }, icon('alert'), el('span', {}, t('syllabus.sanction', { text: sanction }))) : null);
}

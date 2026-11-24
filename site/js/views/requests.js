import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, focusById, markBusy, modal, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { getUser } from '../session.js';
import { activeRole, menuParts, permissions } from '../shell.js';
import { valueLine, targetLine, statusView, queueParts, stepText, requestProblems } from '../requests.js';
import { valueText } from './requestForm.js';

// «Заявки» of a teacher (#/requests, request.mine): the requests he filed to correct closed data, newest first, with the state and who decided.
// An open one can be withdrawn after a question. The deanery, the vice-rector and the admin (request.queue) see the queue of everybody:
// the ones to decide, the open ones of others, the closed ones. Whoever has both (dean and teacher) sees the queue in the role of the
// office and their own requests in the role of the teacher. The buttons follow the flag can.decide of the answer; the server checks again.
// Every text of a request (names, the reason, the note of a refusal) is put on the page only as text.

const blank = () => ({ data: null, loading: false, errorCode: null, ticket: 0, asking: null, busyId: null, problem: null });
let state = blank();
// The queue of the office: the answer of request.queue, the message of the last decision, the closed part open or shut.
const blankQueue = () => ({ data: null, loading: false, errorCode: null, ticket: 0, busyId: null, notice: null, showClosed: false });
let queue = blankQueue();
const REASON_MAX = 300;

export function leave() {
  state = blank();
  queue = blankQueue();
  document.getElementById('request-reject')?.remove();
}

// The queue in the role of the office; the own requests in the role of a teacher.
function officeMode() {
  const list = permissions();
  if (!list.includes('request.queue')) return false;
  return !list.includes('request.mine') || menuParts(activeRole(getUser())).includes('office');
}

// 'YYYY-MM-DD HH:MM:SS' -> 'dd.mm.yyyy HH:MM'; an empty value stays empty.
const stamp = (at) => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at)
  ? `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}${at.length >= 16 ? ' ' + at.slice(11, 16) : ''}` : '');

export function render(root) {
  if (officeMode()) return renderQueue(root);
  const mine = permissions().includes('request.mine');
  if (mine && state.data === null && !state.loading && state.errorCode === null) load();
  root.append(
    pageHeader({ id: 'requests-title', title: t('request.mine.title'), lead: mine ? t('request.mine.lead') : null }),
    mine ? body() : note('error', t(errorKey('forbidden')), { role: 'alert' }));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('request.mine', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
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

function body() {
  if (state.errorCode !== null) {
    const failure = emptyState('alert', el('p', {}, t(errorKey(state.errorCode))),
      el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
    failure.setAttribute('role', 'alert');
    return failure;
  }
  if (state.data === null) return el('p', { class: 'loading' }, t('request.mine.loading'));
  const { requests } = state.data;
  if (requests.length === 0) return emptyState('clipboard', el('p', { class: 'empty__title', id: 'requests-empty' }, t('request.mine.empty')));
  return el('div', { class: 'rq-list', id: 'requests-list' },
    state.problem ? note('error', t(state.problem), { role: 'alert', id: 'requests-problem' }) : null,
    requests.map(card));
}

// The lines of a request that the teacher's and the office's cards share: the title, what changes, was -> now, the reason, who decided.
function cardLines(request) {
  const target = targetLine(request);
  const decisions = [
    request.deanName ? t('request.mine.dean', { name: request.deanName, date: stamp(request.deanAt) }) : null,
    request.finalName ? t('request.mine.final', { name: request.finalName, date: stamp(request.finalAt) }) : null,
  ].filter(Boolean);
  return [
    el('h2', { class: 'rq-card__title' }, [request.subjectName, request.groupName].filter(Boolean).join(' · ') || '—'),
    el('p', { class: 'rq-card__line' }, el('span', { class: 'rq-card__who' }, request.studentName || '—'), ' · ', t(target.key, target.params)),
    el('p', { class: 'rq-change' },
      el('span', { class: 'rq-change__was' }, valueText(valueLine(request.kind, request.before))),
      icon('chevron', 'rq-change__arrow'),
      el('span', { class: 'rq-change__now' }, valueText(valueLine(request.kind, request.after)))),
    el('p', { class: 'rq-card__reason' }, el('span', { class: 'rq-card__label' }, t('request.reason') + ': '), request.reason),
    decisions.length > 0 ? el('ul', { class: 'rq-card__decisions' }, decisions.map((text) => el('li', {}, text))) : null,
    request.status === 'rejected' && request.closeNote ? el('p', { class: 'rq-card__note' }, t('request.mine.note', { note: request.closeNote })) : null,
    request.status === 'stale' ? el('p', { class: 'rq-card__note rq-card__note--stale' }, t('request.mine.staleHint')) : null,
  ];
}

function card(request) {
  const view = statusView(request.status);
  const open = request.status === 'dean' || request.status === 'prorector';
  return el('article', { class: 'card rq-card', id: 'request-' + request.id, 'data-status': request.status },
    el('header', { class: 'rq-card__head' },
      badge(t(view.key), view.tone, true),
      el('span', { class: 'rq-card__date' }, t('request.mine.filed', { date: stamp(request.createdAt) }))),
    ...cardLines(request),
    open && request.can && request.can.withdraw ? withdrawBlock(request) : null);
}

function withdrawBlock(request) {
  if (state.asking !== request.id) {
    return el('div', { class: 'rq-card__actions' }, el('button', {
      type: 'button', class: 'button button--secondary', id: 'request-withdraw-' + request.id,
      onclick: () => { state.asking = request.id; state.problem = null; refresh(); },
    }, t('request.mine.withdraw')));
  }
  const yes = el('button', { type: 'button', class: 'button button--danger', id: 'request-withdraw-yes-' + request.id }, t('request.mine.withdrawYes'));
  yes.addEventListener('click', () => withdraw(request, yes));
  return el('div', { class: 'rq-card__ask', role: 'alert' },
    el('p', { class: 'mk-ask__text' }, t('request.mine.withdrawAsk')),
    el('div', { class: 'rq-card__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'request-withdraw-keep-' + request.id, onclick: () => { state.asking = null; refresh(); } }, t('request.mine.keep')),
      yes));
}

async function withdraw(request, button) {
  const owner = state;
  if (owner.busyId !== null) return;
  owner.busyId = request.id;
  markBusy(button, 'request.mine.withdrawBusy');
  try {
    await call('request.withdraw', { requestId: request.id });
    owner.problem = null;
  } catch (error) {
    owner.problem = errorKey(error.code);
  }
  if (state !== owner) return;
  owner.busyId = null;
  owner.asking = null;
  // the list is read again: the state of this request (and of the others) is the server's
  owner.data = null;
  load();
  refresh();
}


// ---- The queue of the deanery, the vice-rector and the admin ----

function renderQueue(root) {
  if (queue.data === null && !queue.loading && queue.errorCode === null) loadQueue();
  root.append(
    pageHeader({ id: 'requests-title', title: t('request.queue.title'), lead: t('request.queue.lead') }),
    queueBody());
}

async function loadQueue() {
  const owner = queue;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('request.queue', {});
    if (queue !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
  } catch (error) {
    if (queue !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code || 'internal';
  } finally {
    if (queue === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retryQueue() {
  queue.errorCode = null;
  loadQueue();
  refresh();
}

function queueBody() {
  if (queue.errorCode !== null && queue.data === null) {
    const failure = emptyState('alert', el('p', {}, t(errorKey(queue.errorCode))),
      queue.errorCode === 'forbidden' ? null : el('button', { type: 'button', class: 'button button--secondary', id: 'requests-retry', onclick: retryQueue }, t('common.retry')));
    failure.setAttribute('role', 'alert');
    return failure;
  }
  if (queue.data === null) return el('p', { class: 'loading' }, t('request.queue.loading'));
  const parts = queueParts(queue.data.requests);
  const notice = queue.notice ? note(queue.notice.kind, t(queue.notice.key), { role: queue.notice.kind === 'error' ? 'alert' : 'status', id: 'requests-notice' }) : null;
  if (parts.mine.length + parts.waiting.length + parts.closed.length === 0) {
    return el('div', { class: 'rq-queue', id: 'requests-queue' }, notice,
      emptyState('clipboard', el('p', { class: 'empty__title', id: 'requests-empty' }, t('request.queue.empty'))));
  }
  return el('div', { class: 'rq-queue', id: 'requests-queue' },
    notice,
    queue.errorCode !== null ? el('div', { class: 'reload-failed', role: 'alert' }, note('error', t(errorKey(queue.errorCode))),
      el('button', { type: 'button', class: 'button button--secondary', onclick: retryQueue }, t('common.retry'))) : null,
    queueSection('mine', t('request.queue.mineTitle', { n: parts.mine.length }), parts.mine, parts.mine.length === 0 ? t('request.queue.emptyMine') : null),
    parts.waiting.length > 0 ? queueSection('waiting', t('request.queue.waitingTitle', { n: parts.waiting.length }), parts.waiting, null) : null,
    parts.closed.length > 0 ? closedSection(parts.closed) : null);
}

function queueSection(name, title, list, emptyText) {
  return el('section', { class: 'rq-part', id: 'requests-' + name, 'aria-labelledby': 'requests-' + name + '-title' },
    el('h2', { class: 'section__title', id: 'requests-' + name + '-title' }, title),
    emptyText ? el('p', { class: 'rq-closed-note', id: 'requests-mine-none' }, emptyText) : null,
    list.length > 0 ? el('div', { class: 'rq-list' }, list.map(queueCard)) : null);
}

function closedSection(list) {
  const open = queue.showClosed;
  return el('section', { class: 'rq-part', id: 'requests-closed', 'aria-labelledby': 'requests-closed-title' },
    el('h2', { class: 'section__title', id: 'requests-closed-title' }, t('request.queue.closedTitle', { n: list.length })),
    el('button', {
      type: 'button', class: 'button button--secondary rq-toggle', id: 'requests-closed-toggle', 'aria-expanded': String(open), 'aria-controls': 'requests-closed-list',
      onclick: () => { queue.showClosed = !queue.showClosed; refresh(); focusById('requests-closed-toggle'); },
    }, t(open ? 'request.queue.hideClosed' : 'request.queue.showClosed')),
    open ? el('div', { class: 'rq-list', id: 'requests-closed-list' }, list.map(queueCard)) : null);
}

function queueCard(request) {
  const view = statusView(request.status);
  const step = stepText(request);
  const mine = request.can && request.can.decide === true && step !== null;
  const busy = queue.busyId !== null;
  return el('article', { class: 'card rq-card' + (mine ? ' rq-card--mine' : ''), id: 'request-' + request.id, 'data-status': request.status },
    el('header', { class: 'rq-card__head' },
      badge(step && !mine ? t(step.key) : t(view.key), view.tone, true),
      el('span', { class: 'rq-card__date' }, t('request.mine.filed', { date: stamp(request.createdAt) }))),
    el('p', { class: 'rq-card__line rq-card__teacher' }, t('request.queue.by', { name: request.authorName || '—' })),
    ...cardLines(request),
    mine ? el('div', { class: 'rq-card__actions' },
      el('button', {
        type: 'button', class: 'button button--primary', id: 'request-approve-' + request.id, 'aria-disabled': busy ? 'true' : null,
        onclick: (event) => approve(request, event.currentTarget),
      }, icon('check'), t('request.queue.approve')),
      el('button', {
        type: 'button', class: 'button button--secondary rq-reject', id: 'request-reject-' + request.id, 'aria-disabled': busy ? 'true' : null,
        onclick: () => { if (queue.busyId === null) openReject(request); },
      }, t('request.queue.reject'))) : null);
}

// The state of a request changed under the person (decided by someone else, or closed): say so and read the queue again.
const CHANGED = ['request_changed', 'request_closed'];

async function approve(request, button) {
  const owner = queue;
  if (owner.busyId !== null) return;
  owner.busyId = request.id;
  markBusy(button, 'request.queue.busy');
  for (const other of document.querySelectorAll('.rq-card__actions .button')) other.setAttribute('aria-disabled', 'true');
  try {
    const answer = await call('request.decide', { requestId: request.id, step: request.status, verdict: 'approve' });
    owner.notice = answer.stale
      ? { kind: 'warning', key: 'request.queue.decided.stale' }
      : { kind: 'success', key: 'request.queue.decided.' + request.status };
  } catch (error) {
    owner.notice = CHANGED.includes(error.code)
      ? { kind: 'info', key: 'request.queue.decided.changed' }
      : { kind: 'error', key: errorKey(error.code) };
  }
  if (queue !== owner) return;
  owner.busyId = null;
  loadQueue();
  refresh();
}

// The window «Отказать в заявке»: the reason is required; the server checks it again.
function openReject(request) {
  document.getElementById('request-reject')?.remove();
  let busy = false;
  let done = false;
  const area = el('textarea', {
    id: 'request-reject-reason', name: 'note', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': 'request-reject-count request-reject-error', 'aria-required': 'true',
  });
  const count = el('span', { class: 'return-count', id: 'request-reject-count', 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
  const error = el('p', { class: 'field__error', id: 'request-reject-error', role: 'alert', hidden: true });
  const problem = el('div', { class: 'mk-problem' });
  const showError = (key) => {
    error.replaceChildren(icon('alert'), t(key));
    error.hidden = false;
    area.setAttribute('aria-invalid', 'true');
    area.focus();
  };
  area.addEventListener('input', () => {
    count.textContent = t('journal.marks.reason.count', { n: area.value.length, max: REASON_MAX });
    error.hidden = true;
    area.removeAttribute('aria-invalid');
  });
  const go = el('button', { type: 'button', class: 'button button--danger', id: 'request-reject-submit' }, t('request.queue.rejectSubmit'));
  const cancel = el('button', { type: 'button', class: 'button button--secondary', id: 'request-reject-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel'));

  async function submit() {
    if (busy || done) return;
    error.hidden = true;
    problem.replaceChildren();
    const text = area.value.trim();
    if (text === '') return showError('request.form.error.required');
    if (text.length > REASON_MAX) return showError('request.form.error.too_long');
    const owner = queue;
    busy = true;
    area.disabled = true;
    markBusy(go, 'request.queue.busy');
    try {
      await call('request.decide', { requestId: request.id, step: request.status, verdict: 'reject', note: text });
      done = true;
      owner.notice = { kind: 'success', key: 'request.queue.decided.rejected' };
    } catch (failure) {
      busy = false;
      if (CHANGED.includes(failure.code)) {
        done = true;
        owner.notice = { kind: 'info', key: 'request.queue.decided.changed' };
      } else {
        area.disabled = false;
        go.classList.remove('is-busy');
        go.removeAttribute('aria-busy');
        go.removeAttribute('aria-disabled');
        go.textContent = t('request.queue.rejectSubmit');
        const fields = failure.code === 'invalid' && Array.isArray(failure.fields) ? requestProblems(failure.fields) : null;
        const key = fields && (fields.get('note') || fields.get('reason'));
        if (key) showError(key);
        else problem.replaceChildren(note('error', t(errorKey(failure.code)), { role: 'alert' }));
        return;
      }
    }
    busy = false;
    dialog.close();
    if (queue === owner) { loadQueue(); refresh(); }
  }
  go.addEventListener('click', submit);

  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'request-reject', labelledBy: 'request-reject-title', className: 'dialog--cell dialog--request',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); focusById('request-reject-' + request.id, 'requests-title'); },
    canCancel: () => !busy,
  },
  el('div', { class: 'rq-body' },
    el('div', { class: 'mk-head' },
      el('p', { class: 'dialog__kicker' }, [request.subjectName, request.groupName].filter(Boolean).join(' · ')),
      el('h2', { class: 'dialog__title', id: 'request-reject-title' }, t('request.queue.rejectTitle'))),
    el('div', { class: 'field mk-reason' },
      el('div', { class: 'mk-reason__head' }, el('label', { class: 'field__label', for: 'request-reject-reason' }, t('request.queue.rejectNote')), count),
      el('div', { class: 'field__control' }, area),
      error),
    el('p', { class: 'rq-hint' }, t('request.queue.rejectHint')),
    problem,
    el('div', { class: 'dialog__actions mk-actions' }, cancel, go)));
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById('request-reject-reason');
}

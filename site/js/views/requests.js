import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, markBusy, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { valueLine, targetLine, statusView } from '../requests.js';
import { valueText } from './requestForm.js';

// «Заявки» of a teacher (#/requests, request.mine): the requests he filed to correct closed data, newest first, with the state and who decided.
// An open one can be withdrawn after a question. The deanery's queue (request.queue) has its own part of this screen later.
// Every text of a request (names, the reason, the note of a refusal) is put on the page only as text.

const blank = () => ({ data: null, loading: false, errorCode: null, ticket: 0, asking: null, busyId: null, problem: null });
let state = blank();

export function leave() {
  state = blank();
}

// 'YYYY-MM-DD HH:MM:SS' -> 'dd.mm.yyyy HH:MM'; an empty value stays empty.
const stamp = (at) => (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(at)
  ? `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}${at.length >= 16 ? ' ' + at.slice(11, 16) : ''}` : '');

export function render(root) {
  const mine = permissions().includes('request.mine');
  if (mine && state.data === null && !state.loading && state.errorCode === null) load();
  root.append(
    pageHeader({ id: 'requests-title', title: t('request.mine.title'), lead: mine ? t('request.mine.lead') : null }),
    mine ? body() : note('info', t('request.mine.queueSoon'), { id: 'requests-queue-soon' }));
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

function card(request) {
  const view = statusView(request.status);
  const target = targetLine(request);
  const open = request.status === 'dean' || request.status === 'prorector';
  const decisions = [
    request.deanName ? t('request.mine.dean', { name: request.deanName, date: stamp(request.deanAt) }) : null,
    request.finalName ? t('request.mine.final', { name: request.finalName, date: stamp(request.finalAt) }) : null,
  ].filter(Boolean);
  return el('article', { class: 'card rq-card', id: 'request-' + request.id, 'data-status': request.status },
    el('header', { class: 'rq-card__head' },
      badge(t(view.key), view.tone, true),
      el('span', { class: 'rq-card__date' }, t('request.mine.filed', { date: stamp(request.createdAt) }))),
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

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, focusById, markBusy, modal, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { audienceText, untilText, dayText } from '../announce.js';
import { openAnnounceForm, closeAnnounceForm } from './announceForm.js';

// «Объявления» (#/announcements, announce.list): what the person may read, newest first. Those who may write (`can.write`) get «Новое объявление»;
// «Убрать» is on the announcements the server marks `can.remove`. Titles and texts are only ever text; line breaks of a text are kept.

const blank = () => ({
  data: null,        // the answer of announce.list; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  open: new Set(),   // the ids whose text is shown in full
});
let state = blank();

export function leave() {
  closeAnnounceForm();
  document.getElementById('announce-remove-dialog')?.remove();
  state = blank();
}

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const write = state.data !== null && state.data.can.write === true;
  if (!write && state.data !== null) root.append(el('a', { class: 'back-link', id: 'announce-back', href: '#/' }, icon('chevron'), t('common.toHome')));
  root.append(
    pageHeader({
      id: 'announce-heading', title: t('announce.title'), lead: state.data === null ? null : t(write ? 'announce.leadWrite' : 'announce.leadRead'),
      actions: write ? el('button', { type: 'button', class: 'button button--primary', id: 'announce-new', onclick: openNew }, icon('plus'), t('announce.new')) : null,
    }),
    state.data === null ? loadingBody() : body());
  if (state.data !== null) requestAnimationFrame(measure);
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('announce.list', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.loadErrorKey = null;
  load();
  refresh();
}

function loadingBody() {
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('announce.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function body() {
  const { data } = state;
  if (data.items.length === 0) return emptyState('bell', el('p', { class: 'empty__title', id: 'announce-empty' }, t('announce.empty')));
  return el('ul', { class: 'an-list', id: 'announce-list' }, data.items.map((item) => el('li', {}, card(item, data.today))));
}

function card(item, today) {
  const to = audienceText(item);
  const until = untilText(item, today);
  const full = state.open.has(item.id);
  const toggle = el('button', {
    type: 'button', class: 'an-card__more', id: 'announce-more-' + item.id, hidden: full ? null : '', 'aria-expanded': String(full),
    onclick: () => {
      if (state.open.has(item.id)) state.open.delete(item.id); else state.open.add(item.id);
      refresh();
      focusById('announce-more-' + item.id);
    },
  }, t(full ? 'announce.less' : 'announce.more'));
  return el('article', { class: 'card an-card', id: 'announce-item-' + item.id, 'aria-labelledby': 'announce-item-title-' + item.id },
    el('header', { class: 'an-card__head' },
      el('h2', { class: 'an-card__title', id: 'announce-item-title-' + item.id }, item.title),
      badge(t(to.key, to.params), item.audience === 'group' ? 'primary' : 'neutral')),
    el('p', { class: 'an-card__meta' }, t('announce.by', { name: item.authorName || '—', date: dayText(item.createdAt) }), ' · ', t(until.key, until.params)),
    item.text ? el('p', { class: 'an-card__text' + (full ? '' : ' is-clamped'), id: 'announce-text-' + item.id }, item.text) : null,
    item.text || item.can.remove ? el('div', { class: 'an-card__actions' },
      toggle,
      item.can.remove ? el('button', { type: 'button', class: 'button button--secondary button--small', id: 'announce-remove-' + item.id, onclick: () => openRemove(item) }, t('announce.remove')) : null) : null);
}

// A long text is cut to six lines by the style; «Показать полностью» appears only where something is really cut.
function measure() {
  for (const text of document.querySelectorAll('.an-card__text.is-clamped')) {
    const toggle = document.getElementById(text.id.replace('announce-text-', 'announce-more-'));
    if (toggle) toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
  }
}

function openNew() {
  const owner = state;
  openAnnounceForm({
    can: owner.data.can, today: owner.data.today, returnId: 'announce-new',
    onSaved: () => {
      if (state !== owner) return;
      owner.data = null;
      refresh();
    },
  });
}

// ---- «Убрать» ----

function openRemove(item) {
  const owner = state;
  let busy = false;
  document.getElementById('announce-remove-dialog')?.remove();
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'announce-remove-confirm' }, t('announce.remove.confirm'));
  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'announce-remove-dialog', labelledBy: 'announce-remove-dialog-title', className: 'dialog--confirm',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); focusById('announce-new'); },
  },
  el('h2', { class: 'dialog__title', id: 'announce-remove-dialog-title' }, t('announce.remove.title')),
  el('p', {}, t('announce.remove.text', { title: item.title })),
  problem,
  el('div', { class: 'dialog__actions' },
    el('button', { type: 'button', class: 'button button--secondary', id: 'announce-remove-cancel', onclick: () => dialog.close() }, t('common.cancel')),
    confirm));
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  confirm.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    markBusy(confirm, 'announce.remove.busy');
    try {
      await call('announce.remove', { id: item.id });
      if (state !== owner) return;
      owner.data = null;
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.removeAttribute('aria-disabled');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('announce.remove.confirm');
      problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    }
  });
  focusById('announce-remove-cancel');
}

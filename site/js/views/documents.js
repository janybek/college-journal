import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, note, pageHeader, refresh, markBusy, field } from '../ui.js';
import { fullDate } from '../dirInfo.js';
import { DOC_TABS, tabCounts, overdue, nextKey, stateKey, teachersLine, shortFio, cardHref } from '../documents.js';
import { openAssignDialog } from './docAssign.js';

// «Документы › Силлабусы» (#/documents/syllabi/<tab>, docs.syllabi): the disciplines as cards in three tabs. The whole
// card opens the card of the discipline; the small buttons on it (assign, change the review date) are shown by `can`
// of the answer. The server checks every right; the screen only leaves out buttons.

const blank = () => ({
  data: null,        // the answer of docs.syllabi; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
  editing: null,     // the line whose review date is being changed: { lineId, date, busy, errorKey }
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const tab = params.tab;
  root.append(pageHeader({ id: 'docs-title', title: t('docs.syllabi') }), tabs(tab));
  if (state.data === null) {
    root.append(state.errorCode === null ? el('p', { class: 'loading' }, t('common.loading')) : failure());
    return;
  }
  root.append(panel(tab));
  document.getElementById('docs-tab-' + tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('docs.syllabi', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code ?? 'unknown';
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

function failure() {
  const body = emptyState('alert',
    el('p', {}, t(errorKey(state.errorCode))),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

function tabs(current) {
  const counts = state.data ? tabCounts(state.data) : null;
  return el('nav', { class: 'doc-tabs', 'aria-label': t('docs.syllabi') }, DOC_TABS.map((tab) => el('a', {
    class: 'doc-tab', id: 'docs-tab-' + tab, href: '#/documents/syllabi/' + tab, 'aria-current': tab === current ? 'page' : null,
  }, t('docs.tab.' + tab),
  counts ? el('span', { class: 'doc-tab__n' + (tab === 'review' && counts.review > 0 ? ' doc-tab__n--warn' : '') }, String(counts[tab])) : null)));
}

function panel(tab) {
  const rows = state.data[tab];
  if (rows.length === 0) return emptyState('checkCircle', el('p', { class: 'empty__title', id: 'docs-empty' }, t('docs.empty.' + tab)));
  return el('div', { class: 'doc-cards' }, rows.map((row) => card(tab, row)));
}

// The grey line: «Иванова А. С. · до 20.11.2026»; an overdue date is in the colour of the warning, with no word.
function metaLine(name, date) {
  const late = overdue(date, state.data.today);
  return el('span', { class: 'doc-card__meta' }, name ? shortFio(name) : t('docs.responsible.none'),
    date ? [' · ', el('span', { class: late ? 'doc-card__late' : null }, t('docs.until', { date: fullDate(date) }))] : null);
}

function badgeOf(tab, row) {
  if (row.waiting) return badge(t('docs.choose'), 'warning');
  if (tab === 'approved') return nextKey(row.next) ? badge(t(nextKey(row.next)), 'info') : badge(t('syllabus.status.approved'), 'success');
  if (tab === 'review') return badge(t('syllabus.status.review'), 'warning');
  return badge(t(stateKey(row.state)), row.state === 'returned' ? 'warning' : row.state === 'draft' ? 'neutral' : 'danger');
}

// One card: the name is the link of the whole card (a stretched link); the small buttons lie above it.
function card(tab, row) {
  const { can } = state.data;
  return el('article', { class: 'card doc-card', 'data-tab': tab },
    el('div', { class: 'doc-card__top' },
      el('a', { class: 'doc-card__link', id: `docs-open-${tab}-${row.disciplineId}`, href: cardHref(row.disciplineId) }, row.disciplineName || '—'),
      badgeOf(tab, row)),
    el('div', { class: 'doc-card__sub' }, ...subOf(tab, row, can)));
}

function subOf(tab, row, can) {
  if (tab === 'approved') return [el('span', { class: 'doc-card__meta' }, approvedLine(row))];
  if (tab === 'review') return [metaLine(row.teacherName, row.reviewDue), can.setReviewDue ? reviewEditor(row) : null];
  const assign = !row.responsibleId && can.assign
    ? el('button', {
      type: 'button', class: 'doc-card__mini', id: 'docs-assign-' + row.disciplineId,
      onclick: () => openAssignDialog(row.disciplineId, { onSaved: reload }),
    }, t('docs.assign.short'))
    : null;
  return [metaLine(row.responsibleName, row.dueDate), assign];
}

// «версия 3 · 14.10.2026 · Иванова А. С., Петров Б. К.»: the latest approved half.
function approvedLine(row) {
  const last = [...row.halves].sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : a.decidedAt > b.decidedAt ? -1 : 0))[0];
  return [t('docs.version', { n: last.version }), last.decidedAt ? fullDate(last.decidedAt.slice(0, 10)) : '', teachersLine(row.teachers)].filter(Boolean).join(' · ');
}

function reload() {
  state.data = null;
  refresh();
}

// «изменить»: the date field in place of the button, «Сохранить»; an empty date clears it.
function reviewEditor(row) {
  const edit = state.editing;
  if (!edit || edit.lineId !== row.lineId) {
    return el('button', {
      type: 'button', class: 'doc-card__mini doc-card__mini--text', id: 'docs-review-edit-' + row.lineId,
      onclick: () => { state.editing = { lineId: row.lineId, date: row.reviewDue, busy: false, errorKey: null }; refresh(); },
    }, t('docs.change'));
  }
  const save = el('button', { type: 'submit', class: 'button button--primary', id: 'docs-review-save' }, t('common.save'));
  if (edit.busy) markBusy(save, 'common.saving');
  return el('form', { class: 'doc-card__edit', novalidate: true, onsubmit: (event) => { event.preventDefault(); saveReviewDue(row); } },
    field({ id: 'docs-review-date', label: t('docs.reviewDue'), type: 'date', value: edit.date, error: edit.errorKey, onInput: (v) => { edit.date = v; } }),
    el('div', { class: 'doc-card__edit-actions' },
      save,
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.editing = null; refresh(); } }, t('common.cancel'))));
}

async function saveReviewDue(row) {
  const owner = state;
  const edit = owner.editing;
  if (!edit || edit.busy) return;
  edit.busy = true;
  edit.errorKey = null;
  refresh();
  try {
    await call('syllabus.setReviewDue', { lineId: row.lineId, date: edit.date });
    if (state !== owner) return;
    owner.editing = null;
    owner.data = null;
  } catch (error) {
    if (state !== owner) return;
    edit.busy = false;
    edit.errorKey = errorKey(error.code);
  }
  refresh();
}

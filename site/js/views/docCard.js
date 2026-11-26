import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, pageHeader, refresh } from '../ui.js';
import { fullDate } from '../dirInfo.js';
import { openHref, shortFio, teachersLine } from '../documents.js';
import { openAssignDialog } from './docAssign.js';

// The card of a discipline (#/documents/discipline/<id>, docs.discipline): its syllabus by halves of the year, who writes
// it and by when, who teaches it, the history. Buttons come from `can` of the answer. Everything from the server goes on
// the page as text. The page of a syllabus is opened by the discipline (openHref).

const blank = () => ({
  disciplineId: null,
  data: null,          // the answer of docs.discipline; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.disciplineId !== params.disciplineId) state = Object.assign(blank(), { disciplineId: params.disciplineId });
  if (state.data === null && !state.loading && state.errorCode === null) load();
  root.append(crumbs(state.data ? state.data.discipline.name : null));
  if (state.data === null) {
    root.append(state.errorCode === null ? el('p', { class: 'loading' }, t('common.loading')) : failure());
    return;
  }
  const { data } = state;
  root.append(
    pageHeader({ id: 'doc-card-title', title: data.discipline.name }),
    ...[syllabusSection(data), developmentSection(data), teachersSection(data), historySection(data)].filter(Boolean));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('docs.discipline', { disciplineId: owner.disciplineId });
    if (state !== owner || owner.ticket !== ticket) return;
    owner.data = data;
    owner.errorCode = null;
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
  state.data = null;
  refresh();
}

function failure() {
  const missing = state.errorCode === 'not_found';
  const body = emptyState('alert',
    el('p', {}, t(errorKey(state.errorCode))),
    missing ? null : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')),
    el('a', { class: 'button button--secondary', href: '#/documents/syllabi' }, t('docs.syllabi')));
  body.setAttribute('role', 'alert');
  return body;
}

// «Документы › Силлабусы › Анатомия»
function crumbs(name) {
  return el('nav', { class: 'card-crumbs', 'aria-label': t('docs.title') },
    el('span', {}, t('docs.title')),
    el('span', { class: 'card-crumbs__sep', 'aria-hidden': 'true' }, '›'),
    el('a', { href: '#/documents/syllabi' }, t('docs.syllabi')),
    name === null ? null : el('span', { class: 'card-crumbs__sep', 'aria-hidden': 'true' }, '›'),
    name === null ? null : el('span', { class: 'card-crumbs__here', 'aria-current': 'page' }, name));
}

function section(id, title, ...children) {
  return el('section', { class: 'card doc-section', 'aria-labelledby': id },
    el('h2', { class: 'doc-section__title', id }, title), ...children);
}

const fact = (label, value) => el('div', { class: 'fact' },
  el('span', { class: 'fact__label' }, label), el('span', { class: 'fact__value' }, value));

const dayOf = (date) => (date ? fullDate(date.slice(0, 10)) : '');

// One half of the year: the label, the state, the version and «Открыть» for the page of the syllabus.
function halfRow(data, half) {
  const { approved, open } = half;
  const stateText = open && open.status !== 'approved'
    ? badge(t('syllabus.status.' + open.status), open.status === 'review' ? 'warning' : open.status === 'returned' ? 'warning' : 'neutral')
    : badge(t('syllabus.status.approved'), 'success');
  const shown = open && open.status !== 'approved' ? open : approved;
  const meta = [t('docs.version', { n: shown.version }), dayOf(shown === approved ? approved.decidedAt : shown.submittedAt)].filter(Boolean).join(' · ');
  const draft = Boolean(open) && open.status !== 'approved';
  const href = openHref({ disciplineId: data.discipline.id, semester: half.semester, draft });
  return el('li', { class: 'doc-half' },
    el('span', { class: 'doc-half__name' }, t('docs.half.' + half.semester)),
    stateText,
    el('span', { class: 'doc-half__meta' }, meta),
    el('a', { class: 'button button--secondary doc-half__open', id: 'doc-open-' + half.semester, href }, t('docs.open')));
}

function syllabusSection(data) {
  if (data.waiting.length > 0) {
    return section('doc-syllabus-title', t('docs.syllabi'), el('p', {}, badge(t('docs.choose'), 'warning')));
  }
  return section('doc-syllabus-title', t('docs.syllabi'),
    data.halves.length === 0
      ? el('p', {}, badge(t('docs.state.none'), 'danger'))
      : el('ul', { class: 'doc-halves' }, data.halves.map((half) => halfRow(data, half))));
}

// Who writes the syllabus and by when. The button only with can.assign.
function developmentSection(data) {
  const { line } = data;
  const assigned = Boolean(line && line.responsibleId);
  if (!data.can.assign && !assigned) return null;
  const button = data.can.assign
    ? el('button', { type: 'button', class: 'button button--primary', id: 'docs-assign', onclick: () => openAssignDialog(data.discipline.id, { card: data, onSaved: reload }) },
      t(assigned ? 'docs.reassign' : 'docs.assign'))
    : null;
  return el('section', { class: 'card doc-section', 'aria-label': t('docs.responsible') },
    button ? el('div', { class: 'doc-section__head' }, button) : null,
    el('div', { class: 'facts' },
      fact(t('docs.responsible'), assigned ? shortFio(line.responsibleName) : t('docs.responsible.none')),
      fact(t('docs.due'), line && line.dueDate ? fullDate(line.dueDate) : '—'),
      line && line.reviewDue ? fact(t('docs.reviewDue'), fullDate(line.reviewDue)) : null));
}

function reload() {
  state.data = null;
  refresh();
}

function teachersSection(data) {
  if (data.teachers.length === 0) return null;
  return section('doc-teachers-title', t('docs.teachers'),
    el('ul', { class: 'doc-teachers' }, data.teachers.map((teacher) => el('li', { class: 'doc-teachers__row' },
      el('b', {}, teachersLine([teacher.fullName])),
      el('span', { class: 'doc-teachers__groups' }, teacher.groups.join(', '))))));
}

function historySection(data) {
  if (data.history.length === 0) return null;
  return section('doc-history-title', t('docs.history'),
    el('ul', { class: 'doc-teachers' }, data.history.map((item) => el('li', { class: 'doc-teachers__row' },
      el('span', {}, [t('docs.half.' + item.semester), t('docs.version', { n: item.version }), dayOf(item.decidedAt)].filter(Boolean).join(' · ')),
      el('span', { class: 'doc-teachers__groups' }, item.teacherName ? shortFio(item.teacherName) : '')))));
}

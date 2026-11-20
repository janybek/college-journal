import { call } from '../api.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { typeBadge } from './pairParts.js';
import { pairCell } from './topics.js';

// The topic plan of one subject (#/plan/<subjectId>), read-only: the table of the «Темы» screen without its
// buttons. A teacher opens it from «Мои предметы»; the server answers `forbidden` for a subject of another
// teacher and `not_found` for an unknown one, and the screen says so with a way back home.

// Answers a retry would not change: the screen explains them instead of offering to try again.
const FINAL_ERRORS = { forbidden: 'plan.forbidden', not_found: 'plan.notFound' };

const blank = () => ({ subjectId: null, plan: null, errorCode: null, pending: false, ticket: 0 });
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, { subjectId }) {
  if (state.subjectId !== subjectId) state = { ...blank(), subjectId, ticket: state.ticket };
  if (state.plan === null && state.errorCode === null && !state.pending) load(state);
  root.append(pageHeader({ id: 'plan-title', title: t('plan.title'), lead: t('plan.lead') }), body());
}

async function load(owner) {
  const ticket = ++owner.ticket;
  owner.pending = true;
  try {
    const plan = await call('topics.plan', { subjectId: owner.subjectId });
    if (state !== owner || owner.ticket !== ticket) return;
    owner.plan = plan;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code;
  } finally {
    if (state === owner && owner.ticket === ticket) owner.pending = false;
  }
  refresh();
}

function body() {
  const { plan, errorCode } = state;
  if (errorCode && FINAL_ERRORS[errorCode]) {
    const failed = emptyState('alert',
      el('p', {}, t(FINAL_ERRORS[errorCode])),
      el('a', { class: 'button button--secondary', href: '#/' }, icon('home'), t('common.toHome')));
    failed.setAttribute('role', 'alert');
    return el('section', { class: 'card topics-card' }, el('div', { class: 'topics-wait' }, failed));
  }
  if (errorCode) {
    const failed = emptyState('alert',
      el('p', {}, t(errorKey(errorCode))),
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorCode = null; refresh(); } }, t('common.retry')));
    failed.setAttribute('role', 'alert');
    return el('section', { class: 'card topics-card' }, el('div', { class: 'topics-wait' }, failed));
  }
  if (!plan) return el('section', { class: 'card topics-card' }, el('div', { class: 'topics-wait' }, el('p', { class: 'loading' }, t('common.loading'))));
  const { subject, topics } = plan;
  return el('section', { class: 'card topics-card', 'aria-labelledby': 'plan-subject' },
    el('div', { class: 'toolbar plan-toolbar' },
      el('span', { class: 'list__icon' }, icon('book')),
      el('h2', { class: 'plan-subject', id: 'plan-subject' }, subject.name),
      subject.groupName ? badge(subject.groupName, 'primary') : null,
      el('p', { class: 'toolbar__count' }, tCount('topics.count', topics.length))),
    topics.length === 0
      ? el('div', { class: 'topics-wait' }, emptyState('clipboard', el('p', { class: 'empty__title' }, t('topics.empty'))))
      : table(topics));
}

function table(topics) {
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table topics-table', 'aria-labelledby': 'plan-subject' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'table__num' }, t('import.col.topics.order')),
        el('th', { scope: 'col', class: 'topics__unit' }, t('import.col.topics.unit')),
        el('th', { scope: 'col' }, t('import.col.topics.name')),
        el('th', { scope: 'col' }, t('import.col.topics.lessonType')),
        el('th', { scope: 'col' }, t('topics.pair')))),
      el('tbody', {}, topics.map((topic, i) => {
        // The first topic of a unit opens it with a line and its number, as on the «Темы» screen.
        const unitStart = i === 0 || topics[i - 1].unit !== topic.unit;
        const classes = [unitStart ? 'is-unit-start' : '', topic.pair === null ? 'is-unplaced' : ''].filter(Boolean).join(' ');
        return el('tr', { class: classes || null },
          el('td', { class: 'table__num' }, String(topic.order)),
          el('td', { class: 'topics__unit' }, el('span', { class: unitStart ? 'unit' : 'visually-hidden' }, String(topic.unit))),
          el('td', {}, el('span', { class: 'table__label' }, topic.name)),
          el('td', {}, typeBadge(topic.lessonType)),
          el('td', {}, pairCell(topic.pair)));
      }))));
}

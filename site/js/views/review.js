import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, avatarTone, badge, emptyState, note, pageHeader, focusById, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { isDate, dayParts } from '../dates.js';
import { permissions } from '../shell.js';
import { setReviewCount } from '../reviewCount.js';
import { openReturnDialog } from './syllabus.js';

// «Силлабусы на утверждении» (#/review): the versions teachers sent to the deanery, the oldest first (syllabus.queue).
// A row is the version: discipline, teacher, semester of the curriculum, when and by whom it was sent, its number and
// status. It opens the new version on the syllabus page of the teacher's first group, where the deanery approves it
// or returns it. A version whose teacher has no group of the discipline any more has no page: its row says so, opens
// the form to read, and — with the right — returns it, so it does not wait in the queue for ever. The number of the
// queue goes to the menu from every answer. The server checks every right; the screen only leaves out buttons.

const blank = () => ({
  data: null,          // the answer of syllabus.queue; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  doneKey: null,       // a dictionary key: what the last action here did
});
let state = blank();

const can = (permission) => permissions().includes(permission);

export function leave() {
  state = blank();
}

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  root.append(
    pageHeader({ id: 'review-title', title: t('review.title'), lead: t('review.lead') }),
    state.data === null ? loadingBody() : body());
}

// Reads the queue; the table on screen stays until the new one comes. Resolves when it is drawn.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('syllabus.queue', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
    setReviewCount(data.count);
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
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function body() {
  const { rows } = state.data;
  return el('div', { class: 'stack' },
    el('div', { class: 'notes', role: 'status' }, state.doneKey ? note('success', t(state.doneKey)) : null),
    state.loadErrorKey ? el('div', { class: 'reload-failed', role: 'alert' },
      note('error', t(state.loadErrorKey)),
      el('button', { type: 'button', id: 'review-retry', class: 'button button--secondary', onclick: retry }, t('common.retry'))) : null,
    rows.length === 0
      ? emptyState('checkCircle',
        el('p', { class: 'empty__title', id: 'review-empty' }, t('review.empty')),
        el('p', {}, t('review.emptyHint')))
      : el('section', { class: 'card table-card' }, table(rows)));
}

function table(rows) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table review-table', 'aria-labelledby': 'review-title' },
      el('thead', {}, el('tr', {},
        col(t('review.col.discipline')),
        col(t('review.col.teacher')),
        col(t('review.col.semester')),
        col(t('review.col.sent')),
        col(t('review.col.version')),
        col(t('review.col.status')),
        el('td', { class: 'review-table__go-col' }))),
      el('tbody', {}, rows.map(line))));
}

const dayText = (date) => {
  if (!isDate(date)) return '—';
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
};

const pageHref = (row) => `#/syllabus/${row.subjectId}/${row.semester}/draft`;

// One version. With a page: the discipline is the link to it (the whole row answers the pointer). Without one: a strip
// under the row says why, with the form to read and the return.
function line(row) {
  const orphan = row.subjectId === '';
  const nameId = 'review-name-' + row.syllabusId;
  const name = el('span', { class: 'discipline__name', id: nameId }, row.disciplineName || '—');
  const discipline = el('span', { class: 'discipline', 'data-tone': avatarTone(row.disciplineName) },
    el('span', { class: 'discipline__swatch', 'aria-hidden': 'true' }),
    orphan ? name : el('a', { class: 'review-table__link', href: pageHref(row), id: 'review-open-' + row.syllabusId }, name));
  const main = el('tr', { class: 'review-row' + (orphan ? ' is-orphan' : '') },
    el('td', { class: 'review-table__discipline' }, discipline),
    el('td', {}, el('span', { class: 'person' }, avatar(row.teacherName),
      el('span', { class: 'person__name' }, row.teacherName || '—'))),
    el('td', { class: 'review-table__semester' }, row.planSemester ? t('syllabus.semesterN', { n: row.planSemester }) : '—'),
    el('td', { class: 'review-table__sent' },
      el('span', { class: 'review-table__date' }, dayText(row.submittedAt)),
      row.submittedByName ? el('span', { class: 'review-table__by' }, t('review.sentBy', { name: row.submittedByName })) : null),
    el('td', { class: 'review-table__version' }, t('review.version', { n: row.version })),
    el('td', {}, badge(t('syllabus.status.review'), 'info', true)),
    el('td', { class: 'review-table__go' }, orphan ? null : icon('chevron', 'review-table__chevron')));
  if (!orphan) return main;
  return [main, el('tr', { class: 'review-orphan' },
    el('td', { colspan: '7' },
      el('div', { class: 'review-orphan__body' },
        el('p', { class: 'review-orphan__text' }, icon('alert'), el('span', {}, t('review.noSubjects'))),
        orphanActions(row, nameId))))];
}

// A version without a page: its form (read only, as it is under review) and, for the deanery, «Вернуть с замечаниями».
function orphanActions(row, nameId) {
  const giveBackId = 'review-give-back-' + row.syllabusId;
  return el('span', { class: 'review-orphan__actions' },
    can('syllabus.form') ? el('a', {
      class: 'button button--secondary', id: 'review-form-' + row.syllabusId, href: '#/syllabus-form/' + row.syllabusId, 'aria-describedby': nameId,
    }, t('review.openForm')) : null,
    can('syllabus.return') ? el('button', {
      type: 'button', id: giveBackId, class: 'button button--secondary', 'aria-describedby': nameId,
      onclick: () => giveBack(row),
    }, icon('pencil'), t('syllabus.action.giveBack')) : null);
}

// After the return the version leaves the queue: the queue is read again, and its answer gives the menu its number.
function giveBack(row) {
  const owner = state;
  openReturnDialog(row.syllabusId, () => {
    if (state !== owner) return;
    owner.doneKey = 'syllabus.return.done';
    load().then(() => focusById('app'));
  });
}

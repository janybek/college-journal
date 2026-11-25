import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader, searchField, selectField, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole } from '../shell.js';
import { REPEAT_STATES, stateBadge, filterOptions, filterRepeats, orderLine, dayOf } from '../repeat.js';
import { wordTone } from '../ledger.js';
import { openEnrol } from './repeatEnrol.js';

// «Повторный курс» (#/repeats, repeat.list): the students who repeat a subject. The deanery and the admin enrol (a window of
// three steps), the vice-rector only reads, a teacher sees the cards where they teach the repeat; a person with both roles in the
// role «Преподаватель» sees only their own. A row opens the card (#/repeat/<id>). Names and order numbers are only ever text.

const blank = () => ({
  data: null,          // the answer of repeat.list; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  group: '',           // the filters above the table; '' — all of them
  subject: '',
  state: 'all',
  query: '',           // the search by the name of the student
});
let state = blank();

export function leave() {
  document.getElementById('repeat-enrol-dialog')?.remove();
  state = blank();
}

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const teacher = activeRole(getUser()) === 'teacher';
  const manage = state.data !== null && state.data.can.enrol === true;
  const leadKey = teacher ? 'repeat.lead.mine' : manage ? 'repeat.lead.manage' : 'repeat.lead.read';
  root.append(
    pageHeader({
      id: 'repeats-title', title: t(teacher ? 'repeat.mine.title' : 'repeat.title'), lead: state.data === null ? null : t(leadKey),
      actions: manage ? el('button', { type: 'button', class: 'button button--primary', id: 'repeat-enrol-open', onclick: openWindow }, icon('plus'), t('repeat.enrol')) : null,
    }),
    state.data === null ? loadingBody() : body(teacher));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('repeat.list', {});
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
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('repeat.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function openWindow() {
  openEnrol({ today: state.data.today, onClose: () => document.getElementById('repeat-enrol-open')?.focus() });
}

const options = (list) => list.map((value) => ({ value, label: value }));

function body(teacher) {
  const { data } = state;
  const mine = filterRepeats(data.repeats, { own: teacher });
  if (mine.length === 0) {
    return emptyState('table',
      el('p', { class: 'empty__title', id: 'repeats-empty' }, t('repeat.empty')),
      data.can.enrol ? el('p', {}, t('repeat.empty.manage')) : null);
  }
  const found = filterOptions(mine);
  if (!found.groups.includes(state.group)) state.group = '';
  if (!found.subjects.includes(state.subject)) state.subject = '';
  const query = state.query.trim().toLocaleLowerCase();
  const shown = filterRepeats(mine, { group: state.group, subject: state.subject, state: state.state })
    .filter((row) => query === '' || row.studentName.toLocaleLowerCase().includes(query));
  return el('section', { class: 'card table-card', 'aria-labelledby': 'repeats-title' },
    el('div', { class: 'toolbar lg-toolbar' },
      selectField({
        id: 'repeats-group', label: t('repeat.filter.group'), hideLabel: true, value: state.group,
        placeholder: t('repeat.allGroups'), options: options(found.groups),
        onChange: (value) => { state.group = value; refresh(); },
      }),
      selectField({
        id: 'repeats-subject', label: t('repeat.filter.subject'), hideLabel: true, value: state.subject,
        placeholder: t('repeat.allSubjects'), options: options(found.subjects),
        onChange: (value) => { state.subject = value; refresh(); },
      }),
      selectField({
        id: 'repeats-state', label: t('repeat.filter.state'), hideLabel: true, value: state.state,
        options: REPEAT_STATES.map((value) => ({ value, label: t('repeat.state.' + value) })),
        onChange: (value) => { state.state = value; refresh(); },
      }),
      searchField({
        id: 'repeats-search', label: t('repeat.enrol.studentSearch'), value: state.query,
        onInput: (value) => { state.query = value; refresh(); },
      })),
    shown.length === 0 ? el('p', { class: 'lg-nomatch', id: 'repeats-nomatch' }, t('repeat.noMatch')) : table(shown));
}

function table(rows) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table lg-table rp-table', 'aria-labelledby': 'repeats-title' },
      el('thead', {}, el('tr', {},
        col(t('repeat.col.student')), col(t('repeat.col.subject')), col(t('repeat.col.kind')), col(t('repeat.col.order')), col(t('repeat.col.deadline')),
        col(t('repeat.col.teacher')), col(t('repeat.col.state')), col(t('repeat.col.total')), el('td', { class: 'lg-table__go' }))),
      el('tbody', {}, rows.map(row))));
}

export function totalCell(row) {
  if (row.total === null || row.total === undefined) return '—';
  return [el('span', { class: 'rp-total' }, String(row.total)), row.word ? badge(t('journal.grade.' + row.word), wordTone(row.word)) : null];
}

function row(r) {
  const mark = stateBadge(r);
  const order = orderLine(r.orderNo, r.orderDate);
  return el('tr', { class: 'lg-row', id: 'repeat-row-' + r.id },
    el('td', {}, el('span', { class: 'person' }, avatar(r.studentName), el('span', { class: 'person__text' },
      el('a', { class: 'lg-table__link person__name', id: 'repeat-open-' + r.id, href: '#/repeat/' + encodeURIComponent(r.id) }, r.studentName || '—'),
      el('span', { class: 'person__sub' }, r.groupName || '—')))),
    el('td', {}, el('span', { class: 'rp-subject-cell' }, r.subjectName || '—'), el('span', { class: 'person__sub rp-block' }, t('repeat.semesterOf', { n: r.planSemester }))),
    el('td', {}, t('repeat.kind.' + r.kind)),
    el('td', { class: 'rp-order' }, order ? t(order.key, order.params) : '—'),
    el('td', { class: 'rp-nowrap' }, dayOf(r.deadline) || '—'),
    el('td', {}, r.teacherName || '—'),
    el('td', {}, badge(t(mark.key), mark.tone, true)),
    el('td', {}, totalCell(r)),
    el('td', { class: 'lg-table__go' }, icon('chevron', 'lg-table__chevron')));
}

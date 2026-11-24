import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, avatarTone, badge, emptyState, note, pageHeader, searchField, selectField, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole } from '../shell.js';
import { examNote } from '../ledger.js';

// «Ведомости» (#/ledger): the subjects whose ledger the person opens (ledger.list). The teacher role sees its own subjects
// as cards; the deanery, the admin and the vice-rector see a table of every subject with a group filter and a search by
// name. Each subject carries one mark per unit («Юнит 1 — закрыт») and one for the final sheet. A row opens the ledger
// (#/ledger/<subjectId>). The line about the credit week stands above the list. The server checks every right itself.

const blank = () => ({
  data: null,          // the answer of ledger.list; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  groupName: '',       // the group chosen above the table; '' — every group
  query: '',           // the search by the name of the subject
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const teacher = activeRole(getUser()) === 'teacher';
  root.append(
    pageHeader({ id: 'ledgers-title', title: t('ledger.title'), lead: t(teacher ? 'ledger.list.leadTeacher' : 'ledger.list.leadOffice') }),
    state.data === null ? loadingBody() : body(teacher));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('ledger.list', {});
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
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

// The marks of a subject: its units and the final sheet.
function marks(row) {
  if (!row.hasSyllabus) return [badge(t('ledger.list.noSyllabus'), 'neutral')];
  return [
    ...row.units.map((u) => badge(t(u.closed ? 'ledger.state.unitClosed' : 'ledger.state.unitOpen', { n: u.unit }), u.closed ? 'success' : 'neutral', true)),
    badge(t(row.final ? 'ledger.state.finalClosed' : 'ledger.state.finalOpen'), row.final ? 'success' : 'neutral', true),
  ];
}

const groupsOf = (rows) => [...new Set(rows.map((row) => row.groupName))].filter(Boolean).map((value) => ({ value, label: value }));

function body(teacher) {
  const { data } = state;
  const rows = teacher ? data.subjects.filter((row) => row.own === true) : data.subjects;
  const week = examNote(data.examWeek, data.today, { closed: false });
  const weekLine = week ? note('info', t(week.key, week.params), { id: 'ledgers-exam-note' }) : null;
  if (rows.length === 0) {
    return el('div', { class: 'ledgers' }, weekLine, emptyState('table', el('p', { class: 'empty__title', id: 'ledgers-empty' }, t('ledger.list.empty'))));
  }
  if (teacher) return el('div', { class: 'ledgers' }, weekLine, el('ul', { class: 'lg-cards', 'aria-labelledby': 'ledgers-title' }, rows.map(card)));
  const groups = groupsOf(rows);
  if (!groups.some((g) => g.value === state.groupName)) state.groupName = '';
  const query = state.query.trim().toLocaleLowerCase();
  const shown = rows.filter((row) => (state.groupName === '' || row.groupName === state.groupName)
    && (query === '' || String(row.name).toLocaleLowerCase().includes(query)));
  return el('div', { class: 'ledgers' }, weekLine,
    el('section', { class: 'card table-card', 'aria-labelledby': 'ledgers-title' },
      el('div', { class: 'toolbar lg-toolbar' },
        selectField({
          id: 'ledgers-group', label: t('ledger.list.col.group'), hideLabel: true, value: state.groupName,
          placeholder: t('ledger.list.allGroups'), options: groups,
          onChange: (value) => { state.groupName = value; refresh(); },
        }),
        searchField({
          id: 'ledgers-search', label: t('ledger.list.search'), value: state.query,
          onInput: (value) => { state.query = value; refresh(); },
        })),
      shown.length === 0
        ? el('p', { class: 'lg-nomatch', id: 'ledgers-nomatch' }, t('ledger.list.noMatch'))
        : table(shown)));
}

// A card of the teacher's own subject: the name, the group and the marks.
function card(row) {
  return el('li', { class: 'lg-card' },
    el('a', { class: 'lg-card__link', id: 'ledger-open-' + row.subjectId, href: '#/ledger/' + encodeURIComponent(row.subjectId) },
      el('span', { class: 'lg-card__top' },
        el('span', { class: 'discipline', 'data-tone': avatarTone(row.name) },
          el('span', { class: 'discipline__swatch', 'aria-hidden': 'true' }),
          el('span', { class: 'discipline__name' }, `${row.name || '—'} · ${row.groupName || '—'}`)),
        icon('chevron', 'lg-card__chevron')),
      el('span', { class: 'lg-marks' }, marks(row))));
}

function table(rows) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table lg-table', 'aria-labelledby': 'ledgers-title' },
      el('thead', {}, el('tr', {},
        col(t('ledger.list.col.group')), col(t('ledger.list.col.subject')), col(t('ledger.list.col.teacher')), col(t('ledger.list.col.units')),
        el('td', { class: 'lg-table__go' }))),
      el('tbody', {}, rows.map((row) => el('tr', { class: 'lg-row' },
        el('td', {}, el('span', { class: 'group-chip' }, row.groupName || '—')),
        el('td', { class: 'lg-table__subject' },
          el('span', { class: 'discipline', 'data-tone': avatarTone(row.name) },
            el('span', { class: 'discipline__swatch', 'aria-hidden': 'true' }),
            el('a', { class: 'lg-table__link', id: 'ledger-open-' + row.subjectId, href: '#/ledger/' + encodeURIComponent(row.subjectId) },
              el('span', { class: 'discipline__name' }, row.name || '—')))),
        el('td', {}, el('span', { class: 'person' }, avatar(row.teacherName), el('span', { class: 'person__name' }, row.teacherName || '—'))),
        el('td', {}, el('span', { class: 'lg-marks' }, marks(row))),
        el('td', { class: 'lg-table__go' }, icon('chevron', 'lg-table__chevron')))))));
}

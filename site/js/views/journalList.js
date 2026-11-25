import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, avatarTone, badge, emptyState, pageHeader, selectField, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole } from '../shell.js';
import { listRows, listBadges } from '../journal.js';

// «Журналы» (#/journal): the subjects whose journal the person opens (journal.list). A row is a subject of a group:
// the group, the subject, its teacher (not for the teacher role: they are the teacher), how many pairs were held and
// how many still wait for marks. The whole row opens the journal of the subject (#/journal/<subjectId>).
// The teacher role sees its own subjects and those where it taught single pairs as a substitute (marked «замена»);
// the deanery, the admin and the vice-rector see every group and choose one above the table. Rows with pairs past
// their deadline carry a red rail, rows with pairs still open an amber one. The server checks every right itself.

const blank = () => ({
  data: null,          // the answer of journal.list; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  groupId: '',         // the group chosen above the table; '' — every group
  askedGroup: null,    // the group of the address the choice was already set from
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params = {}) {
  if (params.groupId !== undefined && state.askedGroup !== params.groupId) {
    state.askedGroup = params.groupId;
    state.groupId = params.groupId;   // a group that is not in the list is dropped when the table is drawn
  }
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const teacher = activeRole(getUser()) === 'teacher';
  root.append(
    pageHeader({ id: 'journals-title', title: t('journal.list.title'), lead: t(teacher ? 'journal.list.leadTeacher' : 'journal.list.leadOffice') }),
    state.data === null ? loadingBody() : body(teacher));
}

// Reads the list; the table on screen stays until the new one comes.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('journal.list', {});
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

// The groups of the list, in its order (the server sorts by group), each once.
function groupsOf(rows) {
  const seen = new Map();
  for (const row of rows) if (!seen.has(row.groupId)) seen.set(row.groupId, row.groupName || '—');
  return [...seen].map(([value, label]) => ({ value, label }));
}

function body(teacher) {
  const rows = listRows(state.data.subjects, teacher ? 'teacher' : 'office');
  if (rows.length === 0) {
    return emptyState('table', el('p', { class: 'empty__title', id: 'journals-empty' }, t('journal.list.empty')));
  }
  const groups = teacher ? [] : groupsOf(rows);
  if (!groups.some((group) => group.value === state.groupId)) state.groupId = '';
  const shown = state.groupId === '' ? rows : rows.filter((row) => row.groupId === state.groupId);
  return el('section', { class: 'card table-card journals', 'aria-labelledby': 'journals-title' },
    teacher ? null : el('div', { class: 'toolbar journals__toolbar' },
      selectField({
        id: 'journals-group', label: t('field.groupId'), hideLabel: true, value: state.groupId,
        placeholder: t('journal.list.allGroups'), options: groups,
        onChange: (value) => { state.groupId = value; refresh(); },
      })),
    table(shown, teacher));
}

function table(rows, teacher) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table journals-table' + (teacher ? ' journals-table--teacher' : ''), 'aria-labelledby': 'journals-title' },
      el('thead', {}, el('tr', {},
        col(t('journal.list.col.group')),
        col(t('journal.list.col.subject')),
        teacher ? null : col(t('journal.list.col.teacher')),
        col(t('journal.list.col.held'), 'num'),
        col(t('journal.list.col.unfilled')),
        el('td', { class: 'journals-table__go' }))),
      el('tbody', {}, rows.map((row) => line(row, teacher)))));
}

// One subject. The name is the link; its box covers the whole row, so the row answers the pointer like a link.
function line(row, teacher) {
  const badges = listBadges(row);
  const tone = badges.some((b) => b.tone === 'danger') ? ' is-overdue' : badges.length > 0 ? ' is-unfilled' : '';
  const cover = teacher && row.covers === true && row.own !== true;
  return el('tr', { class: 'journals-row' + tone },
    el('td', { class: 'journals-table__group' }, el('span', { class: 'group-chip' }, row.groupName || '—')),
    el('td', { class: 'journals-table__subject' },
      el('span', { class: 'journals-table__name' },
        el('span', { class: 'discipline', 'data-tone': avatarTone(row.name) },
          el('span', { class: 'discipline__swatch', 'aria-hidden': 'true' }),
          el('a', { class: 'journals-table__link', id: 'journal-open-' + row.subjectId, href: '#/journal/' + row.subjectId },
            el('span', { class: 'discipline__name' }, row.name || '—'))),
        cover ? badge(t('journal.list.cover'), 'neutral') : null)),
    teacher ? null : el('td', {}, el('span', { class: 'person' }, avatar(row.teacherName),
      el('span', { class: 'person__name' }, row.teacherName || '—'))),
    el('td', { class: 'num journals-table__held' }, String(row.held ?? 0)),
    el('td', { class: 'journals-table__state' }, badges.length > 0
      ? el('span', { class: 'journals-table__badges' }, badges.map((b) => badge(t(b.key, b.params), b.tone, true)))
      : el('span', { class: 'journals-table__filled' }, icon('check'), t('journal.list.filled'))),
    el('td', { class: 'journals-table__go' }, icon('chevron', 'journals-table__chevron')));
}

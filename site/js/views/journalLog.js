import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, field, focusById, note, pageHeader, selectField, refresh } from '../ui.js';
import { isDate, addDays } from '../dates.js';
import { logLine } from '../journal.js';

// «Журнал изменений» (#/journal-log, #/journal-log/<subjectId>): every change of a saved mark or of the points of a unit
// (journal.log), the newest first. The whole log is for the deanery, the admin and the vice-rector; the log of one subject
// also for its teacher. The first request goes without dates: the answer carries «today» of the server, and the dates
// «last 30 days» are counted from it (the clock of the device is not trusted); every next request carries the dates.
// The group chooses the subjects of the list below it and narrows the rows; the subject goes to the server. Reasons and
// names are only ever text. The server checks every right; a refusal is shown as the usual «no rights» state.

const PAGE = 200;
const MAX = 500;

const blank = (subjectId = null) => ({
  subjectId,           // the log of one subject (the address), or null
  data: null,          // the answer of journal.log; null until it comes
  list: [],            // the subjects of journal.list (names for the filters and the heading); [] if it did not come
  from: '', to: '',    // '' until the first answer brings «today»
  groupId: '', pickedSubjectId: '',
  limit: PAGE,
  loading: false,
  errorKey: null,
  ticket: 0,
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.subjectId !== (params.subjectId || null)) state = blank(params.subjectId || null);
  if (state.data === null && !state.loading && state.errorKey === null) start();
  const own = state.subjectId ? state.list.find((s) => s.subjectId === state.subjectId) : null;
  root.append(
    pageHeader({
      id: 'jlog-title',
      title: own ? `${own.name} · ${own.groupName}` : t('journalLog.title'),
      lead: t(state.subjectId ? 'journalLog.leadSubject' : 'journalLog.lead'),
      actions: state.subjectId ? el('a', { class: 'button button--secondary', id: 'jlog-back', href: '#/journal/' + state.subjectId }, t('journalLog.back')) : null,
    }),
    state.data === null ? loadingBody() : body());
}

// The first request: no dates, and the list of subjects beside it for the names. Then the dates are set and, if the
// rows shown do not all fall in them, the log is read again with them.
async function start() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const [data, list] = await Promise.all([
      call('journal.log', owner.subjectId ? { subjectId: owner.subjectId } : {}),
      call('journal.list', {}).catch(() => ({ subjects: [] })),
    ]);
    if (state !== owner || owner.ticket !== ticket) return;
    owner.list = Array.isArray(list.subjects) ? list.subjects : [];
    owner.to = data.today;
    owner.from = addDays(data.today, -30);
    const inRange = data.rows.every((row) => String(row.at).slice(0, 10) >= owner.from);
    owner.errorKey = null;
    if (data.more || !inRange) {
      owner.loading = false;
      load();
      return;
    }
    owner.data = data;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function query() {
  const data = { limit: state.limit };
  if (isDate(state.from)) data.from = state.from;
  if (isDate(state.to)) data.to = state.to;
  const subjectId = state.subjectId || state.pickedSubjectId;
  if (subjectId) data.subjectId = subjectId;
  return data;
}

// Reads the log with the filters; the table on screen stays until the new one comes.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('journal.log', query());
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorKey: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.errorKey = null;
  if (state.data === null && state.from === '') start(); else load();
  refresh();
}

function loadingBody() {
  if (!state.errorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.errorKey)),
    state.errorKey === errorKey('forbidden') ? null
      : el('button', { type: 'button', id: 'jlog-retry', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function change(filters, focusId) {
  state.limit = PAGE;
  Object.assign(state, filters);
  load();
  refresh();
  focusById(focusId);
}

function groupsOf() {
  const seen = new Map();
  for (const s of state.list) if (!seen.has(s.groupId)) seen.set(s.groupId, s.groupName || '—');
  return [...seen].map(([value, label]) => ({ value, label }));
}

function toolbar() {
  const subjects = state.list.filter((s) => state.groupId === '' || s.groupId === state.groupId);
  const whole = !state.subjectId;
  return el('div', { class: 'toolbar jlog__toolbar' },
    field({ id: 'jlog-from', label: t('journalLog.from'), type: 'date', value: state.from, onInput: (value) => { if (isDate(value)) change({ from: value }, 'jlog-from'); } }),
    field({ id: 'jlog-to', label: t('journalLog.to'), type: 'date', value: state.to, onInput: (value) => { if (isDate(value)) change({ to: value }, 'jlog-to'); } }),
    whole ? selectField({
      id: 'jlog-group', label: t('journalLog.group'), value: state.groupId, placeholder: t('journalLog.allGroups'), options: groupsOf(),
      onChange: (value) => change({ groupId: value, pickedSubjectId: '' }, 'jlog-group'),
    }) : null,
    whole ? selectField({
      id: 'jlog-subject', label: t('journalLog.subject'), value: state.pickedSubjectId, placeholder: t('journalLog.allSubjects'),
      options: subjects.map((s) => ({ value: s.subjectId, label: state.groupId === '' ? `${s.name} · ${s.groupName}` : s.name })),
      onChange: (value) => change({ pickedSubjectId: value }, 'jlog-subject'),
    }) : null);
}

function body() {
  let rows = state.data.rows;
  // A group without a subject chosen: the server has no group filter, so the rows of other groups are left out here.
  if (!state.subjectId && state.pickedSubjectId === '' && state.groupId !== '') {
    const ids = new Set(state.list.filter((s) => s.groupId === state.groupId).map((s) => s.subjectId));
    rows = rows.filter((row) => ids.has(row.subjectId));
  }
  const canMore = state.data.more && state.limit < MAX;
  return el('section', { class: 'card table-card jlog', 'aria-labelledby': 'jlog-title' },
    toolbar(),
    state.errorKey ? el('div', { class: 'reload-failed', role: 'alert' },
      note('error', t(state.errorKey)),
      el('button', { type: 'button', id: 'jlog-retry', class: 'button button--secondary', onclick: retry }, t('common.retry'))) : null,
    rows.length === 0
      ? el('div', { class: 'jlog__empty' }, emptyState('checkCircle',
        el('p', { class: 'empty__title', id: 'jlog-empty' }, t('journalLog.empty')),
        el('p', {}, t('journalLog.emptyHint'))))
      : table(rows),
    canMore ? el('div', { class: 'jlog__more' },
      el('button', { type: 'button', id: 'jlog-more', class: 'button button--secondary', onclick: () => { state.limit = Math.min(state.limit + PAGE, MAX); load(); } },
        t('journalLog.more'))) : null);
}

const dayText = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
const stamp = (at) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(at) ? `${dayText(at)} ${at.slice(11, 16)}` : String(at || '—'));

function table(rows) {
  const col = (key) => el('th', { scope: 'col' }, t('journalLog.col.' + key));
  const whole = !state.subjectId;
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table jlog-table' + (whole ? '' : ' jlog-table--subject'), 'aria-labelledby': 'jlog-title' },
      el('thead', {}, el('tr', {},
        col('when'), col('who'), whole ? col('subject') : null, col('student'), col('pair'), col('change'), col('reason'))),
      el('tbody', {}, rows.map((row) => line(row, whole)))));
}

// One change. A pair that no longer exists (its date is empty) shows a dash.
function line(row, whole) {
  const text = logLine(row);
  const params = { ...text.params };
  for (const name of text.keyParams) params[name] = t(params[name]);
  return el('tr', { class: 'jlog-row' + (row.late ? ' is-late' : '') },
    el('td', { class: 'jlog-table__when' }, stamp(row.at)),
    el('td', {}, row.actorName
      ? el('span', { class: 'person' }, avatar(row.actorName), el('span', { class: 'person__name' }, row.actorName))
      : '—'),
    whole ? el('td', { class: 'jlog-table__subject' }, el('div', { class: 'jlog-table__stack' },
      el('span', { class: 'jlog-table__name' }, row.subjectName || '—'),
      row.groupName ? el('span', { class: 'group-chip' }, row.groupName) : null)) : null,
    el('td', {}, row.studentName || '—'),
    el('td', { class: 'jlog-table__pair' }, isDate(row.pairDate) ? t('journalLog.pairWhen', { date: dayText(row.pairDate).slice(0, 5), slot: row.pairSlot }) : '—'),
    el('td', { class: 'jlog-table__change' }, el('div', { class: 'jlog-table__stack' },
      el('span', {}, t(text.key, params)),
      row.late ? badge(t('journal.log.late'), 'warning') : null)),
    el('td', { class: 'jlog-table__reason' }, row.reason || '—'));
}

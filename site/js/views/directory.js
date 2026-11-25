import { call, RETRYABLE } from '../api.js';
import { getUser } from '../session.js';
import { t, getLang, LANGS, DEFAULT_LANG } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, hasText, field, selectField, searchField, switchField, checkGroup,
  modal, showModal, focusById, focusFirstInvalid, markBusy, refresh,
  avatar, badge, emptyState, iconButton, note, pageHeader,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { DIRECTORIES, FIELDS, STAFF_ROLES } from './directoryConfig.js';
import { cardHref, infoById, groupNowLabel, roomNowLabel, syllabusCountBadges, termNote } from '../dirInfo.js';

// One directory (#/dir/<table>): a table with search, and dialogs to add, edit, delete and issue a new
// password. Drawn from `state`, so a redraw (language switch, texts from the sheet) keeps typed values and an
// open dialog. Leaving the screen drops everything, including a temporary password that is still on screen.

const blank = (table) => ({
  table,
  rows: null,          // this directory's rows; null until loaded
  refs: {},            // rows of the directories this one shows by name: { groups, staff }
  loadErrorKey: null,
  summary: null,       // the answer of dir.summary (figures of the extra columns); null: none, see summaryFailed
  info: null,          // the same by record id
  summaryFailed: false,
  askedEdit: null,     // the id of the record whose edit window the address already opened
  askedGroup: null,    // the group of the address the filter was already set from
  query: '',
  groupFilter: '',
  status: null,        // { key, params }: what the last action did
  freshId: null,       // the record saved last, marked in the table
  dialog: null,        // { kind: 'edit' | 'remove' | 'reset' | 'password', ... }; an edit opened by address has `back`
});
let state = blank(null);

const can = (action, table) => permissions().includes(`${action}:${table}`);
const wantsInfo = (table) => DIRECTORIES[table].extra !== undefined && can('dir.summary', table);

export function leave() {
  state = blank(null);
}

export function render(root, params) {
  if (state.table !== params.table) {
    state = blank(params.table);
    load(state);
  }
  applyAddress(params);
  const { table } = state;
  const add = state.rows !== null && can('dir.save', table)
    ? el('button', { type: 'button', id: 'dir-add', class: 'button button--primary', onclick: () => openEdit(null) }, icon('plus'), t(`dir.${table}.add`))
    : null;
  root.append(
    pageHeader({ id: 'dir-title', title: t('dir.' + table), lead: t(`dir.${table}.hint`), actions: add }),
    state.rows === null ? loadingBody() : listing());
  if (state.dialog) showModal(root, dialogFor(state.dialog));
}

async function load(owner) {
  const { table } = owner;
  const refs = DIRECTORIES[table].refs.filter((ref) => can('dir.list', ref));
  try {
    // The figures are an extra: if they fail, the plain list is still shown.
    const summary = wantsInfo(table) ? call('dir.summary', { table }).catch(() => null) : Promise.resolve(undefined);
    const [main, ...others] = await Promise.all([table, ...refs].map((name) => call('dir.list', { table: name })));
    const figures = await summary;
    if (state !== owner) return;
    owner.rows = main.rows;
    refs.forEach((ref, i) => { owner.refs[ref] = others[i].rows; });
    setSummary(owner, figures);
    owner.loadErrorKey = null;
  } catch (error) {
    if (state !== owner) return;
    owner.loadErrorKey = errorKey(error.code);
  }
  refresh();
}

function setSummary(owner, figures) {
  owner.summary = figures ?? null;
  owner.info = infoById(owner.summary);
  owner.summaryFailed = figures === null;
}

// After a record was added or removed the figures are read again; a failure leaves the old ones.
async function reloadSummary(owner) {
  if (!wantsInfo(owner.table)) return;
  try {
    const figures = await call('dir.summary', { table: owner.table });
    if (state !== owner) return;
    setSummary(owner, figures);
    refresh();
  } catch (error) { /* the figures stay as they were */ }
}

// What the address asks for, once per value: the edit window of a record, a group to filter the students by.
function applyAddress(params) {
  if (state.rows === null) return;
  const { table } = state;
  if (params.editId === undefined) state.askedEdit = null;
  else if (state.askedEdit !== params.editId) {
    state.askedEdit = params.editId;
    const row = state.rows.find((item) => item.id === params.editId);
    if (row && can('dir.save', table)) state.dialog = editState(row, cardHref(table, row.id));
    else location.replace('#/dir/' + table);
  }
  if (params.groupId !== undefined && state.askedGroup !== params.groupId) {
    state.askedGroup = params.groupId;
    if (DIRECTORIES[table].groupFilter) state.groupFilter = (state.refs.groups ?? []).some((group) => group.id === params.groupId) ? params.groupId : '';
  }
}

function retry() {
  state.loadErrorKey = null;
  load(state);
  refresh();
}

function loadingBody() {
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const body = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// Helpers over the loaded rows

const rolesOf = (value) => String(value ?? '').split(',').map((role) => role.trim()).filter(Boolean);
const findRef = (table, id) => (state.refs[table] ?? []).find((row) => row.id === id);
const isPerson = (table) => DIRECTORIES[table].login !== undefined;
const nameOf = (row) => String(row[DIRECTORIES[state.table].label] ?? '');

function collator() {
  return new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' });
}

function sortBy(rows, key) {
  const compare = collator().compare;
  return [...rows].sort((a, b) => compare(String(a[key] ?? ''), String(b[key] ?? '')));
}

function sortedRows() {
  const compare = collator().compare;
  const label = DIRECTORIES[state.table].label;
  const groupName = (row) => findRef('groups', row.groupId)?.name ?? '';
  return [...state.rows].sort((a, b) => compare(String(a[label] ?? ''), String(b[label] ?? ''))
    || compare(groupName(a), groupName(b)));
}

const groupOptions = () => sortBy(state.refs.groups ?? [], 'name').map((group) => ({ value: group.id, label: group.name }));

// Active staff with the teacher role; the subject's current teacher stays in the list even if that changed.
function teacherOptions(currentId) {
  const teachers = (state.refs.staff ?? [])
    .filter((person) => (person.active === true && rolesOf(person.roles).includes('teacher')) || person.id === currentId);
  return sortBy(teachers, 'fullName').map((person) => ({ value: person.id, label: person.fullName }));
}

// What a cell shows: references by name, languages and roles by their translated names.
function display(key, row) {
  const value = row[key];
  const missing = () => el('span', { class: 'muted' }, value ? String(value) : '—');
  if (key === 'groupId') {
    const group = findRef('groups', value);
    return group ? badge(group.name, 'primary') : missing();
  }
  if (key === 'teacherId') {
    const person = findRef('staff', value);
    return person ? person.fullName : missing();
  }
  if (key === 'lang') return LANGS.includes(value) ? t('lang.name.' + value) : String(value ?? '');
  if (key === 'roles') {
    return el('span', { class: 'badges' }, rolesOf(value).map((role) => badge(STAFF_ROLES.includes(role) ? t('role.' + role) : role)));
  }
  return String(value ?? '');
}

const cellClass = (key) => (FIELDS[key].kind === 'number' ? 'num' : null);

// A person: initials, the name, and under it the login or student ID they sign in with.
function personCell(row, nameId, loginKey) {
  const name = nameOf(row);
  return el('span', { class: 'person' },
    avatar(name),
    el('span', { class: 'person__text' },
      el('span', { class: 'person__name', id: nameId }, name),
      el('span', { class: 'person__sub' }, String(row[loginKey] ?? ''))));
}

// Whether a person can sign in, and whether they still have a temporary password.
function statusCell(row) {
  return el('span', { class: 'badges' },
    row.active === true ? badge(t('field.active'), 'success', true) : badge(t('dir.inactive'), 'neutral', true),
    row.active === true && row.mustChangePassword === true ? badge(t('dir.mustChange'), 'warning') : null);
}

// The table

function listing() {
  const { table } = state;
  const config = DIRECTORIES[table];
  const user = getUser();
  const rights = {
    save: can('dir.save', table),
    remove: can('dir.remove', table),
    reset: isPerson(table) && can('dir.resetPassword', table),
  };
  const withActions = rights.save || rights.remove || rights.reset;
  const isSelf = (row) => table === 'staff' && user.kind === 'staff' && row.id === user.id;
  const columns = shownColumns();
  const extra = extraKeys();

  const lines = sortedRows().map((row) => line(row, { ...rights, remove: rights.remove && !isSelf(row) }, withActions));
  const columnCount = columns.length + extra.length + (isPerson(table) ? 1 : 0) + (withActions ? 2 : 1);
  const nothing = el('tr', { hidden: true }, el('td', { class: 'table__nothing', colspan: columnCount }, t('dir.nothingFound')));
  const count = el('p', { class: 'toolbar__count', 'aria-live': 'polite' });

  // Search and the group filter only hide rows; nothing is redrawn while typing.
  const applyFilter = () => {
    const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const item of lines) {
      const visible = (!state.groupFilter || item.groupId === state.groupFilter) && words.every((word) => item.text.includes(word));
      item.tr.hidden = !visible;
      if (visible) item.number.textContent = String(++shown);
    }
    nothing.hidden = shown > 0;
    count.textContent = shown === lines.length
      ? t('dir.count', { count: lines.length })
      : t('dir.shown', { shown, count: lines.length });
  };

  const term = termNote(state.summary);
  const notes = el('div', { class: 'notes', role: 'status' },
    state.status ? note('success', t(state.status.key, state.status.params)) : null,
    state.summaryFailed ? note('info', t('dir.info.unavailable')) : null,
    term && extra.length > 0 ? note('info', t(term.key, term.params)) : null);

  if (lines.length === 0) {
    return el('div', { class: 'stack' },
      notes,
      emptyState('sheet',
        el('p', { class: 'empty__title' }, t('dir.empty')),
        rights.save ? el('p', {}, t('dir.emptyHint')) : null,
        can('import.apply', table) ? el('a', { class: 'button button--secondary', href: '#/import' }, icon('sheetUp'), t('import.title')) : null));
  }

  const toolbar = el('div', { class: 'toolbar' },
    searchField({ id: 'dir-search', label: t('dir.search'), value: state.query, onInput: (value) => { state.query = value; applyFilter(); } }),
    config.groupFilter ? selectField({
      id: 'dir-group', label: t('field.groupId'), value: state.groupFilter, placeholder: t('dir.allGroups'), hideLabel: true,
      options: groupOptions(), onChange: (value) => { state.groupFilter = value; applyFilter(); },
    }) : null,
    count);

  const head = el('tr', {},
    el('th', { scope: 'col', class: 'table__num' }, t('dir.number')),
    columns.map((key) => el('th', { scope: 'col', class: cellClass(key) }, t('field.' + key))),
    extra.map((key) => el('th', { scope: 'col', class: extraClass(key) }, key === 'now' ? t('dir.col.now', { time: state.summary.time }) : t('dir.col.' + key))),
    isPerson(table) ? el('th', { scope: 'col' }, t('dir.status')) : null,
    withActions ? el('th', { scope: 'col', class: 'table__actions' }, el('span', { class: 'visually-hidden' }, t('dir.actions'))) : null);
  const tableEl = el('div', { class: 'table-scroll' },
    el('table', { class: 'table', 'aria-labelledby': 'dir-title' },
      el('thead', {}, head),
      el('tbody', {}, lines.map((item) => item.tr), nothing)));

  applyFilter();
  return el('div', { class: 'stack' }, notes, el('section', { class: 'card table-card' }, toolbar, tableEl));
}

// Columns of the table. A person's login or student ID is shown under their name, not in a column of its own.
function shownColumns() {
  const config = DIRECTORIES[state.table];
  return config.columns.filter((key) => key !== config.login);
}

// The extra columns (figures of dir.summary); none when the answer is missing.
const extraKeys = () => (state.info === null ? [] : DIRECTORIES[state.table].extra ?? []);
const extraClass = (key) => (key === 'students' || key === 'weekPairs' ? 'num' : 'dir-wrap');

const muted = (text) => el('span', { class: 'muted' }, text);

function extraCell(key, info) {
  if (!info) return muted('—');
  if (key === 'students') {
    return el('span', {}, String(info.students), info.inactive > 0 ? el('span', { class: 'muted dir-inactive' }, ' ' + t('dir.inactiveShort', { count: info.inactive })) : null);
  }
  if (key === 'weekPairs') return String(info.weekPairs);
  if (key === 'disciplines') return info.disciplines.length > 0 ? info.disciplines.join(', ') : muted(t('dir.none'));
  if (key === 'now') {
    const label = state.table === 'rooms' ? roomNowLabel(info.now) : groupNowLabel(info.now);
    return badge(t(label.key, label.params), label.tone, true);
  }
  if (key === 'top') return info.top ? `${info.top.groupNames.join(', ')} · ${info.top.disciplineName}` : muted(t('dir.noPairs'));
  if (key === 'teachers') {
    if (info.teachers.length === 0) return muted(t('dir.nowhere'));
    return el('span', { class: 'dir-teachers' }, info.teachers.map((item, i) => el('span', { class: i === 0 ? 'dir-teachers__line' : 'dir-teachers__line muted' },
      `${item.groupNames.join(', ')} — ${item.teacherName}`)));
  }
  return el('span', { class: 'dir-syllabi' }, syllabusCountBadges(info.syllabi).map((item) => badge(t(item.key, { count: item.count }), item.tone)));
}

function line(row, rights, withActions) {
  const config = DIRECTORIES[state.table];
  const person = isPerson(state.table);
  const nameId = 'dir-name-' + row.id;
  const keys = shownColumns();
  const linked = config.card === true && can('dir.card', state.table);
  const nameCell = () => (linked
    ? el('a', { class: 'table__label dir-link', id: nameId, href: cardHref(state.table, row.id) }, display(config.label, row))
    : el('span', { class: 'table__label', id: nameId }, display(config.label, row)));
  const cells = keys.map((key) => el('td', { class: cellClass(key) },
    key !== config.label ? display(key, row)
      : person ? personCell(row, nameId, config.login)
        : nameCell()));
  const figures = extraKeys().map((key) => el('td', { class: extraClass(key) }, extraCell(key, state.info.get(row.id))));
  const status = person ? el('td', {}, statusCell(row)) : null;
  const action = (kind, iconName, textKey, onClick, extra = '') => iconButton({
    id: `dir-${kind}-${row.id}`, iconName, label: t(textKey), onClick, className: 'row-action' + extra, attrs: { 'aria-describedby': nameId },
  });
  const actions = withActions ? el('td', { class: 'table__actions' },
    rights.save ? action('edit', 'pencil', 'common.edit', () => openEdit(row)) : null,
    rights.reset ? action('reset', 'key', 'dir.resetPassword', () => openConfirm('reset', row)) : null,
    rights.remove ? action('remove', 'trash', 'common.remove', () => openConfirm('remove', row), ' row-action--danger') : null) : null;
  const number = el('td', { class: 'table__num' });
  const classes = [person && row.active !== true ? 'is-inactive' : '', row.id === state.freshId ? 'is-fresh' : ''];
  const tr = el('tr', { class: classes.filter(Boolean).join(' ') || null }, number, cells, figures, status, actions);
  // Searchable text: what the cells say, without the initials of the avatar.
  const words = keys.map((key, i) => (key === config.label ? nameOf(row) : cells[i].textContent));
  if (person) words.push(String(row[config.login] ?? ''), status.textContent);
  return { tr, number, groupId: row.groupId ?? '', text: words.join(' ').toLowerCase() };
}

// Dialogs

function dialogFor(d) {
  if (d.kind === 'edit') return editDialog(d);
  if (d.kind === 'password') return passwordDialog(d);
  return confirmDialog(d);
}

function closeDialog() {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  if (d.back) {
    location.replace(d.back);
    return;
  }
  refresh();
  focusById(d.returnId, 'dir-add', 'dir-search');
}

function editState(row, back = null) {
  const values = {};
  for (const key of DIRECTORIES[state.table].form) values[key] = initialValue(key, row);
  return {
    kind: 'edit', row, values, fieldErrors: {}, messageKey: null, busy: false, back,
    returnId: row ? 'dir-edit-' + row.id : 'dir-add',
  };
}

function openEdit(row) {
  state.status = null;
  state.freshId = null;
  state.dialog = editState(row);
  refresh();
}

function initialValue(key, row) {
  const value = row ? row[key] : undefined;
  const kind = FIELDS[key].kind;
  if (kind === 'roles') return rolesOf(value);
  if (kind === 'active') return value === true;
  if (kind === 'lang') return LANGS.includes(value) ? value : DEFAULT_LANG;
  if (kind === 'group' && !row) return state.groupFilter;
  return value === undefined || value === null ? '' : String(value);
}

// Fields shown in the form: "active" only for a record that already exists (a new person is active).
const formKeys = (d) => DIRECTORIES[state.table].form.filter((key) => !(FIELDS[key].existingOnly && d.row === null));

function editDialog(d) {
  const { table } = state;
  const isNew = d.row === null;
  const submit = el('button', { type: 'submit', id: 'dir-save', class: 'button button--primary' }, t('common.save'));
  if (d.busy) markBusy(submit, 'common.saving');
  const dialog = modal({ id: 'dir-dialog', labelledBy: 'dir-dialog-title', onClose: closeDialog, canCancel: () => !d.busy },
    el('p', { class: 'dialog__kicker' }, isNew ? t('dir.' + table) : t('dir.editing')),
    el('h2', { class: 'dialog__title', id: 'dir-dialog-title' }, isNew ? t(`dir.${table}.new`) : nameOf(d.row)),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); save(d); } },
      formKeys(d).map((key) => formField(key, d)),
      d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } }, t('common.cancel')),
        submit)));
  return dialog;
}

function formField(key, d) {
  const def = FIELDS[key];
  const id = 'dir-field-' + key;
  const label = t('field.' + key);
  const value = d.values[key];
  const error = d.fieldErrors[key] ?? null;
  const hint = hasText(`field.${key}.hint`) ? t(`field.${key}.hint`) : null;
  const set = (next) => { d.values[key] = next; };
  if (def.kind === 'number') {
    return field({ id, label, type: 'number', value, hint, error, onInput: set, attrs: { min: def.min, max: def.max, step: 1, inputmode: 'numeric' } });
  }
  if (def.kind === 'group' || def.kind === 'teacher') {
    const options = def.kind === 'group' ? groupOptions() : teacherOptions(value);
    return selectField({
      id, label, value, options, error, onChange: set,
      placeholder: t(`field.${key}.choose`),
      hint: options.length > 0 ? hint : t(`field.${key}.none`),
    });
  }
  if (def.kind === 'lang') {
    return selectField({ id, label, value, hint, error, onChange: set, options: LANGS.map((lang) => ({ value: lang, label: t('lang.name.' + lang) })) });
  }
  if (def.kind === 'roles') {
    return checkGroup({ id, legend: label, values: value, error, onChange: set, options: STAFF_ROLES.map((role) => ({ value: role, label: t('role.' + role) })) });
  }
  if (def.kind === 'active') return switchField({ id, label, checked: value, hint, error, onChange: set });
  const plain = def.id ? { autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', class: 'field__input field__input--mono' } : {};
  return field({ id, label, value, hint, error, onInput: set, attrs: { maxlength: def.maxLength, autocomplete: 'off', ...plain } });
}

function rowToSave(d) {
  const row = d.row ? { id: d.row.id } : {};
  for (const key of formKeys(d)) {
    const value = d.values[key];
    row[key] = FIELDS[key].kind === 'roles' ? value.join(',') : typeof value === 'string' ? value.trim() : value;
  }
  return row;
}

async function save(d) {
  if (d.busy || state.dialog !== d) return;
  const owner = state;
  const { table } = owner;
  const config = DIRECTORIES[table];
  d.messageKey = null;
  d.fieldErrors = {};
  for (const key of formKeys(d)) {
    if (FIELDS[key].required && String(d.values[key]).trim() === '') d.fieldErrors[key] = 'error.required';
  }
  if (Object.keys(d.fieldErrors).length > 0) {
    refresh();
    focusFirstInvalid();
    return;
  }

  d.busy = true;
  refresh();
  try {
    const data = await call('dir.save', { table, row: rowToSave(d) });
    if (state !== owner) return;
    const saved = data.row;
    owner.rows = d.row ? owner.rows.map((row) => (row.id === saved.id ? saved : row)) : [...owner.rows, saved];
    owner.freshId = saved.id;
    const name = String(saved[config.label] ?? '');
    if (data.tempPassword) {
      // Shown even if the form was closed while saving: this is the only time the password exists in plain text.
      owner.dialog = {
        kind: 'password', name, login: String(saved[config.login] ?? ''), tempPassword: data.tempPassword,
        copied: null, returnId: 'dir-edit-' + saved.id,
      };
      refresh();
      return;
    }
    owner.dialog = null;
    if (d.back) {
      location.replace(d.back);
      return;
    }
    owner.status = { key: 'dir.saved', params: { name } };
    if (!d.row) reloadSummary(owner);
    refresh();
    focusById('dir-edit-' + saved.id, 'dir-add');
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    if (owner.dialog !== d) return;
    showSaveError(d, error);
    refresh();
    focusFirstInvalid();
  }
}

// Field errors go next to their fields; anything else is one line above the buttons. The typed values stay.
function showSaveError(d, error) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  if (fields.length === 0) {
    d.messageKey = errorKey(error.code);
    return;
  }
  const shown = formKeys(d);
  for (const { field: name, code } of fields) {
    if (shown.includes(name)) d.fieldErrors[name] = fieldErrorKey(state.table, name, code);
  }
  if (Object.keys(d.fieldErrors).length === 0) d.messageKey = fieldErrorKey(state.table, fields[0].field, fields[0].code);
}

function openConfirm(kind, row) {
  state.status = null;
  state.freshId = null;
  state.dialog = { kind, row, messageKey: null, blocked: false, busy: false, returnId: `dir-${kind}-${row.id}` };
  refresh();
}

function confirmDialog(d) {
  const remove = d.kind === 'remove';
  const name = nameOf(d.row);
  const confirmButton = el('button', {
    type: 'button', id: 'dir-confirm', class: 'button ' + (remove ? 'button--danger' : 'button--primary'),
    onclick: () => (remove ? removeRow(d) : resetPassword(d)),
  }, t(remove ? 'common.remove' : 'dir.resetConfirm'));
  if (d.busy) markBusy(confirmButton, remove ? 'dir.removing' : 'dir.resetting');
  const dialog = modal({ id: 'dir-dialog', labelledBy: 'dir-dialog-title', className: 'dialog--confirm', onClose: closeDialog, canCancel: () => !d.busy },
    el('h2', { class: 'dialog__title', id: 'dir-dialog-title' }, t(remove ? 'dir.removeTitle' : 'dir.resetTitle')),
    el('p', {}, t(remove ? 'dir.removeText' : 'dir.resetText', { name })),
    remove && isPerson(state.table) && !d.blocked ? el('p', { class: 'dialog__note' }, t('dir.removeInactive')) : null,
    d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } },
        t(d.blocked ? 'common.close' : 'common.cancel')),
      d.blocked ? null : confirmButton));
  return dialog;
}

// A failed delete or reset explains itself in the dialog. When trying again cannot help, only "Close" stays.
function showConfirmError(d, error) {
  const { table } = state;
  const fields = Array.isArray(error.fields) ? error.fields : [];
  if (error.code === 'in_use') d.messageKey = hasText(`dir.inUse.${table}`) ? `dir.inUse.${table}` : 'error.in_use';
  else if (error.code === 'invalid' && fields.length > 0) d.messageKey = fieldErrorKey(table, fields[0].field, fields[0].code);
  else d.messageKey = errorKey(error.code);
  d.blocked = !RETRYABLE.includes(error.code);
  if (error.code === 'not_found') state.rows = state.rows.filter((row) => row.id !== d.row.id);
}

async function removeRow(d) {
  if (d.busy || state.dialog !== d) return;
  const owner = state;
  const name = nameOf(d.row);
  d.busy = true;
  d.messageKey = null;
  refresh();
  try {
    await call('dir.remove', { table: owner.table, id: d.row.id });
    if (state !== owner) return;
    owner.rows = owner.rows.filter((row) => row.id !== d.row.id);
    owner.dialog = null;
    owner.status = { key: 'dir.removed', params: { name } };
    reloadSummary(owner);
    refresh();
    focusById('dir-add', 'dir-search');
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    showConfirmError(d, error);
    refresh();
  }
}

async function resetPassword(d) {
  if (d.busy || state.dialog !== d) return;
  const owner = state;
  const config = DIRECTORIES[owner.table];
  d.busy = true;
  d.messageKey = null;
  refresh();
  try {
    const data = await call('dir.resetPassword', { table: owner.table, id: d.row.id });
    if (state !== owner) return;
    owner.dialog = {
      kind: 'password', name: nameOf(d.row), login: String(d.row[config.login] ?? ''), tempPassword: data.tempPassword,
      copied: null, returnId: d.returnId,
    };
    refresh();
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    showConfirmError(d, error);
    refresh();
  }
}

// The one-time password. It lives only in this dialog's state and is gone when it closes.
function passwordDialog(d) {
  const secret = el('span', { class: 'slip__secret', id: 'slip-secret' }, d.tempPassword);
  const copied = el('p', { class: 'slip__status', 'aria-live': 'polite' }, d.copied ? t(d.copied) : '');
  const dialog = modal({ id: 'dir-dialog', labelledBy: 'dir-dialog-title', className: 'dialog--slip', onClose: closeDialog },
    el('p', { class: 'dialog__kicker' }, t('slip.eyebrow')),
    el('h2', { class: 'dialog__title', id: 'dir-dialog-title' }, d.name),
    el('dl', { class: 'slip' },
      el('div', { class: 'slip__row' },
        el('dt', { class: 'slip__label' }, t('slip.login')),
        el('dd', { class: 'slip__login' }, d.login)),
      el('div', { class: 'slip__row' },
        el('dt', { class: 'slip__label' }, t('login.password')),
        el('dd', { class: 'slip__value' }, secret,
          el('button', { type: 'button', id: 'slip-copy', class: 'button button--secondary', onclick: () => copyPassword(d, secret, copied) },
            icon('copy'), t('slip.copy'))))),
    copied,
    note('warning', t('slip.once')),
    el('p', { class: 'dialog__note' }, t('slip.change')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--primary', onclick: () => dialog.close() }, t('common.close'))));
  return dialog;
}

async function copyPassword(d, secret, status) {
  try {
    await navigator.clipboard.writeText(d.tempPassword);
    d.copied = 'slip.copied';
  } catch (error) {
    // No clipboard access (old browser, page not secure): select the text so Ctrl+C copies it.
    window.getSelection().selectAllChildren(secret);
    d.copied = 'slip.selected';
  }
  status.textContent = t(d.copied);
}

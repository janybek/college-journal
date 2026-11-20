import { call } from '../api.js';
import { t, tCount, getLang } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, field, selectField, modal, showModal, focusById, focusFirstInvalid, markBusy, refresh,
  avatar, badge, emptyState, iconButton, note, pageHeader, unmarkField,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { FIELDS } from './directoryConfig.js';
import { isTime, dayParts } from '../dates.js';

// Topics (#/topics): the topic plan of one subject in order, each topic with the pair the journal put it on
// (the server lays topics on the subject's pairs by date: one topic, one pair). Above the table: topics that
// did not fit and pairs left without a topic. Adding, editing and deleting a topic lays them out again, so the
// plan is read again after every change. Drawn from `state`, so a redraw (language switch) keeps the chosen
// subject and an open dialog. Without dir.save:topics (the vice-rector) there is only the table.

// A copy of LESSON_TYPES in core/schema.js: the server checks the type again.
const LESSON_TYPES = ['lecture', 'practice', 'control'];
const TYPE_TONES = { lecture: 'primary', practice: 'neutral', control: 'warning' };
const FORM_FIELDS = ['order', 'unit', 'name', 'lessonType'];
const FIELD_IDS = { order: 'topics-order', unit: 'topics-unit', name: 'topics-name', lessonType: 'topics-type' };
const NAME_MAX = 200;
// Failures worth trying again; any other answer would not change on a retry.
const RETRYABLE_ERRORS = ['network', 'internal'];

const blank = () => ({
  subjects: null,      // [{ id, label }] sorted by label; null until loaded
  loadErrorKey: null,
  pending: false,
  subjectId: '',
  plan: null,          // the answer of topics.plan for subjectId
  planErrorKey: null,
  planTicket: 0,       // bumps with every plan request; older answers are dropped
  planPending: false,
  status: null,        // { key, params }: what the last change did
  freshId: null,       // the topic saved last, marked in the table
  dialog: null,        // { kind: 'edit' | 'remove', ... }
});
let state = blank();

const can = (permission) => permissions().includes(permission);
const canSave = () => can('dir.save:topics');
const canRemove = () => can('dir.remove:topics');

export function leave() {
  state = blank();
}

export function render(root) {
  if (state.subjects === null && state.loadErrorKey === null && !state.pending) load(state);
  if (state.subjects !== null && state.subjectId !== '' && state.plan === null && state.planErrorKey === null && !state.planPending) {
    loadPlan(state);
  }
  root.append(pageHeader({ id: 'topics-title', title: t('topics.title'), lead: t('topics.lead'), actions: headerActions() }));
  if (state.subjects === null) {
    root.append(failure(state.loadErrorKey, () => { state.loadErrorKey = null; refresh(); }));
    return;
  }
  if (state.subjects.length === 0) {
    root.append(emptyState('book',
      el('p', {}, t('topics.noSubjects')),
      can('dir.list:subjects') ? el('a', { class: 'button button--secondary', href: '#/dir/subjects' }, icon('book'), t('dir.subjects')) : null));
    return;
  }
  root.append(
    el('div', { class: 'notes topics-notes', role: 'status' }, state.status ? note('success', t(state.status.key, state.status.params)) : null),
    planCard());
  if (state.dialog) showModal(root, dialogFor(state.dialog));
}

function headerActions() {
  if (state.subjects === null || state.subjects.length === 0) return null;
  const upload = can('import.apply:topics')
    ? el('a', { class: 'button button--secondary', href: '#/import' }, icon('sheetUp'), t('topics.import'))
    : null;
  const add = canSave() && state.plan !== null
    ? el('button', { type: 'button', id: 'topics-add', class: 'button button--primary', onclick: () => openEdit(null) }, icon('plus'), t('topics.add'))
    : null;
  return upload || add ? [upload, add] : null;
}

async function load(owner) {
  owner.pending = true;
  try {
    const [subjects, groups] = await Promise.all(['subjects', 'groups']
      .map((table) => (can('dir.list:' + table) ? call('dir.list', { table }) : { rows: [] })));
    if (state !== owner) return;
    const groupName = (id) => groups.rows.find((group) => group.id === id)?.name ?? '';
    const compare = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' }).compare;
    owner.subjects = subjects.rows
      .map((subject) => ({ id: subject.id, label: t('topics.subjectOption', { subject: subject.name, group: groupName(subject.groupId) }) }))
      .sort((a, b) => compare(a.label, b.label));
    if (!owner.subjects.some((subject) => subject.id === owner.subjectId)) owner.subjectId = owner.subjects[0]?.id ?? '';
    owner.loadErrorKey = null;
  } catch (error) {
    if (state !== owner) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    owner.pending = false;
  }
  refresh();
}

// Reads the plan of the chosen subject. Resolves when the answer is on screen (or was dropped as stale).
async function loadPlan(owner) {
  const ticket = ++owner.planTicket;
  const subjectId = owner.subjectId;
  owner.planPending = true;
  const current = () => state === owner && owner.planTicket === ticket;
  try {
    const plan = await call('topics.plan', { subjectId });
    if (!current()) return;
    owner.plan = plan;
    owner.planErrorKey = null;
  } catch (error) {
    if (!current()) return;
    owner.planErrorKey = errorKey(error.code);
  }
  owner.planPending = false;
  refresh();
}

// A text while loading; after a failure, the reason and a button to try again.
function failure(key, retry) {
  if (!key) return el('p', { class: 'loading' }, t('common.loading'));
  const body = emptyState('alert',
    el('p', {}, t(key)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

const subjectLabel = () => state.subjects.find((subject) => subject.id === state.subjectId)?.label ?? '';

function dayMonth(date) {
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
}

// The plan

function planCard() {
  const { plan } = state;
  const toolbar = el('div', { class: 'toolbar topics-toolbar' },
    selectField({
      id: 'topics-subject', label: t('topics.subject'), value: state.subjectId, hideLabel: true,
      options: state.subjects.map((subject) => ({ value: subject.id, label: subject.label })), onChange: chooseSubject,
    }),
    plan && plan.subject.teacherName ? el('p', { class: 'topics-teacher' },
      avatar(plan.subject.teacherName),
      el('span', { class: 'topics-teacher__text' },
        el('span', { class: 'topics-teacher__caption' }, t('topics.teacher')),
        el('span', { class: 'topics-teacher__name' }, plan.subject.teacherName))) : null,
    plan ? el('p', { class: 'toolbar__count' }, tCount('topics.count', plan.topics.length)) : null);
  let body;
  if (!plan) body = el('div', { class: 'topics-wait' }, failure(state.planErrorKey, () => { state.planErrorKey = null; refresh(); }));
  else if (plan.topics.length === 0) body = el('div', { class: 'topics-wait' }, emptyBody());
  else body = topicsTable(plan.topics);
  return el('div', { class: 'stack' },
    plan ? warnings(plan) : null,
    el('section', { class: 'card topics-card', 'aria-labelledby': 'topics-title' }, toolbar, body));
}

function warnings(plan) {
  const notPlaced = plan.topics.filter((topic) => topic.pair === null).length;
  const list = [
    notPlaced > 0 ? note('warning', t('topics.notPlaced', { count: notPlaced })) : null,
    plan.withoutTopic > 0 ? note('warning', t('topics.withoutTopic', { count: plan.withoutTopic })) : null,
  ].filter(Boolean);
  return list.length > 0 ? el('div', { class: 'notes topics-warnings' }, list) : null;
}

function emptyBody() {
  return emptyState('clipboard',
    el('p', { class: 'empty__title' }, t('topics.empty')),
    canSave() ? el('p', {}, t('topics.emptyHint')) : null);
}

function topicsTable(topics) {
  const actions = canSave() || canRemove();
  const head = el('tr', {},
    el('th', { scope: 'col', class: 'table__num' }, t('import.col.topics.order')),
    el('th', { scope: 'col', class: 'topics__unit' }, t('import.col.topics.unit')),
    el('th', { scope: 'col' }, t('import.col.topics.name')),
    el('th', { scope: 'col' }, t('import.col.topics.lessonType')),
    el('th', { scope: 'col' }, t('topics.pair')),
    actions ? el('th', { scope: 'col', class: 'table__actions' }, el('span', { class: 'visually-hidden' }, t('dir.actions'))) : null);
  const rows = topics.map((topic, i) => topicRow(topic, i === 0 || topics[i - 1].unit !== topic.unit, actions));
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table topics-table', 'aria-labelledby': 'topics-title' },
      el('thead', {}, head),
      el('tbody', {}, rows)));
}

// A topic. The first topic of a unit opens it with a line and its number; the next ones of that unit repeat the
// number only for screen readers.
function topicRow(topic, unitStart, actions) {
  const nameId = 'topics-name-' + topic.id;
  const action = (kind, iconName, textKey, onClick, extra = '') => iconButton({
    id: `topics-${kind}-${topic.id}`, iconName, label: t(textKey), onClick, className: 'row-action' + extra, attrs: { 'aria-describedby': nameId },
  });
  const classes = [unitStart ? 'is-unit-start' : '', topic.pair === null ? 'is-unplaced' : '', topic.id === state.freshId ? 'is-fresh' : ''];
  return el('tr', { class: classes.filter(Boolean).join(' ') || null },
    el('td', { class: 'table__num' }, String(topic.order)),
    el('td', { class: 'topics__unit' }, el('span', { class: unitStart ? 'unit' : 'visually-hidden' }, String(topic.unit))),
    el('td', {}, el('span', { class: 'table__label', id: nameId }, topic.name)),
    el('td', {}, typeBadge(topic.lessonType)),
    el('td', {}, pairCell(topic.pair)),
    actions ? el('td', { class: 'table__actions' },
      canSave() ? action('edit', 'pencil', 'common.edit', () => openEdit(topic)) : null,
      canRemove() ? action('remove', 'trash', 'common.remove', () => openRemove(topic), ' row-action--danger') : null) : null);
}

const typeBadge = (type) => (LESSON_TYPES.includes(type) ? badge(t('lessonType.' + type), TYPE_TONES[type]) : badge(String(type ?? '')));

// The pair a topic stands on, as a page of a tear-off calendar with the date and the pair beside it.
function pairCell(pair) {
  if (pair === null) {
    return el('span', { class: 'when' },
      el('span', { class: 'when__leaf when__leaf--empty', 'aria-hidden': 'true' }),
      badge(t('topics.noPair'), 'warning'));
  }
  const { day, weekday } = dayParts(pair.date);
  const slot = t('settings.pairN', { n: pair.slot });
  return el('span', { class: 'when' },
    el('span', { class: 'when__leaf', 'aria-hidden': 'true' },
      el('span', { class: 'when__weekday' }, t('date.weekdayShort.' + weekday)),
      el('span', { class: 'when__day' }, String(day))),
    el('span', { class: 'when__text' },
      // The weekday is on the calendar page; screen readers, which skip the page, hear it here.
      el('span', { class: 'when__date' }, el('span', { class: 'visually-hidden' }, t('date.weekday.' + weekday) + ', '), dayMonth(pair.date)),
      el('span', { class: 'when__slot' }, isTime(pair.startTime) ? t('topics.pairPlace', { pair: slot, time: pair.startTime }) : slot)));
}

function chooseSubject(subjectId) {
  state.subjectId = subjectId;
  // A plan still on its way belongs to the subject chosen before: its answer is dropped.
  state.planTicket++;
  state.planPending = false;
  state.plan = null;
  state.planErrorKey = null;
  state.status = null;
  state.freshId = null;
  refresh();
  focusById('topics-subject');
}

// Dialogs

function dialogFor(d) {
  return d.kind === 'edit' ? editDialog(d) : removeDialog(d);
}

function closeDialog() {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  refresh();
  focusById(d.returnId, 'topics-add', 'topics-subject');
}

// A new topic gets the number after the last one and the unit of the last one.
function openEdit(topic) {
  const topics = state.plan.topics;
  const last = topics[topics.length - 1];
  state.status = null;
  state.freshId = null;
  state.dialog = {
    kind: 'edit', topic, subjectId: state.subjectId,
    values: topic
      ? { order: String(topic.order), unit: String(topic.unit), name: topic.name, lessonType: topic.lessonType }
      : { order: String(Math.max(0, ...topics.map((item) => item.order)) + 1), unit: String(last ? last.unit : 1), name: '', lessonType: '' },
    fieldErrors: {}, messageKey: null, blocked: false, busy: false,
    returnId: topic ? 'topics-edit-' + topic.id : 'topics-add',
  };
  refresh();
}

function editDialog(d) {
  const save = el('button', { type: 'submit', id: 'topics-save', class: 'button button--primary' }, t('common.save'));
  if (d.busy) markBusy(save, 'common.saving');
  const error = (name) => d.fieldErrors[name] ?? null;
  const numberAttrs = (name) => ({ min: FIELDS[name].min, max: FIELDS[name].max, step: 1, inputmode: 'numeric', required: true });
  const dialog = modal({ id: 'topics-dialog', labelledBy: 'topics-dialog-title', onClose: closeDialog, canCancel: () => !d.busy },
    el('p', { class: 'dialog__kicker' }, subjectLabel()),
    el('h2', { class: 'dialog__title', id: 'topics-dialog-title' }, d.topic ? t('topics.editTitle', { order: d.topic.order }) : t('topics.new')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); saveTopic(d); } },
      el('div', { class: 'topics-numbers' },
        field({
          id: FIELD_IDS.order, label: t('topics.field.order'), type: 'number', value: d.values.order, hint: t('topics.field.orderHint'),
          error: error('order'), onInput: (value) => edited(d, 'order', value), attrs: numberAttrs('order'),
        }),
        field({
          id: FIELD_IDS.unit, label: t('topics.field.unit'), type: 'number', value: d.values.unit, hint: t('topics.field.unitHint'),
          error: error('unit'), onInput: (value) => edited(d, 'unit', value), attrs: numberAttrs('unit'),
        })),
      field({
        id: FIELD_IDS.name, label: t('topics.field.name'), value: d.values.name, error: error('name'),
        onInput: (value) => edited(d, 'name', value), attrs: { maxlength: NAME_MAX, autocomplete: 'off', required: true },
      }),
      selectField({
        id: FIELD_IDS.lessonType, label: t('topics.field.type'), value: d.values.lessonType, placeholder: t('topics.field.typeChoose'),
        options: LESSON_TYPES.map((type) => ({ value: type, label: t('lessonType.' + type) })),
        error: error('lessonType'), onChange: (value) => edited(d, 'lessonType', value),
      }),
      d.messageKey ? note('error', t(d.messageKey), { role: 'alert', id: 'topics-dialog-message' }) : null,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } },
          t(d.blocked ? 'common.close' : 'common.cancel')),
        d.blocked ? null : save)));
  return dialog;
}

// A field the person changes loses its error mark, and the message about the whole form goes, in place: a redraw
// would throw the caret out of the field.
function edited(d, name, value) {
  d.values[name] = value;
  if (d.messageKey && !d.blocked) {
    d.messageKey = null;
    document.getElementById('topics-dialog-message')?.remove();
  }
  if (!d.fieldErrors[name]) return;
  delete d.fieldErrors[name];
  unmarkField(FIELD_IDS[name] + '-error', document.getElementById(FIELD_IDS[name]));
}

const wholeIn = (text, { min, max }) => /^\d+$/.test(text.trim()) && +text >= min && +text <= max;

// The checks the server makes on each field, so a mistake shows before the request.
function checkForm(values) {
  const errors = {};
  for (const name of ['order', 'unit']) {
    if (values[name].trim() === '') errors[name] = 'error.required';
    else if (!wholeIn(values[name], FIELDS[name])) errors[name] = `error.${name}.bad_value`;
  }
  if (values.name.trim() === '') errors.name = 'error.required';
  if (!LESSON_TYPES.includes(values.lessonType)) errors.lessonType = 'error.lessonType.bad_value';
  return errors;
}

async function saveTopic(d) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  const owner = state;
  d.messageKey = null;
  d.fieldErrors = checkForm(d.values);
  if (Object.keys(d.fieldErrors).length > 0) {
    refresh();
    focusFirstInvalid();
    return;
  }
  d.busy = true;
  refresh();
  const row = {
    subjectId: d.subjectId, order: +d.values.order, unit: +d.values.unit, name: d.values.name.trim(), lessonType: d.values.lessonType,
  };
  if (d.topic) row.id = d.topic.id;
  try {
    const data = await call('dir.save', { table: 'topics', row });
    if (state !== owner) return;
    owner.dialog = null;
    owner.freshId = data.row.id;
    owner.status = { key: 'topics.saved', params: { name: data.row.name } };
    await changed(owner, d.subjectId);
    focusById('topics-edit-' + data.row.id, 'topics-add');
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
  for (const { field: name, code } of fields) {
    if (FORM_FIELDS.includes(name)) d.fieldErrors[name] = fieldErrorKey('topics', name, code, 'topics');
  }
  const other = fields.find(({ field: name }) => !FORM_FIELDS.includes(name));
  if (other) d.messageKey = fieldErrorKey('topics', other.field, other.code, 'topics');
  else if (fields.length === 0) d.messageKey = errorKey(error.code);
  // The topic or its subject is gone: saving again cannot help.
  d.blocked = error.code === 'not_found' || other !== undefined;
}

function openRemove(topic) {
  state.status = null;
  state.freshId = null;
  state.dialog = { kind: 'remove', topic, subjectId: state.subjectId, messageKey: null, blocked: false, busy: false, returnId: 'topics-remove-' + topic.id };
  refresh();
}

function removeDialog(d) {
  const confirm = el('button', { type: 'button', id: 'topics-confirm', class: 'button button--danger', onclick: () => removeTopic(d) }, t('common.remove'));
  if (d.busy) markBusy(confirm, 'dir.removing');
  const dialog = modal({ id: 'topics-dialog', labelledBy: 'topics-dialog-title', className: 'dialog--confirm', onClose: closeDialog, canCancel: () => !d.busy },
    el('p', { class: 'dialog__kicker' }, subjectLabel()),
    el('h2', { class: 'dialog__title', id: 'topics-dialog-title' }, t('topics.removeTitle')),
    el('p', {}, t('topics.removeText', { name: d.topic.name })),
    d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } },
        t(d.blocked ? 'common.close' : 'common.cancel')),
      d.blocked ? null : confirm));
  return dialog;
}

async function removeTopic(d) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  const owner = state;
  d.busy = true;
  d.messageKey = null;
  refresh();
  try {
    await call('dir.remove', { table: 'topics', id: d.topic.id });
    if (state !== owner) return;
    owner.dialog = null;
    owner.status = { key: 'topics.removed', params: { name: d.topic.name } };
    await changed(owner, d.subjectId);
    focusById('topics-add', 'topics-subject');
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    d.messageKey = error.code === 'in_use' ? 'dir.inUse.topics' : errorKey(error.code);
    d.blocked = !RETRYABLE_ERRORS.includes(error.code);
    if (owner.dialog !== d) return;
    refresh();
    // Someone else deleted it already: the plan behind the dialog is read again.
    if (error.code === 'not_found') changed(owner, d.subjectId);
  }
}

// After a change the server has laid the topics out again: the plan of that subject is read anew. The old one
// stays on screen until the new one arrives.
async function changed(owner, subjectId) {
  if (owner.subjectId !== subjectId) {
    refresh();
    return;
  }
  refresh();
  await loadPlan(owner);
}

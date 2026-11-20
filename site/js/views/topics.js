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
import { semesterTopics, nextTopic, planWarnings } from '../syllabus.js';

// The syllabus of a subject: its topics by semester, each topic with the pair the journal put it on (the server
// lays the topics of the current semester on the subject's pairs by date: one topic, one pair). Two screens share
// this code: the deanery's «Темы» (#/topics, #/topics/<subjectId>) with a choice of subject, and the page of one subject
// (#/plan/<subjectId>) a teacher opens from «Мои предметы». A tab per semester; the current one opens first and is
// the only one that warns about topics that did not fit and pairs left without a topic. Adding, editing and
// deleting a topic lays them out again, so the plan is read again after every change. Who may change the topics
// depends on the subject, so the buttons follow `plan.canEdit` from the server; whoever may change them may also
// upload the syllabus from Excel (#/syllabus/<subjectId>). Drawn from `state`, so a redraw (language switch) keeps
// the subject, the tab and an open dialog.

// A copy of LESSON_TYPES in core/schema.js: the server checks the type again.
const LESSON_TYPES = ['lecture', 'practice', 'control'];
const TYPE_TONES = { lecture: 'primary', practice: 'neutral', control: 'warning' };
const SEMESTERS = [1, 2];
const FORM_FIELDS = ['order', 'unit', 'name', 'lessonType'];
const FIELD_IDS = { order: 'topics-order', unit: 'topics-unit', name: 'topics-name', lessonType: 'topics-type' };
const NAME_MAX = 200;
// Failures worth trying again; any other answer would not change on a retry.
const RETRYABLE_ERRORS = ['network', 'internal'];
// Answers about the subject page a retry would not change: the screen explains them with a way back home.
const FINAL_ERRORS = { forbidden: 'plan.forbidden', not_found: 'plan.notFound' };

const blank = () => ({
  mode: 'list',        // 'list': the deanery's screen with a choice of subject; 'subject': the page of one subject
  subjects: null,      // [{ id, label }] sorted by label; null until loaded (the list mode only)
  loadErrorKey: null,
  pending: false,
  subjectId: '',
  route: null,         // { subjectId }: the address parameter applied last (the list mode only)
  plan: null,          // the answer of topics.plan for subjectId
  planErrorKey: null,
  planErrorCode: null,
  planTicket: 0,       // bumps with every plan request; older answers are dropped
  planPending: false,
  tab: null,           // the semester shown; null: the current one, once the plan is read
  status: null,        // { key, params }: what the last change did
  freshId: null,       // the topic saved last, marked in the table
  dialog: null,        // { kind: 'edit' | 'remove', ... }
});
let state = blank();

const can = (permission) => permissions().includes(permission);
const canEdit = () => state.plan !== null && state.plan.canEdit === true;
const canUpload = () => canEdit() && can('syllabus.apply');

export function leave() {
  state = blank();
}

// The deanery's «Темы».
export function render(root, params = {}) {
  if (state.mode !== 'list') state = blank();
  applyRoute(params);
  if (state.subjects === null && state.loadErrorKey === null && !state.pending) load(state);
  if (state.subjects !== null && state.subjectId !== '') loadPlanIfNeeded();
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
  root.append(statusNotes(), planCard());
  if (state.dialog) showModal(root, dialogFor(state.dialog));
}

// The page of one subject («Силлабус»).
export function renderSubject(root, subjectId) {
  if (state.mode !== 'subject' || state.subjectId !== subjectId) state = { ...blank(), mode: 'subject', subjectId };
  loadPlanIfNeeded();
  root.append(pageHeader({ id: 'topics-title', title: t('plan.title'), lead: t('plan.lead'), actions: headerActions() }));
  const final = state.plan === null ? FINAL_ERRORS[state.planErrorCode] : null;
  if (final) {
    const failed = emptyState('alert',
      el('p', {}, t(final)),
      el('a', { class: 'button button--secondary', href: '#/' }, icon('home'), t('common.toHome')));
    failed.setAttribute('role', 'alert');
    root.append(el('section', { class: 'card topics-card' }, el('div', { class: 'topics-wait' }, failed)));
    return;
  }
  if (state.plan !== null && !canEdit()) root.append(note('info', t('plan.readOnly')));
  root.append(statusNotes(), planCard());
  if (state.dialog) showModal(root, dialogFor(state.dialog));
}

// The subject the address names is chosen once per address: a redraw with the same address (a language switch)
// keeps the subject chosen since. One the list does not have leaves the choice as it was (load() checks it too).
function applyRoute({ subjectId = null }) {
  if (state.route && state.route.subjectId === subjectId) return;
  state.route = { subjectId };
  if (subjectId === null || subjectId === state.subjectId) return;
  if (state.subjects !== null && !state.subjects.some((subject) => subject.id === subjectId)) return;
  forgetPlan(subjectId);
}

function loadPlanIfNeeded() {
  if (state.plan === null && state.planErrorKey === null && !state.planPending) loadPlan(state);
}

function headerActions() {
  if (state.mode === 'list' && (state.subjects === null || state.subjects.length === 0)) return null;
  const upload = canUpload()
    ? el('a', { id: 'topics-upload', class: 'button button--secondary', href: '#/syllabus/' + state.subjectId }, icon('sheetUp'), t('syllabus.upload'))
    : null;
  const add = canEdit()
    ? el('button', { type: 'button', id: 'topics-add', class: 'button button--primary', onclick: () => openEdit(null) }, icon('plus'), t('topics.add'))
    : null;
  return upload || add ? [upload, add] : null;
}

const statusNotes = () => el('div', { class: 'notes topics-notes', role: 'status' },
  state.status ? note('success', t(state.status.key, state.status.params)) : null);

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

// Reads the plan of the chosen subject. Resolves when the answer is on screen (or was dropped as stale). The
// first answer opens the tab of the current semester.
async function loadPlan(owner) {
  const ticket = ++owner.planTicket;
  const subjectId = owner.subjectId;
  owner.planPending = true;
  const current = () => state === owner && owner.planTicket === ticket;
  try {
    const plan = await call('topics.plan', { subjectId });
    if (!current()) return;
    owner.plan = plan;
    if (owner.tab === null) owner.tab = plan.semester === 2 ? 2 : 1;
    owner.planErrorKey = null;
    owner.planErrorCode = null;
  } catch (error) {
    if (!current()) return;
    owner.planErrorKey = errorKey(error.code);
    owner.planErrorCode = error.code;
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

// «Информатика — 01-1»: the subject the dialogs are about.
function subjectLabel() {
  if (state.mode === 'list') return state.subjects.find((subject) => subject.id === state.subjectId)?.label ?? '';
  const { subject } = state.plan;
  return subject.groupName ? t('topics.subjectOption', { subject: subject.name, group: subject.groupName }) : subject.name;
}

function dayMonth(date) {
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
}

// The plan

function planCard() {
  const { plan } = state;
  const labelledBy = state.mode === 'list' ? 'topics-title' : 'plan-subject';
  let body;
  if (!plan) body = el('div', { class: 'topics-wait' }, failure(state.planErrorKey, () => { state.planErrorKey = null; refresh(); }));
  else {
    const topics = semesterTopics(plan, state.tab);
    body = [
      semesterTabs(plan),
      topics.length === 0 ? el('div', { class: 'topics-wait' }, emptyBody(plan)) : topicsTable(topics, state.tab !== plan.semester),
    ];
  }
  return el('div', { class: 'stack' },
    plan ? warnings(plan) : null,
    el('section', { class: 'card topics-card', 'aria-labelledby': labelledBy },
      state.mode === 'list' ? listToolbar() : subjectToolbar(),
      body));
}

function topicCount() {
  return state.plan ? el('p', { class: 'toolbar__count' }, tCount('topics.count', semesterTopics(state.plan, state.tab).length)) : null;
}

function listToolbar() {
  const { plan } = state;
  return el('div', { class: 'toolbar topics-toolbar' },
    selectField({
      id: 'topics-subject', label: t('topics.subject'), value: state.subjectId, hideLabel: true,
      options: state.subjects.map((subject) => ({ value: subject.id, label: subject.label })), onChange: chooseSubject,
    }),
    plan && plan.subject.teacherName ? el('p', { class: 'topics-teacher' },
      avatar(plan.subject.teacherName),
      el('span', { class: 'topics-teacher__text' },
        el('span', { class: 'topics-teacher__caption' }, t('topics.teacher')),
        el('span', { class: 'topics-teacher__name' }, plan.subject.teacherName))) : null,
    topicCount());
}

function subjectToolbar() {
  const subject = state.plan?.subject ?? null;
  return el('div', { class: 'toolbar topics-toolbar' },
    el('span', { class: 'list__icon' }, icon('book')),
    subject ? el('h2', { class: 'plan-subject', id: 'plan-subject' }, subject.name) : null,
    subject && subject.groupName ? badge(subject.groupName, 'primary') : null,
    topicCount());
}

// One tab per semester; the current semester carries a green mark.
function semesterTabs(plan) {
  return el('div', { class: 'semester-tabs' },
    el('div', { class: 'segmented semester-tabs__switch', role: 'group', 'aria-label': t('topics.semesterTabs') },
      SEMESTERS.map((n) => el('button', {
        type: 'button', id: 'topics-semester-' + n, class: 'segmented__button semester-tab', 'aria-pressed': String(n === state.tab),
        onclick: () => chooseTab(n),
      },
      el('span', { class: 'semester-tab__name' }, t('topics.semesterN', { n })),
      n === plan.semester ? el('span', { class: 'semester-tab__now' }, t('topics.semesterNow')) : null))));
}

function chooseTab(n) {
  if (n === state.tab) return;
  state.tab = n;
  state.status = null;
  state.freshId = null;
  refresh();
  focusById('topics-semester-' + n);
}

// Topics that did not fit and pairs without a topic concern the current semester only; another semester says
// when its topics will go on pairs.
function warnings(plan) {
  const { notPlaced, withoutTopic } = planWarnings(plan, state.tab);
  const list = [
    state.planErrorKey ? staleNote() : null,
    state.tab !== plan.semester ? note('info', t('topics.otherSemester')) : null,
    notPlaced > 0 ? note('warning', t('topics.notPlaced', { count: notPlaced })) : null,
    withoutTopic > 0 ? note('warning', t('topics.withoutTopic', { count: withoutTopic })) : null,
  ].filter(Boolean);
  return list.length > 0 ? el('div', { class: 'notes topics-warnings' }, list) : null;
}

// The plan could not be read again after a change: the table is the one from before it, so its dates may be old.
function staleNote() {
  const retry = el('button', { type: 'button', id: 'topics-reload', class: 'button button--secondary', onclick: reloadPlan }, t('common.retry'));
  if (state.planPending) markBusy(retry, 'common.loading');
  return el('div', { class: 'topics-stale', role: 'alert' },
    note('warning', t('topics.stale', { reason: t(state.planErrorKey) })),
    retry);
}

async function reloadPlan() {
  if (state.planPending) return;
  const owner = state;
  const reading = loadPlan(owner);
  refresh();
  await reading;
  if (state === owner) focusById('topics-reload', 'topics-subject', 'topics-semester-' + owner.tab);
}

function emptyBody(plan) {
  return emptyState('clipboard',
    el('p', { class: 'empty__title' }, t(plan.topics.length === 0 ? 'topics.empty' : 'topics.emptySemester')),
    canUpload() ? el('p', {}, t('topics.emptyHint')) : null);
}

// other: the tab of a semester that is not the current one, whose topics wait for the switch of the semester.
function topicsTable(topics, other) {
  const actions = canEdit();
  const head = el('tr', {},
    el('th', { scope: 'col', class: 'table__num' }, t('import.col.topics.order')),
    el('th', { scope: 'col', class: 'topics__unit' }, t('import.col.topics.unit')),
    el('th', { scope: 'col' }, t('import.col.topics.name')),
    el('th', { scope: 'col' }, t('import.col.topics.lessonType')),
    el('th', { scope: 'col' }, t('topics.pair')),
    actions ? el('th', { scope: 'col', class: 'table__actions' }, el('span', { class: 'visually-hidden' }, t('dir.actions'))) : null);
  const rows = topics.map((topic, i) => topicRow(topic, i === 0 || topics[i - 1].unit !== topic.unit, actions, other));
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table topics-table', 'aria-labelledby': state.mode === 'list' ? 'topics-title' : 'plan-subject' },
      el('thead', {}, head),
      el('tbody', {}, rows)));
}

// A topic. The first topic of a module opens it with a line and its number; the next ones of that module repeat
// the number only for screen readers.
function topicRow(topic, unitStart, actions, other) {
  const nameId = 'topics-name-' + topic.id;
  const action = (kind, iconName, textKey, onClick, extra = '') => iconButton({
    id: `topics-${kind}-${topic.id}`, iconName, label: t(textKey), onClick, className: 'row-action' + extra, attrs: { 'aria-describedby': nameId },
  });
  const unplaced = topic.pair === null && !other;
  const classes = [unitStart ? 'is-unit-start' : '', unplaced ? 'is-unplaced' : '', topic.id === state.freshId ? 'is-fresh' : ''];
  return el('tr', { class: classes.filter(Boolean).join(' ') || null },
    el('td', { class: 'table__num' }, String(topic.order)),
    el('td', { class: 'topics__unit' }, el('span', { class: unitStart ? 'unit' : 'visually-hidden' }, String(topic.unit))),
    el('td', {}, el('span', { class: 'table__label', id: nameId }, topic.name)),
    el('td', {}, typeBadge(topic.lessonType)),
    el('td', {}, pairCell(topic.pair, other)),
    actions ? el('td', { class: 'table__actions' },
      action('edit', 'pencil', 'common.edit', () => openEdit(topic)),
      action('remove', 'trash', 'common.remove', () => openRemove(topic), ' row-action--danger')) : null);
}

const typeBadge = (type) => (LESSON_TYPES.includes(type) ? badge(t('lessonType.' + type), TYPE_TONES[type]) : badge(String(type ?? '')));

// The pair a topic stands on, as a page of a tear-off calendar with the date and the pair beside it. A topic of
// another semester without a pair is simply not due yet; one with a pair (held before) shows its date.
function pairCell(pair, other) {
  if (pair === null) {
    return el('span', { class: 'when' },
      el('span', { class: 'when__leaf when__leaf--empty', 'aria-hidden': 'true' }),
      other ? el('span', { class: 'when__later' }, t('topics.notNow')) : badge(t('topics.noPair'), 'warning'));
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
  forgetPlan(subjectId);
  refresh();
  focusById('topics-subject');
}

// Another subject: its plan is read anew. A plan still on its way belongs to the subject chosen before: its
// answer is dropped.
function forgetPlan(subjectId) {
  state.subjectId = subjectId;
  state.planTicket++;
  state.planPending = false;
  state.plan = null;
  state.planErrorKey = null;
  state.planErrorCode = null;
  state.tab = null;
  state.status = null;
  state.freshId = null;
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

// «Информатика — 01-1 · 2 семестр» above the title of a dialog: the semester of a topic is not changed there.
const kicker = (d) => el('p', { class: 'dialog__kicker' },
  t('topics.kicker', { subject: subjectLabel(), semester: t('topics.semesterN', { n: d.semester }) }));

// A new topic goes into the semester of the open tab, with the number after the last one and its module.
function openEdit(topic) {
  const semester = topic ? topic.semester : state.tab;
  const next = nextTopic(semesterTopics(state.plan, semester));
  state.status = null;
  state.freshId = null;
  state.dialog = {
    kind: 'edit', topic, subjectId: state.subjectId, semester,
    values: topic
      ? { order: String(topic.order), unit: String(topic.unit), name: topic.name, lessonType: topic.lessonType }
      : { order: next.order === null ? '' : String(next.order), unit: String(next.unit), name: '', lessonType: '' },
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
    kicker(d),
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
    subjectId: d.subjectId, semester: d.semester, order: +d.values.order, unit: +d.values.unit,
    name: d.values.name.trim(), lessonType: d.values.lessonType,
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
  // The topic or its subject is gone, or the subject is not the person's: saving again cannot help.
  d.blocked = error.code === 'not_found' || error.code === 'forbidden' || other !== undefined;
}

function openRemove(topic) {
  state.status = null;
  state.freshId = null;
  state.dialog = {
    kind: 'remove', topic, subjectId: state.subjectId, semester: topic.semester,
    messageKey: null, blocked: false, busy: false, returnId: 'topics-remove-' + topic.id,
  };
  refresh();
}

function removeDialog(d) {
  const confirm = el('button', { type: 'button', id: 'topics-confirm', class: 'button button--danger', onclick: () => removeTopic(d) }, t('common.remove'));
  if (d.busy) markBusy(confirm, 'dir.removing');
  const dialog = modal({ id: 'topics-dialog', labelledBy: 'topics-dialog-title', className: 'dialog--confirm', onClose: closeDialog, canCancel: () => !d.busy },
    kicker(d),
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

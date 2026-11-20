import { call } from '../api.js';
import { t, tCount, getLang } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, selectField, modal, showModal, focusById, focusFirstInvalid, markBusy, refresh,
  emptyState, note, pageHeader, unmarkField, AVATAR_TONES,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { isTime, addMinutes, dayParts } from '../dates.js';

// The week template (#/template): one week, Monday to Friday, of the chosen group, drawn as a timetable; a cell
// opens a dialog to put a subject and a room there. Under it, the semester schedule is built from the template:
// first a dry run that says what would change, then the real request. Drawn from `state`, so a redraw (language
// switch) keeps the chosen group and an open dialog. Without dir.save:weekTemplate (the vice-rector) the grid is
// read-only and there is no generation block. The address may name a group and a weekday
// (#/template/<groupId>/<1–5>, from a day of the deanery's schedule): that group is shown and that day's column
// is marked and scrolled into view, once per address.

const WEEKDAYS = [1, 2, 3, 4, 5];
const FORM_FIELDS = ['subjectId', 'roomId'];
// Failures worth trying again; any other answer would not change on a retry.
const RETRYABLE_ERRORS = ['network', 'internal'];

const blank = () => ({
  data: null,          // { groups, subjects, rooms, staff, template, bells, pairMinutes, semester }; null until loaded
  loadErrorKey: null,
  pending: false,
  groupId: '',
  route: null,         // { groupId, weekday }: the address parameters applied last
  targetDay: null,     // the weekday (1–5) whose column is marked; null: none
  scrollPending: false, // the marked column is still to be scrolled into view
  status: null,        // { key, params }: what the last change of the template did
  freshId: null,       // the template row saved last, marked in the grid
  generation: null,    // { kind: 'success' | 'error', key, params }: what the last generation did
  checking: false,     // the dry run is on its way
  dialog: null,        // { kind: 'cell' | 'preview' | 'restart', ... }
});
let state = blank();

const can = (permission) => permissions().includes(permission);
const canEdit = () => can('dir.save:weekTemplate');
const canGenerate = () => canEdit() && can('schedule.generate');

export function leave() {
  state = blank();
}

export function render(root, params = {}) {
  applyRoute(params);
  if (state.data === null && state.loadErrorKey === null && !state.pending) load(state);
  root.append(pageHeader({ id: 'template-title', title: t('template.title'), lead: t('template.lead') }));
  if (state.data === null) {
    root.append(loadingBody());
    return;
  }
  if (state.data.groups.length === 0) {
    root.append(emptyState('layers',
      el('p', {}, t('field.groupId.none')),
      can('dir.list:groups') ? el('a', { class: 'button button--secondary', href: '#/dir/groups' }, icon('layers'), t('dir.groups')) : null));
    return;
  }
  if (!canEdit()) root.append(note('info', t('template.readOnly')));
  root.append(
    el('div', { class: 'notes template-notes', role: 'status' },
      state.status ? [note('success', t(state.status.key, state.status.params)), note('info', t('template.afterChange'))] : null),
    weekCard());
  if (canGenerate()) root.append(semesterPanel());
  if (state.dialog) showModal(root, dialogFor(state.dialog));
  scrollToTarget(root);
}

// The address is applied only when it changed: a redraw with the same address (a language switch) keeps the group
// chosen since. A group the address names that does not exist leaves the first one with no day marked (load()
// checks it too).
function applyRoute({ groupId = null, weekday = null }) {
  if (state.route && state.route.groupId === groupId && state.route.weekday === weekday) return;
  state.route = { groupId, weekday };
  const known = groupId === null || state.data === null || state.data.groups.some((group) => group.id === groupId);
  if (groupId !== null && known && groupId !== state.groupId) {
    state.groupId = groupId;
    state.status = null;
    state.freshId = null;
  }
  state.targetDay = known && WEEKDAYS.includes(weekday) ? weekday : null;
  state.scrollPending = state.targetDay !== null;
}

// Once per address: the marked column is brought into the visible part of the grid, past the pinned pair column.
function scrollToTarget(root) {
  if (!state.scrollPending || state.data === null) return;
  const head = root.querySelector('#' + dayHeadId(state.targetDay));
  if (!head) return;
  state.scrollPending = false;
  head.scrollIntoView({ block: 'nearest', inline: 'center' });
}

async function load(owner) {
  owner.pending = true;
  const tables = ['groups', 'subjects', 'rooms', 'staff', 'weekTemplate'].filter((table) => can('dir.list:' + table));
  try {
    const [settings, ...lists] = await Promise.all([
      can('settings.get') ? call('settings.get', {}) : null,
      ...tables.map((table) => call('dir.list', { table })),
    ]);
    if (state !== owner) return;
    const rows = Object.fromEntries(tables.map((table, i) => [table, lists[i].rows]));
    const semester = settings ? settings.settings : null;
    owner.data = {
      groups: sortBy(rows.groups ?? [], 'name'),
      subjects: sortBy(rows.subjects ?? [], 'name'),
      rooms: sortBy(rows.rooms ?? [], 'name'),
      staff: rows.staff ?? [],
      template: rows.weekTemplate ?? [],
      bells: semester ? semester.bells : [],
      pairMinutes: settings ? settings.pairMinutes : 0,
      semester: semester && semester.semesterStart !== '' && semester.semesterEnd !== ''
        ? { start: semester.semesterStart, end: semester.semesterEnd } : null,
    };
    if (!owner.data.groups.some((group) => group.id === owner.groupId)) {
      // The group the address named is unknown: the first group is shown, and no day of it is marked.
      if (owner.groupId !== '') {
        owner.targetDay = null;
        owner.scrollPending = false;
      }
      owner.groupId = owner.data.groups[0]?.id ?? '';
    }
    owner.loadErrorKey = null;
  } catch (error) {
    if (state !== owner) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    owner.pending = false;
  }
  refresh();
}

function loadingBody() {
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const body = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.loadErrorKey = null; refresh(); } }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// Helpers over the loaded rows

function sortBy(rows, key) {
  const compare = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' }).compare;
  return [...rows].sort((a, b) => compare(String(a[key] ?? ''), String(b[key] ?? '')));
}

const findIn = (rows, id) => rows.find((row) => row.id === id);
const currentGroup = () => findIn(state.data.groups, state.groupId);
const groupSubjects = () => state.data.subjects.filter((subject) => subject.groupId === state.groupId);
const teacherName = (subject) => findIn(state.data.staff, subject.teacherId)?.fullName ?? '';
const roomName = (id) => findIn(state.data.rooms, id)?.name ?? '';

// Template rows of the chosen group: the group is the one of the row's subject.
function groupRows() {
  const ids = new Set(groupSubjects().map((subject) => subject.id));
  return state.data.template.filter((row) => ids.has(row.subjectId));
}

// Pair numbers to draw: every bell, and any pair of the template beyond the bells (after the bells were cut).
function slotNumbers(rows) {
  const count = Math.max(state.data.bells.length, ...rows.map((row) => row.slot), 0);
  return Array.from({ length: count }, (_, i) => i + 1);
}

const cellId = (weekday, slot) => `template-cell-${weekday}-${slot}`;
const dayHeadId = (weekday) => 'template-day-' + weekday;
const targetClass = (weekday) => (weekday === state.targetDay ? ' is-target' : '');
const placeText = (weekday, slot) => t('template.place', { weekday: t('date.weekday.' + weekday), pair: t('settings.pairN', { n: slot }) });

function dayMonth(date) {
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
}

// The grid

function weekCard() {
  const subjects = groupSubjects();
  const rows = groupRows();
  // A subject keeps one colour all week; the colours go round within the group, so neighbours differ.
  const tones = new Map(subjects.map((subject, i) => [subject.id, i % AVATAR_TONES]));
  const toolbar = el('div', { class: 'toolbar week-toolbar' },
    selectField({
      id: 'template-group', label: t('field.groupId'), value: state.groupId, hideLabel: true,
      options: state.data.groups.map((group) => ({ value: group.id, label: group.name })), onChange: chooseGroup,
    }),
    legend(subjects, rows, tones),
    el('p', { class: 'toolbar__count' }, tCount('template.perWeek', rows.length)));
  const head = el('tr', {},
    el('th', { scope: 'col', class: 'week__corner' }, t('template.pairColumn')),
    WEEKDAYS.map((weekday) => el('th', { scope: 'col', id: dayHeadId(weekday), class: 'week__day' + targetClass(weekday) },
      el('span', { class: 'week__dayname' }, t('date.weekday.' + weekday)))));
  const body = slotNumbers(rows).map((slot) => el('tr', {},
    slotHeader(slot),
    WEEKDAYS.map((weekday) => el('td', { class: 'week__cell' + targetClass(weekday) },
      cell(weekday, slot, rows.find((row) => row.weekday === weekday && row.slot === slot), tones)))));
  return el('section', { class: 'card week-card', 'aria-labelledby': 'template-title' },
    toolbar,
    el('div', { class: 'table-scroll week-scroll' },
      el('table', { class: 'week', 'aria-labelledby': 'template-title' },
        el('thead', {}, head),
        el('tbody', {}, body))));
}

// Each subject of the group with the number of its pairs a week; a subject that is not in the week yet is dashed.
function legend(subjects, rows, tones) {
  if (subjects.length === 0) return null;
  return el('ul', { class: 'legend' }, subjects.map((subject) => {
    const count = rows.filter((row) => row.subjectId === subject.id).length;
    return el('li', { class: 'legend__item' + (count === 0 ? ' is-unused' : ''), 'data-tone': tones.get(subject.id) },
      el('span', { class: 'legend__swatch', 'aria-hidden': 'true' }),
      el('span', {}, subject.name),
      el('span', { class: 'legend__count' }, tCount('template.pairs', count)));
  }));
}

function slotHeader(slot) {
  const time = state.data.bells[slot - 1];
  return el('th', { scope: 'row', class: 'week__slot' },
    el('span', { class: 'week__slot-inner' },
      el('span', { class: 'week__number' }, String(slot)),
      isTime(time)
        ? el('span', { class: 'week__time' },
          el('span', { class: 'week__from' }, time),
          state.data.pairMinutes > 0 ? el('span', { class: 'week__to' }, t('settings.ends', { time: addMinutes(time, state.data.pairMinutes) })) : null)
        : el('span', { class: 'week__time week__time--none' }, t('template.noBell'))));
}

function cell(weekday, slot, row, tones) {
  const editable = canEdit();
  const place = el('span', { class: 'visually-hidden' }, placeText(weekday, slot) + ': ');
  if (row) {
    const subject = findIn(state.data.subjects, row.subjectId);
    const room = roomName(row.roomId);
    const parts = [
      place,
      el('span', { class: 'lesson__subject' }, subject.name),
      el('span', { class: 'lesson__teacher' }, teacherName(subject)),
      room ? el('span', { class: 'lesson__room' }, icon('door'), room) : null,
    ];
    const attrs = { class: 'lesson' + (row.id === state.freshId ? ' is-fresh' : ''), 'data-tone': tones.get(subject.id) };
    return editable
      ? el('button', { type: 'button', id: cellId(weekday, slot), ...attrs, onclick: () => openCell(weekday, slot, row) }, parts)
      : el('div', attrs, parts);
  }
  if (!editable || slot > state.data.bells.length) return null;
  return el('button', { type: 'button', id: cellId(weekday, slot), class: 'slot-add', onclick: () => openCell(weekday, slot, null) },
    icon('plus'), el('span', { class: 'visually-hidden' }, t('template.add', { place: placeText(weekday, slot) })));
}

function chooseGroup(groupId) {
  state.groupId = groupId;
  state.targetDay = null;
  state.scrollPending = false;
  state.status = null;
  state.freshId = null;
  refresh();
  focusById('template-group');
}

// The semester schedule

function semesterPanel() {
  const { semester } = state.data;
  const generate = el('button', { type: 'button', id: 'template-generate', class: 'button button--primary', onclick: check },
    icon('calendar'), t('template.generate'));
  if (state.checking) markBusy(generate, 'template.checking');
  const body = semester
    ? [
      el('p', { class: 'semester__range' }, icon('calendar'),
        el('span', {}, t('template.period', { from: dayMonth(semester.start), to: dayMonth(semester.end) }))),
      el('div', { class: 'notes', role: 'status' }, generationNote()),
      el('div', { class: 'actions' },
        generate,
        el('button', { type: 'button', id: 'template-restart', class: 'button button--secondary', onclick: openRestart }, t('template.restart'))),
    ]
    : [
      note('info', t('template.noDates')),
      el('div', { class: 'actions' },
        el('a', { class: 'button button--secondary', href: '#/settings' }, icon('settings'), t('settings.title'))),
    ];
  return el('section', { class: 'card panel semester', 'aria-labelledby': 'template-semester' },
    el('header', { class: 'panel__head' },
      el('span', { class: 'panel__icon' }, icon('calendar')),
      el('div', { class: 'panel__text' },
        el('h2', { class: 'panel__title', id: 'template-semester' }, t('template.semester')),
        el('p', { class: 'panel__hint' }, t('template.semesterHint')))),
    el('div', { class: 'panel__body' }, body));
}

function generationNote() {
  const done = state.generation;
  if (!done) return null;
  if (done.kind === 'error') return note('error', t(done.key, done.params), { role: 'alert' });
  return el('p', { class: 'note note--success' },
    icon('checkCircle', 'note__icon'),
    el('span', {}, t(done.key, done.params), ' ', el('a', { class: 'note__link', href: '#/schedule' }, t('template.toSchedule'))));
}

// Texts for the answers of schedule.generate that are not plain failures.
function generationErrorKey(error) {
  if (error.code === 'empty_template') return 'template.error.empty_template';
  if (error.code === 'in_use') return 'template.error.in_use';
  const fields = Array.isArray(error.fields) ? error.fields : [];
  if (error.code === 'invalid' && fields.some(({ field }) => field === 'semesterStart' || field === 'semesterEnd')) return 'template.noDates';
  return errorKey(error.code);
}

// "Create schedule": a dry run first, its summary in a dialog.
async function check() {
  if (state.checking || state.dialog || !canGenerate()) return;
  const owner = state;
  owner.checking = true;
  owner.generation = null;
  refresh();
  try {
    const result = await call('schedule.generate', { dryRun: true });
    if (state !== owner) return;
    owner.dialog = { kind: 'preview', result, busy: false, messageKey: null, blocked: false, returnId: 'template-generate' };
  } catch (error) {
    if (state !== owner) return;
    owner.generation = { kind: 'error', key: generationErrorKey(error) };
  } finally {
    owner.checking = false;
  }
  if (state !== owner) return;
  refresh();
  if (!owner.dialog) focusById('template-generate');
}

const changes = (result) => result.inserted + result.updated + result.removed;

function previewDialog(d) {
  const { result } = d;
  const nothing = changes(result) === 0;
  const create = el('button', { type: 'button', id: 'template-create', class: 'button button--primary', onclick: () => generate(d, {}) }, t('template.create'));
  if (d.busy) markBusy(create, 'template.creating');
  const dialog = modal({ id: 'template-dialog', labelledBy: 'template-dialog-title', className: 'dialog--preview', onClose: closeDialog, canCancel: () => !d.busy },
    el('p', { class: 'dialog__kicker' }, t('template.semester')),
    el('h2', { class: 'dialog__title', id: 'template-dialog-title' }, t('template.preview.title')),
    el('p', { class: 'semester__range' }, icon('calendar'),
      el('span', {}, t('template.period', { from: dayMonth(result.from), to: dayMonth(result.to) }))),
    el('dl', { class: 'tally' }, [
      ['inserted', result.inserted], ['updated', result.updated], ['removed', result.removed],
      ['kept', result.kept], ['conflicts', result.conflicts],
    ].map(([name, count]) => el('div', { class: 'tally__item' + (name === 'conflicts' && count > 0 ? ' tally__item--bad' : '') },
      el('dt', { class: 'tally__label' }, t('template.tally.' + name)),
      el('dd', { class: 'tally__count' }, String(count))))),
    result.conflicts > 0 ? el('p', { class: 'dialog__note' }, t('template.conflictsHint')) : null,
    nothing ? note('info', t('template.nothingToDo')) : null,
    d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } },
        t(nothing || d.blocked ? 'common.close' : 'common.cancel')),
      nothing || d.blocked ? null : create));
  return dialog;
}

function openRestart() {
  if (state.checking || state.dialog || !canGenerate()) return;
  state.generation = null;
  state.dialog = { kind: 'restart', busy: false, messageKey: null, blocked: false, returnId: 'template-restart' };
  refresh();
}

function restartDialog(d) {
  const confirm = el('button', { type: 'button', id: 'template-restart-confirm', class: 'button button--danger', onclick: () => generate(d, { restart: true }) },
    t('template.restartConfirm'));
  if (d.busy) markBusy(confirm, 'template.creating');
  const dialog = modal({ id: 'template-dialog', labelledBy: 'template-dialog-title', className: 'dialog--confirm', onClose: closeDialog, canCancel: () => !d.busy },
    el('h2', { class: 'dialog__title', id: 'template-dialog-title' }, t('template.restartTitle')),
    el('p', {}, t('template.restartText')),
    d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } },
        t(d.blocked ? 'common.close' : 'common.cancel')),
      d.blocked ? null : confirm));
  return dialog;
}

// The real request, from the summary ({}) or from the restart warning ({ restart: true }).
async function generate(d, options) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  const owner = state;
  d.busy = true;
  d.messageKey = null;
  refresh();
  try {
    const result = await call('schedule.generate', options);
    if (state !== owner) return;
    owner.dialog = null;
    owner.generation = {
      kind: 'success', key: options.restart ? 'template.restarted' : 'template.created',
      params: { inserted: result.inserted, updated: result.updated, removed: result.removed },
    };
    refresh();
    focusById('template-generate');
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    if (owner.dialog !== d) return;
    d.messageKey = generationErrorKey(error);
    d.blocked = !RETRYABLE_ERRORS.includes(error.code);
    refresh();
  }
}

// The dialog of one cell

function dialogFor(d) {
  if (d.kind === 'cell') return cellDialog(d);
  if (d.kind === 'preview') return previewDialog(d);
  return restartDialog(d);
}

function closeDialog() {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  refresh();
  focusById(d.returnId, 'template-group');
}

function openCell(weekday, slot, row) {
  state.status = null;
  state.freshId = null;
  state.dialog = {
    kind: 'cell', weekday, slot, row,
    values: { subjectId: row ? row.subjectId : '', roomId: row ? row.roomId ?? '' : '' },
    fieldErrors: {}, messageKey: null, busy: null, returnId: cellId(weekday, slot),
  };
  refresh();
}

function cellDialog(d) {
  const group = currentGroup();
  const subjects = groupSubjects();
  const time = state.data.bells[d.slot - 1];
  const kicker = t(isTime(time) ? 'template.kickerTime' : 'template.kicker',
    { group: group.name, place: placeText(d.weekday, d.slot), time });
  const close = (dialog) => { if (!d.busy) dialog.close(); };
  let dialog;
  if (subjects.length === 0) {
    dialog = modal({ id: 'template-dialog', labelledBy: 'template-dialog-title', onClose: closeDialog },
      el('p', { class: 'dialog__kicker' }, kicker),
      el('h2', { class: 'dialog__title', id: 'template-dialog-title' }, t('template.newPair')),
      note('info', t('template.noSubjects', { group: group.name })),
      el('div', { class: 'dialog__actions' },
        can('dir.list:subjects') ? el('a', { class: 'button button--secondary', href: '#/dir/subjects' }, icon('book'), t('dir.subjects')) : null,
        el('button', { type: 'button', class: 'button button--primary', onclick: () => close(dialog) }, t('common.close'))));
    return dialog;
  }
  const save = el('button', { type: 'submit', id: 'template-save', class: 'button button--primary' }, t('common.save'));
  if (d.busy === 'save') markBusy(save, 'common.saving');
  const remove = d.row && can('dir.remove:weekTemplate')
    ? el('button', { type: 'button', id: 'template-remove', class: 'button button--secondary button--quiet-danger dialog__aside', onclick: () => removeCell(d) },
      icon('trash'), t('common.remove'))
    : null;
  if (remove && d.busy === 'remove') markBusy(remove, 'dir.removing');
  const subjectOptions = subjects.map((subject) => {
    const teacher = teacherName(subject);
    return { value: subject.id, label: teacher ? t('template.subjectOption', { subject: subject.name, teacher }) : subject.name };
  });
  const roomOptions = state.data.rooms.map((room) => ({ value: room.id, label: room.name }));
  dialog = modal({ id: 'template-dialog', labelledBy: 'template-dialog-title', onClose: closeDialog, canCancel: () => !d.busy },
    el('p', { class: 'dialog__kicker' }, kicker),
    el('h2', { class: 'dialog__title', id: 'template-dialog-title' },
      d.row ? findIn(state.data.subjects, d.row.subjectId).name : t('template.newPair')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); saveCell(d); } },
      selectField({
        id: 'template-subject', label: t('template.subject'), value: d.values.subjectId, options: subjectOptions,
        placeholder: t('template.subjectChoose'), hint: t('template.subjectHint', { group: group.name }),
        error: d.fieldErrors.subjectId ?? null, onChange: (value) => edited(d, 'subjectId', value),
      }),
      selectField({
        id: 'template-room', label: t('template.room'), value: d.values.roomId, options: roomOptions,
        placeholder: t('template.noRoom'), error: d.fieldErrors.roomId ?? null, onChange: (value) => edited(d, 'roomId', value),
      }),
      d.messageKey ? note('error', t(d.messageKey), { role: 'alert', id: 'template-dialog-message' }) : null,
      el('div', { class: 'dialog__actions' },
        remove,
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => close(dialog) }, t('common.cancel')),
        save)));
  return dialog;
}

const FIELD_IDS = { subjectId: 'template-subject', roomId: 'template-room' };

// A field the person changes loses its error mark, and the message about the whole form goes, in place.
function edited(d, name, value) {
  d.values[name] = value;
  if (d.messageKey) {
    d.messageKey = null;
    document.getElementById('template-dialog-message')?.remove();
  }
  if (!d.fieldErrors[name]) return;
  delete d.fieldErrors[name];
  const id = FIELD_IDS[name];
  unmarkField(id + '-error', document.getElementById(id));
}

async function saveCell(d) {
  if (d.busy || state.dialog !== d) return;
  const owner = state;
  d.messageKey = null;
  d.fieldErrors = {};
  if (d.values.subjectId === '') {
    d.fieldErrors.subjectId = 'template.error.subjectId.required';
    refresh();
    focusFirstInvalid();
    return;
  }
  d.busy = 'save';
  refresh();
  const row = { weekday: d.weekday, slot: d.slot, subjectId: d.values.subjectId, roomId: d.values.roomId };
  if (d.row) row.id = d.row.id;
  try {
    const data = await call('dir.save', { table: 'weekTemplate', row });
    if (state !== owner) return;
    const saved = data.row;
    owner.data.template = d.row ? owner.data.template.map((r) => (r.id === saved.id ? saved : r)) : [...owner.data.template, saved];
    owner.dialog = null;
    owner.freshId = saved.id;
    owner.status = { key: 'template.saved', params: { subject: findIn(owner.data.subjects, saved.subjectId)?.name ?? '', place: placeText(d.weekday, d.slot) } };
    refresh();
    focusById(cellId(d.weekday, d.slot));
  } catch (error) {
    if (state !== owner) return;
    d.busy = null;
    if (owner.dialog !== d) return;
    showSaveError(d, error);
    refresh();
    focusFirstInvalid();
  }
}

// teacher_busy and room_busy go to their fields; group_busy (the server marks `slot`, which the dialog has no
// field for: the cell sets it) and anything else are one line above the buttons.
function showSaveError(d, error) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  for (const { field: name, code } of fields) {
    if (FORM_FIELDS.includes(name)) d.fieldErrors[name] = fieldErrorKey('weekTemplate', name, code, 'template');
  }
  const other = fields.find(({ field: name }) => !FORM_FIELDS.includes(name));
  if (other) d.messageKey = fieldErrorKey('weekTemplate', other.field, other.code, 'template');
  else if (fields.length === 0) d.messageKey = errorKey(error.code);
}

async function removeCell(d) {
  if (d.busy || state.dialog !== d || !d.row) return;
  const owner = state;
  d.busy = 'remove';
  d.messageKey = null;
  refresh();
  try {
    await call('dir.remove', { table: 'weekTemplate', id: d.row.id });
    if (state !== owner) return;
    owner.data.template = owner.data.template.filter((r) => r.id !== d.row.id);
    owner.dialog = null;
    owner.status = { key: 'template.removed', params: { subject: findIn(owner.data.subjects, d.row.subjectId)?.name ?? '', place: placeText(d.weekday, d.slot) } };
    refresh();
    focusById(cellId(d.weekday, d.slot), 'template-group');
  } catch (error) {
    if (state !== owner) return;
    d.busy = null;
    if (error.code === 'not_found') owner.data.template = owner.data.template.filter((r) => r.id !== d.row.id);
    if (owner.dialog !== d) return;
    d.messageKey = errorKey(error.code);
    refresh();
  }
}

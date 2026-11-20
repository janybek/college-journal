import { call } from '../api.js';
import { t, getLang } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, field, selectField, modal, showModal, focusById, focusFirstInvalid, markBusy, refresh,
  emptyState, note, pageHeader, unmarkField, badge, iconButton, dataTable,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { addDays, addMinutes, isDate, isTime, mondayOf } from '../dates.js';
import { groupByDay, pairFlags, canEditPair, canRestorePair } from '../pairs.js';
import { weekNav, dayList, pairCardId, pairTime, weekdayDate, typeBadge, flagBadge } from './pairParts.js';

// The deanery's schedule (#/schedule): the week of a group or of a teacher, or one day across all groups. A pair
// that may still change opens a dialog to substitute the teacher, move the pair, change the room or cancel it;
// a cancelled pair of today or later can be put back. Without schedule.changePair (the vice-rector) the
// schedule is read-only. «Today» always comes from the server's answer, never from the device clock.
// Drawn from `state`, so a redraw (language switch) keeps the mode, the week and an open dialog.

const MODES = ['group', 'teacher', 'day'];
const FIELDS = ['teacherId', 'date', 'slot', 'roomId', 'note'];
const PLACE_FIELDS = ['date', 'slot', 'teacherId', 'roomId'];
const FIELD_IDS = { teacherId: 'pair-teacher', date: 'pair-date', slot: 'pair-slot', roomId: 'pair-room', note: 'pair-note', cancelNote: 'pair-cancel-note' };
// Failures worth trying again; any other answer would not change on a retry.
const RETRYABLE_ERRORS = ['network', 'internal'];
// Answers that mean the pair is no longer what the screen shows: the week is read again when the dialog closes.
const STALE_ERRORS = ['pair_locked', 'in_past', 'not_found'];
// Earlier years are half-typed ones (0002, 0020, 0202 on the way to 2026): they are not requested.
const FIRST_DAY = '2000-01-01';
const NOTE_MAX = 200;

const blank = () => ({
  refs: null,          // { groups, teachers, rooms, bells, pairMinutes }; null until loaded
  refsErrorKey: null,
  refsPending: false,
  mode: 'group',
  groupId: '',
  teacherId: '',
  from: null,          // the Monday of the week shown; null: the week of «today»
  day: null,           // the day of the day mode; null: «today»
  today: null,         // from the last answer of the server
  result: null,        // { key, scope, from, pairs }: what is drawn
  loadingKey: null,
  loadErrorKey: null,
  ticket: 0,
  status: null,        // { key, params }: what the last change did
  freshId: null,       // the pair changed last, marked in the week
  dialog: null,        // { kind: 'change' | 'cancel' | 'restore', ... }
});
let state = blank();

const can = (permission) => permissions().includes(permission);
const canChange = () => can('schedule.changePair');
const canOpen = (pair) => canEditPair(pair, state.today) || canRestorePair(pair, state.today);

export function leave() {
  state = blank();
}

// What is asked of the server: the scope (mode and whose week) and the week or the day in it.
const scopeOf = (s) => (s.mode === 'day' ? 'day' : s.mode + ':' + (s.mode === 'group' ? s.groupId : s.teacherId));
const keyOf = (s) => scopeOf(s) + '@' + (s.mode === 'day' ? s.day : s.from);

export function render(root) {
  if (state.refs === null && state.refsErrorKey === null && !state.refsPending) loadRefs(state);
  root.append(pageHeader({ id: 'schedule-title', title: t('schedule.title'), lead: t(canChange() ? 'schedule.leadEdit' : 'schedule.lead') }));
  if (state.refs === null) {
    root.append(failedOrLoading(state.refsErrorKey, () => { state.refsErrorKey = null; refresh(); }));
    return;
  }
  const key = keyOf(state);
  if (whoMissing() === null && state.result?.key !== key && state.loadingKey !== key && state.loadErrorKey === null) loadPairs(state);
  if (!canChange()) root.append(note('info', t('schedule.readOnly')));
  root.append(
    el('div', { class: 'notes schedule-notes', role: 'status' }, state.status ? note('success', t(state.status.key, state.status.params)) : null),
    el('section', { class: 'card schedule-card', 'aria-labelledby': 'schedule-title' },
      el('div', { class: 'toolbar schedule-toolbar' }, modeSwitch(), state.mode === 'day' ? dayTools() : weekTools()),
      body()));
  if (state.dialog) showModal(root, dialogFor(state.dialog));
}

async function loadRefs(owner) {
  owner.refsPending = true;
  const tables = ['groups', 'staff', 'rooms'].filter((table) => can('dir.list:' + table));
  try {
    const [settings, ...lists] = await Promise.all([
      can('settings.get') ? call('settings.get', {}) : null,
      ...tables.map((table) => call('dir.list', { table })),
    ]);
    if (state !== owner) return;
    const rows = Object.fromEntries(tables.map((table, i) => [table, lists[i].rows]));
    owner.refs = {
      groups: sortBy(rows.groups ?? [], 'name'),
      teachers: sortBy((rows.staff ?? []).filter((person) => rolesOf(person).includes('teacher')), 'fullName'),
      rooms: sortBy(rows.rooms ?? [], 'name'),
      bells: settings ? settings.settings.bells : [],
      pairMinutes: settings ? settings.pairMinutes : 0,
    };
    owner.groupId = owner.refs.groups[0]?.id ?? '';
    owner.teacherId = owner.refs.teachers[0]?.id ?? '';
    owner.refsErrorKey = null;
  } catch (error) {
    if (state !== owner) return;
    owner.refsErrorKey = errorKey(error.code);
  } finally {
    owner.refsPending = false;
  }
  refresh();
}

// The week (or the day) the controls ask for. The first request has no `from`: the server answers with the week
// of «today» and says which day that is.
async function loadPairs(owner) {
  const ticket = ++owner.ticket;
  const mode = owner.mode;
  owner.loadingKey = keyOf(owner);
  const request = {};
  if (mode === 'day') {
    if (owner.day !== null) Object.assign(request, { from: owner.day, to: owner.day });
  } else {
    request[mode === 'group' ? 'groupId' : 'teacherId'] = mode === 'group' ? owner.groupId : owner.teacherId;
    if (owner.from !== null) request.from = owner.from;
  }
  try {
    const data = await call('schedule.list', request);
    if (state !== owner || owner.ticket !== ticket) return;
    owner.today = data.today;
    let pairs = data.pairs;
    if (mode === 'day') {
      if (owner.day === null) owner.day = data.today;
      pairs = pairs.filter((pair) => pair.date === owner.day);
    } else {
      owner.from = data.from;
    }
    owner.result = { key: keyOf(owner), scope: scopeOf(owner), from: data.from, pairs };
    owner.loadErrorKey = null;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loadingKey = null;
  }
  refresh();
}

// Reads the shown week again; until the answer comes the old one stays on the screen.
function reload() {
  if (state.result) state.result = { ...state.result, key: null };
  state.loadErrorKey = null;
}

// The controls changed what is shown.
function show(changes, focusId) {
  Object.assign(state, changes);
  state.loadErrorKey = null;
  state.status = null;
  state.freshId = null;
  refresh();
  if (focusId) focusById(focusId);
}

function failedOrLoading(messageKey, retry) {
  if (!messageKey) return el('p', { class: 'loading' }, t('common.loading'));
  const body = emptyState('alert',
    el('p', {}, t(messageKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// Helpers over the loaded rows

function sortBy(rows, key) {
  const compare = new Intl.Collator(getLang(), { numeric: true, sensitivity: 'base' }).compare;
  return [...rows].sort((a, b) => compare(String(a[key] ?? ''), String(b[key] ?? '')));
}

const rolesOf = (person) => String(person.roles ?? '').split(',').map((role) => role.trim());

// The empty-state text when there is nobody to show a week for, else null.
function whoMissing() {
  if (state.mode === 'group' && state.groupId === '') return 'field.groupId.none';
  if (state.mode === 'teacher' && state.teacherId === '') return 'schedule.noTeachers';
  return null;
}

// The toolbar

function modeSwitch() {
  return el('div', { class: 'segmented', role: 'group', 'aria-label': t('schedule.mode') }, MODES.map((mode) => el('button', {
    type: 'button', id: 'schedule-mode-' + mode, class: 'segmented__button', 'aria-pressed': String(mode === state.mode),
    onclick: () => chooseMode(mode),
  }, t('schedule.mode.' + mode))));
}

// From a week to the day mode: the day stays, or «today»; from the day mode to a week: the week of that day.
function chooseMode(mode) {
  if (mode === state.mode) return;
  const changes = { mode };
  if (mode === 'day' && state.day === null) changes.day = state.today;
  if (mode !== 'day' && state.mode === 'day' && state.day !== null) changes.from = mondayOf(state.day);
  show(changes, 'schedule-mode-' + mode);
}

function weekTools() {
  const byGroup = state.mode === 'group';
  const options = byGroup
    ? state.refs.groups.map((group) => ({ value: group.id, label: group.name }))
    : state.refs.teachers.map((person) => ({ value: person.id, label: person.fullName }));
  return [
    options.length > 0 ? selectField({
      id: 'schedule-who', label: t(byGroup ? 'field.groupId' : 'schedule.teacher'), hideLabel: true,
      value: byGroup ? state.groupId : state.teacherId, options,
      onChange: (value) => show(byGroup ? { groupId: value } : { teacherId: value }, 'schedule-who'),
    }) : null,
    state.from !== null ? weekNav({ from: state.from, onChange: (from) => show({ from }) }) : null,
  ];
}

function dayTools() {
  if (state.day === null) return null;
  const input = el('input', {
    id: 'schedule-day', type: 'date', class: 'field__input schedule-day__input', value: state.day,
    onchange: () => { if (isDate(input.value) && input.value >= FIRST_DAY && input.value !== state.day) show({ day: input.value }, 'schedule-day'); },
  });
  return el('div', { class: 'schedule-day', role: 'group', 'aria-label': t('schedule.dayNav') },
    el('label', { class: 'visually-hidden', for: 'schedule-day' }, t('schedule.dayField')),
    input,
    iconButton({ id: 'day-prev', iconName: 'chevron', label: t('schedule.prevDay'), className: 'icon-button--outline chevron-back', onClick: () => show({ day: addDays(state.day, -1) }) }),
    iconButton({ id: 'day-next', iconName: 'chevron', label: t('schedule.nextDay'), className: 'icon-button--outline', onClick: () => show({ day: addDays(state.day, 1) }) }),
    el('button', { type: 'button', id: 'day-today', class: 'button button--secondary', onclick: () => show({ day: state.today }) }, t('pairs.today')),
    el('p', { class: 'schedule-day__label', 'aria-live': 'polite' },
      el('span', {}, weekdayDate(state.day)),
      state.day === state.today ? badge(t('pairs.today'), 'primary', true) : null));
}

// The week or the day

function body() {
  const missing = whoMissing();
  if (missing) {
    return el('div', { class: 'schedule-empty' }, emptyState(state.mode === 'group' ? 'layers' : 'briefcase', el('p', {}, t(missing)),
      state.mode === 'group' && can('dir.list:groups') ? el('a', { class: 'button button--secondary', href: '#/dir/groups' }, icon('layers'), t('dir.groups')) : null,
      state.mode === 'teacher' && can('dir.list:staff') ? el('a', { class: 'button button--secondary', href: '#/dir/staff' }, icon('briefcase'), t('dir.staff')) : null));
  }
  const { result } = state;
  // A different week or day of the same scope stays on the screen, dimmed, until the new one comes.
  const shown = result && result.scope === scopeOf(state) ? result : null;
  if (state.loadErrorKey) return el('div', { class: 'schedule-empty' }, failedOrLoading(state.loadErrorKey, () => { state.loadErrorKey = null; refresh(); }));
  if (!shown) return el('div', { class: 'schedule-empty' }, failedOrLoading(null));
  const stale = shown.key !== keyOf(state);
  return el('div', { class: 'schedule-body' + (stale ? ' is-stale' : ''), 'aria-busy': stale ? 'true' : null },
    state.mode === 'day' ? dayTable(shown.pairs) : weekBody(shown));
}

function weekBody(shown) {
  // Monday to Saturday; Sunday only when it has a pair.
  const days = groupByDay(shown.pairs, shown.from, 7).filter((day, i) => i < 6 || day.pairs.length > 0);
  const list = dayList(days, state.today, {
    show: state.mode === 'group' ? ['teacher'] : ['group'],
    onOpen: canChange() ? openPair : null,
    canOpen,
  });
  if (state.freshId) list.querySelector('#' + CSS.escape(pairCardId({ id: state.freshId })))?.classList.add('is-fresh');
  return el('div', { class: 'schedule-week' },
    shown.pairs.length === 0 ? note('info', t('schedule.emptyWeek')) : null,
    list);
}

const actionId = (pair) => 'pair-action-' + pair.id;

function dayTable(pairs) {
  if (pairs.length === 0) return emptyState('calendar', el('p', {}, t('schedule.emptyDay')));
  const actions = canChange() && pairs.some(canOpen);
  const columns = [
    { label: t('schedule.col.pair'), className: 'schedule-table__pair' },
    { label: t('field.groupId') },
    { label: t('schedule.col.subject') },
    { label: t('schedule.teacher') },
    { label: t('template.room') },
    { label: t('schedule.col.topic') },
    { label: t('schedule.col.status') },
    actions ? { label: t('dir.actions'), className: 'table__actions' } : null,
  ].filter(Boolean);
  const table = dataTable({
    className: 'schedule-table',
    columns,
    rows: pairs.map((pair) => [
      el('span', { class: 'schedule-table__when' },
        el('span', { class: 'week__number' }, String(pair.slot)),
        el('span', { class: 'schedule-table__time' }, pairTime(pair))),
      pair.groupName,
      el('span', { class: 'table__label' }, pair.subjectName),
      el('span', { class: pair.substitution ? 'is-substitute' : null }, pair.teacherName),
      pair.roomName,
      pair.status === 'cancelled' ? '' : topicCell(pair.topic),
      statusCell(pair),
      ...(actions ? [rowAction(pair)] : []),
    ]),
  });
  // Rows of cancelled pairs are dimmed like their cards.
  table.querySelectorAll('tbody tr').forEach((row, i) => {
    if (pairs[i].status === 'cancelled') row.classList.add('is-cancelled');
    if (pairs[i].id === state.freshId) row.classList.add('is-fresh');
  });
  return table;
}

function topicCell(topic) {
  if (!topic) return el('span', { class: 'muted' }, t('pairs.noTopic'));
  return el('span', { class: 'schedule-table__topic' }, el('span', {}, t('pairs.topic', { n: topic.order, name: topic.name })), typeBadge(topic.lessonType));
}

function statusCell(pair) {
  const flags = pairFlags(pair);
  return el('span', { class: 'badges schedule-table__status' },
    flags.includes('cancelled') ? null : badge(t('pairs.status.' + pair.status), pair.status === 'closed' ? 'success' : 'neutral'),
    flags.map((flag) => flagBadge(flag, pair)));
}

function rowAction(pair) {
  if (!canOpen(pair)) return null;
  const restore = pair.status === 'cancelled';
  return el('button', { type: 'button', id: actionId(pair), class: 'button button--secondary schedule-table__open', onclick: () => openPair(pair) },
    icon(restore ? 'calendar' : 'pencil'), t(restore ? 'schedule.restore.short' : 'common.edit'));
}

// The dialogs of one pair

function openPair(pair) {
  if (!canChange() || state.dialog) return;
  const returnId = state.mode === 'day' ? actionId(pair) : pairCardId(pair);
  const common = { pair, fieldErrors: {}, messageKey: null, busy: null, blocked: false, stale: false, returnId };
  state.status = null;
  state.freshId = null;
  if (canEditPair(pair, state.today)) {
    state.dialog = {
      kind: 'change', ...common,
      values: { teacherId: pair.teacherId, date: pair.date, slot: String(pair.slot), roomId: pair.roomId ?? '', note: pair.note ?? '' },
      cancelNote: pair.note ?? '',
    };
  } else if (canRestorePair(pair, state.today)) {
    state.dialog = { kind: 'restore', ...common };
  } else {
    return;
  }
  refresh();
}

function dialogFor(d) {
  if (d.kind === 'change') return changeDialog(d);
  if (d.kind === 'cancel') return cancelDialog(d);
  return restoreDialog(d);
}

function closeDialog() {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  if (d.stale) reload();
  refresh();
  focusById(d.returnId, 'schedule-mode-' + state.mode);
}

// Where and what the pair is now: the kicker, and a line with the day, the pair number and the time.
function pairHeader(d, titleKey) {
  const { pair } = d;
  const time = pairTime(pair);
  const place = t('schedule.place', { date: weekdayDate(pair.date), pair: t('settings.pairN', { n: pair.slot }) });
  const flags = pairFlags(pair);
  return [
    el('p', { class: 'dialog__kicker' }, t('schedule.kicker', { group: pair.groupName, subject: pair.subjectName })),
    el('h2', { class: 'dialog__title', id: 'schedule-dialog-title' }, t(titleKey)),
    el('div', { class: 'pair-now' },
      el('p', { class: 'pair-now__place' }, icon('calendar'), el('span', {}, time ? t('schedule.placeTime', { place, time }) : place)),
      flags.length > 0 ? el('p', { class: 'badges' }, flags.map((flag) => flagBadge(flag, pair))) : null),
  ];
}

const message = (d) => (d.messageKey ? note('error', t(d.messageKey), { role: 'alert', id: 'schedule-dialog-message' }) : null);

function changeDialog(d) {
  const { pair } = d;
  const close = (dialog) => { if (!d.busy) dialog.close(); };
  const save = el('button', { type: 'submit', id: 'pair-save', class: 'button button--primary', disabled: !dirty(d) }, t('common.save'));
  if (d.busy === 'save') markBusy(save, 'common.saving');
  const teachers = state.refs.teachers.filter((person) => person.active === true || person.id === pair.teacherId);
  if (!teachers.some((person) => person.id === pair.teacherId)) teachers.unshift({ id: pair.teacherId, fullName: pair.teacherName });
  const dialog = modal({ id: 'schedule-dialog', labelledBy: 'schedule-dialog-title', className: 'dialog--pair', onClose: closeDialog, canCancel: () => !d.busy },
    pairHeader(d, 'schedule.change.title'),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); savePair(d); } },
      selectField({
        id: FIELD_IDS.teacherId, label: t('schedule.teacher'), value: d.values.teacherId,
        options: teachers.map((person) => ({ value: person.id, label: person.fullName })),
        hint: t('schedule.teacherHint'), error: d.fieldErrors.teacherId ?? null, onChange: (value) => edited(d, 'teacherId', value),
      }),
      el('div', { class: 'pair-when' },
        field({
          id: FIELD_IDS.date, label: t('schedule.date'), type: 'date', value: d.values.date,
          error: d.fieldErrors.date ?? null, onInput: (value) => edited(d, 'date', value),
        }),
        selectField({
          id: FIELD_IDS.slot, label: t('schedule.slot'), value: d.values.slot, options: slotOptions(pair),
          error: d.fieldErrors.slot ?? null, onChange: (value) => edited(d, 'slot', value),
        })),
      selectField({
        id: FIELD_IDS.roomId, label: t('template.room'), value: d.values.roomId,
        options: state.refs.rooms.map((room) => ({ value: room.id, label: room.name })), placeholder: t('template.noRoom'),
        error: d.fieldErrors.roomId ?? null, onChange: (value) => edited(d, 'roomId', value),
      }),
      noteField(FIELD_IDS.note, d.values.note, 'schedule.noteHint', d.fieldErrors.note, (value) => edited(d, 'note', value)),
      message(d),
      el('div', { class: 'dialog__actions' },
        d.blocked ? null : el('button', {
          type: 'button', id: 'pair-cancel', class: 'button button--secondary button--quiet-danger dialog__aside', onclick: () => toCancel(d),
        }, icon('calendarOff'), t('schedule.cancel.button')),
        // «Close», not «Cancel»: next to «Cancel class» that word would read as cancelling the pair.
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => close(dialog) }, t('common.close')),
        d.blocked ? null : save)));
  return dialog;
}

function noteField(id, value, hintKey, error, onInput) {
  return field({
    id, label: t('schedule.note'), value, hint: t(hintKey), error: error ?? null, onInput,
    attrs: { maxlength: String(NOTE_MAX), autocomplete: 'off' },
  });
}

// Every pair of the bells with its time; a pair number beyond the bells stays choosable for the pair that has it.
function slotOptions(pair) {
  const { bells, pairMinutes } = state.refs;
  const count = Math.max(bells.length, pair.slot);
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const name = t('settings.pairN', { n });
    const time = bells[i];
    return {
      value: String(n),
      label: isTime(time) && pairMinutes > 0
        ? t('schedule.slotOption', { pair: name, time: t('pairs.time', { from: time, to: addMinutes(time, pairMinutes) }) })
        : name,
    };
  });
}

// What differs from the pair as it is: only that is sent. Without a difference «Save» stays off.
function patchOf(d) {
  const { values: v, pair: p } = d;
  const patch = {};
  if (v.teacherId !== p.teacherId) patch.teacherId = v.teacherId;
  if (v.date !== p.date) patch.date = v.date;
  if (Number(v.slot) !== p.slot) patch.slot = Number(v.slot);
  if (v.roomId !== (p.roomId ?? '')) patch.roomId = v.roomId;
  if (v.note.trim() !== (p.note ?? '')) patch.note = v.note.trim();
  return patch;
}

const dirty = (d) => Object.keys(patchOf(d)).length > 0;

// A field the person changes loses its error mark, and the message about the whole pair goes, in place
// (a redraw would throw the caret out of the date field).
function edited(d, name, value) {
  if (name === 'cancelNote') d.cancelNote = value;
  else d.values[name] = value;
  if (d.kind === 'change') {
    const save = document.getElementById('pair-save');
    if (save && !d.busy) save.disabled = !dirty(d);
  }
  if (d.messageKey && !d.blocked) {
    d.messageKey = null;
    document.getElementById('schedule-dialog-message')?.remove();
  }
  // Whether the group, the teacher or the room is busy depends on the day and the pair number: a new place
  // takes those marks off too.
  const marked = name === 'date' || name === 'slot' ? PLACE_FIELDS : [name];
  for (const key of marked.filter((key) => d.fieldErrors[key])) {
    delete d.fieldErrors[key];
    unmarkField(FIELD_IDS[key] + '-error', document.getElementById(FIELD_IDS[key]));
  }
}

async function savePair(d) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  const patch = patchOf(d);
  if (Object.keys(patch).length === 0) return;
  d.messageKey = null;
  d.fieldErrors = {};
  if (patch.date !== undefined && !isDate(patch.date)) {
    d.fieldErrors.date = 'schedule.error.date.bad_value';
    refresh();
    focusFirstInvalid();
    return;
  }
  await send(d, 'save', 'schedule.changePair', { id: d.pair.id, ...patch }, 'schedule.saved');
}

// One request of a dialog; on success the dialog closes and the week is read again.
async function send(d, busy, action, data, doneKey) {
  const owner = state;
  d.busy = busy;
  refresh();
  try {
    const result = await call(action, data);
    if (state !== owner) return;
    const pair = result.pair;
    owner.dialog = null;
    owner.status = { key: doneKey, params: { subject: pair.subjectName, group: pair.groupName, date: weekdayDate(pair.date) } };
    owner.freshId = pair.id;
    reload();
    refresh();
    focusById(d.returnId, 'schedule-mode-' + owner.mode);
  } catch (error) {
    if (state !== owner) return;
    d.busy = null;
    if (owner.dialog !== d) return;
    showErrors(d, error);
    refresh();
    focusFirstInvalid();
  }
}

// Mistakes of the fields go to their fields with this screen's texts; anything about the whole pair is one line
// above the buttons. When the pair can no longer change, only «Close» is left and the week is read again.
function showErrors(d, error) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  if (fields.length === 0) {
    d.messageKey = errorKey(error.code);
    d.blocked = !RETRYABLE_ERRORS.includes(error.code);
    d.stale = STALE_ERRORS.includes(error.code);
    return;
  }
  const onScreen = d.kind === 'change' ? FIELDS : d.kind === 'cancel' ? ['note'] : [];
  for (const { field: name, code } of fields) {
    const key = fieldErrorKey('pairs', name, code, 'schedule');
    if (onScreen.includes(name)) d.fieldErrors[d.kind === 'cancel' ? 'cancelNote' : name] = key;
    else if (!d.messageKey) d.messageKey = key;
  }
  // Restoring has no fields to fix: the pair's place is taken or no longer a working day.
  if (d.kind === 'restore') d.blocked = true;
}

// Cancelling: a second step in the same dialog, with a note for the people who see the pair.
function toCancel(d) {
  if (d.busy || state.dialog !== d) return;
  d.kind = 'cancel';
  d.messageKey = null;
  refresh();
  focusById(FIELD_IDS.cancelNote);
}

function cancelDialog(d) {
  const back = () => {
    if (d.busy) return;
    d.kind = 'change';
    d.messageKey = null;
    d.blocked = false;
    refresh();
    focusById('pair-cancel');
  };
  const confirm = el('button', { type: 'submit', id: 'pair-cancel-confirm', class: 'button button--danger' }, t('schedule.cancel.button'));
  if (d.busy === 'cancel') markBusy(confirm, 'schedule.cancel.busy');
  return modal({ id: 'schedule-dialog', labelledBy: 'schedule-dialog-title', className: 'dialog--pair', onClose: closeDialog, canCancel: () => !d.busy },
    pairHeader(d, 'schedule.cancel.title'),
    el('p', {}, t('schedule.cancel.text')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); cancelPair(d); } },
      noteField(FIELD_IDS.cancelNote, d.cancelNote, 'schedule.cancel.noteHint', d.fieldErrors.cancelNote, (value) => edited(d, 'cancelNote', value)),
      message(d),
      el('div', { class: 'dialog__actions' },
        d.blocked
          ? el('button', { type: 'button', class: 'button button--secondary', onclick: () => document.getElementById('schedule-dialog')?.close() }, t('common.close'))
          : el('button', { type: 'button', id: 'pair-cancel-back', class: 'button button--secondary', onclick: back }, t('schedule.back')),
        d.blocked ? null : confirm)));
}

async function cancelPair(d) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  d.messageKey = null;
  d.fieldErrors = {};
  await send(d, 'cancel', 'schedule.cancelPair', { id: d.pair.id, note: d.cancelNote.trim() }, 'schedule.cancelled');
}

function restoreDialog(d) {
  const confirm = el('button', { type: 'button', id: 'pair-restore', class: 'button button--primary', onclick: () => restorePair(d) }, t('schedule.restore.button'));
  if (d.busy === 'restore') markBusy(confirm, 'schedule.restore.busy');
  const dialog = modal({ id: 'schedule-dialog', labelledBy: 'schedule-dialog-title', className: 'dialog--pair', onClose: closeDialog, canCancel: () => !d.busy },
    pairHeader(d, 'schedule.restore.title'),
    d.pair.note ? el('p', { class: 'pair-now__note' }, d.pair.note) : null,
    el('p', {}, t('schedule.restore.text')),
    message(d),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!d.busy) dialog.close(); } }, t(d.blocked ? 'common.close' : 'common.cancel')),
      d.blocked ? null : confirm));
  return dialog;
}

async function restorePair(d) {
  if (d.busy || d.blocked || state.dialog !== d) return;
  d.messageKey = null;
  await send(d, 'restore', 'schedule.restorePair', { id: d.pair.id }, 'schedule.restored');
}

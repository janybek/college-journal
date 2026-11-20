import { call } from '../api.js';
import { t } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, field, focusById, focusFirstInvalid, markBusy, refresh,
  badge, emptyState, iconButton, note, pageHeader,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { isDate, isTime, minutesOf, addMinutes, dayParts } from '../dates.js';

// Semester settings (#/settings): the semester dates, the days off and the bell times. Drawn from `state`, so a
// redraw (language switch) keeps what was typed. What depends on a typed value (the date under a date field,
// the end of a class, the breaks, the day ribbon) is updated in place while typing: a redraw would throw the
// caret out of a date or time field. Without settings.save (the vice-rector) everything is read-only.

// A copy of MAX_SLOTS in core/settings.js: the server checks it again.
const MAX_BELLS = 8;
const LAST_MINUTE = 23 * 60 + 59;
// The break a new class gets after the last one.
const NEW_BREAK = 10;
const FIELD_NAMES = ['semesterStart', 'semesterEnd', 'holidays', 'bells'];

const blank = () => ({
  loaded: null,          // { settings, defaultBells, pairMinutes } from settings.get; null until loaded
  loadErrorKey: null,
  pending: false,
  values: null,          // what is on screen: { semesterStart, semesterEnd, holidays, bells }
  newHoliday: '',
  holidayErrorKey: null,
  errors: {},            // field -> { key, params }
  badBells: [],          // indexes of the bell fields to mark
  messageKey: null,      // an error about the whole form
  saved: false,          // the last save went through and nothing changed since
  busy: false,
});
let state = blank();
let live = null;         // elements updated in place: { status, dateHints, holidays, bells }

const canSave = () => permissions().includes('settings.save');
const copy = (settings) => ({ ...settings, holidays: [...settings.holidays], bells: [...settings.bells] });
const sameValues = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isDirty = () => !sameValues(state.values, state.loaded.settings);

export function leave() {
  state = blank();
  live = null;
}

export function render(root) {
  if (state.loaded === null && state.loadErrorKey === null && !state.pending) load(state);
  root.append(pageHeader({ id: 'settings-title', title: t('settings.title'), lead: t('settings.lead') }));
  if (state.loaded === null) {
    root.append(loadingBody());
    return;
  }
  const editable = canSave();
  live = { status: null, dateHints: [], holidays: [], bells: null };
  const panels = el('div', { class: 'settings' },
    el('div', { class: 'settings__column' }, semesterPanel(editable), holidaysPanel(editable)),
    el('div', { class: 'settings__column' }, bellsPanel(editable)));
  if (editable) root.append(panels, ...saveBar());
  else root.append(note('info', t('settings.readOnly')), panels);
  syncAll();
}

async function load(owner) {
  owner.pending = true;
  try {
    const data = await call('settings.get', {});
    if (state !== owner) return;
    owner.loaded = { settings: copy(data.settings), defaultBells: [...data.defaultBells], pairMinutes: data.pairMinutes };
    owner.values = copy(data.settings);
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

// Dates in words, from the dictionaries: «21 ноября», «суббота, 21 ноября».

function dayMonth(date) {
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
}

function longDate(date) {
  return t('date.weekdayDate', { weekday: t('date.weekday.' + dayParts(date).weekday), date: dayMonth(date) });
}

const dateHint = (value) => (isDate(value) ? longDate(value) : t('settings.noDate'));

// Panels

function panel(id, iconName, titleKey, hint, ...body) {
  return el('section', { class: 'card panel', 'aria-labelledby': id },
    el('header', { class: 'panel__head' },
      el('span', { class: 'panel__icon' }, icon(iconName)),
      el('div', { class: 'panel__text' },
        el('h2', { class: 'panel__title', id }, t(titleKey)),
        hint ? el('p', { class: 'panel__hint' }, hint) : null)),
    el('div', { class: 'panel__body' }, ...body));
}

function semesterPanel(editable) {
  const dateField = (name, id, labelKey) => {
    const error = state.errors[name];
    const input = field({
      id, label: t(labelKey), type: 'date', value: state.values[name], hint: dateHint(state.values[name]),
      error: error ? error.key : null,
      onInput: (value) => { state.values[name] = value; syncAll(); },
      attrs: { readonly: !editable, required: true },
    });
    live.dateHints.push({ name, hint: input.querySelector('.field__hint') });
    return input;
  };
  return panel('settings-semester', 'calendar', 'settings.semester', t('settings.semesterHint'),
    el('div', { class: 'date-pair' },
      dateField('semesterStart', 'settings-start', 'settings.start'),
      dateField('semesterEnd', 'settings-end', 'settings.end')));
}

function holidaysPanel(editable) {
  const { holidays } = state.values;
  const list = holidays.length === 0
    ? el('p', { class: 'muted' }, t('settings.holidaysEmpty'))
    : el('ul', { class: 'holidays' }, holidays.map((date) => holidayItem(date, editable)));
  const error = state.errors.holidays;
  return panel('settings-holidays', 'calendarOff', 'settings.holidays', t('settings.holidaysHint'),
    list,
    error ? fieldLine('settings-holidays-error', t(error.key, error.params)) : null,
    editable ? holidayAdder() : null);
}

function holidayItem(date, editable) {
  const { day, weekday } = dayParts(date);
  const outside = badge(t('settings.outside'), 'warning');
  live.holidays.push({ date, outside });
  return el('li', { class: 'holiday' },
    el('span', { class: 'holiday__leaf' + (weekday >= 6 ? ' holiday__leaf--weekend' : ''), 'aria-hidden': 'true' },
      el('span', { class: 'holiday__weekday' }, t('date.weekdayShort.' + weekday)),
      el('span', { class: 'holiday__day' }, String(day))),
    el('span', { class: 'holiday__text' },
      el('span', { class: 'holiday__date' }, dayMonth(date)),
      el('span', { class: 'holiday__sub' }, t('date.weekday.' + weekday)),
      outside),
    editable ? iconButton({
      id: 'settings-holiday-remove-' + date, iconName: 'trash', className: 'row-action row-action--danger holiday__remove',
      label: t('settings.holidayRemove', { date: dayMonth(date) }), onClick: () => removeHoliday(date),
    }) : null);
}

function holidayAdder() {
  const errorId = 'settings-holiday-new-error';
  const input = el('input', {
    id: 'settings-holiday-new', name: 'settings-holiday-new', type: 'date', class: 'field__input', value: state.newHoliday,
    'aria-invalid': state.holidayErrorKey ? 'true' : null, 'aria-describedby': state.holidayErrorKey ? errorId : null,
    oninput: () => { state.newHoliday = input.value; },
    onkeydown: (event) => { if (event.key === 'Enter') { event.preventDefault(); addHoliday(); } },
  });
  return el('div', { class: 'field adder' },
    el('label', { class: 'field__label', for: input.id }, t('settings.holidayNew')),
    el('div', { class: 'adder__row' },
      input,
      el('button', { type: 'button', id: 'settings-holiday-add', class: 'button button--secondary', onclick: addHoliday },
        icon('plus'), t('settings.holidayAdd'))),
    state.holidayErrorKey ? fieldLine(errorId, t(state.holidayErrorKey)) : null);
}

function addHoliday() {
  const date = state.newHoliday;
  if (!isDate(date)) state.holidayErrorKey = 'settings.error.holidayNew.required';
  else if (state.values.holidays.includes(date)) state.holidayErrorKey = 'settings.error.holidayNew.duplicate';
  else {
    state.holidayErrorKey = null;
    state.values.holidays = [...state.values.holidays, date].sort();
    state.newHoliday = '';
    delete state.errors.holidays;
  }
  changed();
  focusById('settings-holiday-new');
}

function removeHoliday(date) {
  const at = state.values.holidays.indexOf(date);
  state.values.holidays = state.values.holidays.filter((day) => day !== date);
  changed();
  const next = state.values.holidays[Math.min(at, state.values.holidays.length - 1)];
  focusById(next ? 'settings-holiday-remove-' + next : null, 'settings-holiday-new');
}

// Bells: one row per class, the break to the previous class between rows, and a ribbon of the day above.

function bellsPanel(editable) {
  const { bells } = state.values;
  const { pairMinutes } = state.loaded;
  const rows = [];
  const items = [];
  bells.forEach((time, i) => {
    const id = 'settings-bell-' + i;
    const gap = i > 0 ? el('li', { class: 'bell-gap', 'aria-hidden': 'true' }) : null;
    const end = el('span', { class: 'bell__end' });
    const input = el('input', {
      id, name: id, type: 'time', class: 'field__input bell__input', value: time, required: true, readonly: !editable,
      'aria-invalid': state.badBells.includes(i) ? 'true' : null,
      'aria-describedby': state.errors.bells ? 'settings-bells-error' : null,
      oninput: () => { state.values.bells[i] = input.value; syncAll(); },
    });
    rows.push({ gap, end });
    if (gap) items.push(gap);
    items.push(el('li', { class: 'bell' },
      el('span', { class: 'bell__number', 'aria-hidden': 'true' }, String(i + 1)),
      el('label', { class: 'bell__label', for: id }, t('settings.pairN', { n: i + 1 })),
      input,
      end));
  });
  const ribbon = el('div', { class: 'ribbon', 'aria-hidden': 'true' });
  live.bells = { rows, ribbon };
  const error = state.errors.bells;
  const isDefault = sameValues(bells, state.loaded.defaultBells);
  return panel('settings-bells', 'clock', 'settings.bells', t('settings.bellsHint', { minutes: pairMinutes }),
    ribbon,
    el('ol', { class: 'bells' }, items),
    error ? fieldLine('settings-bells-error', t(error.key, error.params)) : null,
    editable ? el('div', { class: 'bells__actions' },
      el('button', { type: 'button', id: 'settings-bell-add', class: 'button button--secondary', disabled: bells.length >= MAX_BELLS, onclick: addBell },
        icon('plus'), t('settings.bellAdd')),
      el('button', { type: 'button', id: 'settings-bell-remove', class: 'button button--secondary', disabled: bells.length <= 1, onclick: removeBell },
        t('settings.bellRemoveLast')),
      el('button', { type: 'button', id: 'settings-bell-reset', class: 'button button--secondary', disabled: isDefault, onclick: resetBells },
        t('settings.bellsReset'))) : null,
    editable && bells.length >= MAX_BELLS ? el('p', { class: 'panel__hint' }, t('settings.bellsMax', { max: MAX_BELLS })) : null);
}

function addBell() {
  const { bells } = state.values;
  if (bells.length >= MAX_BELLS) return;
  const { pairMinutes } = state.loaded;
  const last = bells[bells.length - 1];
  const fits = isTime(last) && minutesOf(last) + 2 * pairMinutes + NEW_BREAK <= LAST_MINUTE;
  state.values.bells = [...bells, fits ? addMinutes(last, pairMinutes + NEW_BREAK) : ''];
  changed();
  focusById('settings-bell-' + bells.length);
}

function removeBell() {
  if (state.values.bells.length <= 1) return;
  state.values.bells = state.values.bells.slice(0, -1);
  forgetBellErrors();
  changed();
  focusById('settings-bell-remove');
}

function resetBells() {
  state.values.bells = [...state.loaded.defaultBells];
  forgetBellErrors();
  changed();
  focusById('settings-bell-reset', 'settings-bell-0');
}

function forgetBellErrors() {
  delete state.errors.bells;
  state.badBells = [];
}

// The bell times checked the way the server checks them, with a reason and the fields to mark.
function checkBells(bells, pairMinutes) {
  const empty = bells.map((time, i) => (isTime(time) ? -1 : i)).filter((i) => i >= 0);
  if (empty.length > 0) return { error: { key: 'settings.error.bells.required' }, bad: empty };
  for (let i = 1; i < bells.length; i++) {
    if (minutesOf(bells[i]) < minutesOf(bells[i - 1]) + pairMinutes) {
      return { error: { key: 'settings.error.bells.overlap', params: { minutes: pairMinutes } }, bad: [i] };
    }
  }
  const last = bells.length - 1;
  if (minutesOf(bells[last]) + pairMinutes > LAST_MINUTE) return { error: { key: 'settings.error.bells.late' }, bad: [last] };
  return null;
}

// In-place updates while typing

function syncAll() {
  if (!live || !state.values) return;
  for (const { name, hint } of live.dateHints) if (hint) hint.textContent = dateHint(state.values[name]);
  const { semesterStart, semesterEnd } = state.values;
  for (const { date, outside } of live.holidays) {
    outside.hidden = !(isDate(semesterStart) && isDate(semesterEnd)) || (date >= semesterStart && date <= semesterEnd);
  }
  if (live.bells) syncBells();
  syncStatus();
}

function syncBells() {
  const { bells } = state.values;
  const { pairMinutes } = state.loaded;
  const { rows, ribbon } = live.bells;
  rows.forEach(({ gap, end }, i) => {
    const time = bells[i];
    end.textContent = isTime(time) ? t('settings.ends', { time: addMinutes(time, pairMinutes) }) : '';
    if (!gap) return;
    const previous = bells[i - 1];
    const known = isTime(time) && isTime(previous);
    const minutes = known ? minutesOf(time) - minutesOf(previous) - pairMinutes : 0;
    gap.classList.toggle('is-overlap', known && minutes < 0);
    gap.textContent = !known ? '' : minutes < 0 ? t('settings.overlap', { minutes: -minutes })
      : minutes === 0 ? t('settings.noBreak') : t('settings.break', { minutes });
  });
  drawRibbon(ribbon, bells, pairMinutes);
}

// The school day from the hour of the first bell to the hour after the last class: a block per class,
// red where it runs into the class before it.
function drawRibbon(ribbon, bells, pairMinutes) {
  const starts = bells.map((time) => (isTime(time) ? minutesOf(time) : null));
  const known = starts.filter((m) => m !== null);
  if (known.length === 0) {
    ribbon.replaceChildren();
    return;
  }
  const from = Math.floor(Math.min(...known) / 60) * 60;
  const span = Math.max(6 * 60, Math.max(...known) + pairMinutes - from);
  const step = span > 10 * 60 ? 120 : 60;
  const to = from + Math.ceil(span / step) * step;
  const at = (minutes) => ((minutes - from) / (to - from)) * 100 + '%';
  const ticks = [];
  for (let m = from; m <= to; m += step) {
    ticks.push(el('span', { class: 'ribbon__tick', style: `left: ${at(m)}` }, String(Math.floor(m / 60) % 24).padStart(2, '0')));
  }
  const blocks = starts.map((start, i) => {
    if (start === null) return null;
    const overlap = i > 0 && starts[i - 1] !== null && start < starts[i - 1] + pairMinutes;
    const width = (Math.min(start + pairMinutes, to) - start) / (to - from) * 100;
    return el('span', { class: 'ribbon__block' + (overlap ? ' is-overlap' : ''), style: `left: ${at(start)}; width: ${width}%` }, String(i + 1));
  });
  ribbon.replaceChildren(el('div', { class: 'ribbon__track' }, blocks), el('div', { class: 'ribbon__scale' }, ticks));
}

function syncStatus() {
  if (!live.status) return;
  const dirty = isDirty();
  live.status.textContent = t(dirty ? 'settings.unsaved' : 'settings.noChanges');
  live.status.classList.toggle('is-dirty', dirty);
  if (dirty && state.saved) {
    state.saved = false;
    const notes = document.getElementById('settings-notes');
    if (notes) notes.replaceChildren();
  }
}

// A change made with a button: the screen is drawn again.
function changed() {
  state.saved = false;
  refresh();
}

// Saving

// Messages about the last save, then the bar with the button; returned as two children of the screen so the
// bar can stay at the bottom of the window.
function saveBar() {
  const submit = el('button', { type: 'button', id: 'settings-save', class: 'button button--primary', onclick: save }, t('common.save'));
  if (state.busy) markBusy(submit, 'common.saving');
  live.status = el('p', { class: 'savebar__status', 'aria-live': 'polite' });
  return [
    el('div', { class: 'notes settings-notes', id: 'settings-notes', role: 'status' },
      state.saved ? [note('success', t('settings.saved')), note('info', t('settings.savedHint'))] : null,
      state.messageKey ? note('error', t(state.messageKey), { role: 'alert' }) : null),
    el('div', { class: 'savebar' }, live.status, submit),
  ];
}

async function save() {
  if (state.busy || !canSave()) return;
  const owner = state;
  const { values } = owner;
  owner.errors = {};
  owner.badBells = [];
  owner.messageKey = null;
  owner.saved = false;
  for (const name of ['semesterStart', 'semesterEnd']) if (values[name] === '') owner.errors[name] = { key: 'error.required' };
  const bells = checkBells(values.bells, owner.loaded.pairMinutes);
  if (bells) {
    owner.errors.bells = bells.error;
    owner.badBells = bells.bad;
  }
  if (Object.keys(owner.errors).length > 0) {
    refresh();
    focusFirstInvalid();
    return;
  }

  owner.busy = true;
  refresh();
  try {
    const data = await call('settings.save', { settings: copy(values) });
    if (state !== owner) return;
    owner.loaded.settings = copy(data.settings);
    owner.values = copy(data.settings);
    owner.saved = true;
  } catch (error) {
    if (state !== owner) return;
    showSaveError(owner, error);
  } finally {
    owner.busy = false;
  }
  if (state !== owner) return;
  refresh();
  if (Object.keys(owner.errors).length > 0) focusFirstInvalid();
  else focusById('settings-save');
}

// Field errors go to their blocks; anything else is one line above the button. What was typed stays.
function showSaveError(owner, error) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  const shown = fields.filter(({ field: name }) => FIELD_NAMES.includes(name));
  for (const { field: name, code } of shown) owner.errors[name] = { key: fieldErrorKey('settings', name, code, 'settings') };
  if (shown.length === 0) owner.messageKey = fields.length > 0 ? fieldErrorKey('settings', fields[0].field, fields[0].code, 'settings') : errorKey(error.code);
  if (owner.errors.bells) owner.badBells = owner.values.bells.map((time, i) => i);
}

// The line under a block that says what is wrong with it.
function fieldLine(id, text) {
  return el('p', { class: 'field__error', id }, icon('alert'), text);
}

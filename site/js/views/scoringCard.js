import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, field, focusFirstInvalid, markBusy, refresh, note, unmarkField } from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';

// The «Баллы и журнал» card of the settings screen: the scoring scheme of the whole college (scoring.get / scoring.save).
// The numbers are kept as typed (strings) so a redraw keeps them; the example line is recomputed in place while
// typing, from what is in the fields. Without scoring.save (the vice-rector) the numbers can only be read.

const GROUPS = [
  ['pair', ['attendance', 'activity']],
  ['unit', ['current', 'self', 'control']],
  ['final', ['semester', 'exam', 'admission']],
  ['grades', ['minimum', 'fair', 'good', 'excellent']],
  ['edit', ['editDays']],
];
// A copy of RANGES in core/scoring.js: the server checks it again.
const RANGES = {
  attendance: [1, 100], activity: [0, 100], current: [1, 100], self: [0, 100], control: [0, 100],
  minimum: [0, 100], fair: [1, 100], good: [1, 100], excellent: [1, 100], editDays: [0, 60],
};
// The split of regulation 2.9 (semester / exam / admission); the server checks it again.
const SPLIT_RANGES = { semester: [1, 99], exam: [1, 99], admission: [0, 99] };
const CODES = ['sum', 'order', 'too_big', 'bad_value'];
const SPLIT_CODES = ['sum', 'too_big', 'bad_value'];
const SCHEME_NAMES = Object.keys(RANGES);
const SPLIT_NAMES = Object.keys(SPLIT_RANGES);
const NAMES = [...SCHEME_NAMES, ...SPLIT_NAMES];

const blank = () => ({
  loaded: null,        // { scheme, defaults, split, splitDefaults } from scoring.get
  loadErrorKey: null,
  pending: false,
  values: null,        // field -> what is typed (string)
  errors: {},          // field -> { key, params }
  messageKey: null,    // an error about the whole card
  saved: false,
  busy: false,
});
let state = blank();
let example = null;    // the example line, updated in place
let exampleFinal = null;   // the line about the whole subject, updated in place

const canSave = () => permissions().includes('scoring.save');

export function leaveScoringCard() {
  state = blank();
  example = null;
  exampleFinal = null;
}

const strings = (scheme, split) => Object.fromEntries([
  ...SCHEME_NAMES.map((name) => [name, String(scheme[name])]),
  ...SPLIT_NAMES.map((name) => [name, String(split[name])]),
]);
const asNumber = (text) => (/^\d+$/.test(String(text).trim()) ? Number(String(text).trim()) : null);

// The card, or null when the person may not see the scheme (a teacher).
export function scoringCard() {
  if (!permissions().includes('scoring.get')) return null;
  if (state.loaded === null && state.loadErrorKey === null && !state.pending) load(state);
  const body = state.loaded === null ? loadingBody() : form();
  return el('section', { class: 'card panel scoring', 'aria-labelledby': 'scoring-title' },
    el('header', { class: 'panel__head' },
      el('span', { class: 'panel__icon' }, icon('chart')),
      el('div', { class: 'panel__text' },
        el('h2', { class: 'panel__title', id: 'scoring-title' }, t('scoring.title')),
        el('p', { class: 'panel__hint' }, t('scoring.hint')))),
    el('div', { class: 'panel__body' }, body));
}

async function load(owner) {
  owner.pending = true;
  try {
    const data = await call('scoring.get', {});
    if (state !== owner) return;
    owner.loaded = { scheme: { ...data.scheme }, defaults: { ...data.defaults }, split: { ...data.split }, splitDefaults: { ...data.splitDefaults } };
    owner.values = strings(data.scheme, data.split);
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
  return el('div', { class: 'scoring__failed' },
    note('error', t(state.loadErrorKey), { role: 'alert' }),
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.loadErrorKey = null; refresh(); } }, t('common.retry')));
}

function form() {
  const editable = canSave();
  example = el('p', { class: 'scoring__example', id: 'scoring-example', 'aria-live': 'polite' });
  exampleFinal = el('p', { class: 'scoring__example', id: 'scoring-example-final', 'aria-live': 'polite' });
  const groups = GROUPS.map(([group, names]) => el('fieldset', { class: 'scoring__group' },
    el('legend', { class: 'scoring__legend' }, t('scoring.group.' + group)),
    el('div', { class: 'scoring__fields' }, names.map((name) => numberField(name, editable)))));
  syncExample();
  return el('div', { class: 'scoring__form' },
    ...groups,
    example,
    exampleFinal,
    editable ? note('warning', t('scoring.warning'), { class: 'scoring__warning' }) : null,
    editable ? actions() : null);
}

function numberField(name, editable) {
  const error = state.errors[name];
  return field({
    id: 'scoring-' + name, label: t('scoring.field.' + name), type: 'number', value: state.values[name],
    error: error ? t(error.key, error.params) : null,
    onInput: (value) => { state.values[name] = value; state.saved = false; forget(name); syncExample(); },
    attrs: { readonly: !editable, required: true, inputmode: 'numeric', step: '1' },
  });
}

// The person is fixing a marked field: its mark and the message about the whole card go at once, in place.
function forget(name) {
  if (state.messageKey) {
    state.messageKey = null;
    document.getElementById('scoring-message')?.remove();
  }
  document.getElementById('scoring-saved')?.remove();
  if (!state.errors[name]) return;
  delete state.errors[name];
  unmarkField('scoring-' + name + '-error', document.getElementById('scoring-' + name));
}

// «За обычную пару до 30 баллов…» from the numbers in the fields; a dash for what is not a number.
function syncExample() {
  if (!example) return;
  const n = Object.fromEntries(NAMES.map((name) => [name, asNumber(state.values[name])]));
  const sum = (...names) => (names.every((name) => n[name] !== null) ? String(names.reduce((total, name) => total + n[name], 0)) : '—');
  const show = (name) => (n[name] === null ? '—' : String(n[name]));
  example.textContent = t('scoring.example', {
    pair: sum('attendance', 'activity'), first: show('attendance'),
    current: show('current'), self: show('self'), control: show('control'), total: sum('current', 'self', 'control'),
  });
  if (exampleFinal) {
    exampleFinal.textContent = t('scoring.example.final', {
      semester: show('semester'), exam: show('exam'), need: show('admission'),
      fair: show('fair'), good: show('good'), excellent: show('excellent'),
    });
  }
}

function actions() {
  const submit = el('button', { type: 'button', id: 'scoring-save', class: 'button button--primary', onclick: save }, t('common.save'));
  if (state.busy) markBusy(submit, 'common.saving');
  return el('div', { class: 'scoring__actions' },
    el('div', { class: 'notes', role: 'status' },
      state.saved ? note('success', t('scoring.saved'), { id: 'scoring-saved' }) : null,
      state.messageKey ? note('error', t(state.messageKey), { role: 'alert', id: 'scoring-message' }) : null),
    el('div', { class: 'scoring__buttons' },
      el('button', { type: 'button', id: 'scoring-reset', class: 'button button--secondary', onclick: reset }, t('scoring.reset')),
      submit));
}

// The defaults go into the fields; nothing is saved.
function reset() {
  state.values = strings(state.loaded.defaults, state.loaded.splitDefaults);
  state.errors = {};
  state.messageKey = null;
  state.saved = false;
  refresh();
}

async function save() {
  if (state.busy || !canSave()) return;
  const owner = state;
  owner.errors = {};
  owner.messageKey = null;
  owner.saved = false;
  const typed = (names) => Object.fromEntries(names.map((name) => [name, asNumber(owner.values[name]) ?? owner.values[name]]));
  const scheme = typed(SCHEME_NAMES);
  const split = typed(SPLIT_NAMES);
  owner.busy = true;
  refresh();
  try {
    const data = await call('scoring.save', { scheme, split });
    if (state !== owner) return;
    owner.loaded.scheme = { ...data.scheme };
    owner.loaded.split = { ...data.split };
    owner.values = strings(data.scheme, data.split);
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
  else document.getElementById('scoring-save')?.focus();
}

// Field errors go to their fields; anything else is one line above the buttons. What was typed stays.
function showSaveError(owner, error) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  const shown = fields.filter(({ field: name }) => NAMES.includes(name));
  for (const { field: name, code } of shown) {
    const split = SPLIT_NAMES.includes(name);
    const known = (split ? SPLIT_CODES : CODES).includes(code) ? code : 'bad_value';
    const [min, max] = split ? SPLIT_RANGES[name] : RANGES[name];
    owner.errors[name] = { key: 'scoring.error.' + (split && known !== 'bad_value' ? 'split.' : '') + known, params: { min, max } };
  }
  if (shown.length === 0) owner.messageKey = errorKey(error.code);
}

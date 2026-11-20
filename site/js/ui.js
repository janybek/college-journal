import { t } from './i18n.js';
import { icon } from './icons.js';

// Small DOM helpers shared by the screens.

let redraw = () => {};
let sessionStart = () => {};
let leaveCheck = null;

// main.js registers the function that draws the current screen; screens call refresh() after their state changes.
export function onRefresh(fn) {
  redraw = fn;
}

export function refresh() {
  redraw();
}

// main.js registers what happens with a new session; screens call startSession({ token, user }) after
// a successful sign-in or password change.
export function onSessionStart(fn) {
  sessionStart = fn;
}

export function startSession(data) {
  sessionStart(data);
}

// A screen that shows something it cannot show again (one-time passwords) asks before it is left.
// check() resolves to true when the person agrees to leave; null releases the hold.
export function holdOnLeave(check) {
  leaveCheck = check;
}

export function isLeaveHeld() {
  return leaveCheck !== null;
}

// Resolves to true when the current screen may be left: nothing is held, or the person agreed.
export async function mayLeave() {
  return leaveCheck === null ? true : leaveCheck();
}

// Builds an element. String children become text nodes: server data never goes in as HTML.
// Children may be nested arrays; null, undefined and false are skipped.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== undefined && child !== null && child !== false) node.append(child);
  }
  return node;
}

// True when the dictionary has a text for this key (t() returns the key itself otherwise).
export function hasText(key) {
  return t(key) !== key;
}

// Dictionary key for a server error code; codes without their own text show the general one.
export function errorKey(code) {
  const key = 'error.' + code;
  return hasText(key) ? key : 'error.internal';
}

// Dictionary key for an error at one field: the most specific text that exists —
// for this screen (`context`), for this directory's field, for the field, and finally for the code alone.
export function fieldErrorKey(table, fieldName, code, context = null) {
  const keys = [
    context ? `${context}.error.${fieldName}.${code}` : null,
    `error.${table}.${fieldName}.${code}`,
    `error.${fieldName}.${code}`,
  ];
  return keys.find((key) => key !== null && hasText(key)) ?? errorKey(code);
}

const describedBy = (...ids) => ids.filter(Boolean).join(' ') || null;

// The line under a field that says what is wrong with it.
const fieldError = (id, error) => el('p', { class: 'field__error', id }, icon('alert'), t(error));

// Label, optional hint and error line around a control. hideLabel: the label is read out but not shown
// (a control whose purpose is plain from its surroundings, e.g. the group filter above a table).
function fieldShell({ id, label, hint, hintId, error, errorId, hideLabel = false }, control) {
  return el('div', { class: 'field' },
    el('label', { class: hideLabel ? 'visually-hidden' : 'field__label', for: id }, label),
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    control,
    error ? fieldError(errorId, error) : null);
}

// A labelled input with an optional hint, an error line and a show/hide button for passwords.
export function field({ id, label, value = '', type = 'text', hint = null, error = null, reveal = false, onInput, attrs = {} }) {
  const hintId = hint ? id + '-hint' : null;
  const errorId = error ? id + '-error' : null;
  const input = el('input', {
    id, name: id, type, value,
    class: 'field__input' + (reveal ? ' field__input--reveal' : ''),
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': describedBy(hintId, errorId),
    oninput: () => onInput(input.value),
    ...attrs,
  });
  const control = el('div', { class: 'field__control' }, input);
  if (reveal) {
    const toggle = el('button', {
      type: 'button', class: 'field__reveal', 'aria-controls': id, 'aria-pressed': 'false',
      onclick: () => {
        const shown = input.type === 'password';
        input.type = shown ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(shown));
        toggle.textContent = t(shown ? 'common.hide' : 'common.show');
      },
    }, t('common.show'));
    control.append(toggle);
  }
  return fieldShell({ id, label, hint, hintId, error, errorId }, control);
}

// A labelled drop-down. options: [{ value, label }]; placeholder adds an empty first choice.
export function selectField({ id, label, value = '', options, placeholder = null, hint = null, error = null, hideLabel = false, onChange }) {
  const hintId = hint ? id + '-hint' : null;
  const errorId = error ? id + '-error' : null;
  const select = el('select', {
    id, name: id, class: 'field__input field__select',
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': describedBy(hintId, errorId),
    onchange: () => onChange(select.value),
  },
  placeholder !== null ? el('option', { value: '' }, placeholder) : null,
  options.map((option) => el('option', { value: option.value }, option.label)));
  select.value = value;
  return fieldShell({ id, label, hint, hintId, error, errorId, hideLabel }, select);
}

// A search box with a magnifier; the label is read out, and shown as the placeholder.
export function searchField({ id, label, value = '', onInput }) {
  const input = el('input', {
    id, name: id, type: 'search', value, placeholder: label, class: 'field__input search__input',
    autocomplete: 'off', spellcheck: 'false', oninput: () => onInput(input.value),
  });
  return el('div', { class: 'search' }, el('label', { class: 'visually-hidden', for: id }, label), icon('search', 'search__icon'), input);
}

// An on/off switch (a checkbox announced as a switch) with an optional hint and error line.
export function switchField({ id, label, checked, hint = null, error = null, onChange }) {
  const hintId = hint ? id + '-hint' : null;
  const errorId = error ? id + '-error' : null;
  const input = el('input', {
    id, name: id, type: 'checkbox', role: 'switch', class: 'check__input check__input--switch', checked,
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': describedBy(hintId, errorId),
    onchange: () => onChange(input.checked),
  });
  return el('div', { class: 'field' },
    el('div', { class: 'check' }, input, el('label', { class: 'check__label', for: id }, label)),
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    error ? fieldError(errorId, error) : null);
}

// A group of checkboxes under one caption. onChange receives the values that are ticked, in option order.
export function checkGroup({ id, legend, options, values, error = null, onChange }) {
  const errorId = error ? id + '-error' : null;
  const inputs = options.map((option) => el('input', {
    id: id + '-' + option.value, name: id, type: 'checkbox', value: option.value, class: 'check__input',
    checked: values.includes(option.value),
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': errorId,
    onchange: () => onChange(inputs.filter((input) => input.checked).map((input) => input.value)),
  }));
  return el('fieldset', { class: 'field fieldset' },
    el('legend', { class: 'field__label' }, legend),
    el('div', { class: 'checks' }, inputs.map((input, i) => el('div', { class: 'check' },
      input, el('label', { class: 'check__label', for: input.id }, options[i].label)))),
    error ? fieldError(errorId, error) : null);
}

// A table in its own scrolling frame. columns: [{ label, className }]; rows: arrays of cells (text or elements).
export function dataTable({ caption = null, columns, rows, className = '' }) {
  return el('div', { class: ('table-scroll ' + className).trim() },
    el('table', { class: 'table' },
      caption ? el('caption', { class: 'table__caption' }, caption) : null,
      el('thead', {}, el('tr', {}, columns.map((column) => el('th', { scope: 'col', class: column.className }, column.label)))),
      el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((cell, i) => el('td', { class: columns[i].className }, cell)))))));
}

// The heading of a screen: title, an optional line under it, and buttons on the right.
export function pageHeader({ id, title, lead = null, actions = null }) {
  return el('header', { class: 'page-head' },
    el('div', { class: 'page-head__text' },
      el('h1', { class: 'page-title', id }, title),
      lead ? el('p', { class: 'page-lead' }, lead) : null),
    actions ? el('div', { class: 'page-head__actions' }, actions) : null);
}

const NOTE_ICONS = { error: 'alert', warning: 'alert', success: 'checkCircle', info: 'info' };

// A message about the whole screen or form. kind: error | warning | success | info.
export function note(kind, text, attrs = {}) {
  const { class: extra = '', ...rest } = attrs;
  return el('p', { class: `note note--${kind} ${extra}`.trim(), ...rest },
    icon(NOTE_ICONS[kind], 'note__icon'), el('span', {}, text));
}

// A small rounded label. tone: neutral | primary | success | warning; dot adds a coloured dot.
export function badge(text, tone = 'neutral', dot = false) {
  return el('span', { class: `badge badge--${tone}` }, dot ? el('span', { class: 'badge__dot', 'aria-hidden': 'true' }) : null, text);
}

// A button that shows only an icon; the label is read out and appears as a tooltip.
export function iconButton({ id = null, iconName, label, onClick, className = '', attrs = {} }) {
  return el('button', { type: 'button', id, class: ('icon-button ' + className).trim(), title: label, onclick: onClick, ...attrs },
    icon(iconName), el('span', { class: 'visually-hidden' }, label));
}

// Nothing to show yet: an icon and what to do about it.
export function emptyState(iconName, ...children) {
  return el('div', { class: 'empty' },
    el('span', { class: 'empty__icon' }, icon(iconName)),
    el('div', { class: 'empty__body' }, ...children));
}

// Initials avatars

export const AVATAR_TONES = 6;

// First letters of the first two words of a name ('Асанов Айдар' -> 'АА'); '?' when there is no name.
export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => Array.from(word)[0].toLocaleUpperCase()).join('');
}

// A colour for a name, 0 … AVATAR_TONES - 1: the same name always gets the same one.
export function avatarTone(name) {
  const key = String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % AVATAR_TONES;
}

// A round badge with the initials; the name itself is always written next to it.
export function avatar(name, size = '') {
  return el('span', { class: ('avatar ' + (size ? 'avatar--' + size : '')).trim(), 'data-tone': avatarTone(name), 'aria-hidden': 'true' }, initials(name));
}

// A native modal <dialog> drawn as part of a screen. Screens are redrawn from their state, so a redraw simply
// drops the old element and opens a new one; onClose runs only when the person closes the shown dialog
// (Escape or a button calling dialog.close()). canCancel() returning false keeps it open on Escape.
export function modal({ id, labelledBy, className = '', onClose, canCancel = () => true }, ...children) {
  const dialog = el('dialog', { id, class: ('dialog ' + className).trim(), 'aria-labelledby': labelledBy },
    el('div', { class: 'dialog__body' }, ...children));
  dialog.addEventListener('cancel', (event) => { if (!canCancel()) event.preventDefault(); });
  dialog.addEventListener('close', () => { if (dialog.isConnected) onClose(); });
  return dialog;
}

// Adds a dialog built by modal() to the screen and opens it.
export function showModal(root, dialog) {
  root.append(dialog);
  dialog.showModal();
}

// Moves focus to the first of these elements that exists (after a dialog closes, the screen was redrawn).
export function focusById(...ids) {
  for (const id of ids) {
    const target = id ? document.getElementById(id) : null;
    if (target) {
      target.focus();
      return;
    }
  }
}

// Moves focus to the first field marked with a mistake, so keyboard and screen reader users land on it.
export function focusFirstInvalid() {
  const target = document.querySelector('[aria-invalid="true"]');
  if (target) target.focus();
}

// Takes the mistake mark off in place, without a redraw (a redraw would throw the caret out of a date or time
// field): the error line `errorId` goes, and each of `inputs` (elements; null is skipped) loses aria-invalid and
// its reference to that line.
export function unmarkField(errorId, ...inputs) {
  document.getElementById(errorId)?.remove();
  for (const input of inputs) {
    if (!input) continue;
    input.removeAttribute('aria-invalid');
    const rest = (input.getAttribute('aria-describedby') ?? '').split(' ').filter((ref) => ref && ref !== errorId);
    if (rest.length > 0) input.setAttribute('aria-describedby', rest.join(' '));
    else input.removeAttribute('aria-describedby');
  }
}

// Shows that a request is running. The button stays focusable; the screen ignores repeated submits itself.
export function markBusy(button, busyKey) {
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-busy', 'true');
  button.classList.add('is-busy');
  button.textContent = t(busyKey);
}

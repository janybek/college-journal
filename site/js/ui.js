import { t } from './i18n.js';

// Small DOM helpers shared by the screens.

let redraw = () => {};

// main.js registers the function that draws the current screen; screens call refresh() after their state changes.
export function onRefresh(fn) {
  redraw = fn;
}

export function refresh() {
  redraw();
}

// Builds an element. String children become text nodes: server data never goes in as HTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') node.className = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child !== undefined && child !== null && child !== false) node.append(child);
  }
  return node;
}

// Dictionary key for a server error code; codes without their own text show the general one.
export function errorKey(code) {
  const key = 'error.' + code;
  return t(key) === key ? 'error.internal' : key;
}

// A labelled input with an optional hint, an error line and a show/hide button for passwords.
export function field({ id, label, value = '', type = 'text', hint = null, error = null, reveal = false, onInput, attrs = {} }) {
  const hintId = hint ? id + '-hint' : null;
  const errorId = error ? id + '-error' : null;
  const input = el('input', {
    id, name: id, type, value,
    class: 'field__input' + (reveal ? ' field__input--reveal' : ''),
    'aria-invalid': error ? 'true' : null,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || null,
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
  return el('div', { class: 'field' },
    el('label', { class: 'field__label', for: id }, label),
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    control,
    error ? el('p', { class: 'field__error', id: errorId }, t(error)) : null);
}

// Moves focus to the first field marked with a mistake, so keyboard and screen reader users land on it.
export function focusFirstInvalid() {
  const target = document.querySelector('[aria-invalid="true"]');
  if (target) target.focus();
}

// Shows that a request is running. The button stays focusable; the screen ignores repeated submits itself.
export function markBusy(button, busyKey) {
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-busy', 'true');
  button.classList.add('is-busy');
  button.textContent = t(busyKey);
}

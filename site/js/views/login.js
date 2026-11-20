import { API_URL } from '../../config.js';
import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, field, focusFirstInvalid, markBusy, note, refresh, startSession } from '../ui.js';

// The screen is drawn from this state, so typed text and messages survive a redraw (e.g. a language switch).
// It is dropped after a successful sign-in.
const blank = () => ({ login: '', password: '', fieldErrors: {}, messageKey: null, busy: false });
let state = blank();

// The server ended the session (expired or revoked token): the sign-in screen says why.
// A normal sign-out does not call this.
export function noteSessionEnded() {
  state = blank();
  state.messageKey = 'error.unauthorized';
}

export function render(root) {
  const button = el('button', { type: 'submit', id: 'login-submit', class: 'button button--primary button--wide' }, t('login.submit'));
  if (state.busy) markBusy(button, 'login.busy');

  const form = el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); signIn(); } },
    field({
      id: 'login-name', label: t('login.login'), value: state.login, error: state.fieldErrors.login,
      onInput: (value) => { state.login = value; },
      attrs: { autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' },
    }),
    field({
      id: 'login-password', type: 'password', label: t('login.password'), value: state.password,
      error: state.fieldErrors.password, reveal: true,
      onInput: (value) => { state.password = value; },
      attrs: { autocomplete: 'current-password' },
    }),
    button,
    state.messageKey ? note('error', t(state.messageKey), { role: 'alert' }) : null);

  root.append(el('section', { class: 'card auth-card', 'aria-labelledby': 'login-title' },
    el('h1', { class: 'auth-card__title', id: 'login-title' }, t('login.title')),
    API_URL === '' ? note('warning', t('error.not_configured'), { role: 'status' }) : null,
    form,
    el('p', { class: 'auth-card__foot' }, t('login.help'))));
}

async function signIn() {
  if (state.busy) return;
  state.messageKey = null;
  state.fieldErrors = {
    login: state.login.trim() === '' ? 'error.required' : null,
    password: state.password === '' ? 'error.required' : null,
  };
  if (state.fieldErrors.login || state.fieldErrors.password) {
    refresh();
    focusFirstInvalid();
    return;
  }

  state.busy = true;
  refresh();
  try {
    const data = await call('auth.login', { login: state.login.trim(), password: state.password });
    state = blank();
    startSession(data);
  } catch (error) {
    state.busy = false;
    state.messageKey = errorKey(error.code);
    if (error.code === 'bad_credentials') state.password = '';
    refresh();
  }
}

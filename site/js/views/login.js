import { API_URL } from '../../config.js';
import { call } from '../api.js';
import { setSession } from '../session.js';
import { t, getLang, setLang } from '../i18n.js';
import { el, errorKey, field, focusFirstInvalid, markBusy, refresh } from '../ui.js';

// The screen is drawn from this state, so typed text and messages survive a redraw (e.g. a language switch).
// It is dropped after a successful sign-in.
const blank = () => ({ login: '', password: '', fieldErrors: {}, messageKey: null, busy: false });
let state = blank();

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
    state.messageKey ? el('p', { class: 'message', role: 'alert' }, t(state.messageKey)) : null);

  root.append(el('section', { class: 'sheet sheet--label', 'aria-labelledby': 'login-title' },
    el('h1', { class: 'sheet__title', id: 'login-title' }, t('login.title')),
    API_URL === '' ? el('p', { class: 'message message--top', role: 'status' }, t('error.not_configured')) : null,
    form,
    el('p', { class: 'sheet__note' }, t('login.help'))));
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
    setSession(data);
    // The account's language wins after sign-in. Either branch redraws, and the router now leads past this screen.
    if (data.user.lang !== getLang()) setLang(data.user.lang);
    else refresh();
  } catch (error) {
    state.busy = false;
    state.messageKey = errorKey(error.code);
    if (error.code === 'bad_credentials') state.password = '';
    refresh();
  }
}

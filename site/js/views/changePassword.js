import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, field, focusFirstInvalid, markBusy, refresh, startSession } from '../ui.js';

// Drawn from `state`, like the sign-in screen: typed text survives a redraw and is dropped after success.
// Server field name -> field of this form.
const SERVER_FIELDS = { oldPassword: 'old', newPassword: 'new' };
const blank = () => ({ old: '', new: '', repeat: '', fieldErrors: {}, messageKey: null, busy: false });
let state = blank();

export function render(root) {
  const button = el('button', { type: 'submit', id: 'password-submit', class: 'button button--primary button--wide' }, t('password.submit'));
  if (state.busy) markBusy(button, 'password.busy');
  const input = (name, label, autocomplete, extra = {}) => field({
    id: 'password-' + name, type: 'password', label, value: state[name], error: state.fieldErrors[name], reveal: true,
    onInput: (value) => { state[name] = value; },
    attrs: { autocomplete },
    ...extra,
  });

  root.append(el('section', { class: 'sheet sheet--label', 'aria-labelledby': 'password-title' },
    el('h1', { class: 'sheet__title', id: 'password-title' }, t('password.title')),
    el('p', { class: 'sheet__lead' }, t('password.intro')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); save(); } },
      input('old', t('password.old'), 'current-password'),
      input('new', t('password.new'), 'new-password', { hint: t('password.newHint') }),
      input('repeat', t('password.repeat'), 'new-password'),
      button,
      state.messageKey ? el('p', { class: 'message', role: 'alert' }, t(state.messageKey)) : null)));
}

function check() {
  const errors = {};
  for (const name of ['old', 'new', 'repeat']) if (state[name] === '') errors[name] = 'error.required';
  if (!errors.new && !errors.repeat && state.new !== state.repeat) errors.repeat = 'error.mismatch';
  return errors;
}

async function save() {
  if (state.busy) return;
  state.messageKey = null;
  state.fieldErrors = check();
  if (Object.keys(state.fieldErrors).length > 0) {
    refresh();
    focusFirstInvalid();
    return;
  }

  state.busy = true;
  refresh();
  try {
    const data = await call('auth.changePassword', { oldPassword: state.old, newPassword: state.new });
    state = blank();
    startSession(data);
  } catch (error) {
    state.busy = false;
    if (error.code === 'bad_credentials') {
      state.fieldErrors = { old: 'password.oldWrong' };
      state.old = '';
    } else if (error.code === 'invalid' && Array.isArray(error.fields)) {
      for (const { field: name, code } of error.fields) {
        if (Object.prototype.hasOwnProperty.call(SERVER_FIELDS, name)) state.fieldErrors[SERVER_FIELDS[name]] = errorKey(code);
      }
      if (Object.keys(state.fieldErrors).length === 0) state.messageKey = errorKey(error.code);
    } else {
      state.messageKey = errorKey(error.code);
    }
    refresh();
    focusFirstInvalid();
  }
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, focusById, focusFirstInvalid, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import { announceProblems, TITLE_MAX, TEXT_MAX, PER_DAY } from '../announce.js';

// The window «Новое объявление»: to whom (the choices the server gave in `can.audiences`; a teacher can write only to a group of his),
// the group, the title, the text and the last day. Everything typed goes to the server as text and comes back as text.

const DIALOG_ID = 'announce-dialog';

export function closeAnnounceForm() {
  document.getElementById(DIALOG_ID)?.remove();
}

// A labelled control whose error line is shown and cleared in place (no redraw: the caret stays).
function fieldBox({ id, label, hint = null, control, input = control, counter = null }) {
  const error = el('p', { class: 'field__error', id: id + '-error', hidden: true });
  const hintId = hint ? id + '-hint' : null;
  const root = el('div', { class: 'field' },
    el('label', { class: 'field__label', for: id }, label),
    el('div', { class: 'field__control' }, control),
    counter || hint ? el('p', { class: 'field__hint an-hint', id: hintId }, hint ? el('span', {}, hint) : null, counter) : null,
    error);
  if (hintId) input.setAttribute('aria-describedby', hintId);
  const set = (text) => {
    if (text === null) {
      error.hidden = true;
      error.replaceChildren();
      input.removeAttribute('aria-invalid');
      if (hintId) input.setAttribute('aria-describedby', hintId); else input.removeAttribute('aria-describedby');
      return;
    }
    error.replaceChildren(icon('alert'), text);
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', [hintId, error.id].filter(Boolean).join(' '));
  };
  return { root, set };
}

function counterOf(input, max) {
  const out = el('span', { class: 'an-count', id: input.id + '-count' });
  const draw = () => { out.textContent = t('announce.form.count', { n: input.value.length, max }); };
  input.addEventListener('input', draw);
  draw();
  return out;
}

// data: the answer of announce.list (`can`, `today`); onSaved() runs after the announcement is written; returnId: where the focus goes back.
export function openAnnounceForm({ can, today, onSaved, returnId }) {
  closeAnnounceForm();
  let busy = false;
  let audience = can.audiences[0];

  const audienceBox = el('div', { class: 'field' });
  const groupSelect = el('select', { class: 'field__input field__select', id: 'announce-group', name: 'groupId' },
    el('option', { value: '' }, t('announce.form.groupPlaceholder')),
    can.groups.map((g) => el('option', { value: g.id }, g.name)));
  if (can.groups.length === 1) groupSelect.value = can.groups[0].id;
  const groupBox = fieldBox({ id: 'announce-group', label: t('announce.form.group'), control: groupSelect });
  const title = el('input', { type: 'text', class: 'field__input', id: 'announce-title', name: 'title', maxlength: String(TITLE_MAX), autocomplete: 'off' });
  const titleBox = fieldBox({ id: 'announce-title', label: t('announce.form.subject'), control: title, counter: counterOf(title, TITLE_MAX) });
  const text = el('textarea', { class: 'field__input field__textarea an-textarea', id: 'announce-text', name: 'text', maxlength: String(TEXT_MAX), rows: '6' });
  const textBox = fieldBox({ id: 'announce-text', label: t('announce.form.text'), control: text, counter: counterOf(text, TEXT_MAX) });
  const until = el('input', { type: 'date', class: 'field__input', id: 'announce-until', name: 'expiresOn', min: today || null });
  const untilBox = fieldBox({ id: 'announce-until', label: t('announce.form.until'), hint: t('announce.form.untilHint'), control: until });
  const boxes = { groupId: groupBox, title: titleBox, text: textBox, expiresOn: untilBox };
  for (const [box, input] of [[groupBox, groupSelect], [titleBox, title], [textBox, text], [untilBox, until]]) {
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => box.set(null));
  }

  // «Кому»: a switch of the audiences when there is a choice; a teacher has one — a plain line.
  const drawAudience = () => {
    const label = el('span', { class: 'field__label', id: 'announce-to-label' }, t('announce.form.to'));
    if (can.audiences.length === 1) {
      audienceBox.replaceChildren(label, el('p', { class: 'an-fixed', id: 'announce-to' }, t('announce.form.to.' + audience)));
    } else {
      audienceBox.replaceChildren(label, el('div', { class: 'segmented segmented--wrap an-audience', role: 'group', 'aria-labelledby': 'announce-to-label' },
        can.audiences.map((value) => el('button', {
          type: 'button', class: 'segmented__button', id: 'announce-to-' + value, 'aria-pressed': String(value === audience),
          onclick: () => { audience = value; drawAudience(); },
        }, t('announce.form.to.' + value)))));
    }
    groupBox.root.hidden = audience !== 'group';
  };
  drawAudience();

  const problem = el('div', { class: 'mk-problem' });
  const submit = el('button', { type: 'button', class: 'button button--primary', id: 'announce-send' }, t('announce.form.send'));
  const onHash = () => dialog.close();
  const dialog = modal({
    id: DIALOG_ID, labelledBy: 'announce-dialog-title', className: 'dialog--announce',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); focusById(returnId); },
  },
  el('h2', { class: 'dialog__title', id: 'announce-dialog-title' }, t('announce.form.title')),
  audienceBox, groupBox.root, titleBox.root, textBox.root, untilBox.root, problem,
  el('div', { class: 'dialog__actions' },
    el('button', { type: 'button', class: 'button button--secondary', id: 'announce-cancel', onclick: () => dialog.close() }, t('common.cancel')),
    submit));
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();

  if (audience === 'group' && can.groups.length === 0) problem.replaceChildren(note('error', t('announce.form.noGroups'), { role: 'alert' }));

  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    for (const box of Object.values(boxes)) box.set(null);
    markBusy(submit, 'announce.form.busy');
    try {
      await call('announce.save', { audience, groupId: audience === 'group' ? groupSelect.value : '', title: title.value, text: text.value, expiresOn: until.value });
      dialog.close();
      onSaved();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      submit.removeAttribute('aria-busy');
      submit.removeAttribute('aria-disabled');
      submit.classList.remove('is-busy');
      submit.textContent = t('announce.form.send');
      const fields = error.code === 'invalid' && Array.isArray(error.fields) ? announceProblems(error.fields) : new Map();
      let loose = null;
      if (error.code === 'too_many') loose = t('announce.error.too_many', { n: PER_DAY });
      else if (error.code !== 'invalid') loose = t(errorKey(error.code));
      for (const [field, key] of fields) {
        if (boxes[field]) boxes[field].set(t(key));
        else loose = loose || t(key);
      }
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  focusById(audience === 'group' && can.groups.length > 1 ? 'announce-group' : 'announce-title');
}

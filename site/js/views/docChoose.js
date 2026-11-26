import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, focusById, markBusy, modal, note, showModal } from '../ui.js';
import { candidateParts, chooseError } from '../documents.js';

// The window «Выберите силлабус» (syllabus.choose): a discipline whose teachers each have a syllabus of their own waits for
// the deanery to pick one for every half of the year that is in doubt. One list of candidates per half, one is picked.
// An unapproved pick says what it costs first (needs_confirm) and asks again with «Всё равно выбрать». Used by the card
// of a discipline, the list of the syllabi and the card of the directory. The candidates come from docs.discipline.

let current = null;

// `card`: the answer of docs.discipline when the screen has it already; the others load it. `onChosen` redraws the screen.
export async function openChooseDialog(disciplineId, { onChosen, card = null, returnTo = null }) {
  let data = card;
  if (data === null || !data.candidates) {
    try { data = await call('docs.discipline', { disciplineId }); } catch (error) { return showFailure(error.code, returnTo); }
  }
  const halves = (data.waiting || []).filter((half) => Array.isArray(data.candidates[half]) && data.candidates[half].length > 0);
  if (halves.length === 0) return;
  const form = { half: halves[0], picks: {}, confirm: false, warning: null, errorKey: null, errorParams: null, busy: false };
  const draw = () => {
    if (current) current.remove();
    current = build(disciplineId, data, halves, form, draw, onChosen, returnTo);
    showModal(document.getElementById('app'), current);
  };
  draw();
}

function showFailure(code, returnTo) {
  if (current) current.remove();
  const dialog = modal({ id: 'docs-choose-dialog', labelledBy: 'docs-choose-title', onClose: () => { current = null; focusById(returnTo); } },
    el('h2', { class: 'dialog__title', id: 'docs-choose-title' }, t('docs.choose')),
    note('error', t(errorKey(code)), { role: 'alert' }),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', autofocus: true, onclick: () => dialog.close() }, t('common.close'))));
  current = dialog;
  showModal(document.getElementById('app'), dialog);
}

function candidate(row, form, draw) {
  const parts = candidateParts(row);
  const input = el('input', { type: 'radio', name: 'docs-choose-' + form.half, value: row.lineId, class: 'choose-option__input' });
  input.checked = form.picks[form.half] === row.lineId;
  input.addEventListener('change', () => { form.picks[form.half] = row.lineId; form.confirm = false; form.warning = null; form.errorKey = null; draw(); });
  return el('label', { class: 'choose-option' + (input.checked ? ' is-picked' : '') },
    input,
    el('span', { class: 'choose-option__text' },
      el('span', { class: 'choose-option__head' }, parts.head),
      parts.meta ? el('span', { class: 'choose-option__meta' }, parts.meta) : null));
}

function build(disciplineId, data, halves, form, draw, onChosen, returnTo) {
  let dialog;
  const switcher = halves.length > 1
    ? el('div', { class: 'segmented choose-halves', role: 'group', 'aria-label': t('docs.choose') }, halves.map((half) => el('button', {
      type: 'button', class: 'segmented__button', 'aria-pressed': String(half === form.half),
      onclick: () => { if (!form.busy && half !== form.half) { form.half = half; form.confirm = false; form.warning = null; form.errorKey = null; draw(); } },
    }, t('docs.half.' + half))))
    : null;
  const picked = form.picks[form.half];
  const submit = el('button', { type: 'submit', id: 'docs-choose-save', class: 'button button--primary', 'aria-disabled': picked ? null : 'true' },
    t(form.confirm ? 'docs.choose.anyway' : 'docs.choose.pick'));
  if (form.busy) markBusy(submit, 'common.saving');
  const onClose = () => { current = null; focusById(returnTo, 'docs-choose'); };
  dialog = modal({ id: 'docs-choose-dialog', className: 'dialog--choose', labelledBy: 'docs-choose-title', onClose, canCancel: () => !form.busy },
    el('h2', { class: 'dialog__title', id: 'docs-choose-title' }, halves.length === 1 ? t('docs.choose') + ' · ' + t('docs.half.' + form.half) : t('docs.choose')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); send(disciplineId, form, draw, onChosen); } },
      switcher,
      el('div', { class: 'choose-list', role: 'radiogroup', 'aria-label': t('docs.half.' + form.half) },
        data.candidates[form.half].map((row) => candidate(row, form, draw))),
      form.warning ? note('warning', t(form.warning.key, form.warning.params), { role: 'alert' }) : null,
      form.errorKey ? note('error', t(form.errorKey, form.errorParams ?? {}), { role: 'alert' }) : null,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!form.busy) dialog.close(); } }, t('common.cancel')),
        submit)));
  return dialog;
}

async function send(disciplineId, form, draw, onChosen) {
  const lineId = form.picks[form.half];
  if (form.busy) return;
  if (!lineId) {
    form.errorKey = 'docs.choose.none';
    form.errorParams = null;
    return draw();
  }
  form.busy = true;
  form.errorKey = null;
  form.warning = null;
  draw();
  try {
    await call('syllabus.choose', { disciplineId, semester: form.half, lineId, ...(form.confirm ? { confirm: true } : {}) });
  } catch (error) {
    form.busy = false;
    const shown = chooseError(error);
    if (shown.confirm) {
      form.confirm = true;
      form.warning = shown;
    } else {
      form.errorKey = hasText(shown.key) ? shown.key : errorKey(error.code);
      form.errorParams = shown.params;
    }
    return draw();
  }
  current.close();
  onChosen();
}

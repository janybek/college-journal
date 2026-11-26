import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, field, focusById, markBusy, modal, note, showModal } from '../ui.js';
import { shortFio } from '../documents.js';

// The window «Назначить ответственного» (syllabus.assign): one list «Ведут» / «Остальные» / «не назначен», under it the
// date of development. Used by the list of syllabi and the card of a discipline. The staff come from docs.discipline.

let current = null;

// `card`: the answer of docs.discipline when the screen has it already; the list loads it (it carries the staff).
export async function openAssignDialog(disciplineId, { onSaved, card = null }) {
  let data = card;
  if (data === null) {
    try { data = await call('docs.discipline', { disciplineId }); } catch (error) { return; }
  }
  if (!Array.isArray(data.staff)) return;
  const form = { teacherId: data.line ? data.line.responsibleId : '', dueDate: data.line ? data.line.dueDate : '', busy: false, errorKey: null };
  const draw = () => {
    if (current) current.remove();
    current = build(disciplineId, data, form, draw, onSaved);
    showModal(document.getElementById('app'), current);
  };
  draw();
}

function build(disciplineId, data, form, draw, onSaved) {
  let dialog;
  const option = (person) => el('option', { value: person.id }, shortFio(person.fullName));
  const leading = data.staff.filter((p) => p.teaches);
  const others = data.staff.filter((p) => !p.teaches);
  const select = el('select', { id: 'docs-assign-teacher', class: 'field__input field__select', onchange: () => { form.teacherId = select.value; } },
    leading.length > 0 ? el('optgroup', { label: t('docs.teachers') }, leading.map(option)) : null,
    others.length > 0 ? el('optgroup', { label: t('docs.assign.others') }, others.map(option)) : null,
    el('option', { value: '' }, t('docs.responsible.none')));
  select.value = form.teacherId;
  const save = el('button', { type: 'submit', id: 'docs-assign-save', class: 'button button--primary' }, t('common.save'));
  if (form.busy) markBusy(save, 'common.saving');
  const onClose = () => { current = null; focusById('docs-assign-' + disciplineId, 'docs-assign'); };
  dialog = modal({ id: 'docs-assign-dialog', labelledBy: 'docs-assign-title', onClose, canCancel: () => !form.busy },
    el('h2', { class: 'dialog__title', id: 'docs-assign-title' }, t('docs.assign')),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); submit(disciplineId, form, draw, onSaved); } },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'docs-assign-teacher' }, t('docs.assign.teacher')),
        select),
      field({ id: 'docs-assign-date', label: t('docs.due'), type: 'date', value: form.dueDate, onInput: (v) => { form.dueDate = v; } }),
      form.errorKey ? note('error', t(form.errorKey), { role: 'alert' }) : null,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!form.busy) dialog.close(); } }, t('common.cancel')),
        save)));
  return dialog;
}

async function submit(disciplineId, form, draw, onSaved) {
  if (form.busy) return;
  form.busy = true;
  form.errorKey = null;
  draw();
  try {
    await call('syllabus.assign', { disciplineId, teacherId: form.teacherId, dueDate: form.dueDate });
  } catch (error) {
    form.busy = false;
    form.errorKey = errorKey(error.code);
    draw();
    return;
  }
  current.close();
  onSaved();
}

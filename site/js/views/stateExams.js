import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, badge, emptyState, focusById, focusFirstInvalid, markBusy, modal, note, pageHeader, selectField, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';

// «Гос. экзамены» (#/state-exams, stateExam.list): the state exams of the groups, newest first. The deanery adds, changes and
// deletes them in a window; every other role only reads. An exam with scores cannot be deleted (the server refuses too).
// Names of exams and groups are only ever text.

const NAME_MAX = 200;

const blank = () => ({
  data: null,          // the answer of stateExam.list; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  groupId: '',         // the group chosen above the table; '' — every group
  disciplines: null,   // the names of the disciplines for the hint of the name; null until asked (only for those who may list them)
});
let state = blank();

export function leave() {
  document.getElementById('state-exam-dialog')?.remove();
  document.getElementById('state-exam-remove-dialog')?.remove();
  state = blank();
}

const dayFull = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const manage = state.data !== null && state.data.can.manage === true;
  root.append(
    pageHeader({
      id: 'state-exams-title', title: t('stateExam.title'), lead: state.data === null ? null : t(manage ? 'stateExam.leadManage' : 'stateExam.leadRead'),
      actions: manage ? el('button', { type: 'button', class: 'button button--primary', id: 'state-exam-new', onclick: () => openDialog(null) }, icon('plus'), t('stateExam.new')) : null,
    }),
    state.data === null ? loadingBody() : body());
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('stateExam.list', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.loadErrorKey = null;
  load();
  refresh();
}

function loadingBody() {
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('stateExam.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

// Those groups that have an exam, for the filter above the table.
const groupsOf = (exams) => {
  const seen = new Map();
  for (const exam of exams) if (!seen.has(exam.groupId)) seen.set(exam.groupId, exam.groupName);
  return [...seen].map(([value, label]) => ({ value, label: label || '—' }));
};

function body() {
  const { data } = state;
  if (data.exams.length === 0) {
    return emptyState('table', el('p', { class: 'empty__title', id: 'state-exams-empty' }, t(data.can.manage ? 'stateExam.emptyManage' : 'stateExam.empty')));
  }
  const groups = groupsOf(data.exams);
  if (!groups.some((g) => g.value === state.groupId)) state.groupId = '';
  const shown = data.exams.filter((exam) => state.groupId === '' || exam.groupId === state.groupId);
  return el('section', { class: 'card table-card', 'aria-labelledby': 'state-exams-title' },
    el('div', { class: 'toolbar lg-toolbar' },
      selectField({
        id: 'state-exams-group', label: t('stateExam.col.group'), hideLabel: true, value: state.groupId,
        placeholder: t('stateExam.allGroups'), options: groups,
        onChange: (value) => { state.groupId = value; refresh(); },
      })),
    shown.length === 0 ? el('p', { class: 'lg-nomatch', id: 'state-exams-nomatch' }, t('stateExam.noMatch')) : table(shown, data.can.manage));
}

function table(exams, manage) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table lg-table se-table', 'aria-labelledby': 'state-exams-title' },
      el('thead', {}, el('tr', {},
        col(t('stateExam.col.date')), col(t('stateExam.col.group')), col(t('stateExam.col.name')), col(t('stateExam.col.scores')),
        el('td', { class: 'lg-table__go' }))),
      el('tbody', {}, exams.map((exam) => el('tr', { class: 'lg-row', id: 'state-exam-row-' + exam.id },
        el('td', { class: 'se-table__date' }, dayFull(exam.date)),
        el('td', {}, el('span', { class: 'group-chip' }, exam.groupName || '—')),
        el('td', { class: 'lg-table__subject' },
          el('a', { class: 'lg-table__link', id: 'state-exam-open-' + exam.id, href: '#/state-exam/' + encodeURIComponent(exam.id) }, el('span', { class: 'se-table__name' }, exam.name))),
        el('td', {}, scoresBadge(exam)),
        el('td', { class: 'se-table__actions' }, manage ? rowActions(exam) : icon('chevron', 'lg-table__chevron')))))));
}

// «баллы у 20 из 22»: green when everybody has one.
function scoresBadge(exam) {
  const full = exam.students > 0 && exam.entered >= exam.students;
  return badge(t('stateExam.scoresOf', { entered: exam.entered, total: exam.students }), full ? 'success' : 'neutral', true);
}

function rowActions(exam) {
  const locked = exam.entered > 0;
  const remove = el('button', {
    type: 'button', class: 'button button--secondary button--small' + (locked ? ' is-locked' : ''), id: 'state-exam-remove-' + exam.id,
    'aria-disabled': locked ? 'true' : null, title: locked ? t('stateExam.removeLocked') : null,
    onclick: () => { if (!locked) openRemove(exam); },
  }, t('stateExam.remove'));
  return el('div', { class: 'se-actions' },
    el('button', { type: 'button', class: 'button button--secondary button--small', id: 'state-exam-edit-' + exam.id, onclick: () => openDialog(exam) }, t('stateExam.edit')),
    remove);
}

// ---- A window over the screen ----

function shell(id, onClose, ...children) {
  document.getElementById(id)?.remove();
  const onHash = () => dialog.close();
  const dialog = modal({
    id, labelledBy: id + '-title', className: 'dialog--confirm',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); onClose(); },
  }, ...children);
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// A labelled control whose error line is shown and cleared in place (no redraw: the caret stays).
function fieldBox({ id, label, hint = null, control, input = control }) {
  const error = el('p', { class: 'field__error', id: id + '-error', hidden: true });
  const hintId = hint ? id + '-hint' : null;
  const root = el('div', { class: 'field' },
    el('label', { class: 'field__label', for: id }, label),
    el('div', { class: 'field__control' }, control),
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
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

const fieldMessage = (field, code) => (hasText(`stateExam.error.${field}.${code}`) ? t(`stateExam.error.${field}.${code}`) : t(errorKey(code)));

// The names of the disciplines for the hint of the title, asked once and only by those who may list them. A failure is not shown: the hint is a convenience.
async function loadDisciplines(owner) {
  if (owner.disciplines !== null) return owner.disciplines;
  if (!permissions().includes('dir.list:disciplines')) return [];
  try {
    const { rows } = await call('dir.list', { table: 'disciplines' });
    owner.disciplines = [...new Set(rows.map((row) => String(row.name ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    owner.disciplines = [];
  }
  return owner.disciplines;
}

// ---- «Новый экзамен» / «Изменить» ----

function openDialog(exam) {
  const owner = state;
  const locked = exam !== null && exam.entered > 0;
  let busy = false;
  const group = el('select', { class: 'field__input field__select', id: 'state-exam-group', name: 'groupId', disabled: locked ? '' : null },
    el('option', { value: '' }, t('stateExam.dialog.groupPlaceholder')),
    owner.data.groups.map((g) => el('option', { value: g.id }, g.name)));
  group.value = exam ? exam.groupId : '';
  const groupBox = fieldBox({ id: 'state-exam-group', label: t('stateExam.dialog.group'), hint: locked ? t('stateExam.dialog.groupLocked') : null, control: group });
  const listId = 'state-exam-names';
  const names = el('datalist', { id: listId });
  const name = el('input', {
    type: 'text', class: 'field__input', id: 'state-exam-name', name: 'name', maxlength: String(NAME_MAX), autocomplete: 'off',
    list: listId, value: exam ? exam.name : '',
  });
  const nameBox = fieldBox({ id: 'state-exam-name', label: t('stateExam.dialog.name'), hint: t('stateExam.dialog.nameHint'), control: el('div', {}, name, names), input: name });
  const date = el('input', { type: 'date', class: 'field__input', id: 'state-exam-date', name: 'date', value: exam ? exam.date : (owner.data.today || '') });
  const dateBox = fieldBox({ id: 'state-exam-date', label: t('stateExam.dialog.date'), control: date });
  const boxes = { groupId: groupBox, name: nameBox, date: dateBox };
  group.addEventListener('change', () => groupBox.set(null));
  name.addEventListener('input', () => nameBox.set(null));
  date.addEventListener('input', () => dateBox.set(null));

  const problem = el('div', { class: 'mk-problem' });
  const submitKey = exam ? 'stateExam.dialog.save' : 'stateExam.dialog.add';
  const submit = el('button', { type: 'button', class: 'button button--primary', id: 'state-exam-save' }, t(submitKey));
  const dialog = shell('state-exam-dialog', () => focusById(exam ? 'state-exam-edit-' + exam.id : 'state-exam-new'),
    el('h2', { class: 'dialog__title', id: 'state-exam-dialog-title' }, t(exam ? 'stateExam.dialog.editTitle' : 'stateExam.dialog.newTitle')),
    groupBox.root, nameBox.root, dateBox.root, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'state-exam-cancel', onclick: () => dialog.close() }, t('common.cancel')),
      submit));

  loadDisciplines(owner).then((list) => {
    if (!names.isConnected) return;
    names.replaceChildren(...list.map((value) => el('option', { value })));
  });

  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    for (const box of Object.values(boxes)) box.set(null);
    markBusy(submit, 'stateExam.dialog.busy');
    try {
      await call('stateExam.save', { ...(exam ? { id: exam.id } : {}), groupId: group.value, name: name.value, date: date.value });
      if (state !== owner) return;
      owner.data = null;
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      submit.removeAttribute('aria-busy');
      submit.removeAttribute('aria-disabled');
      submit.classList.remove('is-busy');
      submit.textContent = t(submitKey);
      const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
      let loose = fields.length === 0 ? t(errorKey(error.code)) : null;
      for (const { field, code } of fields) {
        if (boxes[field]) boxes[field].set(fieldMessage(field, code));
        else loose = loose || t(errorKey(code));
      }
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  focusById(exam ? 'state-exam-name' : 'state-exam-group');
}

// ---- «Удалить» ----

function openRemove(exam) {
  const owner = state;
  let busy = false;
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'state-exam-remove-confirm' }, t('stateExam.remove.confirm'));
  const dialog = shell('state-exam-remove-dialog', () => focusById('state-exam-new'),
    el('h2', { class: 'dialog__title', id: 'state-exam-remove-dialog-title' }, t('stateExam.remove.title')),
    el('p', {}, t('stateExam.remove.text', { name: exam.name, group: exam.groupName || '—' })),
    problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'state-exam-remove-cancel', onclick: () => dialog.close() }, t('common.cancel')),
      confirm));
  confirm.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    markBusy(confirm, 'stateExam.remove.busy');
    try {
      await call('stateExam.remove', { examId: exam.id });
      if (state !== owner) return;
      owner.data = null;
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.removeAttribute('aria-disabled');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('stateExam.remove.confirm');
      const key = error.code === 'in_use' ? 'stateExam.error.in_use' : errorKey(error.code);
      problem.replaceChildren(note('error', t(key), { role: 'alert' }));
    }
  });
  focusById('state-exam-remove-cancel');
}

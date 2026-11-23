import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, field, selectField, note, modal, showModal, markBusy, focusFirstInvalid } from '../ui.js';
import { icon } from '../icons.js';
import { defaultDue, formProblems } from '../work.js';

// The window of an assignment (work.save): a new one, a changed one, or one given from a pair on its «Итог» stage.
// It opens over whatever screen the person is on, takes what it lacks from the server (the units and topics of the
// subject from work.list, the description of a changed assignment from work.get) and says when it is closed
// without saving only after asking. Every text from the server or the person goes in as text.

const MAX_POINTS = 10;

// A small question with two buttons (yes: null — only the first, a plain notice); resolves to true on the second (main) one,
// false on the first or on Escape.
export function confirmDialog({ id, title, no, yes, danger = false, host = document.body }) {
  return new Promise((resolve) => {
    let answer = false;
    const dialog = modal({
      id, labelledBy: id + '-title', className: 'dialog--confirm',
      onClose: () => { dialog.remove(); resolve(answer); },
    },
    el('h2', { class: 'dialog__title', id: id + '-title' }, title),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: id + '-no', class: 'button button--secondary', onclick: () => dialog.close() }, no),
      yes === null ? null : el('button', { type: 'button', id: id + '-yes', class: 'button ' + (danger ? 'button--danger' : 'button--primary'), onclick: () => { answer = true; dialog.close(); } }, yes)));
    showModal(host, dialog);
  });
}

const unitLabel = (unit) => (unit.title ? t('work.unitTitled', { n: unit.unit, title: unit.title }) : t('work.unit', { n: unit.unit }));
const topicLabel = (topic) => (topic.number ? topic.number + ' · ' : '') + topic.name;

// openTaskForm({ subjectId, assignment?, pair?, plan?, host?, onSaved(result), onClosed() })
// assignment: a row of work.list (to change it); pair: { id, subjectName, groupName, topicId, topicName, unit } (to give one from
// the pair); plan: the answer of work.list for this subject, if the screen already has it.
export async function openTaskForm({ subjectId, assignment = null, pair = null, plan = null, host = document.body, onSaved = () => {}, onClosed = () => {} }) {
  let list = plan;
  let description = '';
  try {
    if (list === null) list = await call('work.list', { subjectId });
    if (assignment) description = (await call('work.get', { assignmentId: assignment.id })).assignment.description ?? '';
  } catch (error) {
    await confirmDialog({ id: 'task-form-fail', title: t(errorKey(error.code)), no: t('common.close'), yes: t('common.retry'), host })
      .then((again) => (again ? openTaskForm({ subjectId, assignment, pair, plan, host, onSaved, onClosed }) : onClosed()));
    return;
  }

  const locked = Boolean(assignment) && assignment.locked === true;
  const due = assignment ? { dueDate: assignment.dueAt.slice(0, 10), dueTime: assignment.dueAt.slice(11, 16) } : defaultDue(list.today);
  const pairTopic = pair && pair.topicId ? list.topics.find((x) => x.id === pair.topicId) : undefined;
  const fixedPlace = Boolean(pairTopic) || locked;
  const form = assignment
    ? { kind: assignment.kind, unit: assignment.unit === null ? '' : String(assignment.unit), topicId: assignment.topicId ?? '', title: assignment.title, description, ...due, maxPoints: String(assignment.maxPoints) }
    : {
      kind: 'hw', unit: pairTopic ? String(pairTopic.unit) : '', topicId: pairTopic ? pairTopic.id : '', title: '', description: '', ...due, maxPoints: String(MAX_POINTS),
    };
  const start = JSON.stringify(form);
  const view = { errors: new Map(), problemKey: null, busy: false };
  const dirty = () => JSON.stringify(form) !== start;

  let dialog;
  const body = el('div', { class: 'task-form' });
  const saved = { done: false };

  const askClose = async () => {
    if (view.busy) return;
    if (!dirty() || await confirmDialog({ id: 'task-form-unsaved', title: t('work.form.unsaved'), no: t('work.form.stay'), yes: t('work.form.discard'), host })) dialog.close();
  };
  const onHash = () => dialog.close();

  const unitOptions = () => list.units.map((u) => ({ value: String(u.unit), label: unitLabel(u) }));
  const topicOptions = () => list.topics.filter((x) => form.unit === '' || String(x.unit) === form.unit).map((x) => ({ value: x.id, label: topicLabel(x) }));

  function setKind(kind) {
    form.kind = kind;
    view.errors.delete('kind');
    draw('task-kind-' + kind);
  }

  function kindBlock() {
    if (locked) return el('div', { class: 'field' }, el('span', { class: 'field__label' }, t('work.form.kind')), el('p', { class: 'task-form__fixed', id: 'task-kind-fixed' }, t('work.kind.' + form.kind + '.long')));
    const error = view.errors.get('kind');
    return el('div', { class: 'field' },
      el('span', { class: 'field__label', id: 'task-kind-label' }, t('work.form.kind')),
      el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'task-kind-label' },
        ['hw', 'srs'].map((kind) => el('button', {
          type: 'button', id: 'task-kind-' + kind, class: 'segmented__button', 'aria-pressed': String(form.kind === kind), onclick: () => setKind(kind),
        }, t('work.kind.' + kind)))),
      el('p', { class: 'field__hint' }, t('work.kind.' + form.kind + '.hint')),
      error ? el('p', { class: 'field__error' }, icon('alert'), t(error)) : null);
  }

  function placeBlock() {
    if (pair) {
      const topic = pairTopic ? topicLabel(pairTopic) : pair.topicName;
      return el('div', { class: 'task-form__pair', id: 'task-pair' },
        el('p', { class: 'task-form__pair-subject' }, [pair.subjectName, pair.groupName].filter(Boolean).join(' · ')),
        pairTopic || pair.topicId
          ? el('p', { class: 'task-form__pair-topic' }, t('work.form.pairTopic', { topic, unit: pair.unit ?? pairTopic.unit }))
          : el('p', { class: 'task-form__pair-topic' }, t('work.form.pairNoTopic')));
    }
    return null;
  }

  function placeFields() {
    if (fixedPlace) {
      const topic = list.topics.find((x) => x.id === form.topicId);
      const unit = list.units.find((u) => String(u.unit) === form.unit);
      if (pairTopic) return null;
      return el('div', { class: 'task-form__fixed-place', id: 'task-place' },
        el('p', {}, el('span', { class: 'task-form__fixed-label' }, t('work.form.unit')), form.unit === '' ? t('work.form.noUnit') : unit ? unitLabel(unit) : t('work.unit', { n: form.unit })),
        el('p', {}, el('span', { class: 'task-form__fixed-label' }, t('work.form.topic')), form.topicId === '' ? t('work.form.noTopic') : topic ? topicLabel(topic) : assignment.topicName),
        locked ? el('p', { class: 'field__hint' }, t('work.form.locked')) : null);
    }
    if (list.units.length === 0) return note('info', t('work.form.noPlan'), { id: 'task-no-plan' });
    return el('div', { class: 'task-form__row' },
      selectField({
        id: 'task-unit', label: t('work.form.unit') + (form.kind === 'srs' ? ' *' : ''), value: form.unit, placeholder: form.kind === 'srs' ? t('work.form.chooseUnit') : t('work.form.noUnit'),
        options: unitOptions(), error: view.errors.get('unit') ?? null,
        onChange: (value) => {
          form.unit = value;
          const topic = list.topics.find((x) => x.id === form.topicId);
          if (topic && value !== '' && String(topic.unit) !== value) form.topicId = '';
          view.errors.delete('unit');
          draw('task-unit');
        },
      }),
      selectField({
        id: 'task-topic', label: t('work.form.topic'), value: form.topicId, placeholder: t('work.form.noTopic'), options: topicOptions(), error: view.errors.get('topicId') ?? null,
        onChange: (value) => {
          form.topicId = value;
          const topic = list.topics.find((x) => x.id === value);
          if (topic) form.unit = String(topic.unit);
          view.errors.delete('topicId');
          draw('task-topic');
        },
      }));
  }

  function textarea() {
    const error = view.errors.get('description');
    const area = el('textarea', {
      id: 'task-description', name: 'task-description', class: 'field__input field__textarea', rows: 4, 'aria-invalid': error ? 'true' : null,
      oninput: () => { form.description = area.value; },
    });
    area.value = form.description;
    return el('div', { class: 'field' },
      el('label', { class: 'field__label', for: 'task-description' }, t('work.form.description')),
      area,
      error ? el('p', { class: 'field__error' }, icon('alert'), t(error)) : null);
  }

  function build() {
    const save = el('button', { type: 'button', id: 'task-save', class: 'button button--primary', onclick: () => { submit(); } }, t('common.save'));
    if (view.busy) markBusy(save, 'common.saving');
    return [
      el('h2', { class: 'dialog__title', id: 'task-form-title' }, t(assignment ? 'work.form.titleEdit' : pair ? 'work.form.titlePair' : 'work.form.titleNew')),
      view.problemKey ? note('error', t(view.problemKey), { id: 'task-problem', role: 'alert' }) : null,
      placeBlock(),
      kindBlock(),
      placeFields(),
      field({ id: 'task-title', label: t('work.form.title'), value: form.title, error: view.errors.get('title') ?? null, attrs: { maxlength: 200, autocomplete: 'off' }, onInput: (v) => { form.title = v; } }),
      textarea(),
      el('div', { class: 'task-form__row' },
        field({
          id: 'task-date', label: t('work.form.dueDate'), type: 'date', value: form.dueDate, error: view.errors.get('due') ?? null,
          onInput: (v) => { form.dueDate = v; },
        }),
        field({ id: 'task-time', label: t('work.form.dueTime'), type: 'time', value: form.dueTime, onInput: (v) => { form.dueTime = v; } }),
        field({
          id: 'task-points', label: t('work.form.maxPoints'), type: 'number', value: form.maxPoints, error: view.errors.get('maxPoints') ?? null,
          attrs: { min: 1, max: 100, step: 1, inputmode: 'numeric' }, onInput: (v) => { form.maxPoints = v; },
        })),
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', id: 'task-cancel', class: 'button button--secondary', onclick: () => { askClose(); } }, t('common.cancel')),
        save),
    ];
  }

  function draw(focusId) {
    body.replaceChildren(...build().filter(Boolean));
    if (focusId) {
      const target = document.getElementById(focusId);
      if (target) target.focus();
    }
  }

  async function submit() {
    if (view.busy) return;
    const unit = form.unit === '' ? null : Number(form.unit);
    const points = /^\d+$/.test(form.maxPoints.trim()) ? Number(form.maxPoints.trim()) : form.maxPoints;
    const data = {
      subjectId, kind: form.kind, unit, topicId: form.topicId, title: form.title, description: form.description,
      dueDate: form.dueDate, dueTime: form.dueTime, maxPoints: points,
    };
    if (assignment) data.id = assignment.id;
    else if (pair) data.pairId = pair.id;
    view.busy = true;
    view.problemKey = null;
    draw();
    try {
      const result = await call('work.save', data);
      view.busy = false;
      form.title = form.title.trim();
      saved.done = true;
      dialog.close();
      onSaved(result.assignment);
    } catch (error) {
      view.busy = false;
      if (error.code === 'invalid' && Array.isArray(error.fields)) {
        view.errors = formProblems(error.fields);
        view.problemKey = 'error.invalid';
      } else {
        view.errors = new Map();
        view.problemKey = errorKey(error.code);
      }
      draw();
      focusFirstInvalid();
    }
  }

  dialog = modal({
    id: 'task-form', labelledBy: 'task-form-title', className: 'dialog--task',
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); onClosed(saved.done); },
    canCancel: () => {
      if (view.busy) return false;
      if (dirty()) { askClose(); return false; }
      return true;
    },
  }, body);
  window.addEventListener('hashchange', onHash);
  draw();
  showModal(host, dialog);
  const first = document.getElementById('task-title');
  if (first) first.focus();
}

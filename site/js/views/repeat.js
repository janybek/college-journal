import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, focusById, focusFirstInvalid, markBusy, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { stateBadge, totalLine, prevLine, orderLine, dayOf } from '../repeat.js';
import { attemptLines, wordTone } from '../ledger.js';
import { dialogShell, fieldBox, resetBusy, showProblems, termsFields } from './repeatEnrol.js';

// The card of a repeat (#/repeat/<id>, repeat.get): the head, the previous result, and for the deanery «Изменить» (the order,
// the deadline, the teacher) and «Отменить запись» (with a reason). Entering the points is another block of the screen.
// The server decides what the person may do (`can`); names, order numbers and reasons are only ever text.

const blank = () => ({
  id: null,            // the card this state belongs to
  data: null,          // the answer of repeat.get: { repeat }; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
});
let state = blank();

export function leave() {
  document.getElementById('repeat-edit-dialog')?.remove();
  document.getElementById('repeat-cancel-dialog')?.remove();
  state = blank();
}

export function render(root, params) {
  if (state.id !== params.repeatId) state = Object.assign(blank(), { id: params.repeatId });
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const card = state.data === null ? null : state.data.repeat;
  root.append(
    el('a', { class: 'rp-back', id: 'repeat-back', href: '#/repeats' }, icon('chevron', 'rp-back__icon'), t('repeat.back')),
    card === null
      ? pageHeader({ id: 'repeat-title', title: t('repeat.title') })
      : pageHeader({ id: 'repeat-title', title: card.student.fullName || '—', lead: `${card.subject.name} · ${card.student.groupName || '—'}`, actions: actions(card) }),
    card === null ? loadingBody() : body(card));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('repeat.get', { repeatId: owner.id });
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
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('repeat.card.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function actions(card) {
  if (!card.can.edit && !card.can.cancel) return null;
  return el('div', { class: 'rp-actions' },
    card.can.edit ? el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-edit', onclick: () => openEdit(card) }, icon('pencil'), t('repeat.edit')) : null,
    card.can.cancel ? el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-cancel', onclick: () => openCancel(card) }, t('repeat.cancel')) : null);
}

const fact = (id, labelKey, value) => el('div', { class: 'lg-exam__fact', id }, el('dt', {}, t(labelKey)), el('dd', {}, value));

function body(card) {
  const mark = stateBadge({ status: card.status, overdue: card.overdue });
  const order = orderLine(card.order.no, card.order.date);
  // A card of the whole subject without works yet is not «не допущен»: nothing to show until the works are entered.
  const total = card.kind === 'full' && card.works.value === null ? null : totalLine(card);
  return el('div', { class: 'repeat' },
    card.status === 'open' && card.overdue ? note('warning', t('repeat.overdue.note'), { id: 'repeat-overdue' }) : null,
    el('section', { class: 'card rp-head', 'aria-labelledby': 'repeat-title' },
      el('dl', { class: 'lg-exam__facts' },
        fact('repeat-fact-student', 'repeat.fact.student', card.student.fullName || '—'),
        fact('repeat-fact-group', 'repeat.fact.group', card.student.groupName || '—'),
        fact('repeat-fact-subject', 'repeat.fact.subject', card.subject.name || '—'),
        fact('repeat-fact-semester', 'repeat.fact.semester', String(card.subject.planSemester ?? '—')),
        fact('repeat-fact-kind', 'repeat.fact.kind', t('repeat.kind.' + card.kind)),
        fact('repeat-fact-order', 'repeat.fact.order', order ? t(order.key, order.params) : '—'),
        fact('repeat-fact-deadline', 'repeat.fact.deadline', dayOf(card.deadline) || '—'),
        fact('repeat-fact-teacher', 'repeat.fact.teacher', card.teacher.fullName || '—'),
        el('div', { class: 'lg-exam__fact', id: 'repeat-fact-state' }, el('dt', {}, t('repeat.col.state')), el('dd', {}, badge(t(mark.key), mark.tone, true))),
        total ? el('div', { class: 'lg-exam__fact', id: 'repeat-fact-total' }, el('dt', {}, t('repeat.fact.total')),
          el('dd', {}, t(total.key, total.params), total.word ? [' ', badge(t('journal.grade.' + total.word), wordTone(total.word))] : null)) : null)),
    previous(card));
}

// «Прежний результат»: the semester, the admission, the sittings of the exam, the total and the word.
function previous(card) {
  const { prev, split } = card;
  const line = prevLine(prev, split);
  const attempts = attemptLines(prev.attempts);
  return el('section', { class: 'card rp-prev', id: 'repeat-prev', 'aria-labelledby': 'repeat-prev-title' },
    el('div', { class: 'rp-prev__top' },
      el('h2', { class: 'rp-prev__title', id: 'repeat-prev-title' }, t('repeat.prev.title')),
      prev.fromRepeat ? badge(t('repeat.prev.fromRepeat'), 'neutral') : null),
    el('p', { class: 'rp-prev__line', id: 'repeat-prev-line' }, t(line.key, line.params)),
    el('dl', { class: 'lg-exam__facts' },
      fact('repeat-prev-semester', 'repeat.prev.semester', prev.semester === null || prev.semester === undefined ? '—' : String(prev.semester)),
      fact('repeat-prev-admission', 'repeat.prev.admission', t(prev.admitted === true ? 'repeat.prev.admitted.yes' : 'repeat.prev.admitted.no')),
      fact('repeat-prev-total', 'repeat.prev.total', prev.total === null || prev.total === undefined ? '—'
        : [String(prev.total), prev.word ? [' ', badge(t('journal.grade.' + prev.word), wordTone(prev.word))] : null])),
    el('div', { class: 'gr-attempts', id: 'repeat-prev-attempts' },
      el('h3', { class: 'rp-prev__sub' }, t('repeat.prev.attempts')),
      attempts.length === 0 ? el('p', { class: 'muted' }, t('repeat.prev.noAttempts'))
        : el('ul', { class: 'gr-attempts__list' }, attempts.map((a) => el('li', {},
          [dayOf(a.date).slice(0, 5), t(a.label.key, a.label.params), a.result.key ? t(a.result.key) : a.result.text].join(' · '))))));
}

// ---- «Изменить» ----

async function openEdit(card) {
  const owner = state;
  const loading = el('p', { class: 'loading' }, t('common.loading'));
  const dialog = dialogShell('repeat-edit-dialog', () => focusById('repeat-edit'), 'rp-dialog',
    el('h2', { class: 'dialog__title', id: 'repeat-edit-dialog-title' }, t('repeat.edit.title')), loading);
  let teachers;
  try {
    const answer = await call('repeat.candidates', { subjectId: card.subject.id });
    teachers = answer.teachers;
  } catch (error) {
    if (!dialog.isConnected) return;
    loading.replaceWith(note('error', t(errorKey(error.code)), { role: 'alert' }));
    return;
  }
  if (!dialog.isConnected) return;
  if (!teachers.some((p) => p.id === card.teacher.id)) teachers = [{ id: card.teacher.id, fullName: card.teacher.fullName }, ...teachers];
  const terms = termsFields('repeat-edit', { orderNo: card.order.no, orderDate: card.order.date, deadline: card.deadline, teacherId: card.teacher.id }, teachers, null);
  const problem = el('div', { class: 'mk-problem' });
  const submit = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-edit-save' }, t('repeat.edit.save'));
  let busy = false;
  submit.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    for (const box of Object.values(terms.boxes)) box.set(null);
    markBusy(submit, 'repeat.edit.busy');
    try {
      const data = await call('repeat.save', { repeatId: card.id, ...terms.values() });
      if (state !== owner) return;
      owner.data = data;
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      resetBusy(submit, 'repeat.edit.save');
      const loose = showProblems(error, terms.boxes);
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  loading.replaceWith(...terms.nodes, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-edit-cancel', onclick: () => dialog.close() }, t('common.cancel')),
      submit));
  focusById('repeat-edit-order-no');
}

// ---- «Отменить запись» ----

function openCancel(card) {
  const owner = state;
  let busy = false;
  const reason = el('textarea', { class: 'field__input rp-reason', id: 'repeat-cancel-reason', name: 'reason', rows: '3', maxlength: '300' });
  const box = fieldBox({ id: 'repeat-cancel-reason', label: t('repeat.cancel.reason'), hint: t('repeat.cancel.reasonHint'), control: reason });
  reason.addEventListener('input', () => box.set(null));
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-cancel-confirm' }, t('repeat.cancel.confirm'));
  const dialog = dialogShell('repeat-cancel-dialog', () => focusById('repeat-cancel'), 'dialog--confirm',
    el('h2', { class: 'dialog__title', id: 'repeat-cancel-dialog-title' }, t('repeat.cancel.title')),
    el('p', {}, t('repeat.cancel.text', { student: card.student.fullName, subject: card.subject.name })),
    box.root, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-cancel-keep', onclick: () => dialog.close() }, t('repeat.cancel.keep')),
      confirm));
  confirm.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    box.set(null);
    markBusy(confirm, 'repeat.cancel.busy');
    try {
      const data = await call('repeat.cancel', { repeatId: card.id, reason: reason.value });
      if (state !== owner) return;
      owner.data = data;
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      resetBusy(confirm, 'repeat.cancel.confirm');
      const loose = showProblems(error, { reason: box });
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  focusById('repeat-cancel-reason');
}

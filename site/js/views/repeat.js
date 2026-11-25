import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, badge, emptyState, focusById, focusFirstInvalid, holdOnLeave, markBusy, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { printSheet } from '../print.js';
import { repeatSheet, stateBadge, totalLine, prevLine, orderLine, dayOf, worksState, admissionLine, attemptForm, fixTarget, closeNote, canClose } from '../repeat.js';
import { attemptLines, nextLabel, wordTone } from '../ledger.js';
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
  draft: null,         // the unsaved works of the form: { value, note, reason }
  holding: false,      // the leave guard is on (the works are changed and not saved)
  busy: false,         // a request of the works or of the closing is on its way
  flash: null,         // 'works': the works were just saved
});
let state = blank();
let host = null; // the element of the screen: the printed sheet stands in it while the browser prints

export function leave() {
  for (const id of ['repeat-edit-dialog', 'repeat-cancel-dialog', 'repeat-attempt-dialog', 'repeat-close-dialog', 'repeat-reopen-dialog', 'repeat-leave-dialog']) {
    document.getElementById(id)?.remove();
  }
  if (state.holding) holdOnLeave(null);
  leavePromise = null;
  state = blank();
}

export function render(root, params) {
  host = root;
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

function printCard(card) {
  printSheet(host, repeatSheet(card, { t, title: t('repeat.print.title'), draft: t('repeat.print.draft') }), 'portrait');
}

function actions(card) {
  return el('div', { class: 'rp-actions' },
    el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-print', onclick: () => printCard(card) }, icon('printer'), t('repeat.print.button')),
    card.can.edit ? el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-edit', onclick: () => openEdit(card) }, icon('pencil'), t('repeat.edit')) : null,
    card.can.cancel ? el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-cancel', onclick: () => openCancel(card) }, t('repeat.cancel')) : null);
}

const fact = (id, labelKey, value) => el('div', { class: 'lg-exam__fact', id }, el('dt', {}, t(labelKey)), el('dd', {}, value));

function body(card) {
  const mark = stateBadge({ status: card.status, overdue: card.overdue });
  const order = orderLine(card.order.no, card.order.date);
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
        el('div', { class: 'lg-exam__fact', id: 'repeat-fact-state' }, el('dt', {}, t('repeat.col.state')), el('dd', {}, badge(t(mark.key), mark.tone, true))))),
    previous(card), worksBlock(card), examBlock(card), finishBlock(card));
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
      take(owner, data);
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
      take(owner, data);
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

// ---- Shared by the blocks of the teacher ----

const NOTE_KIND = { success: 'success', danger: 'error', warning: 'warning', neutral: 'info' };
const MODES = ['score', 'absent', 'incomplete'];

// The answer of the server becomes the card; the typed works stay unless the works themselves were saved.
function take(owner, data, { resetDraft = false, flash = null } = {}) {
  owner.data = data;
  owner.flash = flash;
  if (resetDraft) owner.draft = null;
  syncHold();
}

const storedValue = (card) => (card.works.value === null ? '' : String(card.works.value));

function worksDirty(card) {
  const draft = state.draft;
  if (draft === null || !worksState(card).show || card.can.works !== true) return false;
  return draft.value.trim() !== storedValue(card) || draft.note.trim() !== card.works.note.trim();
}

// The leave guard: with unsaved works, going away asks first.
function syncHold() {
  const dirty = state.data !== null && worksDirty(state.data.repeat);
  if (dirty && !state.holding) { state.holding = true; holdOnLeave(askLeave); }
  if (!dirty && state.holding) { state.holding = false; holdOnLeave(null); }
}

let leavePromise = null;

function askLeave() {
  if (leavePromise) return leavePromise;
  const owner = state;
  leavePromise = new Promise((resolve) => {
    let agreed = false;
    const dialog = dialogShell('repeat-leave-dialog', () => { leavePromise = null; if (agreed && state === owner) { owner.holding = false; holdOnLeave(null); } resolve(agreed); }, 'dialog--confirm',
      el('h2', { class: 'dialog__title', id: 'repeat-leave-dialog-title' }, t('repeat.leave.title')),
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-leave-stay', onclick: () => dialog.close() }, t('repeat.leave.stay')),
        el('button', { type: 'button', class: 'button button--primary', id: 'repeat-leave-go', onclick: () => { agreed = true; dialog.close(); } }, t('repeat.leave.go'))));
    focusById('repeat-leave-stay');
  });
  return leavePromise;
}

// The fields of a refused request get their lines (with the maxima of the answer filled in); the rest becomes one note's text.
function problemsOf(error, boxes, params) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  let loose = fields.length === 0 ? t(errorKey(error.code)) : null;
  for (const { field, code } of fields) {
    const key = `repeat.error.${field}.${code}`;
    const text = hasText(key) ? t(key, params) : t(errorKey(code));
    if (boxes[field]) boxes[field].set(text); else loose = loose || text;
  }
  return loose;
}

function block(id, titleKey, ...children) {
  return el('section', { class: 'card rp-block', id, 'aria-labelledby': id + '-title' },
    el('h2', { class: 'rp-prev__title', id: id + '-title' }, t(titleKey)),
    ...children);
}

const textArea = (id, name, rows, value = '') => {
  const area = el('textarea', { class: 'field__input field__textarea rp-reason', id, name, rows: String(rows), maxlength: '300' });
  area.value = value;
  return area;
};

// ---- «Работы повтора» ----

function worksBlock(card) {
  const w = worksState(card);
  if (!w.show) return null;
  if (state.draft === null) state.draft = { value: storedValue(card), note: card.works.note, reason: '' };
  const line = admissionLine(card);
  const admission = line ? note(NOTE_KIND[line.tone], t(line.key, line.params), { id: 'repeat-admission' }) : null;
  const lead = el('p', { class: 'rp-block__lead' }, t('repeat.works.lead', { max: w.max, need: card.split.admission }));
  if (!w.edit) {
    return block('repeat-works', 'repeat.works.title', lead,
      w.value === null ? el('p', { class: 'muted', id: 'repeat-works-none' }, t('repeat.works.none'))
        : el('dl', { class: 'lg-exam__facts' },
          el('div', { class: 'lg-exam__fact', id: 'repeat-works-shown' }, el('dt', {}, t('repeat.works.value', { max: w.max })), el('dd', {}, t('repeat.works.of', { value: w.value, max: w.max }))),
          el('div', { class: 'lg-exam__fact', id: 'repeat-works-note-shown' }, el('dt', {}, t('repeat.works.note')), el('dd', {}, w.note || '—'))),
      admission);
  }
  const draft = state.draft;
  const input = el('input', {
    type: 'text', class: 'field__input rp-score', id: 'repeat-works-value', name: 'works', inputmode: 'numeric', maxlength: '3', autocomplete: 'off', value: draft.value,
  });
  const valueBox = fieldBox({ id: 'repeat-works-value', label: t('repeat.works.value', { max: w.max }), hint: t('repeat.works.hint', { max: w.max }), control: input });
  const noteInput = textArea('repeat-works-note', 'note', 2, draft.note);
  const noteBox = fieldBox({ id: 'repeat-works-note', label: t('repeat.works.note'), hint: t('repeat.works.noteHint'), control: noteInput });
  const reasonInput = textArea('repeat-works-reason', 'reason', 2, draft.reason);
  const reasonBox = fieldBox({ id: 'repeat-works-reason', label: t('repeat.works.reason'), hint: t('repeat.works.reasonHint'), control: reasonInput });
  const syncReason = () => { reasonBox.root.hidden = !(w.needReason && input.value.trim() !== storedValue(card)); };
  syncReason();
  input.addEventListener('input', () => { draft.value = input.value; valueBox.set(null); syncReason(); syncHold(); });
  noteInput.addEventListener('input', () => { draft.note = noteInput.value; noteBox.set(null); syncHold(); });
  reasonInput.addEventListener('input', () => { draft.reason = reasonInput.value; reasonBox.set(null); });
  const problem = el('div', { class: 'mk-problem' });
  const save = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-works-save' }, t('repeat.works.save'));
  save.addEventListener('click', async () => {
    if (state.busy) return;
    const owner = state;
    problem.replaceChildren();
    for (const box of [valueBox, noteBox, reasonBox]) box.set(null);
    const text = input.value.trim();
    if (!/^\d{1,3}$/.test(text)) {
      valueBox.set(t('repeat.error.works.bad_value', { max: w.max }));
      input.focus();
      return;
    }
    owner.busy = true;
    markBusy(save, 'repeat.works.busy');
    try {
      const data = await call('repeat.saveWorks', { repeatId: card.id, works: Number(text), note: noteInput.value, reason: reasonInput.value });
      if (state !== owner) return;
      owner.busy = false;
      take(owner, data, { resetDraft: true, flash: 'works' });
      refresh();
    } catch (error) {
      if (state !== owner) return;
      owner.busy = false;
      resetBusy(save, 'repeat.works.save');
      const loose = problemsOf(error, { works: valueBox, note: noteBox, reason: reasonBox }, { max: w.max });
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  return block('repeat-works', 'repeat.works.title', lead,
    el('div', { class: 'rp-form' }, valueBox.root, noteBox.root, reasonBox.root),
    problem,
    el('div', { class: 'rp-block__actions' }, save,
      state.flash === 'works' ? el('span', { class: 'rp-saved', id: 'repeat-works-saved', role: 'status' }, icon('checkCircle'), t('repeat.works.saved')) : null),
    admission);
}

// ---- «Экзамен повтора» ----

function examBlock(card) {
  const form = attemptForm(card);
  const target = fixTarget(card);
  const lines = attemptLines(card.attempts);
  const parts = [];
  if (card.kind === 'exam') {
    parts.push(el('p', { class: 'rp-block__lead', id: 'repeat-exam-prev' }, t('repeat.exam.prevSemester', { semester: card.result.semester ?? '—', max: card.split.semester })));
  }
  if (card.kind === 'full' && card.works.value === null) {
    parts.push(el('p', { class: 'muted', id: 'repeat-exam-wait' }, t('repeat.exam.afterWorks')));
    return block('repeat-exam', 'repeat.exam.title', ...parts);
  }
  if (card.result.admitted !== true) {
    parts.push(el('p', { class: 'muted', id: 'repeat-exam-no' }, t('repeat.exam.notAdmitted')));
    return block('repeat-exam', 'repeat.exam.title', ...parts);
  }
  parts.push(lines.length === 0
    ? el('p', { class: 'muted', id: 'repeat-exam-none' }, t('repeat.exam.none'))
    : el('ul', { class: 'rp-tries', id: 'repeat-exam-list', 'aria-label': t('repeat.exam.list') }, lines.map((line) => el('li', { class: 'rp-try' },
      el('span', { class: 'rp-try__date' }, dayOf(line.date).slice(0, 5)),
      el('span', { class: 'rp-try__label' }, t(line.label.key, line.label.params)),
      el('span', { class: 'rp-try__result' }, line.result.key ? t(line.result.key) : line.result.text),
      target && target.no === line.no
        ? el('button', { type: 'button', class: 'button button--secondary button--small', id: 'repeat-attempt-fix', onclick: () => openAttempt(card, target) }, t('repeat.exam.fix'))
        : null,
      line.commission ? el('span', { class: 'rp-try__commission' }, t('repeat.exam.commission', { text: line.commission })) : null))));
  if (form && form.canEnter) {
    const label = form.retake ? t(nextLabel({ retake: true, commission: form.commission }).key) : t('repeat.exam.enter');
    parts.push(el('div', { class: 'rp-block__actions' },
      el('button', { type: 'button', class: 'button button--primary', id: 'repeat-attempt-add', onclick: () => openAttempt(card, null) }, label)));
  } else if (form && form.commission && card.can.attempt) {
    parts.push(el('p', { class: 'muted', id: 'repeat-exam-deanery' }, t('repeat.exam.byDeanery')));
  }
  return block('repeat-exam', 'repeat.exam.title', ...parts);
}

// The window of a sitting: a new one (target is null) or the correction of the last one (with a reason).
function openAttempt(card, target) {
  const owner = state;
  const form = attemptForm(card);
  if (!target && !form) return;
  const withCommission = target ? Boolean(target.commission) : form.commission;
  const maxScore = card.split.exam;
  const mode0 = target ? target.outcome : 'score';
  let busy = false;
  const dateInput = el('input', { type: 'date', class: 'field__input', id: 'repeat-attempt-date', name: 'date', value: target ? target.date : card.today });
  const date = fieldBox({ id: 'repeat-attempt-date', label: t('repeat.attempt.date'), hint: t('repeat.attempt.dateHint'), control: dateInput });
  const select = el('select', { class: 'field__input lg-ex-mode', id: 'repeat-attempt-mode' },
    MODES.map((mode) => el('option', { value: mode }, mode === 'score' ? t('ledger.exam.modeScore') : t(mode === 'absent' ? 'ledger.exam.absent' : 'ledger.exam.incomplete'))));
  select.value = mode0;
  const score = el('input', {
    type: 'text', inputmode: 'numeric', id: 'repeat-attempt-score', class: 'field__input lg-ex-input', maxlength: '3', autocomplete: 'off',
    value: target && target.score !== null && target.score !== undefined ? String(target.score) : '', 'aria-label': t('repeat.works.hint', { max: maxScore }),
  });
  score.hidden = mode0 !== 'score';
  const result = fieldBox({
    id: 'repeat-attempt-result', label: t('repeat.attempt.result'), hint: t('repeat.works.hint', { max: maxScore }),
    control: el('div', { class: 'lg-ex-control' }, score, select), input: score,
  });
  select.addEventListener('change', () => { score.hidden = select.value !== 'score'; result.set(null); if (!score.hidden) score.focus(); });
  score.addEventListener('input', () => result.set(null));
  dateInput.addEventListener('input', () => date.set(null));
  let commission = null;
  let commissionInput = null;
  if (withCommission) {
    commissionInput = textArea('repeat-attempt-commission', 'commission', 2, target ? target.commission : '');
    commission = fieldBox({ id: 'repeat-attempt-commission', label: t('repeat.attempt.commission'), hint: t('repeat.attempt.commissionHint'), control: commissionInput });
    commissionInput.addEventListener('input', () => commission.set(null));
  }
  let reasonInput = null;
  let reason = null;
  if (target) {
    reasonInput = textArea('repeat-attempt-reason', 'reason', 2);
    reason = fieldBox({ id: 'repeat-attempt-reason', label: t('repeat.attempt.reason'), hint: t('repeat.attempt.reasonHint'), control: reasonInput });
    reasonInput.addEventListener('input', () => reason.set(null));
  }
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-attempt-confirm' }, t('repeat.attempt.confirm'));
  const boxes = { date, score: result, outcome: result, commission, reason };
  confirm.addEventListener('click', async () => {
    if (busy) return;
    problem.replaceChildren();
    for (const box of [date, result, commission, reason]) box?.set(null);
    const outcome = select.value;
    const text = score.value.trim();
    if (outcome === 'score' && !(/^\d{1,3}$/.test(text) && Number(text) <= maxScore)) {
      result.set(t('repeat.error.score.bad_value', { max: maxScore }));
      score.focus();
      return;
    }
    busy = true;
    markBusy(confirm, 'repeat.attempt.busy');
    const body = { repeatId: card.id, date: dateInput.value, outcome, score: outcome === 'score' ? Number(text) : null };
    if (commissionInput) body.commission = commissionInput.value.trim();
    if (target) Object.assign(body, { no: target.no, reason: reasonInput.value });
    try {
      const data = await call('repeat.saveAttempt', body);
      if (state !== owner) return;
      take(owner, data);
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      resetBusy(confirm, 'repeat.attempt.confirm');
      const loose = problemsOf(error, boxes, { max: maxScore });
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  const dialog = dialogShell('repeat-attempt-dialog', () => focusById('repeat-attempt-add', 'repeat-attempt-fix', 'repeat-finish-close'), 'rp-dialog',
    el('h2', { class: 'dialog__title', id: 'repeat-attempt-dialog-title' }, t(target ? 'repeat.attempt.fixTitle' : 'repeat.attempt.title')),
    date.root, result.root, commission ? commission.root : null, reason ? reason.root : null, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-attempt-cancel', onclick: () => dialog.close() }, t('common.cancel')),
      confirm));
  focusById('repeat-attempt-score');
}

// ---- «Итог и закрытие» ----

function finishBlock(card) {
  if (card.status === 'cancelled') return null;
  // A card of the whole subject without works yet is not «не допущен»: nothing to show until the works are entered.
  const total = card.kind === 'full' && card.works.value === null ? null : totalLine(card);
  const info = closeNote(card);
  const open = card.status === 'open';
  const showNote = info !== null && (!open || card.can.close === true);
  const max = card.split.semester + card.split.exam;
  const prev = card.prev.total === null || card.prev.total === undefined ? null : el('p', { class: 'rp-finish__prev', id: 'repeat-finish-prev' }, t('repeat.finish.prev', { total: card.prev.total, max }));
  const buttons = [
    open && canClose(card) ? el('button', { type: 'button', class: 'button button--primary', id: 'repeat-finish-close', onclick: () => openClose(card) }, t('repeat.close.open')) : null,
    card.can.reopen ? el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-reopen', onclick: () => openReopen(card) }, t('repeat.reopen.open')) : null,
  ].filter(Boolean);
  return block('repeat-finish', 'repeat.finish.title',
    total
      ? el('div', { class: 'rp-finish__total', id: 'repeat-finish-total' },
        el('span', { class: 'rp-finish__label' }, t('repeat.finish.total')),
        el('span', { class: 'rp-finish__value' }, t(total.key, total.params), total.word ? badge(t('journal.grade.' + total.word), wordTone(total.word)) : null))
      : el('p', { class: 'muted', id: 'repeat-finish-wait' }, t('repeat.finish.wait')),
    prev,
    showNote ? note(NOTE_KIND[info.tone], t(info.key, info.params), { id: 'repeat-close-note' }) : null,
    buttons.length > 0 ? el('div', { class: 'rp-block__actions' }, ...buttons) : null);
}

function openClose(card) {
  const owner = state;
  const left = card.close.retakesLeft === true;
  const forced = card.close.blocking.length > 0;
  let busy = false;
  const tick = el('input', { type: 'checkbox', class: 'check__input', id: 'repeat-close-accept' });
  const tickError = el('p', { class: 'field__error', id: 'repeat-close-accept-error', hidden: true });
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-close-confirm' }, t('repeat.close.confirm'));
  tick.addEventListener('change', () => { tickError.hidden = true; tick.removeAttribute('aria-invalid'); });
  confirm.addEventListener('click', async () => {
    if (busy) return;
    problem.replaceChildren();
    if (left && !tick.checked) {
      tickError.replaceChildren(icon('alert'), t('repeat.error.acceptFail.required'));
      tickError.hidden = false;
      tick.setAttribute('aria-invalid', 'true');
      tick.focus();
      return;
    }
    busy = true;
    markBusy(confirm, 'repeat.close.busy');
    try {
      const data = await call('repeat.close', { repeatId: card.id, ...(left ? { acceptFail: true } : {}) });
      if (state !== owner) return;
      take(owner, data);
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      resetBusy(confirm, 'repeat.close.confirm');
      problem.replaceChildren(note('error', problemsOf(error, {}, {}), { role: 'alert' }));
    }
  });
  const dialog = dialogShell('repeat-close-dialog', () => focusById('repeat-finish-close', 'repeat-reopen'), 'dialog--confirm',
    el('h2', { class: 'dialog__title', id: 'repeat-close-dialog-title' }, t('repeat.close.title')),
    el('p', { class: 'rp-close__result', id: 'repeat-close-result' }, t('repeat.close.result.' + card.close.outcome)),
    left ? note('warning', t('repeat.close.retakesLeft'), { id: 'repeat-close-left' }) : null,
    forced ? note('warning', t('repeat.close.forced'), { id: 'repeat-close-forced' }) : null,
    left ? el('div', { class: 'field' }, el('div', { class: 'check' }, tick, el('label', { class: 'check__label', for: 'repeat-close-accept' }, t('repeat.close.accept'))), tickError) : null,
    problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-close-keep', onclick: () => dialog.close() }, t('repeat.close.keep')),
      confirm));
  focusById(left ? 'repeat-close-accept' : 'repeat-close-confirm');
}

function openReopen(card) {
  const owner = state;
  let busy = false;
  const reasonInput = textArea('repeat-reopen-reason', 'reason', 3);
  const reason = fieldBox({ id: 'repeat-reopen-reason', label: t('repeat.reopen.reason'), hint: t('repeat.attempt.reasonHint'), control: reasonInput });
  reasonInput.addEventListener('input', () => reason.set(null));
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-reopen-confirm' }, t('repeat.reopen.confirm'));
  confirm.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    problem.replaceChildren();
    reason.set(null);
    markBusy(confirm, 'repeat.reopen.busy');
    try {
      const data = await call('repeat.reopen', { repeatId: card.id, reason: reasonInput.value });
      if (state !== owner) return;
      take(owner, data);
      dialog.close();
      refresh();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      resetBusy(confirm, 'repeat.reopen.confirm');
      const loose = problemsOf(error, { reason }, {});
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  const dialog = dialogShell('repeat-reopen-dialog', () => focusById('repeat-reopen', 'repeat-finish-close'), 'dialog--confirm',
    el('h2', { class: 'dialog__title', id: 'repeat-reopen-dialog-title' }, t('repeat.reopen.title')),
    el('p', {}, t('repeat.reopen.text')),
    reason.root, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-reopen-keep', onclick: () => dialog.close() }, t('repeat.reopen.keep')),
      confirm));
  focusById('repeat-reopen-reason');
}

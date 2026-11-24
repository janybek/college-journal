import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, badge, focusById, focusFirstInvalid, holdOnLeave, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import {
  examDraft, examItems, examNeedsReason, finalNote, attemptLines, nextLabel, wordCounts, wordTone,
} from '../ledger.js';

// The exam part of the ledger screen: the head of the exam, entering the results of the first sitting, closing the final
// sheet and the new tries after it. Every number and word that is counted is the server's: the screen sends what the person
// typed and draws the answer. Names, examiners, assistants and commissions are only ever text.

const REASON_MAX = 300;
const MODES = ['score', 'absent', 'incomplete'];

// The unsaved work of this ledger. `base` is the ledger it was made from: a new answer of the server starts it afresh.
let edit = null;
let leavePromise = null;

export function reset() {
  if (edit && edit.holding) holdOnLeave(null);
  edit = null;
}

const dayShort = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}` : '');
const dayFull = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');
const firstTry = (student) => student.attempts.find((a) => a.no === 1);
const hasRetake = (student) => student.attempts.some((a) => a.no > 1);
const modeOf = (text) => (text === 'absent' || text === 'incomplete' ? text : 'score');

const params = (view) => ({ max: view.split.exam, from: dayShort(view.examWeek.start), to: dayShort(view.examWeek.end) });

// The text of an error at a field: the most specific key that exists.
function fieldMessage(view, field, code) {
  for (const key of [`ledger.exam.error.${field}.${code}`, `ledger.exam.error.${code}`]) if (hasText(key)) return t(key, params(view));
  if (field === 'reason') return t(code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required');
  return t(errorKey(code));
}

// A labelled control with a hint and an error line that is shown and cleared in place (no redraw: the caret stays).
function fieldBox({ id, label, hint = null, control, input = control, labelFor = id, hintAfter = false }) {
  const error = el('p', { class: 'field__error', id: id + '-error', hidden: true });
  const hintId = hint ? id + '-hint' : null;
  const root = el('div', { class: 'field' },
    el('label', { class: 'field__label', for: labelFor }, label),
    hint && !hintAfter ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    el('div', { class: 'field__control' }, control),
    hint && hintAfter ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    error);
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
  if (hintId) input.setAttribute('aria-describedby', hintId);
  return { root, set, input };
}

// ---- The unsaved state ----

function editOf(view, host) {
  if (edit && edit.owner === host.owner && edit.base === view) return edit;
  if (edit && edit.holding) holdOnLeave(null);
  edit = {
    owner: host.owner, base: view, results: false, busy: false, holding: false, reason: '',
    head: { date: view.exam.date, examiner: view.exam.examiner, assistants: view.exam.assistants },
    draft: examDraft(view.students),
    ui: { date: null, examiner: null, assistants: null, reason: null, reasonBox: null, problem: null, students: new Map() },
  };
  return edit;
}

function changes(view, e) {
  const { items, bad } = e.results ? examItems(e.draft, view.students, view.split) : { items: [], bad: [] };
  return { items, bad, needsReason: examNeedsReason(items, view.students) };
}

function headChanged(view, e) {
  return e.head.date !== view.exam.date || e.head.examiner.trim() !== view.exam.examiner || e.head.assistants.trim() !== view.exam.assistants;
}

function isDirty(view, e) {
  const { items, bad } = changes(view, e);
  return headChanged(view, e) || items.length > 0 || bad.length > 0;
}

// The leave guard: with unsaved work, going away asks first.
function syncHold(view, e) {
  const dirty = isDirty(view, e);
  if (dirty && !e.holding) { e.holding = true; holdOnLeave(askLeave); }
  if (!dirty && e.holding) { e.holding = false; holdOnLeave(null); }
}

function askLeave() {
  if (leavePromise) return leavePromise;
  leavePromise = new Promise((resolve) => {
    let agreed = false;
    const dialog = modal({
      id: 'ledger-leave-dialog', labelledBy: 'ledger-leave-title', className: 'dialog--confirm',
      onClose: () => { dialog.remove(); leavePromise = null; if (agreed && edit) edit.holding = false; if (agreed) holdOnLeave(null); resolve(agreed); },
    },
    el('h2', { class: 'dialog__title', id: 'ledger-leave-title' }, t('ledger.exam.leave')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'ledger-leave-stay', onclick: () => dialog.close() }, t('ledger.exam.stay')),
      el('button', { type: 'button', class: 'button button--primary', id: 'ledger-leave-go', onclick: () => { agreed = true; dialog.close(); } }, t('ledger.exam.go'))));
    document.body.append(dialog);
    dialog.showModal();
    focusById('ledger-leave-stay');
  });
  return leavePromise;
}

// ---- The section under the grid ----

export function examSection(view, host) {
  const e = editOf(view, host);
  const ready = view.exam.ready;
  const parts = [el('div', { class: 'lg-exam__top' },
    el('h2', { class: 'lg-exam__title', id: 'ledger-exam-title' }, t('ledger.exam.title')),
    closeControl(view, host))];
  if (!ready) {
    parts.push(el('p', { class: 'lg-exam__wait', id: 'ledger-exam-wait' }, t('ledger.exam.notReady')));
  } else {
    parts.push(facts(view), headBlock(view, e, host));
    if (view.can.exam && !view.final.closed) parts.push(actions(view, e, host));
  }
  return el('section', { class: 'card lg-exam', id: 'ledger-exam', 'aria-labelledby': 'ledger-exam-title' }, parts);
}

function facts(view) {
  const { subject } = view;
  const items = [
    ['ledger.exam.subject', subject.name],
    ['ledger.exam.group', subject.groupName],
    subject.course !== null ? ['ledger.exam.course', String(subject.course)] : null,
    ['ledger.exam.semester', String(subject.planSemester ?? subject.semester)],
  ].filter(Boolean);
  return el('dl', { class: 'lg-exam__facts' }, items.map(([key, value]) => el('div', { class: 'lg-exam__fact' }, el('dt', {}, t(key)), el('dd', {}, value || '—'))));
}

function headBlock(view, e, host) {
  const editable = view.can.exam && !view.final.closed;
  if (!editable) {
    const { exam, subject } = view;
    return el('dl', { class: 'lg-exam__facts lg-exam__facts--head', id: 'ledger-exam-head' },
      [
        ['ledger.exam.date', exam.date ? dayFull(exam.date) : t('ledger.exam.noDate')],
        ['ledger.exam.examiner', exam.examiner || subject.teacherName || '—'],
        exam.assistants ? ['ledger.exam.assistants', exam.assistants] : null,
      ].filter(Boolean).map(([key, value]) => el('div', { class: 'lg-exam__fact' }, el('dt', {}, t(key)), el('dd', {}, value))));
  }

  const week = view.examWeek;
  const strict = view.exam.strict && week.start && week.end;
  const dateInput = el('input', { type: 'date', id: 'ledger-exam-date', class: 'field__input', value: e.head.date, name: 'date' });
  const date = fieldBox({ id: 'ledger-exam-date', label: t('ledger.exam.date'), hint: strict ? t('ledger.exam.strict', params(view)) : null, control: dateInput, hintAfter: true });
  const examinerInput = el('input', {
    type: 'text', id: 'ledger-exam-examiner', class: 'field__input', value: e.head.examiner, name: 'examiner', maxlength: '120',
    placeholder: view.subject.teacherName || null, autocomplete: 'off',
  });
  const examiner = fieldBox({ id: 'ledger-exam-examiner', label: t('ledger.exam.examiner'), hint: t('ledger.exam.examinerHint'), control: examinerInput, hintAfter: true });
  const assistantsInput = el('input', { type: 'text', id: 'ledger-exam-assistants', class: 'field__input', value: e.head.assistants, name: 'assistants', maxlength: '300', autocomplete: 'off' });
  const assistants = fieldBox({ id: 'ledger-exam-assistants', label: t('ledger.exam.assistants'), control: assistantsInput });
  e.ui.date = date;
  e.ui.examiner = examiner;
  e.ui.assistants = assistants;
  const bind = (input, box, key) => input.addEventListener('input', () => {
    e.head[key] = input.value;
    box.set(null);
    syncHold(view, e);
  });
  bind(dateInput, date, 'date');
  bind(examinerInput, examiner, 'examiner');
  bind(assistantsInput, assistants, 'assistants');
  return el('div', { class: 'lg-exam__head', id: 'ledger-exam-head' }, date.root, examiner.root, assistants.root);
}

function actions(view, e, host) {
  const reasonArea = el('textarea', {
    id: 'ledger-exam-reason', name: 'reason', class: 'field__input field__textarea', rows: '2', maxlength: String(REASON_MAX), 'aria-required': 'true',
  });
  reasonArea.value = e.reason;
  const reason = fieldBox({ id: 'ledger-exam-reason', label: t('ledger.exam.reason'), hint: t('ledger.exam.reasonHint'), control: reasonArea });
  reason.root.hidden = !changes(view, e).needsReason;
  reasonArea.addEventListener('input', () => { e.reason = reasonArea.value; reason.set(null); });
  e.ui.reason = reason;
  e.ui.reasonBox = reason.root;
  const problem = el('div', { class: 'mk-problem', id: 'ledger-exam-problem' });
  e.ui.problem = problem;

  const save = el('button', {
    type: 'button', class: 'button button--primary', id: 'ledger-exam-save',
    'aria-disabled': e.busy ? 'true' : null,
  }, t(e.results ? 'ledger.exam.save' : 'ledger.exam.saveHead'));
  save.addEventListener('click', () => submit(view, e, host, save));
  if (e.busy) markBusy(save, 'ledger.exam.saving');

  const buttons = [];
  if (!e.results) {
    buttons.push(el('button', {
      type: 'button', class: 'button button--primary', id: 'ledger-exam-enter',
      onclick: () => { e.results = true; host.redraw(); focusById(firstInputId(view)); },
    }, t('ledger.exam.enter')));
    save.classList.replace('button--primary', 'button--secondary');
    buttons.push(save);
  } else {
    buttons.push(save, el('button', {
      type: 'button', class: 'button button--secondary', id: 'ledger-exam-cancel',
      onclick: () => {
        if (e.busy) return;
        e.results = false;
        e.draft = examDraft(view.students);
        e.reason = '';
        syncHold(view, e);
        host.redraw();
        focusById('ledger-exam-enter');
      },
    }, t('common.cancel')));
  }
  return el('div', { class: 'lg-exam__actions' }, reason.root, problem, el('div', { class: 'lg-exam__buttons' }, buttons));
}

function firstInputId(view) {
  const first = view.students.find((s) => s.admitted === true && !s.left && !hasRetake(s));
  return first ? 'ledger-exam-in-' + first.id : null;
}

// Saves the head and the changed results in one request; the errors are drawn where they belong, in place.
async function submit(view, e, host, button) {
  if (e.busy) return;
  const ui = e.ui;
  const { items, bad, needsReason } = changes(view, e);
  ui.problem.replaceChildren();
  for (const box of [ui.date, ui.examiner, ui.assistants, ui.reason]) box?.set(null);
  for (const spot of ui.students.values()) spot.set(null);

  if (bad.length > 0) {
    for (const id of bad) ui.students.get(id)?.set(fieldMessage(view, 'score', 'bad_value'));
    focusFirstInvalid();
    return;
  }
  const reason = e.reason.trim();
  if (needsReason && (reason === '' || reason.length > REASON_MAX)) {
    ui.reason.set(fieldMessage(view, 'reason', reason === '' ? 'required' : 'too_long'));
    ui.reasonBox.hidden = false;
    focusFirstInvalid();
    return;
  }

  e.busy = true;
  markBusy(button, 'ledger.exam.saving');
  const sent = items.map((i) => i.studentId);
  try {
    const data = await call('ledger.saveExam', {
      subjectId: view.subject.id, date: e.head.date, examiner: e.head.examiner.trim(), assistants: e.head.assistants.trim(),
      items, ...(needsReason ? { reason } : {}),
    });
    if (!host.apply(data.ledger)) return;
    if (e.holding) { e.holding = false; holdOnLeave(null); }
    edit = null;
    host.redraw();
    focusById('ledger-exam-enter', 'ledger-exam');
  } catch (error) {
    if (!host.alive() || edit !== e) return;
    e.busy = false;
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-disabled');
    button.classList.remove('is-busy');
    button.textContent = t(e.results ? 'ledger.exam.save' : 'ledger.exam.saveHead');
    showServerError(view, e, error, sent);
  }
}

function showServerError(view, e, error, sent) {
  const ui = e.ui;
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  if (fields.length === 0) {
    ui.problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    return;
  }
  let loose = null;
  for (const { index, field, code } of fields) {
    const text = fieldMessage(view, field, code);
    const id = Number.isInteger(index) ? sent[index] : undefined;
    if (id !== undefined && ui.students.has(id)) ui.students.get(id).set(text);
    else if (field === 'date' || field === 'examiner' || field === 'assistants') ui[field].set(text);
    else if (field === 'reason') { ui.reasonBox.hidden = false; ui.reason.set(text); } else loose = loose || text;
  }
  if (loose) ui.problem.replaceChildren(note('error', loose, { role: 'alert' }));
  focusFirstInvalid();
}

// ---- The exam column of the grid ----

// The cell of the exam column while the results are entered; null: the usual cell.
export function examTd(view, student, host) {
  const e = editOf(view, host);
  if (!e.results || view.final.closed || !view.can.exam || student.left || hasRetake(student)) return null;
  if (student.admitted !== true) return el('td', { class: 'lg-sum lg-ex-cell' }, el('span', { class: 'lg-ex-none' }, t('ledger.exam.notAdmitted')));

  const id = 'ledger-exam-in-' + student.id;
  const text = e.draft.get(student.id) ?? '';
  const input = el('input', {
    type: 'text', inputmode: 'numeric', id, class: 'field__input lg-ex-input', maxlength: '3', autocomplete: 'off',
    value: modeOf(text) === 'score' ? text : '', hidden: modeOf(text) !== 'score',
    'aria-label': t('ledger.exam.scoreOf', { name: student.fullName, max: view.split.exam }),
  });
  const select = el('select', { class: 'field__input lg-ex-mode', id: id + '-mode', 'aria-label': t('ledger.exam.modeOf', { name: student.fullName }) },
    MODES.map((mode) => el('option', { value: mode }, mode === 'score' ? t('ledger.exam.modeScore') : t(mode === 'absent' ? 'ledger.exam.absent' : 'ledger.exam.incomplete'))));
  select.value = modeOf(text);
  const error = el('p', { class: 'lg-ex-error', id: id + '-error', hidden: true });
  const spot = {
    set(message) {
      if (message === null) { error.hidden = true; error.replaceChildren(); input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); return; }
      error.replaceChildren(icon('alert'), message);
      error.hidden = false;
      input.hidden = false;
      select.value = 'score';
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
    },
  };
  e.ui.students.set(student.id, spot);

  const touched = () => {
    spot.set(null);
    e.ui.reasonBox.hidden = !changes(view, e).needsReason;
    syncHold(view, e);
  };
  input.addEventListener('input', () => { e.draft.set(student.id, input.value.trim()); touched(); });
  select.addEventListener('change', () => {
    const mode = select.value;
    input.hidden = mode !== 'score';
    e.draft.set(student.id, mode === 'score' ? input.value.trim() : mode);
    touched();
    if (mode === 'score') input.focus();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...document.querySelectorAll('.lg-ex-input')].filter((node) => !node.hidden);
    const at = all.indexOf(input);
    const target = all[at + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target) { target.focus(); target.select(); }
  });
  return el('td', { class: 'lg-sum lg-ex-cell' }, el('div', { class: 'lg-ex-control' }, input, select), error);
}

// ---- The row under a student: the tries so far and the button of the next one ----

export function studentExtra(view, student, columns, host) {
  const lines = student.attempts.length > 1 ? attemptLines(student.attempts) : [];
  const label = view.final.closed && view.can.exam && !student.left && student.next && (!student.next.commission || view.can.commission) ? nextLabel(student.next) : null;
  if (lines.length === 0 && !label) return null;
  const history = lines.length === 0 ? null : el('ul', { class: 'lg-hist', 'aria-label': t('ledger.attempt.history') },
    lines.map((line) => el('li', { class: 'lg-hist__item', title: line.commission ? t('ledger.attempt.commissionTip', { text: line.commission }) : null },
      el('span', { class: 'lg-hist__date' }, dayShort(line.date)),
      el('span', { class: 'lg-hist__label' }, t(line.label.key, line.label.params)),
      el('span', { class: 'lg-hist__result' }, line.result.key ? t(line.result.key) : line.result.text))));
  const button = label ? el('button', {
    type: 'button', class: 'button button--secondary button--small', id: 'ledger-attempt-' + student.id,
    onclick: () => openAttempt(view, student, host),
  }, t(label.key)) : null;
  return el('tr', { class: 'lg-sub' }, el('td', { colspan: String(columns) }, el('div', { class: 'lg-sub__body' }, history, button)));
}

// ---- A new try after the final sheet is closed ----

function openAttempt(view, student, host) {
  const { next } = student;
  const retake = next.retake;
  let busy = false;
  const dateInput = el('input', { type: 'date', id: 'ledger-attempt-date', class: 'field__input', value: view.today, name: 'date' });
  const date = fieldBox({ id: 'ledger-attempt-date', label: t('ledger.attempt.date'), hint: t(retake ? 'ledger.attempt.dateHint' : 'ledger.attempt.dateHintFirst'), control: dateInput });
  const select = el('select', { class: 'field__input lg-ex-mode', id: 'ledger-attempt-mode' },
    MODES.map((mode) => el('option', { value: mode }, mode === 'score' ? t('ledger.exam.modeScore') : t(mode === 'absent' ? 'ledger.exam.absent' : 'ledger.exam.incomplete'))));
  const score = el('input', {
    type: 'text', inputmode: 'numeric', id: 'ledger-attempt-score', class: 'field__input lg-ex-input', maxlength: '3', autocomplete: 'off',
    'aria-label': t('ledger.exam.scoreOf', { name: student.fullName, max: view.split.exam }),
  });
  const result = fieldBox({ id: 'ledger-attempt-result', label: t('ledger.attempt.result'), control: el('div', { class: 'lg-ex-control' }, score, select), input: score, labelFor: 'ledger-attempt-mode' });
  select.addEventListener('change', () => { score.hidden = select.value !== 'score'; result.set(null); if (!score.hidden) score.focus(); });
  score.addEventListener('input', () => result.set(null));
  dateInput.addEventListener('input', () => date.set(null));
  let commission = null;
  let commissionInput = null;
  if (next.commission) {
    commissionInput = el('textarea', { id: 'ledger-attempt-commission', name: 'commission', class: 'field__input field__textarea', rows: '2', maxlength: '300' });
    commission = fieldBox({ id: 'ledger-attempt-commission', label: t('ledger.attempt.commissionField'), hint: t('ledger.attempt.commissionHint'), control: commissionInput });
    commissionInput.addEventListener('input', () => commission.set(null));
  }
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', { type: 'button', class: 'button button--primary', id: 'ledger-attempt-confirm' }, t('ledger.attempt.confirm'));

  const spots = { date, score: result, outcome: result, commission };
  confirm.addEventListener('click', async () => {
    if (busy) return;
    problem.replaceChildren();
    for (const box of [date, result, commission]) box?.set(null);
    const outcome = select.value;
    const text = score.value.trim();
    if (outcome === 'score' && !(/^\d{1,3}$/.test(text) && Number(text) <= view.split.exam)) {
      result.set(fieldMessage(view, 'score', 'bad_value'));
      score.focus();
      return;
    }
    busy = true;
    markBusy(confirm, 'ledger.attempt.busy');
    try {
      const data = await call('ledger.addAttempt', {
        subjectId: view.subject.id, studentId: student.id, date: dateInput.value, outcome, score: outcome === 'score' ? Number(text) : null,
        ...(next.commission ? { commission: commissionInput.value.trim() } : {}),
      });
      if (!host.apply(data.ledger)) return;
      dialog.close();
      host.redraw();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.removeAttribute('aria-disabled');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('ledger.attempt.confirm');
      const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
      let loose = fields.length === 0 ? t(errorKey(error.code)) : null;
      for (const { field, code } of fields) {
        const spot = spots[field];
        if (spot) spot.set(fieldMessage(view, field, code)); else loose = loose || fieldMessage(view, field, code);
      }
      if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
      focusFirstInvalid();
    }
  });
  const dialog = host.dialogShell('ledger-attempt-dialog', () => focusById('ledger-attempt-' + student.id, 'ledger-grid'), () => !busy,
    el('h2', { class: 'dialog__title', id: 'ledger-attempt-dialog-title' }, t('ledger.attempt.title', { name: student.fullName })),
    date.root, result.root, commission ? commission.root : null, problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'ledger-attempt-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
      confirm));
  focusById('ledger-attempt-date');
}

// ---- Closing the final sheet ----

// Above the exam part: the button, or the reason it is not there yet.
function closeControl(view, host) {
  const { final } = view;
  if (final.closed || !view.can.close || !view.exam.ready) return null;
  const stop = finalNote(final);
  if (stop) return el('p', { class: 'lg-exam__stop', id: 'ledger-final-stop' }, icon('clock'), t(stop.key, stop.params));
  const early = final.early === true;
  const button = el('button', {
    type: 'button', class: 'button button--primary', id: 'ledger-final-close', 'aria-disabled': early ? 'true' : null,
    'aria-describedby': early ? 'ledger-final-early' : null,
    onclick: () => { if (!early) openCloseFinal(view, host); },
  }, t('ledger.final.close'));
  return el('div', { class: 'lg-exam__close' }, button,
    early ? el('span', { class: 'lg-exam__stop', id: 'ledger-final-early' }, t('ledger.final.early', { date: dayShort(view.examWeek.start) })) : null);
}

// The chips of the words of the group (the line above the grid and the summary in the closing window).
export function countsList(students, id) {
  const counts = wordCounts(students);
  const chips = [];
  for (const word of ['excellent', 'good', 'fair', 'fail']) if (counts[word] > 0) chips.push([t('journal.grade.' + word), counts[word], wordTone(word)]);
  for (const [key, tone] of [['absent', 'danger'], ['incomplete', 'warning'], ['notAdmitted', 'danger']]) {
    if (counts[key] > 0) chips.push([t('ledger.count.' + key), counts[key], tone]);
  }
  if (chips.length === 0) return null;
  return el('ul', { class: 'lg-counts', id, 'aria-label': t('ledger.counts.label') }, chips.map(([text, n, tone]) => el('li', {}, badge(`${text}: ${n}`, tone))));
}

function openCloseFinal(view, host) {
  let busy = false;
  const e = edit && edit.owner === host.owner && edit.base === view ? edit : null;
  const unsaved = e !== null && isDirty(view, e);
  const problem = el('div', { class: 'mk-problem' });
  const confirm = el('button', {
    type: 'button', class: 'button button--primary', id: 'ledger-final-confirm', 'aria-disabled': unsaved ? 'true' : null,
  }, t('ledger.final.closeConfirm'));
  confirm.addEventListener('click', async () => {
    if (busy || confirm.getAttribute('aria-disabled') === 'true') return;
    busy = true;
    problem.replaceChildren();
    markBusy(confirm, 'ledger.final.closeBusy');
    try {
      const data = await call('ledger.closeFinal', { subjectId: view.subject.id });
      if (!host.apply(data.ledger)) return;
      dialog.close();
      host.redraw();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      confirm.removeAttribute('aria-busy');
      confirm.removeAttribute('aria-disabled');
      confirm.classList.remove('is-busy');
      confirm.textContent = t('ledger.final.closeConfirm');
      const first = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields[0] : null;
      const text = first && first.field === 'final' && hasText('ledger.final.block.' + first.code)
        ? t('ledger.final.block.' + first.code, { n: first.n ?? 0 })
        : t(errorKey(error.code));
      problem.replaceChildren(note('error', text, { role: 'alert' }));
    }
  });
  const dialog = host.dialogShell('ledger-final-dialog', () => focusById('ledger-final-close', 'ledger-exam'), () => !busy,
    el('h2', { class: 'dialog__title', id: 'ledger-final-dialog-title' }, t('ledger.final.closeTitle')),
    el('p', { class: 'lg-dialog__text' }, t('ledger.final.closeBody')),
    countsList(view.students, 'ledger-final-counts'),
    unsaved ? el('p', { class: 'lg-dialog__text lg-dialog__warn', id: 'ledger-final-unsaved' }, t('ledger.final.unsaved')) : null,
    problem,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'ledger-final-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
      confirm));
  focusById('ledger-final-confirm');
}

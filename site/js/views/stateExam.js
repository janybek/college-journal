import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, badge, emptyState, focusById, focusFirstInvalid, holdOnLeave, markBusy, modal, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { scoreDraft, scoreItems, scoresNeedReason, scoreWord, wordTone, examSummary, SCORE_MAX } from '../ledger.js';
import { stateExamSheet, stateExamBook, stateExamFileName } from '../ledgerFile.js';
import { sheetTools, textLabels } from './ledgerExam.js';

// The sheet of a state exam (#/state-exam/<examId>, stateExam.get): the students of the group with the score and the word. The
// deanery enters the scores in the column of the scores (the word follows on the fly, by the thresholds of the answer) and saves
// only what changed; changing a score that was there asks for a reason. The teacher and the vice-rector only read, print and
// download. Every number and word that is counted is the server's. Names are only ever text.

const REASON_MAX = 300;

const blank = (examId = null) => ({
  examId,
  data: null,          // the sheet of the answer; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
  saved: false,        // the scores were just saved: a line says so until the next redraw for another reason
  edit: null,          // the scores being entered: { base, draft, reason, busy, holding, ui }
});
let state = blank();
let leavePromise = null;

export function leave() {
  if (state.edit && state.edit.holding) holdOnLeave(null);
  document.getElementById('state-exam-leave-dialog')?.remove();
  leavePromise = null;
  state = blank();
}

const dayFull = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : '');

export function render(root, params) {
  if (state.examId !== params.examId) { leave(); state = blank(params.examId); }
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const view = state.data;
  const header = pageHeader({
    id: 'state-exam-title',
    title: view ? view.exam.name : t('stateExam.title'),
    lead: view ? `${t('stateExam.facts.group')}: ${view.exam.groupName || '—'} · ${t('stateExam.facts.date')}: ${dayFull(view.exam.date)}` : null,
    actions: el('a', { class: 'button button--secondary', id: 'state-exam-back', href: '#/state-exams' }, t('stateExam.back')),
  });
  header.classList.add('no-print');
  root.append(header, view === null ? loadingBody() : body(view));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('stateExam.get', { examId: owner.examId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code || 'internal';
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.errorCode = null;
  load();
  refresh();
}

function loadingBody() {
  const code = state.errorCode;
  if (code === null) return el('p', { class: 'loading' }, t('stateExam.loading'));
  const back = el('a', { class: 'button button--secondary', href: '#/state-exams' }, t('stateExam.back'));
  const failure = emptyState('alert', el('p', {}, t(code === 'not_found' ? 'stateExam.notFound' : errorKey(code))),
    code === 'not_found' || code === 'forbidden' ? back
      : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

// ---- The unsaved scores ----

const changes = (view, e) => {
  const { items, bad } = scoreItems(e.draft, view.students);
  return { items, bad, needsReason: scoresNeedReason(items, view.students) };
};

function syncHold(view, e) {
  const { items, bad } = changes(view, e);
  const dirty = items.length > 0 || bad.length > 0;
  if (dirty && !e.holding) { e.holding = true; holdOnLeave(askLeave); }
  if (!dirty && e.holding) { e.holding = false; holdOnLeave(null); }
}

function askLeave() {
  if (leavePromise) return leavePromise;
  leavePromise = new Promise((resolve) => {
    let agreed = false;
    const dialog = modal({
      id: 'state-exam-leave-dialog', labelledBy: 'state-exam-leave-title', className: 'dialog--confirm',
      onClose: () => {
        dialog.remove();
        leavePromise = null;
        if (agreed) { if (state.edit) state.edit.holding = false; holdOnLeave(null); }
        resolve(agreed);
      },
    },
    el('h2', { class: 'dialog__title', id: 'state-exam-leave-title' }, t('stateExam.leave')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', id: 'state-exam-leave-stay', onclick: () => dialog.close() }, t('stateExam.stay')),
      el('button', { type: 'button', class: 'button button--primary', id: 'state-exam-leave-go', onclick: () => { agreed = true; dialog.close(); } }, t('stateExam.go'))));
    document.body.append(dialog);
    dialog.showModal();
    focusById('state-exam-leave-stay');
  });
  return leavePromise;
}

// ---- The screen ----

function body(view) {
  const owner = state;
  const manage = view.can.manage === true;
  const e = owner.edit && owner.edit.base === view ? owner.edit : null;
  if (owner.edit && !e) { if (owner.edit.holding) holdOnLeave(null); owner.edit = null; }
  const parts = [];
  if (owner.saved) parts.push(note('success', t('stateExam.saved'), { id: 'state-exam-saved', role: 'status' }));
  if (!manage) parts.push(note('info', t('stateExam.readOnly'), { id: 'state-exam-readonly' }));
  if (view.students.length === 0) {
    parts.push(emptyState('table', el('p', { class: 'empty__title', id: 'state-exam-empty' }, t('stateExam.noStudents'))));
    return el('div', { class: 'ledger state-exam', id: 'state-exam-root' }, parts);
  }
  parts.push(
    el('section', { class: 'card table-card se-sheet', 'aria-labelledby': 'state-exam-title' }, el('div', { class: 'table-scroll' }, grid(view, e))),
    summary(view));
  if (manage) parts.push(actions(view, e));
  parts.push(sheetTools({
    id: 'state-exam-sheet', printKey: 'stateExam.print.button', host: 'state-exam-root',
    sheet: () => stateExamSheet(view, textLabels('stateExam.file.sheet')), orientation: 'portrait',
    file: (XLSX) => ({ book: stateExamBook(XLSX, view, textLabels('stateExam.file.sheet')), name: stateExamFileName(view, t('stateExam.file.prefix')) }),
  }));
  return el('div', { class: 'ledger state-exam', id: 'state-exam-root' }, parts);
}

// The chip of the word of a score.
const wordBadge = (word) => (word ? badge(t('journal.grade.' + word), wordTone(word), true) : el('span', { class: 'se-none' }, t('stateExam.noScore')));

function grid(view, e) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('table', { class: 'table se-grid', 'aria-labelledby': 'state-exam-title' },
    el('thead', {}, el('tr', {}, col(t('stateExam.col.no'), 'se-grid__no'), col(t('stateExam.col.student')), col(t('stateExam.col.score'), 'se-grid__score'), col(t('stateExam.col.word')))),
    el('tbody', {}, view.students.map((student, index) => row(view, e, student, index + 1))));
}

function row(view, e, student, no) {
  const cells = [el('td', { class: 'se-grid__no' }, String(no)),
    el('th', { scope: 'row', class: 'se-grid__name' }, el('span', {}, student.fullName || '—'), student.left ? badge(t('stateExam.left'), 'neutral') : null)];
  if (e && !student.left) {
    cells.push(scoreCell(view, e, student));
  } else {
    cells.push(el('td', { class: 'se-grid__score' }, student.score === null || student.score === undefined ? t('stateExam.noScore') : String(student.score)),
      el('td', { class: 'se-grid__word' }, wordBadge(scoreWord(student.score, view.scheme))));
  }
  return el('tr', { class: 'se-row' + (student.left ? ' is-left' : ''), id: 'state-exam-student-' + student.id }, cells);
}

// The cells of a student while the scores are entered: the field, and the word that follows what is typed.
function scoreCell(view, e, student) {
  const id = 'state-exam-in-' + student.id;
  const input = el('input', {
    type: 'text', inputmode: 'numeric', id, class: 'field__input lg-ex-input se-input', maxlength: '3', autocomplete: 'off',
    value: e.draft.get(student.id) ?? '', 'aria-label': t('stateExam.scoreOf', { name: student.fullName, max: SCORE_MAX }),
  });
  const error = el('p', { class: 'lg-ex-error', id: id + '-error', hidden: true });
  const word = el('td', { class: 'se-grid__word' });
  const showWord = () => {
    const text = (e.draft.get(student.id) ?? '').trim();
    word.replaceChildren(wordBadge(/^\d{1,3}$/.test(text) && Number(text) <= SCORE_MAX ? scoreWord(Number(text), view.scheme) : null));
  };
  showWord();
  e.ui.students.set(student.id, {
    set(message) {
      if (message === null) {
        error.hidden = true;
        error.replaceChildren();
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
        return;
      }
      error.replaceChildren(icon('alert'), message);
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', error.id);
    },
  });
  input.addEventListener('input', () => {
    e.draft.set(student.id, input.value.trim());
    e.ui.students.get(student.id).set(null);
    showWord();
    e.ui.reasonBox.hidden = !changes(view, e).needsReason;
    syncHold(view, e);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...document.querySelectorAll('.se-input')];
    const target = all[all.indexOf(input) + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target) { target.focus(); target.select(); }
  });
  return [el('td', { class: 'se-grid__score se-grid__score--edit' }, input, error), word];
}

// «отлично: 4 · хорошо: 9 · … · средний балл 77» as chips.
function summary(view) {
  const { words, missing, average } = examSummary(view.stats);
  const chips = words.map((w) => badge(`${t(w.key)}: ${w.n}`, w.tone));
  if (missing > 0) chips.push(badge(`${t('stateExam.missing')}: ${missing}`, 'neutral'));
  if (average !== null && average !== undefined) chips.push(badge(t('stateExam.average', { n: average }), 'primary'));
  return el('ul', { class: 'lg-counts no-print', id: 'state-exam-summary', 'aria-label': t('stateExam.summary.label') }, chips.map((chip) => el('li', {}, chip)));
}

// ---- «Вписать баллы» / «Сохранить» ----

function actions(view, e) {
  const owner = state;
  const buttons = [];
  if (!e) {
    buttons.push(el('button', {
      type: 'button', class: 'button button--primary', id: 'state-exam-enter',
      onclick: () => {
        owner.saved = false;
        owner.edit = {
          base: view, draft: scoreDraft(view.students), reason: '', busy: false, holding: false,
          ui: { students: new Map(), reason: null, reasonBox: null, problem: null },
        };
        refresh();
        const first = view.students.find((s) => !s.left);
        if (first) focusById('state-exam-in-' + first.id);
      },
    }, icon('pencil'), t('stateExam.enter')));
    return el('div', { class: 'se-actions-bar no-print' }, buttons);
  }

  const reasonArea = el('textarea', {
    id: 'state-exam-reason', name: 'reason', class: 'field__input field__textarea', rows: '2', maxlength: String(REASON_MAX), 'aria-required': 'true',
  });
  reasonArea.value = e.reason;
  const reasonError = el('p', { class: 'field__error', id: 'state-exam-reason-error', hidden: true });
  const reasonBox = el('div', { class: 'field se-reason', id: 'state-exam-reason-box' },
    el('label', { class: 'field__label', for: 'state-exam-reason' }, t('stateExam.reason')),
    el('p', { class: 'field__hint', id: 'state-exam-reason-hint' }, t('stateExam.reasonHint')),
    el('div', { class: 'field__control' }, reasonArea),
    reasonError);
  reasonArea.setAttribute('aria-describedby', 'state-exam-reason-hint');
  reasonBox.hidden = !changes(view, e).needsReason;
  const setReasonError = (text) => {
    if (text === null) {
      reasonError.hidden = true;
      reasonError.replaceChildren();
      reasonArea.removeAttribute('aria-invalid');
      reasonArea.setAttribute('aria-describedby', 'state-exam-reason-hint');
      return;
    }
    reasonError.replaceChildren(icon('alert'), text);
    reasonError.hidden = false;
    reasonArea.setAttribute('aria-invalid', 'true');
    reasonArea.setAttribute('aria-describedby', 'state-exam-reason-hint state-exam-reason-error');
  };
  reasonArea.addEventListener('input', () => { e.reason = reasonArea.value; setReasonError(null); });
  const problem = el('div', { class: 'mk-problem', id: 'state-exam-problem' });
  e.ui.reason = { set: setReasonError };
  e.ui.reasonBox = reasonBox;
  e.ui.problem = problem;

  const save = el('button', { type: 'button', class: 'button button--primary', id: 'state-exam-save', 'aria-disabled': e.busy ? 'true' : null }, t('stateExam.saveScores'));
  if (e.busy) markBusy(save, 'stateExam.saving');
  save.addEventListener('click', () => submit(view, e, save));
  const cancel = el('button', {
    type: 'button', class: 'button button--secondary', id: 'state-exam-cancel',
    onclick: () => {
      if (e.busy) return;
      if (e.holding) { e.holding = false; holdOnLeave(null); }
      owner.edit = null;
      refresh();
      focusById('state-exam-enter');
    },
  }, t('stateExam.cancel'));
  return el('div', { class: 'se-actions-bar se-actions-bar--edit no-print' }, reasonBox, problem, el('div', { class: 'lg-exam__buttons' }, save, cancel));
}

// The text of a mistake at a field of a student or of the reason.
function fieldMessage(field, code) {
  if (field === 'reason') return t(code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required');
  const key = `stateExam.error.${field}.${code}`;
  return hasText(key) ? t(key, { max: SCORE_MAX }) : t(errorKey(code));
}

// Sends only the changed scores; the mistakes of the server stand at the field they belong to.
async function submit(view, e, button) {
  if (e.busy) return;
  const owner = state;
  const ui = e.ui;
  const { items, bad, needsReason } = changes(view, e);
  ui.problem.replaceChildren();
  ui.reason.set(null);
  for (const spot of ui.students.values()) spot.set(null);

  if (bad.length > 0) {
    for (const id of bad) ui.students.get(id)?.set(fieldMessage('score', 'bad_value'));
    focusFirstInvalid();
    return;
  }
  if (items.length === 0) {
    ui.problem.replaceChildren(note('info', t('stateExam.saved'), { role: 'status' }));
    return;
  }
  const reason = e.reason.trim();
  if (needsReason && (reason === '' || reason.length > REASON_MAX)) {
    ui.reason.set(fieldMessage('reason', reason === '' ? 'required' : 'too_long'));
    ui.reasonBox.hidden = false;
    focusFirstInvalid();
    return;
  }

  e.busy = true;
  markBusy(button, 'stateExam.saving');
  const sent = items.map((item) => item.studentId);
  try {
    const data = await call('stateExam.saveScores', { examId: view.exam.id, items, ...(needsReason ? { reason } : {}) });
    if (state !== owner) return;
    if (e.holding) { e.holding = false; holdOnLeave(null); }
    owner.data = data;
    owner.edit = null;
    owner.saved = true;
    refresh();
    focusById('state-exam-enter', 'state-exam-root');
  } catch (error) {
    if (state !== owner || owner.edit !== e) return;
    e.busy = false;
    button.removeAttribute('aria-busy');
    button.removeAttribute('aria-disabled');
    button.classList.remove('is-busy');
    button.textContent = t('stateExam.saveScores');
    showServerError(e, error, sent);
  }
}

function showServerError(e, error, sent) {
  const ui = e.ui;
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  if (fields.length === 0) {
    ui.problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    return;
  }
  let loose = null;
  for (const { index, field, code } of fields) {
    const text = fieldMessage(field, code);
    const id = Number.isInteger(index) ? sent[index] : undefined;
    if (id !== undefined && ui.students.has(id)) ui.students.get(id).set(text);
    else if (field === 'reason') { ui.reasonBox.hidden = false; ui.reason.set(text); } else loose = loose || text;
  }
  if (loose) ui.problem.replaceChildren(note('error', loose, { role: 'alert' }));
  focusFirstInvalid();
}

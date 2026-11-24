import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, focusById, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import { activityAllowed, coatAllowed } from '../journal.js';
import { markToText, textToMark, valueLine, targetLine, requestProblems, markRequestNeeded, normalizePoints } from '../requests.js';

// The window «Заявка на исправление»: what changes, what it is now, what it becomes and why. One request to request.create;
// the server decides everything again. Names, titles and reasons are put on the page only as text.

const REASON_MAX = 300;
const STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];
const NOT_ATTENDED = ['absent', 'excused'];
const EXAM_MODES = ['score', 'absent', 'incomplete'];
const POINT_KINDS = ['current', 'self', 'control', 'work'];

// A value line of valueLine() as the text of the screen.
export function valueText(line) {
  const params = { ...line.params };
  for (const name of line.keyParams) params[name] = t(params[name]);
  if (line.key === 'request.value.mark') {
    params.activity = params.activity === null ? '' : t('request.value.activity', { n: params.activity });
    params.coat = params.coat ? t('request.value.coat') : '';
  }
  return t(line.key, params);
}

// The points of the request to the server by the kind.
const fieldsOf = (kind, subjectId, unit, pair, assignment, student) => ({
  kind, subjectId, studentId: student.id,
  ...(kind === 'mark' ? { pairId: pair.id } : {}),
  ...(kind === 'work' ? { assignmentId: assignment.id } : {}),
  ...(['current', 'self', 'control'].includes(kind) ? { unit } : {}),
});

// kind, subjectId, student {id, fullName}, before (the text of the old value), onSaved(data): after a filed request, onClosed();
// unit: for the kinds of a unit; attemptNo: of the exam; pair + journal: for a mark; assignment: for a work; max: the greatest number of points (or of the exam);
// subjectName: the line over the title.
export function openRequestForm({ kind, subjectId, subjectName = '', unit = null, pair = null, journal = null, assignment = null, attemptNo = null, student, before, max = null, onSaved, onClosed }) {
  document.getElementById('request-form')?.remove();
  let busy = false;
  let sent = false;
  const markBefore = kind === 'mark' ? textToMark(before) : null;
  const draft = {
    text: '',                  // the typed number
    reset: false,              // current: back to the calculated
    mode: 'score',             // exam: score | absent | incomplete
    status: markBefore ? markBefore.status : 'present',
    noCoat: markBefore ? markBefore.noCoat : false,
    activity: markBefore && markBefore.activity !== null ? String(markBefore.activity) : '',
    activityBad: false,
    reason: '',
  };
  if (kind === 'exam' && (before === 'absent' || before === 'incomplete')) draft.mode = before;
  if (kind === 'exam' && before !== 'absent' && before !== 'incomplete') draft.text = before;
  if (POINT_KINDS.includes(kind)) draft.text = before;

  const errorOf = new Map();       // field -> key of the text
  const problem = el('div', { class: 'mk-problem' });
  const afterBox = el('div', { class: 'rq-after' });
  const afterError = el('p', { class: 'field__error', id: 'request-after-error', role: 'alert', hidden: true });
  const reasonArea = el('textarea', {
    id: 'request-reason', name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': 'request-reason-count', 'aria-required': 'true',
  });
  const reasonCount = el('span', { class: 'return-count', id: 'request-reason-count', 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
  const reasonError = el('p', { class: 'field__error', id: 'request-reason-error', hidden: true });
  const beforeError = el('p', { class: 'field__error', id: 'request-before-error', role: 'alert', hidden: true });

  const showError = (node, key, control) => {
    node.replaceChildren(icon('alert'), t(key));
    node.hidden = false;
    if (control) control.setAttribute('aria-invalid', 'true');
  };
  const clearErrors = () => {
    for (const node of [afterError, reasonError, beforeError]) { node.hidden = true; node.replaceChildren(); }
    reasonArea.removeAttribute('aria-invalid');
    problem.replaceChildren();
    errorOf.clear();
  };
  reasonArea.addEventListener('input', () => {
    draft.reason = reasonArea.value;
    reasonCount.textContent = t('journal.marks.reason.count', { n: reasonArea.value.length, max: REASON_MAX });
    reasonError.hidden = true;
    reasonArea.removeAttribute('aria-invalid');
  });

  // ---- «Стало» ----
  let input = null;
  function drawAfter() {
    input = null;
    if (kind === 'mark') return afterBox.replaceChildren(markEditor());
    if (kind === 'exam') return afterBox.replaceChildren(examEditor());
    afterBox.replaceChildren(pointsEditor());
  }

  function numberInput(label) {
    input = el('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'field__input ju-input rq-input', id: 'request-after', maxlength: '3',
      value: draft.reset ? '' : draft.text, 'aria-label': label, 'aria-describedby': 'request-after-error',
      disabled: draft.reset ? 'true' : null,
    });
    input.addEventListener('input', () => { draft.text = input.value; afterError.hidden = true; input.removeAttribute('aria-invalid'); problem.replaceChildren(); });
    return input;
  }

  function pointsEditor() {
    const parts = [el('div', { class: 'ju-row__field' }, numberInput(t('request.after')), el('span', { class: 'ju-row__of' }, t('journal.unit.of', { max })))];
    if (kind === 'current') {
      parts.push(el('button', {
        type: 'button', class: 'button button--secondary rq-reset', id: 'request-reset', 'aria-pressed': String(draft.reset),
        onclick: () => { if (busy) return; draft.reset = !draft.reset; drawAfter(); },
      }, t('request.reset')));
    }
    return el('div', { class: 'rq-points' }, ...parts);
  }

  function examEditor() {
    const buttons = EXAM_MODES.map((mode) => el('button', {
      type: 'button', class: 'mk-status__btn', 'data-mode': mode, 'aria-pressed': String(draft.mode === mode),
      onclick: () => { if (busy) return; draft.mode = mode; afterError.hidden = true; drawAfter(); },
    }, t(mode === 'score' ? 'ledger.exam.modeScore' : mode === 'absent' ? 'ledger.exam.absent' : 'ledger.exam.incomplete')));
    return el('div', { class: 'rq-points' },
      el('div', { class: 'mk-status', role: 'group', 'aria-label': t('request.examResult') }, buttons),
      draft.mode === 'score' ? el('div', { class: 'ju-row__field' }, numberInput(t('request.after')), el('span', { class: 'ju-row__of' }, t('journal.unit.of', { max }))) : null);
  }

  function markEditor() {
    const buttons = STATUSES.map((status) => el('button', {
      type: 'button', class: 'mk-status__btn', 'data-status': status, 'aria-pressed': String(draft.status === status),
      onclick: () => {
        if (busy) return;
        draft.status = status;
        if (NOT_ATTENDED.includes(status)) { draft.noCoat = false; draft.activity = ''; draft.activityBad = false; }
        afterError.hidden = true;
        drawAfter();
      },
    }, t('journal.marks.status.' + status)));
    const coat = coatAllowed(pair) && !NOT_ATTENDED.includes(draft.status)
      ? el('label', { class: 'mk-coat', for: 'request-coat' },
        el('input', { type: 'checkbox', class: 'check__input mk-coat__box', id: 'request-coat', checked: draft.noCoat ? 'true' : null, onchange: (event) => { draft.noCoat = event.target.checked; } }),
        el('span', {}, t('journal.marks.coat'))) : null;
    const maxActivity = journal && journal.scheme ? journal.scheme.activity : 0;
    const activity = activityAllowed(draft.status, pair)
      ? el('label', { class: 'mk-act', for: 'request-act' }, el('span', { class: 'mk-act__label' }, t('journal.marks.activity')),
        el('input', {
          type: 'number', class: 'field__input mk-act__input', id: 'request-act', min: '0', max: String(maxActivity), step: '1', inputmode: 'numeric',
          value: draft.activity, placeholder: t('journal.marks.activityPlaceholder', { max: maxActivity }),
          oninput: (event) => { draft.activity = event.target.value; draft.activityBad = event.target.validity.badInput; afterError.hidden = true; },
        })) : null;
    return el('div', { class: 'cl-editor' },
      el('div', { class: 'mk-status', role: 'group', 'aria-label': t('request.markStatus') }, buttons),
      coat || activity ? el('div', { class: 'cl-extras' }, coat, activity) : null);
  }

  // The new value as the text of the request, or the key of the problem.
  function afterText() {
    if (kind === 'mark') {
      const clean = draft.activity.trim();
      const maxActivity = journal && journal.scheme ? journal.scheme.activity : 0;
      if (activityAllowed(draft.status, pair) && clean !== '') {
        if (draft.activityBad || !/^\d+$/.test(clean) || Number(clean) > maxActivity) return { key: 'request.form.error.bad_value' };
      }
      const mark = {
        status: draft.status, noCoat: NOT_ATTENDED.includes(draft.status) ? false : draft.noCoat,
        activity: activityAllowed(draft.status, pair) && clean !== '' ? Number(clean) : null,
      };
      return { text: markToText(mark), mark };
    }
    if (kind === 'exam' && draft.mode !== 'score') return { text: draft.mode };
    if (kind === 'current' && draft.reset) return { text: '' };
    const value = normalizePoints(draft.text);
    if (value === null || value === '' || Number(value) > max) return { key: 'request.form.error.bad_value' };
    return { text: value };
  }

  // ---- the buttons ----
  const go = el('button', { type: 'button', class: 'button button--primary', id: 'request-submit' }, icon('check'), t('request.submit'));
  const cancel = el('button', { type: 'button', class: 'button button--secondary', id: 'request-cancel', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel'));
  const actions = el('div', { class: 'dialog__actions mk-actions' }, cancel, go);

  const idle = () => {
    busy = false;
    reasonArea.disabled = false;
    go.classList.remove('is-busy');
    go.removeAttribute('aria-busy');
    go.removeAttribute('aria-disabled');
    go.replaceChildren(icon('check'), t('request.submit'));
  };

  async function submit() {
    if (busy || sent) return;
    clearErrors();
    const after = afterText();
    if (after.key) { showError(afterError, after.key, input); if (input) input.focus(); return; }
    const reason = draft.reason.trim();
    if (reason === '') { showError(reasonError, 'request.form.error.required', reasonArea); reasonArea.focus(); return; }
    if (reason.length > REASON_MAX) { showError(reasonError, 'request.form.error.too_long', reasonArea); reasonArea.focus(); return; }
    if (after.text === before) { showError(afterError, 'request.form.error.same', input); return; }
    if (kind === 'mark' && !markRequestNeeded(pair, journal, textToMark(before), after.mark)) {
      problem.replaceChildren(note('info', t('error.not_needed'), { role: 'alert' }));
      return;
    }
    busy = true;
    reasonArea.disabled = true;
    markBusy(go, 'request.busy');
    try {
      const data = await call('request.create', { ...fieldsOf(kind, subjectId, unit, pair, assignment, student), before, after: after.text, reason });
      busy = false;
      sent = true;
      if (onSaved) onSaved(data);
      if (dialog.isConnected) drawSent();
    } catch (error) {
      busy = false;
      if (!dialog.isConnected) return;
      idle();
      fail(error);
    }
  }
  go.addEventListener('click', submit);

  // The refusal of the server: at the fields, or as one note over the buttons.
  function fail(error) {
    if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields.length > 0) {
      const map = requestProblems(error.fields);
      const loose = [];
      for (const [field, key] of map) {
        if (field === 'after') showError(afterError, key, input);
        else if (field === 'reason') showError(reasonError, key, reasonArea);
        else if (field === 'before') showError(beforeError, key);
        else loose.push(key);
      }
      if (loose.length > 0) problem.replaceChildren(note('error', t(loose[0]), { role: 'alert' }));
      return;
    }
    problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
  }

  function drawSent() {
    const done = el('div', { class: 'rq-sent', id: 'request-sent' },
      note('success', t('request.sent'), { role: 'status' }),
      el('div', { class: 'dialog__actions' },
        el('a', { class: 'button button--secondary', id: 'request-open-mine', href: '#/requests' }, t('request.mine.title')),
        el('button', { type: 'button', class: 'button button--primary', id: 'request-close', onclick: () => dialog.close() }, t('common.close'))));
    body.replaceChildren(head, done);
    focusById('request-close');
  }

  // ---- the window ----
  const target = targetLine({
    kind, unit, pairDate: pair ? pair.date : '', pairSlot: pair ? pair.slot : null,
    assignmentTitle: assignment ? assignment.title : '', attemptNo,
  });
  const facts = el('dl', { class: 'rq-facts' },
    el('dt', {}, t('request.what')), el('dd', { id: 'request-target' }, t(target.key, target.params)),
    el('dt', {}, t('request.student')), el('dd', { id: 'request-student' }, student.fullName || '—'),
    el('dt', {}, t('request.before')), el('dd', { id: 'request-before' }, valueText(valueLine(kind, before))));
  const head = el('div', { class: 'mk-head' },
    subjectName ? el('p', { class: 'dialog__kicker' }, subjectName) : null,
    el('h2', { class: 'dialog__title', id: 'request-form-title' }, t('request.title')),
    facts, beforeError);
  const body = el('div', { class: 'rq-body' },
    head,
    el('div', { class: 'field rq-field' },
      el('p', { class: 'field__label', id: 'request-after-label' }, t('request.after')),
      afterBox, afterError),
    el('div', { class: 'field mk-reason' },
      el('div', { class: 'mk-reason__head' }, el('label', { class: 'field__label', for: 'request-reason' }, t('request.reason')), reasonCount),
      el('div', { class: 'field__control' }, reasonArea),
      reasonError),
    el('p', { class: 'rq-hint' }, t('request.hint')),
    problem,
    actions);

  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'request-form', labelledBy: 'request-form-title', className: 'dialog--cell dialog--request',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => !busy,
  }, body);
  drawAfter();
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById(kind === 'mark' ? 'request-reason' : input ? 'request-after' : 'request-reason', 'request-cancel');
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, fieldErrorKey, badge, focusById, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import { activityAllowed, cellView, coatAllowed, lateOptions, logLine, pairScore } from '../journal.js';

// The window of a cell of the journal grid: one student on one held pair. Free and reason modes change the status,
// the lab coat and the activity (the reason is required in `reason`); `limited` (a teacher after the term) offers
// only what lateOptions allows and always asks for a reason; `none` is read only. Below, the history of changes of
// this mark (journal.log), unless the journal is partial (a teacher who only substituted: the server would refuse).
// It lives on the document, as the window of the marks of a pair. Names, reasons and values are text.

const STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];
const REASON_MAX = 300;
const NOT_ATTENDED = ['absent', 'excused'];
const TONES = { neutral: 'neutral', warning: 'warning', danger: 'danger', info: 'primary', success: 'success' };

const dateText = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
// 'YYYY-MM-DD HH:MM:SS' -> 'dd.mm.yyyy HH:MM'; anything else is shown as it is.
const stamp = (at) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(at) ? `${dateText(at)} ${at.slice(11, 16)}` : String(at || ''));

// journal: the answer of journal.get; pair: its head; student: {id, fullName};
// onSaved(data): the new answer after a successful save; onClosed(): the window is gone (to give the focus back).
export function openCellDialog({ journal: first, pair: firstPair, student, onSaved, onClosed }) {
  document.getElementById('journal-cell')?.remove();
  let journal = first;
  let busy = false;
  let historyTicket = 0;

  const pairNow = () => journal.pairs.find((p) => p.id === firstPair.id) || firstPair;
  const markNow = () => ((journal.marks && journal.marks[firstPair.id]) || {})[student.id] || null;

  // ---- the draft of the form (rebuilt after every save) ----
  let draft;
  let reason;
  let chosen;       // limited mode: the status picked from lateOptions
  let touched;
  const resetDraft = () => {
    const mark = markNow();
    draft = {
      status: mark ? mark.status : 'present', noCoat: mark ? mark.noCoat === true : false,
      activityText: mark && mark.activity !== null && mark.activity !== undefined ? String(mark.activity) : '', activityBad: false,
    };
    reason = '';
    chosen = null;
    touched = false;
  };
  resetDraft();

  const activityOf = () => {
    const clean = draft.activityText.trim();
    return clean === '' || draft.activityBad ? null : Number(clean);
  };
  const sameAsSaved = () => {
    const mark = markNow();
    return !!mark && mark.status === draft.status && mark.noCoat === draft.noCoat && (mark.activity ?? null) === activityOf();
  };
  // the mark to send, or null when there is nothing to save
  const toSend = () => {
    const mode = pairNow().mode;
    const mark = markNow();
    if (mode === 'limited') {
      if (chosen === null) return null;
      return { studentId: student.id, status: chosen, noCoat: mark.noCoat === true, activity: activityAllowed(chosen, pairNow()) ? activityOf() : null };
    }
    if (mode !== 'free' && mode !== 'reason') return null;
    if (mark ? sameAsSaved() : !touched) return null;
    return { studentId: student.id, status: draft.status, noCoat: draft.noCoat, activity: activityAllowed(draft.status, pairNow()) ? activityOf() : null };
  };
  const isDirty = () => reason.trim() !== '' || toSend() !== null;

  // ---- the parts of the window ----
  const summary = el('div', { class: 'cl-summary' });
  const form = el('div', { class: 'cl-form' });
  const problem = el('div', { class: 'mk-problem' });
  const savedLine = el('p', { class: 'cl-saved', role: 'status', 'aria-live': 'polite' });
  const history = el('section', { class: 'cl-history', 'aria-labelledby': 'journal-cell-history-title' });
  const asking = el('div', { class: 'mk-ask', role: 'alert', hidden: true },
    el('p', { class: 'mk-ask__text' }, t('journal.marks.unsaved')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: 'journal-cell-stay', class: 'button button--secondary', onclick: () => { asking.hidden = true; actions.hidden = false; focusById('journal-cell-save', 'journal-cell-cancel'); } }, t('journal.marks.stay')),
      el('button', { type: 'button', id: 'journal-cell-discard', class: 'button button--danger', onclick: () => dialog.close() }, t('journal.marks.discard'))));

  let rows;                // the controls of the editor
  let reasonArea = null;
  let reasonCount = null;
  let reasonError = null;
  let go = null;

  function drawSummary() {
    const mark = markNow();
    const pair = pairNow();
    const view = cellView(mark);
    const score = pairScore(mark, pair, journal.scheme);
    const parts = [];
    if (mark) {
      if (mark.noCoat) parts.push(t('journal.marks.coat'));
      if (mark.activity !== null && mark.activity !== undefined) parts.push(`${t('journal.marks.activity')}: ${mark.activity}`);
    }
    summary.replaceChildren(
      el('p', { class: 'cl-now' },
        el('span', { class: 'cl-now__label' }, t('journal.cell.current')),
        mark ? badge(t('journal.marks.status.' + mark.status), TONES[view.tone] || 'neutral') : badge(t('journal.cell.noMark'), 'neutral'),
        parts.length > 0 ? el('span', { class: 'cl-now__extra' }, parts.join(' · ')) : null),
      el('p', { class: 'cl-points' }, score ? t('journal.cell.points', score) : t('journal.cell.noPoints')));
  }

  // ---- the editor of free and reason modes ----
  function buildEditor() {
    const pair = pairNow();
    const maxActivity = journal.scheme.activity;
    const nameId = 'journal-cell-name';
    const buttons = STATUSES.map((status) => el('button', {
      type: 'button', class: 'mk-status__btn', 'data-status': status, 'aria-pressed': 'false', onclick: () => setStatus(status),
    }, t('journal.marks.status.' + status)));
    const coatBox = coatAllowed(pair) ? el('input', {
      type: 'checkbox', class: 'check__input mk-coat__box', id: 'journal-cell-coat',
      onchange: () => { draft.noCoat = coatBox.checked; changed(); },
    }) : null;
    const activity = el('input', {
      type: 'number', class: 'field__input mk-act__input', id: 'journal-cell-act', min: '0', max: String(maxActivity), step: '1',
      inputmode: 'numeric', placeholder: t('journal.marks.activityPlaceholder', { max: maxActivity }),
      oninput: () => setActivity(activity.value),
    });
    const error = el('p', { class: 'field__error mk-row__error', role: 'alert', hidden: true });
    rows = { buttons, coatBox, activity, error };
    return el('div', { class: 'cl-editor' },
      el('div', { class: 'mk-status', role: 'group', 'aria-labelledby': nameId }, buttons),
      el('div', { class: 'cl-extras' },
        coatBox ? el('label', { class: 'mk-coat', for: coatBox.id }, coatBox, el('span', {}, t('journal.marks.coat'))) : null,
        el('label', { class: 'mk-act', for: activity.id }, el('span', { class: 'mk-act__label' }, t('journal.marks.activity')), activity)),
      error);
  }

  function paintEditor() {
    const pair = pairNow();
    for (const button of rows.buttons) button.setAttribute('aria-pressed', String(button.dataset.status === draft.status));
    if (rows.coatBox) {
      rows.coatBox.checked = draft.noCoat;
      rows.coatBox.disabled = NOT_ATTENDED.includes(draft.status);
    }
    rows.activity.disabled = !activityAllowed(draft.status, pair);
    if (rows.activity.value !== draft.activityText) rows.activity.value = draft.activityText;
  }

  // ---- the options of the limited mode ----
  function buildLimited() {
    const options = lateOptions(markNow());
    if (options.length === 0) return note('info', t('journal.cell.limited.none'), { id: 'journal-cell-none' });
    const pair = pairNow();
    const buttons = options.map((status) => el('button', {
      type: 'button', class: 'mk-status__btn', 'data-status': status, 'aria-pressed': 'false', onclick: () => choose(status),
    }, t('journal.cell.limited.' + status)));
    const activity = el('input', {
      type: 'number', class: 'field__input mk-act__input', id: 'journal-cell-act', min: '0', max: String(journal.scheme.activity), step: '1',
      inputmode: 'numeric', placeholder: t('journal.marks.activityPlaceholder', { max: journal.scheme.activity }),
      oninput: () => setActivity(activity.value),
    });
    const activityBox = activityAllowed('madeup', pair)
      ? el('label', { class: 'mk-act', for: activity.id }, el('span', { class: 'mk-act__label' }, t('journal.marks.activity')), activity) : null;
    const error = el('p', { class: 'field__error mk-row__error', role: 'alert', hidden: true });
    rows = { buttons, activity: activityBox ? activity : null, activityBox, error };
    return el('div', { class: 'cl-editor' },
      el('p', { class: 'mk-hint__text' }, t('journal.cell.limited.hint')),
      el('div', { class: 'mk-status', role: 'group', 'aria-label': t('journal.cell.options') }, buttons),
      activityBox ? el('div', { class: 'cl-extras' }, activityBox) : null,
      error);
  }

  function paintLimited() {
    for (const button of rows.buttons) button.setAttribute('aria-pressed', String(button.dataset.status === chosen));
    if (rows.activityBox) {
      rows.activityBox.hidden = chosen !== 'madeup';
      if (rows.activity.value !== draft.activityText) rows.activity.value = draft.activityText;
    }
  }

  function buildReason() {
    reasonArea = el('textarea', {
      id: 'journal-cell-reason', name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
      'aria-describedby': 'journal-cell-reason-hint journal-cell-reason-count', 'aria-required': 'true',
    });
    reasonCount = el('span', { class: 'return-count', id: 'journal-cell-reason-count', 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
    reasonError = el('p', { class: 'field__error', id: 'journal-cell-reason-error', hidden: true });
    reasonArea.addEventListener('input', () => {
      reason = reasonArea.value;
      reasonCount.textContent = t('journal.marks.reason.count', { n: reason.length, max: REASON_MAX });
      clearReasonError();
      savedLine.textContent = '';
    });
    return el('div', { class: 'field mk-reason' },
      el('label', { class: 'field__label', for: 'journal-cell-reason' }, t('journal.marks.reason.label')),
      el('p', { class: 'field__hint', id: 'journal-cell-reason-hint' }, t('journal.marks.reason.hint')),
      el('div', { class: 'field__control' }, reasonArea),
      el('div', { class: 'return-under' }, reasonError, reasonCount));
  }

  const showReasonError = (key) => {
    reasonError.replaceChildren(icon('alert'), t(key));
    reasonError.hidden = false;
    reasonArea.setAttribute('aria-invalid', 'true');
    reasonArea.setAttribute('aria-describedby', 'journal-cell-reason-hint journal-cell-reason-count journal-cell-reason-error');
  };
  function clearReasonError() {
    if (!reasonError) return;
    reasonError.hidden = true;
    reasonArea.removeAttribute('aria-invalid');
    reasonArea.setAttribute('aria-describedby', 'journal-cell-reason-hint journal-cell-reason-count');
  }

  const showFieldError = (key) => { rows.error.replaceChildren(icon('alert'), t(key)); rows.error.hidden = false; };
  const clearFieldError = () => {
    rows.error.hidden = true;
    rows.error.replaceChildren();
    if (rows.activity) rows.activity.removeAttribute('aria-invalid');
  };

  function changed() {
    touched = true;
    clearFieldError();
    problem.replaceChildren();
    savedLine.textContent = '';
    if (pairNow().mode === 'limited') paintLimited(); else paintEditor();
  }

  function setStatus(status) {
    if (busy) return;
    draft.status = status;
    if (NOT_ATTENDED.includes(status)) { draft.noCoat = false; draft.activityText = ''; draft.activityBad = false; }
    changed();
  }

  function choose(status) {
    if (busy) return;
    chosen = chosen === status ? null : status;
    if (chosen !== 'madeup') { draft.activityText = ''; draft.activityBad = false; }
    changed();
  }

  function setActivity(text) {
    draft.activityText = text;
    const clean = text.trim();
    draft.activityBad = clean !== '' && !(/^\d+$/.test(clean) && Number(clean) <= journal.scheme.activity);
    touched = true;
    clearFieldError();
    problem.replaceChildren();
  }

  // ---- drawing the form for the mode of the pair ----
  function drawForm() {
    const mode = pairNow().mode;
    reasonArea = reasonCount = reasonError = go = null;
    rows = null;
    if (mode === 'free' || mode === 'reason') {
      form.replaceChildren(...[buildEditor(), mode === 'reason' ? buildReason() : null].filter(Boolean));
      paintEditor();
    } else if (mode === 'limited') {
      const limited = buildLimited();
      form.replaceChildren(...[limited, lateOptions(markNow()).length > 0 ? buildReason() : null].filter(Boolean));
      if (rows) paintLimited();
    } else {
      form.replaceChildren(note('info', t('journal.cell.readOnly'), { id: 'journal-cell-readonly' }));
    }
    drawActions();
  }

  // ---- the buttons ----
  let actions = el('div', { class: 'dialog__actions mk-actions' });
  function drawActions() {
    const mode = pairNow().mode;
    const editable = mode === 'free' || mode === 'reason' || (mode === 'limited' && lateOptions(markNow()).length > 0);
    go = editable ? el('button', { type: 'button', id: 'journal-cell-save', class: 'button button--primary', onclick: save }, icon('check'), t('common.save')) : null;
    actions.replaceChildren(...[
      el('button', { type: 'button', id: 'journal-cell-cancel', class: 'button button--secondary', onclick: tryClose }, editable ? t('common.cancel') : t('common.close')),
      go].filter(Boolean));
  }

  const idle = () => {
    busy = false;
    if (!go) return;
    go.classList.remove('is-busy');
    go.removeAttribute('aria-disabled');
    go.removeAttribute('aria-busy');
    go.replaceChildren(icon('check'), t('common.save'));
  };

  const ask = () => { actions.hidden = true; asking.hidden = false; focusById('journal-cell-stay'); };
  function tryClose() {
    if (busy) return;
    if (isDirty()) ask(); else dialog.close();
  }

  function showServerFields(fields) {
    const loose = [];
    for (const f of fields) {
      if (f.field === 'reason') { showReasonError(f.code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required'); continue; }
      const key = fieldErrorKey('marks', f.field, f.code, 'journal.marks');
      if (f.field === 'activity' && rows && rows.activity) { rows.activity.setAttribute('aria-invalid', 'true'); showFieldError(key); } else loose.push(key);
    }
    if (loose.length > 0) problem.replaceChildren(note('error', t(loose[0]), { role: 'alert' }));
  }

  async function save() {
    if (busy) return;
    problem.replaceChildren();
    savedLine.textContent = '';
    const mode = pairNow().mode;
    if (draft.activityBad && (mode === 'free' || mode === 'reason' || chosen === 'madeup')) {
      showFieldError('journal.marks.error.activity.bad_value');
      rows.activity.setAttribute('aria-invalid', 'true');
      rows.activity.focus();
      return;
    }
    if (mode === 'limited' && chosen === null) { showFieldError('journal.cell.limited.choose'); return; }
    const mark = toSend();
    if (mark === null) { dialog.close(); return; }
    const text = reason.trim();
    if (mode !== 'free') {
      if (text === '') { showReasonError('journal.marks.error.reason.required'); reasonArea.focus(); return; }
      if (text.length > REASON_MAX) { showReasonError('journal.marks.error.reason.too_long'); reasonArea.focus(); return; }
    }
    busy = true;
    markBusy(go, 'common.saving');
    try {
      const data = await call('journal.savePair', mode === 'free' ? { pairId: pairNow().id, marks: [mark] } : { pairId: pairNow().id, marks: [mark], reason: text });
      busy = false;
      if (!dialog.isConnected) return;
      journal = data.journal;
      onSaved(data);
      resetDraft();
      drawSummary();
      drawForm();
      savedLine.textContent = t('journal.cell.saved');
      loadHistory();
      focusById('journal-cell-cancel');
    } catch (error) {
      busy = false;
      if (!dialog.isConnected) return;
      idle();
      if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields.length > 0) showServerFields(error.fields);
      else problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    }
  }

  // ---- the history ----
  function historyItem(row) {
    const line = logLine(row);
    const params = { ...line.params };
    for (const name of line.keyParams) params[name] = t(params[name]);
    return el('li', { class: 'cl-log__item' },
      el('p', { class: 'cl-log__head' },
        el('span', { class: 'cl-log__who' }, row.actorName || '—'),
        el('time', { class: 'cl-log__time' }, stamp(row.at)),
        row.late ? badge(t('journal.log.late'), 'warning') : null),
      el('p', { class: 'cl-log__line' }, t(line.key, params)),
      row.reason ? el('p', { class: 'cl-log__reason' }, t('journal.log.reason', { reason: row.reason })) : null);
  }

  function drawHistory(body) {
    history.replaceChildren(el('h3', { class: 'cl-history__title', id: 'journal-cell-history-title' }, t('journal.cell.history.title')), body);
  }

  async function loadHistory() {
    if (journal.partial) { history.hidden = true; return; }
    const ticket = ++historyTicket;
    if (!history.querySelector('.cl-log')) drawHistory(el('p', { class: 'cl-history__note' }, t('journal.cell.history.loading')));
    try {
      const data = await call('journal.log', { subjectId: journal.subject.id, pairId: firstPair.id, studentId: student.id });
      if (!dialog.isConnected || ticket !== historyTicket) return;
      const list = Array.isArray(data.rows) ? data.rows : [];
      drawHistory(list.length === 0
        ? el('p', { class: 'cl-history__note', id: 'journal-cell-history-empty' }, t('journal.cell.history.empty'))
        : el('ol', { class: 'cl-log', id: 'journal-cell-history' }, list.map(historyItem)));
    } catch (error) {
      if (!dialog.isConnected || ticket !== historyTicket) return;
      drawHistory(el('div', { class: 'cl-history__note' },
        note('error', t(errorKey(error.code)), { role: 'alert' }),
        el('button', { type: 'button', class: 'button button--secondary', onclick: loadHistory }, t('common.retry'))));
    }
  }

  // ---- the window ----
  const onHash = () => dialog.close();
  const pair0 = pairNow();
  const dialog = modal({
    id: 'journal-cell', labelledBy: 'journal-cell-name', className: 'dialog--cell',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => { if (busy) return false; if (isDirty()) { ask(); return false; } return true; },
  },
  el('div', { class: 'mk-head' },
    el('p', { class: 'dialog__kicker' }, t('journal.marks.when', { date: dateText(pair0.date), slot: pair0.slot, time: pair0.startTime })),
    el('h2', { class: 'dialog__title', id: 'journal-cell-name' }, student.fullName || '—'),
    el('p', { class: 'mk-topic' },
      badge(pair0.lessonType ? t('lessonType.' + pair0.lessonType) : t('journal.marks.kind.none'), pair0.lessonType === 'control' ? 'primary' : 'neutral'),
      el('span', {}, pair0.topicName ? t('journal.topic', { n: pair0.number, name: pair0.topicName }) : t('journal.topicNone')))),
  summary,
  form,
  problem,
  savedLine,
  actions,
  asking,
  history);
  drawSummary();
  drawForm();
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById('journal-cell-cancel');
  loadHistory();
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, fieldErrorKey, badge, focusById, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import { draftMarks, changedMarks, activityAllowed, coatAllowed } from '../journal.js';

// The window «Отметки пары» of the journal of a subject: a status for every student of the group, the lab coat and
// the points for activity (journal.savePair). It lives on the document, not on the screen: the grid under it may be
// drawn again. A deanery person (mode `reason`) must also give the reason of the change. Names and the reason are text.

const STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];
const REASON_MAX = 300;
const NOT_ATTENDED = ['absent', 'excused'];

const dateText = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

// journal: the answer of journal.get; pair: its head (mode `free` or `reason`);
// onSaved(data): the new answer after a successful save; onClosed(): the window is gone (to give the focus back).
export function openMarksDialog({ journal, pair, onSaved, onClosed }) {
  document.getElementById('journal-marks')?.remove();
  const reasonMode = pair.mode === 'reason';
  const held = pair.status === 'running' || pair.status === 'closed';
  const maxActivity = journal.scheme.activity;
  const coat = coatAllowed(pair);
  const initial = draftMarks(journal, pair.id).map((m) => ({ ...m, activityText: m.activity === null ? '' : String(m.activity), activityBad: false }));
  const draft = initial.map((m) => ({ ...m }));
  let reason = '';
  let busy = false;
  let sent = [];

  const rows = draft.map((mark, index) => buildRow(mark, index));
  const problem = el('div', { class: 'mk-problem' });
  const reasonArea = el('textarea', {
    id: 'journal-marks-reason', name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': 'journal-marks-reason-hint journal-marks-reason-count', 'aria-required': 'true',
  });
  const reasonCount = el('span', { class: 'return-count', id: 'journal-marks-reason-count', 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
  const reasonError = el('p', { class: 'field__error', id: 'journal-marks-reason-error', hidden: true });

  const showReasonError = (key) => {
    reasonError.replaceChildren(icon('alert'), t(key));
    reasonError.hidden = false;
    reasonArea.setAttribute('aria-invalid', 'true');
    reasonArea.setAttribute('aria-describedby', 'journal-marks-reason-hint journal-marks-reason-count journal-marks-reason-error');
  };
  const clearReasonError = () => {
    reasonError.hidden = true;
    reasonArea.removeAttribute('aria-invalid');
    reasonArea.setAttribute('aria-describedby', 'journal-marks-reason-hint journal-marks-reason-count');
  };
  reasonArea.addEventListener('input', () => {
    reason = reasonArea.value;
    reasonCount.textContent = t('journal.marks.reason.count', { n: reason.length, max: REASON_MAX });
    clearReasonError();
  });

  function buildRow(mark, index) {
    const nameId = `journal-marks-name-${index}`;
    const buttons = STATUSES.map((status) => el('button', {
      type: 'button', class: 'mk-status__btn', 'data-status': status, 'aria-pressed': 'false',
      onclick: () => setStatus(index, status),
    }, t('journal.marks.status.' + status)));
    const coatBox = coat ? el('input', {
      type: 'checkbox', class: 'check__input mk-coat__box', id: `journal-marks-coat-${index}`, 'aria-describedby': nameId,
      onchange: () => { draft[index].noCoat = coatBox.checked; change(index); },
    }) : null;
    const activity = el('input', {
      type: 'number', class: 'field__input mk-act__input', id: `journal-marks-act-${index}`, min: '0', max: String(maxActivity), step: '1',
      inputmode: 'numeric', placeholder: t('journal.marks.activityPlaceholder', { max: maxActivity }), 'aria-describedby': nameId,
      oninput: () => setActivity(index, activity.value, activity.validity.badInput),
    });
    const error = el('p', { class: 'field__error mk-row__error', role: 'alert', hidden: true });
    const li = el('li', { class: 'mk-row', 'data-student': mark.studentId },
      el('span', { class: 'mk-row__name', id: nameId }, mark.fullName || '—'),
      el('div', { class: 'mk-status', role: 'group', 'aria-labelledby': nameId }, buttons),
      coat ? el('label', { class: 'mk-coat', for: coatBox.id }, coatBox, el('span', {}, t('journal.marks.coat'))) : null,
      el('label', { class: 'mk-act', for: activity.id }, el('span', { class: 'mk-act__label' }, t('journal.marks.activity')), activity),
      error);
    return { li, buttons, coatBox, activity, error };
  }

  // One row follows its mark: pressed button, the coat and the activity (both off for a student who was not there).
  function paint(index) {
    const mark = draft[index];
    const row = rows[index];
    for (const button of row.buttons) button.setAttribute('aria-pressed', String(button.dataset.status === mark.status));
    const was = !NOT_ATTENDED.includes(mark.status);
    if (row.coatBox) {
      row.coatBox.checked = mark.noCoat;
      row.coatBox.disabled = !was;
    }
    const allowed = activityAllowed(mark.status, pair);
    row.activity.disabled = !allowed;
    if (row.activity.value !== mark.activityText) row.activity.value = mark.activityText;
  }

  function clearRowError(index) {
    const row = rows[index];
    row.li.classList.remove('is-invalid');
    row.activity.removeAttribute('aria-invalid');
    row.error.hidden = true;
    row.error.replaceChildren();
  }

  function showRowError(index, key) {
    const row = rows[index];
    row.li.classList.add('is-invalid');
    row.error.replaceChildren(icon('alert'), t(key));
    row.error.hidden = false;
  }

  function change(index) {
    clearRowError(index);
    problem.replaceChildren();
    paint(index);
  }

  function setStatus(index, status) {
    if (busy) return;
    const mark = draft[index];
    mark.status = status;
    if (NOT_ATTENDED.includes(status)) { mark.noCoat = false; mark.activity = null; mark.activityText = ''; mark.activityBad = false; }
    change(index);
  }

  function setActivity(index, text, unreadable = false) {
    const mark = draft[index];
    mark.activityText = text;
    const clean = text.trim();
    mark.activityBad = unreadable || (clean !== '' && !(/^\d+$/.test(clean) && Number(clean) <= maxActivity));
    mark.activity = clean === '' || mark.activityBad ? null : Number(clean);
    clearRowError(index);
    problem.replaceChildren();
  }

  function allPresent() {
    if (busy) return;
    draft.forEach((mark, index) => { Object.assign(mark, { status: 'present', noCoat: false, activity: null, activityText: '', activityBad: false }); change(index); });
  }

  const isDirty = () => reason.trim() !== '' || draft.some((m, i) => (
    m.status !== initial[i].status || m.noCoat !== initial[i].noCoat || m.activityText !== initial[i].activityText || m.activityBad));

  // ---- the question when closing with unsaved marks ----
  const asking = el('div', { class: 'mk-ask', role: 'alert', hidden: true },
    el('p', { class: 'mk-ask__text' }, t('journal.marks.unsaved')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: 'journal-marks-stay', class: 'button button--secondary', onclick: () => { asking.hidden = true; actions.hidden = false; focusById('journal-marks-save'); } }, t('journal.marks.stay')),
      el('button', { type: 'button', id: 'journal-marks-discard', class: 'button button--danger', onclick: () => dialog.close() }, t('journal.marks.discard'))));
  const ask = () => {
    actions.hidden = true;
    asking.hidden = false;
    focusById('journal-marks-stay');
  };
  const tryClose = () => {
    if (busy) return;
    if (isDirty()) ask();
    else dialog.close();
  };

  const go = el('button', { type: 'button', id: 'journal-marks-save', class: 'button button--primary' }, icon('check'), t('common.save'));
  const actions = el('div', { class: 'dialog__actions mk-actions' },
    el('button', { type: 'button', id: 'journal-marks-cancel', class: 'button button--secondary', onclick: tryClose }, t('common.cancel')),
    go);

  const idle = () => {
    busy = false;
    go.classList.remove('is-busy');
    go.removeAttribute('aria-disabled');
    go.removeAttribute('aria-busy');
    go.replaceChildren(icon('check'), t('common.save'));
  };

  // What the server did not like: a row (by the place of the mark in the request), the reason, or the whole request.
  function showServerFields(fields) {
    const loose = [];
    for (const f of fields) {
      if (f.field === 'reason') { showReasonError(f.code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required'); continue; }
      const studentId = Number.isInteger(f.index) ? sent[f.index] : undefined;
      const index = draft.findIndex((m) => m.studentId === studentId);
      if (index >= 0) {
        showRowError(index, fieldErrorKey('marks', f.field, f.code, 'journal.marks'));
        if (f.field === 'activity') rows[index].activity.setAttribute('aria-invalid', 'true');
      } else loose.push(fieldErrorKey('marks', f.field, f.code, 'journal.marks'));
    }
    if (loose.length > 0) problem.replaceChildren(note('error', t(loose[0]), { role: 'alert' }));
    const first = dialog.querySelector('.mk-row.is-invalid') || dialog.querySelector('[aria-invalid="true"]');
    if (first) first.scrollIntoView({ block: 'nearest' });
  }

  async function save() {
    if (busy) return;
    problem.replaceChildren();
    const badRow = draft.findIndex((m) => m.activityBad);
    if (badRow >= 0) {
      showRowError(badRow, 'journal.marks.error.activity.bad_value');
      rows[badRow].activity.setAttribute('aria-invalid', 'true');
      rows[badRow].activity.focus();
      return;
    }
    const marks = changedMarks(draft, journal, pair.id);
    if (marks.length === 0) { dialog.close(); return; }
    const text = reason.trim();
    if (reasonMode) {
      if (text === '') { showReasonError('journal.marks.error.reason.required'); reasonArea.focus(); return; }
      if (text.length > REASON_MAX) { showReasonError('journal.marks.error.reason.too_long'); reasonArea.focus(); return; }
    }
    busy = true;
    sent = marks.map((m) => m.studentId);
    markBusy(go, 'common.saving');
    try {
      const data = await call('journal.savePair', reasonMode ? { pairId: pair.id, marks, reason: text } : { pairId: pair.id, marks });
      busy = false;
      if (!dialog.isConnected) return;
      dialog.close();
      onSaved(data);
    } catch (error) {
      if (!dialog.isConnected) return;
      idle();
      if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields.length > 0) showServerFields(error.fields);
      else problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    }
  }
  go.addEventListener('click', save);

  // Browser «Back» with unsaved changes: put the address back and ask, as Escape does; otherwise close as before.
  const openedAt = window.location.hash;
  const onHash = () => {
    if (window.location.hash === openedAt) return;
    if (!busy && isDirty()) { window.location.hash = openedAt; ask(); return; }
    dialog.close();
  };
  const kind = pair.lessonType ? t('lessonType.' + pair.lessonType) : t('journal.marks.kind.none');
  const topic = pair.topicName ? t('journal.topic', { n: pair.number, name: pair.topicName }) : t('journal.topicNone');
  const dialog = modal({
    id: 'journal-marks', labelledBy: 'journal-marks-title', className: 'dialog--marks',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => { if (busy) return false; if (isDirty()) { ask(); return false; } return true; },
  },
  el('div', { class: 'mk-head' },
    el('p', { class: 'dialog__kicker' }, t('journal.marks.when', { date: dateText(pair.date), slot: pair.slot, time: pair.startTime })),
    el('h2', { class: 'dialog__title', id: 'journal-marks-title' }, t('journal.marks.title')),
    el('p', { class: 'mk-topic' }, badge(kind, pair.lessonType === 'control' ? 'primary' : 'neutral'), el('span', {}, topic))),
  held ? null : el('div', { class: 'mk-hint' },
    el('p', { class: 'mk-hint__text' }, t('journal.marks.hint')),
    el('button', { type: 'button', id: 'journal-marks-all', class: 'button button--secondary', onclick: allPresent }, t('journal.marks.allPresent'))),
  rows.length === 0
    ? el('p', { class: 'mk-empty' }, t('journal.emptyStudents'))
    : el('ul', { class: 'mk-list', 'aria-label': t('journal.marks.list') }, rows.map((row) => row.li)),
  reasonMode ? el('div', { class: 'field mk-reason' },
    el('label', { class: 'field__label', for: 'journal-marks-reason' }, t('journal.marks.reason.label')),
    el('p', { class: 'field__hint', id: 'journal-marks-reason-hint' }, t('journal.marks.reason.hint')),
    el('div', { class: 'field__control' }, reasonArea),
    el('div', { class: 'return-under' }, reasonError, reasonCount)) : null,
  problem,
  actions,
  asking);
  draft.forEach((_, index) => paint(index));
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById(held ? 'journal-marks-cancel' : 'journal-marks-all', 'journal-marks-cancel');
}

// ---- The window of a deanery action on a pair: «Не проведена», «Вернуть в расписание», «Сбросить отметки» ----

const ACTION_CALL = { miss: 'journal.missPair', reopen: 'journal.reopenPair', clear: 'journal.reopenPair' };

// action: 'miss' | 'reopen' | 'clear' (see pairActions); the reason is always required. onSaved(data) gets the new journal answer
// and is called before anything that touches the window (the grid is drawn again from it); onClosed() gives the focus back.
export function openPairActionDialog({ pair, action, onSaved, onClosed }) {
  document.getElementById('journal-action')?.remove();
  let busy = false;
  const reasonArea = el('textarea', {
    id: 'journal-action-reason', name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': 'journal-action-reason-hint journal-action-reason-count', 'aria-required': 'true',
  });
  const reasonCount = el('span', { class: 'return-count', id: 'journal-action-reason-count', 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
  const reasonError = el('p', { class: 'field__error', id: 'journal-action-reason-error', hidden: true });
  const problem = el('div', { class: 'mk-problem' });

  const showReasonError = (key) => {
    reasonError.replaceChildren(icon('alert'), t(key));
    reasonError.hidden = false;
    reasonArea.setAttribute('aria-invalid', 'true');
    reasonArea.setAttribute('aria-describedby', 'journal-action-reason-hint journal-action-reason-count journal-action-reason-error');
  };
  const clearReasonError = () => {
    reasonError.hidden = true;
    reasonArea.removeAttribute('aria-invalid');
    reasonArea.setAttribute('aria-describedby', 'journal-action-reason-hint journal-action-reason-count');
  };
  reasonArea.addEventListener('input', () => {
    reasonCount.textContent = t('journal.marks.reason.count', { n: reasonArea.value.length, max: REASON_MAX });
    clearReasonError();
    problem.replaceChildren();
  });

  const goLabel = t(`journal.action.${action}.go`);
  const go = el('button', { type: 'button', id: 'journal-action-go', class: `button ${action === 'clear' ? 'button--danger' : 'button--primary'}` }, goLabel);

  async function save() {
    if (busy) return;
    problem.replaceChildren();
    const text = reasonArea.value.trim();
    if (text === '') { showReasonError('journal.marks.error.reason.required'); reasonArea.focus(); return; }
    if (text.length > REASON_MAX) { showReasonError('journal.marks.error.reason.too_long'); reasonArea.focus(); return; }
    busy = true;
    markBusy(go, 'common.saving');
    try {
      const data = await call(ACTION_CALL[action], { pairId: pair.id, reason: text });
      busy = false;
      onSaved(data);
      if (!dialog.isConnected) return;
      dialog.close();
    } catch (error) {
      if (!dialog.isConnected) return;
      busy = false;
      go.classList.remove('is-busy');
      go.removeAttribute('aria-disabled');
      go.removeAttribute('aria-busy');
      go.textContent = goLabel;
      const reasonField = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields.find((f) => f.field === 'reason') : null;
      if (reasonField) { showReasonError(reasonField.code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required'); reasonArea.focus(); }
      else problem.replaceChildren(note('error', t(errorKey(error.code)), { role: 'alert' }));
    }
  }
  go.addEventListener('click', save);

  const onHash = () => dialog.close();
  const kind = pair.lessonType ? t('lessonType.' + pair.lessonType) : t('journal.marks.kind.none');
  const topic = pair.topicName ? t('journal.topic', { n: pair.number, name: pair.topicName }) : t('journal.topicNone');
  const dialog = modal({
    id: 'journal-action', labelledBy: 'journal-action-title', className: 'dialog--action',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => !busy,
  },
  el('div', { class: 'mk-head' },
    el('p', { class: 'dialog__kicker' }, t('journal.marks.when', { date: dateText(pair.date), slot: pair.slot, time: pair.startTime })),
    el('h2', { class: 'dialog__title', id: 'journal-action-title' }, t(`journal.action.${action}.title`)),
    el('p', { class: 'mk-topic' }, badge(kind, pair.lessonType === 'control' ? 'primary' : 'neutral'), el('span', {}, topic))),
  note(action === 'clear' ? 'warning' : 'info', t(`journal.action.${action}.note`), { id: 'journal-action-note' }),
  el('div', { class: 'field mk-reason' },
    el('label', { class: 'field__label', for: 'journal-action-reason' }, t('journal.marks.reason.label')),
    el('p', { class: 'field__hint', id: 'journal-action-reason-hint' }, t('journal.action.reason.hint')),
    el('div', { class: 'field__control' }, reasonArea),
    el('div', { class: 'return-under' }, reasonError, reasonCount)),
  problem,
  el('div', { class: 'dialog__actions mk-actions' },
    el('button', { type: 'button', id: 'journal-action-cancel', class: 'button button--secondary', onclick: () => { if (!busy) dialog.close(); } }, t('common.cancel')),
    go));
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById('journal-action-reason');
}

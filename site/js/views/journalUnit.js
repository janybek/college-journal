import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, fieldErrorKey, badge, focusById, markBusy, modal, note } from '../ui.js';
import { icon } from '../icons.js';
import { needsReason, parsePoints, resultItems, savedResult } from '../journal.js';

// The windows of the results of a unit on the journal screen (only for those who may enter them: journal.can.results):
//  - openUnitDialog: the unit control or the self-work of every student of the group, one request for the changed rows;
//  - openCurrentDialog: the manual current-control points of one student (always with a reason), or back to the calculated.
// The reason is asked as the server does (needsReason). After a save the window closes and the grid is drawn from the answer.
// Names, reasons and values are put on the page only as text.

const REASON_MAX = 300;
const text = (value) => (value === null || value === undefined ? '' : String(value));

// The reason field of a window: label, counter, error line. Hidden until it is needed.
function reasonField(prefix) {
  const area = el('textarea', {
    id: `${prefix}-reason`, name: 'reason', class: 'field__input field__textarea', rows: '3', maxlength: String(REASON_MAX),
    'aria-describedby': `${prefix}-reason-hint ${prefix}-reason-count`, 'aria-required': 'true',
  });
  const hint = el('p', { class: 'field__hint', id: `${prefix}-reason-hint` });
  const count = el('span', { class: 'return-count', id: `${prefix}-reason-count`, 'aria-live': 'polite' }, t('journal.marks.reason.count', { n: 0, max: REASON_MAX }));
  const error = el('p', { class: 'field__error', id: `${prefix}-reason-error`, hidden: true });
  const node = el('div', { class: 'field mk-reason', hidden: true },
    el('label', { class: 'field__label', for: `${prefix}-reason` }, t('journal.marks.reason.label')),
    hint,
    el('div', { class: 'field__control' }, area),
    el('div', { class: 'return-under' }, error, count));
  const api = {
    node, area,
    value: () => area.value.trim(),
    show(visible, hintKey) { node.hidden = !visible; if (hintKey) hint.textContent = t(hintKey); },
    visible: () => !node.hidden,
    clearError() {
      error.hidden = true;
      area.removeAttribute('aria-invalid');
      area.setAttribute('aria-describedby', `${prefix}-reason-hint ${prefix}-reason-count`);
    },
    showError(key) {
      error.replaceChildren(icon('alert'), t(key));
      error.hidden = false;
      area.setAttribute('aria-invalid', 'true');
      area.setAttribute('aria-describedby', `${prefix}-reason-hint ${prefix}-reason-count ${prefix}-reason-error`);
    },
    // a reason of the right length, or an error at the field
    check() {
      const value = area.value.trim();
      if (value === '') { api.showError('journal.marks.error.reason.required'); area.focus(); return null; }
      if (value.length > REASON_MAX) { api.showError('journal.marks.error.reason.too_long'); area.focus(); return null; }
      return value;
    },
  };
  area.addEventListener('input', () => {
    count.textContent = t('journal.marks.reason.count', { n: area.value.length, max: REASON_MAX });
    api.clearError();
  });
  return api;
}

// The question «close without saving?» that replaces the buttons.
function closeQuestion(prefix, actions, dialogOf, focusBack) {
  const asking = el('div', { class: 'mk-ask', role: 'alert', hidden: true },
    el('p', { class: 'mk-ask__text' }, t('journal.unit.unsaved')),
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: `${prefix}-stay`, class: 'button button--secondary', onclick: () => { asking.hidden = true; actions.hidden = false; focusById(focusBack, `${prefix}-cancel`); } }, t('journal.unit.stay')),
      el('button', { type: 'button', id: `${prefix}-discard`, class: 'button button--danger', onclick: () => dialogOf().close() }, t('journal.unit.discard'))));
  return {
    node: asking,
    ask() { actions.hidden = true; asking.hidden = false; focusById(`${prefix}-stay`); },
  };
}

// Puts the answer of a failed save into the window: fields of rows, the reason, or a note.
function failure(error, { problem, reason, rowError }) {
  const loose = [];
  if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields.length > 0) {
    for (const f of error.fields) {
      if (f.field === 'reason') reason.showError(f.code === 'too_long' ? 'journal.marks.error.reason.too_long' : 'journal.marks.error.reason.required');
      else if (f.field === 'value' && Number.isInteger(f.index) && rowError(f.index)) continue;
      else loose.push(fieldErrorKey('unitResults', f.field, f.code, 'journal.unit'));
    }
  } else loose.push(errorKey(error.code));
  if (loose.length > 0) problem.replaceChildren(note('error', t(loose[0]), { role: 'alert' }));
}

// ---- The unit control and the self-work of the whole group ----

// journal: the answer of journal.get; unit: its number; field: 'control' | 'self'; isOwn: the person is the teacher of the subject;
// onSaved(data): the new answer; onClosed(): the window is gone (to give the focus back).
export function openUnitDialog({ journal: first, unit, field, isOwn, onSaved, onClosed }) {
  document.getElementById('journal-unit')?.remove();
  const journal = first;
  let busy = false;
  const max = journal.scheme[field];
  const minimum = field === 'control' ? journal.scheme.minimum : null;
  const students = journal.students.filter((s) => !s.left);
  const uid = (id) => `journal-unit-${id}`;

  // the draft: the text of the field of every student
  const baseline = () => new Map(students.map((s) => [s.id, text(savedResult(journal, s.id, unit, field))]));
  const start = baseline();
  const typed = new Map(start);

  const inputs = new Map();
  const errors = new Map();
  const lows = new Map();
  const problem = el('div', { class: 'mk-problem' });
  const reason = reasonField('journal-unit');
  const actions = el('div', { class: 'dialog__actions mk-actions' });

  // the values that parse; the list of those that do not
  const parsed = () => {
    const draft = new Map();
    const bad = [];
    for (const s of students) {
      const value = parsePoints(typed.get(s.id), max);
      if (value === undefined) bad.push(s.id); else draft.set(s.id, value);
    }
    return { draft, bad };
  };
  const pending = () => resultItems(parsed().draft, journal, unit, field);
  const isDirty = () => students.some((s) => typed.get(s.id) !== start.get(s.id)) || reason.value() !== '';
  const reasonNeeded = () => {
    const items = pending();
    return items.length > 0 && needsReason(items, journal, unit, field, isOwn);
  };

  function paintRow(id) {
    const value = parsePoints(typed.get(id), max);
    const bad = value === undefined;
    const input = inputs.get(id);
    input.classList.toggle('is-low', minimum !== null && value !== undefined && value !== null && value < minimum);
    lows.get(id).hidden = !(minimum !== null && value !== undefined && value !== null && value < minimum);
    if (!bad) { errors.get(id).hidden = true; input.removeAttribute('aria-invalid'); }
  }

  function paintReason() {
    const needed = reasonNeeded();
    reason.show(needed, isOwn ? 'journal.unit.reasonHint.change' : 'journal.unit.reasonHint.office');
  }

  const showRowError = (id) => {
    const message = errors.get(id);
    message.replaceChildren(icon('alert'), t('journal.unit.error.bad', { max }));
    message.hidden = false;
    inputs.get(id).setAttribute('aria-invalid', 'true');
  };

  function rowOf(student) {
    const input = el('input', {
      type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'field__input ju-input', id: uid(student.id),
      value: typed.get(student.id), placeholder: t('journal.unit.notSet'), 'aria-describedby': `${uid(student.id)}-error`,
    });
    input.addEventListener('input', () => {
      typed.set(student.id, input.value);
      problem.replaceChildren();
      reason.clearError();
      paintRow(student.id);
      paintReason();
    });
    inputs.set(student.id, input);
    const error = el('p', { class: 'field__error ju-row__error', id: `${uid(student.id)}-error`, role: 'alert', hidden: true });
    errors.set(student.id, error);
    const low = badge(t('journal.unit.low'), 'danger');
    low.hidden = true;
    lows.set(student.id, low);
    return el('li', { class: 'ju-row' },
      el('div', { class: 'ju-row__who' }, el('label', { class: 'ju-row__name', for: uid(student.id) }, student.fullName || '—'), low),
      el('div', { class: 'ju-row__field' }, input, el('span', { class: 'ju-row__of' }, t('journal.unit.of', { max }))),
      error);
  }

  const list = el('ol', { class: 'ju-list', id: 'journal-unit-list' }, students.map(rowOf));
  for (const s of students) paintRow(s.id);

  let go;
  const idle = () => {
    busy = false;
    for (const input of inputs.values()) input.disabled = false;
    reason.area.disabled = false;
    go.classList.remove('is-busy');
    go.removeAttribute('aria-disabled');
    go.removeAttribute('aria-busy');
    go.replaceChildren(icon('check'), t('common.save'));
  };

  async function save() {
    if (busy) return;
    problem.replaceChildren();
    reason.clearError();
    const { draft, bad } = parsed();
    if (bad.length > 0) {
      for (const id of bad) showRowError(id);
      inputs.get(bad[0]).focus();
      return;
    }
    const items = resultItems(draft, journal, unit, field);
    if (items.length === 0) { dialog.close(); return; }
    const needed = needsReason(items, journal, unit, field, isOwn);
    let why = '';
    if (needed) {
      why = reason.check();
      if (why === null) return;
    }
    busy = true;
    for (const input of inputs.values()) input.disabled = true;
    reason.area.disabled = true;
    markBusy(go, 'common.saving');
    try {
      const data = await call('journal.saveResults', {
        subjectId: journal.subject.id, unit, field, items, ...(needed ? { reason: why } : {}),
      });
      busy = false;
      onSaved(data);
      if (dialog.isConnected) dialog.close();
    } catch (error) {
      if (!dialog.isConnected) { busy = false; return; }
      idle();
      failure(error, {
        problem, reason,
        rowError: (index) => {
          const item = items[index];
          if (!item || !errors.has(item.studentId)) return false;
          showRowError(item.studentId);
          return true;
        },
      });
    }
  }

  go = el('button', { type: 'button', id: 'journal-unit-save', class: 'button button--primary', onclick: save }, icon('check'), t('common.save'));
  actions.append(el('button', { type: 'button', id: 'journal-unit-cancel', class: 'button button--secondary', onclick: tryClose }, t('common.cancel')), go);
  const question = closeQuestion('journal-unit', actions, () => dialog, 'journal-unit-save');
  function tryClose() {
    if (busy) return;
    if (isDirty()) question.ask(); else dialog.close();
  }

  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'journal-unit', labelledBy: 'journal-unit-title', className: 'dialog--cell dialog--unit',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => { if (busy) return false; if (isDirty()) { question.ask(); return false; } return true; },
  },
  el('div', { class: 'mk-head' },
    el('p', { class: 'dialog__kicker' }, `${journal.subject.name} · ${journal.subject.groupName}`),
    el('h2', { class: 'dialog__title', id: 'journal-unit-title' }, t('journal.unit.title.' + field, { n: unit })),
    el('p', { class: 'mk-topic' }, el('span', {}, t('journal.unit.hint', { max })))),
  list,
  reason.node,
  problem,
  actions,
  question.node);
  paintReason();
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  const firstEmpty = students.find((s) => typed.get(s.id) === '') || students[0];
  if (firstEmpty) focusById(uid(firstEmpty.id), 'journal-unit-cancel'); else focusById('journal-unit-cancel');
}

// ---- The manual current-control points of one student ----

// student: {id, fullName}; the rest as for openUnitDialog.
export function openCurrentDialog({ journal: first, unit, student, onSaved, onClosed }) {
  document.getElementById('journal-current')?.remove();
  const journal = first;
  let busy = false;
  const max = journal.scheme.current;
  const rowNow = () => {
    const result = journal.results[student.id];
    return (result && result.units.find((u) => u.unit === unit)) || { auto: null, manual: null, earned: 0, possible: 0 };
  };
  const manualNow = () => savedResult(journal, student.id, unit, 'current');
  let typed = text(manualNow());
  const start = typed;

  const row = rowNow();
  const calc = row.auto !== null
    ? t('journal.unit.calc.value', { auto: row.auto, max, earned: row.earned, possible: row.possible })
    : t('journal.unit.calc.none');
  const summary = el('div', { class: 'cl-summary' },
    el('p', { class: 'cl-now' }, el('span', { class: 'cl-now__label' }, t('journal.unit.calc.label')), el('span', { class: 'cl-points', id: 'journal-current-calc' }, calc)),
    el('p', { class: 'cl-points', id: 'journal-current-now' }, manualNow() !== null ? t('journal.unit.manual.now', { n: manualNow(), max }) : t('journal.unit.manual.none')));

  const input = el('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', class: 'field__input ju-input', id: 'journal-current-input',
    value: typed, 'aria-describedby': 'journal-current-hint journal-current-error',
  });
  const error = el('p', { class: 'field__error', id: 'journal-current-error', role: 'alert', hidden: true });
  const showError = () => {
    error.replaceChildren(icon('alert'), t('journal.unit.error.bad', { max }));
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  };
  const reason = reasonField('journal-current');
  reason.show(true, 'journal.unit.reasonHint.current');
  const problem = el('div', { class: 'mk-problem' });
  const actions = el('div', { class: 'dialog__actions mk-actions' });
  const isDirty = () => input.value.trim() !== start.trim() || reason.value() !== '';
  input.addEventListener('input', () => { typed = input.value; error.hidden = true; input.removeAttribute('aria-invalid'); problem.replaceChildren(); reason.clearError(); });

  let go;
  let resetButton = null;
  const buttons = () => [go, resetButton].filter(Boolean);
  const idle = () => {
    busy = false;
    input.disabled = false;
    reason.area.disabled = false;
    for (const b of buttons()) { b.classList.remove('is-busy'); b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); }
    go.replaceChildren(icon('check'), t('common.save'));
    if (resetButton) resetButton.replaceChildren(t('journal.unit.reset'));
  };

  // value: the number to set or null (back to the calculated)
  async function send(value, busyButton) {
    if (busy) return;
    problem.replaceChildren();
    const items = resultItems(new Map([[student.id, value]]), journal, unit, 'current');
    if (items.length === 0) { dialog.close(); return; }
    const why = reason.check();
    if (why === null) return;
    busy = true;
    input.disabled = true;
    reason.area.disabled = true;
    for (const b of buttons()) b.setAttribute('aria-disabled', 'true');
    markBusy(busyButton, 'common.saving');
    try {
      const data = await call('journal.saveResults', { subjectId: journal.subject.id, unit, field: 'current', items, reason: why });
      busy = false;
      onSaved(data);
      if (dialog.isConnected) dialog.close();
    } catch (failed) {
      if (!dialog.isConnected) { busy = false; return; }
      idle();
      failure(failed, { problem, reason, rowError: () => { showError(); return true; } });
    }
  }

  function save() {
    const value = parsePoints(typed, max);
    if (value === undefined || value === null) { showError(); input.focus(); return; }
    send(value, go);
  }

  go = el('button', { type: 'button', id: 'journal-current-save', class: 'button button--primary', onclick: save }, icon('check'), t('common.save'));
  if (manualNow() !== null) resetButton = el('button', { type: 'button', id: 'journal-current-reset', class: 'button button--secondary', onclick: () => send(null, resetButton) }, t('journal.unit.reset'));
  actions.append(el('button', { type: 'button', id: 'journal-current-cancel', class: 'button button--secondary', onclick: tryClose }, t('common.cancel')), ...[resetButton, go].filter(Boolean));
  const question = closeQuestion('journal-current', actions, () => dialog, 'journal-current-save');
  function tryClose() {
    if (busy) return;
    if (isDirty()) question.ask(); else dialog.close();
  }

  const onHash = () => dialog.close();
  const dialog = modal({
    id: 'journal-current', labelledBy: 'journal-current-title', className: 'dialog--cell dialog--unit',
    onClose: () => {
      window.removeEventListener('hashchange', onHash);
      dialog.remove();
      if (onClosed) onClosed();
    },
    canCancel: () => { if (busy) return false; if (isDirty()) { question.ask(); return false; } return true; },
  },
  el('div', { class: 'mk-head' },
    el('p', { class: 'dialog__kicker' }, `${t('journal.unit.title.current', { n: unit })} · ${journal.subject.name}`),
    el('h2', { class: 'dialog__title', id: 'journal-current-title' }, student.fullName || '—')),
  summary,
  el('div', { class: 'field' },
    el('label', { class: 'field__label', for: 'journal-current-input' }, t('journal.unit.manual.label')),
    el('p', { class: 'field__hint', id: 'journal-current-hint' }, t('journal.unit.manual.hint', { max })),
    el('div', { class: 'ju-row__field' }, input, el('span', { class: 'ju-row__of' }, t('journal.unit.of', { max }))),
    error),
  reason.node,
  problem,
  actions,
  question.node);
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  focusById('journal-current-input', 'journal-current-cancel');
}

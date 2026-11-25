import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, badge, focusById, focusFirstInvalid, markBusy, modal, note, searchField } from '../ui.js';
import { icon } from '../icons.js';
import { prevLine, retakesLeft, enrolDraft } from '../repeat.js';

// «Записать на повтор»: one window, three steps — the subject, the student (with the previous result), the terms.
// The deanery only (repeat.candidates / repeat.enrol; the server checks it again). Names are only ever text.

// ---- Parts shared with the card (the window of «Изменить») ----

export function dialogShell(id, onClose, className, ...children) {
  document.getElementById(id)?.remove();
  const onHash = () => dialog.close();
  const dialog = modal({
    id, labelledBy: id + '-title', className,
    onClose: () => { window.removeEventListener('hashchange', onHash); dialog.remove(); onClose(); },
  }, ...children);
  window.addEventListener('hashchange', onHash);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// A labelled control whose error line is shown and cleared in place (no redraw: the caret stays).
export function fieldBox({ id, label, hint = null, control, input = control }) {
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

export const fieldMessage = (field, code) => (hasText(`repeat.error.${field}.${code}`) ? t(`repeat.error.${field}.${code}`) : t(errorKey(code)));

// The fields of a refused request: those that have a box get their line, the rest become one note. Returns that note's text or null.
export function showProblems(error, boxes) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  let loose = fields.length === 0 ? t(errorKey(error.code)) : null;
  for (const { field, code } of fields) {
    if (boxes[field]) boxes[field].set(fieldMessage(field, code));
    else loose = loose || fieldMessage(field, code);
  }
  return loose;
}

export function resetBusy(button, textKey) {
  button.removeAttribute('aria-busy');
  button.removeAttribute('aria-disabled');
  button.classList.remove('is-busy');
  button.textContent = t(textKey);
}

// The fields of the terms: the kind (only when `kind` is given), the order, the deadline, the teacher.
// draft: { kind, orderNo, orderDate, deadline, teacherId }; teachers: [{ id, fullName }]; kind: { examLocked } or null.
export function termsFields(prefix, draft, teachers, kind) {
  const boxes = {};
  const nodes = [];
  let kindSelect = null;
  if (kind) {
    kindSelect = el('select', { class: 'field__input field__select', id: prefix + '-kind', name: 'kind' },
      el('option', { value: 'full' }, t('repeat.kind.full')),
      el('option', { value: 'exam', disabled: kind.examLocked ? '' : null }, t('repeat.kind.exam')));
    kindSelect.value = draft.kind;
    boxes.kind = fieldBox({ id: prefix + '-kind', label: t('repeat.field.kind'), hint: kind.examLocked ? t('repeat.kind.examLocked') : null, control: kindSelect });
    kindSelect.addEventListener('change', () => boxes.kind.set(null));
    nodes.push(boxes.kind.root);
  }
  const orderNo = el('input', { type: 'text', class: 'field__input', id: prefix + '-order-no', name: 'orderNo', maxlength: '40', autocomplete: 'off', value: draft.orderNo });
  boxes.orderNo = fieldBox({ id: prefix + '-order-no', label: t('repeat.field.orderNo'), control: orderNo });
  const orderDate = el('input', { type: 'date', class: 'field__input', id: prefix + '-order-date', name: 'orderDate', value: draft.orderDate });
  boxes.orderDate = fieldBox({ id: prefix + '-order-date', label: t('repeat.field.orderDate'), control: orderDate });
  const deadline = el('input', { type: 'date', class: 'field__input', id: prefix + '-deadline', name: 'deadline', value: draft.deadline });
  boxes.deadline = fieldBox({ id: prefix + '-deadline', label: t('repeat.field.deadline'), hint: t('repeat.field.deadlineHint'), control: deadline });
  const teacher = el('select', { class: 'field__input field__select', id: prefix + '-teacher', name: 'teacherId' },
    teachers.map((p) => el('option', { value: p.id }, p.fullName)));
  teacher.value = draft.teacherId;
  boxes.teacherId = fieldBox({ id: prefix + '-teacher', label: t('repeat.field.teacher'), hint: kind ? t('repeat.field.teacherHint') : null, control: teacher });
  orderNo.addEventListener('input', () => boxes.orderNo.set(null));
  orderDate.addEventListener('input', () => boxes.orderDate.set(null));
  deadline.addEventListener('input', () => boxes.deadline.set(null));
  teacher.addEventListener('change', () => boxes.teacherId.set(null));
  nodes.push(boxes.orderNo.root, el('div', { class: 'rp-pair' }, boxes.orderDate.root, boxes.deadline.root), boxes.teacherId.root);
  const values = () => ({
    ...(kindSelect ? { kind: kindSelect.value } : {}),
    orderNo: orderNo.value, orderDate: orderDate.value, deadline: deadline.value, teacherId: teacher.value,
  });
  return { nodes, boxes, values };
}

// ---- The window ----

// replaceChildren writes a null as the word «null»: the empty places are dropped first.
const filled = (...nodes) => nodes.filter((node) => node !== null && node !== undefined);

const matches = (text, query) => String(text).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

// today: «сегодня» of the server's answer. Opens the window; on success the card of the new repeat is opened.
export function openEnrol({ today, onClose }) {
  const w = {
    step: 1, subjects: null, split: null, subjectQuery: '', subject: null, answer: null, half: null, studentQuery: '', student: null, loadKey: null, busy: false,
  };
  const body = el('div', { class: 'rp-steps' });
  const dialog = dialogShell('repeat-enrol-dialog', onClose, 'rp-dialog', el('h2', { class: 'dialog__title', id: 'repeat-enrol-dialog-title' }, t('repeat.enrol.title')), body);

  const head = (n) => el('p', { class: 'dialog__kicker rp-kicker' }, t('repeat.enrol.step', { n }));
  const cancel = () => el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-enrol-cancel', onclick: () => dialog.close() }, t('common.cancel'));

  function draw() {
    if (w.step === 1) stepSubject();
    else if (w.step === 2) stepStudent();
    else stepTerms();
  }

  // Step 1: the subject
  async function loadSubjects() {
    try {
      // The maxima of the points come from the scoring settings (the answer of the candidates has none).
      const [data, scoring] = await Promise.all([call('repeat.candidates', {}), call('scoring.get', {})]);
      if (!dialog.isConnected) return;
      w.subjects = data.subjects;
      w.split = scoring.split;
      w.loadKey = null;
    } catch (error) {
      if (!dialog.isConnected) return;
      w.loadKey = errorKey(error.code);
    }
    draw();
  }

  function stepSubject() {
    const list = el('ul', { class: 'rp-list', id: 'repeat-subjects' });
    const fill = () => {
      if (w.subjects === null) { list.replaceChildren(...(w.loadKey ? [] : [el('li', { class: 'rp-list__note' }, t('common.loading'))])); return; }
      const shown = w.subjects.filter((s) => w.subjectQuery.trim() === '' || matches(s.name, w.subjectQuery) || matches(s.groupName, w.subjectQuery));
      if (shown.length === 0) {
        list.replaceChildren(el('li', { class: 'rp-list__note', id: 'repeat-subjects-empty' }, t(w.subjects.length === 0 ? 'repeat.enrol.noSubjects' : 'repeat.enrol.noMatch')));
        return;
      }
      list.replaceChildren(...shown.map((s) => el('li', {},
        el('button', { type: 'button', class: 'rp-pick', id: 'repeat-subject-' + s.subjectId, onclick: () => pickSubject(s) },
          el('span', { class: 'rp-pick__main' }, `${s.name} · ${s.groupName || '—'}`),
          el('span', { class: 'rp-pick__sub' }, [s.teacherName, ...s.halves.map((n) => t('repeat.semesterOf', { n }))].filter(Boolean).join(' · ')),
          icon('chevron', 'rp-pick__go')))));
    };
    const search = searchField({ id: 'repeat-subject-search', label: t('repeat.enrol.search'), value: w.subjectQuery, onInput: (value) => { w.subjectQuery = value; fill(); } });
    fill();
    body.replaceChildren(...filled(head(1), el('h3', { class: 'rp-step' }, t('repeat.enrol.subject')), search,
      w.loadKey ? note('error', t(w.loadKey), { role: 'alert' }) : null, list,
      el('div', { class: 'dialog__actions' }, cancel())));
    focusById('repeat-subject-search');
  }

  async function pickSubject(subject) {
    if (w.busy) return;
    w.busy = true;
    try {
      const answer = await call('repeat.candidates', { subjectId: subject.subjectId });
      if (!dialog.isConnected) return;
      w.subject = subject;
      w.answer = answer;
      const current = answer.halves.find((h) => h.current) || answer.halves[0];
      w.half = current ? current.planSemester : null;
      w.studentQuery = '';
      w.loadKey = null;
      w.step = 2;
    } catch (error) {
      if (!dialog.isConnected) return;
      w.loadKey = errorKey(error.code);
    } finally {
      w.busy = false;
    }
    draw();
  }

  // Step 2: the half-year and the student
  const halfOf = () => w.answer.halves.find((h) => h.planSemester === w.half) || null;

  function stepStudent() {
    const list = el('ul', { class: 'rp-list', id: 'repeat-students' });
    const fill = () => {
      const half = halfOf();
      const all = half ? half.students : [];
      const shown = all.filter((s) => w.studentQuery.trim() === '' || matches(s.fullName, w.studentQuery));
      if (shown.length === 0) {
        list.replaceChildren(el('li', { class: 'rp-list__note', id: 'repeat-students-empty' }, t(all.length === 0 ? 'repeat.enrol.noStudents' : 'repeat.enrol.noMatch')));
        return;
      }
      list.replaceChildren(...shown.map((s) => studentItem(s, w.split)));
    };
    const halves = w.answer.halves.length > 1
      ? el('div', { class: 'rp-halves', role: 'group', 'aria-label': t('repeat.enrol.half') }, w.answer.halves.map((h) => el('button', {
        type: 'button', class: 'button button--small ' + (h.planSemester === w.half ? 'button--primary' : 'button--secondary'), id: 'repeat-half-' + h.planSemester,
        'aria-pressed': h.planSemester === w.half ? 'true' : 'false',
        onclick: () => { w.half = h.planSemester; draw(); },
      }, t('repeat.semesterOf', { n: h.planSemester }) + (h.current ? ' · ' + t('repeat.enrol.halfCurrent') : ''))))
      : null;
    const search = searchField({ id: 'repeat-student-search', label: t('repeat.enrol.studentSearch'), value: w.studentQuery, onInput: (value) => { w.studentQuery = value; fill(); } });
    fill();
    body.replaceChildren(...filled(head(2),
      el('h3', { class: 'rp-step' }, t('repeat.enrol.student')),
      el('p', { class: 'rp-subject', id: 'repeat-enrol-subject' }, `${w.answer.subject.name} · ${w.answer.subject.groupName || '—'}`),
      halves, search, list,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-enrol-prev', onclick: () => { w.step = 1; draw(); } }, t('repeat.enrol.prev')),
        cancel())));
    focusById('repeat-student-search');
  }

  function studentItem(s, split) {
    const line = prevLine(s.prev, split);
    const busy = s.blocked === 'has_open';
    const left = retakesLeft(s.prev);
    const button = el('button', {
      type: 'button', class: 'rp-pick' + (busy ? ' is-busy' : ''), id: 'repeat-student-' + s.id, 'aria-disabled': busy ? 'true' : null,
      onclick: () => { if (!busy) pickStudent(s); },
    },
    el('span', { class: 'rp-pick__main' }, s.fullName),
    el('span', { class: 'rp-pick__sub' }, t(line.key, line.params)),
    busy ? badge(t('repeat.enrol.busy'), 'warning', true) : (left > 0 ? badge(t('repeat.enrol.retakes', { n: left }), 'neutral') : null),
    busy ? null : icon('chevron', 'rp-pick__go'));
    return el('li', {}, button);
  }

  function pickStudent(student) {
    w.student = student;
    w.step = 3;
    draw();
  }

  // Step 3: the terms
  function stepTerms() {
    const { answer, student } = w;
    const draft = enrolDraft(student, answer.subject, today);
    const terms = termsFields('repeat-enrol', draft, answer.teachers, { examLocked: student.prev.admitted !== true });
    const line = prevLine(student.prev, w.split);
    const problem = el('div', { class: 'mk-problem' });
    const submit = el('button', { type: 'button', class: 'button button--primary', id: 'repeat-enrol-submit' }, t('repeat.enrol.submit'));
    submit.addEventListener('click', async () => {
      if (w.busy) return;
      w.busy = true;
      problem.replaceChildren();
      for (const box of Object.values(terms.boxes)) box.set(null);
      markBusy(submit, 'repeat.enrol.busyButton');
      try {
        const { repeat } = await call('repeat.enrol', { subjectId: answer.subject.id, planSemester: w.half, studentId: student.id, ...terms.values() });
        if (!dialog.isConnected) return;
        dialog.close();
        location.hash = '#/repeat/' + encodeURIComponent(repeat.id);
      } catch (error) {
        if (!dialog.isConnected) return;
        w.busy = false;
        resetBusy(submit, 'repeat.enrol.submit');
        const loose = showProblems(error, terms.boxes);
        if (loose) problem.replaceChildren(note('error', loose, { role: 'alert' }));
        focusFirstInvalid();
        return;
      }
      w.busy = false;
    });
    body.replaceChildren(...filled(head(3),
      el('h3', { class: 'rp-step' }, t('repeat.enrol.terms')),
      el('div', { class: 'rp-summary' },
        el('p', { class: 'rp-summary__name', id: 'repeat-enrol-student' }, student.fullName),
        el('p', { class: 'rp-summary__sub' }, `${answer.subject.name} · ${answer.subject.groupName || '—'} · ${t('repeat.semesterOf', { n: w.half })}`),
        el('p', { class: 'rp-summary__sub' }, t(line.key, line.params))),
      student.suggest === 'full' ? note('info', t('repeat.kind.suggest'), { id: 'repeat-enrol-suggest' }) : null,
      ...terms.nodes, problem,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', id: 'repeat-enrol-prev', onclick: () => { w.step = 2; draw(); } }, t('repeat.enrol.prev')),
        cancel(), submit)));
    focusById('repeat-enrol-kind');
  }

  draw();
  loadSubjects();
  return dialog;
}

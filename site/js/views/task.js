import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader, note, field, markBusy, focusFirstInvalid, holdOnLeave, modal, showModal, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { dueText, stateView, sizeText, formProblems, currentOf, gradeDraft, gradeNeedsReason } from '../work.js';
import { openTaskForm } from './taskForm.js';
import { openFile } from './fileView.js';
import { renderTask as soon } from './tasks.js';

// The screen of one assignment for the staff (#/task/<id>): the students of the group on the left, the work of the chosen one
// on the right, and, for the teacher of the subject, the grade (work.grade). The office and the prorector read the same and
// do not see the grade block (can.grade of the answer). Everything from the server (names, texts, comments, names of files) is text.

const COMMENT_MAX = 2000;
const REASON_MAX = 300;

const blank = (assignmentId = null) => ({
  assignmentId, data: null, loading: false, loadErrorKey: null, ticket: 0, selectedId: null, filter: 'all',
  drafts: new Map(), errors: new Map(), problemKey: null, status: null, busy: false, forceReason: false, paperOpen: new Set(), prevOpen: new Set(),
});
let state = blank();

export function leave() {
  holdOnLeave(null);
  state = blank();
}

const isStaff = () => {
  const permissions = getUser()?.permissions;
  return Array.isArray(permissions) && permissions.includes('work.overview');
};

const stamp = (text) => {
  const [date, time = ''] = String(text).split(' ');
  const [year, month, day] = date.split('-');
  return { date: day + '.' + month + '.' + year, time: time.slice(0, 5) };
};

export function render(root, params) {
  if (!isStaff()) return soon(root);
  const assignmentId = params.assignmentId ?? null;
  if (state.assignmentId !== assignmentId) {
    holdOnLeave(null);
    state = blank(assignmentId);
  }
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const data = state.data;
  const assignment = data ? data.assignment : null;
  root.append(...[
    pageHeader({
      id: 'task-title', title: assignment ? assignment.title : t('tasks.title'),
      actions: assignment ? [
        el('a', { class: 'button button--secondary', id: 'task-back', href: '#/tasks/' + encodeURIComponent(assignment.subjectId) }, t('work.back')),
        data.can.manage ? el('button', { type: 'button', class: 'button button--primary', id: 'task-edit', onclick: () => edit() }, icon('pencil'), t('work.edit')) : null,
      ] : el('a', { class: 'button button--secondary', id: 'task-back', href: '#/tasks' }, t('tasks.back')),
    }),
    data === null ? loadingBody() : body(),
  ].filter(Boolean));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('work.get', { assignmentId: owner.assignmentId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
    const chosen = data.students.find((s) => s.id === owner.selectedId);
    if (!chosen) owner.selectedId = (data.students.find((s) => s.state === 'submitted') ?? data.students[0] ?? { id: null }).id;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function loadingBody() {
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert', el('p', {}, t(state.loadErrorKey)), el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.loadErrorKey = null; load(); refresh(); } }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function reload() {
  state.data = null;
  state.loadErrorKey = null;
  load();
  refresh();
}

function edit() {
  const owner = state;
  const { assignment } = owner.data;
  openTaskForm({ subjectId: assignment.subjectId, assignment, onSaved: () => { if (state === owner) { owner.status = null; reload(); } } });
}

// ---- The page ----

function body() {
  const { assignment, students } = state.data;
  return el('div', { class: 'task-screen' },
    info(),
    students.length === 0
      ? emptyState('cap', el('p', { class: 'empty__title', id: 'task-no-students' }, t('work.noStudents')))
      : el('div', { class: 'check' }, studentList(), workPanel(students.find((s) => s.id === state.selectedId) ?? students[0], assignment)));
}

function info() {
  const { assignment, now } = state.data;
  const due = dueText(assignment.dueAt, now);
  const place = [t('work.kind.' + assignment.kind), assignment.unit === null ? null : t('work.unit', { n: assignment.unit }), assignment.topicName || null].filter(Boolean).join(' · ');
  return el('section', { class: 'card task-info' },
    el('p', { class: 'task-info__eyebrow', id: 'task-place' }, place),
    el('p', { class: 'task-info__meta' },
      el('span', { class: 'task-due task-due--' + due.tone, id: 'task-due' }, t(due.key, due.params)),
      el('span', { id: 'task-max' }, t('work.max', { n: assignment.maxPoints })),
      el('span', {}, [assignment.subjectName, assignment.groupName].filter(Boolean).join(' · '))),
    assignment.description ? el('p', { class: 'task-info__text', id: 'task-description' }, assignment.description) : null);
}

// ---- The list of students ----

const FILTERS = { all: () => true, wait: (s) => s.state === 'submitted', none: (s) => s.state === 'none' };

function studentList() {
  const { students } = state.data;
  const shown = students.filter(FILTERS[state.filter]);
  return el('aside', { class: 'card check__list', 'aria-labelledby': 'check-list-title' },
    el('h2', { class: 'check__heading', id: 'check-list-title' }, t('work.students')),
    el('div', { class: 'segmented segmented--wrap check__filter', role: 'group', 'aria-labelledby': 'check-list-title' },
      Object.keys(FILTERS).map((key) => el('button', {
        type: 'button', id: 'check-filter-' + key, class: 'segmented__button', 'aria-pressed': String(state.filter === key),
        onclick: () => { state.filter = key; refresh(); },
      }, t('work.filter.' + key, { n: students.filter(FILTERS[key]).length })))),
    shown.length === 0
      ? el('p', { class: 'check__none' }, t('work.noneShown'))
      : el('ul', { class: 'check__students' }, shown.map((s) => el('li', {},
        el('button', {
          type: 'button', id: 'check-student-' + s.id, class: 'check-row', 'aria-current': String(s.id === state.selectedId), onclick: () => { select(s.id); },
        }, avatar(s.fullName),
        el('span', { class: 'check-row__name' }, s.fullName),
        el('span', { class: 'check-row__state' }, stateBadges(s)))))));
}

function stateBadges(s) {
  if (s.state === 'none' && s.overdue) return [badge(t('work.due.overdue'), 'danger'), s.left ? badge(t('work.left')) : null];
  const view = stateView(s.state, s.late);
  const text = s.state === 'checked' && Number.isInteger(s.points) ? t('work.state.checkedPoints', { n: s.points }) : t(view.key);
  return [badge(text, view.tone, s.state !== 'none'), view.lateKey ? badge(t(view.lateKey), 'warning') : null, s.left ? badge(t('work.left')) : null];
}

// ---- Drafts ----

const draftOf = (student) => {
  if (!state.drafts.has(student.id)) {
    const base = gradeDraft(student);
    state.drafts.set(student.id, { points: base.points === null ? '' : String(base.points), comment: base.comment, reason: '' });
  }
  return state.drafts.get(student.id);
};

// A grade that was typed and not saved: the points or the comment differ from the current attempt (a reason alone changes nothing).
function dirty(student) {
  const draft = student ? state.drafts.get(student.id) : undefined;
  if (!draft) return false;
  const base = gradeDraft(student);
  return draft.points !== (base.points === null ? '' : String(base.points)) || draft.comment !== base.comment;
}

const chosen = () => (state.data ? state.data.students.find((s) => s.id === state.selectedId) : undefined);

function syncHold() {
  const owner = state;
  holdOnLeave(dirty(chosen()) ? async () => (state === owner ? settleUnsaved() : true) : null);
}

// «Оценка не сохранена. Сохранить?»: resolves to 'save' | 'discard' | 'cancel' (Escape is «Отмена»).
function askUnsaved() {
  return new Promise((resolve) => {
    let answer = 'cancel';
    const pick = (value) => () => { answer = value; dialog.close(); };
    const dialog = modal({ id: 'grade-unsaved', labelledBy: 'grade-unsaved-title', className: 'dialog--confirm', onClose: () => { dialog.remove(); resolve(answer); } },
      el('h2', { class: 'dialog__title', id: 'grade-unsaved-title' }, t('work.unsaved.title')),
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', id: 'grade-unsaved-cancel', class: 'button button--secondary', onclick: pick('cancel') }, t('common.cancel')),
        el('button', { type: 'button', id: 'grade-unsaved-discard', class: 'button button--secondary', onclick: pick('discard') }, t('work.unsaved.discard')),
        el('button', { type: 'button', id: 'grade-unsaved-save', class: 'button button--primary', onclick: pick('save') }, t('work.unsaved.save'))));
    showModal(document.body, dialog);
  });
}

// True when the screen may be left or the student changed: nothing unsaved, or saved, or thrown away on purpose.
async function settleUnsaved() {
  const owner = state;
  const student = chosen();
  if (!dirty(student)) return true;
  const answer = await askUnsaved();
  if (state !== owner) return true;
  if (answer === 'cancel') return false;
  if (answer === 'discard') {
    owner.drafts.delete(student.id);
    owner.errors = new Map();
    owner.problemKey = null;
    owner.forceReason = false;
    return true;
  }
  return save('checked');
}

async function select(id) {
  if (id === state.selectedId) return;
  const owner = state;
  if (!(await settleUnsaved()) || state !== owner) return;
  owner.selectedId = id;
  owner.errors = new Map();
  owner.problemKey = null;
  owner.status = null;
  owner.forceReason = false;
  syncHold();
  refresh();
  if (window.innerWidth < 768) {
    const panel = document.getElementById('check-work');
    if (panel) panel.scrollIntoView({ block: 'start' });
  }
}

function nextWaiting(student) {
  const { students } = state.data;
  const at = students.indexOf(student);
  for (let i = 1; i < students.length; i += 1) {
    const other = students[(at + i) % students.length];
    if (other.state === 'submitted') return other;
  }
  return null;
}

// ---- Saving ----

async function save(verdict) {
  const owner = state;
  const student = chosen();
  if (!student || owner.busy) return false;
  const draft = draftOf(student);
  const current = currentOf(student);
  const points = draft.points.trim();
  const data = {
    assignmentId: owner.assignmentId, studentId: student.id, attemptId: current ? current.id : '', verdict,
    points: verdict === 'checked' ? (/^\d+$/.test(points) ? Number(points) : points) : null, comment: draft.comment, reason: draft.reason,
  };
  owner.busy = true;
  owner.errors = new Map();
  owner.problemKey = null;
  owner.status = null;
  refresh();
  try {
    const result = await call('work.grade', data);
    if (state !== owner) return true;
    owner.data = result.work;
    owner.drafts.delete(student.id);
    owner.paperOpen.delete(student.id);
    owner.forceReason = false;
    owner.status = 'work.grade.saved';
    owner.busy = false;
    syncHold();
    refresh();
    return true;
  } catch (error) {
    if (state !== owner) return false;
    owner.busy = false;
    if (error.code === 'invalid' && Array.isArray(error.fields)) {
      owner.errors = formProblems(error.fields);
      owner.problemKey = 'error.invalid';
      if (owner.errors.has('reason')) owner.forceReason = true;
    } else if (error.code === 'attempt_changed') {
      owner.problemKey = 'work.grade.attemptChanged';
      owner.drafts.delete(student.id);
      owner.forceReason = false;
      syncHold();
      reload();
      return false;
    } else {
      owner.problemKey = errorKey(error.code);
    }
    refresh();
    focusFirstInvalid();
    return false;
  }
}

// ---- The work of the chosen student ----

function workPanel(student, assignment) {
  const current = currentOf(student);
  const { can } = state.data;
  const earlier = student.attempts.filter((a) => a !== current).sort((x, y) => y.n - x.n);
  return el('section', { class: 'card check__work', id: 'check-work', 'aria-labelledby': 'check-work-title' },
    el('header', { class: 'check-work__head' },
      avatar(student.fullName, 'lg'),
      el('div', { class: 'check-work__who' },
        el('h2', { class: 'check__heading', id: 'check-work-title' }, student.fullName),
        el('span', { class: 'check-work__state' }, stateBadges(student)))),
    state.status ? note('success', t(state.status), { id: 'grade-status', role: 'status' }) : null,
    state.problemKey ? note('error', t(state.problemKey), { id: 'grade-problem', role: 'alert' }) : null,
    current ? attemptBlock(current, assignment, true) : el('p', { class: 'check-work__none', id: 'check-none' }, t('work.state.none')),
    can.grade ? gradeBlock(student, current, assignment) : readOnlyGrade(current, assignment),
    earlier.length > 0 ? previous(student, earlier, assignment) : null);
}

function attemptBlock(a, assignment, isCurrent) {
  const sent = stamp(a.submittedAt);
  return el('div', { class: 'attempt' + (isCurrent ? ' attempt--current' : '') },
    el('p', { class: 'attempt__head' },
      el('strong', {}, t('work.attempt', { n: a.n })),
      el('span', { class: 'attempt__time' }, t('work.sentAt', sent)),
      a.paper ? badge(t('work.paper')) : null,
      a.late ? badge(t('work.state.late'), 'warning') : null,
      isCurrent ? null : badge(a.status === 'checked' && Number.isInteger(a.points) ? t('work.state.checkedPoints', { n: a.points }) : t('work.state.' + a.status), stateView(a.status, false).tone)),
    a.text !== '' ? el('p', { class: 'attempt__text' }, a.text) : (a.files.length === 0 && !a.paper ? el('p', { class: 'attempt__text attempt__text--none' }, t('work.noText')) : null),
    a.files.length > 0 ? el('ul', { class: 'file-list', 'aria-label': t('work.files') }, a.files.map((f) => el('li', {},
      el('button', { type: 'button', class: 'file-chip', id: 'file-' + f.id, onclick: () => { openFile({ fileId: f.id, name: f.name, kind: f.kind }); } },
        el('span', { class: 'file-chip__kind', 'aria-hidden': 'true' }, f.kind),
        el('span', { class: 'file-chip__name' }, f.name),
        el('span', { class: 'file-chip__size' }, t(sizeText(f.size).key, sizeText(f.size).params)))))) : null,
    isCurrent ? null : el('div', { class: 'attempt__result' }, a.comment !== '' ? el('p', { class: 'attempt__text' }, a.comment) : null,
      a.checkedAt ? el('p', { class: 'attempt__checked' }, t('work.grade.checkedBy', { name: a.checkedByName, date: stamp(a.checkedAt).date })) : null));
}

function previous(student, earlier, assignment) {
  const open = state.prevOpen.has(student.id);
  return el('div', { class: 'check__previous' },
    el('button', {
      type: 'button', id: 'check-prev-toggle', class: 'button button--secondary', 'aria-expanded': String(open),
      onclick: () => { if (open) state.prevOpen.delete(student.id); else state.prevOpen.add(student.id); refresh(); },
    }, t('work.prev', { n: earlier.length })),
    open ? el('div', { class: 'check__previous-list', id: 'check-prev' }, earlier.map((a) => attemptBlock(a, assignment, false))) : null);
}

// What the office sees instead of the grade block.
function readOnlyGrade(current, assignment) {
  if (!current || (current.status !== 'checked' && current.status !== 'returned')) return null;
  return el('div', { class: 'grade-read', id: 'grade-read' },
    current.status === 'checked' && Number.isInteger(current.points) ? el('p', { class: 'grade-read__points' }, t('work.grade.given', { n: current.points, max: assignment.maxPoints })) : null,
    current.comment !== '' ? el('p', { class: 'attempt__text' }, current.comment) : null,
    current.checkedAt ? el('p', { class: 'attempt__checked' }, t('work.grade.checkedBy', { name: current.checkedByName, date: stamp(current.checkedAt).date })) : null);
}

function textArea({ id, label, value, rows, max, error, hint = null, onInput }) {
  const describedBy = [hint ? id + '-hint' : null, error ? id + '-error' : null].filter(Boolean).join(' ');
  const area = el('textarea', {
    id, name: id, class: 'field__input field__textarea', rows, maxlength: max, 'aria-invalid': error ? 'true' : null, 'aria-describedby': describedBy || null,
    oninput: () => onInput(area.value),
  });
  area.value = value;
  return el('div', { class: 'field' },
    el('label', { class: 'field__label', for: id }, label),
    area,
    hint ? el('p', { class: 'field__hint', id: id + '-hint' }, hint) : null,
    error ? el('p', { class: 'field__error', id: id + '-error' }, icon('alert'), t(error)) : null);
}

function gradeBlock(student, current, assignment) {
  const paperMode = !current;
  if (paperMode && !state.paperOpen.has(student.id)) {
    return el('div', { class: 'grade' }, el('button', {
      type: 'button', id: 'grade-paper', class: 'button button--secondary',
      onclick: () => { state.paperOpen.add(student.id); refresh(); const input = document.getElementById('grade-points'); if (input) input.focus(); },
    }, icon('pencil'), t('work.grade.paper')));
  }
  const draft = draftOf(student);
  const reasonNeeded = () => state.forceReason || gradeNeedsReason(student, { verdict: 'checked', points: draft.points, comment: draft.comment });
  const reason = textArea({
    id: 'grade-reason', label: t('work.grade.reason'), value: draft.reason, rows: 2, max: REASON_MAX, error: state.errors.get('reason') ?? null,
    hint: t('work.grade.reasonHint'), onInput: (v) => { draft.reason = v; },
  });
  reason.id = 'grade-reason-block';
  reason.hidden = !reasonNeeded();
  const showReason = () => { reason.hidden = !reasonNeeded(); };
  const busy = state.busy;
  const checkButton = el('button', { type: 'button', id: 'grade-check', class: 'button button--primary', onclick: () => { save('checked'); } }, t('work.grade.check'));
  const returnButton = paperMode ? null : el('button', { type: 'button', id: 'grade-return', class: 'button button--secondary', onclick: () => { save('returned'); } }, t('work.grade.return'));
  if (busy) {
    markBusy(checkButton, 'common.saving');
    if (returnButton) returnButton.setAttribute('aria-disabled', 'true');
  }
  const next = nextWaiting(student);
  return el('form', { class: 'grade', id: 'grade-form', novalidate: true, onsubmit: (event) => event.preventDefault() },
    el('h3', { class: 'grade__title' }, t('work.grade.title')),
    paperMode ? el('p', { class: 'field__hint' }, t('work.grade.paperHint')) : null,
    field({
      id: 'grade-points', label: t('work.grade.points', { max: assignment.maxPoints }), type: 'number', value: draft.points, error: state.errors.get('points') ?? null,
      attrs: { min: 0, max: assignment.maxPoints, step: 1, inputmode: 'numeric' },
      onInput: (v) => { draft.points = v; showReason(); syncHold(); },
    }),
    textArea({
      id: 'grade-comment', label: t('work.grade.comment'), value: draft.comment, rows: 3, max: COMMENT_MAX, error: state.errors.get('comment') ?? null,
      onInput: (v) => { draft.comment = v; showReason(); syncHold(); },
    }),
    reason,
    returnButton ? el('p', { class: 'field__hint' }, t('work.grade.returnHint')) : null,
    el('div', { class: 'grade__actions' },
      checkButton, returnButton,
      el('button', {
        type: 'button', id: 'grade-next', class: 'button button--secondary grade__next', 'aria-disabled': next ? null : 'true', title: next ? null : t('work.grade.nextNone'),
        onclick: () => { if (next) select(next.id); },
      }, t('work.grade.next'), icon('chevron'))));
}

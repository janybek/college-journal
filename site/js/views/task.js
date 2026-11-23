import { call, upload, RETRYABLE } from '../api.js';
import { getUser, getToken } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader, note, field, markBusy, focusFirstInvalid, holdOnLeave, modal, showModal, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { dueText, dueOfWork, stateView, sizeText, formProblems, currentOf, gradeDraft, gradeNeedsReason, kindOfName, isPhoto, pickProblem, uploadErrorCode, uploadErrorKey, mayStillSend, staffMay } from '../work.js';
import { activeRole } from '../shell.js';
import { preparePhoto, readAsBase64 } from '../photo.js';
import { openTaskForm } from './taskForm.js';
import { openFile } from './fileView.js';
import { renderTask as soon } from './tasks.js';

// The screen of one assignment for the staff (#/task/<id>): the students of the group on the left, the work of the chosen one
// on the right, and, for the teacher of the subject, the grade (work.grade). The office and the prorector read the same and
// do not see the grade block (can.grade of the answer). Everything from the server (names, texts, comments, names of files) is text.
// For a student the same address is his own work: the task, his attempts, and the form that hands in a text and files (the end of this file).

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
  mine = blankMine();
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
  if (isStudent()) return root.append(...renderMineTask(params));
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
        staffMay(data.can, activeRole(getUser())).manage ? el('button', { type: 'button', class: 'button button--primary', id: 'task-edit', onclick: () => edit() }, icon('pencil'), t('work.edit')) : null,
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
    staffMay(can, activeRole(getUser())).grade ? gradeBlock(student, current, assignment) : readOnlyGrade(current, assignment),
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

// ---- The student: his work on the assignment ----

const TEXT_MAX = 5000;
const ACCEPT = '.jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*';

const isStudent = () => {
  const permissions = getUser()?.permissions;
  return Array.isArray(permissions) && permissions.includes('work.mine') && !permissions.includes('work.overview');
};

// items: the files of the work being handed in. phase: 'preparing' (waiting for its turn, shrinking, reading), 'uploading',
// 'done' (the server holds it as a pending file: fileId), 'error'. A failed item keeps its payload (what to send again) only
// when sending it again may help; a refused one is `rejected` and can only be removed.
const blankMine = (assignmentId = null) => ({
  assignmentId, token: getToken(), data: null, loading: false, loadErrorKey: null, ticket: 0, text: '', seeded: false, items: [], queue: Promise.resolve(),
  nextUid: 1, busy: false, problemKey: null, doneTime: null, prevOpen: false,
});
let mine = blankMine();

const loadingFiles = (o) => o.items.some((i) => i.phase === 'preparing' || i.phase === 'uploading');
const failedFiles = (o) => o.items.some((i) => i.phase === 'error' && !i.rejected);
const doneFiles = (o) => o.items.filter((i) => i.phase === 'done');

// The queue of an upload works only for the screen and the session it began in: after leaving or a change of the token it stops.
const alive = (owner) => mayStillSend(mine === owner, owner.token, getToken());

function renderMineTask(params) {
  const assignmentId = params.assignmentId ?? null;
  if (mine.assignmentId !== assignmentId) mine = blankMine(assignmentId);
  if (mine.data === null && !mine.loading && mine.loadErrorKey === null) loadMineTask();
  const data = mine.data;
  return [
    pageHeader({
      id: 'task-title', title: data ? data.assignment.title : t('tasks.title'),
      actions: el('a', { class: 'button button--secondary', id: 'task-back', href: '#/tasks' }, t('work.mine.back')),
    }),
    data === null ? mineLoading() : el('div', { class: 'task-screen mine-screen' }, mineInfo(data), mineWork(data)),
  ];
}

async function loadMineTask() {
  const owner = mine;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('work.get', { assignmentId: owner.assignmentId });
    if (mine !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
    if (!owner.seeded) {
      owner.seeded = true;
      // what was uploaded earlier and not handed in is still on the server
      if (data.canSubmit) owner.items = data.mine.pending.map((f) => ({ uid: owner.nextUid++, name: f.name, size: f.size, kind: f.kind, phase: 'done', fileId: f.id, payload: null, rejected: false, errorKey: null, share: 1 }));
    }
  } catch (error) {
    if (mine !== owner || owner.ticket !== ticket) return;
    owner.loadErrorKey = errorKey(error.code);
  } finally {
    if (mine === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function mineLoading() {
  if (!mine.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(mine.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => { mine.loadErrorKey = null; loadMineTask(); refresh(); } }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

function mineInfo(data) {
  const { assignment, now } = data;
  const due = dueOfWork(assignment.dueAt, now, data.mine.state);
  const unit = assignment.unit === null ? null : assignment.unitTitle ? t('work.unitTitled', { n: assignment.unit, title: assignment.unitTitle }) : t('work.unit', { n: assignment.unit });
  return el('section', { class: 'card task-info', 'aria-labelledby': 'task-title' },
    el('p', { class: 'task-info__eyebrow', id: 'task-place' }, [t('work.kind.' + assignment.kind + '.long'), unit, assignment.topicName || null].filter(Boolean).join(' · ')),
    el('p', { class: 'task-info__meta' },
      el('span', { class: 'task-due task-due--' + due.tone, id: 'task-due' }, t(due.key, due.params)),
      el('span', { id: 'task-max' }, t('work.max', { n: assignment.maxPoints })),
      el('span', {}, [assignment.subjectName, assignment.teacherName].filter(Boolean).join(' · '))),
    assignment.description ? el('p', { class: 'task-info__text', id: 'task-description' }, assignment.description) : null);
}

// ---- «Моя работа» ----

function mineWork(data) {
  const m = data.mine;
  const current = currentOf({ attempts: m.attempts });
  const earlier = m.attempts.filter((a) => a !== current).sort((x, y) => y.n - x.n);
  const view = stateView(m.state, m.late);
  const hint = { none: current ? null : 'work.mine.noneHint', returned: 'work.mine.returnedHint', checked: 'work.mine.checkedHint', submitted: 'work.mine.submittedHint' }[m.state];
  return el('section', { class: 'card mine-work', 'aria-labelledby': 'mine-work-title' },
    el('header', { class: 'mine-work__head' },
      el('h2', { class: 'check__heading', id: 'mine-work-title' }, t('work.mine.title')),
      el('span', { class: 'mine-work__state', id: 'mine-state' },
        m.state === 'none' && m.overdue ? badge(t('work.due.overdue'), 'danger') : badge(t(view.key), view.tone, m.state !== 'none'),
        view.lateKey ? badge(t(view.lateKey), 'warning') : null)),
    mine.doneTime ? note('success', t('work.mine.submitted', { time: mine.doneTime }), { id: 'mine-done', role: 'status' }) : null,
    hint ? el('p', { class: 'mine-work__hint', id: 'mine-hint' }, t(hint)) : null,
    m.state === 'checked' && Number.isInteger(m.points) ? el('p', { class: 'mine-points', id: 'mine-points' }, t('work.grade.given', { n: m.points, max: data.assignment.maxPoints })) : null,
    current && current.comment !== '' ? el('div', { class: 'mine-comment', id: 'mine-comment' },
      el('p', { class: 'mine-comment__label' }, t('work.mine.comment')),
      el('p', { class: 'mine-comment__text' }, current.comment)) : null,
    current ? mineAttempt(current, true) : null,
    data.canSubmit ? mineForm(data) : null,
    earlier.length > 0 ? minePrevious(earlier) : null);
}

function mineAttempt(a, isCurrent) {
  const sent = stamp(a.submittedAt);
  return el('div', { class: 'attempt' + (isCurrent ? ' attempt--current' : ''), id: isCurrent ? 'mine-current' : null },
    el('p', { class: 'attempt__head' },
      el('strong', {}, t('work.attempt', { n: a.n })),
      el('span', { class: 'attempt__time' }, t('work.sentAt', sent)),
      a.late ? badge(t('work.state.late'), 'warning') : null,
      isCurrent ? null : badge(a.status === 'replaced' ? t('work.mine.replaced') : a.status === 'checked' && Number.isInteger(a.points) ? t('work.state.checkedPoints', { n: a.points }) : t('work.state.' + a.status), stateView(a.status, false).tone)),
    a.text !== '' ? el('p', { class: 'attempt__text' }, a.text) : (a.files.length === 0 ? el('p', { class: 'attempt__text attempt__text--none' }, t('work.noText')) : null),
    a.files.length > 0 ? el('ul', { class: 'file-list', 'aria-label': t('work.files') }, a.files.map((f) => el('li', {},
      el('button', { type: 'button', class: 'file-chip', id: 'file-' + f.id, onclick: () => { openFile({ fileId: f.id, name: f.name, kind: f.kind }); } },
        el('span', { class: 'file-chip__kind', 'aria-hidden': 'true' }, f.kind),
        el('span', { class: 'file-chip__name' }, f.name),
        el('span', { class: 'file-chip__size' }, t(sizeText(f.size).key, sizeText(f.size).params)))))) : null,
    isCurrent || a.comment === '' ? null : el('div', { class: 'attempt__result' }, el('p', { class: 'attempt__text' }, a.comment)));
}

function minePrevious(earlier) {
  return el('div', { class: 'check__previous' },
    el('button', {
      type: 'button', id: 'mine-prev-toggle', class: 'button button--secondary', 'aria-expanded': String(mine.prevOpen),
      onclick: () => { mine.prevOpen = !mine.prevOpen; refresh(); },
    }, t('work.prev', { n: earlier.length })),
    mine.prevOpen ? el('div', { class: 'check__previous-list', id: 'mine-prev' }, earlier.map((a) => mineAttempt(a, false))) : null);
}

// ---- The form of handing in ----

// Why «Сдать» cannot be pressed now: a key of the dictionary, 'busy', or null when it can.
function submitBlock(o) {
  if (o.busy) return 'busy';
  if (loadingFiles(o)) return 'work.mine.waitUpload';
  if (failedFiles(o)) return 'work.mine.fixFiles';
  if (o.text.trim() === '' && doneFiles(o).length === 0) return 'work.mine.needSomething';
  return null;
}

const hintOf = (block) => (block === null || block === 'busy' ? '' : t(block));

// Updates the button and its hint without redrawing the page (typing must not lose the caret).
function syncSubmit() {
  const button = document.getElementById('mine-submit');
  if (!button) return;
  const block = submitBlock(mine);
  button.disabled = block !== null;
  const hint = document.getElementById('mine-submit-hint');
  if (hint) hint.textContent = hintOf(block);
}

function mineForm(data) {
  const again = data.mine.attempts.length > 0;
  const late = data.assignment.dueAt < data.now;
  const block = submitBlock(mine);
  return el('form', { class: 'mine-form', id: 'mine-form', novalidate: true, onsubmit: (event) => { event.preventDefault(); submit(); } },
    textArea({
      id: 'mine-text', label: t('work.mine.text'), value: mine.text, rows: '6', max: String(TEXT_MAX), error: null,
      hint: t('work.mine.textCount', { n: mine.text.length, max: TEXT_MAX }),
      onInput: (value) => {
        mine.text = value;
        const count = document.getElementById('mine-text-hint');
        if (count) count.textContent = t('work.mine.textCount', { n: value.length, max: TEXT_MAX });
        syncSubmit();
      },
    }),
    filesBlock(),
    late ? note('warning', t('work.mine.late'), { id: 'mine-late' }) : null,
    mine.problemKey ? note('error', t(mine.problemKey), { id: 'mine-problem', role: 'alert' }) : null,
    el('p', { class: 'field__hint mine-form__hint', id: 'mine-submit-hint', 'aria-live': 'polite' }, hintOf(block)),
    el('button', { type: 'submit', class: 'button button--primary mine-form__submit', id: 'mine-submit', disabled: block !== null, 'aria-busy': mine.busy ? 'true' : null },
      t(mine.busy ? 'work.mine.submitting' : again ? 'work.mine.resubmit' : 'work.mine.submit')));
}

function filesBlock() {
  const input = el('input', {
    type: 'file', multiple: true, accept: ACCEPT, id: 'mine-file-input', class: 'visually-hidden',
    onchange: () => { const chosen = [...input.files]; input.value = ''; addFiles(chosen); },
  });
  return el('div', { class: 'mine-files' },
    el('label', { class: 'button button--secondary mine-files__add', for: 'mine-file-input' }, icon('plus'), t('work.mine.addFiles'), input),
    el('p', { class: 'field__hint mine-files__hint' }, t('work.mine.filesHint')),
    mine.items.length > 0 ? el('ul', { class: 'mine-file-list', id: 'mine-files', 'aria-label': t('work.mine.filesList') }, mine.items.map(fileRow)) : null);
}

const shown = (share) => Math.round(share * 100);

function fileRow(item) {
  const size = item.size > 0 ? sizeText(item.size) : null;
  const name = item.phase === 'done'
    ? el('button', { type: 'button', class: 'mine-file__name mine-file__open', id: 'mine-open-' + item.uid, onclick: () => { openFile({ fileId: item.fileId, name: item.name, kind: item.kind }); } }, item.name)
    : el('span', { class: 'mine-file__name' }, item.name);
  let status = null;
  if (item.phase === 'preparing') status = el('p', { class: 'mine-file__status' }, t('work.mine.preparing'));
  if (item.phase === 'uploading') {
    status = el('div', { class: 'mine-file__status' },
      el('progress', { class: 'mine-progress', max: '1', value: String(item.share), id: 'mine-progress-' + item.uid, 'aria-label': item.name }),
      el('span', { id: 'mine-percent-' + item.uid }, t('work.mine.uploading', { n: shown(item.share) })));
  }
  if (item.phase === 'done') status = el('p', { class: 'mine-file__status mine-file__status--done' }, icon('check'), t('work.mine.uploaded'));
  return el('li', { class: 'mine-file mine-file--' + item.phase, id: 'mine-file-' + item.uid },
    el('div', { class: 'mine-file__main' }, name, size ? el('span', { class: 'mine-file__size' }, t(size.key, size.params)) : null),
    status,
    item.phase === 'error' ? el('p', { class: 'mine-file__error', role: 'alert' }, icon('alert'), t(item.errorKey)) : null,
    item.noteKey ? el('p', { class: 'mine-file__error', role: 'alert' }, icon('alert'), t(item.noteKey)) : null,
    item.phase === 'done' || item.phase === 'error' ? el('div', { class: 'mine-file__actions' },
      item.phase === 'error' && item.payload ? el('button', { type: 'button', class: 'button button--primary mine-file__button', id: 'mine-retry-' + item.uid, onclick: () => retryItem(item) }, t('work.mine.retry')) : null,
      el('button', { type: 'button', class: 'button button--secondary mine-file__button', id: 'mine-remove-' + item.uid, disabled: item.dropping === true || mine.busy, onclick: () => removeItem(item) }, t('work.mine.remove'))) : null);
}

// ---- Choosing, shrinking and uploading the files (one by one) ----

function addFiles(files) {
  const owner = mine;
  owner.problemKey = null;
  for (const file of files) {
    const count = owner.items.filter((i) => !i.rejected).length;
    const kind = kindOfName(file.name);
    const problem = pickProblem(file, kind, count);
    const item = { uid: owner.nextUid++, name: file.name, size: isPhoto(file) ? 0 : file.size, kind: kind ?? '', phase: 'preparing', fileId: null, payload: null, rejected: false, errorKey: null, share: 0 };
    owner.items.push(item);
    if (problem) {
      Object.assign(item, { phase: 'error', rejected: true, errorKey: problem });
      continue;
    }
    // one file at a time: a phone shrinks and sends better that way
    owner.queue = owner.queue.then(() => prepareAndSend(owner, item, file));
  }
  refresh();
}

async function prepareAndSend(owner, item, file) {
  if (!alive(owner)) return;
  try {
    item.payload = isPhoto(file) ? await preparePhoto(file) : { name: file.name, data: await readAsBase64(file) };
  } catch (error) {
    failItem(owner, item, error);
    return;
  }
  if (!alive(owner)) return;
  await sendItem(owner, item);
}

async function sendItem(owner, item) {
  if (!alive(owner)) return;
  Object.assign(item, { phase: 'uploading', share: 0, errorKey: null });
  if (mine === owner) refresh();
  try {
    const { file } = await upload('work.upload', { assignmentId: owner.assignmentId, name: item.payload.name, data: item.payload.data }, {
      onProgress: (share) => {
        item.share = share;
        const bar = document.getElementById('mine-progress-' + item.uid);
        const percent = document.getElementById('mine-percent-' + item.uid);
        if (mine === owner && bar) bar.value = share;
        if (mine === owner && percent) percent.textContent = t('work.mine.uploading', { n: shown(share) });
      },
    });
    Object.assign(item, { phase: 'done', fileId: file.id, name: file.name, kind: file.kind, size: file.size, payload: null, share: 1, errorKey: null });
  } catch (error) {
    failItem(owner, item, error);
    return;
  }
  if (mine === owner) refresh();
}

function failItem(owner, item, error) {
  const code = uploadErrorCode(error);
  const again = RETRYABLE.includes(code) && item.payload !== null;
  Object.assign(item, { phase: 'error', rejected: !again, errorKey: uploadErrorKey(code) ?? errorKey(code) });
  if (!again) item.payload = null;
  if (code === 'already_checked' && mine === owner) reloadMine();
  if (mine === owner) refresh();
}

function retryItem(item) {
  const owner = mine;
  if (!alive(owner) || item.payload === null || item.phase !== 'error') return;
  Object.assign(item, { phase: 'preparing', errorKey: null });
  owner.queue = owner.queue.then(() => sendItem(owner, item));
  refresh();
}

async function removeItem(item) {
  const owner = mine;
  if (item.fileId !== null) {
    item.dropping = true;
    item.noteKey = null;
    refresh();
    try {
      await call('work.dropFile', { fileId: item.fileId });
    } catch (error) {
      if (error.code !== 'not_found') {
        item.dropping = false;
        item.noteKey = errorKey(error.code);
        if (mine === owner) refresh();
        return;
      }
    }
  }
  owner.items = owner.items.filter((i) => i !== item);
  if (mine === owner) refresh();
}

// ---- Handing in ----

function reloadMine() {
  mine.data = null;
  mine.loadErrorKey = null;
  loadMineTask();
}

async function submit() {
  const owner = mine;
  if (owner.busy || submitBlock(owner) !== null) return;
  owner.busy = true;
  owner.problemKey = null;
  owner.doneTime = null;
  refresh();
  const ready = doneFiles(owner);
  try {
    const result = await call('work.submit', { assignmentId: owner.assignmentId, text: owner.text, fileIds: ready.map((i) => i.fileId) });
    if (mine !== owner) return;
    const latest = currentOf({ attempts: result.work.mine.attempts });
    Object.assign(owner, { data: result.work, items: [], text: '', doneTime: latest ? latest.submittedAt.slice(11, 16) : null, prevOpen: false });
  } catch (error) {
    if (mine !== owner) return;
    owner.problemKey = submitProblem(error, ready);
    if (error.code === 'already_checked') reloadMine();
  } finally {
    owner.busy = false;
    if (mine === owner) {
      refresh();
      // the answer «Работа сдана» is at the top of the work, the button was at its bottom
      const done = document.getElementById('mine-done');
      if (done && owner.doneTime !== null && owner.problemKey === null) done.scrollIntoView({ block: 'center' });
    }
  }
}

// The text of a failure of work.submit; a file the server no longer knows becomes an error row (it must be added again).
function submitProblem(error, ready) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  const stale = fields.filter((f) => f && f.code === 'bad_ref' && Number.isInteger(f.index) && ready[f.index]);
  for (const f of stale) Object.assign(ready[f.index], { phase: 'error', rejected: true, fileId: null, errorKey: 'work.submit.error.bad_ref' });
  if (fields.some((f) => f && f.code === 'bad_ref')) return 'work.submit.error.bad_ref';
  if (fields.some((f) => f && f.code === 'empty')) return 'work.submit.error.empty';
  return errorKey(error.code);
}

import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatarTone, badge, emptyState, pageHeader, note, iconButton, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { dueText } from '../work.js';
import { openTaskForm, confirmDialog } from './taskForm.js';

// «Задания» (#/tasks): the subjects whose assignments the person sees (work.overview), and #/tasks/<subjectId>: the
// assignments of one subject (work.list) with their counts. The teacher of the subject gives, changes and removes them
// (the buttons follow `can.manage` of the answer); the office only reads. A student's list comes with its own task.

const blank = () => ({
  subjectId: null, data: null, loading: false, loadErrorKey: null, ticket: 0, showPast: false, status: null, fresh: null,
});
let state = blank();

export function leave() {
  state = blank();
}

const isStudent = () => {
  const permissions = getUser()?.permissions;
  return Array.isArray(permissions) && permissions.includes('work.mine') && !permissions.includes('work.overview');
};

export function render(root, params) {
  const subjectId = params.subjectId ?? null;
  if (state.subjectId !== subjectId) state = { ...blank(), subjectId };
  if (isStudent()) return root.append(soon());
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const subject = state.data && subjectId !== null ? state.data.subject : null;
  root.append(...[
    subjectId === null
      ? pageHeader({ id: 'tasks-title', title: t('tasks.title'), lead: t('tasks.lead') })
      : pageHeader({
        id: 'tasks-title', title: subject ? subject.name + ' · ' + subject.groupName : t('tasks.title'), lead: subject && !state.data.can.manage ? subject.teacherName : null,
        actions: [
          el('a', { class: 'button button--secondary', id: 'tasks-back', href: '#/tasks' }, t('tasks.back')),
          state.data && state.data.can.manage ? el('button', { type: 'button', class: 'button button--primary', id: 'tasks-new', onclick: () => giveNew() }, icon('plus'), t('tasks.new')) : null,
        ],
      }),
    state.status ? note('success', t(state.status), { id: 'tasks-status', role: 'status' }) : null,
    state.data === null ? loadingBody() : subjectId === null ? overview() : subjectBody(),
  ].filter(Boolean));
}

// The route of a task for the student and a task of anyone, until their own screens come.
export function renderTask(root) {
  root.append(soon());
}

function soon() {
  return el('div', {},
    pageHeader({ id: 'tasks-title', title: t('tasks.title') }),
    emptyState('clock', el('p', { class: 'empty__title', id: 'tasks-soon' }, t('tasks.soon')), el('p', {}, t('tasks.soonText'))));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = owner.subjectId === null ? await call('work.overview', {}) : await call('work.list', { subjectId: owner.subjectId });
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
  if (!state.loadErrorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failure = emptyState('alert',
    el('p', {}, t(state.loadErrorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

// ---- The subjects ----

function overview() {
  const subjects = state.data.subjects;
  if (subjects.length === 0) return emptyState('clipboard', el('p', { class: 'empty__title', id: 'tasks-empty' }, t('tasks.empty')));
  return el('ul', { class: 'task-subjects', 'aria-labelledby': 'tasks-title' }, subjects.map((s) => el('li', { class: 'task-subjects__item' },
    el('a', { class: 'task-subject', id: 'tasks-open-' + s.subjectId, href: '#/tasks/' + encodeURIComponent(s.subjectId), 'data-tone': avatarTone(s.name) },
      el('span', { class: 'task-subject__top' },
        el('span', { class: 'group-chip' }, s.groupName || '—'),
        s.toCheck > 0 ? badge(t('tasks.toCheck', { n: s.toCheck }), 'warning', true) : null),
      el('span', { class: 'task-subject__name' }, s.name || '—'),
      el('span', { class: 'task-subject__meta' },
        el('span', {}, t('tasks.count', { n: s.assignments })),
        s.own ? null : el('span', {}, s.teacherName || '—')),
      icon('chevron', 'task-subject__chevron')))));
}

// ---- One subject ----

function subjectBody() {
  const data = state.data;
  const current = data.assignments.filter((a) => a.current);
  const past = data.assignments.filter((a) => !a.current);
  const parts = [];
  if (data.can.manage && !data.subject.hasSyllabus) parts.push(note('info', t('tasks.noSyllabus'), { id: 'tasks-no-syllabus' }));
  if (current.length === 0) {
    parts.push(emptyState('clipboard', el('p', { class: 'empty__title', id: 'tasks-none' }, t(data.can.manage ? 'tasks.noneManage' : 'tasks.none'))));
  } else {
    parts.push(table(current, 'tasks-table'));
  }
  if (past.length > 0) {
    parts.push(el('button', { type: 'button', class: 'button button--secondary task-past-toggle', id: 'tasks-past', 'aria-expanded': String(state.showPast), onclick: () => { state.showPast = !state.showPast; refresh(); } },
      t(state.showPast ? 'tasks.hidePast' : 'tasks.showPast', { n: past.length })));
    if (state.showPast) parts.push(table(past, 'tasks-past-table'));
  }
  return el('div', { class: 'tasks-body' }, parts);
}

function table(rows, id) {
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  const can = state.data.can.manage;
  return el('section', { class: 'card table-card' },
    el('div', { class: 'table-scroll' },
      el('table', { class: 'table tasks-table', id, 'aria-labelledby': 'tasks-title' },
        el('thead', {}, el('tr', {}, col(t('tasks.col.kind')), col(t('tasks.col.unit')), col(t('tasks.col.title')), col(t('tasks.col.due')), col(t('tasks.col.progress')), can ? col(t('tasks.col.actions'), 'tasks-table__actions') : null)),
        el('tbody', {}, rows.map(line)))));
}

function progress(counts) {
  const done = counts.submitted + counts.checked;
  return el('span', { class: 'task-progress' },
    el('span', { class: 'task-progress__main' }, t('tasks.progress.done', { done, total: counts.total })),
    counts.submitted > 0 ? badge(t('tasks.progress.wait', { n: counts.submitted }), 'primary') : null,
    counts.returned > 0 ? badge(t('tasks.progress.back', { n: counts.returned }), 'warning') : null);
}

function line(a) {
  const due = dueText(a.dueAt, state.data.now);
  const fresh = state.fresh === a.id;
  const unit = state.data.units.find((u) => u.unit === a.unit);
  return el('tr', { class: 'tasks-row' + (fresh ? ' is-fresh' : '') },
    el('td', {}, badge(t('work.kind.' + a.kind), a.kind === 'srs' ? 'primary' : 'neutral')),
    el('td', { class: 'tasks-table__unit' }, a.unit === null ? '—' : t('work.unit', { n: a.unit }), unit && unit.title ? el('span', { class: 'tasks-table__sub' }, unit.title) : null),
    el('td', { class: 'tasks-table__title' },
      el('a', { class: 'tasks-table__link', id: 'task-open-' + a.id, href: '#/task/' + encodeURIComponent(a.id) }, a.title),
      a.topicName ? el('span', { class: 'tasks-table__sub' }, a.topicName) : null),
    el('td', { class: 'tasks-table__due' }, el('span', { class: 'task-due task-due--' + due.tone }, t(due.key, due.params))),
    el('td', {}, progress(a.counts)),
    state.data.can.manage ? el('td', { class: 'tasks-table__actions' }, el('span', { class: 'row-actions' },
      iconButton({ id: 'task-edit-' + a.id, iconName: 'pencil', label: t('common.edit'), onClick: () => edit(a) }),
      iconButton({
        id: 'task-remove-' + a.id, iconName: 'trash', label: a.locked ? t('tasks.locked') : t('common.remove'), className: 'icon-button--danger',
        attrs: { 'aria-disabled': a.locked ? 'true' : null }, onClick: () => { if (!a.locked) askRemove(a); },
      }))) : null);
}

// ---- Actions ----

function reloadAfter(statusKey, freshId = null) {
  state.status = statusKey;
  state.fresh = freshId;
  state.data = null;
  state.loadErrorKey = null;
  load();
  refresh();
}

function giveNew() {
  const owner = state;
  owner.status = null;
  openTaskForm({
    subjectId: owner.subjectId, plan: owner.data,
    onSaved: (result) => { if (state === owner) reloadAfter('tasks.saved', result.id); },
  });
}

function edit(assignment) {
  const owner = state;
  owner.status = null;
  openTaskForm({
    subjectId: owner.subjectId, assignment, plan: owner.data,
    onSaved: (result) => { if (state === owner) reloadAfter('tasks.saved', result.id); },
  });
}

async function askRemove(assignment) {
  const owner = state;
  owner.status = null;
  const yes = await confirmDialog({ id: 'task-remove-ask', title: t('tasks.removeAsk', { title: assignment.title }), no: t('common.cancel'), yes: t('common.remove'), danger: true });
  if (!yes || state !== owner) return;
  try {
    await call('work.remove', { assignmentId: assignment.id });
  } catch (error) {
    if (state !== owner) return;
    owner.status = null;
    owner.data = null;
    owner.loadErrorKey = null;
    load();
    refresh();
    await confirmDialog({ id: 'task-remove-fail', title: t(error.code === 'in_use' ? 'tasks.error.in_use' : errorKey(error.code)), no: t('common.close'), yes: null });
    return;
  }
  if (state === owner) reloadAfter('tasks.removed');
}

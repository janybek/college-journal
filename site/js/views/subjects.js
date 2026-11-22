import { call, RETRYABLE } from '../api.js';
import { t, tCount } from '../i18n.js';
import {
  el, errorKey, fieldErrorKey, selectField, modal, showModal, focusById, focusFirstInvalid, markBusy, refresh,
  avatar, avatarTone, badge, emptyState, iconButton, note, pageHeader,
} from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { freeGroups, nextRow, addRequest, syllabusBadge, approvedNote, pairsNote, addedTeachers, withoutRow } from '../subjects.js';
import { setReviewCount } from '../reviewCount.js';
import { canFillFromFile } from '../fillFromFile.js';
import { startUpload, renderUpload, leaveUpload } from './syllabusUpload.js';

// «Предметы» of the deanery (#/subjects): who teaches which discipline in which group, and where each syllabus stands.
// One request (subjects.overview) draws it all: a row is a discipline and a teacher, a discipline with two teachers
// is two rows under one name. The discipline carries the colour its pairs have in the schedule.
// A group is a chip: with the right to edit it opens the group's window (another teacher, or the subject gone from
// the group). «Добавить предмет» is one window in two steps: the discipline picked from «Дисциплины» (never typed)
// and the groups with their teachers, then — the subjects saved — the syllabus of each teacher with its upload.
// The syllabus of a row is one mark (subjects.js: an open version first, else the approved one); beside the mark of
// an open version, in grey, what is approved meanwhile. «Заполнить из файла» fills the first draft (never what is in effect);
// once written, a note leads to the form. The upload itself (template, check window) is syllabusUpload.js. The server checks every right; the screen only
// leaves out the buttons the person's `permissions` do not allow (the vice-rector reads the table).

const blank = () => ({
  data: null,          // the answer of subjects.overview; null until it comes
  loading: false,
  loadErrorKey: null,
  ticket: 0,
  status: null,        // { key, params, busy }: what the last change did; busy — pairs left with the old teacher
  freshIds: [],        // subjects just added or given another teacher: their rows are marked
  uploaded: null,      // { syllabusId, disciplineName, teacherName }: the draft a file was just written into
  dialog: null,        // { kind: 'add' | 'group', ... }
});
let state = blank();

const can = (permission) => permissions().includes(permission);
const filled = (value) => typeof value === 'string' && value !== '';
const rowKey = (row) => row.disciplineId + '-' + row.teacherId;

export function leave() {
  state = blank();
  leaveUpload();
}

export function render(root) {
  if (state.data === null && !state.loading && state.loadErrorKey === null) load();
  const add = state.data !== null && can('subjects.add')
    ? el('button', { type: 'button', id: 'subjects-add', class: 'button button--primary', onclick: openAdd }, icon('plus'), t('subjects.add'))
    : null;
  root.append(
    pageHeader({ id: 'subjects-title', title: t('subjects.title'), lead: t('subjects.lead'), actions: add }),
    state.data === null ? loadingBody() : body());
  if (state.dialog) showModal(root, state.dialog.kind === 'add' ? addDialog(state.dialog) : groupDialog(state.dialog));
  renderUpload(root);
}

// Reads the overview; the table on screen stays until the new one comes. Resolves when it is drawn.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('subjects.overview', {});
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, loadErrorKey: null });
    setReviewCount(data.reviewCount);
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

// The overview could not be read again (after a change): the table shown is the one before it.
function reloadFailure(id) {
  if (!state.loadErrorKey) return null;
  return el('div', { class: 'reload-failed', role: 'alert' },
    note('error', t(state.loadErrorKey)),
    el('button', { type: 'button', id, class: 'button button--secondary', onclick: retry }, t('common.retry')));
}

// The table

function body() {
  const { rows } = state.data;
  const notes = el('div', { class: 'notes', role: 'status' },
    state.status ? note('success', t(state.status.key, state.status.params)) : null,
    uploadedNote('subjects-uploaded-form'),
    state.status && state.status.busy > 0 ? note('warning', tCount('subjects.edit.busy', state.status.busy)) : null);
  if (rows.length === 0) {
    return el('div', { class: 'stack' }, notes, reloadFailure('subjects-retry'),
      emptyState('book',
        el('p', { class: 'empty__title' }, t('subjects.empty')),
        can('dir.list:disciplines') ? el('a', { class: 'button button--secondary', href: '#/dir/disciplines' }, icon('list'), t('dir.disciplines')) : null));
  }
  return el('div', { class: 'stack' }, notes, reloadFailure('subjects-retry'), el('section', { class: 'card table-card' }, table()));
}

// Rows of one discipline stand together (the overview is sorted by discipline, then teacher).
function disciplineBlocks(rows) {
  const blocks = [];
  for (const row of rows) {
    const last = blocks[blocks.length - 1];
    if (last && last.disciplineId === row.disciplineId) last.rows.push(row);
    else blocks.push({ disciplineId: row.disciplineId, disciplineName: row.disciplineName, rows: [row] });
  }
  return blocks;
}

function table() {
  const { rows, currentSemester } = state.data;
  const rights = { edit: can('dir.save:subjects'), upload: can('syllabus.apply') };
  const col = (text, className = null) => el('th', { scope: 'col', class: className }, text);
  return el('div', { class: 'table-scroll' },
    el('table', { class: 'table subjects-table', 'aria-labelledby': 'subjects-title' },
      el('thead', {}, el('tr', {},
        col(t('subjects.col.discipline'), 'subjects-table__discipline-col'),
        col(t('subjects.col.teacher')),
        col(t('subjects.col.groups')),
        col(t('subjects.col.syllabus', { n: currentSemester })))),
      disciplineBlocks(rows).map((block) => el('tbody', { class: 'subjects-block' },
        block.rows.map((row, i) => line(row, i === 0 ? block : null, rights))))));
}

// The name of a discipline beside the colour its pairs have in the schedule.
function disciplineName(name, id = null) {
  return el('span', { class: 'discipline', 'data-tone': avatarTone(name) },
    el('span', { class: 'discipline__swatch', 'aria-hidden': 'true' }),
    el('span', { class: 'discipline__name', id }, name));
}

function person(name, nameId, sub = null) {
  return el('span', { class: 'person' },
    avatar(name),
    el('span', { class: 'person__text' },
      el('span', { class: 'person__name', id: nameId }, name || '—'),
      sub));
}

function line(row, block, rights) {
  const key = rowKey(row);
  const nameId = 'subjects-teacher-' + key;
  const fresh = row.groups.some((group) => state.freshIds.includes(group.subjectId));
  const describedBy = `subjects-discipline-${row.disciplineId} ${nameId}`;
  const uploadId = 'subjects-upload-' + key;
  const openId = 'subjects-open-' + key;
  return el('tr', { class: fresh ? 'is-fresh' : null },
    block ? el('th', { scope: 'rowgroup', rowspan: String(block.rows.length), class: 'subjects-table__discipline' },
      disciplineName(block.disciplineName, 'subjects-discipline-' + block.disciplineId)) : null,
    el('td', { class: 'subjects-table__teacher' }, person(row.teacherName, nameId)),
    el('td', { class: 'subjects-table__groups' }, groupList(row, rights.edit)),
    el('td', { class: 'subjects-table__syllabus' }, syllabusState(row, rights.upload ? uploadId : null, openId, describedBy)));
}

// The groups of a row as chips; under them, for each group whose schedule differs from the plan, a line named
// after the group (a line under its own chip would push the next chips apart). A group without pairs yet gets a
// calm line instead of the warning.
function groupList(row, editable) {
  const notes = row.groups.map((group) => ({ group, differs: pairsNote(row, group) })).filter(({ differs }) => differs !== null);
  return el('div', { class: 'groups' },
    el('ul', { class: 'group-list' }, row.groups.map((group) => {
      const name = group.groupName || '—';
      const label = t('subjects.groupAction', { group: name });
      return el('li', {}, editable
        ? el('button', {
          type: 'button', id: 'subjects-group-' + group.subjectId, class: 'group-chip', title: label, 'aria-label': label,
          onclick: () => openGroup(row, group),
        }, el('span', {}, name), icon('pencil', 'group-chip__icon'))
        : el('span', { class: 'group-chip' }, name));
    })),
    notes.map(({ group, differs }) => el('p', { class: 'groups__note' + (differs.calm ? ' is-calm' : '') },
      el('span', { class: 'groups__note-group' }, group.groupName || '—'), ' ',
      differs.params
        ? t(differs.key, { planned: tCount('syllabus.pairsCount', differs.params.planned), scheduled: differs.params.scheduled })
        : t(differs.key))));
}

function badgeText(shown) {
  if (!shown.params) return t(shown.key);
  return t(shown.key, { hours: shown.params.hours, pairs: tCount('syllabus.pairsCount', shown.params.pairs) });
}

// The mark of the syllabus and, beside the mark of an open version, in grey, the approved one («· утверждён: 36 ч, 18 пар»).
function syllabusMark(row) {
  const shown = syllabusBadge(row);
  const also = approvedNote(row);
  return el('span', { class: 'syllabus-mark' },
    badge(badgeText(shown), shown.tone, true),
    also ? el('span', { class: 'syllabus-mark__note' }, badgeText(also)) : null);
}

// The file is for the first fill only: no approved version and no draft yet. The overview does not count the rows of a
// draft, so any open version is taken as filled; an empty draft offers the file in its own form.
const takesFile = (row) => canFillFromFile({ hasApproved: row.syllabusStatus === 'approved', topicRows: row.open === null ? 0 : 1 });

// «Открыть»: the version someone has to act on — the new one while it is under review or while nothing is approved;
// otherwise the approved one of the half of the year that is on.
function syllabusHref(row) {
  const subjectId = row.groups[0].subjectId;
  if (row.open === 'review' || (row.open && row.syllabusStatus !== 'approved')) return `#/syllabus/${subjectId}/${state.data.currentSemester}/draft`;
  return '#/syllabus/' + subjectId;
}

// The state of the syllabus, and what to do about it: «Заполнить из файла» into the draft (with the right to upload;
// uploadId null without it), «Открыть» always — the page offers the template while there is no syllabus.
function syllabusState(row, uploadId, openId, describedBy) {
  return el('div', { class: 'syllabus-state' },
    syllabusMark(row),
    el('div', { class: 'syllabus-state__actions' },
      uploadId && takesFile(row) ? uploadButton(row, uploadId, openId, describedBy) : null,
      el('a', { id: openId, class: 'syllabus-state__open', href: syllabusHref(row), 'aria-describedby': describedBy },
        t('subjects.open'), icon('chevron'))));
}

// What the upload window needs to know about a «discipline + teacher» row (the form of syllabusUpload.js).
function uploadTarget(row) {
  return {
    subjectId: row.groups[0].subjectId, disciplineName: row.disciplineName, teacherName: row.teacherName,
    groupNames: row.groups.map((group) => group.groupName),
  };
}

// «Заполнить из файла»: the file of this teacher's syllabus, checked in the window of syllabusUpload.js, fills the draft.
// Once it is written, the overview is read again and a note leads to the form of the draft of the half of the year
// that is on (or of the one the file held). Focus goes back to the button, or to «Открыть» of the same teacher.
function upload(row, id, openId) {
  const owner = state;
  const onDone = (answer) => {
    const drafts = answer && Array.isArray(answer.drafts) ? answer.drafts : [];
    const draft = drafts.find((item) => item.semester === owner.data.currentSemester) || drafts[0];
    if (state === owner && draft) owner.uploaded = { syllabusId: draft.syllabusId, disciplineName: row.disciplineName, teacherName: row.teacherName };
    load().then(() => {
      if (!document.getElementById(id)) focusById(openId);
    });
  };
  owner.status = null;
  owner.uploaded = null;
  startUpload(uploadTarget(row), onDone, [id, openId], { intoDraft: true });
}

// The file is in the draft: what to do next, and the way to the form.
function uploadedNote(linkId) {
  const done = state.uploaded;
  if (!done) return null;
  const shown = note('success', t('subjects.uploadedDraft', { discipline: done.disciplineName, teacher: done.teacherName }), { class: 'note--with-link' });
  shown.append(el('a', { id: linkId, class: 'note__link', href: '#/syllabus-form/' + done.syllabusId }, t('subjects.openForm'), icon('chevron')));
  return shown;
}

function uploadButton(row, id, openId, describedBy) {
  return el('button', { type: 'button', id, class: 'button button--secondary', 'aria-describedby': describedBy, onclick: () => upload(row, id, openId) },
    icon('upload'), t('syllabus.fillFromFile'));
}

// Dialogs

function closeDialog() {
  const d = state.dialog;
  if (!d) return;
  state.dialog = null;
  refresh();
  focusById(d.returnId, 'subjects-add');
}

// «Добавить предмет», step 1: the discipline and the rows «группа — преподаватель»

function openAdd() {
  state.status = null;
  state.uploaded = null;
  state.freshIds = [];
  state.dialog = {
    kind: 'add', step: 1, disciplineId: '', items: [nextRow([])],
    disciplineError: null, rowErrors: {}, messageKey: null, busy: false,
    created: [], returnId: 'subjects-add',
  };
  refresh();
}

function addDialog(d) {
  let dialog;
  const close = () => { if (!d.busy) dialog.close(); };
  dialog = modal({ id: 'subjects-dialog', labelledBy: 'subjects-dialog-title', className: 'dialog--subject', onClose: closeDialog, canCancel: () => !d.busy },
    el('h2', { class: 'dialog__title', id: 'subjects-dialog-title' }, t('subjects.add')),
    stepper(d.step),
    d.step === 1 ? addForm(d, close) : addedList(d, close));
  return dialog;
}

// The two steps of the window: done, current or to come.
function stepper(step) {
  return el('ol', { class: 'stepper' }, [1, 2].map((n) => el('li', {
    class: 'stepper__step' + (n < step ? ' is-done' : '') + (n === step ? ' is-current' : ''),
    'aria-current': n === step ? 'step' : null,
  },
  el('span', { class: 'stepper__number', 'aria-hidden': 'true' }, n < step ? icon('check') : String(n)),
  el('span', { class: 'stepper__label' }, t('subjects.add.step' + n)))));
}

// Groups already chosen in the other rows of the window.
const takenBy = (d, except) => d.items.filter((item, i) => i !== except && filled(item.groupId)).map((item) => item.groupId);
const groupsFor = (d, index) => freeGroups(state.data.groups, state.data.rows, d.disciplineId, takenBy(d, index));

function addForm(d, close) {
  const { disciplines, teachers } = state.data;
  const { ready } = addRequest(d.disciplineId, d.items);
  const freeLeft = groupsFor(d, -1);
  const noneLeft = filled(d.disciplineId) && freeLeft.length === 0 && d.items.every((item) => !filled(item.groupId));
  const save = el('button', { type: 'submit', id: 'subjects-save', class: 'button button--primary', disabled: !ready && !d.busy }, t('common.save'));
  if (d.busy) markBusy(save, 'common.saving');
  const teacherOptions = teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName }));
  return el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); saveAdd(d); } },
    el('div', { class: 'pick-discipline' },
      selectField({
        id: 'subjects-discipline', label: t('subjects.add.discipline'), value: d.disciplineId, placeholder: t('subjects.add.choose'),
        options: disciplines.map((discipline) => ({ value: discipline.id, label: discipline.name })),
        error: d.disciplineError, onChange: (value) => chooseDiscipline(d, value),
      }),
      can('dir.list:disciplines') ? el('a', { class: 'field-link', id: 'subjects-to-disciplines', href: '#/dir/disciplines' }, t('subjects.add.missing')) : null),
    el('div', { class: 'pick' },
      el('div', { class: 'pick__head', 'aria-hidden': 'true' },
        el('span', {}, t('subjects.add.group')), el('span', {}, t('subjects.add.teacher'))),
      el('ol', { class: 'pick__rows' }, d.items.map((item, i) => pickRow(d, item, i, teacherOptions))),
      noneLeft ? note('info', t('subjects.add.allTaken')) : null,
      el('button', {
        type: 'button', id: 'subjects-more', class: 'pick-more', disabled: d.items.filter((item) => !filled(item.groupId)).length >= freeLeft.length,
        onclick: () => addRow(d),
      }, icon('plus'), t('subjects.add.more'))),
    d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', class: 'button button--secondary', onclick: close }, t('common.cancel')),
      save));
}

// One row: the group (only those without this discipline, not chosen above), its teacher, and a cross.
function pickRow(d, item, i, teacherOptions) {
  const errors = d.rowErrors[i] ?? {};
  const number = ' ' + (i + 1);
  return el('li', { class: 'pick-row' },
    selectField({
      id: `subjects-row-${i}-group`, label: t('subjects.add.group') + number, hideLabel: true, value: item.groupId,
      placeholder: t('field.groupId.choose'), error: errors.groupId ?? null,
      options: groupsFor(d, i).map((group) => ({ value: group.id, label: group.name })),
      onChange: (value) => setRow(d, i, 'groupId', value),
    }),
    selectField({
      id: `subjects-row-${i}-teacher`, label: t('subjects.add.teacher') + number, hideLabel: true, value: item.teacherId,
      placeholder: t('field.teacherId.choose'), error: errors.teacherId ?? null, options: teacherOptions,
      onChange: (value) => setRow(d, i, 'teacherId', value),
    }),
    d.items.length > 1
      ? iconButton({ id: `subjects-row-${i}-remove`, iconName: 'close', label: t('subjects.add.removeRow') + number, className: 'pick-row__remove', onClick: () => removeRow(d, i) })
      : null);
}

// Another discipline: a group that already has it cannot stay chosen.
function chooseDiscipline(d, value) {
  d.disciplineId = value;
  Object.assign(d, { disciplineError: null, rowErrors: {}, messageKey: null });
  d.items.forEach((item, i) => {
    if (filled(item.groupId) && !groupsFor(d, i).some((group) => group.id === item.groupId)) item.groupId = '';
  });
  refresh();
}

function setRow(d, i, key, value) {
  d.items[i][key] = value;
  if (d.rowErrors[i]) delete d.rowErrors[i][key];
  d.messageKey = null;
  refresh();
}

function addRow(d) {
  d.items.push(nextRow(d.items));
  refresh();
  focusById(`subjects-row-${d.items.length - 1}-group`);
}

function removeRow(d, i) {
  d.items.splice(i, 1);
  d.rowErrors = withoutRow(d.rowErrors, i);
  refresh();
  focusById(`subjects-row-${Math.min(i, d.items.length - 1)}-group`);
}

async function saveAdd(d) {
  if (d.busy || state.dialog !== d) return;
  const { ready, data } = addRequest(d.disciplineId, d.items);
  if (!ready) return;
  // The rows sent, by their place in the window: the server names a row by its place in the request.
  const sent = d.items.map((item, i) => i).filter((i) => filled(d.items[i].groupId) || filled(d.items[i].teacherId));
  const owner = state;
  Object.assign(d, { busy: true, disciplineError: null, rowErrors: {}, messageKey: null });
  refresh();
  try {
    const answer = await call('subjects.add', data);
    if (state !== owner) return;
    // The subjects exist now: the window goes on to the syllabus of their teachers, read with the new overview.
    Object.assign(d, { busy: false, step: 2, created: answer.rows.map((row) => row.id), returnId: 'subjects-add' });
    owner.freshIds = d.created;
    refresh();
    await load();
    // The next thing to do is the first upload; with every syllabus in, «Готово».
    const first = document.querySelector('#subjects-dialog .added__buttons button');
    if (first) first.focus();
    else focusById('subjects-done');
  } catch (error) {
    if (state !== owner) return;
    d.busy = false;
    showAddError(d, error, sent);
    refresh();
    focusFirstInvalid();
  }
}

// An error of a row goes under its group or its teacher; an unknown discipline under the list of disciplines.
function showAddError(d, error, sent) {
  const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
  if (fields.length === 0) {
    d.messageKey = errorKey(error.code);
    return;
  }
  for (const { index, field, code } of fields) {
    const key = fieldErrorKey('subjects', field, code);
    const row = sent[index];
    if (field === 'disciplineId' && code === 'bad_ref') d.disciplineError = key;
    else if (row === undefined) d.messageKey = d.messageKey ?? key;
    else {
      const target = field === 'teacherId' ? 'teacherId' : 'groupId';
      d.rowErrors[row] = d.rowErrors[row] ?? {};
      d.rowErrors[row][target] = d.rowErrors[row][target] ?? key;
    }
  }
}

// «Добавить предмет», step 2: each teacher of the new subjects, their groups and their syllabus

function addedList(d, close) {
  const { rows, disciplines } = state.data;
  const discipline = disciplines.find((item) => item.id === d.disciplineId);
  const list = addedTeachers(rows, d.disciplineId, d.created);
  const uploadRight = can('syllabus.apply');
  let content;
  if (list.length > 0) {
    content = el('section', { class: 'added', 'aria-labelledby': 'subjects-added-title' },
      el('h3', { class: 'added__head', id: 'subjects-added-title' }, disciplineName(discipline ? discipline.name : list[0].disciplineName)),
      el('ul', { class: 'added__list' }, list.map((row) => addedItem(row, uploadRight))));
  } else if (state.loadErrorKey) content = reloadFailure('subjects-added-retry');
  else content = el('p', { class: 'loading' }, t('common.loading'));
  return [
    note('success', t('subjects.add.saved'), { role: 'status' }),
    uploadedNote('subjects-added-uploaded-form'),
    content,
    el('div', { class: 'dialog__actions' },
      el('button', { type: 'button', id: 'subjects-done', class: 'button button--primary', onclick: close }, t('subjects.add.done'))),
  ];
}

function addedItem(row, uploadRight) {
  const key = rowKey(row);
  const nameId = 'subjects-added-teacher-' + key;
  const uploadId = 'subjects-added-upload-' + key;
  const openId = 'subjects-added-open-' + key;
  return el('li', { class: 'added__item' },
    person(row.teacherName, nameId,
      el('span', { class: 'added__groups' }, row.groups.map((group) => el('span', { class: 'group-chip group-chip--small' }, group.groupName || '—')))),
    el('div', { class: 'added__side' },
      syllabusMark(row),
      el('span', { class: 'added__buttons' },
        uploadRight && takesFile(row) ? el('button', {
          type: 'button', id: uploadId, class: 'button button--primary', 'aria-describedby': nameId,
          onclick: () => upload(row, uploadId, openId),
        }, icon('upload'), t('syllabus.fillFromFile')) : null,
        el('a', { id: openId, class: 'button button--secondary', href: syllabusHref(row), 'aria-describedby': nameId }, t('subjects.open')))));
}

// The window of a group: another teacher, or the subject gone from the group

function openGroup(row, group) {
  state.status = null;
  state.uploaded = null;
  state.freshIds = [];
  state.dialog = {
    kind: 'group', subjectId: group.subjectId, groupName: group.groupName, disciplineName: row.disciplineName,
    teacherId: row.teacherId, startTeacherId: row.teacherId, startTeacherName: row.teacherName,
    confirm: false, busy: null, teacherError: null, messageKey: null, blocked: false,
    returnId: 'subjects-group-' + group.subjectId,
  };
  refresh();
}

// The active teachers; the group's own teacher stays on the list even when no longer one.
function teacherChoices(d) {
  const options = state.data.teachers.map((teacher) => ({ value: teacher.id, label: teacher.fullName }));
  if (filled(d.startTeacherId) && !options.some((option) => option.value === d.startTeacherId)) {
    options.unshift({ value: d.startTeacherId, label: d.startTeacherName || '—' });
  }
  return options;
}

function groupDialog(d) {
  const title = t('subjects.edit.title', { discipline: d.disciplineName, group: d.groupName });
  let dialog;
  const close = () => { if (!d.busy) dialog.close(); };
  if (d.confirm) {
    const remove = el('button', { type: 'button', id: 'subjects-remove-confirm', class: 'button button--danger', onclick: () => removeSubject(d) },
      t('subjects.edit.remove'));
    if (d.busy === 'remove') markBusy(remove, 'dir.removing');
    dialog = modal({ id: 'subjects-dialog', labelledBy: 'subjects-dialog-title', className: 'dialog--confirm', onClose: closeDialog, canCancel: () => !d.busy },
      el('h2', { class: 'dialog__title', id: 'subjects-dialog-title' }, title),
      el('p', {}, t('subjects.edit.removeText', { discipline: d.disciplineName, group: d.groupName })),
      d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
      el('div', { class: 'dialog__actions' },
        el('button', { type: 'button', class: 'button button--secondary', onclick: close }, t(d.blocked ? 'common.close' : 'common.cancel')),
        d.blocked ? null : remove));
    return dialog;
  }
  const save = el('button', { type: 'submit', id: 'subjects-teacher-save', class: 'button button--primary' }, t('common.save'));
  if (d.busy === 'save') markBusy(save, 'common.saving');
  dialog = modal({ id: 'subjects-dialog', labelledBy: 'subjects-dialog-title', onClose: closeDialog, canCancel: () => !d.busy },
    el('h2', { class: 'dialog__title', id: 'subjects-dialog-title' }, title),
    el('form', { class: 'form', novalidate: true, onsubmit: (event) => { event.preventDefault(); saveTeacher(d); } },
      selectField({
        id: 'subjects-teacher', label: t('subjects.add.teacher'), value: d.teacherId, options: teacherChoices(d), error: d.teacherError,
        onChange: (value) => { d.teacherId = value; d.teacherError = null; },
      }),
      d.messageKey ? note('error', t(d.messageKey), { role: 'alert' }) : null,
      el('div', { class: 'dialog__actions' },
        can('dir.remove:subjects') ? el('button', {
          type: 'button', id: 'subjects-remove', class: 'button button--secondary button--quiet-danger dialog__aside',
          onclick: () => { if (d.busy) return; Object.assign(d, { confirm: true, messageKey: null }); refresh(); focusById('subjects-remove-confirm'); },
        }, icon('trash'), t('subjects.edit.remove')) : null,
        el('button', { type: 'button', class: 'button button--secondary', onclick: close }, t('common.cancel')),
        save)));
  return dialog;
}

async function saveTeacher(d) {
  if (d.busy || state.dialog !== d) return;
  if (d.teacherId === d.startTeacherId) {
    closeDialog();
    return;
  }
  const owner = state;
  Object.assign(d, { busy: 'save', teacherError: null, messageKey: null });
  refresh();
  try {
    const answer = await call('dir.save', { table: 'subjects', row: { id: d.subjectId, teacherId: d.teacherId } });
    if (state !== owner) return;
    // The group moves to the row of its new teacher; its chip keeps its id there. Its pairs went to the new teacher,
    // except those at a time the new teacher already teaches: the screen says how many stayed.
    const busy = Number(answer && answer.skippedBusy) || 0;
    Object.assign(owner, { dialog: null, freshIds: [d.subjectId], status: { key: 'subjects.edit.saved', params: { group: d.groupName }, busy } });
    refresh();
    focusById(d.returnId, 'subjects-add');
    load();
  } catch (error) {
    if (state !== owner) return;
    d.busy = null;
    const fields = error.code === 'invalid' && Array.isArray(error.fields) ? error.fields : [];
    const teacher = fields.find((item) => item.field === 'teacherId');
    if (teacher) d.teacherError = fieldErrorKey('subjects', 'teacherId', teacher.code);
    else if (fields.length > 0) d.messageKey = fieldErrorKey('subjects', fields[0].field, fields[0].code);
    else d.messageKey = errorKey(error.code);
    if (error.code === 'not_found') load();
    refresh();
    focusFirstInvalid();
  }
}

async function removeSubject(d) {
  if (d.busy || state.dialog !== d) return;
  const owner = state;
  Object.assign(d, { busy: 'remove', messageKey: null });
  refresh();
  try {
    await call('dir.remove', { table: 'subjects', id: d.subjectId });
    if (state !== owner) return;
    Object.assign(owner, { dialog: null, status: { key: 'subjects.edit.removed', params: { discipline: d.disciplineName, group: d.groupName } } });
    refresh();
    focusById('subjects-add');
    load();
  } catch (error) {
    if (state !== owner) return;
    d.busy = null;
    // A subject in the week template or in the schedule stays: the window says why, and only «Закрыть» is left.
    d.messageKey = error.code === 'in_use' ? 'dir.inUse.subjects' : errorKey(error.code);
    d.blocked = !RETRYABLE.includes(error.code);
    if (error.code === 'not_found') load();
    refresh();
  }
}

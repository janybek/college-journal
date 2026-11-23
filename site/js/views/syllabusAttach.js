import { call, upload, RETRYABLE } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, focusById, modal, showModal, note, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { readAsBase64 } from '../photo.js';
import { uploadErrorCode, sizeText } from '../work.js';
import { syllabusFileProblem, syllabusFileErrorKey } from '../syllabusForm.js';
import { openFile } from './fileView.js';

// The block «Файл силлабуса» of the title tab of the form: the full syllabus of the college as one PDF or Word file, up
// to 10 MB, optional. The file belongs to the version; the server (syllabus.attachFile, dropFile, file) checks every
// right and the kind of the content, the site only hides the buttons the person may not use. The name of the file is
// only ever text. The block is not part of the unsaved changes of the tab: a file is sent the moment it is chosen.
// What is going on (the upload, its error, the note) lives here, not in the block, because the screen is redrawn
// while a file is on its way.

const ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const blank = (syllabusId = '') => ({
  syllabusId, busy: null,    // null | 'upload' | 'drop'
  share: 0, error: null, retry: null, done: null, onChange: () => {},
});
let state = blank();
let generation = 0;          // a new one on leaving: an answer of an earlier screen draws nothing
let picker = null;

// Leaving the form: an upload answered later changes nothing on the next screen.
export function leaveAttach() {
  generation += 1;
  state = blank();
}

const shownPercent = (share) => Math.round(Math.min(1, Math.max(0, share)) * 100);
const kindText = (kind) => t(kind === 'pdf' ? 'sform.file.kind.pdf' : 'sform.file.kind.word');
const dayOf = (at) => (/^\d{4}-\d{2}-\d{2}/.test(String(at)) ? `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}` : '—');

function metaLine(file) {
  const size = sizeText(file.size);
  return t('sform.file.meta', { kind: kindText(file.kind), size: t(size.key, size.params), date: dayOf(file.at) });
}

export function fileBlock({ syllabusId, file, canEdit, onChange }) {
  if (state.syllabusId !== syllabusId) {
    leaveAttach();
    state.syllabusId = syllabusId;
  }
  state.onChange = onChange;
  const busy = state.busy !== null;
  const open = () => openFile({
    fileId: '', name: file.name, kind: file.kind, request: () => call('syllabus.file', { syllabusId }), missingKey: 'syllabus.file.missing',
  });
  return el('section', { class: 'sform-file', id: 'sf-file', role: 'group', 'aria-labelledby': 'sf-file-title' },
    el('div', { class: 'sform-file__head' },
      el('h3', { class: 'sform-block__title sform-file__title', id: 'sf-file-title' }, t('sform.file.title')),
      canEdit ? el('p', { class: 'sform-file__hint' }, t('sform.file.hint')) : null),
    file ? el('div', { class: 'sform-file__row' },
      el('span', { class: 'sform-file__tile', 'data-kind': file.kind === 'pdf' ? 'pdf' : 'word', 'aria-hidden': 'true' }, kindText(file.kind)),
      el('div', { class: 'sform-file__text' },
        el('button', { type: 'button', id: 'sf-file-open', class: 'sform-file__name', onclick: open }, file.name),
        el('p', { class: 'sform-file__meta', id: 'sf-file-meta' }, metaLine(file))))
      : el('p', { class: 'sform-file__none', id: 'sf-file-none' }, icon('upload'), el('span', {}, t('sform.file.none'))),
    canEdit ? actions(file, busy) : null,
    state.busy === 'upload' ? progress() : null,
    state.error ? el('div', { class: 'sform-file__problem' },
      note('error', t(state.error), { id: 'sf-file-error', role: 'alert' }),
      state.retry ? el('button', { type: 'button', id: 'sf-file-retry', class: 'button button--secondary', onclick: state.retry }, t('sform.file.retry')) : null) : null,
    state.done ? note('success', t(state.done), { id: 'sf-file-note', role: 'status' }) : null);
}

function actions(file, busy) {
  const buttons = file
    ? [
      el('button', { type: 'button', id: 'sf-file-replace', class: 'button button--secondary', disabled: busy, onclick: pick }, icon('upload'), t('sform.file.replace')),
      el('button', { type: 'button', id: 'sf-file-remove', class: 'button button--secondary', disabled: busy, onclick: askRemove }, icon('trash'), t('sform.file.remove')),
    ]
    : [el('button', { type: 'button', id: 'sf-file-attach', class: 'button button--primary', disabled: busy, onclick: pick }, icon('upload'), t('sform.file.attach'))];
  return el('div', { class: 'sform-file__actions' }, buttons);
}

function progress() {
  return el('div', { class: 'sform-file__progress' },
    el('progress', { id: 'sf-file-progress', class: 'mine-progress', max: '1', value: String(state.share), 'aria-labelledby': 'sf-file-percent' }),
    el('span', { id: 'sf-file-percent', class: 'sform-file__percent' }, t('sform.file.uploading', { n: shownPercent(state.share) })));
}

function pick() {
  if (state.busy !== null) return;
  if (!picker) {
    picker = el('input', { type: 'file', accept: ACCEPT, class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', id: 'sf-file-input' });
    document.body.append(picker);
  }
  const owner = state;
  picker.value = '';
  picker.onchange = () => { if (picker.files[0]) choose(picker.files[0], owner); };
  picker.click();
}

async function choose(file, owner) {
  if (owner !== state || state.busy !== null) return;
  state.done = null;
  const problem = syllabusFileProblem({ name: file.name, size: file.size });
  if (problem) {
    Object.assign(state, { error: problem, retry: null });
    refresh();
    return;
  }
  Object.assign(state, { error: null, retry: null, busy: 'upload', share: 0 });
  refresh();
  let data;
  try {
    data = await readAsBase64(file);
  } catch (error) {
    if (owner === state) {
      Object.assign(state, { busy: null, error: 'sform.file.error.bad_file' });
      refresh();
    }
    return;
  }
  if (owner === state) send(owner, { name: file.name, data });
}

async function send(owner, payload) {
  const token = generation;
  Object.assign(state, { error: null, retry: null, done: null, busy: 'upload', share: 0 });
  refresh();
  try {
    const { file } = await upload('syllabus.attachFile', { syllabusId: owner.syllabusId, ...payload }, {
      onProgress: (share) => {
        if (token !== generation) return;
        state.share = share;
        const bar = document.getElementById('sf-file-progress');
        const percent = document.getElementById('sf-file-percent');
        if (bar) bar.value = share;
        if (percent) percent.textContent = t('sform.file.uploading', { n: shownPercent(share) });
      },
    });
    if (token !== generation) return;
    Object.assign(state, { busy: null, done: 'sform.file.done' });
    state.onChange(file);
  } catch (error) {
    if (token !== generation) return;
    const code = uploadErrorCode(error);
    Object.assign(state, {
      busy: null, error: syllabusFileErrorKey(error) ?? errorKey(code),
      retry: RETRYABLE.includes(code) || code === 'upload_slow' ? () => send(owner, payload) : null,
    });
    refresh();
  }
}

function askRemove() {
  if (state.busy !== null) return;
  const dialog = modal({
    id: 'sf-file-remove-ask', labelledBy: 'sf-file-remove-title', className: 'dialog--confirm',
    onClose: () => { dialog.remove(); focusById('sf-file-remove', 'sf-file'); },
  },
  el('h2', { class: 'dialog__title', id: 'sf-file-remove-title' }, t('sform.file.remove')),
  el('p', {}, t('sform.file.removeAsk')),
  el('div', { class: 'dialog__actions' },
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => dialog.close() }, t('common.cancel')),
    el('button', { type: 'button', id: 'sf-file-remove-go', class: 'button button--danger', onclick: () => { dialog.close(); drop(); } }, icon('trash'), t('sform.file.remove'))));
  showModal(document.body, dialog);
}

async function drop() {
  const owner = state;
  const token = generation;
  Object.assign(state, { error: null, retry: null, done: null, busy: 'drop' });
  refresh();
  try {
    await call('syllabus.dropFile', { syllabusId: owner.syllabusId });
    if (token !== generation) return;
    Object.assign(state, { busy: null, done: 'sform.file.removed' });
    state.onChange(null);
  } catch (error) {
    if (token !== generation) return;
    Object.assign(state, { busy: null, error: syllabusFileErrorKey(error) ?? errorKey(uploadErrorCode(error)) });
    refresh();
  }
}

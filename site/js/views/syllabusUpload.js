import { call } from '../api.js';
import { getUser } from '../session.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, hasText, modal, showModal, note, markBusy, focusById, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { loadXlsx } from '../xlsxLoader.js';
import { bookSheets, syllabusBook, READ_OPTIONS } from '../excel.js';
import { fileLabels, fileData, fileName, renamedHint } from '../syllabus.js';
import { dayMonth } from './pairParts.js';

// The Excel file of a syllabus, for the screens that show one: the template and «Скачать (Excel)» on the syllabus
// page for the staff; a file into the draft from the syllabus form and from «Предметы» of the deanery. A chosen
// file is read here (every sheet, dates caught before anything is sent), checked by syllabus.preview and shown in
// the check window: whose syllabus it is, what each semester holds and what it changes, remarks, errors with their
// sheet and Excel row. «Загрузить» is there only when the file has no errors; nothing is written before it.
// The host screen draws the window by calling renderUpload(root) at the end of its render, and leaveUpload() when
// it is left. Two screens host it: the syllabus page and the deanery's «Предметы» (from its table and its add window).

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 200;
const RETRYABLE = ['network', 'internal'];
const HELP = [['order', 'layers'], ['hours', 'clock'], ['semester', 'calendar'], ['control', 'checkCircle'], ['columns', 'grid']];

const blank = () => ({
  check: null,             // the open check window, see readFile
  helpOpen: false,         // «Как заполнить шаблон» is unfolded
  done: null,              // the subject whose syllabus was just uploaded: its page says so
  downloadErrorKey: null,
});
let state = blank();
let picker = null;

export function leaveUpload() {
  state = blank();
}

// «Силлабус загружен.» belongs to the page it was uploaded on: another semester or group of the page drops it.
export function forgetUploadNote() {
  state.done = null;
}

// The file of the syllabus page for the staff: «Как заполнить шаблон» and the template (no syllabus yet) or the version
// shown as a file. A file is uploaded from the form now («Загрузить из Excel» there fills the draft).
export function uploadControls(view) {
  const user = getUser();
  if (!user || user.kind === 'student') return null;
  const { subject, syllabus } = view;
  return el('div', { class: 'syllabus-tools' },
    el('div', { class: 'syllabus-tools__row' },
      el('button', {
        type: 'button', id: 'syllabus-help-toggle', class: 'help-toggle', 'aria-expanded': String(state.helpOpen), 'aria-controls': 'syllabus-help',
        onclick: () => { state.helpOpen = !state.helpOpen; refresh(); },
      }, icon('info'), el('span', {}, t('syllabus.help.title')), icon('chevron', 'help-toggle__chevron')),
      el('span', { class: 'syllabus-tools__buttons' },
        el('button', { type: 'button', id: 'syllabus-download', class: 'button button--secondary', onclick: () => download(view) },
          icon('download'), t(syllabus === null ? 'syllabus.template' : 'syllabus.download')))),
    state.downloadErrorKey ? note('error', t(state.downloadErrorKey), { role: 'alert' }) : null,
    state.done === subject.id ? note('success', t('syllabus.done'), { role: 'status' }) : null,
    helpPanel());
}

// «Как заполнить шаблон»: the rules of the template, each beside the sign of what it is about.
function helpPanel() {
  return el('section', { class: 'syllabus-help', id: 'syllabus-help', hidden: !state.helpOpen, 'aria-labelledby': 'syllabus-help-toggle' },
    el('ul', { class: 'syllabus-help__list' }, HELP.map(([key, iconName]) => el('li', { class: 'syllabus-help__item' },
      el('span', { class: 'syllabus-help__icon' }, icon(iconName)),
      el('p', {}, t('syllabus.help.' + key))))));
}

async function download(view) {
  // A file taken now is the newest word on this syllabus; the note about the upload before it is history.
  if (state.done !== null) {
    state.done = null;
    refresh();
  }
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    state.downloadErrorKey = 'import.error.library';
    refresh();
    return;
  }
  // Both semesters of the year are approved: the file holds the whole syllabus, so the other semester is read too.
  // A new version is a file of its own semester.
  let other = null;
  if (view.syllabus !== null && view.shown !== 'open' && view.semesters.length === 2) {
    try {
      other = await call('syllabus.get', { subjectId: view.subject.id, semester: view.semester === 1 ? 2 : 1 });
    } catch (error) {
      state.downloadErrorKey = errorKey(error.code);
      refresh();
      return;
    }
  }
  const name = view.syllabus === null ? 'syllabus-template.xlsx' : fileName([t('syllabus.title'), view.subject.name, view.subject.teacherName]);
  XLSX.writeFile(syllabusBook(XLSX, fileLabels(t), fileData(view, other)), name);
  if (state.downloadErrorKey) {
    state.downloadErrorKey = null;
    refresh();
  }
}

// Choose a file and check it. subject: { subjectId, disciplineName, teacherName, groupNames }; onDone(answer): after
// the upload, with the answer of syllabus.apply. returnId: the button (or ids to try in turn) focus goes back to when
// the window closes; a screen with several upload buttons names its own. intoDraft: the syllabus form calls it — the
// window says the file fills the draft and its button says «Заполнить черновик».
export function startUpload(subject, onDone, returnId = 'syllabus-upload', { intoDraft = false } = {}) {
  if (state.check) return;
  if (!picker) {
    picker = el('input', { type: 'file', accept: '.xlsx,.xls', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    document.body.append(picker);
  }
  picker.value = '';
  picker.onchange = () => { if (picker.files[0]) readFile(subject, onDone, returnId, picker.files[0], intoDraft); };
  picker.click();
}

export function renderUpload(root) {
  if (state.check) showModal(root, checkDialog(state.check));
}

// Reading the file

async function readFile(subject, onDone, returnId, file, intoDraft) {
  const check = {
    subject, onDone, returnId, intoDraft, file: { name: file.name, size: file.size },
    phase: 'reading',      // reading | checking | shown | failed (the file was not read or not checked)
    sheets: null,          // [{ name, cells, firstRow }] as sent
    fileError: null,       // { key, params }: the site did not send the file
    messageKey: null,      // a request failed
    retry: null,           // 'preview' | 'apply': what «Повторить» repeats
    preview: null,         // { ok, applied, found, summaries, errors, warnings }
    applying: false,
  };
  state.check = check;
  state.done = null;
  refresh();
  const fail = (key, params = null) => {
    if (state.check !== check) return;
    Object.assign(check, { phase: 'failed', fileError: { key, params } });
    refresh();
  };
  if (!/\.xlsx?$/i.test(file.name)) return fail('syllabus.fileError.type');
  if (file.size > MAX_FILE_BYTES) return fail('syllabus.fileError.tooBig');
  let XLSX;
  try {
    XLSX = await loadXlsx();
  } catch (error) {
    return fail('import.error.library');
  }
  let book;
  try {
    book = await readBook(XLSX, file);
  } catch (error) {
    return fail('import.error.unreadable');
  }
  if (book.tooMany) return fail('syllabus.fileError.tooMany');
  if (book.dateCell) return fail('syllabus.fileError.dateCell', book.dateCell);
  if (book.sheets.length === 0) return fail('syllabus.fileError.empty');
  if (state.check !== check) return;
  check.sheets = book.sheets;
  preview(check);
}

async function readBook(XLSX, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // An .xlsx file is a ZIP archive. Anything else under that name would be read as plain text and show garbage.
  if (/\.xlsx$/i.test(file.name) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not an xlsx file');
  return bookSheets(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }));
}

// Only what the server reads: the name and the cells of every sheet.
const request = (check) => ({ subjectId: check.subject.subjectId, sheets: check.sheets.map(({ name, cells }) => ({ name, cells })) });

async function preview(check) {
  Object.assign(check, { phase: 'checking', messageKey: null, retry: null });
  refresh();
  try {
    const answer = await call('syllabus.preview', request(check));
    if (state.check !== check) return;
    Object.assign(check, { phase: 'shown', preview: answer });
  } catch (error) {
    if (state.check !== check) return;
    Object.assign(check, { phase: 'failed', messageKey: errorKey(error.code), retry: RETRYABLE.includes(error.code) ? 'preview' : null });
  }
  refresh();
}

const clean = (check) => check.phase === 'shown' && check.preview.ok === true && check.preview.errors.length === 0;

async function apply(check) {
  if (check.applying || !clean(check)) return;
  Object.assign(check, { applying: true, messageKey: null, retry: null });
  refresh();
  try {
    const answer = await call('syllabus.apply', request(check));
    if (state.check !== check) return;
    if (answer.applied === true) {
      state.check = null;
      if (!check.intoDraft) state.done = check.subject.subjectId;
      check.onDone(answer);
      refresh();
      focusById(...[check.returnId].flat());
      return;
    }
    // Someone changed the syllabus or its pairs since the check: the window shows why the file is refused now.
    check.preview = answer;
  } catch (error) {
    if (state.check !== check) return;
    Object.assign(check, { messageKey: errorKey(error.code), retry: RETRYABLE.includes(error.code) ? 'apply' : null });
  }
  check.applying = false;
  refresh();
}

function close(check) {
  if (state.check !== check) return;
  state.check = null;
  refresh();
  focusById(...[check.returnId].flat());
}

// The check window

function checkDialog(check) {
  const { subject, preview: answer } = check;
  const ready = clean(check);
  const failed = check.fileError !== null || (answer !== null && !ready);
  const dialog = modal({ id: 'syllabus-check', labelledBy: 'syllabus-check-title', className: 'dialog--check', onClose: () => close(check), canCancel: () => !check.applying },
    el('h2', { class: 'dialog__title', id: 'syllabus-check-title' }, t('syllabus.check.title')),
    el('div', { class: 'check-head' },
      el('p', { class: 'check-head__whose' }, t('syllabus.check.whose', {
        discipline: subject.disciplineName, teacher: subject.teacherName, groups: subject.groupNames.join(', '),
      })),
      el('p', { class: 'check-head__file' }, icon('sheet', 'check-head__icon'), el('span', { class: 'check-head__name' }, check.file.name))),
    check.phase === 'reading' ? el('p', { class: 'loading', role: 'status' }, t('import.file.reading')) : null,
    check.phase === 'checking' ? el('p', { class: 'loading', role: 'status' }, t('import.check.busy')) : null,
    check.fileError ? note('error', t(check.fileError.key, check.fileError.params), { role: 'alert' }) : null,
    answer && ready && check.intoDraft ? note('info', t('syllabus.check.intoDraft'), { class: 'check-into-draft' }) : null,
    answer && ready ? summaries(answer.summaries) : null,
    answer ? warnings(answer, check.sheets) : null,
    answer ? errors(answer, check.sheets) : null,
    check.messageKey ? note('error', t(check.messageKey), { role: 'alert' }) : null,
    failed ? el('p', { class: 'check-failed' }, icon('alert', 'check-failed__icon'), el('span', {}, t('syllabus.check.failed'))) : null,
    el('div', { class: 'dialog__actions' }, actions(check, ready, () => dialog.close())));
  return dialog;
}

// closeDialog(): closes the window (its onClose forgets the check). After a refusal a retry would not change
// (no right to upload, the subject is gone) only «Закрыть» stays.
function actions(check, ready, closeDialog) {
  const canApply = ready && !(check.messageKey !== null && check.retry === null);
  const closing = el('button', { type: 'button', class: 'button button--secondary', onclick: () => { if (!check.applying) closeDialog(); } },
    t(canApply ? 'common.cancel' : 'common.close'));
  if (!canApply) {
    return [closing, check.retry === 'preview'
      ? el('button', { type: 'button', id: 'syllabus-check-retry', class: 'button button--primary', onclick: () => preview(check) }, t('common.retry')) : null];
  }
  const upload = el('button', { type: 'button', id: 'syllabus-check-apply', class: 'button button--primary', onclick: () => apply(check) },
    icon('upload'), t(check.retry === 'apply' ? 'common.retry' : check.intoDraft ? 'syllabus.check.fill' : 'syllabus.check.apply'));
  if (check.applying) markBusy(upload, check.intoDraft ? 'syllabus.check.filling' : 'syllabus.check.applying');
  return [closing, upload];
}

// Each semester of the file: what it holds, and whether it is new or replaces the uploaded one. When a file both adds
// and removes rows, a renamed topic is among them: one line says what happens to it.
function summaries(list) {
  const renamed = renamedHint(list);
  return [el('ul', { class: 'check-semesters' }, list.map((s) => el('li', { class: 'check-semester' },
    el('p', { class: 'check-semester__figures' }, t('syllabus.check.summary', {
      semester: s.planSemester, topics: s.topics, units: s.units, lecture: s.lectureHours,
      practice: s.practiceHours + s.controlHours, pairs: tCount('syllabus.pairsCount', s.pairs),
    })),
    el('p', { class: 'check-semester__change' + (s.replaces ? '' : ' is-first') }, s.replaces
      ? t('syllabus.check.replace', { added: s.added, changed: s.changed, removed: s.removed })
      : t('syllabus.check.first'))))),
  renamed ? el('p', { class: 'check-renamed' }, icon('info', 'check-renamed__icon'), el('span', {}, t('syllabus.check.renamed'))) : null];
}

function warnings(answer, sheets) {
  if (answer.warnings.length === 0) return null;
  return el('section', { class: 'check-group check-group--warning', 'aria-labelledby': 'syllabus-check-warnings' },
    el('h3', { class: 'check-group__title', id: 'syllabus-check-warnings' },
      t('syllabus.check.warnings'), el('span', { class: 'check-group__count' }, String(answer.warnings.length))),
    el('p', { class: 'check-group__hint' }, t('syllabus.check.warningsHint')),
    el('ul', { class: 'check-list' }, answer.warnings.map((warning) => el('li', { class: 'check-list__item' },
      icon('alert', 'check-list__icon'),
      el('p', {},
        warning.sheet ? el('span', { class: 'check-list__where' }, t('syllabus.whereSheet', { sheet: sheetName(answer, warning.sheet) })) : null,
        warning.sheet ? ' ' : null,
        warningText(warning, (row) => excelRow(answer, sheets, 'plan', row)))))));
}

function errors(answer, sheets) {
  if (answer.errors.length === 0) return null;
  const shown = answer.errors.slice(0, MAX_ERRORS_SHOWN);
  return el('section', { class: 'check-group check-group--error', 'aria-labelledby': 'syllabus-check-errors' },
    el('h3', { class: 'check-group__title', id: 'syllabus-check-errors' },
      t('syllabus.check.errors'), el('span', { class: 'check-group__count' }, String(answer.errors.length))),
    el('ul', { class: 'check-list' }, shown.map((error) => el('li', { class: 'check-list__item' },
      icon('alert', 'check-list__icon'),
      el('p', {},
        el('span', { class: 'check-list__where' }, where(answer, sheets, error)), ' ',
        errorText(error),
        error.count > 1 ? [' ', el('span', { class: 'check-list__count' }, tCount('syllabus.error.count', error.count))] : null)))),
    answer.errors.length > shown.length ? el('p', { class: 'check-group__hint' }, t('import.errors.more', { count: answer.errors.length - shown.length })) : null);
}

// The sheet as it is named in the file; a missing sheet by the name of the template.
const sheetName = (answer, sheet) => (answer.found && answer.found[sheet]) || t('syllabus.file.sheet.' + sheet);

// The line or the column of the template the field stands for: a line of «Сведения», a column of the plan.
function fieldName(sheet, field) {
  const key = `syllabus.file.${sheet}.${field}`;
  return hasText(key) ? t(key) : field;
}

// The row Excel shows for a row of the server: the empty rows above the sheet's data are added back.
function excelRow(answer, sheets, sheet, row) {
  const read = (sheets || []).find((s) => s.name === sheetName(answer, sheet));
  return row + (read ? read.firstRow : 0);
}

// «Лист «…», строка N, «…»:» with the row Excel shows.
function where(answer, sheets, error) {
  const sheet = sheetName(answer, error.sheet);
  if (error.row > 0) {
    const row = excelRow(answer, sheets, error.sheet, error.row);
    return error.field ? t('syllabus.where', { sheet, row, column: fieldName(error.sheet, error.field) }) : t('syllabus.whereSheet', { sheet });
  }
  return error.field ? t('syllabus.whereColumn', { sheet, column: fieldName(error.sheet, error.field) }) : t('syllabus.whereSheet', { sheet });
}

// The text of an error: the most particular one there is — of this sheet and column, of this column, of the code.
function errorText(error) {
  const key = [`syllabus.error.${error.sheet}.${error.field}.${error.code}`, `syllabus.error.${error.field}.${error.code}`, 'syllabus.error.' + error.code]
    .find((candidate) => !candidate.includes('..') && hasText(candidate));
  if (!key) return t(errorKey(error.code));
  return t(key, { name: error.name, date: error.date ? dayMonth(error.date) : '', held: error.held, semester: error.semester });
}

const joined = (list) => (Array.isArray(list) ? list.join(', ') : '');

// rowOf(n): the row Excel shows for row n of the plan.
function warningText(warning, rowOf) {
  const key = 'syllabus.warning.' + warning.code;
  if (!hasText(key)) return warning.code;
  switch (warning.code) {
    case 'semester_replaces':
      return t(key, { stored: warning.stored, file: warning.file, groups: joined(warning.groups) });
    case 'unit_title_differs':
      return t(key, { row: rowOf(warning.row), unit: warning.unit, title: warning.title, other: warning.other });
    case 'ignored_sheets':
    case 'ignored':
      return t(key, { titles: joined(warning.titles) });
    case 'info_empty':
      return t(key, { fields: joined((warning.fields || []).map((field) => fieldName('info', field))) });
    case 'total_mismatch':
      return t(key, { total: warning.total, sum: warning.classHours + warning.selfHours });
    case 'held_renamed':
      return t(key, { order: warning.order, from: warning.from, to: warning.to, date: dayMonth(warning.date) });
    default:
      return t(key, warning);
  }
}

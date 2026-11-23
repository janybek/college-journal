import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, fieldErrorKey, note, modal, showModal, markBusy, holdOnLeave, focusById } from '../ui.js';
import { icon } from '../icons.js';
import { getPref } from '../session.js';
import { applyTheme, pickTheme } from '../theme.js';
import { qrMatrix } from '../qr.js';
import { clockText, qrLink, arrivedList, stageOf, lessonDraft, lessonChanges, sourceKey } from '../lesson.js';
import { activityAllowed, coatAllowed } from '../journal.js';

// The screen of a started pair for the projector (#/lesson/<pairId>). Always light, whatever theme the teacher chose.
// Stage «Отметка»: the QR and the four digits that change every 15 seconds, the time left and who has arrived.
// Time comes only from the server's answer (milliseconds left) and performance.now() after it: the clock of the
// device is never read. «Материал»: the topic and the time left. «Итог»: the marks of the students, edited on the pair
// itself (journal.savePair), and «Завершить пару». Names are always put in as text.

const POLL_CHECKIN_MS = 3000;
const POLL_OTHER_MS = 20000;
const TICK_MS = 250;
const FATAL = ['forbidden', 'not_found'];
const TABS = ['checkin', 'material', 'summary'];
const STATUSES = ['present', 'late', 'absent', 'excused', 'madeup'];
const NOT_ATTENDED = ['absent', 'excused'];

const S = {
  pairId: null, lesson: null, at: 0, chosen: null, errorCode: null, busy: null,
  gen: 0, inflight: false, ticker: null, pollTimer: null, listening: false,
  root: null, sig: '', dialogOpen: false, rolled: false, due: false, seen: null, fresh: new Set(),
  seq: 0, edits: new Map(), saving: false, saved: false, done: false, rows: [], sent: [], problem: null,
};

export function render(root, params) {
  if (params.pairId !== S.pairId) resetFor(params.pairId);
  applyTheme('light');
  S.root = root;
  S.sig = '';
  listen();
  if (S.ticker === null) S.ticker = setInterval(tick, TICK_MS);
  draw();
  if (S.lesson === null && !S.inflight) fetchLesson();
  else if (S.pollTimer === null && !S.inflight) schedulePoll();
}

export function leave() {
  S.gen += 1;
  clearInterval(S.ticker);
  clearTimeout(S.pollTimer);
  S.ticker = null;
  S.pollTimer = null;
  S.root = null;
  S.pairId = null;
  S.lesson = null;
  S.inflight = false;
  S.dialogOpen = false;
  S.edits = new Map();
  S.saving = false;
  holdOnLeave(null);
  unlisten();
  applyTheme(pickTheme(getPref('theme')));
}

function resetFor(pairId) {
  S.gen += 1;
  clearTimeout(S.pollTimer);
  Object.assign(S, {
    pairId, lesson: null, chosen: null, errorCode: null, busy: null, inflight: false, pollTimer: null,
    dialogOpen: false, rolled: false, due: false, seen: null, fresh: new Set(),
    seq: 0, edits: new Map(), saving: false, saved: false, done: false, rows: [], sent: [], problem: null,
  });
  holdOnLeave(null);
}

// ---- Listeners: a hidden tab does not ask the server; coming back asks at once; the QR follows the window ----

function onVisibility() {
  if (document.hidden) { clearTimeout(S.pollTimer); S.pollTimer = null; return; }
  if (S.root) fetchLesson();
}

function onSize() {
  S.sig = '';
  draw();
}

function listen() {
  if (S.listening) return;
  S.listening = true;
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', onSize);
  window.addEventListener('resize', onSize);
}

function unlisten() {
  if (!S.listening) return;
  S.listening = false;
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('fullscreenchange', onSize);
  window.removeEventListener('resize', onSize);
}

// ---- The server ----

function schedulePoll() {
  clearTimeout(S.pollTimer);
  S.pollTimer = null;
  if (!S.root || document.hidden || FATAL.includes(S.errorCode)) return;
  const quick = S.lesson === null || stageOf(S.lesson, S.chosen) === 'checkin';
  S.pollTimer = setTimeout(fetchLesson, quick ? POLL_CHECKIN_MS : POLL_OTHER_MS);
}

async function fetchLesson() {
  if (S.inflight || !S.pairId) return;
  const gen = S.gen;
  const seq = ++S.seq;
  S.inflight = true;
  clearTimeout(S.pollTimer);
  try {
    const data = await call('lesson.get', { pairId: S.pairId });
    if (gen !== S.gen) return;
    if (seq === S.seq) accept(data.lesson);
  } catch (error) {
    if (gen !== S.gen) return;
    S.errorCode = error.code;
    S.sig = '';
    draw();
  } finally {
    if (gen === S.gen) { S.inflight = false; schedulePoll(); }
  }
}

function accept(lesson) {
  const arrived = arrivedList(lesson).map((s) => s.id);
  // names that appeared since the last answer shine for a moment (not on the first answer)
  S.fresh = S.seen === null ? new Set() : new Set(arrived.filter((id) => !S.seen.has(id)));
  S.seen = new Set(arrived);
  S.lesson = lesson;
  S.at = performance.now();
  S.errorCode = null;
  S.rolled = false;
  S.due = false;
  draw();
  tick();
}

async function act(name, action) {
  if (S.busy) return;
  const gen = S.gen;
  S.busy = name;
  S.errorCode = null;
  S.sig = '';
  draw();
  try {
    const data = await call(action, { pairId: S.pairId });
    if (gen !== S.gen) return;
    S.busy = null;
    S.seq += 1;
    if (name === 'end') S.chosen = null;
    if (name === 'finish') { S.done = true; S.chosen = 'summary'; S.edits = new Map(); syncHold(); }
    S.sig = '';
    accept(data.lesson);
    schedulePoll();
  } catch (error) {
    if (gen !== S.gen) return;
    S.busy = null;
    S.errorCode = error.code;
    S.sig = '';
    draw();
  }
}

// ---- Time ----

const elapsed = () => performance.now() - S.at;

function tick() {
  if (!S.root || !S.lesson) return;
  const lesson = S.lesson;
  const left = lesson.checkinLeftMs === null ? null : lesson.checkinLeftMs - elapsed();
  const timer = S.root.querySelector('#lesson-timer');
  if (timer && left !== null) timer.textContent = t('lesson.checkin.head', { time: clockText(left) });
  const material = S.root.querySelector('#lesson-left');
  if (material && lesson.lessonLeftMs !== null) material.textContent = t('lesson.material.left', { time: clockText(lesson.lessonLeftMs - elapsed()) });
  if (lesson.phase === 'lesson' && lesson.lessonLeftMs !== null && !S.due && lesson.lessonLeftMs - elapsed() <= 0) {
    S.due = true;
    fetchLesson();
    return;
  }
  if (lesson.phase !== 'checkin') return;
  // the step of the code ran out: show the next one at once and ask for the new pair of codes
  if (!S.rolled && lesson.code && lesson.code.msToNext - elapsed() <= 0) {
    S.rolled = true;
    draw();
    fetchLesson();
  }
  // the window ran out: the server settles the pair on its next answer
  if (!S.due && left !== null && left <= 0) {
    S.due = true;
    fetchLesson();
  }
}

// ---- Drawing ----

function codeShown(lesson) {
  const code = lesson.code;
  if (!code) return null;
  return S.rolled ? { digits: code.next, qr: code.nextQr } : { digits: code.now, qr: code.qr };
}

function signature() {
  const lesson = S.lesson;
  if (!lesson) return JSON.stringify([S.errorCode, null]);
  return JSON.stringify([
    S.errorCode, S.busy, S.chosen, lesson.phase, lesson.attended, lesson.total, codeShown(lesson), arrivedList(lesson).map((s) => s.id),
    lesson.pair.id, Boolean(document.fullscreenElement), window.innerHeight, window.innerWidth,
    S.done, S.saved, S.saving, lesson.pair.topicName, marksPrint(lesson),
  ]);
}

// The saved marks as the server has them: when they change, the table of «Итог» is drawn again.
const marksPrint = (lesson) => lesson.students.map((s) => [s.id, s.left, s.mark ? [s.mark.status, s.mark.noCoat, s.mark.activity, s.mark.source] : null, s.checkin ? s.checkin.at : null]);

function draw() {
  if (!S.root || S.dialogOpen) return;
  const sig = signature();
  if (sig === S.sig) return;
  S.sig = sig;
  const focused = S.root.contains(document.activeElement) ? document.activeElement.id : '';
  S.root.replaceChildren(...build().filter(Boolean));
  if (focused) focusById(focused);
  const canvas = S.root.querySelector('canvas.lp-qr__canvas');
  if (canvas) paintQr(canvas);
}

function build() {
  const lesson = S.lesson;
  if (!lesson) return [head(null, null), S.errorCode ? errorBlock() : el('p', { class: 'loading lp-loading' }, t('common.loading'))];
  const stage = stageOf(lesson, S.chosen);
  return [head(lesson, stage), S.errorCode ? errorBlock() : null, body(lesson, stage)];
}

function head(lesson, stage) {
  const back = lesson ? '#/journal/' + encodeURIComponent(lesson.pair.subjectId) : '#/';
  const fullscreen = Boolean(document.fullscreenElement);
  const title = lesson
    ? [lesson.pair.subjectName, lesson.pair.groupName, lesson.pair.roomName ? t('lesson.room', { room: lesson.pair.roomName }) : null].filter(Boolean).join(' · ')
    : t('lesson.title');
  const tabs = lesson ? TABS.filter((tab) => tab !== 'checkin' || lesson.phase === 'checkin') : [];
  return el('header', { class: 'lp-head' },
    el('div', { class: 'lp-head__title' },
      el('h1', { class: 'lp-head__name', id: 'lesson-name' }, title),
      lesson && lesson.pair.topicName ? el('p', { class: 'lp-head__topic' }, lesson.pair.topicName) : null),
    tabs.length > 0 ? el('div', { class: 'lp-tabs', role: 'tablist', 'aria-label': t('lesson.tabs.label') }, tabs.map((tab) => el('button', {
      type: 'button', role: 'tab', id: 'lesson-tab-' + tab, class: 'lp-tab', 'aria-selected': String(tab === stage), 'aria-controls': 'lesson-panel',
      onclick: () => { S.chosen = tab; S.sig = ''; draw(); schedulePoll(); },
    }, t('lesson.tab.' + tab)))) : null,
    el('div', { class: 'lp-head__tools' },
      typeof S.root.requestFullscreen === 'function' ? el('button', {
        type: 'button', id: 'lesson-fullscreen', class: 'button button--secondary lp-tool',
        onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else S.root.requestFullscreen(); },
      }, t(fullscreen ? 'lesson.fullscreenExit' : 'lesson.fullscreen')) : null,
      el('a', { class: 'button button--secondary lp-tool', id: 'lesson-close', href: back }, t('lesson.close'))));
}

function errorBlock() {
  const fatal = FATAL.includes(S.errorCode);
  return el('div', { class: 'lp-error', role: 'alert' },
    note('error', t(errorKey(S.errorCode))),
    fatal ? null : el('button', {
      type: 'button', id: 'lesson-retry', class: 'button button--primary lp-tool',
      onclick: () => { S.errorCode = null; S.sig = ''; draw(); fetchLesson(); },
    }, t('common.retry')));
}

function body(lesson, stage) {
  const panel = (...children) => el('section', { class: 'lp-body', id: 'lesson-panel', role: 'tabpanel', 'aria-labelledby': 'lesson-tab-' + stage }, ...children);
  if (stage === 'checkin') return panel(checkinStage(lesson));
  if (lesson.phase === 'none' && !S.done) {
    const start = el('button', { type: 'button', id: 'lesson-start', class: 'button button--primary lp-big', onclick: () => act('start', 'lesson.start') }, icon('grid'), t('lesson.start'));
    if (S.busy === 'start') markBusy(start, 'lesson.starting');
    return panel(el('div', { class: 'lp-none' }, el('h2', { class: 'lp-none__title' }, t('lesson.notStarted')), start));
  }
  return panel(stage === 'material' ? materialStage(lesson) : summaryStage(lesson));
}

// ---- «Материал»: the topic of the pair, the time left, how many have come ----

const backHref = (lesson) => '#/journal/' + encodeURIComponent(lesson.pair.subjectId);
const running = (lesson) => lesson.phase === 'checkin' || lesson.phase === 'lesson';

function finishButton() {
  const button = el('button', { type: 'button', id: 'lesson-finish', class: 'button button--secondary lp-big', onclick: askFinish }, t('lesson.finish'));
  if (S.busy === 'finish') markBusy(button, 'lesson.finishing');
  return button;
}

function materialStage(lesson) {
  const pair = lesson.pair;
  const topic = pair.topicName ? t('journal.topic', { n: pair.number, name: pair.topicName }) : t('lesson.material.noTopic');
  const kind = pair.lessonType
    ? t('lesson.material.kind', { type: t('lessonType.' + pair.lessonType).toLowerCase(), code: t('lessonType.short.' + pair.lessonType) + pair.number })
    : null;
  const left = lesson.lessonLeftMs === null ? null : lesson.lessonLeftMs - elapsed();
  return el('div', { class: 'lp-material' },
    el('h2', { class: 'lp-material__topic', id: 'lesson-topic' }, topic),
    kind ? el('p', { class: 'lp-material__kind', id: 'lesson-kind' }, kind) : null,
    el('p', { class: 'lp-material__left', id: 'lesson-left' }, left === null ? t('lesson.material.over') : t('lesson.material.left', { time: clockText(left) })),
    el('p', { class: 'lp-material__count', id: 'lesson-count' }, t('lesson.arrived', { n: lesson.attended, total: lesson.total })),
    running(lesson) ? finishButton() : null);
}

// ---- «Итог»: who came and how; the teacher corrects the marks here (not for the projector) ----

// What the table shows now: the saved marks with the unsaved edits laid over them.
function draftNow() {
  return lessonDraft(S.lesson).map((m) => (S.edits.has(m.studentId) ? { ...m, ...S.edits.get(m.studentId) } : m));
}

const hasBadInput = () => [...S.edits.values()].some((e) => e.activityBad);
const isDirty = () => Boolean(S.lesson) && (hasBadInput() || lessonChanges(draftNow(), S.lesson).length > 0);

// A pending edit holds the screen: leaving it asks first (the shared guard of main.js).
function syncHold() {
  holdOnLeave(isDirty() ? unsavedQuestion : null);
}

function edit(studentId, patch) {
  const base = lessonDraft(S.lesson).find((m) => m.studentId === studentId);
  const start = { status: base.status, noCoat: base.noCoat, activity: base.activity, activityText: base.activity === null ? '' : String(base.activity), activityBad: false };
  S.edits.set(studentId, { ...(S.edits.get(studentId) || start), ...patch });
  S.saved = false;
  syncHold();
}

function summaryStage(lesson) {
  const editable = lesson.phase === 'lesson' && !S.done;
  const marks = draftNow();
  const coat = coatAllowed(lesson.pair);
  const maxActivity = lesson.scheme.activity;
  S.rows = [];
  const rows = marks.map((mark, index) => buildRow(lesson, mark, index, { editable, coat, maxActivity }));
  const problem = el('div', { class: 'lp-sum__problem', id: 'lesson-problem' });
  S.problem = problem;
  const nothing = !lesson.students.some((s) => s.mark);
  const toJournal = (extra = '') => el('a', { class: 'button button--primary lp-tool' + extra, id: 'lesson-done-journal', href: backHref(lesson) }, t('lesson.done.journal'));
  return el('div', { class: 'lp-sum', id: 'lesson-summary' },
    el('p', { class: 'lp-sum__warn' }, icon('alert'), t('lesson.summary.notProjector')),
    S.done ? el('div', { class: 'lp-done', id: 'lesson-done' },
      el('h2', { class: 'lp-done__title' }, t('lesson.done')),
      nothing ? note('warning', t('lesson.done.empty'), { id: 'lesson-done-empty' }) : null,
      el('div', { class: 'lp-done__links' }, toJournal(), el('a', { class: 'button button--secondary lp-tool', id: 'lesson-done-home', href: '#/' }, t('lesson.done.home')))) : null,
    !S.done && lesson.phase === 'over' ? el('div', { class: 'lp-done__links' },
      el('p', { class: 'lp-sum__note', id: 'lesson-readonly' }, t('lesson.summary.readonly')), toJournal()) : null,
    lesson.phase === 'checkin' ? el('p', { class: 'lp-sum__note', id: 'lesson-checkin-note' }, t('lesson.summary.checkin')) : null,
    marks.length === 0
      ? el('p', { class: 'lp-sum__note' }, t('journal.emptyStudents'))
      : el('div', { class: 'lp-sum__scroll' }, el('table', { class: 'lp-sum__table', id: 'lesson-table' },
        el('caption', { class: 'lp-sum__caption' }, t('lesson.summary.list')),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', class: 'lp-sum__n' }, t('lesson.summary.col.n')),
          el('th', { scope: 'col' }, t('lesson.summary.col.student')),
          el('th', { scope: 'col' }, t('lesson.summary.col.mark')),
          el('th', { scope: 'col' }, t('lesson.summary.col.status')),
          coat ? el('th', { scope: 'col' }, t('journal.marks.coat')) : null,
          el('th', { scope: 'col' }, t('journal.marks.activity')))),
        el('tbody', {}, rows.map((row) => row.tr)))),
    problem,
    el('div', { class: 'lp-sum__actions' },
      editable ? saveButton() : null,
      S.saved ? el('p', { class: 'lp-sum__saved', id: 'lesson-saved', role: 'status' }, icon('check'), t('lesson.summary.saved')) : null,
      running(lesson) ? finishButton() : null));
}

function saveButton() {
  const button = el('button', { type: 'button', id: 'lesson-save', class: 'button button--primary lp-big', onclick: () => { save(); } }, icon('check'), t('common.save'));
  if (S.saving) markBusy(button, 'common.saving');
  else if (!isDirty()) button.disabled = true;
  return button;
}

function refreshSave() {
  const button = S.root && S.root.querySelector('#lesson-save');
  if (button && !S.saving) button.disabled = !isDirty();
  const saved = S.root && S.root.querySelector('#lesson-saved');
  if (saved && !S.saved) saved.remove();
}

function sourceText(student) {
  const key = sourceKey(student);
  if (!key) return t('lesson.source.none');
  const time = student.checkin ? student.checkin.at.slice(0, 5) : '';
  return t(key, { time }).trim();
}

function buildRow(lesson, mark, index, { editable, coat, maxActivity }) {
  const pair = lesson.pair;
  const student = lesson.students.find((s) => s.id === mark.studentId);
  const nameId = 'lesson-name-' + index;
  const row = { studentId: mark.studentId, index };
  const mine = () => S.edits.get(mark.studentId) || mark;
  row.tr = el('tr', { class: 'lp-sum__row', 'data-student': mark.studentId });
  S.rows.push(row);
  row.error = el('p', { class: 'field__error lp-sum__error', role: 'alert', hidden: true });
  const nameCell = el('th', { scope: 'row', class: 'lp-sum__name', id: nameId }, mark.fullName || '—', row.error);
  const auto = student && student.mark && student.mark.source === 'auto';
  const sourceCell = el('td', { class: 'lp-sum__source' + (auto ? ' is-auto' : '') }, sourceText(student));
  const statusCell = el('td', { class: 'lp-sum__status' });
  const coatCell = coat ? el('td', { class: 'lp-sum__coat' }) : null;
  const activityCell = el('td', { class: 'lp-sum__act' });

  if (!editable) {
    statusCell.append(mark.status ? t('journal.marks.status.' + mark.status) : '—');
    if (coatCell) coatCell.append(mark.noCoat ? t('journal.marks.coat') : '');
    activityCell.append(mark.activity === null ? '' : String(mark.activity));
  } else {
    row.buttons = STATUSES.map((status) => el('button', {
      type: 'button', class: 'mk-status__btn', id: `lesson-st-${index}-${status}`, 'data-status': status, 'aria-pressed': 'false', onclick: () => setStatus(row, status),
    }, t('journal.marks.status.' + status)));
    statusCell.append(el('div', { class: 'mk-status', role: 'group', 'aria-labelledby': nameId }, row.buttons));
    if (coatCell) {
      row.coatBox = el('input', {
        type: 'checkbox', class: 'check__input mk-coat__box', id: 'lesson-coat-' + index, 'aria-labelledby': nameId,
        onchange: () => { edit(mark.studentId, { noCoat: row.coatBox.checked }); clearRow(row); refreshSave(); },
      });
      coatCell.append(el('label', { class: 'mk-coat', for: row.coatBox.id }, row.coatBox, el('span', {}, t('journal.marks.coat'))));
    }
    row.activity = el('input', {
      type: 'number', class: 'field__input mk-act__input', id: 'lesson-act-' + index, min: '0', max: String(maxActivity), step: '1', inputmode: 'numeric',
      placeholder: t('journal.marks.activityPlaceholder', { max: maxActivity }), 'aria-labelledby': nameId,
      oninput: () => setActivity(row, maxActivity),
    });
    activityCell.append(row.activity);
    row.paint = () => {
      const now = mine();
      for (const button of row.buttons) button.setAttribute('aria-pressed', String(button.dataset.status === now.status));
      const was = now.status !== null && !NOT_ATTENDED.includes(now.status);
      if (row.coatBox) { row.coatBox.checked = now.noCoat === true; row.coatBox.disabled = !was; }
      row.activity.disabled = !activityAllowed(now.status, pair);
      const text = S.edits.has(mark.studentId) ? S.edits.get(mark.studentId).activityText : (now.activity === null ? '' : String(now.activity));
      if (row.activity.value !== text) row.activity.value = text;
    };
    row.paint();
  }
  row.tr.append(el('td', { class: 'lp-sum__n' }, String(index + 1)), nameCell, sourceCell, statusCell, coatCell, activityCell);
  return row;
}

function clearRow(row) {
  row.tr.classList.remove('is-invalid');
  row.error.hidden = true;
  row.error.replaceChildren();
  if (row.activity) row.activity.removeAttribute('aria-invalid');
  if (S.problem) S.problem.replaceChildren();
}

function showRowError(row, key) {
  row.tr.classList.add('is-invalid');
  row.error.replaceChildren(icon('alert'), t(key));
  row.error.hidden = false;
}

function setStatus(row, status) {
  if (S.saving) return;
  const patch = { status };
  if (NOT_ATTENDED.includes(status)) Object.assign(patch, { noCoat: false, activity: null, activityText: '', activityBad: false });
  edit(row.studentId, patch);
  clearRow(row);
  row.paint();
  refreshSave();
}

function setActivity(row, max) {
  const text = row.activity.value;
  const clean = text.trim();
  const bad = row.activity.validity.badInput || (clean !== '' && !(/^\d+$/.test(clean) && Number(clean) <= max));
  edit(row.studentId, { activityText: text, activityBad: bad, activity: clean === '' || bad ? null : Number(clean) });
  clearRow(row);
  refreshSave();
}

// Saves the edits (journal.savePair), then takes the answer again from lesson.get.
// Resolves to true when nothing is left unsaved.
async function save() {
  if (S.saving || !S.lesson) return false;
  if (S.problem) S.problem.replaceChildren();
  const badRow = S.rows.find((row) => S.edits.has(row.studentId) && S.edits.get(row.studentId).activityBad);
  if (badRow) {
    showRowError(badRow, 'journal.marks.error.activity.bad_value');
    badRow.activity.setAttribute('aria-invalid', 'true');
    badRow.activity.focus();
    return false;
  }
  const marks = lessonChanges(draftNow(), S.lesson);
  if (marks.length === 0) { S.edits = new Map(); syncHold(); return true; }
  const gen = S.gen;
  S.saving = true;
  S.sent = marks.map((m) => m.studentId);
  const button = S.root.querySelector('#lesson-save');
  if (button) markBusy(button, 'common.saving');
  try {
    await call('journal.savePair', { pairId: S.pairId, marks });
    if (gen !== S.gen) return false;
    const data = await call('lesson.get', { pairId: S.pairId });
    if (gen !== S.gen) return false;
    S.seq += 1;
    S.saving = false;
    S.edits = new Map();
    syncHold();
    accept(data.lesson);
    S.saved = true;
    S.sig = '';
    draw();
    return true;
  } catch (error) {
    if (gen !== S.gen) return false;
    S.saving = false;
    S.sig = '';
    draw();
    showSaveError(error);
    return false;
  }
}

// What the server did not like: a row (by the place of the mark in the request) or the whole request.
function showSaveError(error) {
  if (error.code === 'invalid' && Array.isArray(error.fields) && error.fields.length > 0) {
    const loose = [];
    for (const f of error.fields) {
      const row = S.rows.find((r) => r.studentId === (Number.isInteger(f.index) ? S.sent[f.index] : undefined));
      const key = fieldErrorKey('marks', f.field, f.code, 'journal.marks');
      if (row) {
        showRowError(row, key);
        if (f.field === 'activity' && row.activity) row.activity.setAttribute('aria-invalid', 'true');
      } else loose.push(key);
    }
    if (loose.length > 0 && S.problem) S.problem.replaceChildren(note('error', t(loose[0])));
    const first = S.root && S.root.querySelector('.lp-sum__row.is-invalid');
    if (first) first.scrollIntoView({ block: 'nearest' });
  } else if (S.problem) S.problem.replaceChildren(note('error', t(errorKey(error.code))));
}

// ---- Questions: unsaved edits, finishing the pair ----

// A small question with buttons; resolves to the value of the pressed one, or null on Escape.
function ask({ id, title, buttons }) {
  return new Promise((resolve) => {
    let answer = null;
    S.dialogOpen = true;
    const dialog = modal({
      id, labelledBy: id + '-title', className: 'dialog--confirm',
      onClose: () => { S.dialogOpen = false; dialog.remove(); S.sig = ''; draw(); resolve(answer); },
    },
    el('h2', { class: 'dialog__title', id: id + '-title' }, title),
    el('div', { class: 'dialog__actions' }, buttons.map((b) => el('button', {
      type: 'button', id: b.id, class: 'button ' + (b.primary ? 'button--primary' : 'button--secondary'), onclick: () => { answer = b.value; dialog.close(); },
    }, b.text))));
    showModal(S.root || document.body, dialog);
  });
}

// «Правки не сохранены. Сохранить?» -> true when the person may go on (saved, or left unsaved on purpose), false on «Отмена».
async function unsavedQuestion() {
  if (!isDirty()) return true;
  if (S.dialogOpen || !S.root) return false;
  const answer = await ask({
    id: 'lesson-unsaved', title: t('lesson.unsaved'),
    buttons: [
      { id: 'lesson-unsaved-cancel', text: t('common.cancel'), value: 'cancel' },
      { id: 'lesson-unsaved-discard', text: t('lesson.unsaved.discard'), value: 'discard' },
      { id: 'lesson-unsaved-save', text: t('common.save'), value: 'save', primary: true },
    ],
  });
  if (answer === 'discard') { S.edits = new Map(); syncHold(); return true; }
  if (answer === 'save') return save();
  return false;
}

async function askFinish() {
  if (S.busy || S.dialogOpen || S.saving || !S.root) return;
  const gen = S.gen;
  if (!(await unsavedQuestion()) || gen !== S.gen) return;
  const answer = await ask({
    id: 'lesson-finish-ask', title: t('lesson.finish.ask'),
    buttons: [
      { id: 'lesson-finish-no', text: t('common.cancel'), value: 'no' },
      { id: 'lesson-finish-yes', text: t('lesson.finish.yes'), value: 'yes', primary: true },
    ],
  });
  if (answer === 'yes' && gen === S.gen) act('finish', 'lesson.finish');
}

function checkinStage(lesson) {
  const shown = codeShown(lesson);
  const arrived = arrivedList(lesson);
  const end = el('button', { type: 'button', id: 'lesson-end', class: 'button button--primary lp-big', onclick: askEnd }, t('lesson.end'));
  if (S.busy === 'end') markBusy(end, 'lesson.ending');
  const left = lesson.checkinLeftMs === null ? null : lesson.checkinLeftMs - elapsed();
  return el('div', { class: 'lp-checkin' },
    el('div', { class: 'lp-qr' },
      shown ? el('canvas', { class: 'lp-qr__canvas', role: 'img', 'aria-label': t('lesson.qr.alt'), 'data-qr': shown.qr }) : null,
      shown ? el('div', { class: 'lp-code' },
        el('p', { class: 'lp-code__label' }, t('lesson.code')),
        el('div', { class: 'lp-code__digits', role: 'img', 'aria-label': t('lesson.code.aria', { digits: shown.digits.split('').join(' ') }) },
          shown.digits.split('').map((digit) => el('span', { class: 'lp-code__digit', 'aria-hidden': 'true' }, digit))),
        el('p', { class: 'lp-code__hint' }, t('lesson.code.change'))) : null),
    el('div', { class: 'lp-side' },
      el('p', { class: 'lp-side__stage', id: 'lesson-timer' }, t('lesson.checkin.head', { time: clockText(left) })),
      el('p', { class: 'lp-side__count', id: 'lesson-count' }, t('lesson.arrived', { n: lesson.attended, total: lesson.total })),
      arrived.length === 0
        ? el('p', { class: 'lp-side__none' }, t('lesson.arrived.none'))
        : el('ul', { class: 'lp-names', 'aria-label': t('lesson.names.label') }, arrived.map((s) => el('li', { class: 'lp-name' + (S.fresh.has(s.id) ? ' is-new' : '') }, s.name))),
      end));
}

// «Закончить отметку?»: whoever has not checked in becomes absent, so the teacher confirms first.
function askEnd() {
  if (S.busy || S.dialogOpen || !S.root) return;
  const dialog = modal({
    id: 'lesson-end-ask', labelledBy: 'lesson-end-title', className: 'dialog--confirm',
    onClose: () => { S.dialogOpen = false; S.sig = ''; draw(); },
  },
  el('h2', { class: 'dialog__title', id: 'lesson-end-title' }, t('lesson.end.ask')),
  el('div', { class: 'dialog__actions' },
    el('button', { type: 'button', id: 'lesson-end-no', class: 'button button--secondary', onclick: () => dialog.close() }, t('common.cancel')),
    el('button', { type: 'button', id: 'lesson-end-yes', class: 'button button--primary', onclick: () => { S.confirmed = true; dialog.close(); } }, t('lesson.end.yes'))));
  dialog.addEventListener('close', () => { if (S.confirmed) { S.confirmed = false; act('end', 'lesson.endCheckin'); } });
  S.dialogOpen = true;
  showModal(S.root, dialog);
}

// ---- The QR on a canvas: a whole number of pixels per module, a quiet zone of 4 modules, black on white ----

function paintQr(canvas) {
  const matrix = qrMatrix(qrLink(location.href, S.lesson.pair.id, canvas.dataset.qr));
  const modules = matrix.size + 8;
  const target = document.fullscreenElement ? window.innerHeight * 0.62 : Math.min(window.innerHeight * 0.5, 440);
  const cell = Math.max(2, Math.floor(target / modules));
  const side = cell * modules;
  canvas.width = side;
  canvas.height = side;
  canvas.style.width = side + 'px';
  canvas.style.height = side + 'px';
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, side, side);
  context.fillStyle = '#000000';
  matrix.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x]) context.fillRect((x + 4) * cell, (y + 4) * cell, cell, cell);
  });
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, note, modal, showModal, markBusy } from '../ui.js';
import { icon } from '../icons.js';
import { getPref } from '../session.js';
import { applyTheme, pickTheme } from '../theme.js';
import { qrMatrix } from '../qr.js';
import { clockText, qrLink, arrivedList, stageOf } from '../lesson.js';

// The screen of a started pair for the projector (#/lesson/<pairId>). Always light, whatever theme the teacher chose.
// Stage «Отметка»: the QR and the four digits that change every 15 seconds, the time left and who has arrived.
// Time comes only from the server's answer (milliseconds left) and performance.now() after it: the clock of the
// device is never read. «Материал» and «Итог» are placeholders until the next task.

const POLL_CHECKIN_MS = 3000;
const POLL_OTHER_MS = 20000;
const TICK_MS = 250;
const FATAL = ['forbidden', 'not_found'];
const TABS = ['checkin', 'material', 'summary'];

const S = {
  pairId: null, lesson: null, at: 0, chosen: null, errorCode: null, busy: null,
  gen: 0, inflight: false, ticker: null, pollTimer: null, listening: false,
  root: null, sig: '', dialogOpen: false, rolled: false, due: false, seen: null, fresh: new Set(),
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
  unlisten();
  applyTheme(pickTheme(getPref('theme')));
}

function resetFor(pairId) {
  S.gen += 1;
  clearTimeout(S.pollTimer);
  Object.assign(S, {
    pairId, lesson: null, chosen: null, errorCode: null, busy: null, inflight: false, pollTimer: null,
    dialogOpen: false, rolled: false, due: false, seen: null, fresh: new Set(),
  });
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
  S.inflight = true;
  clearTimeout(S.pollTimer);
  try {
    const data = await call('lesson.get', { pairId: S.pairId });
    if (gen !== S.gen) return;
    accept(data.lesson);
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
    if (name === 'end') S.chosen = null;
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
  ]);
}

function draw() {
  if (!S.root || S.dialogOpen) return;
  const sig = signature();
  if (sig === S.sig) return;
  S.sig = sig;
  S.root.replaceChildren(...build().filter(Boolean));
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
  if (lesson.phase === 'none') {
    const start = el('button', { type: 'button', id: 'lesson-start', class: 'button button--primary lp-big', onclick: () => act('start', 'lesson.start') }, icon('grid'), t('lesson.start'));
    if (S.busy === 'start') markBusy(start, 'lesson.starting');
    return panel(el('div', { class: 'lp-none' }, el('h2', { class: 'lp-none__title' }, t('lesson.notStarted')), start));
  }
  return panel(el('div', { class: 'lp-none' }, el('h2', { class: 'lp-none__title' }, t('lesson.soon'))));
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

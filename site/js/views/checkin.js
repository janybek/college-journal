import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, hasText, note, markBusy, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { cleanCode, checkinMessage, clockText, cameMark } from '../lesson.js';
import { deviceId, keepPass, takePass, takePassNote } from '../device.js';

// «Я на паре»: the student enters the 4 digits from the teacher's screen; a pass from a QR link marks them by itself.
// The server decides everything (time, codes, the phone); this screen only shows its answer. Drawn from this state,
// so the typed digits and messages survive a redraw (a language switch); leave() drops it.
const TICK_MS = 500;
const NOTE_TONES = { success: 'success', warning: 'warning', danger: 'error' };

const blank = () => ({
  owner: null, pair: undefined, at: 0, loadError: null, pending: false, busy: false, code: '', message: null,
  done: null, qrNote: null, refocus: false, due: false, timer: null, root: null,
});
// Counts the screens opened and left; it only grows and lives outside `S`, so an answer that comes after the
// screen was left never draws on the next one (another student on the same phone).
let generation = 0;
let S = blank();

export function render(root) {
  const user = getUser();
  if (S.owner !== user.id) {
    generation += 1;
    S = Object.assign(blank(), { owner: user.id, qrNote: takePassNote() });
  }
  S.root = root;
  root.append(screen());
  if (S.timer === null) S.timer = setInterval(tick, TICK_MS);
  if (S.pair === undefined && !S.pending && S.loadError === null) load();
  if (S.refocus) {
    S.refocus = false;
    const input = document.getElementById('here-code');
    if (input) input.focus();
  }
  tick();
}

export function leave() {
  clearInterval(S.timer);
  generation += 1;
  S = blank();
}

async function load() {
  const gen = generation;
  S.pending = true;
  try {
    const data = await call('checkin.current', {});
    if (gen !== generation) return;
    S.pair = data.pair;
    S.at = performance.now();
    S.loadError = null;
    S.due = false;
  } catch (error) {
    if (gen !== generation) return;
    S.loadError = errorKey(error.code);
  }
  S.pending = false;
  refresh();
  const pair = S.pair;
  if (gen === generation && pair && pair.phase === 'checkin' && !cameMark(pair.mark) && !S.done) {
    const pass = takePass(pair.id);
    if (pass !== null) send({ pass }, pair, pass);
  }
}

const left = () => (S.pair ? S.pair.checkinLeftMs - (performance.now() - S.at) : 0);

function tick() {
  const timer = document.getElementById('here-left');
  if (!S.pair || S.pair.phase !== 'checkin') return;
  if (timer) timer.textContent = t('checkin.left', { time: clockText(left()) });
  if (!S.due && left() <= 0 && !S.pending) {
    S.due = true;
    S.pair = undefined;
    load();
  }
}

// One request to checkin.mark: with the digits or with a pass. Pressing twice sends one request.
async function send(proof, pair, pass = null) {
  if (S.busy) return;
  const gen = generation;
  S.busy = true;
  S.message = null;
  const button = document.getElementById('here-submit');
  if (button) markBusy(button, 'checkin.sending');
  let message;
  try {
    const answer = await call('checkin.mark', { pairId: pair.id, device: deviceId(), ...proof });
    if (gen !== generation) return;
    message = checkinMessage(answer);
    if (answer.result === 'ok' || (answer.result === 'already' && cameMark({ status: answer.status }))) S.done = { at: answer.at };
    if (answer.result === 'wrong_code') { S.code = ''; S.refocus = true; }
  } catch (error) {
    if (gen !== generation) return;
    message = checkinMessage(error.code);
    if (!hasText(message.key)) message = { key: errorKey(error.code), params: {}, tone: 'danger' };
    if (pass !== null && ['network', 'server_down', 'internal'].includes(error.code)) keepPass({ pairId: pair.id, pass });
    if (error.code === 'window_closed' || error.code === 'not_running') S.pair = undefined;
  }
  S.busy = false;
  S.message = message;
  refresh();
}

function screen() {
  return el('section', { class: 'here', 'aria-labelledby': 'here-title' },
    el('h1', { class: 'here__title', id: 'here-title' }, t('checkin.title')),
    S.qrNote ? note('warning', t(S.qrNote), { role: 'status', class: 'here__note' }) : null,
    body());
}

function body() {
  if (S.loadError) {
    return el('div', { class: 'here__failed', role: 'alert' },
      el('p', {}, t(S.loadError)),
      el('button', { type: 'button', class: 'button button--secondary here__go', onclick: () => { S.loadError = null; S.pair = undefined; refresh(); } }, t('common.retry')));
  }
  if (S.done || (S.pair && cameMark(S.pair.mark))) return markedView(S.done ? S.done.at : S.pair.mark.at);
  if (S.pair === undefined) return el('p', { class: 'loading' }, t('common.loading'));
  if (S.pair === null) {
    return el('div', { class: 'here__empty' },
      el('p', { class: 'here__big' }, t('checkin.none')),
      el('p', { class: 'here__muted' }, t('checkin.noneHint')),
      homeLink());
  }
  if (S.pair.phase !== 'checkin') {
    return el('div', { class: 'here__empty' },
      el('p', { class: 'here__big' }, t('checkin.closed')),
      el('p', { class: 'here__muted' }, t('checkin.closedHint')),
      homeLink());
  }
  return form(S.pair);
}

const homeLink = () => el('a', { class: 'button button--secondary here__go', href: '#/' }, t('checkin.home'));

function markedView(at) {
  return el('div', { class: 'here__done', role: 'status' },
    el('span', { class: 'here__tick' }, icon('check')),
    el('p', { class: 'here__big' }, t('checkin.marked', { at })),
    homeLink());
}

function form(pair) {
  const place = [pair.subjectName, pair.roomName ? t('lesson.room', { room: pair.roomName }) : null, pair.startTime].filter(Boolean).join(' · ');
  const submit = el('button', { type: 'submit', id: 'here-submit', class: 'button button--primary here__go' }, t('checkin.submit'));
  if (S.busy) markBusy(submit, 'checkin.sending');
  else if (S.code.length !== 4) submit.setAttribute('aria-disabled', 'true');
  const input = el('input', {
    id: 'here-code', name: 'code', class: 'here__code', type: 'text', value: S.code, inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'one-time-code', maxlength: 4, autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'here-hint',
    oninput: () => {
      S.code = cleanCode(input.value);
      if (input.value !== S.code) input.value = S.code;
      if (!S.busy) {
        if (S.code.length === 4) submit.removeAttribute('aria-disabled');
        else submit.setAttribute('aria-disabled', 'true');
      }
    },
  });
  return el('div', { class: 'here__body' },
    el('div', { class: 'here__pair' },
      el('p', { class: 'here__place' }, place),
      pair.teacherName ? el('p', { class: 'here__muted' }, pair.teacherName) : null,
      el('p', { class: 'here__left', id: 'here-left' }, t('checkin.left', { time: clockText(left()) }))),
    el('form', {
      class: 'here__form', novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        if (S.busy || S.code.length !== 4) return;
        send({ code: S.code }, pair);
      },
    },
    el('label', { class: 'here__label', for: 'here-code' }, t('checkin.code.label')),
    el('p', { class: 'here__muted', id: 'here-hint' }, t('checkin.code.hint')),
    input,
    submit,
    S.message ? note(NOTE_TONES[S.message.tone], t(S.message.key, S.message.params), { role: 'alert', class: 'here__msg' }) : null));
}

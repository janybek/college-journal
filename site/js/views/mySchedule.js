import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, emptyState, note, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { groupByDay } from '../pairs.js';
import { weekNav, dayList } from './pairParts.js';

// «Моё расписание» (#/my): the week of the signed-in teacher (the pairs they teach, substitutions included) or
// of the student's group. The first request has no `from`: the server answers with the week of «today» and says
// which day that is; the device clock is not used. Today's day is marked and scrolled into view once, when the
// screen opens. A teacher sees the group of each pair, a student its teacher.

const blank = () => ({
  from: null,          // the Monday of the week shown; null: the week of «today»
  today: null,         // from the last answer of the server
  result: null,        // { from, pairs }: what is drawn
  loadingFrom: undefined,
  errorKey: null,
  ticket: 0,
  scrolled: false,     // today has been brought into view
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root) {
  const user = getUser();
  const student = user.kind === 'student';
  if (state.result?.from !== state.from && state.loadingFrom !== state.from && state.errorKey === null) load(state);
  if (student) root.append(el('a', { class: 'back-link', href: '#/' }, icon('chevron'), t('common.toHome')));
  root.append(
    pageHeader({
      id: 'my-title', title: t('my.title'),
      lead: student ? (user.groupName ? t('my.leadStudent', { group: user.groupName }) : null) : t('my.leadTeacher'),
    }),
    el('section', { class: 'card schedule-card my-week', 'aria-labelledby': 'my-title' },
      state.result ? el('div', { class: 'toolbar schedule-toolbar' }, weekNav({ from: state.from ?? state.result.from, onChange: choose })) : null,
      body(student)));
  if (!state.scrolled && state.result && state.result.from === state.from) bringTodayIntoView(root);
}

async function load(owner) {
  const ticket = ++owner.ticket;
  const from = owner.from;
  owner.loadingFrom = from;
  try {
    const data = await call('schedule.mine', from === null ? {} : { from });
    if (state !== owner || owner.ticket !== ticket) return;
    owner.today = data.today;
    owner.from = data.from;
    owner.result = { from: data.from, pairs: data.pairs };
    owner.errorKey = null;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loadingFrom = undefined;
  }
  refresh();
}

// null: back to the week of «today», which only the server knows.
function choose(from) {
  state.from = from;
  state.errorKey = null;
  refresh();
}

function body(student) {
  if (state.errorKey) {
    const failed = emptyState('alert',
      el('p', {}, t(state.errorKey)),
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorKey = null; refresh(); } }, t('common.retry')));
    failed.setAttribute('role', 'alert');
    return el('div', { class: 'schedule-empty' }, failed);
  }
  const { result } = state;
  if (!result) return el('div', { class: 'schedule-empty' }, el('p', { class: 'loading' }, t('common.loading')));
  // The week being replaced by the next one stays, dimmed, until the answer comes.
  const stale = result.from !== state.from;
  // Monday to Saturday; Sunday only when it has a pair.
  const days = groupByDay(result.pairs, result.from, 7).filter((day, i) => i < 6 || day.pairs.length > 0);
  return el('div', { class: 'schedule-body' + (stale ? ' is-stale' : ''), 'aria-busy': stale ? 'true' : null },
    el('div', { class: 'schedule-week' },
      result.pairs.length === 0 ? note('info', t('my.emptyWeek')) : null,
      dayList(days, state.today, { show: student ? ['teacher'] : ['group'] })));
}

// Once per opening, after the frame is on the page: a later redraw (language, theme, another week) keeps the
// person's own scroll. Only when the head of today is out of sight (a phone, a day low in the list): on a wide
// window the days stand side by side and today is already in view.
function bringTodayIntoView(root) {
  state.scrolled = true;
  requestAnimationFrame(() => {
    const today = root.querySelector('.day.is-today');
    if (!today || !today.isConnected) return;
    const head = today.querySelector('.day__head').getBoundingClientRect();
    const bar = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
    if (head.top >= bar && head.bottom <= window.innerHeight) return;
    today.scrollIntoView({ block: 'start' });
  });
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, emptyState, focusById, note, pageHeader, refresh } from '../ui.js';
import {
  cellView, pairHead, canMark, pairHint, pairActions, VIEWS, DEFAULT_VIEW, addDays, isoWeekday, weekRange, pairDates,
  nearestPairDate, stepPairDate, unitOptions, currentUnit, viewColumns, selfCell, semesterCell,
} from '../journal.js';
import { openMarksDialog, openPairActionDialog } from './journalPair.js';
import { openCellDialog } from './journalCell.js';
import { openUnitDialog, openCurrentDialog } from './journalUnit.js';
import { icon } from '../icons.js';
import { getUser, getPref, setPref } from '../session.js';
import { activeRole } from '../shell.js';
import { todayAction } from '../lesson.js';

// The journal of a subject (#/journal/<subjectId>): the grid of students and pairs, read only (journal.get).
// Rows are students (those who left stand last, dimmed); columns are pairs, and after the last pair of a unit
// its four columns (current control, self-work, unit control, total), then the summary of attendance.
// The head of a pair the person may fill in (mode `free` or `reason`) looks like a button and opens the window of its
// marks; a cell of a held pair opens the window of that student's mark (late correction and the history). The server decides what is
// in the answer (a teacher who only substituted gets just their pairs, no unit totals); the screen only draws it.

const blank = (subjectId = null) => ({
  subjectId,
  data: null,          // the answer of journal.get; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
  view: null,          // what the grid shows: { mode, day, week, unit, dayNote }; made when the answer comes
  scrollLeft: null,    // where the person scrolled the whole journal to; null: show the nearest pair
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.subjectId !== params.subjectId) state = blank(params.subjectId);
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const subject = state.data && state.data.journal.subject;
  root.append(
    pageHeader({
      id: 'journal-title',
      title: subject ? `${subject.name} · ${subject.groupName}` : t('journal.title'),
      lead: subject && subject.teacherName ? t('journal.teacherLine', { name: subject.teacherName }) : null,
      actions: subject && canSeeLog(state.data.journal) ? el('a', { class: 'button button--secondary', id: 'journal-log-link', href: '#/journal-log/' + subject.id }, t('journalLog.link')) : null,
    }),
    state.data === null ? loadingBody() : body(state.data.journal));
}

// An answer that comes after the person left the page (or opened another journal) draws nothing.
async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('journal.get', { subjectId: owner.subjectId });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { data, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code || 'internal';
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function retry() {
  state.errorCode = null;
  load();
  refresh();
}

function loadingBody() {
  const code = state.errorCode;
  if (code === null) return el('p', { class: 'loading' }, t('journal.loading'));
  const back = el('a', { class: 'button button--secondary', href: '#/journal' }, t('journal.back'));
  const key = code === 'not_found' ? 'journal.notFound' : errorKey(code);
  const failure = emptyState('alert', el('p', {}, t(key)),
    code === 'not_found' || code === 'forbidden' ? back
      : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')));
  failure.setAttribute('role', 'alert');
  return failure;
}

const dayMonth = (date) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
const pointText = (value) => (value === null || value === undefined ? '—' : String(value));

function body(journal) {
  const notes = [];
  if (journal.partial) notes.push(note('info', t('journal.partial'), { id: 'journal-partial' }));
  else if (!journal.subject.hasSyllabus) notes.push(note('warning', t('journal.noSyllabus'), { id: 'journal-no-syllabus' }));
  if (journal.pairs.length === 0) {
    return el('div', { class: 'journal' }, notes, emptyState('table', el('p', { class: 'empty__title' }, t('journal.emptyPairs'))));
  }
  const view = currentView(journal);
  const shown = viewColumns(journal, view);
  const emptyKey = { day: 'journal.view.emptyDay', week: 'journal.view.emptyWeek', unit: 'journal.view.unitEmpty' }[view.mode];
  return el('div', { class: 'journal' },
    notes,
    el('p', { class: 'journal__scheme', id: 'journal-scheme' }, t('journal.scheme', { attendance: journal.scheme.attendance, activity: journal.scheme.activity })),
    viewBar(journal, view),
    view.mode === 'day' && view.dayNote ? note('info', t('journal.view.noToday'), { id: 'journal-view-note' }) : null,
    todayCard(journal),
    legend(journal.pairs.some(canMark)),
    journal.students.length === 0
      ? emptyState('table', el('p', { class: 'empty__title' }, t('journal.emptyStudents')))
      : shown.pairs.length === 0 && emptyKey
        ? emptyState('table', el('p', { class: 'empty__title', id: 'journal-view-empty' }, t(emptyKey)))
        : grid(journal, shown));
}

// ---- The views: day, week, unit, the whole term ----

const VIEW_PREF = 'view';

// Where each view opens: around «today» of the server, or, when today has no pair, around the nearest pair.
function freshView(journal, mode) {
  const near = nearestPairDate(journal.pairs, journal.today);
  const unit = currentUnit(journal.pairs, journal.today);
  return {
    mode,
    day: near ? near.date : journal.today,
    dayNote: near !== null && !near.exact,
    week: weekRange(near ? near.date : journal.today).from,
    unit: unit ? unit.unit : (unitOptions(journal)[0] ?? null),
  };
}

// The mode is remembered in this browser; the position never: it is always made from «today» again.
function currentView(journal) {
  if (state.view === null) {
    const saved = getPref(VIEW_PREF);
    let mode = VIEWS.includes(saved) ? saved : DEFAULT_VIEW;
    if (mode === 'unit' && unitOptions(journal).length === 0) mode = DEFAULT_VIEW;
    state.view = freshView(journal, mode);
  }
  return state.view;
}

function chooseMode(journal, mode) {
  setPref(VIEW_PREF, mode);
  state.scrollLeft = null;
  state.view = freshView(journal, mode);
  refresh();
  focusById('journal-view-' + mode);
}

function moveView(changes, focusId) {
  Object.assign(state.view, changes);
  refresh();
  focusById(focusId);
}

const dateText = (date) => t('date.dayMonth', { day: Number(date.slice(8, 10)), month: t('date.month.' + Number(date.slice(5, 7))) });
const dayLabel = (date) => t('date.weekdayDate', { weekday: t('date.weekday.' + isoWeekday(date)), date: dateText(date) });

// «16 – 22 ноября», or «30 ноября – 6 декабря» when the week spans two months.
function weekLabel(week) {
  const { from, to } = weekRange(week);
  const a = { day: Number(from.slice(8, 10)), month: Number(from.slice(5, 7)) };
  const b = { day: Number(to.slice(8, 10)), month: Number(to.slice(5, 7)) };
  return a.month === b.month
    ? t('journal.view.rangeSame', { from: a.day, to: b.day, month: t('date.month.' + a.month) })
    : t('journal.view.rangeDiff', { from: a.day, fromMonth: t('date.month.' + a.month), to: b.day, toMonth: t('date.month.' + b.month) });
}

function stepButton(dir, kind, disabled, onclick) {
  return el('button', {
    type: 'button', class: `jv-step jv-step--${dir < 0 ? 'prev' : 'next'}`, id: `journal-view-${dir < 0 ? 'prev' : 'next'}`, disabled,
    'aria-label': t(`journal.view.${dir < 0 ? 'prev' : 'next'}.${kind}`), onclick,
  }, icon('chevron'));
}

// The switch above the grid and what goes with the chosen mode: arrows and «Сегодня», or the list of units.
function viewBar(journal, view) {
  const hasUnits = unitOptions(journal).length > 0;
  const switcher = el('div', { class: 'segmented jv-modes', role: 'group', 'aria-label': t('journal.view.label') },
    VIEWS.map((mode) => el('button', {
      type: 'button', id: 'journal-view-' + mode, class: 'segmented__button', 'aria-pressed': String(mode === view.mode),
      disabled: mode === 'unit' && !hasUnits, onclick: () => { if (mode !== view.mode) chooseMode(journal, mode); },
    }, t('journal.view.' + mode))));
  return el('div', { class: 'jv-bar' }, switcher, view.mode === 'day' ? dayNav(journal, view) : view.mode === 'week' ? weekNav(journal, view) : view.mode === 'unit' ? unitNav(journal, view) : null);
}

function todayButton(journal, mode) {
  return el('button', {
    type: 'button', class: 'button button--secondary jv-today-btn', id: 'journal-view-today',
    onclick: () => { state.view = freshView(journal, mode); refresh(); focusById('journal-view-today'); },
  }, t('journal.view.today'));
}

function dayNav(journal, view) {
  const prev = stepPairDate(journal.pairs, view.day, -1);
  const next = stepPairDate(journal.pairs, view.day, 1);
  return el('div', { class: 'jv-nav' },
    stepButton(-1, 'day', prev === null, () => moveView({ day: prev, dayNote: false }, 'journal-view-prev')),
    el('span', { class: 'jv-nav__label', id: 'journal-view-label', 'aria-live': 'polite' }, dayLabel(view.day)),
    stepButton(1, 'day', next === null, () => moveView({ day: next, dayNote: false }, 'journal-view-next')),
    todayButton(journal, 'day'));
}

function weekNav(journal, view) {
  const dates = pairDates(journal.pairs);
  const { from } = weekRange(view.week);
  const hasPrev = weekRange(dates[0]).from < from;
  const hasNext = weekRange(dates[dates.length - 1]).from > from;
  return el('div', { class: 'jv-nav' },
    stepButton(-1, 'week', !hasPrev, () => moveView({ week: addDays(from, -7) }, 'journal-view-prev')),
    el('span', { class: 'jv-nav__label', id: 'journal-view-label', 'aria-live': 'polite' }, weekLabel(from)),
    stepButton(1, 'week', !hasNext, () => moveView({ week: addDays(from, 7) }, 'journal-view-next')),
    todayButton(journal, 'week'));
}

function unitNav(journal, view) {
  const going = currentUnit(journal.pairs, journal.today);
  const select = el('select', {
    class: 'field__input jv-unit', id: 'journal-view-unit-select', 'aria-label': t('journal.view.unitSelect'),
    onchange: (event) => { state.view.unit = Number(event.target.value); refresh(); focusById('journal-view-unit-select'); },
  }, unitOptions(journal).map((unit) => {
    const row = journal.units.find((u) => u.unit === unit);
    const text = [t('journal.view.unitOption', { n: unit }), row && row.title ? row.title : null, going && going.running && going.unit === unit ? t('journal.view.unitNow') : null]
      .filter(Boolean).join(' · ');
    return el('option', { value: String(unit), selected: unit === view.unit }, text);
  }));
  return el('div', { class: 'jv-nav' }, select);
}

// ---- The card «Сегодня» ----

// The pairs of today with the same action as the head of the pair: only for whoever may mark them.
function todayCard(journal) {
  const pairs = journal.pairs.filter((pair) => pair.date === journal.today);
  if (pairs.length === 0) return null;
  return el('section', { class: 'jv-today-card', id: 'journal-today', 'aria-label': t('journal.today.title') }, pairs.map((pair) => todayRow(pair)));
}

const todayOpenId = (pair) => `journal-today-open-${pair.id}`;

function todayRow(pair) {
  const { stateKey } = pairHead(pair);
  const hint = pairHint(pair, activeRole(getUser()));
  const topic = pair.topicName ? t('journal.topic', { n: pair.number === '' ? '' : pair.number, name: pair.topicName }) : t('journal.topicNone');
  const details = [
    t('journal.today.pair', { n: pair.slot }), pair.startTime, pair.lessonType ? t('lessonType.' + pair.lessonType) : null,
    topic, stateKey ? t(stateKey) : null,
  ].filter(Boolean).join(' · ');
  return el('div', { class: 'jv-today' },
    el('p', { class: 'jv-today__text' },
      el('strong', { class: 'jv-today__title' }, t('journal.today.title')),
      el('span', { class: 'jv-today__details' }, details),
      !canMark(pair) && hint ? el('span', { class: 'jv-today__hint' }, t(hint)) : null),
    canMark(pair) ? el('button', {
      type: 'button', class: 'button button--primary jv-today__act', id: todayOpenId(pair), 'aria-haspopup': 'dialog',
      onclick: () => openMarks(pair, todayOpenId(pair)),
    }, icon('pencil'), t(pair.status === 'planned' ? 'journal.markAction' : 'journal.today.edit')) : null,
    todayAction(pair) ? startButton(pair) : null);
}

// «Начать пару с QR» starts the pair and opens its screen; «Экран пары» opens the screen of a started one.
function startButton(pair) {
  const open = todayAction(pair) === 'open';
  const id = `journal-today-start-${pair.id}`;
  const failure = el('span', { class: 'jv-today__hint', role: 'alert', id: id + '-error' });
  const button = el('button', {
    type: 'button', class: 'button button--secondary jv-today__act', id,
    onclick: async () => {
      if (open) { location.hash = '#/lesson/' + encodeURIComponent(pair.id); return; }
      if (button.getAttribute('aria-disabled') === 'true') return;
      button.setAttribute('aria-disabled', 'true');
      failure.textContent = '';
      try {
        await call('lesson.start', { pairId: pair.id });
        location.hash = '#/lesson/' + encodeURIComponent(pair.id);
      } catch (error) {
        button.removeAttribute('aria-disabled');
        failure.textContent = t(errorKey(error.code));
      }
    },
  }, icon('grid'), t(open ? 'lesson.open' : 'lesson.startQr'));
  return el('span', { class: 'jv-today__start' }, button, failure);
}

// The key to the marks of the grid.
function legend(withOpen) {
  const item = (text, ...marks) => el('li', { class: 'journal-legend__item' }, marks, el('span', {}, text));
  const chip = (status) => el('span', { class: `jg-mark jg-mark--${cellView({ status }).tone}`, 'aria-hidden': 'true' }, t(cellView({ status }).key));
  return el('ul', { class: 'journal-legend', 'aria-label': t('journal.legend.title') },
    ['present', 'late', 'absent', 'excused', 'madeup'].map((status) => item(t('journal.legend.' + status), chip(status))),
    ['unfilled', 'overdue', 'missed'].map((name) => item(t('journal.state.' + name), el('span', { class: `jg-state jg-state--${name}`, 'aria-hidden': 'true' }))),
    item(t('journal.legend.noCoat'), el('span', { class: 'jg-coat', 'aria-hidden': 'true' })),
    item(t('journal.legend.activity'), el('span', { class: 'jg-act', 'aria-hidden': 'true' }, '5')),
    item(t('journal.legend.manual'), el('span', { class: 'jg-star', 'aria-hidden': 'true' }, '*')),
    withOpen ? item(t('journal.legend.open'), el('span', { class: 'jg-open-sample', 'aria-hidden': 'true' }, icon('pencil'))) : null);
}

function grid(journal, shown) {
  const { columns } = shown;
  const { scheme } = journal;
  const scroller = el('div', {
    class: 'table-scroll journal-scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'journal-title',
    onscroll: state.view.mode === 'all' ? (event) => { state.scrollLeft = event.currentTarget.scrollLeft; } : null,
  },
      el('table', { class: 'journal-grid', id: 'journal-grid' },
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col', class: 'jg-name' }, t('journal.col.student')),
          columns.map((column) => head(column, journal)))),
        el('tbody', {}, journal.students.map((student, index) => studentRow(student, index + 1, columns, journal, scheme)))));
  if (state.view.mode === 'all') requestAnimationFrame(() => placeScroll(scroller, shown.pairs, journal.today));
  return el('section', { class: 'card journal-card', 'aria-labelledby': 'journal-title' }, scroller);
}

// The whole journal opens scrolled so that the pair of today (or the nearest one) stands near the right edge, not at the far left.
function placeScroll(scroller, pairs, today) {
  if (!scroller.isConnected) return;
  if (state.scrollLeft !== null) { scroller.scrollLeft = state.scrollLeft; return; }
  const near = nearestPairDate(pairs, today);
  const pair = near && pairs.find((p) => p.date === near.date);
  const head = pair && scroller.querySelector(`[data-pair="${CSS.escape(pair.id)}"]`);
  if (!head) return;
  const edge = head.getBoundingClientRect().right - scroller.getBoundingClientRect().right;
  scroller.scrollLeft += edge + scroller.clientWidth * 0.2;
  state.scrollLeft = scroller.scrollLeft;
}

// A tooltip that opens on hover and on keyboard focus of the head; the head is focusable for that.
function tip(text) {
  return el('span', { class: 'jg-tip', role: 'tooltip' }, text);
}

function head(column, journal) {
  if (column.type === 'pair') return pairHeadCell(column.pair, journal.can, journal.today);
  if (column.type === 'unit') {
    const label = t('journal.col.' + column.field);
    const unit = journal.units.find((u) => u.unit === column.unit);
    const max = { current: journal.scheme.current, self: journal.scheme.self, control: journal.scheme.control, total: 100 }[column.field];
    const byWork = column.field === 'self' && !!unit && unit.byWork === true;
    const open = journal.can.results && !byWork && (column.field === 'control' || column.field === 'self');
    return el('th', { scope: 'col', class: `jg-unit-head jg-unit-head--${column.field}${open ? ' is-open' : ''}`, tabindex: open ? null : '0' },
      open ? el('button', {
        type: 'button', class: 'jg-open jg-unit-open', id: unitOpenId(column), 'aria-haspopup': 'dialog',
        'aria-label': t('journal.unit.open.' + column.field, { n: column.unit }), onclick: () => openUnit(column.unit, column.field),
      }) : null,
      el('span', { class: 'jg-unit-head__unit' }, t('journal.col.unit', { n: column.unit })),
      el('span', { class: 'jg-unit-head__label' }, label),
      open ? el('span', { class: 'jg-unit-head__act', 'aria-hidden': 'true' }, icon('pencil')) : null,
      byWork ? el('span', { class: 'jg-unit-head__tag' }, t('journal.self.byWork')) : null,
      byWork ? el('a', { class: 'jg-unit-head__tasks', id: 'journal-unit-tasks-' + column.unit, href: '#/tasks/' + encodeURIComponent(journal.subject.id) }, t('journal.self.tasks')) : null,
      tip([unit && unit.title ? unit.title + '. ' : '', byWork ? t('journal.self.byWorkHint') : t('journal.tip.' + column.field, { max })].join('')));
  }
  const key = column.type === 'outside' ? 'journal.col.outside' : 'journal.col.' + column.field;
  const tipKey = column.type === 'outside' ? null : 'journal.tip.' + column.field;
  return el('th', { scope: 'col', class: `jg-sum-head jg-sum-head--${column.type === 'outside' ? 'outside' : column.field}`, tabindex: tipKey ? '0' : null },
    el('span', { class: 'jg-unit-head__label' }, t(key)),
    tipKey ? tip(t(tipKey)) : null);
}

function pairHeadCell(pair, can, today) {
  const { kindKey, stateKey } = pairHead(pair);
  const narrow = pair.status === 'cancelled' || pair.status === 'missed';
  const topic = pair.topicName ? t('journal.topic', { n: pair.number === '' ? '' : pair.number, name: pair.topicName }) : t('journal.topicNone');
  const hint = pairHint(pair, activeRole(getUser()));
  const tipText = [topic, stateKey ? t(stateKey) : null, pair.substitution ? t('journal.sub', { name: pair.teacherName }) : null, hint ? t(hint) : null].filter(Boolean).join(' · ');
  const open = canMark(pair);
  const menu = pairActions(pair, can);
  return el('th', { scope: 'col', class: `jg-pair-head${menu.length > 0 ? ' has-menu' : ''}${narrow ? ' is-narrow' : ''}${pair.status === 'planned' ? ' is-planned' : ''}${open ? ' is-open' : ''}${pair.date === today ? ' is-today' : ''}`, tabindex: open ? null : '0', 'data-pair': pair.id },
    open ? el('button', {
      type: 'button', class: 'jg-open', id: openId(pair), 'aria-haspopup': 'dialog',
      'aria-label': t('journal.marks.open', { date: dayMonth(pair.date), kind: t(kindKey) }), onclick: () => openMarks(pair),
    }) : null,
    el('span', { class: 'jg-pair-head__date' }, dayMonth(pair.date)),
    el('span', { class: `jg-pair-head__kind jg-kind--${pair.lessonType || 'none'}` }, t(kindKey)),
    stateKey === 'journal.state.running' ? el('span', { class: 'jg-pair-head__live' }, t(stateKey)) : null,
    stateKey && stateKey !== 'journal.state.running' ? el('span', { class: `jg-state jg-state--${stateKey.slice('journal.state.'.length)}`, 'aria-hidden': 'true' }) : null,
    pair.substitution ? el('span', { class: 'jg-pair-head__sub' }, surname(pair.teacherName)) : null,
    open ? el('span', { class: 'jg-pair-head__act', 'aria-hidden': 'true' }, icon('pencil'),
      pair.status === 'planned' ? el('span', { class: 'jg-pair-head__act-text' }, t('journal.markAction')) : null) : null,
    menu.length > 0 ? actionMenuButton(pair, menu) : null,
    tip(tipText));
}

const menuId = (pair) => `journal-menu-${pair.id}`;

// The button «…» in the head of a pair (the deanery only): a small menu with the actions of pairActions.
function actionMenuButton(pair, actions) {
  return el('button', {
    type: 'button', class: 'jg-menu-btn', id: menuId(pair), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    'aria-label': t('journal.action.menu', { date: dayMonth(pair.date) }),
    onclick: (event) => openActionMenu(event.currentTarget, pair, actions),
  }, '…');
}

// The menu hangs on the document (the table scrolls and would cut it); it closes on a choice, Escape, a click elsewhere or a scroll.
function openActionMenu(button, pair, actions) {
  const was = document.getElementById('journal-menu');
  if (was) { was.dispatchEvent(new Event('dismiss')); if (was.dataset.pair === pair.id) return; }
  const close = (focusBack) => {
    menu.remove();
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', close, true);
    if (focusBack === true) button.focus();
  };
  const onOutside = (event) => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
  const onKey = (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(true); return; }
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if (event.key === 'Tab') close();
  };
  const menu = el('div', { class: 'jg-menu', id: 'journal-menu', role: 'menu', 'data-pair': pair.id, 'aria-label': t('journal.action.menu', { date: dayMonth(pair.date) }) },
    actions.map((action) => el('button', {
      type: 'button', role: 'menuitem', class: `jg-menu__item${action === 'clear' ? ' is-danger' : ''}`, 'data-action': action,
      onclick: () => { close(); openAction(pair, action); },
    }, t('journal.action.' + action))));
  menu.addEventListener('dismiss', () => close());
  document.body.append(menu);
  const box = button.getBoundingClientRect();
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.round(Math.min(box.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)))}px`;
  button.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('hashchange', close);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  menu.querySelector('[role="menuitem"]').focus();
}

// The window of a deanery action on a pair; the grid is drawn again from the answer.
function openAction(pair, action) {
  const owner = state;
  openPairActionDialog({
    pair, action,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(menuId(pair), openId(pair)),
  });
}

const openId = (pair) => `journal-open-${pair.id}`;
const unitOpenId = (column) => `journal-unit-open-${column.unit}-${column.field}`;
const currentOpenId = (unit, student) => `journal-current-open-${unit}-${student.id}`;

// Only the teacher of the subject enters the first value without a reason (the server says the same).
function isOwnTeacher(journal) {
  const user = getUser();
  return !!user && Array.isArray(user.roles) && user.roles.includes('teacher') && journal.subject.teacherId === user.id;
}

// «История изменений»: the log of the subject for its teacher, the deanery, the admin and the vice-rector; not in a partial journal.
function canSeeLog(journal) {
  const user = getUser();
  if (journal.partial || !user || !Array.isArray(user.permissions) || !user.permissions.includes('journal.log')) return false;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((role) => ['admin', 'dean', 'prorector'].includes(role)) || isOwnTeacher(journal);
}

// The window of the unit control or the self-work of a unit; the grid is drawn again from the answer.
function openUnit(unit, field) {
  const owner = state;
  openUnitDialog({
    journal: owner.data.journal, unit, field, isOwn: isOwnTeacher(owner.data.journal),
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(unitOpenId({ unit, field })),
  });
}

// The window of the manual current control of a student.
function openCurrent(unit, student) {
  const owner = state;
  openCurrentDialog({
    journal: owner.data.journal, unit, student,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(currentOpenId(unit, student)),
  });
}

// The window of the marks of a pair; the grid is drawn again from the answer to the save.
function openMarks(pair, backId = openId(pair)) {
  const owner = state;
  openMarksDialog({
    journal: owner.data.journal,
    pair,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(backId, openId(pair)),
  });
}

const surname = (fullName) => String(fullName || '').trim().split(/\s+/)[0] || '—';

function studentRow(student, number, columns, journal, scheme) {
  const result = journal.results[student.id] || null;
  return el('tr', { class: student.left ? 'is-left' : null, 'data-student': student.id },
    el('th', { scope: 'row', class: 'jg-name' },
      el('span', { class: 'jg-name__no' }, String(number)),
      el('span', { class: 'jg-name__text' }, student.fullName || '—'),
      student.left ? el('span', { class: 'jg-name__left' }, t('journal.left')) : null),
    columns.map((column) => cell(column, student, result, journal, scheme)));
}

function cell(column, student, result, journal, scheme) {
  if (column.type === 'pair') return markCell(column.pair, (journal.marks[column.pair.id] || {})[student.id], student);
  if (!result) return el('td', { class: 'jg-empty' }, '—');
  if (column.type === 'unit') {
    const row = result.units.find((u) => u.unit === column.unit);
    return row ? unitCell(column.field, row, scheme, journal, student) : el('td', { class: 'jg-empty' }, '—');
  }
  if (column.type === 'outside') return el('td', { class: 'jg-num jg-outside', title: t('journal.tip.outside', result.outside) }, pointText(result.outside.possible > 0 ? result.outside.earned : null));
  const { attendance } = result;
  if (column.field === 'absences') return el('td', { class: 'jg-num jg-sum jg-sum--absences' }, String(attendance.absent + attendance.excused));
  if (column.field === 'percent') return el('td', { class: 'jg-num jg-sum' }, attendance.percent === null ? '—' : attendance.percent + '%');
  const semester = semesterCell(result, journal.split);
  return el('td', { class: `jg-num jg-sum jg-sum--final${semester.tone === 'danger' ? ' is-low' : ''}`, title: semester.key ? t(semester.key, semester.params) : null }, semester.text);
}

function unitCell(field, row, scheme, journal, student) {
  if (field === 'current') {
    const manual = row.manual !== null;
    const open = journal.can.results && !student.left;
    const title = [t('journal.tip.current', { max: scheme.current }), manual ? t('journal.tip.manual') : null].filter(Boolean).join(', ');
    const inner = [pointText(row.current), manual ? el('span', { class: 'jg-star' }, '*') : null];
    return el('td', { class: `jg-num jg-pts${row.currentLow ? ' is-low' : ''}${open ? ' is-open' : ''}`, title },
      open ? el('button', {
        type: 'button', class: 'jg-cell-open', id: currentOpenId(row.unit, student), 'aria-haspopup': 'dialog',
        'aria-label': `${t('journal.unit.open.current', { n: row.unit, name: student.fullName || '—' })}. ${title}`,
        onclick: () => openCurrent(row.unit, student),
      }) : null,
      open ? el('span', { class: 'jg-pts__in' }, ...inner) : inner);
  }
  if (field === 'self') return selfTd(row, scheme);
  if (field === 'control') return el('td', { class: `jg-num jg-pts${row.controlLow ? ' is-low' : ''}`, title: t('journal.tip.control', { max: scheme.control }) }, pointText(row.control));
  const word = row.word ? ', ' + t('journal.grade.' + row.word) : '';
  return el('td', { class: `jg-num jg-pts jg-total${row.word === 'fail' ? ' is-low' : ''}`, title: t('journal.tip.total', { max: 100 }) + word }, pointText(row.total));
}

// The self-work cell: as entered, or counted by the assignments of the unit (the grey «предв.» while some are waiting).
function selfTd(row, scheme) {
  const cell = selfCell(row);
  if (cell.key === null) return el('td', { class: 'jg-num jg-pts', title: t('journal.tip.self', { max: scheme.self }) }, pointText(cell.value));
  const waiting = cell.key === 'journal.self.pending';
  return el('td', { class: 'jg-num jg-pts jg-self' + (waiting ? ' is-provisional' : ''), title: waiting ? t(cell.key, cell.params) : t('journal.self.byWorkHint') },
    el('span', { class: 'jg-self__value' }, pointText(cell.value)),
    el('span', { class: 'jg-self__tag' }, t(waiting ? 'journal.self.provisional' : 'journal.self.byWork')));
}

const cellId = (pair, student) => `journal-cell-${pair.id}-${student.id}`;

// The window of the mark of a student on a held pair; the grid is drawn again from the answer to a save.
function openCell(pair, student) {
  const owner = state;
  openCellDialog({
    journal: owner.data.journal,
    pair,
    student,
    onSaved: (data) => {
      if (state !== owner) return;
      owner.data = data;
      refresh();
    },
    onClosed: () => focusById(cellId(pair, student)),
  });
}

function markCell(pair, mark, student) {
  const view = cellView(mark, pair);
  const narrow = pair.status === 'cancelled' || pair.status === 'missed';
  const openable = pair.status === 'running' || pair.status === 'closed';
  const className = `jg-cell${narrow ? ' is-narrow' : ''}${openable ? ' is-open' : ''}`;
  const text = view === null ? '' : [t('journal.legend.' + mark.status), view.noCoat ? t('journal.legend.noCoat') : null, view.activity !== null ? t('journal.tip.activity', { n: view.activity }) : null].filter(Boolean).join(', ');
  const opener = openable ? el('button', {
    type: 'button', class: 'jg-cell-open', id: cellId(pair, student), 'aria-haspopup': 'dialog',
    'aria-label': `${t('journal.cell.open', { name: student.fullName || '—', date: dayMonth(pair.date) })}. ${text || t('journal.cell.noMark')}`,
    onclick: () => openCell(pair, student),
  }) : null;
  if (view === null) return el('td', { class: className }, opener);
  return el('td', { class: className, title: text, 'aria-label': openable ? null : text },
    opener,
    el('span', { class: 'jg-cell__in' },
      el('span', { class: `jg-mark jg-mark--${view.tone}` }, t(view.key)),
      view.activity !== null ? el('span', { class: 'jg-act' }, String(view.activity)) : null,
      view.noCoat ? el('span', { class: 'jg-coat' }) : null));
}

import { t } from '../i18n.js';
import { el, badge, iconButton, avatarTone, modal, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { permissions } from '../shell.js';
import { addDays, dayParts, isTime } from '../dates.js';
import { pairFlags, topicText, lessonTypeKey, lessonParts, controlLine, weekRows, gridDays, cellPairs, ownTime, hyphenate } from '../pairs.js';

// Parts shared by the schedule screens: the deanery's «Расписание» and the teacher's and student's own week.
// Everything from the server goes in as text.

const LESSON_TYPES = ['lecture', 'practice', 'control'];
const TYPE_TONES = { lecture: 'primary', practice: 'success', control: 'warning' };
const FLAG_TONES = { cancelled: 'danger', substitution: 'warning', moved: 'primary' };

export function dayMonth(date) {
  const { day, month } = dayParts(date);
  return t('date.dayMonth', { day, month: t('date.month.' + month) });
}

// 'четверг, 26 ноября'
export function weekdayDate(date) {
  return t('date.weekdayDate', { weekday: t('date.weekday.' + dayParts(date).weekday), date: dayMonth(date) });
}

// '16–22 ноября', or '30 ноября – 6 декабря' when the week crosses a month.
export function weekRange(from) {
  const to = addDays(from, 6);
  return dayParts(from).month === dayParts(to).month
    ? t('pairs.weekSameMonth', { from: dayParts(from).day, to: dayMonth(to) })
    : t('pairs.week', { from: dayMonth(from), to: dayMonth(to) });
}

export const pairTime = (pair) => (isTime(pair.startTime) && isTime(pair.endTime)
  ? t('pairs.time', { from: pair.startTime, to: pair.endTime }) : '');

export const pairCardId = (pair) => 'pair-' + pair.id;

// 'среда, 18 ноября, 2 пара'
const pairPlace = (pair) => t('schedule.place', { date: weekdayDate(pair.date), pair: t('settings.pairN', { n: pair.slot }) });

// «‹ неделя ›» and «Эта неделя». onChange(from): the Monday to show, or null for the week of «today» (the
// server knows which week that is; the device clock is not used).
export function weekNav({ from, onChange }) {
  return el('div', { class: 'week-nav', role: 'group', 'aria-label': t('pairs.weekNav') },
    iconButton({ id: 'week-prev', iconName: 'chevron', label: t('pairs.prevWeek'), className: 'icon-button--outline chevron-back', onClick: () => onChange(addDays(from, -7)) }),
    el('p', { class: 'week-nav__label', 'aria-live': 'polite' }, weekRange(from)),
    iconButton({ id: 'week-next', iconName: 'chevron', label: t('pairs.nextWeek'), className: 'icon-button--outline', onClick: () => onChange(addDays(from, 7)) }),
    el('button', { type: 'button', id: 'week-this', class: 'button button--secondary week-nav__this', onclick: () => onChange(null) }, t('pairs.thisWeek')));
}

// «Л1. Тема», «Модуль 2 (рубежный контроль)»: the lesson as text (topicText; its label is the letter of the kind
// and the number of the journal written together).
export function lessonText(topic) {
  const { key, params, label } = topicText(topic);
  return t(key, label ? { ...params, label: t(label.key) + label.number } : params);
}

// The lesson on a pair (`topic` of a pair view), as pieces to put in a line: its text, its type («Практика 1 из 2»
// when the row has more than one pair of this type) and, when modules without hours are marked on it, their names
// (two can stand after one lesson); a module without a name is the «Модуль» badge (controlLine).
export function lessonPieces(topic) {
  const controls = controlLine(topic.controls);
  return [
    el('span', { class: 'lesson-text' }, lessonText(topic)),
    typeBadge(topic),
    controls.badge || controls.names.length > 0 ? el('span', { class: 'lesson-controls' },
      controls.badge ? badge(t('pairs.unitControl'), 'warning') : null,
      controls.names.length > 0
        ? el('span', { class: 'lesson-controls__names' }, controls.names.map((name) => t(name.key, name.params)).join(' · ')) : null) : null,
  ];
}

// «Лекция», «Семинар», «Практика 1 из 2»: the type of the lesson (by its kind) in the colour of the type of the pair.
function typeBadge(topic) {
  if (!LESSON_TYPES.includes(topic.lessonType)) return null;
  const type = t(lessonTypeKey(topic));
  const parts = lessonParts(topic);
  return badge(parts ? t('pairs.lessonPart', { type, part: parts.part, parts: parts.parts }) : type, TYPE_TONES[topic.lessonType]);
}

// One pair. show: which of ['group', 'teacher'] to name; onOpen(pair): the card becomes a button.
// A cancelled pair has lost its topic, so it shows no topic line.
export function pairCard(pair, { show = [], onOpen = null } = {}) {
  const flags = pairFlags(pair);
  const cancelled = flags.includes('cancelled');
  const who = whoAndWhere(pair, show);
  const parts = [
    el('span', { class: 'pair__head' },
      el('span', { class: 'pair__time' }, pairTime(pair)),
      el('span', { class: 'pair__slot' }, t('settings.pairN', { n: pair.slot }))),
    el('span', { class: 'pair__subject' }, pair.subjectName),
    who.length > 0 ? el('span', { class: 'pair__meta' }, who) : null,
    cancelled ? null : topicLine(pair.topic),
    flags.length > 0 ? el('span', { class: 'pair__flags' }, flags.map((flag) => flagBadge(flag, pair))) : null,
    pair.note ? el('span', { class: 'pair__note' }, pair.note) : null,
  ];
  return cardElement(pair, 'pair' + (cancelled ? ' is-cancelled' : ''), parts, onOpen);
}

// The group or the teacher (whichever `show` names; a substitute in the warning colour) and the room.
function whoAndWhere(pair, show) {
  return [
    show.includes('group') && pair.groupName ? el('span', { class: 'pair__who' }, icon('layers'), pair.groupName) : null,
    show.includes('teacher') && pair.teacherName
      ? el('span', { class: 'pair__who' + (pair.substitution ? ' is-substitute' : '') }, icon('briefcase'), pair.teacherName) : null,
    pair.roomName ? el('span', { class: 'pair__who' }, icon('door'), pair.roomName) : null,
  ].filter(Boolean);
}

function cardElement(pair, className, parts, onOpen) {
  const attrs = { id: pairCardId(pair), class: className, 'data-tone': avatarTone(pair.subjectName) };
  return onOpen
    ? el('button', { type: 'button', ...attrs, onclick: () => onOpen(pair) }, parts)
    : el('div', attrs, parts);
}

function topicLine(topic) {
  if (!topic) return el('span', { class: 'pair__topic is-none' }, t('pairs.noTopic'));
  return el('span', { class: 'pair__topic' }, lessonPieces(topic));
}

// The badge of a flag; a moved pair also says where it was by the plan.
export function flagBadge(flag, pair) {
  const label = badge(t('pairs.flag.' + flag), FLAG_TONES[flag]);
  if (flag !== 'moved' || !pair.planDate) return label;
  return el('span', { class: 'pair__moved' }, label,
    el('span', { class: 'pair__from' }, t('pairs.movedFrom', { date: dayMonth(pair.planDate), pair: t('settings.pairN', { n: pair.planSlot }) })));
}

// The pairs that become buttons: those canOpen accepts (all, without it), when there is onOpen at all.
const opener = (pair, onOpen, canOpen) => (onOpen && (!canOpen || canOpen(pair)) ? onOpen : null);

// The name of a day, as a link to that day of the week template when dayHref(date) gives an address: [title, hint].
// The hint is the link's description, so the day keeps its own name as the title of its section or its column. In
// a column head the hint is hidden altogether: read inside the head, it would follow the day into every cell.
function dayTitle(date, titleId, dayHref, title, hintHidden = false) {
  const href = dayHref ? dayHref(date) : null;
  if (!href) return [title, null];
  const hint = t('schedule.toTemplate', { weekday: t('date.weekday.' + dayParts(date).weekday) });
  const hintId = titleId + '-hint';
  return [
    el('a', { class: 'day__link', href, title: hint, 'aria-describedby': hintId }, title),
    el('span', hintHidden ? { id: hintId, hidden: true } : { class: 'visually-hidden', id: hintId }, hint),
  ];
}

// Days in a row, each with its pairs; «today» is marked, an empty day says so.
// cardOptions: { show, onOpen, canOpen(pair), dayHref(date) }: only the pairs canOpen accepts (all, without it)
// become buttons; a day for which dayHref(date) gives an address has its name as a link there.
export function dayList(days, today, { show = [], onOpen = null, canOpen = null, dayHref = null } = {}) {
  return el('div', { class: 'days', 'data-count': days.length }, days.map(({ date, pairs }) => {
    const { day, weekday } = dayParts(date);
    const isToday = date === today;
    const titleId = 'day-' + date;
    const [title, hint] = dayTitle(date, titleId, dayHref, [
      el('span', { class: 'day__name' }, t('date.weekday.' + weekday)),
      el('span', { class: 'visually-hidden' }, ', '),
      el('span', { class: 'day__date' }, dayMonth(date)),
    ]);
    return el('section', { class: 'day' + (isToday ? ' is-today' : '') + (pairs.length === 0 ? ' is-empty' : ''), 'aria-labelledby': titleId },
      el('header', { class: 'day__head' },
        el('span', { class: 'day__leaf', 'aria-hidden': 'true' },
          el('span', { class: 'day__weekday' }, t('date.weekdayShort.' + weekday)),
          el('span', { class: 'day__number' }, String(day))),
        el('h2', { class: 'day__title', id: titleId }, title),
        hint,
        isToday ? badge(t('pairs.today'), 'primary', true) : null),
      pairs.length === 0
        ? el('p', { class: 'day__none' }, t('pairs.none'))
        : el('ul', { class: 'day__pairs' }, pairs.map((pair) => el('li', {},
          pairCard(pair, { show, onOpen: opener(pair, onOpen, canOpen) })))));
  }));
}

// ---- The week as a grid: the pair numbers down the left with their time, the days across ----

// From this width on a staff week is a grid; below it (and always for the student) the days are a list. At 1200 px a day
// column holds a card of about 120 px of text (about 100 px with a Saturday column): a real discipline name
// («Информационное обеспечение профессиональной деятельности») still reads on three lines, long words broken at
// their syllables (hyphenate).
export const GRID_FROM = '(min-width: 1200px)';
let gridQuery = null;

// One listener for the whole app: when the window crosses GRID_FROM while a week is on the screen, the screen is
// drawn again, as a grid or as a list. The screens keep what they show in their state: the week stays the same.
function gridFits() {
  if (gridQuery === null) {
    gridQuery = window.matchMedia(GRID_FROM);
    gridQuery.addEventListener('change', () => { if (document.querySelector('[data-week-view]')) refresh(); });
  }
  return gridQuery.matches;
}

// The week of a schedule screen. options: those of dayList plus { pairs, from, list }: the pairs of the week and its
// Monday, for the grid; list: true keeps the days as a list on any window (the student's phone screens).
export function weekView(days, today, { pairs, from, list = false, ...cardOptions }) {
  const grid = !list && gridFits();
  const view = grid ? weekGrid(pairs, from, today, cardOptions) : dayList(days, today, cardOptions);
  view.setAttribute('data-week-view', grid ? 'grid' : 'list');
  return view;
}

// A table: a row for each pair number of the week with its time on the left, a column for each day (Monday to
// Friday, a weekend day only with a pair). A cell holds short cards; an empty cell stays empty.
function weekGrid(pairs, from, today, { show = [], onOpen = null, canOpen = null, dayHref = null } = {}) {
  const dates = gridDays(pairs, from);
  return el('div', { class: 'table-scroll week-grid' },
    el('table', { class: 'grid', 'data-days': dates.length },
      el('caption', { class: 'visually-hidden' }, t('pairs.grid.caption')),
      el('colgroup', {}, el('col', { class: 'grid__slot-col' }), dates.map(() => el('col', {}))),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', class: 'grid__corner' }, t('pairs.grid.slot')),
        dates.map((date) => gridHead(date, today, dayHref)))),
      el('tbody', {}, weekRows(pairs).map((row) => el('tr', {},
        el('th', { scope: 'row', class: 'grid__slot' },
          el('span', { class: 'grid__pair' }, t('settings.pairN', { n: row.slot })),
          el('span', { class: 'grid__time' }, pairTime(row))),
        dates.map((date) => {
          const here = cellPairs(pairs, date, row.slot);
          return el('td', { class: 'grid__cell' + (date === today ? ' is-today' : '') }, here.length === 0 ? null
            : el('ul', { class: 'grid__pairs' }, here.map((pair) => el('li', {},
              briefCard(pair, row, { show, onOpen: opener(pair, onOpen, canOpen) })))));
        }))))));
}

// The head of a day's column: its name (a link to the week template when dayHref gives one), its date, «Сегодня».
function gridHead(date, today, dayHref) {
  const isToday = date === today;
  const titleId = 'grid-day-' + date;
  const [title, hint] = dayTitle(date, titleId, dayHref, [
    el('span', { class: 'day__name' }, t('date.weekday.' + dayParts(date).weekday)),
    el('span', { class: 'visually-hidden' }, ', '),
    el('span', { class: 'grid__date' }, dayMonth(date)),
  ], true);
  return el('th', { scope: 'col', id: titleId, class: 'grid__day' + (isToday ? ' is-today' : '') },
    el('span', { class: 'grid__dayhead' },
      el('span', { class: 'grid__daytitle' }, title), hint,
      isToday ? badge(t('pairs.today'), 'primary', true) : null));
}

// The short card of the grid: the subject on up to three lines (its full name in the tooltip and the pair's window),
// who and where on one line, the lesson on one line, then the marks: its type, a module marked on it, cancelled /
// substitution / moved, a note. The time only when the pair keeps another time than its row. The rest is in the window.
function briefCard(pair, row, { show, onOpen }) {
  const flags = pairFlags(pair);
  const cancelled = flags.includes('cancelled');
  const who = whoAndWhere(pair, show);
  const topic = cancelled ? null : pair.topic;
  const lesson = topic ? lessonText(topic) : null;
  const controls = controlLine(topic ? topic.controls : null);
  const marks = [
    topic ? typeBadge(topic) : null,
    controls.badge || controls.names.length > 0 ? badge(t('pairs.unitControl'), 'warning') : null,
    ...flags.map((flag) => badge(t('pairs.flag.' + flag), FLAG_TONES[flag])),
    pair.note ? el('span', { class: 'pair__has-note', title: t('pairs.hasNote') },
      icon('info'), el('span', { class: 'visually-hidden' }, t('pairs.hasNote'))) : null,
  ].filter(Boolean);
  const parts = [
    // Where the card stands, for a screen reader that reads the button on its own.
    el('span', { class: 'visually-hidden' }, pairPlace(pair) + ': '),
    ownTime(pair, row) ? el('span', { class: 'pair__time' }, pairTime(pair)) : null,
    el('span', { class: 'pair__subject', title: pair.subjectName }, hyphenate(pair.subjectName)),
    who.length > 0 ? el('span', { class: 'pair__line' }, who) : null,
    cancelled ? null : el('span', { class: 'pair__line pair__line--topic' + (lesson ? '' : ' is-none') },
      lesson ?? t('pairs.noTopic')),
    marks.length > 0 ? el('span', { class: 'pair__marks' }, marks) : null,
  ];
  return cardElement(pair, 'pair pair--brief' + (cancelled ? ' is-cancelled' : ''), parts, onOpen);
}

// ---- The window of a pair: everything about it, read-only ----

// The subject and the group; when; who teaches it (and whether it is a substitution); where; the lesson in full with
// its type and the modules marked on it; the marks of the pair with where a moved one stood; its note; a link to the
// syllabus of the subject for whoever may open it. onClose(): the person closed the window.
export function pairDetails(pair, { onClose }) {
  // A substitution is said next to the teacher, not among the marks.
  const flags = pairFlags(pair).filter((flag) => flag !== 'substitution');
  const time = pairTime(pair);
  const facts = [
    ['when', el('span', { class: 'pair-facts__when' }, time ? t('schedule.placeTime', { place: pairPlace(pair), time }) : pairPlace(pair))],
    ['teacher', [el('span', { class: pair.substitution ? 'is-substitute' : null }, pair.teacherName),
      pair.substitution ? badge(t('pairs.flag.substitution'), 'warning') : null]],
    ['room', pair.roomName ? pair.roomName : el('span', { class: 'muted' }, t('template.noRoom'))],
    pair.status === 'cancelled' ? null : ['topic', lessonFacts(pair.topic)],
    pair.note ? ['note', el('span', { class: 'pair-facts__note' }, pair.note)] : null,
  ].filter(Boolean);
  const syllabus = permissions().includes('syllabus.get') && pair.subjectId
    ? el('a', { id: 'pair-details-syllabus', class: 'button button--secondary dialog__aside', href: '#/syllabus/' + pair.subjectId },
      icon('clipboard'), t('pairs.details.syllabus'))
    : null;
  const dialog = modal({ id: 'pair-details', labelledBy: 'pair-details-title', className: 'dialog--pair pair-details', onClose },
    el('header', { class: 'pair-details__head', 'data-tone': avatarTone(pair.subjectName) },
      pair.groupName ? el('p', { class: 'dialog__kicker' }, pair.groupName) : null,
      el('h2', { class: 'dialog__title', id: 'pair-details-title' }, pair.subjectName),
      flags.length > 0 ? el('p', { class: 'badges' }, flags.map((flag) => flagBadge(flag, pair))) : null),
    el('dl', { class: 'pair-facts' }, facts.map(([key, value]) => el('div', { class: 'pair-facts__row' },
      el('dt', {}, t('pairs.details.' + key)),
      el('dd', {}, value)))),
    el('div', { class: 'dialog__actions' },
      syllabus,
      el('button', { type: 'button', id: 'pair-details-close', class: 'button button--secondary', onclick: () => dialog.close() }, t('common.close'))));
  return dialog;
}

// The lesson in full: «№. name», its type with «1 из 2», and the modules marked on it (a module without a name is
// «Модуль (рубежный контроль)»).
function lessonFacts(topic) {
  if (!topic) return el('span', { class: 'muted' }, t('pairs.details.noTopic'));
  const controls = controlLine(topic.controls);
  return [
    el('span', { class: 'pair-facts__topic' }, lessonText(topic)),
    typeBadge(topic),
    controls.badge ? badge(t('pairs.details.control'), 'warning') : null,
    controls.names.map((name) => badge(t(name.key, name.params), 'warning')),
  ];
}

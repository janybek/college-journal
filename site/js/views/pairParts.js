import { t } from '../i18n.js';
import { el, badge, iconButton, avatarTone } from '../ui.js';
import { icon } from '../icons.js';
import { addDays, dayParts, isTime } from '../dates.js';
import { pairFlags, topicText, lessonTypeKey, lessonParts } from '../pairs.js';

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

// «‹ неделя ›» and «Эта неделя». onChange(from): the Monday to show, or null for the week of «today» (the
// server knows which week that is; the device clock is not used).
export function weekNav({ from, onChange }) {
  return el('div', { class: 'week-nav', role: 'group', 'aria-label': t('pairs.weekNav') },
    iconButton({ id: 'week-prev', iconName: 'chevron', label: t('pairs.prevWeek'), className: 'icon-button--outline chevron-back', onClick: () => onChange(addDays(from, -7)) }),
    el('p', { class: 'week-nav__label', 'aria-live': 'polite' }, weekRange(from)),
    iconButton({ id: 'week-next', iconName: 'chevron', label: t('pairs.nextWeek'), className: 'icon-button--outline', onClick: () => onChange(addDays(from, 7)) }),
    el('button', { type: 'button', id: 'week-this', class: 'button button--secondary week-nav__this', onclick: () => onChange(null) }, t('pairs.thisWeek')));
}

// The lesson on a pair (`topic` of a pair view), as pieces to put in a line: its text, its type («Практика 1 из 2»
// when the row has more than one pair of this type) and, when modules without hours are marked on it, «Модуль»
// with their names (two can stand after one lesson).
export function lessonPieces(topic) {
  const { key, params } = topicText(topic);
  const type = t(lessonTypeKey(topic));
  const parts = lessonParts(topic);
  const controls = Array.isArray(topic.controls) ? topic.controls : [];
  return [
    el('span', { class: 'lesson-text' }, t(key, params)),
    LESSON_TYPES.includes(topic.lessonType)
      ? badge(parts ? t('pairs.lessonPart', { type, part: parts.part, parts: parts.parts }) : type, TYPE_TONES[topic.lessonType]) : null,
    controls.length > 0 ? el('span', { class: 'lesson-controls' },
      badge(t('pairs.unitControl'), 'warning'),
      el('span', { class: 'lesson-controls__names' }, controls.map((mark) => mark.name || t('syllabus.controlN', { n: mark.unit })).join(' · '))) : null,
  ];
}

// One pair. show: which of ['group', 'teacher'] to name; onOpen(pair): the card becomes a button.
// A cancelled pair has lost its topic, so it shows no topic line.
export function pairCard(pair, { show = [], onOpen = null } = {}) {
  const flags = pairFlags(pair);
  const cancelled = flags.includes('cancelled');
  const who = [
    show.includes('group') && pair.groupName ? el('span', { class: 'pair__who' }, icon('layers'), pair.groupName) : null,
    show.includes('teacher') && pair.teacherName
      ? el('span', { class: 'pair__who' + (pair.substitution ? ' is-substitute' : '') }, icon('briefcase'), pair.teacherName) : null,
    pair.roomName ? el('span', { class: 'pair__who' }, icon('door'), pair.roomName) : null,
  ];
  const parts = [
    el('span', { class: 'pair__head' },
      el('span', { class: 'pair__time' }, pairTime(pair)),
      el('span', { class: 'pair__slot' }, t('settings.pairN', { n: pair.slot }))),
    el('span', { class: 'pair__subject' }, pair.subjectName),
    who.some(Boolean) ? el('span', { class: 'pair__meta' }, who) : null,
    cancelled ? null : topicLine(pair.topic),
    flags.length > 0 ? el('span', { class: 'pair__flags' }, flags.map((flag) => flagBadge(flag, pair))) : null,
    pair.note ? el('span', { class: 'pair__note' }, pair.note) : null,
  ];
  const attrs = { id: pairCardId(pair), class: 'pair' + (cancelled ? ' is-cancelled' : ''), 'data-tone': avatarTone(pair.subjectName) };
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

// Days in a row, each with its pairs; «today» is marked, an empty day says so.
// cardOptions: { show, onOpen, canOpen(pair), dayHref(date) }: only the pairs canOpen accepts (all, without it)
// become buttons; a day for which dayHref(date) gives an address has its name as a link there.
export function dayList(days, today, { show = [], onOpen = null, canOpen = null, dayHref = null } = {}) {
  return el('div', { class: 'days', 'data-count': days.length }, days.map(({ date, pairs }) => {
    const { day, weekday } = dayParts(date);
    const isToday = date === today;
    const titleId = 'day-' + date;
    const title = [
      el('span', { class: 'day__name' }, t('date.weekday.' + weekday)),
      el('span', { class: 'visually-hidden' }, ', '),
      el('span', { class: 'day__date' }, dayMonth(date)),
    ];
    const href = dayHref ? dayHref(date) : null;
    // The hint is the link's description, so the day keeps its own name as the title of its section.
    const hint = href ? t('schedule.toTemplate', { weekday: t('date.weekday.' + weekday) }) : null;
    return el('section', { class: 'day' + (isToday ? ' is-today' : '') + (pairs.length === 0 ? ' is-empty' : ''), 'aria-labelledby': titleId },
      el('header', { class: 'day__head' },
        el('span', { class: 'day__leaf', 'aria-hidden': 'true' },
          el('span', { class: 'day__weekday' }, t('date.weekdayShort.' + weekday)),
          el('span', { class: 'day__number' }, String(day))),
        el('h2', { class: 'day__title', id: titleId },
          href ? el('a', { class: 'day__link', href, title: hint, 'aria-describedby': titleId + '-hint' }, title) : title),
        href ? el('span', { class: 'visually-hidden', id: titleId + '-hint' }, hint) : null,
        isToday ? badge(t('pairs.today'), 'primary', true) : null),
      pairs.length === 0
        ? el('p', { class: 'day__none' }, t('pairs.none'))
        : el('ul', { class: 'day__pairs' }, pairs.map((pair) => el('li', {},
          pairCard(pair, { show, onOpen: onOpen && (!canOpen || canOpen(pair)) ? onOpen : null })))));
  }));
}

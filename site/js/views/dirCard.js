import { call } from '../api.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, note, pageHeader, refresh } from '../ui.js';
import { permissions } from '../shell.js';
import { dayParts } from '../dates.js';
import { cellPairs, examDayLabel, gridDays, pairFlags } from '../pairs.js';
import { cardHref, FIRST_STUDENTS, gridRows, groupNowLabel, roomNowLabel, syllabusBadges, termNote } from '../dirInfo.js';
import { dayMonth, flagBadge, weekNav } from './pairParts.js';

// The card of a group, a room or a discipline (#/dir/<table>/<id>, dir.card): what the journal knows about it, read-only.
// The edit button is built only for whoever has dir.save of the table (the vice-rector has not). Everything that comes
// from the server goes on the page as text.

const blank = () => ({
  table: null,
  id: null,
  data: null,          // the answer of dir.card; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
  from: null,          // a room: the Monday of the week shown; null: the week of today
});
let state = blank();

const can = (permission) => permissions().includes(permission);

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.table !== params.table || state.id !== params.id) {
    state = Object.assign(blank(), { table: params.table, id: params.id });
  }
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const { table } = state;
  root.append(crumbs(state.data ? nameOf(state.data) : null));
  if (state.data === null) {
    root.append(state.errorCode === null ? el('p', { class: 'loading' }, t('common.loading')) : failure());
    return;
  }
  // A failed change of the week keeps the old week on the screen and says so above it.
  root.append(...[
    pageHeader({ id: 'card-title', title: t(`dir.card.${table}.title`, { name: nameOf(state.data) }), lead: lead(), actions: actions() }),
    state.errorCode === null ? null : note('error', t(errorKey(state.errorCode)), { role: 'alert' }),
    ...BODIES[table](state.data),
  ].filter(Boolean));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  const request = { table: owner.table, id: owner.id };
  if (owner.table === 'rooms' && owner.from !== null) request.from = owner.from;
  try {
    const data = await call('dir.card', request);
    if (state !== owner || owner.ticket !== ticket) return;
    owner.data = data;
    owner.errorCode = null;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorCode = error.code ?? 'unknown';
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

const nameOf = (data) => (data.group ?? data.room ?? data.discipline).name;

function retry() {
  state.errorCode = null;
  state.data = null;
  refresh();
}

function failure() {
  const missing = state.errorCode === 'not_found';
  const body = emptyState('alert',
    el('p', {}, t(missing ? 'error.not_found' : errorKey(state.errorCode))),
    missing ? null : el('button', { type: 'button', class: 'button button--secondary', onclick: retry }, t('common.retry')),
    el('a', { class: 'button button--secondary', href: '#/dir/' + state.table }, t('dir.card.toList')));
  body.setAttribute('role', 'alert');
  return body;
}

// «Справочники › Группы › 02-1»
function crumbs(name) {
  const { table } = state;
  return el('nav', { class: 'card-crumbs', 'aria-label': t('dir.card.crumbs') },
    el('span', {}, t('dir.card.crumbs')),
    el('span', { class: 'card-crumbs__sep', 'aria-hidden': 'true' }, '›'),
    can('dir.list:' + table) ? el('a', { href: '#/dir/' + table }, t('dir.' + table)) : el('span', {}, t('dir.' + table)),
    name === null ? null : el('span', { class: 'card-crumbs__sep', 'aria-hidden': 'true' }, '›'),
    name === null ? null : el('span', { class: 'card-crumbs__here', 'aria-current': 'page' }, name));
}

function link(id, href, text) {
  return el('a', { id, class: 'button button--secondary', href }, text);
}

function actions() {
  const { table, id } = state;
  const buttons = [];
  if (table === 'groups') {
    if (can('schedule.list')) buttons.push(link('card-schedule', '#/schedule/group/' + encodeURIComponent(id), t('dir.card.schedule')));
    if (can('journal.list')) buttons.push(link('card-journal', '#/journal/group/' + encodeURIComponent(id), t('dir.card.journal')));
  }
  if (table === 'disciplines' && can('subjects.overview')) buttons.push(link('card-subjects', '#/subjects', t('dir.card.subjectsLink')));
  // Not hidden by a style: whoever may not change the record gets no button at all.
  if (can('dir.save:' + table)) {
    buttons.push(el('button', {
      type: 'button', id: 'card-edit', class: 'button button--primary',
      onclick: () => location.replace(cardHref(table, id) + '/edit'),
    }, t('common.edit')));
  }
  return buttons.length > 0 ? buttons : null;
}

function lead() {
  const { data, table } = state;
  if (table === 'groups') return t('dir.card.course', { course: data.group.course });
  if (table === 'rooms') {
    const now = roomNowLabel(data.now);
    return t('dir.card.roomLead', { pairs: `${data.weekPairs} ${tCount('dir.card.weekPairs', data.weekPairs)}`, now: t(now.key, now.params) });
  }
  return null;
}

const termLine = (data) => {
  const term = termNote(data);
  return term ? note('info', t(term.key, term.params)) : null;
};

function tile(count, label, small = null) {
  return el('div', { class: 'card dir-stat' },
    el('strong', { class: 'dir-stat__value' }, String(count)),
    el('span', { class: 'dir-stat__label' }, label),
    small ? el('span', { class: 'dir-stat__small muted' }, small) : null);
}

function syllabusCell(syllabus) {
  return el('span', { class: 'dir-syllabi' }, syllabusBadges(syllabus).map((item) => badge(t(item.key), item.tone)));
}

function section(title, ...children) {
  return el('section', { class: 'card dir-block' }, el('h2', { class: 'dir-block__title' }, title), ...children);
}

function head(...keys) {
  return el('thead', {}, el('tr', {}, keys.map((key) => el('th', { scope: 'col', class: key === 'weekPairs' ? 'num' : null }, t('dir.card.col.' + key)))));
}

// ---- A group ----

function groupBody(data) {
  const { counts } = data;
  const now = groupNowLabel(data.now);
  const shown = data.students.slice(0, FIRST_STUDENTS);
  return [
    el('div', { class: 'dir-now' }, badge(t(now.key, now.params), now.tone, true), termLine(data)),
    el('div', { class: 'dir-stats' },
      tile(counts.students, tCount('dir.card.students', counts.students), counts.inactive > 0 ? tCount('dir.card.inactive', counts.inactive) : null),
      tile(counts.subjects, tCount('dir.card.subjects', counts.subjects)),
      tile(counts.weekPairs, tCount('dir.card.weekPairs', counts.weekPairs)),
      tile(counts.repeats, tCount('dir.card.repeats', counts.repeats))),
    el('div', { class: 'dir-columns' },
      section(t('dir.card.subjectsTitle'),
        data.subjects.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.none'))
          : el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, head('discipline', 'teacher', 'syllabus', 'weekPairs'),
            el('tbody', {}, data.subjects.map((row) => el('tr', {},
              el('td', {}, el('span', { class: 'table__label' }, row.disciplineName)),
              el('td', {}, row.teacherName),
              el('td', {}, syllabusCell(row.syllabus)),
              el('td', { class: 'num' }, String(row.weekPairs)))))))),
      section(t('dir.card.studentsTitle'),
        shown.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.card.noStudents'))
          : el('ul', { class: 'dir-students' }, shown.map((student) => el('li', {},
            el('span', { class: 'dir-students__name' }, student.fullName),
            el('span', { class: 'dir-students__no muted' }, student.cardNo)))),
        shown.length > 0 && can('dir.list:students')
          ? el('a', { class: 'dir-students__all', id: 'card-all-students', href: '#/dir/students/group/' + encodeURIComponent(state.id) }, tCount('dir.card.allStudents', counts.students))
          : null)),
  ];
}

// ---- A room ----

function changeWeek(from) {
  state.from = from;
  state.errorCode = null;
  load();
}

function roomBody(data) {
  const dates = gridDays(data.pairs, data.from);
  const rows = gridRows(data.bells, data.pairs);
  const exam = data.exam?.start ? data.exam : null;
  const dayHead = (date) => {
    const examKey = examDayLabel(date, exam);
    return el('th', { scope: 'col', class: 'room-grid__day' + (date === data.today ? ' is-today' : '') },
      el('span', { class: 'room-grid__name' }, t('date.weekday.' + dayParts(date).weekday)),
      el('span', { class: 'room-grid__date muted' }, dayMonth(date)),
      date === data.today ? badge(t('pairs.today'), 'primary', true) : null,
      examKey ? badge(t(examKey), 'warning') : null,
      data.holidays.includes(date) ? badge(t('dir.card.holiday'), 'neutral') : null);
  };
  return [
    termLine(data),
    section(t('dir.card.week'),
      weekNav({ from: data.from, onChange: changeWeek }),
      el('div', { class: 'table-scroll room-week' },
        el('table', { class: 'room-grid', 'data-days': dates.length },
          el('thead', {}, el('tr', {}, el('th', { class: 'room-grid__corner' }), dates.map(dayHead))),
          el('tbody', {}, rows.map((row) => el('tr', {},
            el('th', { scope: 'row', class: 'room-grid__slot' },
              el('span', { class: 'room-grid__pair' }, t('settings.pairN', { n: row.slot })),
              el('span', { class: 'room-grid__time muted' }, row.time)),
            dates.map((date) => roomCell(cellPairs(data.pairs, date, row.slot), date === data.today)))))))),
  ];
}

function roomCell(here, today) {
  const live = here.filter((pair) => pair.status !== 'cancelled');
  const cancelled = here.filter((pair) => pair.status === 'cancelled');
  const cls = 'room-grid__cell' + (today ? ' is-today' : '');
  if (live.length === 0) {
    return el('td', { class: cls }, el('div', { class: 'room-free' }, el('span', { class: 'muted' }, t('dir.card.free')),
      cancelled.map((pair) => el('span', { class: 'room-free__cancelled muted' }, t('dir.card.cancelledPair', { group: pair.groupName, subject: pair.subjectName })))));
  }
  return el('td', { class: cls }, live.map((pair) => el('div', { class: 'room-pair' },
    el('strong', { class: 'room-pair__group' }, pair.groupName),
    el('span', { class: 'room-pair__what' }, `${pair.subjectName} · ${pair.teacherName}`),
    pairFlags(pair).length > 0 ? el('span', { class: 'room-pair__marks' }, pairFlags(pair).map((flag) => flagBadge(flag, pair))) : null)));
}

// ---- A discipline ----

function disciplineBody(data) {
  return [
    section(t('dir.card.where'),
      data.rows.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.card.nowhere'))
        : el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, head('group', 'teacher', 'syllabus', 'weekPairs'),
          el('tbody', {}, data.rows.map((row) => el('tr', {},
            el('td', {}, el('span', { class: 'group-chip' }, row.groupName)),
            el('td', {}, row.teacherName),
            el('td', {}, syllabusCell(row.syllabus),
              can('syllabus.get') ? el('a', { class: 'dir-syllabus-link', href: '#/syllabus/' + encodeURIComponent(row.subjectId) }, t('dir.card.syllabusLink')) : null),
            el('td', { class: 'num' }, String(row.weekPairs)))))))),
  ];
}

const BODIES = { groups: groupBody, rooms: roomBody, disciplines: disciplineBody };

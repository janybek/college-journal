import { call } from '../api.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, note, pageHeader, refresh } from '../ui.js';
import { permissions } from '../shell.js';
import { pairFlags } from '../pairs.js';
import {
  attendanceTone, cardHref, countBadges, FIRST_STUDENTS, fullDate, groupNowLabel, markEditFromCard, percentText, roomNowLabel,
  syllabusBadges, syllabusHalves, termNote,
} from '../dirInfo.js';
import { cardHref as documentHref, shortFio } from '../documents.js';
import { openChooseDialog } from './docChoose.js';
import { flagBadge, weekNav } from './pairParts.js';
import { weekGrid } from './weekGrid.js';

// The card of a group, a room or a discipline (#/dir/<table>/<id>, dir.card): what the journal knows about it, read-only.
// The edit button is built only for whoever has dir.save of the table (the vice-rector has not). Everything that comes
// from the server goes on the page as text.

const blank = () => ({
  table: null,
  id: null,
  data: null,          // the answer of dir.card; null until it comes
  progress: null,      // the answer of dir.progress (groups, disciplines); null: none, see progressFailed
  progressFailed: false,
  loading: false,
  errorCode: null,
  ticket: 0,
  from: null,          // a room: the Monday of the week shown; null: the week of today
});
let state = blank();

export const can = (permission) => permissions().includes(permission);

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.table !== params.table || state.id !== params.id) {
    state = Object.assign(blank(), { table: params.table, id: params.id });
  }
  if (state.data === null && !state.loading && state.errorCode === null) load();
  const { table } = state;
  if (state.data === null) {
    root.append(state.errorCode === null ? el('p', { class: 'loading' }, t('common.loading')) : failure());
    return;
  }
  // A failed change of the week keeps the old week on the screen and says so above it.
  root.append(...[
    pageHeader({ id: 'card-title', title: t(`dir.card.${table}.title`, { name: nameOf(state.data) }), lead: lead(), actions: actions() }),
    state.errorCode === null ? null : note('error', t(errorKey(state.errorCode)), { role: 'alert' }),
    state.progressFailed ? note('info', t('dir.progress.unavailable')) : null,
    ...BODIES[table](state.data),
  ].filter(Boolean));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  const request = { table: owner.table, id: owner.id };
  if (owner.table === 'rooms' && owner.from !== null) request.from = owner.from;
  // The progress is an extra: if it fails, the card of the first part is still shown.
  const wantsProgress = owner.table !== 'rooms' && can('dir.progress:' + owner.table);
  const progress = wantsProgress && owner.progress === null
    ? call('dir.progress', { table: owner.table, id: owner.id }).catch(() => false) : Promise.resolve(owner.progress);
  try {
    const [data, figures] = await Promise.all([call('dir.card', request), progress]);
    if (state !== owner || owner.ticket !== ticket) return;
    owner.data = data;
    owner.progress = figures || null;
    owner.progressFailed = figures === false;
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
      onclick: () => {
        // A new step of the history: «Back» of the browser from the window returns to this card.
        markEditFromCard(cardHref(table, id));
        location.hash = cardHref(table, id) + '/edit';
      },
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

export function tile(count, label, small = null, tone = null) {
  return el('div', { class: 'card dir-stat' },
    el('strong', { class: tone ? 'dir-stat__value dir-pct--' + tone : 'dir-stat__value' }, String(count)),
    el('span', { class: 'dir-stat__label' }, label),
    small ? el('span', { class: 'dir-stat__small muted' }, small) : null);
}

export function syllabusCell(syllabus) {
  return el('span', { class: 'dir-syllabi' }, syllabusBadges(syllabus).map((item) => badge(t(item.key), item.tone)));
}

export function section(title, ...children) {
  return el('section', { class: 'card dir-block' }, el('h2', { class: 'dir-block__title' }, title), ...children);
}

const NUMERIC = ['weekPairs', 'attendance', 'average', 'students'];
function head(...keys) {
  return el('thead', {}, el('tr', {}, keys.map((key) => el('th', { scope: 'col', class: NUMERIC.includes(key) ? 'num' : null }, t('dir.card.col.' + key)))));
}

// Figures of the progress: a percent with its tone, an average, the labels of the states.
export const pct = (percent) => {
  const tone = attendanceTone(percent);
  return el('span', { class: tone ? 'dir-pct dir-pct--' + tone : 'dir-pct' }, percentText(percent));
};
export const average = (value) => (value === null || value === undefined ? el('span', { class: 'muted' }, '—') : el('strong', {}, String(value)));
const countsCell = (counts) => {
  const badges = countBadges(counts);
  return badges.length === 0 ? el('span', { class: 'muted' }, '—')
    : el('span', { class: 'dir-syllabi dir-counts' }, badges.map((item) => badge(t(item.key, { count: item.count }), item.tone)));
};
const byId = (items) => new Map((items ?? []).map((item) => [item.subjectId ?? item.id, item]));
const personLink = (table, id, name) => (can('dir.person:' + table)
  ? el('a', { class: 'dir-link', href: '#/dir/' + table + '/' + encodeURIComponent(id) }, name) : name);
const riskTone = (risk) => (risk > 0 ? 'warning' : null);

// ---- A group ----

function groupBody(data) {
  const { counts } = data;
  const progress = state.progress;
  const now = groupNowLabel(data.now);
  const shown = data.students.slice(0, FIRST_STUDENTS);
  const bySubject = byId(progress?.subjects);
  const byStudent = byId(progress?.students);
  const tiles = [
    tile(counts.students, tCount('dir.card.students', counts.students), counts.inactive > 0 ? tCount('dir.card.inactive', counts.inactive) : null),
    tile(counts.subjects, tCount('dir.card.subjects', counts.subjects)),
    tile(counts.weekPairs, tCount('dir.card.weekPairs', counts.weekPairs)),
    tile(counts.repeats, tCount('dir.card.repeats', counts.repeats)),
  ];
  if (progress) {
    tiles.push(
      tile(percentText(progress.totals.attendance), t('dir.card.attendance'), null, attendanceTone(progress.totals.attendance)),
      tile(progress.totals.average ?? '—', t('dir.card.average')),
      tile(progress.totals.risk, tCount('dir.card.riskStudents', progress.totals.risk), null, riskTone(progress.totals.risk)));
  }
  const subjectKeys = progress ? ['discipline', 'teacher', 'syllabus', 'weekPairs', 'attendance', 'average', 'counts']
    : ['discipline', 'teacher', 'syllabus', 'weekPairs'];
  return [
    el('div', { class: 'dir-now' }, badge(t(now.key, now.params), now.tone, true), termLine(data)),
    el('div', { class: progress ? 'dir-stats dir-stats--7' : 'dir-stats' }, tiles),
    el('div', { class: progress ? 'dir-columns dir-columns--wide' : 'dir-columns' },
      section(t('dir.card.subjectsTitle'),
        data.subjects.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.none'))
          : el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, head(...subjectKeys),
            el('tbody', {}, data.subjects.map((row) => {
              const figures = bySubject.get(row.subjectId);
              return el('tr', {},
                el('td', {}, el('span', { class: 'table__label' }, row.disciplineName)),
                el('td', {}, personLink('staff', row.teacherId, row.teacherName)),
                el('td', {}, syllabusCell(row.syllabus)),
                el('td', { class: 'num' }, String(row.weekPairs)),
                progress ? [
                  el('td', { class: 'num' }, pct(figures?.attendance ?? null)),
                  el('td', { class: 'num' }, average(figures?.average)),
                  el('td', {}, figures ? countsCell(figures.counts) : el('span', { class: 'muted' }, '—')),
                ] : null);
            }))))),
      section(t('dir.card.studentsTitle'),
        shown.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.card.noStudents'))
          : el('ul', { class: 'dir-students' }, shown.map((student) => {
            const figures = byStudent.get(student.id);
            return el('li', {},
              el('span', { class: 'dir-students__name' }, personLink('students', student.id, student.fullName)),
              progress ? el('span', { class: 'dir-students__figures' },
                pct(figures?.attendance ?? null), el('span', { class: 'dir-students__avg' }, average(figures?.average)))
                : el('span', { class: 'dir-students__no muted' }, student.cardNo));
          })),
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
  return [
    termLine(data),
    section(t('dir.card.week'),
      weekNav({ from: data.from, onChange: changeWeek }),
      weekGrid({ data, cell: roomCell })),
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

// The short «Силлабус» of the discipline: its halves of the year with the marks, who writes it and by when. The full
// card is in «Документы». «Выберите силлабус» only for whoever may choose; the vice-rector gets the link and no buttons.
function syllabusSection(data) {
  const { syllabus } = data;
  const halves = syllabusHalves(syllabus);
  const choose = syllabus.waiting && can('syllabus.choose')
    ? el('button', {
      type: 'button', class: 'button button--primary', id: 'card-choose',
      onclick: () => openChooseDialog(data.discipline.id, { onChosen: reloadCard, returnTo: 'card-choose' }),
    }, t('docs.choose'))
    : null;
  const open = can('docs.discipline')
    ? el('a', { class: 'dir-syllabus-link', id: 'card-documents', href: documentHref(data.discipline.id) }, t('dir.card.syllabus.open'))
    : null;
  const who = [syllabus.responsibleName ? t('docs.responsible') + ': ' + shortFio(syllabus.responsibleName) : '', syllabus.dueDate ? t('docs.until', { date: fullDate(syllabus.dueDate) }) : ''].filter(Boolean).join(' · ');
  return section(t('dir.card.syllabus.title'),
    el('div', { class: 'dir-syllabus' },
      syllabus.waiting ? el('div', { class: 'doc-waiting' }, badge(t('docs.waiting'), 'warning'), choose)
        : el('ul', { class: 'doc-halves' }, halves.map((half) => el('li', { class: 'doc-half' },
          el('span', { class: 'doc-half__name' }, t('docs.half.' + half.semester)),
          el('span', { class: 'dir-syllabi' }, half.badges.map((item) => badge(t(item.key), item.tone)))))),
      who ? el('p', { class: 'dir-syllabus__who muted' }, who) : null,
      open));
}

function reloadCard() {
  state.data = null;
  state.progress = null;
  state.progressFailed = false;
  refresh();
}

// «Ю1 закрыт · Ю2 идёт»: the units of a group in a discipline.
const unitsCell = (units) => (units.length === 0 ? el('span', { class: 'muted' }, '—')
  : el('span', { class: 'dir-syllabi' }, units.map((item) => badge(
    t('dir.card.unitShort', { n: item.unit }) + ' ' + t(item.closed ? 'dir.card.unitClosed' : 'dir.card.unitOpen'), item.closed ? 'success' : 'neutral'))));

function disciplineBody(data) {
  const progress = state.progress;
  const bySubject = byId(progress?.rows);
  const columns = progress ? ['group', 'teacher', 'syllabus', 'weekPairs', 'students', 'attendance', 'average', 'counts', 'units']
    : ['group', 'teacher', 'syllabus', 'weekPairs'];
  const tiles = progress ? [
    tile(progress.totals.groups, tCount('dir.card.groupsCount', progress.totals.groups)),
    tile(percentText(progress.totals.attendance), t('dir.card.attendance'), null, attendanceTone(progress.totals.attendance)),
    tile(progress.totals.average ?? '—', t('dir.card.average')),
    tile(progress.totals.risk, tCount('dir.card.riskStudents', progress.totals.risk), null, riskTone(progress.totals.risk)),
  ] : [];
  return [
    tiles.length > 0 ? el('div', { class: 'dir-stats' }, tiles) : null,
    syllabusSection(data),
    section(t('dir.card.where'),
      data.rows.length === 0 ? el('p', { class: 'dir-block__empty muted' }, t('dir.card.nowhere'))
        : el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, head(...columns),
          el('tbody', {}, data.rows.map((row) => {
            const figures = bySubject.get(row.subjectId);
            return el('tr', {},
              el('td', {}, el('span', { class: 'group-chip' }, row.groupName)),
              el('td', {}, personLink('staff', row.teacherId, row.teacherName)),
              el('td', {}, syllabusCell(row.syllabus),
                can('syllabus.get') ? el('a', { class: 'dir-syllabus-link', href: '#/syllabus/' + encodeURIComponent(row.subjectId) }, t('dir.card.syllabusLink')) : null),
              el('td', { class: 'num' }, String(row.weekPairs)),
              progress ? [
                el('td', { class: 'num' }, figures ? String(figures.students) : '—'),
                el('td', { class: 'num' }, pct(figures?.attendance ?? null)),
                el('td', { class: 'num' }, average(figures?.average)),
                el('td', {}, figures ? countsCell(figures.counts) : el('span', { class: 'muted' }, '—')),
                el('td', {}, unitsCell(figures?.units ?? [])),
              ] : null);
          }))))),
    progress && progress.units.length > 0 ? section(t('dir.card.unitsTitle'),
      el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, head('unit', 'closedGroups', 'average'),
        el('tbody', {}, progress.units.map((item) => el('tr', {},
          el('td', {}, el('span', { class: 'table__label' }, t('dir.card.unitN', { n: item.unit }))),
          el('td', {}, t('dir.card.closedOf', { closed: item.closedGroups, groups: item.groups })),
          el('td', { class: 'num' }, average(item.average)))))))) : null,
  ].filter(Boolean);
}

const BODIES = { groups: groupBody, rooms: roomBody, disciplines: disciplineBody };

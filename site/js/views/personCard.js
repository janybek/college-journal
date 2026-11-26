import { call } from '../api.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, note, pageHeader, refresh } from '../ui.js';
import { attendanceTone, cardHref, fullDate, markEditFromCard, percentText, stateLabel } from '../dirInfo.js';
import { pairFlags } from '../pairs.js';
import { flagBadge, weekNav } from './pairParts.js';
import { weekGrid } from './weekGrid.js';
import { average, can, section, syllabusCell, tile } from './dirCard.js';

// The card of a student or of a staff member (#/dir/<students|staff>/<id>, dir.person): progress and works of a student,
// the load, the unfilled and the week of a teacher. Read-only; the edit button only for whoever has dir.save of the table
// (not the deanery for staff, not the vice-rector). Everything that comes from the server goes on the page as text.

const blank = () => ({
  table: null,
  id: null,
  data: null,          // the answer of dir.person; null until it comes
  loading: false,
  errorCode: null,
  ticket: 0,
  from: null,          // a teacher: the Monday of the week shown; null: the week of today
});
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params) {
  if (state.table !== params.table || state.id !== params.id) {
    state = Object.assign(blank(), { table: params.table, id: params.id });
  }
  if (state.data === null && !state.loading && state.errorCode === null) load();
  if (state.data === null) {
    root.append(state.errorCode === null ? el('p', { class: 'loading' }, t('common.loading')) : failure());
    return;
  }
  const { data } = state;
  // A failed change of the week keeps the old week on the screen and says so above it.
  root.append(...[
    pageHeader({ id: 'card-title', title: titleOf(data), lead: lead(data), actions: actions(data) }),
    state.errorCode === null ? null : note('error', t(errorKey(state.errorCode)), { role: 'alert' }),
    ...(data.student ? studentBody(data) : staffBody(data)),
  ].filter(Boolean));
}

async function load() {
  const owner = state;
  const ticket = ++owner.ticket;
  owner.loading = true;
  const request = { table: owner.table, id: owner.id };
  if (owner.table === 'staff' && owner.from !== null) request.from = owner.from;
  try {
    const data = await call('dir.person', request);
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

const dash = () => el('span', { class: 'muted' }, '—');

// ---- The header ----

function titleOf(data) {
  if (data.student) {
    const { active } = data.student;
    return [data.student.fullName, el('span', { class: 'dir-tags' }, badge(t(active ? 'dir.person.active' : 'dir.person.inactive'), active ? 'success' : 'neutral', active))];
  }
  return [data.person.fullName, el('span', { class: 'dir-tags' },
    data.person.roles.map((role) => badge(t('role.' + role), role === 'teacher' ? 'primary' : 'neutral')))];
}

// «Группа 01-1 · № билета S1001»: the name of the group is the link to its card.
function lead(data) {
  if (!data.student) return null;
  const mark = '\u0001';
  const [before, after] = t('dir.person.lead', { group: mark, cardNo: data.student.cardNo }).split(mark);
  const name = data.student.groupName;
  const group = can('dir.card:groups') && data.student.groupId
    ? el('a', { class: 'dir-link', href: cardHref('groups', data.student.groupId) }, name) : name;
  return [before, group, after ?? ''];
}

function actions(data) {
  const { table, id } = state;
  const buttons = [];
  if (data.student && can('journal.list') && data.student.groupId) {
    buttons.push(el('a', {
      id: 'card-journal', class: 'button button--secondary', href: '#/journal/group/' + encodeURIComponent(data.student.groupId),
    }, t('dir.card.journal')));
  }
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

function head(...columns) {
  return el('thead', {}, el('tr', {}, columns.map(([key, numeric]) => el('th', { scope: 'col', class: numeric ? 'num' : null }, t('dir.person.col.' + key)))));
}

const grid = (...children) => el('div', { class: 'table-scroll' }, el('table', { class: 'table' }, ...children));
const empty = (text) => el('p', { class: 'dir-block__empty muted' }, text);

// ---- A student ----

function studentBody(data) {
  const { totals } = data;
  return [
    el('div', { class: 'dir-stats' },
      tile(percentText(totals.attendance), t('dir.person.attendance'), null, attendanceTone(totals.attendance)),
      tile(totals.average ?? '—', t('dir.person.average')),
      tile(totals.risk, tCount('dir.person.risk', totals.risk), null, totals.risk > 0 ? 'warning' : null),
      tile(totals.repeats, tCount('dir.person.repeats', totals.repeats))),
    section(t('dir.person.subjects'), data.subjects.length === 0 ? empty(t('dir.person.noSubjects')) : subjectsTable(data.subjects)),
    data.debts.length > 0 ? section(t('dir.person.debts'), el('ul', { class: 'dir-debts' }, data.debts.map(debtLine))) : null,
    el('div', { class: 'dir-columns' },
      section(t('dir.person.works'), data.works.length === 0 ? empty(t('dir.person.none')) : worksTable(data.works)),
      section(t('dir.person.repeatsTitle'), data.repeats.length === 0 ? empty(t('dir.person.none'))
        : el('ul', { class: 'dir-repeats' }, data.repeats.map(repeatItem)))),
  ];
}

function subjectsTable(subjects) {
  return grid(head(['discipline'], ['teacher'], ['attendance'], ['units'], ['average', true], ['state']),
    el('tbody', {}, subjects.map((row) => {
      const label = stateLabel(row.state, row.total);
      return el('tr', {},
        el('td', {}, el('span', { class: 'table__label' }, row.name)),
        el('td', {}, row.teacherName || dash()),
        el('td', {}, attendanceCell(row.attendance)),
        el('td', {}, row.units.length === 0 ? dash() : el('span', { class: 'dir-units' }, row.units.map((unit) => el('span', { class: 'dir-unit' },
          el('span', { class: 'muted' }, t('dir.card.unitShort', { n: unit.unit })), el('strong', {}, unit.total === null ? '—' : String(unit.total)))))),
        el('td', { class: 'num' }, average(row.average)),
        el('td', {}, badge(t(label.key, label.params), label.tone)));
    })));
}

function attendanceCell({ percent, absent }) {
  const tone = attendanceTone(percent);
  return el('span', { class: tone ? 'dir-pct dir-pct--' + tone : 'dir-pct' }, t('dir.person.attendanceCell', { percent: percentText(percent), absent }));
}

function worksTable(works) {
  return grid(head(['discipline'], ['checked', true], ['submitted', true], ['returned', true], ['missing', true]),
    el('tbody', {}, works.map((row) => el('tr', {},
      el('td', {}, el('span', { class: 'table__label' }, row.name)),
      el('td', { class: 'num' }, String(row.checked)),
      el('td', { class: 'num' }, String(row.submitted)),
      el('td', { class: 'num' }, String(row.returned)),
      el('td', { class: row.missing > 0 ? 'num dir-pct--danger' : 'num' }, String(row.missing))))));
}

function debtLine(debt) {
  return el('li', { class: 'dir-debt' },
    el('span', {}, t('dir.person.debt', { subject: debt.name, semester: debt.planSemester, state: t('dir.state.' + debt.state, { total: debt.total }) })),
    badge(t(debt.repeat === null ? 'dir.person.repeatNone' : 'dir.person.repeatSet'), debt.repeat === null ? 'danger' : 'info'));
}

const REPEAT_TONES = { open: 'info', passed: 'success', failed: 'danger', cancelled: 'neutral' };

function repeatItem(card) {
  const status = card.overdue ? 'overdue' : card.status;
  return el('li', { class: 'dir-repeat' },
    el('div', { class: 'dir-repeat__head' },
      el('strong', {}, card.subjectName),
      el('span', { class: 'muted' }, [t('dir.person.repeatSemester', { n: card.planSemester }),
        t('grades.repeat.order', { no: card.orderNo, date: fullDate(card.orderDate) })].join(' · ')),
      badge(t('repeat.kind.' + card.kind), 'primary')),
    el('div', { class: 'dir-repeat__line' },
      badge(t('repeat.state.' + status), card.overdue ? 'danger' : REPEAT_TONES[card.status] ?? 'neutral', true),
      card.kind === 'full' ? el('span', {}, card.works.value === null ? '—' : t('grades.repeat.works', { value: card.works.value, max: card.works.max })) : null,
      el('strong', {}, card.total === null ? '—' : String(card.total)),
      el('span', { class: 'muted' }, t('grades.repeat.deadline', { date: fullDate(card.deadline) }))));
}

// ---- A staff member ----

function changeWeek(from) {
  state.from = from;
  state.errorCode = null;
  load();
}

function staffBody(data) {
  const { teacher } = data;
  if (teacher === null) return [];
  return [
    el('div', { class: 'dir-stats' },
      tile(teacher.weekPairs, tCount('dir.person.weekPairs', teacher.weekPairs)),
      tile(teacher.hours, tCount('dir.person.hours', teacher.hours)),
      tile(teacher.subjects, tCount('dir.card.subjects', teacher.subjects)),
      tile(teacher.unfilled, tCount('dir.person.unfilled', teacher.unfilled), null, teacher.unfilled > 0 ? 'warning' : null)),
    el('div', { class: 'dir-columns' },
      section(t('dir.person.leads'), teacher.rows.length === 0 ? empty('—') : leadsTable(teacher.rows)),
      teacher.unfilled > 0 ? unfilledSection(teacher) : null),
    section(t('dir.card.week'),
      weekNav({ from: teacher.from, onChange: changeWeek }),
      weekGrid({ data: { ...teacher, today: data.today }, cell: teacherCell })),
  ];
}

function leadsTable(rows) {
  return grid(head(['discipline'], ['group'], ['weekPairs', true], ['syllabus']),
    el('tbody', {}, rows.map((row) => el('tr', {},
      el('td', {}, row.disciplineId && can('dir.card:disciplines')
        ? el('a', { class: 'dir-link table__label', href: cardHref('disciplines', row.disciplineId) }, row.name)
        : el('span', { class: 'table__label' }, row.name)),
      el('td', {}, el('span', { class: 'group-chip' }, row.groupName)),
      el('td', { class: 'num' }, String(row.weekPairs)),
      el('td', {}, syllabusCell(row.syllabus),
        row.responsible ? el('span', { class: 'dir-responsible muted' }, t('dir.person.responsible')) : null)))));
}

function unfilledSection(teacher) {
  const pairs = teacher.unfilledPairs;
  const units = teacher.unfilledUnits;
  return section(t('dir.person.unfilledTitle'),
    pairs.length > 0 ? el('div', { class: 'dir-gap' },
      el('h3', { class: 'dir-gap__title muted' }, t('dir.person.unfilledPairs')),
      el('ul', { class: 'dir-gaps' }, pairs.map((pair) => el('li', {},
        el('a', { class: 'dir-link', href: '#/journal/' + encodeURIComponent(pair.subjectId) },
          `${fullDate(pair.date).slice(0, 5)} · ${pair.groupName} · ${pair.subjectName}`),
        badge(t('dir.person.pairUnfilled'), 'danger'))))) : null,
    units.length > 0 ? el('div', { class: 'dir-gap' },
      el('h3', { class: 'dir-gap__title muted' }, t('dir.person.unfilledUnits')),
      el('ul', { class: 'dir-gaps' }, units.map((unit) => el('li', {},
        el('a', { class: 'dir-link', href: '#/ledger/' + encodeURIComponent(unit.subjectId) },
          `${unit.name} · ${unit.groupName} · ${t('dir.card.unitN', { n: unit.unit })}`),
        el('span', { class: 'dir-gap__marks' },
          unit.control > 0 ? badge(t('dir.person.noControl', { count: unit.control }), 'warning') : null,
          unit.self > 0 ? badge(t('dir.person.noSelf', { count: unit.self }), 'warning') : null))))) : null);
}

function teacherCell(here, today) {
  const live = here.filter((pair) => pair.status !== 'cancelled');
  const cancelled = here.filter((pair) => pair.status === 'cancelled');
  const cls = 'room-grid__cell' + (today ? ' is-today' : '');
  if (live.length === 0) {
    return el('td', { class: cls }, el('div', { class: 'room-free' }, el('span', { class: 'muted' }, t('dir.card.free')),
      cancelled.map((pair) => el('span', { class: 'room-free__cancelled muted' }, t('dir.card.cancelledPair', { group: pair.groupName, subject: pair.subjectName })))));
  }
  return el('td', { class: cls }, live.map((pair) => el('div', { class: 'room-pair' },
    el('strong', { class: 'room-pair__group' }, `${pair.groupName} · ${pair.subjectName}`),
    pair.roomName ? el('span', { class: 'room-pair__what' }, t('dir.person.room', { room: pair.roomName })) : null,
    pairFlags(pair).length > 0 ? el('span', { class: 'room-pair__marks' }, pairFlags(pair).map((flag) => flagBadge(flag, pair))) : null)));
}

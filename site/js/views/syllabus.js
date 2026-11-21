import { call } from '../api.js';
import { getUser } from '../session.js';
import { t, tCount } from '../i18n.js';
import { el, errorKey, badge, emptyState, note, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole, menuParts } from '../shell.js';
import { shortDate, unitGroups, describedRows, hasSelfHours, undated, scheduleNotes } from '../syllabus.js';
import { lessonTypeKey } from '../pairs.js';
import { uploadControls, renderUpload, leaveUpload, forgetUploadNote } from './syllabusUpload.js';

// The syllabus of a subject (#/syllabus/<subjectId>, #/syllabus/<subjectId>/<1|2>), the same page for the deanery,
// the teacher and the student; nothing is edited on the page itself. The staff download the file (the template
// while there is no syllabus), the deanery uploads it (syllabusUpload.js). The syllabus belongs to the discipline
// and the teacher, so a teacher of several groups switches between them and only the dates change. The plan goes
// in the order of the pairs: rows grouped by unit, the module (рубежный контроль) closing a unit stands out, the
// last row sums it up.
// On a narrow screen the same table reads as a list: a row is the topic, its hours and its dates under it.
// The server decides who may see what; `forbidden` and `not_found` are explained with a way back.

const LESSON_TYPES = ['lecture', 'practice', 'control'];
const FINAL_ERRORS = { forbidden: 'syllabus.forbidden', not_found: 'syllabus.notFound' };

const blank = () => ({
  key: null,           // 'subjectId|semester' of the address; the semester part is empty when the address has none
  shownKey: null,      // the key `view` was read for
  view: null,          // the answer of syllabus.get being drawn
  loadingKey: null,
  errorKey: null,
  errorCode: null,
  ticket: 0,
});
let state = blank();

const present = (value) => value !== null && value !== undefined && value !== '';

export function leave() {
  state = blank();
  leaveUpload();
}

export function render(root, params) {
  const { subjectId, semester = null } = params;
  const user = getUser();
  const key = subjectId + '|' + (semester ?? '');
  if (state.key !== key) {
    Object.assign(state, { key, errorKey: null, errorCode: null });
    forgetUploadNote();
  }
  if (state.shownKey !== key && state.loadingKey !== key && state.errorKey === null) load(state, subjectId, semester);

  root.append(backLink(user), body(user, key, semester));
  renderUpload(root);
}

function body(user, key, semester) {
  if (state.errorKey) return failure();
  if (!state.view) return el('p', { class: 'loading' }, t('common.loading'));
  // Another group or semester (or the syllabus just uploaded) is on its way: the page shown stays, dimmed, until it comes.
  const stale = state.shownKey !== key;
  return el('div', { class: 'syllabus' + (stale ? ' is-stale' : ''), 'aria-busy': stale ? 'true' : null },
    page(state.view, user, semester !== null));
}

// After an upload the page is read again; the old one stays on screen until the new one comes.
function reload() {
  state.shownKey = null;
}

async function load(owner, subjectId, semester) {
  const ticket = ++owner.ticket;
  const key = owner.key;
  owner.loadingKey = key;
  try {
    const view = await call('syllabus.get', semester === null ? { subjectId } : { subjectId, semester });
    if (state !== owner || owner.ticket !== ticket) return;
    Object.assign(owner, { view, shownKey: key, errorKey: null, errorCode: null });
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    // The view kept is no longer known to be current: going back to its address reads it again.
    Object.assign(owner, { errorKey: FINAL_ERRORS[error.code] ?? errorKey(error.code), errorCode: error.code, shownKey: null });
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loadingKey = null;
  }
  refresh();
}

// The deanery goes back to its «Предметы»; the teacher and the student to their home, where their subjects are.
function backLink(user) {
  const office = user.kind !== 'student' && menuParts(activeRole(user)).includes('office');
  return el('a', { class: 'back-link', href: office ? '#/subjects' : '#/' }, icon('chevron'), t(office ? 'syllabus.back.office' : 'common.toHome'));
}

function failure() {
  const final = Object.prototype.hasOwnProperty.call(FINAL_ERRORS, state.errorCode);
  const body = emptyState('alert',
    el('p', {}, t(state.errorKey)),
    final
      ? null
      : el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorKey = null; refresh(); } }, t('common.retry')));
  body.setAttribute('role', 'alert');
  return body;
}

// The page

function page(view, user, semesterAsked) {
  const { syllabus } = view;
  return [
    head(view),
    switches(view, semesterAsked),
    syllabus === null ? notUploaded(view, user) : [
      infoCard(view),
      notes(view),
      planCard(view),
      descriptions(syllabus.rows),
    ],
  ];
}

// The title, and for the staff the buttons of the file on its right.
function head(view) {
  const { subject } = view;
  return el('header', { class: 'syllabus-head' },
    el('div', { class: 'syllabus-head__text' },
      el('p', { class: 'syllabus-head__kicker' }, t('syllabus.title')),
      el('h1', { class: 'page-title', id: 'syllabus-title' }, subject.name),
      subject.groupName || subject.teacherName ? el('p', { class: 'syllabus-head__who' },
        subject.groupName ? badge(subject.groupName, 'primary') : null,
        subject.teacherName ? el('span', { class: 'syllabus-head__teacher' }, icon('briefcase'), subject.teacherName) : null) : null),
    uploadControls(view, reload));
}

// The group (when the teacher has the discipline in several) and the semester of the year (when both have a syllabus).
function switches(view, semesterAsked) {
  const groups = view.groups.length > 1 ? el('div', { class: 'syllabus-switch' },
    el('nav', { class: 'segmented syllabus-switch__links', 'aria-label': t('field.groupId'), 'aria-describedby': 'syllabus-groups-hint' },
      view.groups.map((group) => el('a', {
        id: 'syllabus-group-' + group.subjectId,
        class: 'segmented__button',
        href: '#/syllabus/' + group.subjectId + (semesterAsked ? '/' + view.semester : ''),
        'aria-current': group.subjectId === view.subject.id ? 'page' : null,
      }, group.groupName))),
    el('p', { class: 'syllabus-switch__hint', id: 'syllabus-groups-hint' }, t('syllabus.groups'))) : null;
  const semesters = view.semesters.length === 2 ? el('div', { class: 'syllabus-switch' },
    el('nav', { class: 'segmented syllabus-switch__links', 'aria-label': t('syllabus.semesterSwitch') },
      view.semesters.map(({ semester: n }) => el('a', {
        id: 'syllabus-semester-' + n,
        class: 'segmented__button semester-tab',
        href: '#/syllabus/' + view.subject.id + '/' + n,
        'aria-current': n === view.semester ? 'page' : null,
      },
      el('span', { class: 'semester-tab__name' }, t('syllabus.semesterN', { n })),
      n === view.currentSemester ? el('span', { class: 'semester-tab__now' }, t('syllabus.semesterNow')) : null)))) : null;
  return groups || semesters ? el('div', { class: 'syllabus-switches' }, groups, semesters) : null;
}

// Who should do something about a missing syllabus: the deanery uploads it, its teacher fills in the template.
function notUploaded(view, user) {
  let hint = null;
  if (user.kind === 'student') hint = 'syllabus.notUploadedHint.student';
  else if (view.canUpload) hint = 'syllabus.notUploadedHint.office';
  else if (view.subject.teacherId === user.id) hint = 'syllabus.notUploadedHint.teacher';
  return emptyState('book',
    el('p', { class: 'empty__title' }, t('syllabus.notUploaded')),
    hint ? el('p', {}, t(hint)) : null);
}

// «Сведения»: five lines of the title page; what the file left empty reads «—».
function infoCard(view) {
  const { subject, syllabus } = view;
  const dash = (value) => (present(value) ? value : '—');
  let course = '—';
  if (present(subject.course) && present(syllabus.planSemester)) {
    course = t('syllabus.info.courseValue', { course: subject.course, semester: syllabus.planSemester });
  } else if (present(syllabus.planSemester)) course = t('syllabus.semesterN', { n: syllabus.planSemester });
  const volume = [
    present(syllabus.credits) ? t('syllabus.info.credits', { n: syllabus.credits }) : null,
    present(syllabus.totalHours) ? t('syllabus.info.hours', { n: syllabus.totalHours }) : null,
  ].filter(Boolean).join(', ');
  const split = present(syllabus.classHours) || present(syllabus.selfHours)
    ? t('syllabus.info.splitValue', { classHours: dash(syllabus.classHours), selfHours: dash(syllabus.selfHours) }) : '—';
  const facts = [
    ['syllabus.info.course', course],
    ['syllabus.info.audience', dash(syllabus.audience)],
    ['syllabus.info.volume', volume || '—'],
    ['syllabus.info.split', split],
    ['syllabus.info.teacher', dash(subject.teacherName)],
  ];
  return el('section', { class: 'card syllabus-info', 'aria-labelledby': 'syllabus-info-title' },
    el('h2', { class: 'syllabus-card__title', id: 'syllabus-info-title' }, t('syllabus.info')),
    el('dl', { class: 'facts' }, facts.map(([label, value]) => el('div', { class: 'fact' },
      el('dt', { class: 'fact__label' }, t(label)),
      el('dd', { class: 'fact__value' + (value === '—' ? ' is-empty' : '') }, String(value))))));
}

// A param named in counts is a number of something and is written with its word («18 пар»).
function notes(view) {
  return el('div', { class: 'notes syllabus-notes' }, scheduleNotes(view).map(({ tone, key, params, counts = {} }) => note(tone, t(key, params && Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, counts[name] ? tCount(counts[name], value) : value]))))));
}

// «Тематический план»

const dated = (view) => view.syllabus.schedule !== null && view.syllabus.schedule.pairs > 0;

function planCard(view) {
  const { rows, totals } = view.syllabus;
  const self = hasSelfHours(rows);
  const groups = unitGroups(rows);
  const columns = [
    ['syllabus.col.topic', 'plan-table__topic'],
    ['syllabus.col.lecture', 'num'],
    ['syllabus.col.practice', 'num'],
    self ? ['syllabus.col.self', 'num'] : null,
    ['syllabus.col.pairs', 'plan-table__pairs'],
  ].filter(Boolean);
  // A unit has a head when the plan has several, or when it has a title: «Юнит 1. Техническое и программное обеспечение».
  const bodies = groups.map((group) => el('tbody', { class: 'plan-unit' },
    groups.length > 1 || group.title ? el('tr', { class: 'plan-unit__head' },
      el('th', { scope: 'rowgroup', colspan: String(columns.length), class: group.title ? 'has-title' : null },
        group.title ? t('syllabus.unitTitled', { n: group.unit, title: group.title }) : t('syllabus.unitN', { n: group.unit }))) : null,
    group.rows.map((row) => planRow(row, view, self))));
  return el('section', { class: 'card syllabus-plan', 'aria-labelledby': 'syllabus-plan-title' },
    el('h2', { class: 'syllabus-card__title', id: 'syllabus-plan-title' }, t('syllabus.plan')),
    el('div', { class: 'table-scroll' },
      el('table', { class: 'table plan-table', 'aria-labelledby': 'syllabus-plan-title' },
        el('thead', {}, el('tr', {}, columns.map(([key, className]) => el('th', { scope: 'col', class: className }, t(key))))),
        bodies,
        el('tfoot', {}, el('tr', { class: 'plan-total' },
          el('th', { scope: 'row', class: 'plan-table__topic' },
            el('span', { class: 'plan-row__name' }, t('syllabus.total')),
            hoursSummary(totals.lectureHours, totals.practiceHours + totals.controlHours, 'lessonType.practice', self ? totals.selfHours : 0)),
          el('td', { class: 'num' }, hours(totals.lectureHours)),
          el('td', { class: 'num' }, hours(totals.practiceHours + totals.controlHours)),
          self ? el('td', { class: 'num' }, hours(totals.selfHours)) : null,
          el('td', { class: 'plan-table__pairs' }, el('span', { class: 'plan-total__pairs' }, tCount('syllabus.pairsCount', totals.pairs))))))));
}

function planRow(row, view, self) {
  const control = row.kind === 'control';
  // «Семинар», «Лабораторная» or «Практика»: the practice of a row is named after its kind.
  const practiceType = control ? 'lessonType.control' : lessonTypeKey({ lessonType: 'practice', practiceKind: row.practiceKind });
  const name = control && !row.name ? t('syllabus.controlN', { n: row.unit }) : row.name;
  return el('tr', { class: 'plan-row' + (control ? ' is-control' : '') },
    el('td', { class: 'plan-table__topic' },
      el('span', { class: 'plan-row__title' },
        row.label ? el('span', { class: 'plan-row__label' }, row.label) : null,
        el('span', { class: 'plan-row__name' }, name)),
      hoursSummary(row.lectureHours, row.practiceHours, practiceType, self ? row.selfHours : 0)),
    el('td', { class: 'num' }, hours(row.lectureHours)),
    el('td', { class: 'num' },
      hours(row.practiceHours),
      !control && row.practiceHours > 0 && practiceType !== 'lessonType.practice'
        ? el('span', { class: 'plan-row__kind' }, t(practiceType)) : null),
    self ? el('td', { class: 'num' }, hours(row.selfHours)) : null,
    el('td', { class: 'plan-table__pairs' }, pairDates(row, view)));
}


// A number of hours in its column; none — a quiet dash.
function hours(n) {
  return typeof n === 'number' && n > 0 ? String(n) : el('span', { class: 'plan-none' }, '—');
}

// «Лекция 2 ч · Практика 2 ч · СРС 2 ч»: the hours of a row where the columns are not shown (a narrow screen).
// A line breaks only between the pieces, never inside «СРС 2 ч».
function hoursSummary(lecture, practice, practiceType, self) {
  const parts = [
    lecture > 0 ? t('syllabus.hoursOf', { type: t('lessonType.lecture'), n: lecture }) : null,
    practice > 0 ? t('syllabus.hoursOf', { type: t(practiceType), n: practice }) : null,
    typeof self === 'number' && self > 0 ? t('syllabus.hoursOf', { type: t('syllabus.self'), n: self }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return el('span', { class: 'plan-row__summary' },
    parts.map((part, i) => [i > 0 ? ' · ' : null, el('span', { class: 'plan-row__hours' }, part)]));
}

// The dates of the group's pairs on the row, each with the letter of its type; a held pair carries a tick. Where
// the semester has no dates yet, the number of pairs the row takes.
function pairDates(row, view) {
  const control = row.kind === 'control';
  const missing = undated(row, dated(view));
  if (row.pairs.length === 0 && missing === 0) {
    return row.planned > 0
      ? el('span', { class: 'plan-row__planned' }, tCount('syllabus.pairsCount', row.planned))
      : el('span', { class: 'plan-none' }, '—');
  }
  return el('ul', { class: 'dates' },
    row.pairs.map((pair) => {
      const type = control ? 'control' : pair.lessonType;
      const held = pair.status === 'closed';
      return el('li', { class: 'date' + (held ? ' is-held' : ''), 'data-type': LESSON_TYPES.includes(type) ? type : null },
        LESSON_TYPES.includes(type) ? el('abbr', { class: 'date__type', title: t('lessonType.' + type) }, t('lessonType.short.' + type)) : null,
        el('span', { class: 'date__day' }, shortDate(pair.date)),
        held ? [icon('checkCircle', 'date__held'), el('span', { class: 'visually-hidden' }, ', ' + t('syllabus.held'))] : null);
    }),
    missing > 0 ? el('li', { class: 'date is-missing' }, tCount('syllabus.undated', missing)) : null);
}

// «Описание тем»: only the topics that have one, in the order of the plan.
function descriptions(rows) {
  const described = describedRows(rows);
  if (described.length === 0) return null;
  return el('section', { class: 'card syllabus-about', 'aria-labelledby': 'syllabus-about-title' },
    el('h2', { class: 'syllabus-card__title', id: 'syllabus-about-title' }, t('syllabus.descriptions')),
    el('dl', { class: 'about' }, described.map((row) => el('div', { class: 'about__item' },
      el('dt', { class: 'about__topic' },
        row.label ? el('span', { class: 'plan-row__label' }, row.label) : null,
        el('span', {}, row.name)),
      el('dd', { class: 'about__text' }, row.description)))));
}

import { call } from '../api.js';
import { t } from '../i18n.js';
import { el, errorKey, badge, emptyState, pageHeader, refresh } from '../ui.js';
import { icon } from '../icons.js';
import { unitLine, absenceList, pointsText } from '../journal.js';
import { weekdayDate } from './pairParts.js';

// «Оценки» of a student (#/grades, #/grades/<subjectId>): the points and absences of the person who asks, from
// student.grades. The server answers with that person's own data only; the screen never asks for anyone else and never
// trusts the subject in the address: it looks it up in its own answer («Предмет не найден» when it is not there).
// A phone screen: one column, no side menu, body text 16 px, links and buttons at least 44 px tall.

const blank = () => ({ data: null, loading: false, errorKey: null, ticket: 0 });
let state = blank();

export function leave() {
  state = blank();
}

export function render(root, params = {}) {
  if (!state.data && !state.loading && !state.errorKey) load(state);
  const detail = params.subjectId !== undefined;
  root.append(el('a', { class: 'back-link', href: detail ? '#/grades' : '#/' }, icon('chevron'), t(detail ? 'grades.back' : 'common.toHome')));
  if (!state.data) {
    root.append(pageHeader({ id: 'gr-title', title: t('grades.title') }), failedOrLoading());
    return;
  }
  const { scheme, subjects } = state.data;
  if (!detail) root.append(listScreen(subjects, scheme));
  else {
    const subject = subjects.find((s) => s.subjectId === params.subjectId);
    root.append(subject ? detailScreen(subject, scheme) : notFound());
  }
}

async function load(owner) {
  const ticket = ++owner.ticket;
  owner.loading = true;
  try {
    const data = await call('student.grades', {});
    if (state !== owner || owner.ticket !== ticket) return;
    owner.data = data;
    owner.errorKey = null;
  } catch (error) {
    if (state !== owner || owner.ticket !== ticket) return;
    owner.errorKey = errorKey(error.code);
  } finally {
    if (state === owner && owner.ticket === ticket) owner.loading = false;
  }
  refresh();
}

function failedOrLoading() {
  if (!state.errorKey) return el('p', { class: 'loading' }, t('common.loading'));
  const failed = emptyState('alert',
    el('p', {}, t(state.errorKey)),
    el('button', { type: 'button', class: 'button button--secondary', onclick: () => { state.errorKey = null; refresh(); } }, t('common.retry')));
  failed.setAttribute('role', 'alert');
  return failed;
}

// ---- #/grades: a card for each subject ----

function listScreen(subjects, scheme) {
  const head = pageHeader({ id: 'gr-title', title: t('grades.title'), lead: t('home.gradesLead') });
  if (subjects.length === 0) return el('div', { class: 'gr' }, head, emptyState('chart', el('p', {}, t('grades.empty'))));
  return el('div', { class: 'gr' }, head,
    el('ul', { class: 'gr-list' }, subjects.map((subject) => el('li', {},
      el('a', { class: 'card gr-card', href: '#/grades/' + encodeURIComponent(subject.subjectId) },
        el('div', { class: 'gr-card__head' },
          el('div', { class: 'gr-card__titles' },
            el('h2', { class: 'gr-card__name' }, subject.name),
            subject.teacherName ? el('p', { class: 'gr-card__teacher' }, subject.teacherName) : null),
          icon('chevron', 'gr-card__go')),
        summary(subject, scheme))))),
    subjects.some((subject) => subject.units.some((unit) => unit.selfWork)) ? el('a', { class: 'button button--secondary gr-tasks', id: 'gr-tasks', href: '#/tasks' }, t('grades.myTasks')) : null,
    howBlock(scheme));
}

// ---- #/grades/<subjectId>: one subject in full ----

function detailScreen(subject, scheme) {
  const missed = absenceList(subject.pairs);
  return el('div', { class: 'gr' },
    pageHeader({ id: 'gr-title', title: subject.name, lead: subject.teacherName || null }),
    el('section', { class: 'card gr-card gr-card--static', 'aria-labelledby': 'gr-title' }, summary(subject, scheme)),
    el('section', { class: 'gr-section', 'aria-labelledby': 'gr-missed' },
      el('h2', { class: 'gr-section__title', id: 'gr-missed' }, t('grades.absences')),
      missed.length === 0 ? el('p', { class: 'muted gr-none' }, t('grades.noAbsences')) : el('ul', { class: 'gr-pairs' }, missed.map((pair) => pairRow(pair, false)))),
    el('section', { class: 'gr-section', 'aria-labelledby': 'gr-all' },
      el('h2', { class: 'gr-section__title', id: 'gr-all' }, t('grades.allPairs')),
      subject.pairs.length === 0 ? el('p', { class: 'muted gr-none' }, t('grades.noPairs'))
        : el('ul', { class: 'gr-pairs' }, subject.pairs.slice().reverse().map((pair) => pairRow(pair, true)))),
    subject.units.some((unit) => unit.selfWork) ? el('a', { class: 'button button--secondary gr-tasks', id: 'gr-tasks', href: '#/tasks' }, t('grades.myTasks')) : null,
    howBlock(scheme),
    el('a', { class: 'button button--secondary gr-back', href: '#/grades' }, t('grades.back')));
}

function notFound() {
  return el('div', { class: 'gr' }, pageHeader({ id: 'gr-title', title: t('grades.title') }),
    emptyState('alert', el('p', { role: 'alert' }, t('grades.notFound'))));
}

const STATUS_TONES = { present: 'success', late: 'warning', absent: 'danger', excused: 'neutral', madeup: 'primary' };

function pairRow(pair, withPoints) {
  const points = pointsText(pair);
  return el('li', { class: 'gr-pair' },
    el('div', { class: 'gr-pair__top' },
      el('span', { class: 'gr-pair__date' }, weekdayDate(pair.date)),
      badge(t('journal.marks.status.' + pair.status), STATUS_TONES[pair.status] || 'neutral')),
    el('p', { class: 'gr-pair__topic' }, pair.topicName || t('grades.noTopic')),
    withPoints ? el('div', { class: 'gr-pair__bottom' },
      pair.noCoat ? badge(t('grades.noCoat'), 'warning') : null,
      el('span', { class: 'gr-pair__points' + (points.key === 'grades.notCounted' ? ' is-muted' : '') }, t(points.key, points.params))) : null);
}

// ---- The totals of a subject, the same on the card and at the top of the details ----

function summary(subject, scheme) {
  const blocks = [];
  for (const unit of subject.units) blocks.push(unitBlock(unit, scheme));
  if (subject.outside && subject.outside.possible > 0) {
    blocks.push(el('p', { class: 'gr-outside' }, t('grades.outside', { earned: subject.outside.earned, possible: subject.outside.possible })));
  }
  if (blocks.length === 0) blocks.push(el('p', { class: 'muted gr-none' }, t('grades.cardEmpty')));
  const out = [el('div', { class: 'gr-units' }, blocks)];
  if (subject.preliminary !== null && subject.preliminary !== undefined) {
    out.unshift(el('p', { class: 'gr-final' },
      el('span', { class: 'gr-final__text' }, t('grades.preliminary', { value: subject.preliminary, max: scheme.current + scheme.self + scheme.control })),
      subject.word ? badge(t('journal.grade.' + subject.word), wordTone(subject.word)) : null));
  }
  const a = subject.attendance;
  if (a && a.marked > 0) out.push(el('p', { class: 'gr-attendance' }, t('grades.attendance', { attended: a.attended, marked: a.marked, missed: a.absent + a.excused })));
  return el('div', { class: 'gr-summary' }, out);
}

const wordTone = (word) => (word === 'excellent' ? 'success' : word === 'good' ? 'primary' : word === 'fair' ? 'warning' : 'danger');

function unitBlock(unit, scheme) {
  const line = unitLine(unit);
  const params = {
    ...line.params, maxCurrent: scheme.current, maxSelf: scheme.self, maxControl: scheme.control, maxTotal: scheme.current + scheme.self + scheme.control,
  };
  return el('div', { class: 'gr-unit' },
    el('p', { class: 'gr-unit__name' }, unit.title ? t('grades.unitTitled', { n: unit.unit, title: unit.title }) : t('grades.unitName', { n: unit.unit }),
      unit.total !== null && unit.word ? badge(t('journal.grade.' + unit.word), wordTone(unit.word)) : null),
    el('p', { class: 'gr-unit__line' }, line.parts ? line.parts.map((part) => t(part.key, { ...part.params, ...params })).join(' · ') : t(line.key, params)),
    unit.currentLow ? lowNote('grades.low.current', scheme) : null,
    unit.controlLow ? lowNote('grades.low.control', scheme) : null);
}

const lowNote = (key, scheme) => el('p', { class: 'gr-low' }, icon('alert', 'gr-low__icon'), el('span', {}, t(key, { minimum: scheme.minimum })));

// ---- «Как считаются баллы» ----

function howBlock(scheme) {
  const p = { ...scheme, total: scheme.current + scheme.self + scheme.control };
  return el('details', { class: 'card gr-how' },
    el('summary', { class: 'gr-how__summary' }, t('grades.how.title'), icon('chevron', 'gr-how__go')),
    el('div', { class: 'gr-how__body' },
      ['pair', 'current', 'self', 'control', 'total', 'words'].map((name) => el('p', {}, t('grades.how.' + name, p)))));
}

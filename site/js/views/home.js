import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole, menuParts, navFor, countBadge } from '../shell.js';
import { pairCard, weekdayDate, lessonPieces } from './pairParts.js';
import { teacherBadge } from '../subjects.js';
import { todayAction, clockText, cameMark } from '../lesson.js';
import { homeCardLines } from '../work.js';

// Sections later units fill in; for now the student sees what is coming.
const STUDENT_SECTIONS = [
  ['home.news', 'home.newsSoon', 'bell'],
];

// Last known subjects of the signed-in teacher: shown at once, refreshed in the background on every visit.
const subjects = { owner: null, list: null, errorKey: null, pending: null };
// The student's pairs of «today» (the server says which day that is), kept the same way.
const today = { owner: null, date: null, pairs: null, errorKey: null, pending: null };
// The counts of the student's assignments (work.mine), kept the same way.
const work = { owner: null, data: null, errorKey: null, pending: null };
// The subjects of the student's group, kept the same way.
const groupSubjects = { owner: null, list: null, errorKey: null, pending: null };

export function render(root) {
  const user = getUser();
  if (user.kind === 'student') renderStudent(root, user);
  else renderStaff(root, user);
}

function renderStudent(root, user) {
  root.append(
    el('section', { class: 'card profile', 'aria-labelledby': 'home-name' },
      avatar(user.fullName, 'lg'),
      el('div', { class: 'profile__text' },
        el('h1', { class: 'profile__name', id: 'home-name' }, user.fullName),
        el('p', { class: 'profile__role' }, t('role.student')),
        el('p', { class: 'profile__group' },
          el('span', { class: 'muted' }, t('home.group')),
          user.groupName ? badge(user.groupName, 'primary') : el('span', { class: 'muted' }, t('home.noGroup'))))),
    hereSection(user),
    homeworkSection(user),
    todaySection(user),
    studentSubjectsSection(user),
    el('a', { class: 'card soon soon--link', href: '#/grades' },
      el('span', { class: 'soon__icon' }, icon('chart')),
      el('div', { class: 'soon__body' },
        el('h2', { class: 'soon__title' }, t('home.grades')),
        el('p', { class: 'soon__text' }, t('home.gradesLead'))),
      icon('chevron', 'soon__go')),
    el('ul', { class: 'soon-list' }, STUDENT_SECTIONS.map(([title, text, iconName]) => el('li', { class: 'card soon' },
      el('span', { class: 'soon__icon' }, icon(iconName)),
      el('div', { class: 'soon__body' },
        el('h2', { class: 'soon__title' }, t(title)),
        el('p', { class: 'soon__text' }, t(text)))))));
}

// ---- «Я на паре»: a pair of the group whose check-in is open now ----

const HERE_EVERY_MS = 15000;
const here = { owner: null, pair: null, at: 0, pending: null, poll: null, clock: null };

function hereLeft() {
  return here.pair.checkinLeftMs - (performance.now() - here.at);
}

// Asks the server once when the home screen opens, then every 15 s while it is open and visible, but only if the
// student's pairs of today include one that is planned or running. The clock of the device decides nothing.
function hereSection(user) {
  clearInterval(here.poll);
  clearInterval(here.clock);
  const host = el('div', { class: 'here-host', 'aria-live': 'polite' });
  const draw = () => host.replaceChildren(...hereCard());
  if (here.owner !== user.id) Object.assign(here, { owner: user.id, pair: null });
  draw();
  const load = () => {
    if (!here.pending) {
      const owner = user.id;
      here.pending = call('checkin.current', {})
        .then((data) => { if (here.owner === owner) Object.assign(here, { pair: data.pair, at: performance.now() }); }, () => {})
        .finally(() => { here.pending = null; });
    }
    return here.pending.then(() => { if (host.isConnected) draw(); });
  };
  load();
  here.poll = setInterval(() => {
    const planned = today.owner === user.id && today.pairs && today.pairs.some((pair) => pair.date === today.date && ['planned', 'running'].includes(pair.status));
    if (!document.hidden && host.isConnected && planned) load();
  }, HERE_EVERY_MS);
  here.clock = setInterval(() => {
    const left = document.getElementById('home-here-left');
    if (!left || !here.pair) return;
    left.textContent = t('checkin.left', { time: clockText(hereLeft()) });
    if (hereLeft() <= 0 && !here.pending) { here.pair = null; load(); }
  }, 1000);
  return host;
}

function hereCard() {
  const pair = here.pair;
  if (!pair || pair.phase !== 'checkin') return [];
  const place = [pair.subjectName, pair.roomName ? t('lesson.room', { room: pair.roomName }) : null, pair.startTime].filter(Boolean).join(' · ');
  if (cameMark(pair.mark)) {
    return [el('section', { class: 'card here-card is-marked', 'aria-label': t('checkin.title') },
      el('span', { class: 'here-card__tick' }, icon('check')),
      el('div', { class: 'here-card__text' },
        el('p', { class: 'here-card__now' }, t('checkin.now', { place })),
        el('p', { class: 'here-card__done' }, t('checkin.marked', { at: pair.mark.at }))))];
  }
  return [el('section', { class: 'card here-card', 'aria-label': t('checkin.title') },
    el('div', { class: 'here-card__text' },
      el('p', { class: 'here-card__now' }, t('checkin.now', { place })),
      el('p', { class: 'here-card__left', id: 'home-here-left' }, t('checkin.left', { time: clockText(hereLeft()) }))),
    el('a', { class: 'button button--primary here-card__go', href: '#/here' }, icon('checkCircle'), t('checkin.go')))];
}

// «Задания»: how many assignments are new, due by tomorrow, overdue or sent back, and the way to the whole list.
function homeworkSection(user) {
  const body = el('div', { class: 'homework__body', 'aria-live': 'polite' });
  const draw = () => body.replaceChildren(...homeworkBody(user, draw));
  draw();
  loadWork(user).then(draw);
  return el('section', { class: 'card homework', 'aria-labelledby': 'home-homework' },
    el('header', { class: 'today__head' },
      el('span', { class: 'soon__icon homework__icon' }, icon('clipboard')),
      el('h2', { class: 'soon__title', id: 'home-homework' }, t('home.homework'))),
    body,
    el('a', { class: 'button button--primary homework__all', id: 'home-homework-all', href: '#/tasks' }, t('work.home.all')));
}

function homeworkBody(user, redraw) {
  if (work.data) {
    const lines = homeCardLines(work.data.counts);
    if (lines.length === 0) return [el('p', { class: 'homework__none', id: 'home-homework-none' }, t('work.home.none'))];
    return [el('ul', { class: 'homework__lines', id: 'home-homework-lines' }, lines.map((line) => el('li', { class: 'homework__line homework__line--' + line.tone }, t(line.key, line.params))))];
  }
  if (work.errorKey && !work.pending) {
    return [el('div', { class: 'today__failed', role: 'alert' },
      el('p', {}, t(work.errorKey)),
      el('button', {
        type: 'button', class: 'button button--secondary',
        onclick: () => { loadWork(user).then(redraw); redraw(); },
      }, t('common.retry')))];
  }
  return [el('p', { class: 'loading' }, t('common.loading'))];
}

function loadWork(user) {
  if (work.owner !== user.id) Object.assign(work, { owner: user.id, data: null, errorKey: null, pending: null });
  if (!work.pending) {
    const owner = user.id;
    const mine = () => work.owner === owner;
    work.pending = call('work.mine', {})
      .then(
        (data) => { if (mine()) Object.assign(work, { data, errorKey: null }); },
        (error) => { if (mine()) work.errorKey = errorKey(error.code); },
      )
      .finally(() => { if (mine()) work.pending = null; });
  }
  return work.pending;
}

// «Сегодня»: the pairs of the student's group today, as on the week, and the way to the whole week.
function todaySection(user) {
  const body = el('div', { class: 'today__body', 'aria-live': 'polite' });
  const date = el('p', { class: 'today__date' });
  const draw = () => {
    date.textContent = today.date ? weekdayDate(today.date) : '';
    body.replaceChildren(todayBody(user, draw));
  };
  draw();
  loadToday(user).then(draw);
  return el('section', { class: 'card today', 'aria-labelledby': 'home-today' },
    el('header', { class: 'today__head' },
      el('span', { class: 'soon__icon today__icon' }, icon('calendar')),
      el('div', { class: 'today__title' }, el('h2', { class: 'soon__title', id: 'home-today' }, t('home.today')), date)),
    body,
    el('a', { class: 'button button--primary today__week', href: '#/my' }, icon('calendar'), t('home.toWeek')));
}

function todayBody(user, redraw) {
  if (today.pairs) {
    if (today.pairs.length === 0) return el('p', { class: 'today__none' }, t('home.todayNone'));
    return el('ul', { class: 'today__pairs' }, today.pairs.map((pair) => el('li', {}, pairCard(pair, { show: ['teacher'] }))));
  }
  if (today.errorKey && !today.pending) {
    return el('div', { class: 'today__failed', role: 'alert' },
      el('p', {}, t(today.errorKey)),
      el('button', {
        type: 'button', class: 'button button--secondary',
        onclick: () => { loadToday(user).then(redraw); redraw(); },
      }, t('common.retry')));
  }
  return el('p', { class: 'loading' }, t('common.loading'));
}

function loadToday(user) {
  if (today.owner !== user.id) Object.assign(today, { owner: user.id, date: null, pairs: null, errorKey: null, pending: null });
  if (!today.pending) {
    const owner = user.id;
    const mine = () => today.owner === owner;
    // Without `from` the server answers with the week of its «today».
    today.pending = call('schedule.mine', {})
      .then(
        (data) => {
          if (!mine()) return;
          const pairs = data.pairs.filter((pair) => pair.date === data.today).sort((a, b) => a.slot - b.slot);
          Object.assign(today, { date: data.today, pairs, errorKey: null });
        },
        (error) => { if (mine()) today.errorKey = errorKey(error.code); },
      )
      .finally(() => { if (mine()) today.pending = null; });
  }
  return today.pending;
}

// «Предметы»: the subjects of the group and who teaches them; a subject with a syllabus opens its page.
function studentSubjectsSection(user) {
  const body = el('div', { class: 'courses__body', 'aria-live': 'polite' });
  const draw = () => body.replaceChildren(studentSubjectsBody(user, draw));
  draw();
  loadGroupSubjects(user).then(draw);
  return el('section', { class: 'card courses', 'aria-labelledby': 'home-courses' },
    el('header', { class: 'today__head' },
      el('span', { class: 'soon__icon courses__icon' }, icon('book')),
      el('h2', { class: 'soon__title', id: 'home-courses' }, t('home.subjects'))),
    body);
}

function studentSubjectsBody(user, redraw) {
  if (groupSubjects.list) {
    if (groupSubjects.list.length === 0) return el('p', { class: 'today__none' }, t('home.subjectsNone'));
    return el('ul', { class: 'courses__list' }, groupSubjects.list.map((subject) => {
      // a syllabus hidden while its new version is under review still leads to its page, which says «updating»
      const link = subject.hasSyllabus || subject.updating;
      const note = subject.hasSyllabus ? null : subject.updating ? t('home.syllabusUpdating') : t('home.noSyllabus');
      const text = el('span', { class: 'course__text' },
        el('span', { class: 'course__name' }, subject.name),
        subject.teacherName ? el('span', { class: 'course__teacher' }, subject.teacherName) : null,
        note ? el('span', { class: 'course__none' }, note) : null);
      return el('li', {}, link
        ? el('a', { class: 'course is-link', href: '#/syllabus/' + subject.id }, text, icon('chevron', 'course__go'))
        : el('div', { class: 'course' }, text));
    }));
  }
  if (groupSubjects.errorKey && !groupSubjects.pending) {
    return el('div', { class: 'today__failed', role: 'alert' },
      el('p', {}, t(groupSubjects.errorKey)),
      el('button', {
        type: 'button', class: 'button button--secondary',
        onclick: () => { loadGroupSubjects(user).then(redraw); redraw(); },
      }, t('common.retry')));
  }
  return el('p', { class: 'loading' }, t('common.loading'));
}

function loadGroupSubjects(user) {
  if (groupSubjects.owner !== user.id) Object.assign(groupSubjects, { owner: user.id, list: null, errorKey: null, pending: null });
  if (!groupSubjects.pending) {
    const owner = user.id;
    const mine = () => groupSubjects.owner === owner;
    groupSubjects.pending = call('student.subjects', {})
      .then(
        (data) => { if (mine()) Object.assign(groupSubjects, { list: data.subjects, errorKey: null }); },
        (error) => { if (mine()) groupSubjects.errorKey = errorKey(error.code); },
      )
      .finally(() => { if (mine()) groupSubjects.pending = null; });
  }
  return groupSubjects.pending;
}

// Staff: an overview of what the active role works with. The role is switched in the sidebar.
function renderStaff(root, user) {
  const role = activeRole(user);
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const parts = menuParts(role);
  const sections = [];
  if (parts.includes('office')) {
    if (permissions.includes('request.queue')) sections.push(requestsBlock(user));
    for (const group of navFor(permissions, role).filter((candidate) => candidate.titleKey)) {
      sections.push(section('home-' + group.items[0].name, t(group.titleKey), el('ul', { class: 'tiles' }, group.items.map(tile))));
    }
  }
  if (parts.includes('subjects') && permissions.includes('lesson.mine')) sections.push(lessonsSection(user));
  if (parts.includes('subjects') && permissions.includes('teacher.mySubjects')) sections.push(subjectsSection(user));
  root.append(
    pageHeader({ id: 'home-name', title: user.fullName, lead: role ? t('role.' + role) : null }),
    ...(sections.length > 0 ? sections : [emptyState('info', el('p', {}, t('home.nothing')))]));
}

// ---- «Пары сегодня» of the teacher: start a pair or open the screen of a started one ----

const LESSONS_EVERY_MS = 60000;
const lessons = { owner: null, pairs: null, errorKey: null, pending: null, timer: null, message: {} };

// Stops what the home screen keeps running (called by main.js when another screen replaces it).
export function leave() {
  clearInterval(lessons.timer);
  lessons.timer = null;
  clearInterval(here.poll);
  clearInterval(here.clock);
  here.pair = null;
  Object.assign(requestCount, { owner: null, n: null, pending: null });
}

// The section appears only when there are pairs today; it asks again every minute while the page is open and visible.
function lessonsSection(user) {
  const host = el('div', { class: 'lessons-host' });
  const draw = () => host.replaceChildren(...lessonsBody(user, draw));
  draw();
  const load = () => loadLessons(user).then(() => { if (host.isConnected) draw(); });
  load();
  clearInterval(lessons.timer);
  lessons.timer = setInterval(() => { if (!document.hidden) load(); }, LESSONS_EVERY_MS);
  return host;
}

function lessonsBody(user, redraw) {
  if (lessons.owner === user.id && lessons.pairs && lessons.pairs.length > 0) {
    return [section('home-lessons', t('home.lessons.title'),
      el('ul', { class: 'lessons', 'aria-live': 'polite' }, lessons.pairs.map((pair) => el('li', {}, lessonCard(pair, redraw)))))];
  }
  if (lessons.owner === user.id && lessons.errorKey && !lessons.pairs && !lessons.pending) {
    return [section('home-lessons', t('home.lessons.title'), el('div', { class: 'today__failed', role: 'alert' },
      el('p', {}, t(lessons.errorKey)),
      el('button', { type: 'button', class: 'button button--secondary', onclick: () => { loadLessons(user).then(redraw); redraw(); } }, t('common.retry'))))];
  }
  return [];
}

function lessonCard(pair, redraw) {
  const action = todayAction(pair);
  const hint = pair.status === 'closed' ? 'home.lessons.closed'
    : pair.problem === 'start_early' ? 'home.lessons.from'
      : pair.problem === 'start_late' ? 'home.lessons.late' : null;
  const failed = lessons.message[pair.id];
  const open = () => { location.hash = '#/lesson/' + encodeURIComponent(pair.id); };
  const start = el('button', {
    type: 'button', class: 'button button--primary lesson-card__act', id: 'home-lesson-' + pair.id,
    onclick: async () => {
      if (start.getAttribute('aria-disabled') === 'true') return;
      start.setAttribute('aria-disabled', 'true');
      try {
        await call('lesson.start', { pairId: pair.id });
        delete lessons.message[pair.id];
        open();
      } catch (error) {
        lessons.message[pair.id] = errorKey(error.code);
        redraw();
      }
    },
  }, icon('grid'), t('home.lessons.start'));
  return el('article', { class: 'card lesson-card' + (pair.status === 'running' ? ' is-running' : '') },
    el('p', { class: 'lesson-card__time' }, pair.startTime, el('span', { class: 'lesson-card__end' }, pair.endTime)),
    el('div', { class: 'lesson-card__main' },
      el('h3', { class: 'lesson-card__subject' }, pair.subjectName),
      el('p', { class: 'lesson-card__meta' },
        pair.groupName ? badge(pair.groupName, 'primary') : null,
        pair.roomName ? el('span', {}, t('lesson.room', { room: pair.roomName })) : null),
      el('p', { class: 'lesson-card__topic' }, pair.topic ? lessonPieces(pair.topic) : t('home.lessons.noTopic'))),
    el('div', { class: 'lesson-card__side' },
      action === 'start' ? start : null,
      action === 'open' ? el('a', { class: 'button button--primary lesson-card__act', href: '#/lesson/' + encodeURIComponent(pair.id) }, icon('grid'), t('home.lessons.open')) : null,
      !action && hint ? el('p', { class: 'lesson-card__hint' }, t(hint, { time: pair.startFrom })) : null,
      failed ? el('p', { class: 'lesson-card__hint lesson-card__hint--error', role: 'alert' }, t(failed, { time: pair.startFrom })) : null));
}

function loadLessons(user) {
  if (lessons.owner !== user.id) Object.assign(lessons, { owner: user.id, pairs: null, errorKey: null, pending: null, message: {} });
  if (!lessons.pending) {
    const owner = user.id;
    const mine = () => lessons.owner === owner;
    lessons.pending = call('lesson.mine', {})
      .then(
        (data) => { if (mine()) Object.assign(lessons, { pairs: data.pairs, errorKey: null }); },
        (error) => { if (mine()) lessons.errorKey = errorKey(error.code); },
      )
      .finally(() => { if (mine()) lessons.pending = null; });
  }
  return lessons.pending;
}

// «Заявки: ждут вашего решения — N»: one request.queue each time the home screen is opened (leave() forgets the number); with none
// waiting, or no answer, there is no block.
const requestCount = { owner: null, n: null, pending: null };

function requestsBlock(user) {
  const holder = el('div', { class: 'home-requests', id: 'home-requests' });
  const draw = () => {
    holder.replaceChildren();
    if (requestCount.n > 0) {
      holder.append(el('a', { class: 'card home-requests__link', id: 'home-requests-link', href: '#/requests' },
        el('span', { class: 'tile__icon' }, icon('clipboard')),
        el('span', { class: 'home-requests__text' }, t('home.requests.waiting', { n: requestCount.n })),
        icon('chevron', 'tile__go')));
    }
  };
  if (requestCount.owner !== user.id) Object.assign(requestCount, { owner: user.id, n: null, pending: null });
  if (requestCount.n === null && !requestCount.pending) {
    const owner = user.id;
    requestCount.pending = call('request.queue', {})
      .then((data) => { if (requestCount.owner === owner) requestCount.n = Number.isInteger(data.waiting) ? data.waiting : 0; }, () => {})
      .finally(() => { if (requestCount.owner === owner) requestCount.pending = null; });
    requestCount.pending.then(draw);
  }
  draw();
  return holder;
}

function section(id, title, body) {
  return el('section', { class: 'section', 'aria-labelledby': id }, el('h2', { class: 'section__title', id }, title), body);
}

function tile(item) {
  return el('li', {}, el('a', { class: 'card tile' + (item.name === 'import' ? ' tile--accent' : ''), href: item.href },
    el('span', { class: 'tile__icon' }, icon(item.icon)),
    el('span', { class: 'tile__text' },
      el('span', { class: 'tile__title' }, t(item.textKey), item.count ? countBadge('nav-count tile__count') : null),
      el('span', { class: 'tile__hint' }, t(item.hintKey))),
    icon('chevron', 'tile__go')));
}

function subjectsSection(user) {
  const body = el('div', { 'aria-live': 'polite' });
  const draw = () => body.replaceChildren(subjectsBody(user, draw));
  draw();
  loadSubjects(user).then(draw);
  return section('home-subjects', t('home.mySubjects'), body);
}

function subjectsBody(user, redraw) {
  if (subjects.list) {
    if (subjects.list.length === 0) return emptyState('book', el('p', {}, t('home.noSubjects')));
    const granted = Array.isArray(user.permissions) ? user.permissions : [];
    const rights = { plans: granted.includes('syllabus.get'), journal: granted.includes('journal.get') };
    return el('ul', { class: 'card list' }, subjects.list.map((subject) => subjectRow(subject, rights)));
  }
  if (subjects.errorKey && !subjects.pending) {
    return emptyState('alert',
      el('p', {}, t(subjects.errorKey)),
      el('button', {
        type: 'button', class: 'button button--secondary',
        onclick: () => { loadSubjects(user).then(redraw); redraw(); },
      }, t('common.retry')));
  }
  return el('p', { class: 'loading' }, t('common.loading'));
}

// A subject of the teacher: the group, the students, the state of the syllabus. A returned syllabus is the one thing
// waiting on the teacher: its row carries the warning colour and says what to do; its button stands out.
// Beside the syllabus, the journal of the subject.
function subjectRow(subject, rights) {
  const mark = teacherBadge(subject.syllabus);
  const returned = mark.key === 'home.syllabusState.returned';
  const nameId = 'subject-' + subject.id;
  const markId = 'subject-mark-' + subject.id;
  return el('li', { class: 'list__row subject' + (returned ? ' is-returned' : '') },
    el('span', { class: 'list__icon' }, icon('book')),
    el('span', { class: 'subject__main' },
      el('span', { class: 'subject__name', id: nameId }, subject.name),
      returned ? el('span', { class: 'subject__alert' }, t('home.syllabusReturned')) : null),
    subject.groupName ? badge(subject.groupName, 'primary') : null,
    el('span', { class: 'subject__count' }, t('home.studentCount', { count: subject.studentCount })),
    el('span', { class: 'subject__mark', id: markId }, badge(t(mark.key), mark.tone, true)),
    rights.plans || rights.journal ? el('span', { class: 'subject__actions' },
      rights.plans ? el('a', {
        class: 'button subject__plan ' + (returned ? 'button--primary' : 'button--secondary'),
        href: '#/syllabus/' + subject.id, 'aria-describedby': nameId + ' ' + markId,
      }, icon('clipboard'), t('home.syllabus')) : null,
      rights.journal ? el('a', {
        class: 'button button--secondary subject__plan', href: '#/journal/' + subject.id, 'aria-describedby': nameId,
      }, icon('table'), t('journal.title')) : null) : null);
}

function loadSubjects(user) {
  if (subjects.owner !== user.id) Object.assign(subjects, { owner: user.id, list: null, errorKey: null, pending: null });
  if (!subjects.pending) {
    const owner = user.id;
    const mine = () => subjects.owner === owner;
    subjects.pending = call('teacher.mySubjects', {})
      .then(
        (data) => { if (mine()) Object.assign(subjects, { list: data.subjects, errorKey: null }); },
        (error) => { if (mine()) subjects.errorKey = errorKey(error.code); },
      )
      .finally(() => { if (mine()) subjects.pending = null; });
  }
  return subjects.pending;
}

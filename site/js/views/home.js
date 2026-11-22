import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole, menuParts, navFor, countBadge } from '../shell.js';
import { pairCard, weekdayDate } from './pairParts.js';
import { teacherBadge } from '../subjects.js';

// Sections later units fill in; for now the student sees what is coming.
const STUDENT_SECTIONS = [
  ['home.grades', 'home.gradesSoon', 'chart'],
  ['home.homework', 'home.homeworkSoon', 'clipboard'],
  ['home.news', 'home.newsSoon', 'bell'],
];

// Last known subjects of the signed-in teacher: shown at once, refreshed in the background on every visit.
const subjects = { owner: null, list: null, errorKey: null, pending: null };
// The student's pairs of «today» (the server says which day that is), kept the same way.
const today = { owner: null, date: null, pairs: null, errorKey: null, pending: null };
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
    todaySection(user),
    studentSubjectsSection(user),
    el('ul', { class: 'soon-list' }, STUDENT_SECTIONS.map(([title, text, iconName]) => el('li', { class: 'card soon' },
      el('span', { class: 'soon__icon' }, icon(iconName)),
      el('div', { class: 'soon__body' },
        el('h2', { class: 'soon__title' }, t(title)),
        el('p', { class: 'soon__text' }, t(text)))))));
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
    for (const group of navFor(permissions, role).filter((candidate) => candidate.titleKey)) {
      sections.push(section('home-' + group.items[0].name, t(group.titleKey), el('ul', { class: 'tiles' }, group.items.map(tile))));
    }
  }
  if (parts.includes('subjects') && permissions.includes('teacher.mySubjects')) sections.push(subjectsSection(user));
  root.append(
    pageHeader({ id: 'home-name', title: user.fullName, lead: role ? t('role.' + role) : null }),
    ...(sections.length > 0 ? sections : [emptyState('info', el('p', {}, t('home.nothing')))]));
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
    const plans = (Array.isArray(user.permissions) ? user.permissions : []).includes('syllabus.get');
    return el('ul', { class: 'card list' }, subjects.list.map((subject) => subjectRow(subject, plans)));
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
function subjectRow(subject, plans) {
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
    plans ? el('a', {
      class: 'button subject__plan ' + (returned ? 'button--primary' : 'button--secondary'),
      href: '#/syllabus/' + subject.id, 'aria-describedby': nameId + ' ' + markId,
    }, icon('clipboard'), t('home.syllabus')) : null);
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

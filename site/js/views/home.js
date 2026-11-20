import { call } from '../api.js';
import { getUser } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey, avatar, badge, emptyState, pageHeader } from '../ui.js';
import { icon } from '../icons.js';
import { activeRole, menuParts, navFor } from '../shell.js';

// Sections later units fill in; for now the student sees what is coming.
const STUDENT_SECTIONS = [
  ['home.today', 'home.todaySoon', 'calendar'],
  ['home.grades', 'home.gradesSoon', 'chart'],
  ['home.homework', 'home.homeworkSoon', 'clipboard'],
  ['home.news', 'home.newsSoon', 'bell'],
];

// Last known subjects of the signed-in teacher: shown at once, refreshed in the background on every visit.
const subjects = { owner: null, list: null, errorKey: null, pending: null };

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
    el('ul', { class: 'soon-list' }, STUDENT_SECTIONS.map(([title, text, iconName]) => el('li', { class: 'card soon' },
      el('span', { class: 'soon__icon' }, icon(iconName)),
      el('div', { class: 'soon__body' },
        el('h2', { class: 'soon__title' }, t(title)),
        el('p', { class: 'soon__text' }, t(text)))))));
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
      el('span', { class: 'tile__title' }, t(item.textKey)),
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
    return el('ul', { class: 'card list' }, subjects.list.map((subject) => el('li', { class: 'list__row subject' },
      el('span', { class: 'list__icon' }, icon('book')),
      el('span', { class: 'subject__name' }, subject.name),
      subject.groupName ? badge(subject.groupName, 'primary') : null,
      el('span', { class: 'subject__count' }, t('home.studentCount', { count: subject.studentCount })))));
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

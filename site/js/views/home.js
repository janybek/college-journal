import { call } from '../api.js';
import { getUser, getPref, setPref } from '../session.js';
import { t } from '../i18n.js';
import { el, errorKey } from '../ui.js';

const DIR_TABLES = ['groups', 'students', 'staff', 'subjects', 'rooms'];
// Menu parts each staff role works with; inside a part only what `permissions` allow is shown.
const MENU_BY_ROLE = new Map([['admin', ['office']], ['dean', ['office']], ['prorector', ['office']], ['teacher', ['subjects']]]);
// Sections later units fill in; for now the student sees what is coming.
const STUDENT_SECTIONS = [
  ['home.today', 'home.todaySoon'],
  ['home.grades', 'home.gradesSoon'],
  ['home.homework', 'home.homeworkSoon'],
  ['home.news', 'home.newsSoon'],
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
    el('section', { class: 'sheet sheet--label', 'aria-labelledby': 'home-name' },
      el('p', { class: 'eyebrow' }, t('role.student')),
      el('h1', { class: 'identity__name', id: 'home-name' }, user.fullName),
      el('p', { class: 'identity__line' },
        el('span', { class: 'identity__caption' }, t('home.group')),
        user.groupName
          ? el('span', { class: 'blank' }, user.groupName)
          : el('span', { class: 'blank blank--empty' }, t('home.noGroup')))),
    el('ul', { class: 'ledger' }, STUDENT_SECTIONS.map(([title, text]) => el('li', { class: 'ledger__row soon' },
      el('h2', { class: 'soon__title' }, t(title)),
      el('p', { class: 'soon__text' }, t(text))))));
}

function renderStaff(root, user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const saved = getPref('role');
  const active = roles.includes(saved) ? saved : roles[0];
  const menu = el('div', { class: 'stack' });
  const drawMenu = (role) => menu.replaceChildren(...menuFor(user, role));
  root.append(
    el('section', { class: 'sheet sheet--label', 'aria-labelledby': 'home-name' },
      el('h1', { class: 'identity__name', id: 'home-name' }, user.fullName),
      roles.length > 0 ? roleLine(roles, active, drawMenu) : null),
    menu);
  drawMenu(active);
}

// One role: a plain line. Several roles: a switcher that only changes which menu is shown.
function roleLine(roles, active, onPick) {
  const caption = el('span', { class: 'identity__caption', id: 'role-caption' }, t('home.role'));
  if (roles.length === 1) {
    return el('p', { class: 'identity__line' }, caption, el('span', { class: 'identity__value' }, t('role.' + active)));
  }
  const buttons = roles.map((role) => el('button', {
    type: 'button', id: 'role-' + role, class: 'segmented__button', 'aria-pressed': String(role === active),
    onclick: () => {
      setPref('role', role);
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.id === 'role-' + role));
      onPick(role);
    },
  }, t('role.' + role)));
  return el('div', { class: 'identity__line' }, caption,
    el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'role-caption' }, buttons));
}

function menuFor(user, role) {
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const parts = MENU_BY_ROLE.get(role) ?? [];
  const sections = [];
  if (parts.includes('office')) {
    const office = officeSection(permissions);
    if (office) sections.push(office);
  }
  if (parts.includes('subjects') && permissions.includes('teacher.mySubjects')) sections.push(subjectsSection(user));
  return sections.length > 0 ? sections : [el('p', { class: 'empty' }, t('home.nothing'))];
}

function section(id, title, body) {
  return el('section', { class: 'section', 'aria-labelledby': id }, el('h2', { class: 'section__title', id }, title), body);
}

function tile(href, title, hint, modifier = '') {
  return el('li', {}, el('a', { class: 'tile' + modifier, href },
    el('span', { class: 'tile__title' }, title),
    el('span', { class: 'tile__hint' }, hint)));
}

function officeSection(permissions) {
  const tiles = DIR_TABLES
    .filter((table) => permissions.includes('dir.list:' + table))
    .map((table) => tile('#/dir/' + table, t('dir.' + table), t('dir.' + table + '.hint')));
  if (permissions.some((p) => p.startsWith('import.apply:'))) {
    tiles.push(tile('#/import', t('import.title'), t('import.hint'), ' tile--action'));
  }
  return tiles.length > 0 ? section('home-directories', t('home.directories'), el('ul', { class: 'tiles' }, tiles)) : null;
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
    if (subjects.list.length === 0) return el('p', { class: 'empty' }, t('home.noSubjects'));
    return el('ul', { class: 'ledger' }, subjects.list.map((subject) => el('li', { class: 'ledger__row subject' },
      el('span', { class: 'subject__name' }, subject.name),
      subject.groupName ? el('span', { class: 'chip' }, subject.groupName) : null,
      el('span', { class: 'subject__count' }, t('home.studentCount', { count: subject.studentCount })))));
  }
  if (subjects.errorKey && !subjects.pending) {
    return el('div', { class: 'empty' },
      el('p', {}, t(subjects.errorKey)),
      el('button', {
        type: 'button', class: 'button button--quiet',
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

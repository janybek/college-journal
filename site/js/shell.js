import { t, getLang, LANGS } from './i18n.js';
import { getUser, getPref, setPref } from './session.js';
import { el, avatar, iconButton, refresh } from './ui.js';
import { icon } from './icons.js';
import { currentTheme, toggleTheme } from './theme.js';
import { DIR_TABLES } from './views/directoryConfig.js';
import { reviewCount, onReviewCount } from './reviewCount.js';

// The frame around the screens: sign-in pages (a centred card), the student's phone bar, and the staff layout
// with a sidebar (a drawer on narrow screens) and a top bar. The server checks every right itself; the
// navigation only leaves out what the person's `permissions` do not allow.

const DIR_ICONS = { groups: 'layers', students: 'cap', staff: 'briefcase', disciplines: 'list', rooms: 'door' };
// Menu parts each staff role works with; inside a part only what `permissions` allow is shown.
const MENU_BY_ROLE = new Map([['admin', ['office']], ['dean', ['office']], ['prorector', ['office']], ['teacher', ['subjects']]]);
const HOME = { name: 'home', href: '#/', textKey: 'nav.home', icon: 'home' };
// Keep in step with the breakpoint in app.css where the sidebar becomes a drawer.
const WIDE = '(min-width: 900px)';

export function permissions() {
  const user = getUser();
  return user && Array.isArray(user.permissions) ? user.permissions : [];
}

export function menuParts(role) {
  return MENU_BY_ROLE.get(role) ?? [];
}

// The role whose menu is shown: the one chosen on this device if the person still has it, else the first.
export function activeRole(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const saved = getPref('role');
  return roles.includes(saved) ? saved : roles[0];
}

// Navigation groups for a role: [{ titleKey, items: [{ name, href, textKey, icon, hintKey, count? }] }]. Pure, for tests.
// hintKey: the line under the item's tile on the home screen; count: the item shows the number of reviewCount.js.
// The teacher's home is the list of their subjects, so their first item is named after it.
export function navFor(permissionList, role) {
  const list = Array.isArray(permissionList) ? permissionList : [];
  const parts = menuParts(role);
  if (parts.includes('subjects') && list.includes('teacher.mySubjects')) {
    const items = [{ ...HOME, textKey: 'home.mySubjects', icon: 'book' }];
    if (list.includes('schedule.mine')) items.push({ name: 'mySchedule', href: '#/my', textKey: 'my.title', icon: 'calendar' });
    if (list.includes('journal.list')) items.push({ name: 'journalList', href: '#/journal', textKey: 'journal.title', icon: 'table' });
    if (list.includes('work.overview')) items.push({ name: 'tasks', href: '#/tasks', textKey: 'tasks.title', icon: 'clipboard' });
    if (list.includes('ledger.list')) items.push({ name: 'ledgerList', href: '#/ledger', textKey: 'ledger.title', icon: 'sheet' });
    if (list.includes('request.mine')) items.push({ name: 'requests', href: '#/requests', textKey: 'request.mine.title', icon: 'clipboard' });
    if (list.includes('stateExam.list')) items.push({ name: 'stateExams', href: '#/state-exams', textKey: 'stateExam.title', icon: 'sheet' });
    return [{ titleKey: 'nav.teaching', items }];
  }
  const groups = [{ titleKey: null, items: [HOME] }];
  if (!parts.includes('office')) return groups;
  if (list.includes('journal.list')) {
    const items = [{ name: 'journalList', href: '#/journal', textKey: 'journal.list.title', icon: 'table', hintKey: 'journal.hint' }];
    if (list.includes('ledger.list')) items.push({ name: 'ledgerList', href: '#/ledger', textKey: 'ledger.title', icon: 'sheet', hintKey: 'ledger.hint' });
    if (list.includes('work.overview')) items.push({ name: 'tasks', href: '#/tasks', textKey: 'tasks.title', icon: 'clipboard', hintKey: 'tasks.hint' });
    if (list.includes('request.queue')) items.push({ name: 'requests', href: '#/requests', textKey: 'request.queue.title', icon: 'clipboard', hintKey: 'request.queue.hint' });
    if (list.includes('stateExam.list')) items.push({ name: 'stateExams', href: '#/state-exams', textKey: 'stateExam.title', icon: 'sheet', hintKey: 'stateExam.hint' });
    if (list.includes('journal.log')) items.push({ name: 'journalLog', href: '#/journal-log', textKey: 'journalLog.title', icon: 'clipboard', hintKey: 'journalLog.hint' });
    groups.push({ titleKey: 'nav.journal', items });
  }
  const schedule = [];
  if (list.includes('schedule.list')) {
    schedule.push({ name: 'schedule', href: '#/schedule', textKey: 'schedule.title', icon: 'calendar', hintKey: 'schedule.hint' });
  }
  if (list.includes('dir.list:weekTemplate')) {
    schedule.push({ name: 'weekTemplate', href: '#/template', textKey: 'template.title', icon: 'grid', hintKey: 'template.hint' });
  }
  if (list.includes('subjects.overview')) {
    schedule.push({ name: 'subjects', href: '#/subjects', textKey: 'subjects.title', icon: 'book', hintKey: 'subjects.hint' });
  }
  if (list.includes('syllabus.queue')) {
    schedule.push({ name: 'review', href: '#/review', textKey: 'review.title', icon: 'clipboard', hintKey: 'review.hint', count: true });
  }
  if (list.includes('settings.get')) {
    schedule.push({ name: 'settings', href: '#/settings', textKey: 'settings.title', icon: 'settings', hintKey: 'settings.hint' });
  }
  if (schedule.length > 0) groups.push({ titleKey: 'nav.schedule', items: schedule });
  const directories = DIR_TABLES.filter((table) => list.includes('dir.list:' + table)).map((table) => ({
    name: table, href: '#/dir/' + table, textKey: 'dir.' + table, icon: DIR_ICONS[table], hintKey: `dir.${table}.hint`,
  }));
  if (directories.length > 0) groups.push({ titleKey: 'home.directories', items: directories });
  if (list.some((p) => p.startsWith('import.apply:'))) {
    groups.push({ titleKey: 'nav.data', items: [{ name: 'import', href: '#/import', textKey: 'import.title', icon: 'sheetUp', hintKey: 'import.hint' }] });
  }
  return groups;
}

// Drawer (narrow screens). Its state outlives a redraw, so a role switch inside it keeps it open; any change of
// address closes it.

let drawerOpen = false;
let drawerHash = null;
let listening = false;

function setDrawer(open, returnFocus) {
  drawerOpen = open;
  const shell = document.querySelector('.shell');
  if (!shell) return;
  shell.classList.toggle('is-drawer-open', open);
  shell.querySelector('.shell__body').inert = open;
  const menuButton = document.getElementById('menu-open');
  menuButton.setAttribute('aria-expanded', String(open));
  if (open) (shell.querySelector('.nav-link[aria-current="page"]') ?? shell.querySelector('.nav-link')).focus();
  else if (returnFocus) menuButton.focus();
}

const closeDrawer = () => { if (drawerOpen) setDrawer(false, true); };

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawerOpen && !document.querySelector('dialog[open]')) closeDrawer();
  });
  // Widening the window turns the drawer back into a sidebar: nothing may stay inert.
  const wide = window.matchMedia(WIDE);
  wide.addEventListener('change', () => { if (wide.matches && drawerOpen) setDrawer(false, false); });
  // A new number of versions under review changes the menu and the home tile in place.
  onReviewCount(() => {
    for (const shown of document.querySelectorAll('[data-review-count]')) shown.replaceWith(countBadge(shown.dataset.reviewCount));
  });
}

// The number of versions under review beside an item of the menu (or its tile on the home screen). Nothing for 0
// and while the number is not known yet: an empty placeholder keeps the place to fill in.
export function countBadge(className = 'nav-count') {
  const n = reviewCount();
  if (n === null || n === 0) return el('span', { 'data-review-count': className, hidden: true });
  return el('span', { class: className, 'data-review-count': className }, String(n));
}

// Builds the frame for this screen into `host` and returns the <main> element the screen draws into.
// handlers: { onLang(lang), onLogout() }.
export function renderShell(host, { user, view, params }, handlers) {
  listen();
  if (location.hash !== drawerHash) {
    drawerOpen = false;
    drawerHash = location.hash;
  }
  const main = el('main', { id: 'app', class: 'content' + (view === 'lesson' ? ' lp' : ''), tabindex: '-1' });
  let frame;
  // the screen of a pair is a whole-window panel for the projector: no menu, no top bar
  if (view === 'lesson') frame = el('div', { class: 'lesson-frame' }, main);
  else if (view === 'login' || view === 'changePassword') frame = authFrame(user, main, handlers);
  else if (user.kind === 'student') frame = studentFrame(main, handlers);
  else frame = staffFrame(user, view, params, main, handlers);
  const savedScroll = host.querySelector('.sidebar__nav')?.scrollTop ?? 0;
  host.replaceChildren(frame);
  keepMenuScroll(frame.querySelector('.sidebar__nav'), savedScroll);
  return main;
}

// The menu is drawn again with every screen: put it back where it was scrolled, and only if the current item is then
// out of view (a direct link, a reload) move the menu just far enough to show it.
// `margin` leaves some room beside the item, as the menu may still grow a little (a count arrives later).
export function scrollToShow(scrollTop, viewHeight, itemTop, itemBottom, margin = 0) {
  if (itemTop < scrollTop) return Math.max(0, itemTop - margin);
  if (itemBottom > scrollTop + viewHeight) return itemBottom - viewHeight + margin;
  return scrollTop;
}

function keepMenuScroll(nav, saved) {
  if (!nav) return;
  nav.scrollTop = saved;
  const link = nav.querySelector('.nav-link[aria-current="page"]');
  if (!link || nav.clientHeight === 0) return;
  const navTop = nav.getBoundingClientRect().top;
  const box = link.getBoundingClientRect();
  nav.scrollTop = scrollToShow(nav.scrollTop, nav.clientHeight, box.top - navTop + nav.scrollTop, box.bottom - navTop + nav.scrollTop, 48);
}

// Pieces shared by every frame

function brand(href) {
  const parts = [el('span', { class: 'brand__mark' }, icon('journal')), el('span', { class: 'brand__name' }, t('app.name'))];
  return href ? el('a', { class: 'brand', href, onclick: closeDrawer }, parts) : el('p', { class: 'brand' }, parts);
}

function langSwitch(onLang) {
  return el('div', { class: 'segmented langs', role: 'group', 'aria-label': t('lang.label') }, LANGS.map((lang) => el('button', {
    type: 'button', id: 'lang-' + lang, class: 'segmented__button', lang,
    title: t('lang.name.' + lang), 'aria-pressed': String(lang === getLang()),
    onclick: () => onLang(lang),
  }, t('lang.short.' + lang))));
}

function themeToggle() {
  const dark = currentTheme() === 'dark';
  return iconButton({
    id: 'theme-toggle', iconName: dark ? 'sun' : 'moon', label: t(dark ? 'theme.toLight' : 'theme.toDark'),
    className: 'icon-button--outline', onClick: () => { toggleTheme(); refresh(); },
  });
}

const logoutButton = (onLogout, className) => iconButton({ id: 'logout', iconName: 'logout', label: t('common.logout'), className, onClick: onLogout });

// Sign-in and password change: a centred card under the name of the journal.
function authFrame(user, main, { onLang, onLogout }) {
  return el('div', { class: 'auth' },
    el('div', { class: 'auth__tools' }, langSwitch(onLang), themeToggle(), user ? logoutButton(onLogout, 'icon-button--outline') : null),
    el('div', { class: 'auth__center' }, brand(null), main));
}

// The student's phone: one compact bar, no sidebar.
function studentFrame(main, { onLang, onLogout }) {
  return el('div', { class: 'student' },
    el('header', { class: 'topbar topbar--student' },
      brand('#/'),
      el('div', { class: 'topbar__tools' }, langSwitch(onLang), themeToggle(), logoutButton(onLogout, 'icon-button--outline'))),
    main);
}

// Staff

// The menu item of a screen. The syllabus page of a subject and its form belong to the deanery's «Предметы», and to the
// teacher's «Мои предметы» (their home).
function currentName(view, params, role) {
  if (view === 'directory') return params.table;
  // A journal of a subject belongs to the list of journals.
  if (view === 'journal') return 'journalList';
  if (view === 'task') return 'tasks';
  if (view === 'ledger') return 'ledgerList';
  if (view === 'stateExam') return 'stateExams';
  if (view === 'journalLog') return menuParts(role).includes('office') ? 'journalLog' : 'journalList';
  if (view === 'syllabus' || view === 'syllabusForm') return menuParts(role).includes('office') ? 'subjects' : 'home';
  return view;
}

function staffFrame(user, view, params, main, { onLang, onLogout }) {
  const role = activeRole(user);
  const groups = navFor(user.permissions, role);
  const current = currentName(view, params, role);
  const body = el('div', { class: 'shell__body' }, topbar(groups, view, params, current, role, onLang), main);
  body.inert = drawerOpen;
  return el('div', { class: 'shell' + (drawerOpen ? ' is-drawer-open' : '') },
    el('a', { class: 'skip-link', href: '#app', onclick: (event) => { event.preventDefault(); main.focus(); } }, t('nav.skip')),
    el('aside', { class: 'sidebar', id: 'sidebar' },
      el('div', { class: 'sidebar__head' },
        brand('#/'),
        iconButton({ id: 'menu-close', iconName: 'close', label: t('nav.close'), className: 'sidebar__close', onClick: closeDrawer })),
      el('nav', { class: 'sidebar__nav', 'aria-label': t('nav.label') }, groups.map((group, i) => navGroup(group, i, current))),
      el('div', { class: 'sidebar__foot' }, roleSwitch(user, role), userBlock(user, role, onLogout))),
    el('div', { class: 'shell__backdrop', 'aria-hidden': 'true', onclick: closeDrawer }),
    body);
}

function navGroup(group, index, current) {
  const titleId = 'nav-group-' + index;
  return el('div', { class: 'nav-group' },
    group.titleKey ? el('p', { class: 'nav-group__title', id: titleId }, t(group.titleKey)) : null,
    el('ul', { class: 'nav-group__list', 'aria-labelledby': group.titleKey ? titleId : null }, group.items.map((item) => el('li', {},
      el('a', { class: 'nav-link', href: item.href, 'aria-current': item.name === current ? 'page' : null, onclick: closeDrawer },
        icon(item.icon), el('span', { class: 'nav-link__text' }, t(item.textKey)), item.count ? countBadge() : null)))));
}

// Several roles: a switcher that changes which menu is shown (and what the home screen offers).
function roleSwitch(user, active) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (roles.length < 2) return null;
  return el('div', { class: 'role-switch' },
    el('p', { class: 'role-switch__caption', id: 'role-caption' }, t('home.role')),
    el('div', { class: 'segmented segmented--wrap', role: 'group', 'aria-labelledby': 'role-caption' }, roles.map((role) => el('button', {
      type: 'button', id: 'role-' + role, class: 'segmented__button', 'aria-pressed': String(role === active),
      onclick: () => { setPref('role', role); refresh(); },
    }, t('role.' + role)))));
}

function userBlock(user, role, onLogout) {
  return el('div', { class: 'user' },
    avatar(user.fullName),
    el('div', { class: 'user__text' },
      el('p', { class: 'user__name' }, user.fullName),
      role ? el('p', { class: 'user__role' }, t('role.' + role)) : null),
    logoutButton(onLogout, 'user__logout'));
}

function topbar(groups, view, params, current, role, onLang) {
  return el('header', { class: 'topbar' },
    iconButton({
      id: 'menu-open', iconName: 'menu', label: t('nav.menu'), className: 'topbar__menu',
      onClick: () => setDrawer(true, false), attrs: { 'aria-controls': 'sidebar', 'aria-expanded': String(drawerOpen) },
    }),
    crumbs(groups, view, params, current, role),
    el('div', { class: 'topbar__tools' }, langSwitch(onLang), themeToggle()));
}

// Where the person is: the menu group and the page. A page opened by its address may be outside this role's menu.
function crumbs(groups, view, params, current, role) {
  let groupKey = null;
  let pageKey = null;
  // The syllabus of a subject and its form: under «Расписание» for the deanery, under the teacher's own subjects otherwise.
  if (view === 'syllabus' || view === 'syllabusForm') {
    [groupKey, pageKey] = [menuParts(role).includes('office') ? 'nav.schedule' : 'home.mySubjects', 'syllabus.title'];
  } else {
    for (const group of groups) {
      const item = group.items.find((candidate) => candidate.name === current);
      if (item) [groupKey, pageKey] = [group.titleKey, item.textKey];
    }
  }
  if (!pageKey) {
    if (view === 'directory') [groupKey, pageKey] = ['home.directories', 'dir.' + params.table];
    else if (view === 'import') [groupKey, pageKey] = ['nav.data', 'import.title'];
    else if (view === 'schedule') [groupKey, pageKey] = ['nav.schedule', 'schedule.title'];
    else if (view === 'settings') [groupKey, pageKey] = ['nav.schedule', 'settings.title'];
    else if (view === 'weekTemplate') [groupKey, pageKey] = ['nav.schedule', 'template.title'];
    else if (view === 'subjects') [groupKey, pageKey] = ['nav.schedule', 'subjects.title'];
    else if (view === 'review') [groupKey, pageKey] = ['nav.schedule', 'review.title'];
    else if (view === 'mySchedule') [groupKey, pageKey] = ['nav.teaching', 'my.title'];
    else if (view === 'journalLog') [groupKey, pageKey] = ['nav.journal', 'journalLog.title'];
    else if (view === 'journalList' || view === 'journal') [groupKey, pageKey] = ['nav.journal', 'journal.list.title'];
    else pageKey = 'nav.home';
  }
  // «Расписание › Расписание»: a page named like its group is one crumb.
  if (groupKey && t(groupKey) === t(pageKey)) groupKey = null;
  return el('p', { class: 'crumbs' },
    groupKey ? [el('span', { class: 'crumbs__group' }, t(groupKey)), icon('chevron', 'crumbs__sep')] : null,
    el('span', { class: 'crumbs__page' }, t(pageKey)));
}

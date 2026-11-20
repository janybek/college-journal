import { API_URL } from '../config.js';
import { call, onSessionEnd } from './api.js';
import { getToken, getUser, setSession, clearSession, getPref } from './session.js';
import { resolveRoute } from './router.js';
import { t, getLang, setLang, applyOverrides, onTextsChange, LANGS, DEFAULT_LANG } from './i18n.js';
import { el, onRefresh } from './ui.js';
import * as login from './views/login.js';
import * as changePassword from './views/changePassword.js';
import * as home from './views/home.js';
import * as placeholder from './views/placeholder.js';

// The app shell: the green cover band (title, language, sign-out) and the screen chosen by the router.
const VIEWS = { login, changePassword, home, directory: placeholder, import: placeholder };
const cover = document.getElementById('cover');
const app = document.getElementById('app');
let shownView = null;

const currentUser = () => (getToken() ? getUser() : null);

function renderCurrent() {
  const user = currentUser();
  const { view, params } = resolveRoute(location.hash, user);
  const sameView = view === shownView;
  const focus = sameView ? rememberFocus() : null;
  document.title = t('app.name');
  cover.dataset.view = view;
  cover.replaceChildren(coverBar(user));
  app.dataset.view = view;
  app.classList.toggle('is-entering', !sameView);
  shownView = view;
  app.replaceChildren();
  VIEWS[view].render(app, params);
  restoreFocus(focus);
}

function coverBar(user) {
  const title = user
    ? el('a', { class: 'cover__title', href: '#/' }, t('app.name'))
    : el('p', { class: 'cover__title' }, t('app.name'));
  return el('div', { class: 'cover__bar' }, title,
    el('div', { class: 'cover__tools' },
      el('div', { class: 'langs', role: 'group', 'aria-label': t('lang.label') }, LANGS.map((lang) => el('button', {
        type: 'button', id: 'lang-' + lang, class: 'langs__button', lang,
        title: t('lang.name.' + lang), 'aria-pressed': String(lang === getLang()),
        onclick: () => chooseLang(lang),
      }, t('lang.short.' + lang)))),
      user ? el('button', { type: 'button', id: 'logout', class: 'cover__logout', onclick: logout }, t('common.logout')) : null));
}

// Redraws at once; a signed-in person's choice is also saved to the account.
async function chooseLang(lang) {
  if (lang === getLang()) return;
  const user = currentUser();
  if (user) setSession({ token: getToken(), user: { ...user, lang } });
  setLang(lang);
  if (!user) return;
  try {
    const token = getToken();
    const data = await call('user.setLang', { lang });
    if (getToken() === token && getLang() === lang) setSession({ token, user: data.user });
  } catch (error) {
    // The choice stays on this device; an ended session has already returned to the sign-in screen.
  }
}

function logout() {
  clearSession();
  if (location.hash !== '' && location.hash !== '#/') history.replaceState(null, '', '#/');
  renderCurrent();
}

// Keeps focus (and the caret) on the same control when the same screen is redrawn, e.g. after a language switch.
function rememberFocus() {
  const active = document.activeElement;
  if (!active || !active.id) return null;
  let selection = null;
  try {
    if (typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd];
  } catch (error) { /* this input type has no caret */ }
  return { id: active.id, selection };
}

function restoreFocus(saved) {
  if (!saved) return;
  const target = document.getElementById(saved.id);
  if (!target || target === document.activeElement) return;
  target.focus({ preventScroll: true });
  if (saved.selection) {
    try { target.setSelectionRange(...saved.selection); } catch (error) { /* not a text field any more */ }
  }
}

// Refreshes the stored user in the background; the screen was already drawn from the stored copy.
async function refreshUser() {
  const token = getToken();
  try {
    const { user } = await call('auth.me', {});
    if (getToken() !== token) return;
    const before = JSON.stringify(getUser());
    setSession({ token, user });
    if (user.lang !== getLang()) setLang(user.lang);
    else if (JSON.stringify(user) !== before) renderCurrent();
  } catch (error) {
    // `unauthorized` has already led to the sign-in screen; on other errors the stored user stays.
  }
}

function start() {
  const user = currentUser();
  const lang = user ? user.lang : getPref('lang');
  setLang(LANGS.includes(lang) ? lang : DEFAULT_LANG);
  onTextsChange(renderCurrent);
  onSessionEnd(renderCurrent);
  onRefresh(renderCurrent);
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
  if (API_URL === '') return;
  // Texts from the «Переводы» sheet arrive later and never hold up the first screen.
  call('i18n.overrides', {}).then((data) => applyOverrides(data.rows), () => {});
  if (user) refreshUser();
}

start();

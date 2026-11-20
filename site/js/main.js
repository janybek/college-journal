import { API_URL } from '../config.js';
import { call, onSessionEnd } from './api.js';
import { getToken, getUser, setSession, clearSession, getPref, setPref } from './session.js';
import { resolveRoute } from './router.js';
import { t, getLang, setLang, pickLang, applyOverrides, onTextsChange, LANGS } from './i18n.js';
import { el, onRefresh, onSessionStart } from './ui.js';
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

// A click on the switcher is the person's explicit choice on this device: it is remembered, it wins over the
// account's language from now on, and a signed-in person's account learns it too.
function chooseLang(lang) {
  setPref('lang', lang);
  const user = currentUser();
  if (user && user.lang !== lang) saveLangToAccount(lang);
  setLang(lang);
}

async function saveLangToAccount(lang) {
  const token = getToken();
  const user = currentUser();
  if (!user) return;
  setSession({ token, user: { ...user, lang } });
  try {
    const data = await call('user.setLang', { lang });
    if (getToken() === token && getLang() === lang) setSession({ token, user: data.user });
  } catch (error) {
    // The choice stays on this device and is sent again on the next start; an ended session is handled in call().
  }
}

// Applies pickLang for a signed-in person. Returns true when the screen was redrawn in another language.
function settleLanguage(user) {
  const { lang, saveToAccount } = pickLang({ deviceLang: getPref('lang'), userLang: user.lang });
  if (saveToAccount) saveLangToAccount(lang);
  if (lang === getLang()) return false;
  setLang(lang);
  return true;
}

// A new session from sign-in or a password change: store it, settle the language, show the next screen.
function beginSession(data) {
  setSession(data);
  if (!settleLanguage(data.user)) renderCurrent();
}

// The server rejected the session (already cleared in call()): back to sign-in, with the reason.
function sessionEnded() {
  login.noteSessionEnded();
  renderCurrent();
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
    // The device's own choice is not overwritten by the server value; the account is told about it instead.
    if (!settleLanguage(user) && JSON.stringify(getUser()) !== before) renderCurrent();
  } catch (error) {
    // `unauthorized` has already led to the sign-in screen; on other errors the stored user stays.
  }
}

function start() {
  const user = currentUser();
  setLang(pickLang({ deviceLang: getPref('lang'), userLang: user ? user.lang : null }).lang);
  onTextsChange(renderCurrent);
  onSessionEnd(sessionEnded);
  onSessionStart(beginSession);
  onRefresh(renderCurrent);
  window.addEventListener('hashchange', renderCurrent);
  renderCurrent();
  if (API_URL === '') return;
  // Texts from the «Переводы» sheet arrive later and never hold up the first screen.
  call('i18n.overrides', {}).then((data) => applyOverrides(data.rows), () => {});
  if (user) refreshUser();
}

start();

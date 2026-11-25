import { API_URL } from '../config.js';
import { call, onSessionEnd } from './api.js';
import { getToken, getUser, setSession, clearSession, getPref, setPref } from './session.js';
import { resolveRoute } from './router.js';
import { t, getLang, setLang, pickLang, applyOverrides, onTextsChange } from './i18n.js';
import { onRefresh, onSessionStart, isLeaveHeld, mayLeave } from './ui.js';
import { renderShell } from './shell.js';
import * as login from './views/login.js';
import * as changePassword from './views/changePassword.js';
import * as home from './views/home.js';
import * as directory from './views/directory.js';
import * as importView from './views/import.js';
import * as settings from './views/settings.js';
import * as weekTemplate from './views/weekTemplate.js';
import * as schedule from './views/schedule.js';
import * as mySchedule from './views/mySchedule.js';
import * as syllabus from './views/syllabus.js';
import * as subjects from './views/subjects.js';
import * as syllabusForm from './views/syllabusForm.js';
import * as review from './views/review.js';
import * as journalList from './views/journalList.js';
import * as journal from './views/journal.js';
import * as journalLog from './views/journalLog.js';
import * as grades from './views/grades.js';
import * as lesson from './views/lesson.js';
import * as checkin from './views/checkin.js';
import * as tasks from './views/tasks.js';
import * as task from './views/task.js';
import * as ledgerList from './views/ledgerList.js';
import * as ledger from './views/ledger.js';
import * as dirCard from './views/dirCard.js';
import * as repeats from './views/repeats.js';
import * as repeat from './views/repeat.js';
import * as requests from './views/requests.js';
import * as stateExams from './views/stateExams.js';
import * as stateExam from './views/stateExam.js';
import * as announcements from './views/announcements.js';
import { readQrLink } from './lesson.js';
import { deviceId, keepPass, keepPassNote } from './device.js';
import { refreshReviewCount } from './reviewCount.js';

// Puts the screen chosen by the router into its frame (shell.js: sign-in card, student bar or staff sidebar).
// A screen may export leave(): it is called when another screen replaces it, to drop what it held.
const VIEWS = { login, changePassword, home, directory, dirCard, import: importView, settings, weekTemplate, schedule, mySchedule, syllabus, subjects, syllabusForm, review, journalList, journal, journalLog, grades, lesson, checkin, tasks, task, ledgerList, ledger, repeats, repeat, requests, stateExams, stateExam, announcements };
const page = document.getElementById('page');
let shownView = null;
let shownHash = location.hash;

const currentUser = () => (getToken() ? getUser() : null);

function renderCurrent() {
  const user = currentUser();
  const { view, params } = resolveRoute(location.hash, user);
  const sameView = view === shownView;
  if (!sameView && shownView !== null && VIEWS[shownView].leave) VIEWS[shownView].leave();
  shownHash = location.hash;
  const focus = sameView ? rememberFocus() : null;
  document.title = t('app.name');
  const app = renderShell(page, { user, view, params }, { onLang: chooseLang, onLogout: logout });
  app.dataset.view = view;
  app.classList.toggle('is-entering', !sameView);
  shownView = view;
  VIEWS[view].render(app, params);
  restoreFocus(focus);
  askReviewCount(user);
}

// The number of the menu item «Силлабусы на утверждении»: read once per opening of the site (per session), by those
// who have the queue.
let reviewCountAsked = null;
function askReviewCount(user) {
  const token = getToken();
  if (!user || token === reviewCountAsked || !Array.isArray(user.permissions) || !user.permissions.includes('syllabus.queue')) return;
  reviewCountAsked = token;
  refreshReviewCount();
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

// A link or the Back button changed the address. If the screen holds something it cannot show again, the
// address goes back while it asks; after "leave" the person goes where they were heading. A screen that stays on
// the same work at the new address (another tab of the same syllabus form: keepsHold) is not left.
async function hashChanged() {
  takeQrLink();
  if (!isLeaveHeld() || location.hash === shownHash || staysOnWork()) {
    renderCurrent();
    return;
  }
  const target = location.hash;
  history.replaceState(null, '', shownHash);
  if (await mayLeave()) location.hash = target;
}

function staysOnWork() {
  const next = resolveRoute(location.hash, currentUser());
  return next.view === shownView && typeof VIEWS[shownView].keepsHold === 'function' && VIEWS[shownView].keepsHold(next.params);
}

// A QR link (#/q/<pair>/<key>): the address becomes #/here at once (the key stays neither in the address bar nor in
// the history) and the screen is drawn; the key is exchanged for a pass in the background, with no sign-in needed,
// so a slow network shows «Загрузка…», not a blank page. When the exchange ends, the check-in screen starts afresh
// and takes the pass (or the note of why there is none). A staff member just goes home.
function takeQrLink() {
  const link = readQrLink(location.hash);
  if (!link) return;
  const user = currentUser();
  const student = Boolean(user) && Array.isArray(user.permissions) && user.permissions.includes('checkin.mark');
  history.replaceState(null, '', user && !student ? '#/' : '#/here');
  if (user && !student) return;
  exchangeQrLink(link).then(() => {
    if (shownView === 'checkin') VIEWS.checkin.leave();
    if (shownView !== null) renderCurrent();
  });
}

async function exchangeQrLink(link) {
  try {
    const data = await call('checkin.pass', { pairId: link.pairId, qr: link.qr, device: deviceId() });
    keepPass({ pairId: link.pairId, pass: data.pass });
  } catch (error) {
    keepPassNote(['network', 'server_down', 'internal', 'not_configured'].includes(error.code) ? 'checkin.qrOffline'
      : error.code === 'window_closed' || error.code === 'not_running' ? 'error.window_closed' : 'checkin.qrStale');
  }
}

async function logout() {
  if (!(await mayLeave())) return;
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

async function start() {
  takeQrLink();
  const user = currentUser();
  setLang(pickLang({ deviceLang: getPref('lang'), userLang: user ? user.lang : null }).lang);
  onTextsChange(renderCurrent);
  onSessionEnd(sessionEnded);
  onSessionStart(beginSession);
  onRefresh(renderCurrent);
  window.addEventListener('hashchange', hashChanged);
  renderCurrent();
  if (API_URL === '') return;
  // Texts from the «Переводы» sheet arrive later and never hold up the first screen.
  call('i18n.overrides', {}).then((data) => applyOverrides(data.rows), () => {});
  if (user) refreshUser();
}

start();

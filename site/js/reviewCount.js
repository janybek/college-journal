import { getToken, getUser } from './session.js';

// The number beside «Документы» in the menu: the versions of syllabi under review. Read with one light request
// (syllabus.queue { countOnly }) once per opening of the site, and again after a version is approved or returned;
// «Предметы» puts in the number of its own answer. The number belongs to the session it was read in.
// Whoever draws it subscribes with onReviewCount: a new number changes the menu in place, not the screen under it.
// The menu (shell.js) reads this file in the tests too, so the request module is loaded only when a number is asked for.

let known = { token: null, n: null };
const listeners = new Set();

// The last number known in this session, or null.
export function reviewCount() {
  return known.token !== null && known.token === getToken() ? known.n : null;
}

export function setReviewCount(n) {
  if (!Number.isInteger(n) || n < 0) return;
  const before = reviewCount();
  known = { token: getToken(), n };
  if (before !== n) for (const listener of listeners) listener(n);
}

// Only someone with the queue (syllabus.queue) asks: a teacher who sends a version sends no request at all. A failed
// request leaves the number as it was.
export async function refreshReviewCount() {
  const token = getToken();
  const user = getUser();
  if (token === null || !user || !Array.isArray(user.permissions) || !user.permissions.includes('syllabus.queue')) return;
  try {
    const { call } = await import('./api.js');
    const { count } = await call('syllabus.queue', { countOnly: true });
    if (getToken() === token) setReviewCount(count);
  } catch (error) { /* the number stays */ }
}

export function onReviewCount(listener) {
  listeners.add(listener);
}

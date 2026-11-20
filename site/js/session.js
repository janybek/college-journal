// Session and device preferences in localStorage. Every access is guarded: a blocked storage
// (private mode, disabled cookies) must not break the page, so values are mirrored in memory.
const KEYS = { token: 'journal.token', user: 'journal.user', lang: 'journal.lang', role: 'journal.role', theme: 'journal.theme' };
const memory = new Map();

function read(key) {
  try {
    return globalThis.localStorage.getItem(key);
  } catch (error) {
    return memory.has(key) ? memory.get(key) : null;
  }
}

function write(key, value) {
  memory.set(key, value);
  try {
    if (value === null) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
  } catch (error) { /* storage unavailable: the in-memory copy still serves this page */ }
}

export function getToken() {
  return read(KEYS.token);
}

export function getUser() {
  try {
    const user = JSON.parse(read(KEYS.user));
    return user !== null && typeof user === 'object' && !Array.isArray(user) ? user : null;
  } catch (error) {
    return null;
  }
}

export function setSession({ token, user }) {
  write(KEYS.token, token);
  write(KEYS.user, JSON.stringify(user));
}

export function clearSession() {
  write(KEYS.token, null);
  write(KEYS.user, null);
}

// Device preferences that outlive a session: 'lang' (language before login), 'role' (chosen staff role) and
// 'theme' (light or dark look).
export function getPref(name) {
  return read(KEYS[name]);
}

export function setPref(name, value) {
  write(KEYS[name], value);
}

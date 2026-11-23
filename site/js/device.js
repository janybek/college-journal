import { getPref, setPref } from './session.js';

// The number of this device for the check-in (one phone, one student per pair) and the pass a QR link gives
// on its way to the check-in screen. The pass lives only in the page's memory and sessionStorage.
const DEVICE = /^[0-9a-f]{32}$/;
const PASS_KEY = 'journal.pass';
const NOTE_KEY = 'journal.passNote';
const memory = new Map();

function fresh() {
  const bytes = new Uint8Array(16);
  const random = globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function' ? globalThis.crypto : null;
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = random ? 0 : Math.floor(Math.random() * 256);
  if (random) random.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 32 hex characters: made once on the first call, then kept in the device preferences.
export function deviceId() {
  const saved = getPref('device');
  if (typeof saved === 'string' && DEVICE.test(saved)) return saved;
  const id = fresh();
  setPref('device', id);
  return id;
}

function put(key, value) {
  memory.set(key, value);
  try { globalThis.sessionStorage.setItem(key, value); } catch (error) { /* the copy in memory serves this page */ }
}

function read(key) {
  if (memory.has(key)) return memory.get(key);
  try { return globalThis.sessionStorage.getItem(key); } catch (error) { return null; }
}

function drop(key) {
  memory.delete(key);
  try { globalThis.sessionStorage.removeItem(key); } catch (error) { /* nothing was stored */ }
}

// The pass of a QR link, kept until the person is signed in and on the check-in screen.
export function keepPass({ pairId, pass }) {
  put(PASS_KEY, JSON.stringify({ pairId, pass }));
}

// The pass kept for this pair (and forgotten); null when there is none or it is for another pair.
export function takePass(pairId) {
  let kept = null;
  try { kept = JSON.parse(read(PASS_KEY)); } catch (error) { kept = null; }
  if (kept === null || typeof kept !== 'object' || kept.pairId !== pairId || typeof kept.pass !== 'string') return null;
  drop(PASS_KEY);
  return kept.pass;
}

// Why a QR link gave no pass: the key of the text the check-in screen shows (read once).
export function keepPassNote(key) {
  put(NOTE_KEY, key);
}

export function takePassNote() {
  const key = read(NOTE_KEY);
  drop(NOTE_KEY);
  return typeof key === 'string' && key !== '' ? key : null;
}

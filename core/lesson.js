import { localDate, localTime, minutesOf, addMinutes, parseLocalDateTime } from './dates.js';
import { PAIR_MINUTES } from './settings.js';
import { constantTimeEqual } from './auth.js';

export const LESSON = Object.freeze({ checkinMinutes: 5, stepSeconds: 15, wrongCodes: 5, expiredSteps: 4, startEarlyMinutes: 10, autoCloseMinutes: PAIR_MINUTES });
export const LESSON_CLEAR = Object.freeze({ startedAt: '', startedBy: '', checkinUntil: '', checkinClosed: false, finishedAt: '', finishedBy: '' });

const MIN_MS = 60000;

// null | 'running' | 'pair_locked' | 'start_early' | 'start_late'
export function startProblem(pair, nowMs) {
  if (pair.status === 'running') return 'running';
  if (pair.status !== 'planned') return 'pair_locked';
  const today = localDate(nowMs);
  if (pair.date > today) return 'start_early';
  if (pair.date < today) return 'start_late';
  const nowSec = minutesOf(localTime(nowMs)) * 60 + Math.floor((nowMs % MIN_MS + MIN_MS) % MIN_MS / 1000);
  const startSec = minutesOf(pair.startTime) * 60;
  if (nowSec < startSec - LESSON.startEarlyMinutes * 60) return 'start_early';
  if (nowSec >= startSec + LESSON.autoCloseMinutes * 60) return 'start_late';
  return null;
}

// 'HH:MM': the earliest minute a pair may be started.
export function startFrom(pair) {
  return addMinutes(pair.startTime, -LESSON.startEarlyMinutes);
}

export function lessonClock(pair, nowMs) {
  const none = { phase: 'none', startedMs: null, checkinEndMs: null, closeMs: null, checkinLeftMs: null, lessonLeftMs: null, step: null, msToNext: null };
  const started = pair.startedAt ? parseLocalDateTime(pair.startedAt) : NaN;
  if (Number.isNaN(started)) return none;
  if (pair.status !== 'running' && pair.status !== 'closed') return none;
  const parsedEnd = parseLocalDateTime(pair.checkinUntil);
  const checkinEndMs = Number.isNaN(parsedEnd) ? null : parsedEnd;
  const closeMs = started + LESSON.autoCloseMinutes * MIN_MS;
  const stepMs = LESSON.stepSeconds * 1000;
  const elapsed = nowMs - started;
  let phase;
  if (pair.status === 'closed' || nowMs >= closeMs) phase = 'over';
  else if (!pair.checkinClosed && checkinEndMs !== null && nowMs < checkinEndMs) phase = 'checkin';
  else phase = 'lesson';
  return {
    phase,
    startedMs: started,
    checkinEndMs,
    closeMs,
    checkinLeftMs: checkinEndMs === null ? 0 : Math.max(0, checkinEndMs - nowMs),
    lessonLeftMs: Math.max(0, closeMs - nowMs),
    step: Math.max(0, Math.floor(elapsed / stepMs)),
    msToNext: stepMs - (((elapsed % stepMs) + stepMs) % stepMs),
  };
}

// 64 hex. Not stored anywhere: derived from the server secret at every request.
export function pairKey(platform, pair) {
  return platform.hmacSha256Hex(platform.secret(), 'lesson:' + pair.id + ':' + pair.startedAt);
}

export function codeAt(platform, key, step) {
  return String(parseInt(platform.hmacSha256Hex(key, 'code:' + step).slice(0, 8), 16) % 10000).padStart(4, '0');
}

export function qrAt(platform, key, step) {
  return platform.hmacSha256Hex(key, 'qr:' + step).slice(0, 16);
}

// 'ok' | 'expired' | 'wrong'. The check-in window is checked by the handler, not here.
export function matchCode(platform, pair, kind, value, nowMs) {
  if (typeof value !== 'string' || pair.status !== 'running') return 'wrong';
  let make;
  if (kind === 'code' && /^\d{4}$/.test(value)) make = codeAt;
  else if (kind === 'qr' && /^[0-9a-f]{16}$/.test(value)) make = qrAt;
  else return 'wrong';
  const step = lessonClock(pair, nowMs).step;
  if (step === null) return 'wrong';
  const key = pairKey(platform, pair);
  const is = (s) => constantTimeEqual(make(platform, key, s), value);
  if (is(step) || (step >= 1 && is(step - 1))) return 'ok';
  for (let s = step - 2; s >= Math.max(0, step - LESSON.expiredSteps); s--) if (is(s)) return 'expired';
  return 'wrong';
}

export function isDevice(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

const PASS_PREFIX = 'pass1.';

export function issuePass(platform, { pairId, device, exp }) {
  const body = encodeURIComponent(JSON.stringify({ pid: pairId, dev: device, exp }));
  return PASS_PREFIX + body + '.' + platform.hmacSha256Hex(platform.secret(), 'pass:' + body);
}

// { pairId, device, exp } or null; never throws.
export function readPass(platform, pass, nowMs) {
  try {
    if (typeof pass !== 'string' || !pass.startsWith(PASS_PREFIX)) return null;
    const rest = pass.slice(PASS_PREFIX.length);
    const dot = rest.lastIndexOf('.');
    if (dot < 0) return null;
    const body = rest.slice(0, dot);
    if (!constantTimeEqual(platform.hmacSha256Hex(platform.secret(), 'pass:' + body), rest.slice(dot + 1))) return null;
    const data = JSON.parse(decodeURIComponent(body));
    if (data === null || typeof data !== 'object') return null;
    const { pid, dev, exp } = data;
    if (typeof pid !== 'string' || typeof dev !== 'string') return null;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= nowMs) return null;
    return { pairId: pid, device: dev, exp };
  } catch (error) {
    return null;
  }
}

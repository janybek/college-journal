import { localDate, localTime, minutesOf, addMinutes, parseLocalDateTime } from './dates.js';
import { PAIR_MINUTES } from './settings.js';

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
  const checkinEndMs = parseLocalDateTime(pair.checkinUntil);
  const closeMs = started + LESSON.autoCloseMinutes * MIN_MS;
  const stepMs = LESSON.stepSeconds * 1000;
  const elapsed = nowMs - started;
  let phase;
  if (pair.status === 'closed' || nowMs >= closeMs) phase = 'over';
  else if (!pair.checkinClosed && nowMs < checkinEndMs) phase = 'checkin';
  else phase = 'lesson';
  return {
    phase,
    startedMs: started,
    checkinEndMs,
    closeMs,
    checkinLeftMs: Math.max(0, checkinEndMs - nowMs),
    lessonLeftMs: Math.max(0, closeMs - nowMs),
    step: Math.max(0, Math.floor(elapsed / stepMs)),
    msToNext: stepMs - (((elapsed % stepMs) + stepMs) % stepMs),
  };
}

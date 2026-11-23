import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDateTime } from '../core/dates.js';
import { startProblem, startFrom, lessonClock } from '../core/lesson.js';

const B = (time, date = '2026-09-22') => parseLocalDateTime(`${date} ${time}`);
const P = { id: 'p1', date: '2026-09-22', startTime: '08:00', status: 'planned' };
const R = { ...P, status: 'running', startedAt: '2026-09-22 07:58:00', checkinUntil: '2026-09-22 08:03:00', checkinClosed: false };

test('startProblem: window from 10 minutes before to the end of the pair', () => {
  assert.deepEqual([B('07:49:59'), B('07:50:00'), B('09:29:59'), B('09:30:00')].map((ms) => startProblem(P, ms)), ['start_early', null, null, 'start_late']);
  assert.deepEqual([startProblem(P, B('08:00:00', '2026-09-21')), startProblem(P, B('07:55:00', '2026-09-23'))], ['start_early', 'start_late']);
  assert.deepEqual(['closed', 'cancelled', 'missed', 'running'].map((status) => startProblem({ ...P, status }, B('08:00:00'))), ['pair_locked', 'pair_locked', 'pair_locked', 'running']);
  assert.equal(startFrom(P), '07:50');
});

test('lessonClock: phases, steps and time left', () => {
  assert.deepEqual(lessonClock(R, B('07:58:14')), { phase: 'checkin', startedMs: B('07:58:00'), checkinEndMs: B('08:03:00'), closeMs: B('09:28:00'),
    checkinLeftMs: 286000, lessonLeftMs: 5386000, step: 0, msToNext: 1000 });
  assert.deepEqual([lessonClock(R, B('07:58:15')).step, lessonClock(R, B('07:58:15')).msToNext, lessonClock(R, B('07:59:15')).step], [1, 15000, 5]);
  assert.deepEqual([lessonClock(R, B('08:02:59')).phase, lessonClock(R, B('08:03:00')).phase, lessonClock(R, B('08:03:00')).checkinLeftMs], ['checkin', 'lesson', 0]);
  assert.equal(lessonClock({ ...R, checkinClosed: true }, B('08:00:00')).phase, 'lesson');
  assert.deepEqual([lessonClock(R, B('09:27:59')).phase, lessonClock(R, B('09:28:00')).phase, lessonClock(R, B('10:00:00')).lessonLeftMs], ['lesson', 'over', 0]);
  assert.deepEqual([lessonClock(P, B('08:00:00')).phase, lessonClock(P, B('08:00:00')).step], ['none', null]);
  assert.equal(lessonClock({ ...R, status: 'closed' }, B('08:30:00')).phase, 'over');
});

test('lessonClock: a closed pair with an unreadable checkinUntil has no NaN', () => {
  const c = lessonClock({ ...R, status: 'closed', checkinUntil: '' }, B('08:30:00'));
  assert.deepEqual([c.checkinEndMs, c.checkinLeftMs, c.phase], [null, 0, 'over']);
});

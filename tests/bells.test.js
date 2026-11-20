import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BELL_FIRST, BELL_LAST, BELL_STEP, bellTimes, bellOptions, nextBell } from '../site/js/bells.js';
import { isTime, minutesOf } from '../core/dates.js';
import { DEFAULT_BELLS, PAIR_MINUTES, validateSettings } from '../core/settings.js';

// The bell time is picked from a list, so 02:00 instead of 14:00 cannot be typed.

test('the list runs from 07:00 to 22:25 every 5 minutes, and every time in it passes the server check', () => {
  const times = bellTimes();
  assert.equal(times.length, 186);
  assert.deepEqual([times[0], times[1], times[185]], [BELL_FIRST, '07:05', BELL_LAST]);
  for (const time of times) assert.ok(isTime(time) && minutesOf(time) % BELL_STEP === 0 && minutesOf(time) + PAIR_MINUTES <= 23 * 60 + 59, time);
  for (const time of DEFAULT_BELLS) assert.ok(times.includes(time), time);
  assert.equal(times.includes('02:00'), false);                                  // замечание владельца: 02:00 вместо 14:00 выбрать нельзя
  assert.deepEqual(validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: [BELL_LAST] }).errors, []);
});

test('bellOptions: the list, with a saved time that is not on it shown first and marked', () => {
  const times = bellTimes();
  assert.deepEqual(bellOptions('08:00'), times.map((value) => ({ value, offList: false })));
  assert.deepEqual(bellOptions(''), bellOptions('08:00'));
  assert.equal(bellOptions('мусор').length, 186);
  // Review Focus 12
  assert.deepEqual(bellOptions('08:02').slice(0, 2), [{ value: '08:02', offList: true }, { value: '07:00', offList: false }]);
  assert.equal(bellOptions('08:02').length, 187);
  assert.deepEqual(bellOptions('06:30')[0], { value: '06:30', offList: true });  // раньше начала списка
  assert.deepEqual(bellOptions('22:29')[0], { value: '22:29', offList: true });  // позже конца списка
});

test('nextBell: the first time on the list after the last class and a break, or nothing', () => {
  assert.equal(nextBell('16:50', 90, 10), '18:30');
  assert.equal(nextBell('08:02', 90, 10), '09:45');                              // 09:42 в списке нет — ближайшее следующее
  assert.equal(nextBell('20:45', 90, 10), '22:25');
  assert.equal(nextBell('20:50', 90, 10), '');
  assert.equal(nextBell('', 90, 10), '');
});

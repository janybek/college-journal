import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, isDate, addDays, daysBetween, weekday, mondayOf, isTime, minutesOf, addMinutes } from '../core/dates.js';

test('localDate: Bishkek midnight is 18:00 UTC of the day before', () => {
  assert.equal(localDate(Date.UTC(2026, 10, 20, 18, 0)), '2026-11-21');
  assert.equal(localDate(Date.UTC(2026, 10, 20, 17, 59)), '2026-11-20');
});

test('date helpers', () => {
  assert.equal(isDate('2026-02-28'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) assert.equal(isDate(bad), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-09-01', '2026-09-11'), 10);
  assert.deepEqual(['2026-11-16', '2026-11-21', '2026-09-06'].map(weekday), [1, 6, 7]);
  assert.equal(mondayOf('2026-11-21'), '2026-11-16');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
});

test('time helpers', () => {
  assert.equal(isTime('08:00'), true);
  for (const bad of ['8:00', '24:00', '08:60', '0800', '']) assert.equal(isTime(bad), false);
  assert.equal(minutesOf('09:40'), 580);
  assert.equal(addMinutes('08:00', 90), '09:30');
});

test('localTime and localDateTime: Bishkek clock', async () => {
  const { localTime, localDateTime } = await import('../core/dates.js');
  assert.equal(localTime(Date.UTC(2026, 8, 7, 18, 30)), '00:30');
  assert.equal(localDateTime(Date.UTC(2026, 8, 7, 18, 30, 5)), '2026-09-08 00:30:05');
});

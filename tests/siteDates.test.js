import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as site from '../site/js/dates.js';
import * as core from '../core/dates.js';

// The site cannot load core/, so site/js/dates.js copies what it needs; these checks keep both equal.

test('site date helpers give the same answers as core/dates.js', () => {
  for (const d of ['2026-01-01', '2026-02-28', '2026-11-21', '2026-12-31', '2028-02-29']) {
    assert.equal(site.weekday(d), core.weekday(d));
    assert.equal(site.mondayOf(d), core.mondayOf(d));
    assert.equal(site.addDays(d, 1), core.addDays(d, 1));
    assert.equal(site.addDays(d, -1), core.addDays(d, -1));
    assert.equal(site.isDate(d), core.isDate(d));
  }
  // The same bad values as in tests/dates.test.js.
  for (const v of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) assert.equal(site.isDate(v), core.isDate(v), String(v));
});

test('site time helpers give the same answers as core/dates.js', () => {
  for (const [time, n] of [['08:00', 90], ['09:40', 90], ['22:29', 90], ['00:00', 0], ['11:20', 130]]) {
    assert.equal(site.addMinutes(time, n), core.addMinutes(time, n), time);
  }
  for (const v of ['08:00', '23:59', '8:00', '24:00', '08:60', '0800', '', null]) assert.equal(site.isTime(v), core.isTime(v), String(v));
  for (const time of ['00:00', '09:40', '23:59']) assert.equal(site.minutesOf(time), core.minutesOf(time), time);
  assert.equal(site.addMinutes('08:00', 90), '09:30');
});

test('dayParts splits a date into numbers for the dictionaries', () => {
  assert.deepEqual(site.dayParts('2026-11-21'), { day: 21, month: 11, weekday: 6 });
  assert.deepEqual(site.dayParts('2026-01-05'), { day: 5, month: 1, weekday: 1 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate } from '../core/dates.js';

test('localDate: Bishkek midnight is 18:00 UTC of the day before', () => {
  assert.equal(localDate(Date.UTC(2026, 10, 20, 18, 0)), '2026-11-21');
  assert.equal(localDate(Date.UTC(2026, 10, 20, 17, 59)), '2026-11-20');
});

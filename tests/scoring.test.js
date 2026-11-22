import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME, SCHEME_FIELDS, SCHEME_KEYS, REASON_MAX, validateScheme, readScheme, schemeToRows } from '../core/scoring.js';

test('validateScheme: default scheme is valid, strings are trimmed to numbers', () => {
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME }), { value: { ...DEFAULT_SCHEME }, errors: [] });
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, attendance: ' 25 ' }).value.attendance, 25);
});

test('validateScheme: cross-field rules', () => {
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, control: 30 }).errors, [{ field: 'control', code: 'sum' }]);
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, current: 50, self: 20, control: 30, minimum: 31 }).errors, [{ field: 'minimum', code: 'too_big' }]);
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, good: 60 }).errors, [{ field: 'good', code: 'order' }]);
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, excellent: 101 }).errors, [{ field: 'excellent', code: 'bad_value' }]);
});

test('validateScheme: bad values, order of errors, null input', () => {
  assert.deepEqual(validateScheme({ ...DEFAULT_SCHEME, activity: 2.5, editDays: -1, attendance: [20] }).errors.map((e) => e.field), ['attendance', 'activity', 'editDays']);
  assert.deepEqual(validateScheme(null).errors.length, 10);
});

test('readScheme and schemeToRows', () => {
  assert.deepEqual(readScheme([]), { ...DEFAULT_SCHEME });
  assert.deepEqual(readScheme([{ key: 'scoreAttendance', value: '25' }, { key: 'semester', value: '2' }]).attendance, 25);
  assert.deepEqual(readScheme([{ key: 'scoreControl', value: '30' }]), { ...DEFAULT_SCHEME });
  assert.deepEqual(readScheme([{ key: 'scoreActivity', value: 'десять' }]).activity, 10);
  assert.deepEqual(readScheme(schemeToRows({ ...DEFAULT_SCHEME, editDays: 7 })).editDays, 7);
  assert.deepEqual(schemeToRows(DEFAULT_SCHEME)[0], { key: 'scoreAttendance', value: '20' });
  assert.deepEqual(schemeToRows(DEFAULT_SCHEME).map((r) => r.key), SCHEME_FIELDS.map((f) => SCHEME_KEYS[f]));
  assert.equal(REASON_MAX, 300);
});

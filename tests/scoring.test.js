import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SCHEME, SCHEME_FIELDS, SCHEME_KEYS, REASON_MAX, validateScheme, readScheme, schemeToRows,
  DEFAULT_SPLIT, validateSplit, readSplit, splitToRows, upgradeScheme,
} from '../core/scoring.js';

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

test('regulation 2.9: the good threshold is 80', () => {
  assert.equal(DEFAULT_SCHEME.good, 80);
  assert.equal(validateScheme(null).errors.length, 10);
});

test('validateSplit', () => {
  assert.deepEqual(validateSplit({ ...DEFAULT_SPLIT }), { value: { semester: 60, exam: 40, admission: 30 }, errors: [] });
  assert.deepEqual(validateSplit({ semester: ' 50 ', exam: '50', admission: 25 }).value, { semester: 50, exam: 50, admission: 25 });
  assert.deepEqual(validateSplit({ semester: 60, exam: 30, admission: 30 }).errors, [{ field: 'exam', code: 'sum' }]);
  assert.deepEqual(validateSplit({ semester: 60, exam: 40, admission: 60 }).errors, [{ field: 'admission', code: 'too_big' }]);
  assert.deepEqual(validateSplit({ semester: 0, exam: 100, admission: 0 }).errors, [{ field: 'semester', code: 'bad_value' }, { field: 'exam', code: 'bad_value' }]);
  assert.deepEqual(validateSplit({ semester: 60.5, exam: [40], admission: -1 }).errors.map((e) => e.field), ['semester', 'exam', 'admission']);
  assert.equal(validateSplit(null).errors.length, 3);
});

test('readSplit and splitToRows', () => {
  const K = (key, value, id = 'cfg_' + key) => ({ id, key, value });
  assert.deepEqual(readSplit([]), { ...DEFAULT_SPLIT });
  assert.deepEqual(readSplit([K('scoreSemester', '50'), K('scoreExam', '50'), K('scoreAdmission', '25'), K('semester', '2')]), { semester: 50, exam: 50, admission: 25 });
  assert.deepEqual(readSplit([K('scoreSemester', '70')]), { ...DEFAULT_SPLIT });
  assert.deepEqual(readSplit([K('scoreAdmission', 'тридцать')]).admission, 30);
  assert.deepEqual(splitToRows(DEFAULT_SPLIT), [{ key: 'scoreSemester', value: '60' }, { key: 'scoreExam', value: '40' }, { key: 'scoreAdmission', value: '30' }]);
  assert.deepEqual(readSplit(splitToRows({ semester: 50, exam: 50, admission: 25 })), { semester: 50, exam: 50, admission: 25 });
});

test('upgradeScheme: a saved scheme moves to regulation 2.9', () => {
  const K = (key, value, id = 'cfg_' + key) => ({ id, key, value });
  const none = { updates: [], inserts: [] };
  const saved = (over = {}) => schemeToRows({ ...DEFAULT_SCHEME, good: 76, ...over }).map((r) => K(r.key, r.value));
  assert.deepEqual(upgradeScheme([]), none);
  assert.deepEqual(upgradeScheme([K('semesterStart', '2026-09-01'), K('semester', '1')]), none);
  assert.deepEqual(upgradeScheme(saved()), { updates: [{ id: 'cfg_scoreGood', patch: { value: '80' } }], inserts: splitToRows(DEFAULT_SPLIT) });
  assert.deepEqual(upgradeScheme(saved({ good: 75 })), { updates: [], inserts: splitToRows(DEFAULT_SPLIT) });
  assert.deepEqual(upgradeScheme(saved({ excellent: 78 })), { updates: [], inserts: splitToRows(DEFAULT_SPLIT) });
  assert.deepEqual(upgradeScheme([...saved(), K('scoreExam', '40')]), none);
  const moved = saved().map((r) => (r.key === 'scoreGood' ? { ...r, value: '80' } : r)).concat(splitToRows(DEFAULT_SPLIT).map((r) => K(r.key, r.value)));
  assert.deepEqual(upgradeScheme(moved), none);
});

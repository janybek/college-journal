import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSettings, validateSettings, settingsToRows, DEFAULT_BELLS } from '../core/settings.js';

test('readSettings: defaults and bad values', () => {
  assert.deepEqual(readSettings([]), { semesterStart: '', semesterEnd: '', holidays: [], bells: DEFAULT_BELLS, semester: 1 });
  assert.deepEqual(readSettings([{ key: 'semesterStart', value: '2026-09-01' }, { key: 'holidays', value: '2026-11-07,2026-09-07' },
    { key: 'bells', value: 'мусор' }, { key: 'чужой', value: '1' }]),
  { semesterStart: '2026-09-01', semesterEnd: '', holidays: ['2026-09-07', '2026-11-07'], bells: DEFAULT_BELLS, semester: 1 });
  assert.equal(readSettings([{ key: 'semester', value: '2' }]).semester, 2);
  for (const bad of ['3', 'два', '', '0']) assert.equal(readSettings([{ key: 'semester', value: bad }]).semester, 1, bad);
});

test('validateSettings: ok value and rows', () => {
  const ok = validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: ['2026-11-07', '2026-09-07', '2026-11-07'], bells: ['08:00', '09:30'] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.value.holidays, ['2026-09-07', '2026-11-07']);
  assert.deepEqual(settingsToRows(ok.value), [{ key: 'semesterStart', value: '2026-09-01' }, { key: 'semesterEnd', value: '2026-12-25' },
    { key: 'holidays', value: '2026-09-07,2026-11-07' }, { key: 'bells', value: '08:00,09:30' }]);
});

test('validateSettings: errors', () => {
  assert.deepEqual(validateSettings({}).errors, [{ field: 'semesterStart', code: 'required' }, { field: 'semesterEnd', code: 'required' },
    { field: 'holidays', code: 'bad_value' }, { field: 'bells', code: 'bad_value' }]);
  const errorsOf = (patch) => validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: DEFAULT_BELLS, ...patch }).errors;
  assert.deepEqual(errorsOf({}), []);
  assert.deepEqual(errorsOf({ semesterEnd: '2026-08-31' }), [{ field: 'semesterEnd', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ semesterEnd: '2027-06-01' }), [{ field: 'semesterEnd', code: 'too_long' }]);
  assert.deepEqual(errorsOf({ semesterStart: 'x' }), [{ field: 'semesterStart', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ holidays: ['7 ноября'] }), [{ field: 'holidays', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ bells: ['08:00', '09:29'] }), [{ field: 'bells', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ bells: ['23:00'] }), [{ field: 'bells', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ bells: ['22:29'] }), []);
  assert.deepEqual(errorsOf({ bells: ['22:30'] }), [{ field: 'bells', code: 'bad_value' }]);
  assert.deepEqual(errorsOf({ bells: [] }), [{ field: 'bells', code: 'bad_value' }]);
  const nine = Array.from({ length: 9 }, (_, i) => `${String(6 + i * 2).padStart(2, '0')}:00`);
  assert.deepEqual(errorsOf({ bells: nine }), [{ field: 'bells', code: 'bad_value' }]);
  const days = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
  assert.deepEqual(errorsOf({ holidays: days(61) }), [{ field: 'holidays', code: 'too_long' }]);
  assert.deepEqual(errorsOf({ holidays: days(60) }), []);
});

test('validateSettings: semester', () => {
  const base = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: ['08:00', '09:40'] };
  assert.equal(validateSettings({ ...base, semester: 2 }).value.semester, 2);
  assert.equal(validateSettings({ ...base, semester: '1' }).value.semester, 1);
  assert.deepEqual(settingsToRows(validateSettings({ ...base, semester: 2 }).value).at(-1), { key: 'semester', value: '2' });
  // not sent: no error and no row
  assert.deepEqual(validateSettings(base).errors, []);
  assert.equal('semester' in validateSettings(base).value, false);
  assert.equal(settingsToRows(validateSettings(base).value).length, 4);
  for (const bad of [3, 0, '1 семестр', null, true]) assert.deepEqual(validateSettings({ ...base, semester: bad }).errors, [{ field: 'semester', code: 'bad_value' }], String(bad));
});

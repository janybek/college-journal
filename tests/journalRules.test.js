import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME } from '../core/scoring.js';
import {
  markState, markMode, normalizeMark, checkMark, markChanges, checkReason, checkResultValue,
} from '../core/journal.js';

const S = { ...DEFAULT_SCHEME, editDays: 3 };
const pair = { date: '2026-09-08', startTime: '08:00', status: 'planned' };

test('markState: term counted to the end of the Bishkek day', () => {
  assert.equal(markState(pair, { date: '2026-09-07', time: '23:59' }, S), 'future');
  assert.equal(markState(pair, { date: '2026-09-08', time: '07:59' }, S), 'future');
  assert.equal(markState(pair, { date: '2026-09-08', time: '08:00' }, S), 'open');
  assert.equal(markState(pair, { date: '2026-09-11', time: '23:59' }, S), 'open');
  assert.equal(markState(pair, { date: '2026-09-12', time: '00:00' }, S), 'late');
  assert.equal(markState(pair, { date: '2026-09-09', time: '00:00' }, { ...S, editDays: 0 }), 'late');
  assert.equal(markState({ ...pair, status: 'cancelled' }, { date: '2026-09-08', time: '09:00' }, S), 'cancelled');
  assert.equal(markState({ ...pair, status: 'missed' }, { date: '2026-09-08', time: '09:00' }, S), 'missed');
  assert.equal(markState({ ...pair, status: 'closed' }, { date: '2026-09-20', time: '09:00' }, S), 'late');
});

test('markMode', () => {
  const mode = (state, held, teacher, manager) => markMode({ state, held, teacher, manager });
  assert.deepEqual([mode('open', false, true, false), mode('open', true, true, true), mode('open', false, false, true), mode('late', true, true, true),
    mode('late', true, true, false), mode('late', false, true, false), mode('future', false, true, true), mode('open', true, false, false), mode('missed', false, true, true)],
  ['free', 'free', 'reason', 'reason', 'limited', 'none', 'none', 'none', 'none']);
});

test('checkMark', () => {
  const ctx = (mode, extra = {}) => ({ mode, pair: { first: false, lessonType: 'practice', ...extra }, scheme: S });
  const mk = (status, activity = null, noCoat = false) => ({ status, activity, noCoat });
  assert.deepEqual(checkMark(null, mk('present', 7), ctx('free')), []);
  assert.deepEqual(checkMark(null, mk('absent', 3), ctx('free')), [{ field: 'activity', code: 'not_allowed' }]);
  assert.deepEqual(checkMark(null, mk('present', 11), ctx('free')), [{ field: 'activity', code: 'bad_value' }]);
  assert.deepEqual(checkMark(null, mk('present', 5), ctx('free', { first: true })), [{ field: 'activity', code: 'not_allowed' }]);
  assert.deepEqual(checkMark(null, mk('present', 5), ctx('free', { lessonType: 'control' })), [{ field: 'activity', code: 'not_allowed' }]);
  assert.deepEqual(checkMark(null, mk('был'), ctx('free')), [{ field: 'status', code: 'bad_value' }]);
  assert.deepEqual(checkMark(mk('absent'), mk('excused'), ctx('limited')), []);
  assert.deepEqual(checkMark(mk('absent'), mk('madeup', 8), ctx('limited')), []);
  assert.deepEqual(checkMark(mk('excused'), mk('madeup'), ctx('limited')), []);
  assert.deepEqual(checkMark(mk('absent'), mk('present'), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('present', 5), mk('present', 9), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('absent'), mk('excused', null, true), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(null, mk('present'), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('present', 5), mk('present', 5), ctx('none')), []);
  assert.deepEqual(checkMark(mk('present'), mk('madeup'), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('late'), mk('madeup'), ctx('limited')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('present', 5), mk('absent'), ctx('none')), [{ field: 'status', code: 'locked' }]);
  assert.deepEqual(checkMark(mk('absent'), mk('absent'), ctx('limited')), []);
});

test('markChanges', () => {
  const mk = (status, activity = null, noCoat = false) => ({ status, activity, noCoat });
  assert.deepEqual(markChanges(mk('absent'), mk('madeup', 8)), [{ field: 'status', before: 'absent', after: 'madeup' }, { field: 'activity', before: '', after: '8' }]);
  assert.deepEqual(markChanges(null, mk('present', null, true)), [{ field: 'status', before: '', after: 'present' }, { field: 'noCoat', before: '', after: 'yes' }]);
  assert.deepEqual(markChanges(mk('present', 5), mk('present', 5)), []);
});

test('normalizeMark and checkReason', () => {
  assert.deepEqual([normalizeMark({ status: 'present' }), normalizeMark({ status: 'present', activity: '7' }), normalizeMark(['present']), normalizeMark({ status: 'present', noCoat: 'да' })],
    [{ status: 'present', noCoat: false, activity: null }, null, null, null]);
  assert.deepEqual([checkReason(''), checkReason('  '), checkReason('x'.repeat(301)), checkReason(' болел '), checkReason(null)], ['required', 'required', 'too_long', null, 'required']);
});

test('checkResultValue', () => {
  assert.deepEqual([checkResultValue('control', 40, S), checkResultValue('control', 41, S), checkResultValue('self', 20, S), checkResultValue('self', 21, S),
    checkResultValue('current', null, S), checkResultValue('control', '30', S), checkResultValue('control', 3.5, S)], [null, 'bad_value', null, 'bad_value', null, 'bad_value', 'bad_value']);
});

test('markState: the "future" check applies only to planned pairs', () => {
  assert.equal(markState({ date: '2026-09-22', startTime: '08:00', status: 'running' }, { date: '2026-09-22', time: '07:55' }, S), 'open');
  assert.equal(markState({ date: '2026-09-22', startTime: '08:00', status: 'planned' }, { date: '2026-09-22', time: '07:55' }, S), 'future');
});

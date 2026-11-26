import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEME, DEFAULT_SPLIT } from '../core/scoring.js';
import {
  PERSON_TABLES, PROGRESS_TABLES, COUNTED_STATES, meanOf, attendanceTotal, subjectState, stateCounts,
  figuresOf, debtOf, workCounts, pairEnded, unfilledPair, unitGap, roleList, hoursOf,
} from '../core/progress.js';

const S = DEFAULT_SCHEME;
const X = DEFAULT_SPLIT;

test('constants', () => {
  assert.deepEqual(PERSON_TABLES, ['students', 'staff']);
  assert.deepEqual(PROGRESS_TABLES, ['groups', 'disciplines']);
  assert.deepEqual(COUNTED_STATES, ['risk', 'fail', 'notAdmitted', 'absent', 'incomplete']);
});

test('subjectState and stateCounts', () => {
  const R = (totals, semester) => ({ units: totals.map((total) => ({ total })), semester });
  const opt = { scheme: S, split: X };
  assert.equal(subjectState(R([null, null], null), null, opt), 'going');
  assert.equal(subjectState(R([84, null], 50), null, opt), 'going');
  assert.equal(subjectState(R([84, 57], 42), null, opt), 'risk');
  const low = { scheme: { ...S, fair: 40 }, split: X };
  assert.equal(subjectState(R([50], 30), null, low), 'risk');
  assert.equal(subjectState(R([52], 31), null, low), 'going');
  assert.equal(subjectState(R([50], 25), null, { scheme: { ...S, fair: 40 }, split: { semester: 50, exam: 50, admission: 25 } }), 'risk');
  assert.deepEqual(['done/good', 'done/fail', 'not_admitted/', 'absent/', 'incomplete/', 'none/'].map((k) => {
    const [status, word] = k.split('/');
    return subjectState(R([30], 18), { status, word: word || null, total: 82 }, opt);
  }), ['passed', 'fail', 'notAdmitted', 'absent', 'incomplete', 'noExam']);
  assert.deepEqual(stateCounts(['risk', 'going', 'fail', 'fail', 'passed', 'notAdmitted', 'absent', 'incomplete', 'noExam']),
    { risk: 1, fail: 2, notAdmitted: 1, absent: 1, incomplete: 1 });
});

test('meanOf, attendanceTotal, figuresOf', () => {
  assert.equal(meanOf([]), null);
  assert.equal(meanOf([84, 57]), 71);
  assert.deepEqual(attendanceTotal([]), { marked: 0, attended: 0, absent: 0, percent: null });
  assert.deepEqual(figuresOf([
    { attendance: { marked: 2, attended: 2, absent: 0 }, units: [{ total: 84 }, { total: null }], state: 'going' },
    { attendance: { marked: 4, attended: 1, absent: 2 }, units: [{ total: 57 }], state: 'risk' },
  ]), { attendance: { marked: 6, attended: 3, absent: 2, percent: 50 }, average: 71, risk: 1 });
  assert.deepEqual(figuresOf([]), { attendance: { marked: 0, attended: 0, absent: 0, percent: null }, average: null, risk: 0 });
});

test('debtOf and workCounts', () => {
  const C = (status, createdAt, id) => ({ id, status, createdAt });
  assert.equal(debtOf({ status: 'done', word: 'good', total: 82 }, []), null);
  assert.equal(debtOf({ status: 'none', word: null, total: null }, []), null);
  assert.deepEqual(debtOf({ status: 'done', word: 'fail', total: 58 }, []), { state: 'fail', total: 58, repeat: null });
  assert.deepEqual(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('failed', '2026-12-21 10:00:00', 'rp1'), C('open', '2027-02-10 10:00:00', 'rp2')]).repeat, 'open');
  assert.equal(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('cancelled', '2026-12-21 10:00:00', 'rp1')]).repeat, null);
  assert.equal(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('failed', '2026-12-21 10:00:00', 'rp1'), C('passed', '2027-02-10 10:00:00', 'rp2')]), null);
  assert.deepEqual(['not_admitted', 'absent', 'incomplete'].map((status) => debtOf({ status, word: null, total: null }, []).state), ['notAdmitted', 'absent', 'incomplete']);
  assert.deepEqual(workCounts([{ state: 'checked' }, { state: 'submitted' }, { state: 'returned' }, { state: 'none', overdue: true }, { state: 'none', overdue: false }]),
    { checked: 1, submitted: 1, returned: 1, missing: 1 });
});

test('pairs and unit gaps', () => {
  const P = (date, startTime, over = {}) => ({ date, startTime, status: 'planned', ...over });
  assert.deepEqual([pairEnded(P('2026-09-15', '08:00'), '2026-09-15', '09:29'), pairEnded(P('2026-09-15', '08:00'), '2026-09-15', '09:30'),
    pairEnded(P('2026-09-15', '08:00'), '2026-09-16', '00:00'), pairEnded(P('2026-09-16', '08:00'), '2026-09-15', '23:59')], [false, true, true, false]);
  const sem = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20' };
  const un = (p) => unfilledPair(p, { today: '2026-09-30', time: '12:00', settings: sem });
  assert.deepEqual(['planned', 'running', 'closed', 'missed', 'cancelled'].map((status) => un(P('2026-09-15', '08:00', { status }))), [true, false, false, false, false]);
  assert.equal(un(P('2026-08-25', '08:00')), false);
  const pairs = [P('2026-09-01', '08:00', { unit: 1, status: 'closed' }), P('2026-09-08', '08:00', { unit: 1 }), P('2026-09-29', '08:00', { unit: 2 }),
    P('2026-09-22', '08:00', { unit: 3, status: 'cancelled' })];
  const st = (left, control, self) => ({ left, units: [{ unit: 1, control, self }] });
  const students = [st(false, 30, 16), st(false, null, null), st(true, null, null)];
  const gap = (over = {}) => unitGap({ unit: 1, pairs, closedUnits: [], students, today: '2026-09-30', time: '12:00', scheme: S, ...over });
  assert.deepEqual(gap(), { unit: 1, control: 1, self: 1 });
  assert.equal(gap({ closedUnits: [1] }), null);
  assert.equal(gap({ today: '2026-09-08', time: '09:00' }), null);
  assert.equal(gap({ unit: 3 }), null);
  assert.equal(gap({ unit: 4 }), null);
  assert.equal(gap({ students: [st(false, 30, 16)] }), null);
  assert.deepEqual(gap({ scheme: { ...S, current: 60, self: 0 } }), { unit: 1, control: 1, self: 0 });
});

test('roleList and hoursOf', () => {
  assert.deepEqual([roleList('dean, teacher'), roleList(''), roleList('teacher,,teacher'), roleList(undefined)], [['dean', 'teacher'], [], ['teacher'], []]);
  assert.equal(hoursOf(7), 14);
});

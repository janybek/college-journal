import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BELLS } from '../core/settings.js';
import { setup } from './journalSetup.js';

const SEM = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20', holidays: [], bells: DEFAULT_BELLS, semester: 1 };
const WEEK = { examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: ' Колледж ' };

test('credit week: validation, rights, saving and the count of pairs it takes away', () => {
  const s = setup();
  const save = (extra, token = s.t.dean) => s.call('settings.save', { settings: SEM, extra }, token);
  assert.deepEqual(s.call('settings.get', {}, s.t.prorector).data.extra, { examStart: '', examEnd: '', collegeName: '' });
  const before = s.snapshot();
  assert.deepEqual(save({ examStart: '2026-12-21', examEnd: '2026-12-25', collegeName: '' }).error,
    { code: 'invalid', fields: [{ field: 'examStart', code: 'out_of_semester' }, { field: 'examEnd', code: 'out_of_semester' }] });
  assert.equal(save({ examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: 'Колледж' }, s.t.prorector).error.code, 'forbidden');
  assert.equal(save({ examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: 'Колледж' }, s.t.teacher1).error.code, 'forbidden');
  assert.deepEqual(s.snapshot(), before);
  const done = save(WEEK).data;
  assert.deepEqual([done.extra, done.examPairs], [{ examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: 'Колледж' }, 2]);   // Tue 15.12 (sb1) and Fri 18.12 (sb2)
  assert.deepEqual(s.call('settings.save', { settings: SEM }, s.t.dean).data.extra, done.extra);                                     // no extra: untouched
  assert.deepEqual(s.call('settings.get', {}, s.t.dean).data.extra, done.extra);
});

test('credit week: a non-string date does not wipe the saved week', () => {
  const s = setup();
  const save = (extra) => s.call('settings.save', { settings: SEM, extra }, s.t.dean);
  const done = save(WEEK).data.extra;
  for (const bad of [{ examStart: 20261214, examEnd: '2026-12-20' }, { examStart: ['2026-12-14'], examEnd: ['2026-12-20'] }, { examStart: 1, examEnd: 2 }]) {
    const before = s.snapshot();
    const res = save({ ...bad, collegeName: 'Колледж' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'invalid');
    assert.deepEqual(s.snapshot(), before);
  }
  assert.deepEqual(s.call('settings.get', {}, s.t.dean).data.extra, done);
});

test('credit week: generate keeps held and moved pairs, removes ordinary ones, and the lists tell the week', () => {
  const s = setup();
  s.call('settings.save', { settings: SEM, extra: WEEK }, s.t.dean);
  const p1215 = s.pairOf(s.sb1, '2026-12-15');
  s.store.update('pairs', p1215.id, { status: 'closed' });
  const res = s.call('schedule.generate', {}, s.t.dean).data;
  assert.equal(res.removed, 1);
  assert.equal(s.pairOf(s.sb2, '2026-12-18'), undefined);
  assert.equal(s.pairOf(s.sb1, '2026-12-15').status, 'closed');
  const again = s.call('schedule.generate', {}, s.t.dean).data;
  assert.deepEqual([again.removed, again.inserted], [0, 0]);

  const earlier = s.pairOf(s.sb1, '2026-12-08');
  s.at('2026-12-01');
  const moved = s.call('schedule.changePair', { id: earlier.id, date: '2026-12-16' }, s.t.dean);
  assert.equal(moved.ok, true);
  assert.equal(s.store.get('pairs', earlier.id).changed, true);
  s.call('schedule.generate', {}, s.t.dean);
  assert.equal(s.store.get('pairs', earlier.id).date, '2026-12-16');

  const exam = { start: '2026-12-14', end: '2026-12-20' };
  assert.deepEqual(s.call('schedule.list', { from: '2026-12-14' }, s.t.dean).data.exam, exam);
  assert.deepEqual(s.call('schedule.mine', { from: '2026-12-14' }, s.t.a1).data.exam, exam);
  assert.deepEqual(s.call('schedule.mine', { from: '2026-12-14' }, s.t.teacher1).data.exam, exam);
  assert.equal(Object.keys(s.call('schedule.list', {}, s.t.dean).data).pop(), 'exam');
  assert.equal(Object.keys(s.call('schedule.mine', {}, s.t.a1).data).pop(), 'exam');
});

test('credit week: removing it frees the dates again', () => {
  const s = setup();
  s.call('settings.save', { settings: SEM, extra: WEEK }, s.t.dean);
  s.store.update('pairs', s.pairOf(s.sb1, '2026-12-15').id, { status: 'closed' });
  s.call('schedule.generate', {}, s.t.dean);
  const none = s.call('settings.save', { settings: SEM, extra: { examStart: '', examEnd: '', collegeName: 'Колледж' } }, s.t.dean).data;
  assert.equal(none.examPairs, 0);
  assert.deepEqual(s.call('schedule.list', { from: '2026-12-14' }, s.t.dean).data.exam, { start: '', end: '' });
  const gen = s.call('schedule.generate', {}, s.t.dean).data;
  assert.equal(gen.inserted, 1);
  assert.ok(s.pairOf(s.sb2, '2026-12-18'));
  assert.equal(s.store.list('pairs').filter((p) => p.subjectId === s.sb1 && p.date === '2026-12-15').length, 1);
});

test('credit week: pairs are read once, only when needed', () => {
  const s = setup();
  s.spy.reset();
  s.call('settings.save', { settings: SEM }, s.t.dean);
  assert.equal(s.spy.lists.pairs, undefined);
  s.spy.reset();
  s.call('settings.save', { settings: SEM, extra: WEEK }, s.t.dean);
  assert.equal(s.spy.lists.pairs, 1);
  s.spy.reset();
  s.call('settings.save', { settings: { ...SEM, semesterEnd: '2026-12-25' } }, s.t.dean);
  assert.equal(s.spy.lists.pairs, 1);
  s.spy.reset();
  s.call('settings.save', { settings: { ...SEM, semesterEnd: '2026-12-26' }, extra: WEEK }, s.t.dean);
  assert.equal(s.spy.lists.pairs, 1);
});

test('credit week: new semester dates are checked against the saved week', () => {
  const s = setup();
  s.call('settings.save', { settings: SEM, extra: WEEK }, s.t.dean);
  const before = s.snapshot();
  assert.deepEqual(s.call('settings.save', { settings: { ...SEM, semesterEnd: '2026-12-15' } }, s.t.dean).error,
    { code: 'invalid', fields: [{ field: 'examEnd', code: 'out_of_semester' }] });
  assert.deepEqual(s.snapshot(), before);
});

test('credit week: dates that cut off a held pair of a closed unit are refused', () => {
  const s = setup();
  s.closeUnit(1);
  const before = s.snapshot();
  s.spy.reset();
  assert.equal(s.call('settings.save', { settings: { ...SEM, semesterStart: '2026-09-15' } }, s.t.dean).error.code, 'unit_closed');
  assert.equal(s.spy.lists.closures, 1);
  assert.deepEqual(s.snapshot(), before);
  // the held pair of 01.09 is in unit 1 as well, so 02.09 cuts it off too
  assert.equal(s.call('settings.save', { settings: { ...SEM, semesterStart: '2026-09-02' } }, s.t.dean).error.code, 'unit_closed');
  assert.deepEqual(s.snapshot(), before);
  // dates that leave every held pair of the closed unit inside are saved
  assert.equal(s.call('settings.save', { settings: { ...SEM, semesterEnd: '2026-12-19' } }, s.t.dean).ok, true);
  assert.equal(s.call('settings.get', {}, s.t.dean).data.settings.semesterEnd, '2026-12-19');
});

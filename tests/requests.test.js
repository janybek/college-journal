import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REQUEST, markText, parseMarkText, pointsText, parsePointsText, mayDecide, sameTarget } from '../core/requests.js';
import { limitedAllowed } from '../core/journal.js';

test('constants', () => {
  assert.deepEqual(REQUEST, { openMax: 50, listMax: 200 });
});

test('mark text', () => {
  assert.deepEqual([markText(null), markText({ status: 'absent', noCoat: false, activity: null }), markText({ status: 'madeup', noCoat: true, activity: 7 }), markText({ status: 'present', noCoat: false, activity: 0 })],
    ['', 'absent|0|', 'madeup|1|7', 'present|0|0']);
  assert.deepEqual([parseMarkText(''), parseMarkText('madeup|1|7'), parseMarkText('absent|0|')], [null, { status: 'madeup', noCoat: true, activity: 7 }, { status: 'absent', noCoat: false, activity: null }]);
  for (const bad of ['absent', 'absent|0', 'gone|0|', 'absent|yes|', 'absent|0|7.5', 'absent|0|-1', 'absent|0||', 5, null, ['absent|0|']]) assert.equal(parseMarkText(bad), undefined, String(bad));
});

test('points text', () => {
  assert.deepEqual([pointsText(null), pointsText(0), pointsText(31)], ['', '0', '31']);
  assert.deepEqual([parsePointsText(''), parsePointsText('0'), parsePointsText('31'), parsePointsText('3.5'), parsePointsText('-1'), parsePointsText(' 31'), parsePointsText(31), parsePointsText('1000')], [null, 0, 31, undefined, undefined, undefined, undefined, undefined]);
});

const P = (id, roles, active = true) => ({ id, roles, active });
const staff = [P('d1', 'dean'), P('d2', 'dean,teacher'), P('p1', 'prorector'), P('ad', 'admin'), P('t1', 'teacher'), P('dp', 'dean,prorector'), P('d3', 'dean', false)];
const A = (id) => ({ id, roles: staff.find((s) => s.id === id).roles.split(',') });
const R = (over = {}) => ({ status: 'dean', authorId: 't1', deanBy: '', ...over });

test('who may decide', () => {
  assert.deepEqual(['d1', 't1', 'p1', 'ad', 'dp'].map((id) => mayDecide(R(), A(id), staff)), [true, false, false, false, true]);
  assert.deepEqual([mayDecide(R({ authorId: 'd2' }), A('d2'), staff), mayDecide(R({ authorId: 'd2' }), A('d1'), staff)], [false, true]);
  const lone = [P('d2', 'dean,teacher'), P('p1', 'prorector'), P('ad', 'admin'), P('d3', 'dean', false)];
  assert.equal(mayDecide(R({ authorId: 'd2' }), { id: 'ad', roles: ['admin'] }, lone), true);
  assert.equal(mayDecide(R({ authorId: 'ad' }), { id: 'ad', roles: ['admin'] }, lone), false);
  const S2 = R({ status: 'prorector', deanBy: 'dp' });
  assert.deepEqual(['dp', 'p1', 'ad', 'd1'].map((id) => mayDecide(S2, A(id), staff)), [false, true, false, false]);
  const noOther = [P('dp', 'dean,prorector'), P('ad', 'admin'), P('d1', 'dean'), P('t1', 'teacher')];
  assert.equal(mayDecide(S2, { id: 'ad', roles: ['admin'] }, noOther), true);
  assert.equal(mayDecide(R({ status: 'prorector', deanBy: 'ad' }), { id: 'ad', roles: ['admin'] }, [P('ad', 'admin'), P('t1', 'teacher')]), false);
  for (const status of ['applied', 'rejected', 'stale', 'withdrawn', '', undefined]) assert.equal(mayDecide(R({ status }), A('d1'), staff), false);
  assert.equal(mayDecide(R(), { id: 'd1', roles: 'dean' }, staff), false);
});

test('same target', () => {
  const X = { kind: 'control', subjectId: 'sb1', planSemester: 1, unit: 1, pairId: '', assignmentId: '', studentId: 'a2' };
  assert.deepEqual([sameTarget(X, { ...X }), sameTarget(X, { ...X, studentId: 'a1' }), sameTarget(X, { ...X, kind: 'self' }), sameTarget({ ...X, planSemester: null }, { ...X, planSemester: undefined })], [true, false, false, true]);
});

test('limitedAllowed is exported', () => {
  const m = (status) => ({ status, noCoat: false, activity: null });
  assert.equal(limitedAllowed(m('absent'), m('excused')), true);
  assert.equal(limitedAllowed(m('absent'), m('present')), false);
  assert.equal(limitedAllowed(m('excused'), m('madeup')), true);
});

test('who may decide: the roles of a staff row are trimmed and only a strict active counts', () => {
  const spaced = [P('d2', 'teacher, dean'), P('ad', 'admin'), P('t1', 'teacher')];
  assert.equal(mayDecide(R(), { id: 'ad', roles: ['admin'] }, spaced), false);
  const inactive = [{ id: 'd1', roles: 'dean', active: 'yes' }, { id: 'ad', roles: 'admin', active: true }];
  assert.equal(mayDecide(R(), { id: 'ad', roles: ['admin'] }, inactive), true);
});

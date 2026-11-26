import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TABLES, pairEnd, nowOf, termOf, topOf, syllabusState, syllabusCounts } from '../core/dirInfo.js';

const P = (id, date, startTime, over = {}) => ({ id, date, slot: 1, startTime, status: 'planned', ...over });

test('card tables', () => {
  assert.deepEqual(CARD_TABLES, ['groups', 'rooms', 'disciplines']);
});

test('nowOf and pairEnd: busy, next, done, none', () => {
  const day = [P('a', '2026-09-15', '08:00'), P('b', '2026-09-15', '09:40'), P('c', '2026-09-15', '11:20', { status: 'cancelled' }), P('d', '2026-09-16', '08:00')];
  const st = (time, pairs = day) => { const r = nowOf(pairs, '2026-09-15', time); return r.pair ? [r.state, r.pair.id] : [r.state]; };
  assert.deepEqual([st('07:59'), st('08:00'), st('09:29'), st('09:30'), st('09:40'), st('11:10'), st('11:30')],
    [['next', 'a'], ['busy', 'a'], ['busy', 'a'], ['next', 'b'], ['busy', 'b'], ['done'], ['done']]);
  assert.deepEqual(st('12:00', [P('c', '2026-09-15', '11:20', { status: 'cancelled' })]), ['none']);
  assert.deepEqual(st('12:00', []), ['none']);
  assert.deepEqual(st('10:00', [P('x', '2026-09-15', '09:55')]), ['busy', 'x']);
  assert.deepEqual(st('10:00', [P('y', '2026-09-15', '')]), ['none']);
  assert.equal(pairEnd(P('a', '2026-09-15', '11:20')), '12:50');
});

test('termOf', () => {
  const S = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20' };
  const X = { examStart: '2026-12-14', examEnd: '2026-12-20' };
  const term = (today, over = {}) => termOf({ settings: S, extra: X, today, hasPairs: true, ...over });
  assert.deepEqual([term('2026-08-31'), term('2026-09-01'), term('2026-12-13'), term('2026-12-14'), term('2026-12-20'), term('2026-12-21')],
    ['before', 'on', 'on', 'exam', 'exam', 'after']);
  assert.equal(term('2026-10-01', { hasPairs: false }), 'none');
  assert.equal(term('2026-10-01', { settings: { semesterStart: '', semesterEnd: '' } }), 'none');
  assert.equal(term('2026-12-15', { extra: { examStart: '', examEnd: '' } }), 'on');
});

test('topOf', () => {
  assert.equal(topOf([]), null);
  assert.deepEqual(topOf([{ disciplineName: 'Информатика', groupName: '02-1' }, { disciplineName: 'Анатомия', groupName: '01-1' },
    { disciplineName: 'Информатика', groupName: '01-1' }, { disciplineName: 'Информатика', groupName: '02-1' }]), { disciplineName: 'Информатика', groupNames: ['01-1', '02-1'] });
  assert.deepEqual(topOf([{ disciplineName: 'Информатика', groupName: '01-1' }, { disciplineName: 'Анатомия', groupName: '02-1' }]), { disciplineName: 'Анатомия', groupNames: ['02-1'] });
});

test('syllabusState and syllabusCounts', () => {
  const Y = (status, version, over = {}) => ({ id: 'y' + version, disciplineId: 'd', teacherId: 't', semester: 1, lineId: 'l1', status, version, ...over });
  const members = [{ id: 'l1', disciplineId: 'd', kind: 'main', semester: null, teacherId: '', responsibleId: 'u', createdAt: '' }];   // the syllabus of the discipline
  const key = { disciplineId: 'd', teacherId: 't', semester: 1 };
  const dean = { id: 'u', roles: ['dean'] };
  const pro = { id: 'p', roles: ['prorector'] };
  assert.deepEqual(syllabusState([Y('approved', 1), Y('returned', 2)], key, dean, members), { approved: true, open: 'returned' });
  assert.deepEqual(syllabusState([Y('draft', 1)], key, dean, members), { approved: false, open: 'draft' });
  assert.deepEqual(syllabusState([Y('draft', 1)], key, pro, members), { approved: false, open: null });
  assert.deepEqual(syllabusState([Y('review', 1)], key, pro, members), { approved: false, open: 'review' });
  assert.deepEqual(syllabusState([Y('approved', 1, { semester: 2, lineId: 'l2' })], key, dean, members), { approved: false, open: null });
  assert.throws(() => syllabusState([Y('draft', 1)], key, dean, undefined), TypeError);
  assert.deepEqual(syllabusCounts([{ approved: true, open: 'returned' }, { approved: false, open: 'draft' }, { approved: false, open: null }, { approved: false, open: 'review' }]),
    { approved: 1, review: 1, returned: 1, draft: 1, none: 1 });
  assert.deepEqual(syllabusCounts([]), { approved: 0, review: 0, returned: 0, draft: 0, none: 0 });
});

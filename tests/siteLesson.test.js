import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortName, clockText, qrLink, arrivedList, stageOf, todayAction } from '../site/js/lesson.js';

test('shortName: surname and the first initial', () => {
  assert.deepEqual(['Асанов Айдар Бекович', ' Өмүров Канат ', 'Асанов', '  '].map(shortName), ['Асанов А.', 'Өмүров К.', 'Асанов', '']);
});

test('clockText: seconds rounded up, never negative', () => {
  assert.deepEqual([0, 1, 59999, 286000, 5386000, -5, null].map(clockText), ['00:00', '00:01', '01:00', '04:46', '89:46', '00:00', '00:00']);
});

test('qrLink: everything before the # and the pass address', () => {
  assert.equal(qrLink('https://x.io/college-journal/#/lesson/p_1', 'p_1', 'ab'.repeat(8)), 'https://x.io/college-journal/#/q/p_1/' + 'ab'.repeat(8));
  assert.equal(qrLink('http://localhost:5273/', 'p/1', 'ab'.repeat(8)), 'http://localhost:5273/#/q/p%2F1/' + 'ab'.repeat(8));
});

const L = { phase: 'checkin', students: [
  { id: 's1', fullName: 'Ёлкин Бакыт', mark: { status: 'present' }, checkin: { at: '08:01:10' } },
  { id: 's2', fullName: 'Асанов Айдар', mark: { status: 'present' }, checkin: { at: '08:00:05' } },
  { id: 's3', fullName: 'Беков Нурлан', mark: { status: 'absent' }, checkin: null },
  { id: 's4', fullName: 'Абаев Тимур', mark: { status: 'late' }, checkin: null },
  { id: 's5', fullName: 'Жунусов Али', mark: null, checkin: null }] };

test('arrivedList: by check-in time, those without it last, then by name', () => {
  assert.deepEqual(arrivedList(L).map((x) => x.name), ['Асанов А.', 'Ёлкин Б.', 'Абаев Т.']);
  assert.deepEqual(arrivedList({ students: [] }), []);
});

test('stageOf: the chosen tab wins while it exists', () => {
  assert.deepEqual([stageOf(L, null), stageOf(L, 'summary'), stageOf({ phase: 'lesson' }, null), stageOf({ phase: 'lesson' }, 'checkin'), stageOf({ phase: 'over' }, null), stageOf({ phase: 'none' }, 'material')],
    ['checkin', 'summary', 'material', 'material', 'summary', 'material']);
  assert.equal(stageOf({ phase: 'none' }, null), 'summary');
});

test('todayAction: what the pair offers', () => {
  assert.deepEqual([{ lesson: 'start' }, { lesson: 'open' }, { lesson: null }, {}].map(todayAction), ['start', 'open', null, null]);
});

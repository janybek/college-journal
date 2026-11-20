import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateSlots, pairSlots, busyCodes } from '../core/busy.js';

const subjects = [{ id: 'sb_1', groupId: 'g_1', teacherId: 'sf_1' }, { id: 'sb_2', groupId: 'g_2', teacherId: 'sf_2' }];

test('templateSlots takes group and teacher from the subject', () => {
  assert.deepEqual(templateSlots([{ id: 'wt_1', weekday: 1, slot: 2, subjectId: 'sb_1', roomId: 'r_1' }, { id: 'wt_2', weekday: 3, slot: 1, subjectId: 'sb_x', roomId: '' }], subjects),
    [{ id: 'wt_1', day: 1, slot: 2, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }, { id: 'wt_2', day: 3, slot: 1, groupId: '', teacherId: '', roomId: '' }]);
});

test('pairSlots and busyCodes', () => {
  const pairs = [{ id: 'p1', date: '2026-09-08', slot: 1, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1', status: 'planned' },
    { id: 'p2', date: '2026-09-08', slot: 2, groupId: 'g_1', teacherId: 'sf_1', roomId: '', status: 'cancelled' },
    { id: 'p3', date: '2026-09-08', slot: 3, groupId: 'g_2', teacherId: 'sf_2', roomId: '', status: 'missed' }];
  const slots = pairSlots(pairs);
  assert.deepEqual(slots, [{ id: 'p1', day: '2026-09-08', slot: 1, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }]);
  const at = (extra) => busyCodes(slots, { id: '', day: '2026-09-08', slot: 1, groupId: 'g_2', teacherId: 'sf_2', roomId: '', ...extra });
  assert.deepEqual(at({}), []);
  assert.deepEqual(at({ groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }), ['group_busy', 'teacher_busy', 'room_busy']);
  assert.deepEqual(at({ teacherId: 'sf_1' }), ['teacher_busy']);
  assert.deepEqual(at({ roomId: 'r_1' }), ['room_busy']);
  assert.deepEqual(at({ id: 'p1', groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }), []);
  assert.deepEqual(at({ slot: 2, groupId: 'g_1', teacherId: 'sf_1' }), []);
  assert.deepEqual(at({ day: '2026-09-09', groupId: 'g_1' }), []);
  assert.deepEqual(busyCodes([{ id: 'x', day: 1, slot: 1, groupId: '', teacherId: '', roomId: '' }],
    { id: '', day: 1, slot: 1, groupId: '', teacherId: '', roomId: '' }), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAnnouncement, lastDay, isShown, seenBy } from '../core/announce.js';

const groups = [{ id: 'g1' }, { id: 'g2' }];
const ok = { audience: 'group', groupId: 'g1', title: ' Собрание ', text: ' В 15:00 ', expiresOn: '' };
const chk = (over) => checkAnnouncement({ ...ok, ...over }, { today: '2026-11-01', groups });
const row = { authorId: 'sf1', audience: 'group', groupId: 'g1', createdAt: '2026-11-01 09:00:00', expiresOn: '', removedAt: '' };
const V = (over) => ({ id: 'x', kind: 'staff', groupId: '', office: false, teacher: false, teachGroupIds: new Set(), ...over });

test('checkAnnouncement', () => {
  assert.deepEqual(chk({}), { value: { audience: 'group', groupId: 'g1', title: 'Собрание', text: 'В 15:00', expiresOn: '' }, problems: [] });
  assert.equal(chk({ audience: 'all', groupId: 'g1' }).value.groupId, '');
  assert.deepEqual(chk({ audience: 'students' }).problems, [{ field: 'audience', code: 'bad_value' }]);
  assert.equal(chk({ audience: 'students' }).value, null);
  for (const groupId of ['g9', ['g1'], 5, ' g1', undefined]) assert.deepEqual(chk({ groupId }).problems, [{ field: 'groupId', code: 'bad_ref' }]);
  assert.deepEqual([chk({ title: '   ' }).problems[0], chk({ title: 5 }).problems[0], chk({ title: 'я'.repeat(121) }).problems[0]],
    [{ field: 'title', code: 'empty' }, { field: 'title', code: 'empty' }, { field: 'title', code: 'too_long' }]);
  assert.deepEqual(chk({ text: 'я'.repeat(2001) }).problems, [{ field: 'text', code: 'too_long' }]);
  assert.equal(chk({ text: undefined }).value.text, '');
  assert.deepEqual([chk({ expiresOn: '10.11.2026' }).problems[0].code, chk({ expiresOn: '2026-10-31' }).problems[0].code,
    chk({ expiresOn: '2027-11-03' }).problems[0].code, chk({ expiresOn: '2026-11-01' }).problems.length], ['bad_value', 'in_past', 'too_far', 0]);
});

test('lastDay and isShown', () => {
  assert.equal(lastDay(row), '2026-12-01');
  assert.deepEqual([isShown(row, '2026-12-01'), isShown(row, '2026-12-02'), isShown({ ...row, expiresOn: '2026-11-10' }, '2026-11-10'),
    isShown({ ...row, expiresOn: '2026-11-10' }, '2026-11-11'), isShown({ ...row, removedAt: '2026-11-02 10:00:00' }, '2026-11-02')],
  [true, false, true, false, false]);
});

test('seenBy', () => {
  assert.deepEqual([seenBy(row, V({ kind: 'student', groupId: 'g1' })), seenBy(row, V({ kind: 'student', groupId: 'g2' })),
    seenBy(row, V({ teacher: true, teachGroupIds: new Set(['g1']) })), seenBy(row, V({ teacher: true, teachGroupIds: new Set(['g2']) })),
    seenBy(row, V({ office: true })), seenBy(row, V({ id: 'sf1' }))], [true, false, true, false, true, true]);
  assert.deepEqual([seenBy({ ...row, audience: 'teachers' }, V({ kind: 'student', groupId: 'g1' })), seenBy({ ...row, audience: 'teachers' }, V({ teacher: true })),
    seenBy({ ...row, audience: 'all' }, V({ kind: 'student', groupId: 'g2' }))], [false, true, true]);
});

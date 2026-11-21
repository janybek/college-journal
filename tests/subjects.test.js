import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeGroups, nextRow, addRequest, syllabusBadge, pairsNote, addedTeachers, withoutRow } from '../site/js/subjects.js';

const groups = [{ id: 'g1', name: '01-1' }, { id: 'g2', name: '02-1' }, { id: 'g3', name: '03-1' }];
const rows = [
  { disciplineId: 'ds1', disciplineName: 'Информатика', teacherId: 't1', teacherName: 'Teacher One', uploaded: true, otherSemester: true, plannedHours: 36, plannedPairs: 18,
    groups: [{ subjectId: 'sb1', groupId: 'g1', groupName: '01-1', scheduledPairs: 18 }, { subjectId: 'sb2', groupId: 'g2', groupName: '02-1', scheduledPairs: 17 }] },
  { disciplineId: 'ds1', disciplineName: 'Информатика', teacherId: 't3', teacherName: 'Teacher Three', uploaded: false, otherSemester: false, plannedHours: 0, plannedPairs: 0,
    groups: [{ subjectId: 'sb3', groupId: 'g3', groupName: '03-1', scheduledPairs: 18 }] }];

test('freeGroups: the groups that do not have the discipline yet and are not chosen in another row of the window', () => {
  assert.deepEqual(freeGroups(groups, rows, 'ds1').map((g) => g.id), []);
  assert.deepEqual(freeGroups(groups, rows, 'ds2', ['g2']).map((g) => g.id), ['g1', 'g3']);
});

test('nextRow: a new row of the window keeps the teacher of the last one', () => {
  assert.deepEqual([nextRow([]), nextRow([{ groupId: 'g1', teacherId: 't1' }])], [{ groupId: '', teacherId: '' }, { groupId: '', teacherId: 't1' }]);
});

test('addRequest: fully empty rows are dropped; ready only with a discipline and a group and a teacher in every row', () => {
  assert.deepEqual(addRequest('ds2', [{ groupId: 'g1', teacherId: 't1' }, { groupId: '', teacherId: '' }]),
    { ready: true, data: { disciplineId: 'ds2', items: [{ groupId: 'g1', teacherId: 't1' }] } });
  assert.deepEqual([addRequest('', [{ groupId: 'g1', teacherId: 't1' }]).ready, addRequest('ds2', []).ready, addRequest('ds2', [{ groupId: 'g1', teacherId: '' }]).ready],
    [false, false, false]);
});

test('syllabusBadge: uploaded for the current semester, only for the other one, or none', () => {
  assert.deepEqual(syllabusBadge(rows[0]), { tone: 'success', key: 'subjects.syllabus.uploaded', params: { hours: 36, pairs: 18 } });
  assert.deepEqual(syllabusBadge(rows[1]), { tone: 'warning', key: 'subjects.syllabus.none' });
  assert.deepEqual(syllabusBadge({ ...rows[1], otherSemester: true }), { tone: 'neutral', key: 'subjects.syllabus.other' });
});

test('pairsNote: only where the schedule of a group holds another number of pairs than the plan', () => {
  assert.deepEqual([pairsNote(rows[0], rows[0].groups[0]), pairsNote(rows[0], rows[0].groups[1]), pairsNote(rows[1], rows[1].groups[0])],
    [null, { key: 'subjects.pairsDiffer', params: { planned: 18, scheduled: 17 } }, null]);
});

test('pairsNote: a group with a syllabus but no pairs in the schedule yet gets a calm line, not a mismatch', () => {
  assert.deepEqual(pairsNote(rows[0], { ...rows[0].groups[0], scheduledPairs: 0 }), { key: 'subjects.notScheduled', calm: true });
  assert.equal(pairsNote(rows[1], { ...rows[1].groups[0], scheduledPairs: 0 }), null);                // нет силлабуса — нечего сравнивать
});

test('withoutRow: the errors of the rows after a removed one move up with their rows', () => {
  const errors = { 0: { groupId: 'a' }, 1: { teacherId: 'b' }, 3: { groupId: 'c', teacherId: 'd' } };
  assert.deepEqual(withoutRow(errors, 1), { 0: { groupId: 'a' }, 2: { groupId: 'c', teacherId: 'd' } });
  assert.deepEqual(withoutRow(errors, 0), { 0: { teacherId: 'b' }, 2: { groupId: 'c', teacherId: 'd' } });
  assert.deepEqual(withoutRow(errors, 3), { 0: { groupId: 'a' }, 1: { teacherId: 'b' } });
  assert.deepEqual(withoutRow({}, 0), {});
  assert.deepEqual(errors, { 0: { groupId: 'a' }, 1: { teacherId: 'b' }, 3: { groupId: 'c', teacherId: 'd' } });   // не меняет то, что дали
});

test('addedTeachers: the rows of the discipline that hold a subject just created', () => {
  assert.deepEqual(addedTeachers(rows, 'ds1', ['sb3']).map((r) => r.teacherId), ['t3']);
  assert.deepEqual(addedTeachers(rows, 'ds1', ['sb2', 'sb3']).map((r) => r.teacherId), ['t1', 't3']);
  assert.deepEqual(addedTeachers(rows, 'ds2', ['sb3']), []);
});

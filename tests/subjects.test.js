import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeGroups, nextRow, addRequest, syllabusBadge, approvedNote, teacherBadge, teacherAction, pairsNote, addedTeachers, withoutRow } from '../site/js/subjects.js';

const groups = [{ id: 'g1', name: '01-1' }, { id: 'g2', name: '02-1' }, { id: 'g3', name: '03-1' }];
const rows = [
  { disciplineId: 'ds1', disciplineName: 'Информатика', teacherId: 't1', teacherName: 'Teacher One', syllabusStatus: 'approved', open: null, otherSemester: true, plannedHours: 36, plannedPairs: 18,
    groups: [{ subjectId: 'sb1', groupId: 'g1', groupName: '01-1', scheduledPairs: 18 }, { subjectId: 'sb2', groupId: 'g2', groupName: '02-1', scheduledPairs: 17 }] },
  { disciplineId: 'ds1', disciplineName: 'Информатика', teacherId: 't3', teacherName: 'Teacher Three', syllabusStatus: 'none', open: 'draft', otherSemester: false, plannedHours: 0, plannedPairs: 0,
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

test('syllabusBadge: one mark — the open version first (returned, under review, draft), else the approved one, the other half of the year only, none', () => {
  const row = (extra) => ({ syllabusStatus: 'approved', open: null, otherSemester: false, plannedHours: 36, plannedPairs: 18, ...extra });
  assert.deepEqual([syllabusBadge(row()), syllabusBadge(row({ open: 'returned' })).key, syllabusBadge(row({ open: 'review' })).key, syllabusBadge(row({ syllabusStatus: 'none', open: 'draft' })).key,
    syllabusBadge(row({ syllabusStatus: 'none', otherSemester: true })).key, syllabusBadge(row({ syllabusStatus: 'none' }))],
  [{ tone: 'success', key: 'subjects.syllabus.approved', params: { hours: 36, pairs: 18 } }, 'subjects.syllabus.returned', 'subjects.syllabus.review', 'subjects.syllabus.draft',
    'subjects.syllabus.other', { tone: 'danger', key: 'subjects.syllabus.none' }]);
  assert.deepEqual([syllabusBadge(row({ open: 'returned' })).tone, syllabusBadge(row({ open: 'review' })).tone, syllabusBadge(row({ open: 'draft' })).tone,
    syllabusBadge(row({ syllabusStatus: 'none', otherSemester: true })).tone], ['warning', 'info', 'neutral', 'neutral']);
});

test('approvedNote: beside the mark of an open version, what is approved now; nothing without an open or an approved version', () => {
  const row = (extra) => ({ syllabusStatus: 'approved', open: null, otherSemester: false, plannedHours: 36, plannedPairs: 18, ...extra });
  assert.deepEqual([approvedNote(row({ open: 'review' })), approvedNote(row()), approvedNote(row({ syllabusStatus: 'none', open: 'draft' }))],
    [{ key: 'subjects.syllabus.approvedNote', params: { hours: 36, pairs: 18 } }, null, null]);
});

test('teacherBadge: the mark of a subject in «Мои предметы»', () => {
  assert.deepEqual([teacherBadge({ approved: true, open: 'returned' }), teacherBadge({ approved: true, open: null }).key, teacherBadge({ approved: false, open: null }).key, teacherBadge(undefined).key],
    [{ tone: 'warning', key: 'home.syllabusState.returned' }, 'home.syllabusState.approved', 'home.syllabusState.none', 'home.syllabusState.none']);
  assert.deepEqual([teacherBadge({ approved: true, open: 'review' }), teacherBadge({ approved: false, open: 'draft' }), teacherBadge({ approved: true, open: null }), teacherBadge(null)],
    [{ tone: 'info', key: 'home.syllabusState.review' }, { tone: 'neutral', key: 'home.syllabusState.draft' }, { tone: 'success', key: 'home.syllabusState.approved' },
      { tone: 'danger', key: 'home.syllabusState.none' }]);
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

test('teacherAction: the teacher who only teaches the discipline opens the syllabus, the responsible one edits it', () => {
  assert.equal(teacherAction({ approved: true, open: null, mine: 'teaches' }), 'open');
  assert.equal(teacherAction({ approved: false, open: 'draft', mine: 'responsible' }), 'edit');
  assert.equal(teacherAction({ approved: false, open: null }), 'edit');
  assert.equal(teacherAction(null), 'edit');
});

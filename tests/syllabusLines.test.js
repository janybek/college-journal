import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEMBER_STATES, SCHEMA, tableNames } from '../core/schema.js';
import {
  LIVE_STATES, joinedLineId, joinedOf, invitedOf, partOf, versionsOfLine, nextVersion, lineSubjects, teacherSubjects, teachingOf, successor,
  isLive, oneJoined, switchLock, linesMigration,
} from '../core/syllabusLines.js';
import { syllabusFor, syllabusIndex } from '../core/syllabus.js';
import { rightsOn, checkHeld } from '../core/syllabusFlow.js';
import { syllabusState } from '../core/dirInfo.js';
import { draftVersion } from '../core/syllabusDoc.js';

const L = { id: 'sl_1', disciplineId: 'ds_1', semester: 1, authorId: 't1' };
const m = (id, teacherId, state, joinedAt = '', lineId = 'sl_1') => ({ id, lineId, disciplineId: 'ds_1', semester: 1, teacherId, state, joinedAt, invitedAt: '2026-09-01 09:00:00' });
const M = [m('sm_1', 't1', 'joined', '2026-09-01 10:00:00'), m('sm_2', 't2', 'joined', '2026-09-02 10:00:00'), m('sm_3', 't3', 'invited'), m('sm_4', 't4', 'left', '2026-09-01 08:00:00')];
const S = [{ id: 'sy_1', lineId: 'sl_1', disciplineId: 'ds_1', teacherId: 't1', semester: 1, status: 'archived', version: 1 },
  { id: 'sy_2', lineId: 'sl_1', disciplineId: 'ds_1', teacherId: 't1', semester: 1, status: 'approved', version: 2 },
  { id: 'sy_3', lineId: 'sl_9', disciplineId: 'ds_1', teacherId: 't2', semester: 1, status: 'approved', version: 7 }];   // прежний свой силлабус t2
const sb = (id, teacherId) => ({ id, disciplineId: 'ds_1', teacherId });

test('the schema: two new tables at the end, the member states, the two new columns of the versions', () => {
  assert.deepEqual(tableNames().slice(-2), ['syllabusLines', 'syllabusMembers']);
  assert.deepEqual(MEMBER_STATES, ['invited', 'joined', 'left', 'declined', 'withdrawn']);
  assert.deepEqual(LIVE_STATES, ['invited', 'joined']);
  assert.deepEqual(SCHEMA.syllabi.columns.slice(-2).map((c) => c.key), ['lineId', 'sourceId']);
  assert.deepEqual(SCHEMA.syllabusLines.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['disciplineId', 'string'], ['semester', 'int'],
    ['authorId', 'string'], ['createdBy', 'string'], ['createdAt', 'string']]);
  assert.deepEqual(SCHEMA.syllabusMembers.columns.map((c) => [c.key, c.type]), [['id', 'string'], ['lineId', 'string'], ['disciplineId', 'string'],
    ['semester', 'int'], ['teacherId', 'string'], ['state', 'string'], ['byId', 'string'], ['invitedAt', 'string'], ['joinedAt', 'string'],
    ['endedAt', 'string'], ['endedBy', 'string']]);
  assert.deepEqual(['syllabusLines', 'syllabusMembers'].map((t) => [SCHEMA[t].sheet, SCHEMA[t].prefix]), [['Линии силлабусов', 'sl'], ['Участники силлабусов', 'sm']]);
  const sheets = Object.values(SCHEMA).map((d) => d.sheet);
  const prefixes = Object.values(SCHEMA).map((d) => d.prefix);
  assert.equal(new Set(sheets).size, sheets.length);
  assert.equal(new Set(prefixes).size, prefixes.length);
});

test('partOf, joinedLineId, joinedOf, invitedOf, successor, oneJoined', () => {
  assert.deepEqual(['t1', 't2', 't3', 't4', 't9'].map((t) => partOf(L, M, t)), ['author', 'member', 'invited', null, null]);
  assert.equal(partOf(L, M, ''), null);
  assert.equal(partOf({ ...L, authorId: '' }, M, ''), null);
  assert.equal(joinedLineId(M, { disciplineId: 'ds_1', teacherId: 't2', semester: 1 }), 'sl_1');
  assert.equal(joinedLineId(M, { disciplineId: 'ds_1', teacherId: 't2', semester: 2 }), null);
  assert.equal(joinedLineId(M, { disciplineId: 'ds_1', teacherId: 't4', semester: 1 }), null);          // вышел
  const two = [...M, m('sm_5', 't2', 'joined', '2026-09-01 07:00:00', 'sl_2')];
  assert.equal(joinedLineId(two, { disciplineId: 'ds_1', teacherId: 't2', semester: 1 }), 'sl_2');       // из нескольких — раньше вступил
  assert.deepEqual(joinedOf(M, 'sl_1').map((r) => r.id), ['sm_1', 'sm_2']);
  assert.deepEqual(invitedOf(M, 'sl_1').map((r) => r.id), ['sm_3']);
  assert.deepEqual([successor(M, 'sl_1', 't1'), successor(M, 'sl_1', 't2'), successor([M[0]], 'sl_1', 't1')], ['t2', 't1', null]);
  assert.deepEqual(oneJoined([...M, m('sm_5', 't2', 'joined', '2026-09-03 10:00:00', 'sl_2')]), ['ds_1|t2|1']);
  assert.deepEqual(oneJoined(M), []);
});

test('versionsOfLine and nextVersion: by the line, and the old key keeps its numbers', () => {
  assert.equal(versionsOfLine(S, 'sl_1').approved.id, 'sy_2');
  assert.deepEqual(versionsOfLine(S, 'sl_1').last, 2);
  assert.deepEqual(versionsOfLine(S, ''), { approved: null, open: null, last: 0 });
  assert.deepEqual(versionsOfLine(S, 'sl_none'), { approved: null, open: null, last: 0 });
  assert.equal(nextVersion(S, 'sl_1', { disciplineId: 'ds_1', teacherId: 't1', semester: 1 }), 3);
  assert.equal(nextVersion(S, 'sl_new', { disciplineId: 'ds_1', teacherId: 't2', semester: 1 }), 8);    // по старому ключу
});

test('syllabusFor, syllabusIndex and lineSubjects follow the line where the teacher leads', () => {
  assert.equal(syllabusFor(sb('sb_2', 't2'), S, 1, M).id, 'sy_2');                                      // участник идёт по общему, а не по своему старому
  assert.equal(syllabusFor(sb('sb_4', 't4'), S, 1, M), null);
  assert.equal(syllabusFor({ id: 'sb_x', teacherId: 't1' }, S, 1, M), null);
  assert.equal(syllabusFor(sb('sb_2', 't2'), S, 1, []), null);
  assert.equal(syllabusIndex(S, [], M).members, M);
  assert.deepEqual(lineSubjects([sb('sb_1', 't1'), sb('sb_2', 't2'), sb('sb_3', 't3'), sb('sb_4', 't4')], L, M).map((s) => s.id), ['sb_1', 'sb_2']);
  assert.deepEqual(teacherSubjects([sb('sb_1', 't1'), sb('sb_2', 't2'), { id: 'sb_5', disciplineId: 'ds_2', teacherId: 't1' }], 'ds_1', 't1').map((s) => s.id), ['sb_1']);
});

test('teachingOf and successor: only those who lead the discipline now count', () => {
  const subjects = [sb('sb_1', 't1'), { id: 'sb_9', disciplineId: 'ds_2', teacherId: 't2' }];
  assert.deepEqual(teachingOf(M, L, subjects).map((r) => r.teacherId), ['t1']);                  // t2 вступил, но предмета дисциплины у него нет
  assert.equal(successor(M, 'sl_1', 't1', new Set(['t1'])), null);
  assert.equal(successor(M, 'sl_1', 't1', new Set(['t2'])), 't2');
  assert.equal(successor(M, 'sl_1', 't1', new Set()), null);
  assert.equal(successor(M, 'sl_1', 't1', null), 't2');
});

test('isLive: someone leads it, or nobody has ever led or left it', () => {
  assert.equal(isLive(L, M), true);
  assert.equal(isLive(L, [m('sm_1', 't1', 'invited')]), true);
  assert.equal(isLive(L, []), true);
  assert.equal(isLive(L, [m('sm_1', 't1', 'left', '2026-09-01 10:00:00')]), false);
  assert.equal(isLive(L, [m('sm_1', 't1', 'left', '2026-09-01 10:00:00'), m('sm_2', 't2', 'invited')]), false);
  assert.equal(isLive(L, [m('sm_1', 't1', 'declined', '', 'sl_other')]), true);
});

test('rightsOn by the place on the line', () => {
  const draft = { id: 'sy_d', status: 'draft', teacherId: 't1' };
  const t = (part, teaches = true) => rightsOn(draft, { id: 'x', roles: ['teacher'], teaches, part });
  const R = (see, edit, submit) => ({ see, edit, submit, approve: false, giveBack: false });
  assert.deepEqual(t('author'), R(true, true, true));
  assert.deepEqual(t('member'), R(true, true, false));
  assert.deepEqual(t('invited'), R(true, false, false));
  assert.deepEqual(t(null), R(false, false, false));
  assert.deepEqual(t('author', false), R(false, false, false));
  assert.deepEqual(t('invited', false), R(false, false, false));
  const dean = rightsOn(draft, { id: 'd', roles: ['dean'], part: null });
  assert.deepEqual(dean, { see: true, edit: true, submit: true, approve: true, giveBack: false });
  assert.deepEqual(rightsOn({ ...draft, status: 'review' }, { id: 'a', roles: ['admin'], part: null }), { see: true, edit: false, submit: false, approve: true, giveBack: true });
  const pro = (status) => rightsOn({ ...draft, status }, { id: 'p', roles: ['prorector'], part: null });
  assert.deepEqual(['draft', 'review', 'returned'].map((s) => pro(s).see), [false, true, true]);
  assert.equal(pro('review').edit || pro('review').approve, false);
  const approved = { ...draft, status: 'approved' };
  assert.equal(rightsOn(approved, { id: 'x', roles: ['teacher'], teaches: true, part: null }).see, true);
  assert.equal(rightsOn(approved, { id: 'x', roles: ['student'] }).see, true);
  assert.deepEqual(rightsOn({ ...draft, status: 'returned' }, { id: 'x', roles: ['teacher'], teaches: true, part: 'member' }), R(true, true, false));
  assert.deepEqual(rightsOn({ ...draft, status: 'review' }, { id: 'x', roles: ['teacher'], teaches: true, part: 'author' }), R(true, false, false));
  // a dean who also teaches: the manager rights win
  assert.equal(rightsOn(draft, { id: 'x', roles: ['dean', 'teacher'], teaches: true, part: 'member' }).submit, true);
  // a viewer without a part (undefined) is on no line: the owner of the old key column gets nothing
  assert.deepEqual(rightsOn(draft, { id: 't1', roles: ['teacher'], teaches: true }), R(false, false, false));
  assert.deepEqual(rightsOn(draft, { id: 't2', roles: ['teacher'], teaches: true }), R(false, false, false));
});

test('checkHeld withSubject names the subject of the pair; without it the answer is the old one', () => {
  const topic = (id, order, unit, name, hours = 2) => ({ id, order, unit, lessonKind: 'lecture', name, hours });
  const approved = [topic('tp_1', 1, 1, 'Тема А', 4), topic('tp_2', 2, 1, 'Тема Б'), topic('tp_3', 3, 1, 'Тема В'), topic('tp_4', 4, 1, 'Тема Г')];
  const pair = (id, subjectId, topicId, date, part = 1, lessonType = 'lecture') => ({ id, subjectId, topicId, date, status: 'closed', part, lessonType, slot: 1 });
  const pairs = [pair('p_1', 'sb_1', 'tp_1', '2026-09-02', 2), pair('p_2', 'sb_2', 'tp_2', '2026-09-03'), pair('p_3', 'sb_3', 'tp_3', '2026-09-04', 1, 'practice'),
    pair('p_4', 'sb_4', 'tp_4', '2026-09-05')];
  // the draft: A has 2 hours (held part 2), Б is missing, В is a lecture, Г moved to unit 2 where its unit is closed
  const draft = [topic('d_1', 1, 1, 'Тема А', 2), topic('d_3', 2, 1, 'Тема В'), { ...topic('d_4', 3, 2, 'Тема Г'), sourceId: 'tp_4' }].map((t, i) => ({ ...t, sourceId: t.sourceId || ['tp_1', 'tp_3'][i] }));
  const closures = [{ subjectId: 'sb_4', planSemester: 1, unit: 1, reopenedAt: '' }];
  const plain = checkHeld(draft, approved, pairs, closures, 1);
  assert.deepEqual(plain.map((e) => e.code), ['held_hours', 'held_missing', 'held_kind', 'held_closed']);
  assert.equal(plain.every((e) => e.subjectId === undefined), true);
  const withSubject = checkHeld(draft, approved, pairs, closures, 1, { withSubject: true });
  assert.deepEqual(withSubject.map((e) => [e.code, e.subjectId]), [['held_hours', 'sb_1'], ['held_missing', 'sb_2'], ['held_kind', 'sb_3'], ['held_closed', 'sb_4']]);
  assert.deepEqual(withSubject.map(({ subjectId, ...rest }) => rest), plain);
});

test('switchLock: a closed unit, an exam, or nothing', () => {
  const closure = (extra) => ({ subjectId: 'sb_1', planSemester: 1, unit: 1, reopenedAt: '', ...extra });
  const none = { closures: [], subjectExams: [], examAttempts: [] };
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, closures: [closure()] }), 'unit_closed');
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, closures: [closure({ unit: 0 })] }), 'unit_closed');                 // итоговая
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, closures: [closure({ reopenedAt: '2026-10-01 10:00:00' })] }), null);
  assert.equal(switchLock('sb_1', new Set([2]), { ...none, closures: [closure()] }), null);
  assert.equal(switchLock('sb_2', new Set([1]), { ...none, closures: [closure()] }), null);
  assert.equal(switchLock('sb_1', new Set([null]), { ...none, closures: [closure({ planSemester: null })] }), 'unit_closed');
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, subjectExams: [{ subjectId: 'sb_1', planSemester: 1 }] }), 'exam_exists');
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, examAttempts: [{ subjectId: 'sb_1', planSemester: 1 }] }), 'exam_exists');
  assert.equal(switchLock('sb_1', new Set([1]), { ...none, closures: [closure()], subjectExams: [{ subjectId: 'sb_1', planSemester: 1 }] }), 'unit_closed');
  assert.equal(switchLock('sb_1', new Set(), { ...none, closures: [closure()] }), null);
  assert.equal(switchLock('sb_1', new Set([1]), none), null);
});

test('linesMigration: the three cases, the skipped rows and a second run', () => {
  const v = (id, teacherId, extra = {}) => ({ id, lineId: '', disciplineId: 'ds_1', teacherId, semester: 1, status: 'draft', version: 1, ...extra });
  // (в): nobody leads it yet -> a new line, joined
  const alone = linesMigration([v('sy_1', 't1'), v('sy_2', 't1', { version: 2 })], [], []);
  assert.deepEqual(alone, { groups: [{ key: { disciplineId: 'ds_1', teacherId: 't1', semester: 1 }, versionIds: ['sy_1', 'sy_2'], lineId: null, member: 'joined' }], skipped: [] });
  // (а): the teacher is the author of a line of the discipline and the half -> that line
  const line = { id: 'sl_1', disciplineId: 'ds_1', semester: 1, authorId: 't1' };
  const members = [m('sm_1', 't1', 'joined', '2026-09-01 10:00:00'), m('sm_2', 't2', 'joined', '2026-09-02 10:00:00')];
  assert.deepEqual(linesMigration([v('sy_1', 't1')], [line], members).groups, [{ key: { disciplineId: 'ds_1', teacherId: 't1', semester: 1 }, versionIds: ['sy_1'], lineId: 'sl_1', member: null }]);
  // (а): the only joined of a line without an author
  const ready = { ...line, authorId: '' };
  assert.equal(linesMigration([v('sy_1', 't1')], [ready], [m('sm_1', 't1', 'joined', '2026-09-01 10:00:00')]).groups[0].lineId, 'sl_1');
  // (б): a plain member of a line -> a line of history, left
  assert.deepEqual(linesMigration([v('sy_5', 't2')], [line], members).groups, [{ key: { disciplineId: 'ds_1', teacherId: 't2', semester: 1 }, versionIds: ['sy_5'], lineId: null, member: 'left' }]);
  // (б): an approved version under the key of the new author of a line that already has an approved one with another teacherId
  const onLine = { id: 'sy_0', lineId: 'sl_1', disciplineId: 'ds_1', teacherId: 't1', semester: 1, status: 'approved', version: 3 };
  const stray = v('sy_6', 't2', { status: 'approved' });
  const swapped = { ...line, authorId: 't2' };
  assert.deepEqual(linesMigration([onLine, stray], [swapped], members).groups.map((g) => [g.lineId, g.member]), [[null, 'left']]);
  // ... but a draft under that key still goes to the line, and so does an approved one when the line has none
  assert.equal(linesMigration([onLine, v('sy_7', 't2')], [swapped], members).groups[0].lineId, 'sl_1');
  assert.equal(linesMigration([stray], [swapped], members).groups[0].lineId, 'sl_1');
  // skipped: no discipline, no teacher, a half that is not 1 or 2
  const bad = linesMigration([v('sy_a', 't1', { disciplineId: '' }), v('sy_b', '', {}), v('sy_c', 't1', { semester: 3 }), v('sy_d', 't1', { semester: null })], [], []);
  assert.deepEqual([bad.groups, bad.skipped], [[], ['sy_a', 'sy_b', 'sy_c', 'sy_d']]);
  // a second run over moved rows does nothing
  assert.deepEqual(linesMigration([v('sy_1', 't1', { lineId: 'sl_1' })], [line], members), { groups: [], skipped: [] });
});

test('syllabusState keeps its form and takes the versions of the line where the teacher leads', () => {
  const key = { disciplineId: 'ds_1', teacherId: 't2', semester: 1 };
  const viewer = { id: 'sf_d', roles: ['dean'] };
  assert.deepEqual(syllabusState(S, key, viewer, M), { approved: true, open: null });
  assert.deepEqual(syllabusState(S, { ...key, teacherId: 't4' }, viewer, M), { approved: false, open: null });
  const withDraft = [...S, { id: 'sy_4', lineId: 'sl_1', disciplineId: 'ds_1', teacherId: 't1', semester: 1, status: 'review', version: 3 }];
  assert.deepEqual(syllabusState(withDraft, key, viewer, M), { approved: true, open: 'review' });
  assert.deepEqual(syllabusState(withDraft, key, { id: 't2', roles: ['teacher'] }, M), { approved: true, open: null });
  assert.deepEqual(syllabusState(withDraft, key, { id: 'p', roles: ['prorector'] }, M), { approved: true, open: 'review' });
});

test('draftVersion on a line: the discipline and half of the line, the author, the line id and the copy source', () => {
  const approved = { id: 'sy_2', status: 'approved', department: 'Кафедра', goal: 'Цель', planSemester: 1, course: 1, manualOrder: true, fileId: '' };
  const row = draftVersion({ line: L, teacherId: 't1', approved, planSemester: 1, course: 1, userId: 'sf_u', today: '2026-09-10', number: 3 });
  assert.deepEqual([row.disciplineId, row.semester, row.teacherId, row.lineId, row.sourceId, row.status, row.version, row.editedBy],
    ['ds_1', 1, 't1', 'sl_1', 'sy_2', 'draft', 3, 'sf_u']);
  const first = draftVersion({ line: L, teacherId: '', approved: null, planSemester: 3, course: 2, userId: 'sf_u', today: '2026-09-10', number: 1 });
  assert.deepEqual([first.teacherId, first.sourceId, first.lineId, first.planSemester, first.course], ['', '', 'sl_1', 3, 2]);
});

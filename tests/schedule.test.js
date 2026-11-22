import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workingDays, planGeneration, pairLock, checkPairChange, isSubstitution, teacherHandover } from '../core/schedule.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { AppError } from '../core/errors.js';

const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: ['2026-09-07'], bells: DEFAULT_BELLS };
const subjects = [{ id: 'sb_1', groupId: 'g_1', teacherId: 'sf_1' }, { id: 'sb_2', groupId: 'g_2', teacherId: 'sf_2' }, { id: 'sb_3', groupId: 'g_1', teacherId: 'sf_2' }];
const T = [{ id: 'wt_1', weekday: 2, slot: 1, subjectId: 'sb_1', roomId: 'r_1' },
  { id: 'wt_2', weekday: 1, slot: 2, subjectId: 'sb_1', roomId: 'r_1' },
  { id: 'wt_3', weekday: 5, slot: 1, subjectId: 'sb_2', roomId: '' }];
const first = planGeneration({ template: T, subjects, settings: S, pairs: [], from: '2026-09-01' });
const E = first.toInsert.map((p, i) => ({ ...p, id: 'p' + (i + 1) }));

test('workingDays', () => {
  assert.deepEqual(workingDays(S), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  assert.deepEqual(workingDays(S, '2026-09-05'), ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
});

test('planGeneration: first run and repeat', () => {
  assert.deepEqual(first.toInsert.map(p => [p.date, p.slot, p.groupId, p.subjectId]),
    [['2026-09-01', 1, 'g_1', 'sb_1'], ['2026-09-04', 1, 'g_2', 'sb_2'], ['2026-09-08', 1, 'g_1', 'sb_1'], ['2026-09-11', 1, 'g_2', 'sb_2']]);
  assert.deepEqual(first.toInsert[0], { date: '2026-09-01', slot: 1, startTime: '08:00', groupId: 'g_1', subjectId: 'sb_1', teacherId: 'sf_1',
    roomId: 'r_1', topicId: '', lessonType: '', part: null, status: 'planned', planDate: '2026-09-01', planSlot: 1, changed: false, note: '' });
  assert.equal(first.toInsert.every((p) => p.topicId === '' && p.lessonType === '' && p.part === null), true);
  assert.deepEqual(planGeneration({ template: T, subjects, settings: S, pairs: E, from: '2026-09-01' }),
    { toInsert: [], toUpdate: [], toRemove: [], kept: 4, conflicts: 0 });
});

test('planGeneration: changes, removals, locked pairs', () => {
  const T2 = T.map(r => (r.id === 'wt_1' ? { ...r, roomId: 'r_2' } : r));
  const subjects2 = subjects.map(s => (s.id === 'sb_2' ? { ...s, teacherId: 'sf_3' } : s));
  const E2 = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-09', slot: 2, startTime: '09:40', changed: true } : p));
  assert.deepEqual(planGeneration({ template: T2, subjects: subjects2, settings: S, pairs: E2, from: '2026-09-01' }),
    { toInsert: [], toUpdate: [{ id: 'p1', patch: { roomId: 'r_2' } }, { id: 'p2', patch: { teacherId: 'sf_3' } }, { id: 'p4', patch: { teacherId: 'sf_3' } }],
      toRemove: [], kept: 1, conflicts: 0 });
  assert.deepEqual(planGeneration({ template: T2, subjects: subjects2, settings: S, pairs: E2, from: '2026-09-05' }),
    { toInsert: [], toUpdate: [{ id: 'p4', patch: { teacherId: 'sf_3' } }], toRemove: [], kept: 1, conflicts: 0 });
  const E3 = E.map(p => (p.id === 'p4' ? { ...p, status: 'cancelled', changed: true } : p));
  assert.deepEqual(planGeneration({ template: T.slice(0, 2), subjects, settings: S, pairs: E3, from: '2026-09-01' }),
    { toInsert: [], toUpdate: [], toRemove: ['p2'], kept: 3, conflicts: 0 });
  const E4 = E.map(p => (p.id === 'p1' ? { ...p, status: 'closed' } : p));
  assert.deepEqual(planGeneration({ template: T2, subjects, settings: S, pairs: E4, from: '2026-09-01' }).toUpdate, [{ id: 'p3', patch: { roomId: 'r_2' } }]);
});

test('planGeneration: a changed subject empties the whole lesson', () => {
  const T6 = T.map((r) => (r.id === 'wt_1' ? { ...r, subjectId: 'sb_3' } : r));
  const E6 = E.map((p) => (p.id === 'p1' ? { ...p, topicId: 'tp_1', lessonType: 'lecture', part: 1 } : p));
  assert.deepEqual(planGeneration({ template: T6, subjects, settings: S, pairs: E6, from: '2026-09-01' }).toUpdate.find((u) => u.id === 'p1').patch,
    { subjectId: 'sb_3', teacherId: 'sf_2', topicId: '', lessonType: '', part: null });
});

test('planGeneration: busy places', () => {
  const T5 = [...T, { id: 'wt_4', weekday: 4, slot: 3, subjectId: 'sb_3', roomId: '' }];
  const E5 = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-10', slot: 3, startTime: '11:20', changed: true } : p));
  const busy = planGeneration({ template: T5, subjects, settings: S, pairs: E5, from: '2026-09-01' });
  assert.deepEqual([busy.toInsert.map(p => [p.date, p.slot, p.subjectId]), busy.conflicts], [[['2026-09-03', 3, 'sb_3']], 1]);
  const TR = [...T, { id: 'wt_5', weekday: 4, slot: 3, subjectId: 'sb_2', roomId: 'r_1' }];
  const roomBusy = planGeneration({ template: TR, subjects, settings: S, pairs: E5, from: '2026-09-01' });
  assert.deepEqual([roomBusy.toInsert.map(p => [p.date, p.slot, p.subjectId]), roomBusy.conflicts], [[['2026-09-03', 3, 'sb_2']], 1]);
  const E7 = E.map(p => (p.id === 'p1' ? { ...p, teacherId: 'sf_2', changed: true } : p));
  const TT = [...T, { id: 'wt_6', weekday: 2, slot: 1, subjectId: 'sb_2', roomId: '' }];
  const teacherBusy = planGeneration({ template: TT, subjects, settings: S, pairs: E7, from: '2026-09-01' });
  assert.deepEqual([teacherBusy.toInsert.map(p => [p.date, p.slot, p.subjectId]), teacherBusy.conflicts], [[['2026-09-08', 1, 'sb_2']], 1]);
  const T2 = T.map(r => (r.id === 'wt_1' ? { ...r, roomId: 'r_2' } : r));
  const E8 = E.map(p => (p.id === 'p2' ? { ...p, date: '2026-09-08', slot: 1, roomId: 'r_2', changed: true } : p));
  assert.deepEqual(planGeneration({ template: T2, subjects, settings: S, pairs: E8, from: '2026-09-01' }),
    { toInsert: [], toUpdate: [{ id: 'p1', patch: { roomId: 'r_2' } }], toRemove: [], kept: 2, conflicts: 1 });
});

test('planGeneration: duplicates, bells, restart', () => {
  assert.deepEqual(planGeneration({ template: T, subjects, settings: S, pairs: [...E, { ...E[0], id: 'p5' }], from: '2026-09-01' }).toRemove, ['p5']);
  assert.deepEqual(planGeneration({ template: [{ id: 'wt_9', weekday: 2, slot: 7, subjectId: 'sb_1', roomId: '' }], subjects, settings: S, pairs: [], from: '2026-09-01' }),
    { toInsert: [], toUpdate: [], toRemove: [], kept: 0, conflicts: 2 });
  const E2 = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-09', slot: 2, startTime: '09:40', changed: true } : p));
  const again = planGeneration({ template: T, subjects, settings: S, pairs: E2, from: '2026-09-01', restart: true });
  assert.deepEqual([again.toRemove, again.toInsert.length, again.toUpdate, again.kept], [['p1', 'p2', 'p3', 'p4'], 4, [], 0]);
});

const staff = [{ id: 'sf_1', roles: 'teacher', active: true }, { id: 'sf_2', roles: 'dean,teacher', active: true },
  { id: 'sf_3', roles: 'dean', active: true }, { id: 'sf_4', roles: 'teacher', active: false }];
const rooms = [{ id: 'r_1' }, { id: 'r_2' }];
const p6 = { id: 'p6', groupId: 'g_1', subjectId: 'sb_3', date: '2026-09-09', slot: 2, teacherId: 'sf_2', roomId: 'r_2', status: 'planned' };
const p7 = { id: 'p7', groupId: 'g_2', subjectId: 'sb_2', date: '2026-09-09', slot: 3, teacherId: 'sf_2', roomId: 'r_1', status: 'planned' };
const ctx = { pairs: [...E, p6, p7], staff, rooms, settings: S, today: '2026-09-02' };
const p3 = E[2];
const errors = (patch, c = ctx) => checkPairChange(p3, patch, c).errors;

test('checkPairChange', () => {
  assert.deepEqual(checkPairChange(p3, {}, ctx), { errors: [],
    next: { date: '2026-09-08', slot: 1, startTime: '08:00', teacherId: 'sf_1', roomId: 'r_1', note: '', changed: false, substitute: false } });
  assert.deepEqual(checkPairChange(p3, { date: '2026-09-09', slot: 3, roomId: '', note: ' Конференция ' }, ctx).next,
    { date: '2026-09-09', slot: 3, startTime: '11:20', teacherId: 'sf_1', roomId: '', note: 'Конференция', changed: true, substitute: false });
  assert.deepEqual(errors({ date: '2026-09-09', slot: 2 }), [{ field: 'slot', code: 'group_busy' }]);
  assert.deepEqual(errors({ date: '2026-09-09', slot: 3 }), [{ field: 'roomId', code: 'room_busy' }]);
  assert.deepEqual(errors({ date: '2026-09-09', slot: 3, roomId: 'r_2', teacherId: 'sf_2' }), [{ field: 'teacherId', code: 'teacher_busy' }]);
  assert.deepEqual(errors({ date: '2026-09-09', slot: 2 }, { ...ctx, pairs: [...E, { ...p6, status: 'cancelled' }, p7] }), []);
  assert.deepEqual(errors({ date: '2026-09-05' }), []);
  assert.deepEqual(errors({ date: '2026-09-06' }), [{ field: 'date', code: 'day_off' }]);
  assert.deepEqual(errors({ date: '2026-09-07' }), [{ field: 'date', code: 'day_off' }]);
  assert.deepEqual(errors({ date: '2026-09-12' }), [{ field: 'date', code: 'out_of_semester' }]);
  assert.deepEqual(errors({ date: '2026-09-01' }), [{ field: 'date', code: 'in_past' }]);
  assert.deepEqual(errors({ date: 'завтра', slot: 7 }), [{ field: 'date', code: 'bad_value' }, { field: 'slot', code: 'bad_value' }]);
  assert.deepEqual(errors({ teacherId: 'sf_x' }), [{ field: 'teacherId', code: 'bad_ref' }]);
  assert.deepEqual(errors({ teacherId: 'sf_3' }), [{ field: 'teacherId', code: 'bad_value' }]);
  assert.deepEqual(errors({ teacherId: 'sf_4' }), [{ field: 'teacherId', code: 'bad_value' }]);
  assert.deepEqual(errors({ roomId: 'r_x', note: 'x'.repeat(201) }), [{ field: 'roomId', code: 'bad_ref' }, { field: 'note', code: 'too_long' }]);
});

test('pairLock', () => {
  assert.equal(pairLock(p3, '2026-09-08'), null);
  assert.equal(pairLock(p3, '2026-09-09'), 'in_past');
  assert.equal(pairLock({ ...p3, status: 'closed' }, '2026-09-02'), 'pair_locked');
});

test('planGeneration: restart is refused when a pair was held', () => {
  const held = E.map(p => (p.id === 'p1' ? { ...p, status: 'closed' } : p));
  assert.throws(() => planGeneration({ template: T, subjects, settings: S, pairs: held, from: '2026-09-01', restart: true }),
    e => e instanceof AppError && e.code === 'in_use');
  const soft = E.map(p => (p.id === 'p1' ? { ...p, status: 'cancelled', changed: true } : p));
  const r = planGeneration({ template: T, subjects, settings: S, pairs: soft, from: '2026-09-01', restart: true });
  assert.deepEqual([r.toRemove, r.toInsert.length], [['p1', 'p2', 'p3', 'p4'], 4]);
});

test('planGeneration: plan key taken by a fixed pair', () => {
  const fixed = { ...E[0], id: 'p9', status: 'cancelled', changed: true };
  const dup = { ...E[0], id: 'p8' };
  const r = planGeneration({ template: T, subjects, settings: S, pairs: [fixed, dup, E[1], E[2], E[3]], from: '2026-09-01' });
  assert.deepEqual(r, { toInsert: [], toUpdate: [], toRemove: ['p8'], kept: 4, conflicts: 0 });
  const none = planGeneration({ template: T, subjects, settings: S, pairs: [fixed, E[1], E[2], E[3]], from: '2026-09-01' });
  assert.deepEqual([none.toInsert, none.conflicts], [[], 0]);
});

test('planGeneration: from must be a date', () => {
  for (const from of [undefined, '', 'soon']) {
    assert.throws(() => planGeneration({ template: T, subjects, settings: S, pairs: E, from }),
      e => e instanceof AppError && e.code === 'bad_request');
  }
});

test('checkPairChange: null room means no room', () => {
  assert.equal(checkPairChange(p3, { roomId: null }, ctx).next.roomId, '');
  assert.deepEqual(errors({ roomId: null }), []);
});

test('planGeneration: a moved pair whose plan date has passed still occupies its place', () => {
  const T5 = [...T, { id: 'wt_4', weekday: 4, slot: 3, subjectId: 'sb_3', roomId: '' }];
  // p3 was planned for 2026-09-08 and hand-moved to Thursday 2026-09-10, pair 3; generation runs on 2026-09-09
  const moved = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-10', slot: 3, startTime: '11:20', changed: true } : p));
  const plan = planGeneration({ template: T5, subjects, settings: S, pairs: moved, from: '2026-09-09' });
  assert.deepEqual([plan.toInsert, plan.conflicts], [[], 1]);
  // the same for a teacher and for a room
  const TT = [...T, { id: 'wt_6', weekday: 4, slot: 3, subjectId: 'sb_2', roomId: '' }];
  const teacher = planGeneration({ template: TT, subjects: subjects.map(s => (s.id === 'sb_2' ? { ...s, teacherId: 'sf_1' } : s)), settings: S, pairs: moved, from: '2026-09-09' });
  assert.deepEqual([teacher.toInsert, teacher.conflicts], [[], 1]);
  const TR = [...T, { id: 'wt_7', weekday: 4, slot: 3, subjectId: 'sb_2', roomId: 'r_1' }];
  const room = planGeneration({ template: TR, subjects, settings: S, pairs: moved.map(p => (p.id === 'p3' ? { ...p, roomId: 'r_1' } : p)), from: '2026-09-09' });
  assert.deepEqual([room.toInsert, room.conflicts], [[], 1]);
});

test('planGeneration: before the semester starts, earlier planned pairs are removed, held ones stay', () => {
  const later = { ...S, semesterStart: '2026-09-04' };
  const held = E.map(p => (p.id === 'p2' ? { ...p, status: 'closed' } : p));
  const plan = planGeneration({ template: T, subjects, settings: later, pairs: held, from: '2026-08-31' });
  assert.deepEqual(plan.toRemove, ['p1']);
  assert.deepEqual([plan.toInsert, plan.toUpdate, plan.conflicts], [[], [], 0]);
});

test('planGeneration: a new bell reaches manually changed pairs, only the time', () => {
  const bells = ['08:30', ...DEFAULT_BELLS.slice(1)];
  const subst = E.map(p => (p.id === 'p1' ? { ...p, teacherId: 'sf_2', changed: true } : p));
  const plan = planGeneration({ template: T, subjects, settings: { ...S, bells }, pairs: subst, from: '2026-09-01' });
  assert.deepEqual(plan.toUpdate.find(u => u.id === 'p1'), { id: 'p1', patch: { startTime: '08:30' } });
  assert.equal(plan.toUpdate.length, 4);
  // a cancelled pair and a pair before `from` are left alone
  const cancelled = E.map(p => (p.id === 'p1' ? { ...p, status: 'cancelled', changed: true } : p));
  assert.equal(planGeneration({ template: T, subjects, settings: { ...S, bells }, pairs: cancelled, from: '2026-09-01' }).toUpdate.some(u => u.id === 'p1'), false);
  assert.equal(planGeneration({ template: T, subjects, settings: { ...S, bells }, pairs: subst, from: '2026-09-02' }).toUpdate.some(u => u.id === 'p1'), false);
});

test('checkPairChange: only a real change freezes the pair', () => {
  const free = { ...p3, changed: false, note: '' };
  const next = (patch) => checkPairChange(free, patch, { ...ctx, pairs: [...ctx.pairs.filter(p => p.id !== 'p3'), free] }).next;
  assert.equal(next({ note: 'Принести халаты' }).changed, false);
  assert.equal(next({}).changed, false);
  assert.equal(next({ roomId: 'r_2' }).changed, true);
  assert.equal(next({ slot: 4 }).changed, true);
  assert.equal(next({ teacherId: 'sf_2' }).changed, true);
  assert.equal(checkPairChange({ ...free, changed: true }, { note: 'x' }, ctx).next.changed, true);
});

test('isSubstitution: a stored fact; before unit 3 a moved pair of a foreign teacher is one', () => {
  assert.equal(isSubstitution({ substitute: true, changed: false, status: 'closed', teacherId: 'x' }, { teacherId: 'x' }), true);
  assert.equal(isSubstitution({ substitute: false, changed: false, status: 'planned', teacherId: 'old' }, { teacherId: 'new' }), false);
  assert.equal(isSubstitution({ substitute: false, changed: true, status: 'planned', teacherId: 'sub' }, { teacherId: 'own' }), true);
  assert.equal(isSubstitution({ substitute: false, changed: true, status: 'closed', teacherId: 'old' }, { teacherId: 'new' }), false);
  assert.equal(isSubstitution({ substitute: false, changed: true, status: 'planned', teacherId: 'sub' }, undefined), false);
});

test('checkPairChange: next.substitute follows the teacher of the subject', () => {
  const subject = { id: 'sb_1', teacherId: 'sf_1' };
  const sub = (patch, pair = p3, extra = {}) => checkPairChange(pair, patch, { ...ctx, subject, ...extra }).next.substitute;
  assert.equal(sub({ teacherId: 'sf_2' }), true);
  assert.equal(sub({ teacherId: 'sf_1' }, { ...p3, teacherId: 'sf_2', substitute: true }), false);
  assert.equal(sub({ date: '2026-09-09', slot: 3 }), false);
  assert.equal(checkPairChange({ ...p3, substitute: true }, { note: 'x' }, ctx).next.substitute, true);
  assert.equal(checkPairChange(p3, { note: 'x' }, ctx).next.substitute, false);
});

test('teacherHandover: three kinds of patches', () => {
  const subject = { id: 'sb_1', teacherId: 'new' };
  const mk = (id, over) => ({ id, subjectId: 'sb_1', groupId: 'g_1', date: '2026-09-10', slot: 1, teacherId: 'old', roomId: '', status: 'planned', ...over });
  const pairs = [
    mk('go', {}),
    mk('busy', { date: '2026-09-11' }),
    mk('newBusy', { id: 'nb', subjectId: 'sb_9', groupId: 'g_2', date: '2026-09-11', teacherId: 'new' }),
    mk('back', { date: '2026-09-12', teacherId: 'new', substitute: true }),
    mk('past', { date: '2026-08-20', teacherId: 'new', substitute: true, status: 'closed' }),
    mk('own', { date: '2026-09-13', teacherId: 'new', substitute: false }),
    mk('other', { date: '2026-09-14', teacherId: 'sub', substitute: true }),
    mk('closedOld', { date: '2026-08-21', status: 'closed' }),
  ];
  assert.deepEqual(teacherHandover(pairs, subject, '2026-09-01', 'old'), { patches: [
    { id: 'go', patch: { teacherId: 'new', substitute: false } },
    { id: 'busy', patch: { substitute: true } },
    { id: 'back', patch: { substitute: false } },
    { id: 'past', patch: { substitute: false } },
  ], skippedBusy: 1 });
});

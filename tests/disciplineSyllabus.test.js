import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mainLine, ownLines, waitingHalves, lineFor, versionsOfLine, openRows, reviewRows, nextVersion, teacherSubjects, lineSubjects, partOf, switchLock,
  versionTeacher, responsibleOf, oneMain, draftTarget, disciplineMigration,
} from '../core/disciplineSyllabus.js';
import { rightsOn, checkHeld } from '../core/syllabusFlow.js';
import { draftVersion } from '../core/syllabusDoc.js';

const line = (id, kind, over = {}) => ({ id, disciplineId: 'ds_1', kind, semester: null, teacherId: '', responsibleId: '', dueDate: '', reviewDue: '', createdBy: '', createdAt: '2026-09-01 09:00:00', ...over });
const MAIN = line('sl_1', 'main', { responsibleId: 't1' });
const OWN = [line('sl_2', 'own', { semester: 1, teacherId: 't1' }), line('sl_3', 'own', { semester: 1, teacherId: 't2' })];
const key = (teacherId, semester = 1) => ({ disciplineId: 'ds_1', teacherId, semester });
const v = (id, lineId, semester, status, version, teacherId = 't1') => ({ id, lineId, disciplineId: 'ds_1', teacherId, semester, status, version });
const sb = (id, teacherId, disciplineId = 'ds_1') => ({ id, disciplineId, teacherId });
const SB = [sb('sb_1', 't1'), sb('sb_2', 't2')];
const T = (id) => ({ id, roles: ['teacher'] });

test('lineFor: the line a subject follows', () => {
  assert.equal(lineFor([MAIN], key('t9')), 'sl_1');                                                 // кто бы ни вёл — силлабус дисциплины
  assert.deepEqual(['t1', 't2', 't3'].map((t) => lineFor(OWN, key(t))), ['sl_2', 'sl_3', null]);   // ждёт выбора: по своему или без тем
  assert.equal(lineFor([OWN[0]], key('t3')), 'sl_2');                                               // один в половине — по нему идут все
  assert.equal(lineFor([line('sl_9', 'archived', { semester: 1, teacherId: 't3' })], key('t3')), null);
  assert.equal(lineFor([], key('t1')), null);
  assert.equal(lineFor(OWN, key('')), null);                                                        // «свой» без преподавателя не находится
  assert.equal(lineFor([MAIN, ...OWN], key('t3')), null);                                           // половина ждёт выбора: у t3 «своего» нет
  assert.equal(lineFor([MAIN, ...OWN], key('t3', 2)), 'sl_1');                                      // в весне нет «своих» — идут по главному
  assert.equal(lineFor([MAIN], { disciplineId: 'ds_2', teacherId: 't1', semester: 1 }), null);
  assert.equal(lineFor(undefined, key('t1')), null);
});

test('mainLine, ownLines, waitingHalves, oneMain', () => {
  const early = line('sl_9', 'main', { createdAt: '2026-08-01 09:00:00' });
  assert.equal(mainLine([MAIN, early], 'ds_1').id, 'sl_9');                                         // из нескольких — более ранняя
  assert.equal(mainLine([line('sl_a', 'main', { createdAt: 'x' }), line('sl_b', 'main', { createdAt: 'x' })], 'ds_1').id, 'sl_a');
  assert.equal(mainLine(OWN, 'ds_1'), null);
  assert.deepEqual(ownLines([...OWN, line('sl_4', 'own', { semester: 2, teacherId: 't1' })], 'ds_1', 1).map((l) => l.id), ['sl_2', 'sl_3']);
  assert.deepEqual([waitingHalves([MAIN, ...OWN], 'ds_1'), waitingHalves([OWN[0]], 'ds_1')], [[1], []]);
  assert.deepEqual(waitingHalves([...OWN, line('sl_4', 'own', { semester: 2, teacherId: 't1' }), line('sl_5', 'own', { semester: 2, teacherId: 't2' })], 'ds_1'), [1, 2]);
  assert.deepEqual([oneMain([MAIN, early, line('sl_8', 'main', { disciplineId: 'ds_2' })]), oneMain([MAIN, ...OWN])], [['ds_1'], []]);
});

const S = [v('sy_1', 'sl_1', 1, 'approved', 2), v('sy_2', 'sl_1', 2, 'approved', 2), v('sy_3', 'sl_1', 1, 'draft', 3), v('sy_4', '', 1, 'approved', 7, 't2')];

test('versionsOfLine, openRows, reviewRows, nextVersion', () => {
  assert.deepEqual([versionsOfLine(S, 'sl_1', 1).approved.id, versionsOfLine(S, 'sl_1', 1).open.id, versionsOfLine(S, 'sl_1', 2).open], ['sy_1', 'sy_3', null]);
  assert.deepEqual(versionsOfLine(S, '', 1), { approved: null, open: null, last: 0 });                // пустой lineId: строки без линии не склеиваются
  assert.deepEqual(versionsOfLine(S, 'sl_1', 1).last, 3);
  assert.deepEqual(openRows(S, 'sl_1').map((s) => s.id), ['sy_3']);
  const both = [...S, v('sy_5', 'sl_1', 2, 'review', 4), v('sy_6', 'sl_1', 2, 'draft', 3)];
  assert.deepEqual(openRows(both, 'sl_1').map((s) => s.id), ['sy_3', 'sy_5']);                       // по половине
  assert.deepEqual(reviewRows(both, 'sl_1').map((s) => s.id), ['sy_5']);
  assert.deepEqual([openRows(S, ''), reviewRows(S, 'sl_none')], [[], []]);
  assert.equal(nextVersion(S, 'sl_1', { disciplineId: 'ds_1', teacherId: 't1' }), 4);
  assert.equal(nextVersion(S, 'sl_1', { disciplineId: 'ds_1', teacherId: 't2' }), 8);               // по старому ключу — для отката
  assert.equal(nextVersion([], '', { disciplineId: 'ds_1', teacherId: 't1' }), 1);
});

test('partOf, lineSubjects, teacherSubjects', () => {
  assert.deepEqual(['t1', 't2', 't9'].map((t) => partOf(MAIN, t, SB, [MAIN])), ['responsible', 'teaches', null]);
  assert.equal(partOf(line('sl_5', 'main', { responsibleId: 't9' }), 't9', SB, [MAIN]), 'responsible');   // ответственный, который не ведёт
  assert.deepEqual(['t1', 't2'].map((t) => partOf(OWN[0], t, SB, OWN)), ['responsible', null]);          // половина ждёт выбора: чужой «свой» закрыт
  assert.equal(partOf(OWN[0], 't2', SB, [OWN[0]]), 'teaches');                                      // единственный в половине: по нему идёт и группа t2 — он читает
  assert.equal(partOf(OWN[0], 't9', SB, [OWN[0]]), null);                                          // единственный в половине, но t9 дисциплину не ведёт — закрыт
  assert.equal(partOf(OWN[0], 't1', [], OWN), null);                                               // владелец «своего» больше не ведёт дисциплину
  assert.equal(partOf(line('sl_6', 'archived', { semester: 1, teacherId: 't1' }), 't1', SB, [MAIN]), null);
  assert.deepEqual([partOf(null, 't1', SB, []), partOf(MAIN, '', SB, [MAIN]), partOf(MAIN, ['t1'], SB, [MAIN]), partOf(MAIN, undefined, SB, [MAIN])], [null, null, null, null]);
  assert.deepEqual(lineSubjects(SB, MAIN, [MAIN], 1).map((s) => s.id), ['sb_1', 'sb_2']);
  assert.deepEqual(lineSubjects(SB, OWN[1], OWN, 1).map((s) => s.id), ['sb_2']);
  assert.deepEqual(lineSubjects([...SB, sb('sb_3', 't1', 'ds_2')], MAIN, [MAIN], 1).map((s) => s.id), ['sb_1', 'sb_2']);
  assert.deepEqual(teacherSubjects(SB, 'ds_1', 't2').map((s) => s.id), ['sb_2']);
});

test('draftTarget: where a new draft goes', () => {
  assert.deepEqual(draftTarget([], [], SB, key('t2'), T('t2')), { code: 'ok', line: null, make: { responsibleId: 't2' }, claim: false });
  assert.equal(draftTarget([MAIN], S, SB, key('t2'), T('t2')).code, 'forbidden');                   // силлабус есть — правит только ответственный
  assert.deepEqual([draftTarget(OWN, [], SB, key(''), { id: 'd', roles: ['dean'] }).code, draftTarget(OWN, [], SB, key('t1', 2), T('t1')).code], ['choose_first', 'choose_first']);
  const dean = { id: 'd', roles: ['dean'] };
  // (1) несколько «своих» в половине: линия этого преподавателя
  assert.equal(draftTarget(OWN, [], SB, key('t1'), T('t1')).line.id, 'sl_2');
  assert.equal(draftTarget(OWN, [], SB, key('t1'), T('t2')).code, 'forbidden');                      // чужой «свой»
  assert.equal(draftTarget(OWN, [], SB, key('t1'), dean).line.id, 'sl_2');
  assert.equal(draftTarget(OWN, [], SB, key('t3'), dean).code, 'choose_first');                      // у t3 своего нет
  assert.equal(draftTarget(OWN, [], [], key('t1'), T('t1')).code, 'forbidden');                      // владелец больше не ведёт
  // (2) одна «своя»
  assert.equal(draftTarget([OWN[0]], [], SB, key('t2'), T('t1')).line.id, 'sl_2');
  assert.equal(draftTarget([OWN[0]], [], SB, key('t2'), T('t2')).code, 'forbidden');
  assert.equal(draftTarget([OWN[0]], [], SB, key('t2'), dean).code, 'ok');
  // (3) своих в этой половине нет, а другая ждёт выбора — эта половина идёт по «главному» (смотрим только на запрошенную половину)
  assert.equal(draftTarget([MAIN, ...OWN], [], SB, key('t1', 2), dean).code, 'ok');
  assert.equal(draftTarget([MAIN, ...OWN], [], SB, key('t1', 2), T('t1')).code, 'ok');             // t1 ведёт и он ответственный
  assert.equal(draftTarget([], [], SB, key('t1', 2), dean).line, null);
  // не ведущий преподаватель не узнаёт, что ждёт выбора: forbidden раньше choose_first
  assert.equal(draftTarget(OWN, [], SB, key('t3'), T('t9')).code, 'forbidden');
  assert.equal(draftTarget(OWN, [], SB, key(''), T('t9')).code, 'forbidden');
  assert.equal(draftTarget(OWN, [], SB, key('t3'), T('t1')).code, 'choose_first');                  // ведёт — узнаёт
  // (4) есть главный
  assert.equal(draftTarget([MAIN], S, SB, key('t1'), T('t1')).line.id, 'sl_1');
  assert.equal(draftTarget([MAIN], S, SB, key('t9'), dean).code, 'ok');
  assert.equal(draftTarget([line('sl_5', 'main', { responsibleId: 't9' })], [], SB, key('t1'), T('t9')).code, 'ok');   // ответственный не ведёт — всё равно ok
  const unowned = line('sl_7', 'main');
  assert.deepEqual(draftTarget([unowned], [], SB, key('t2'), T('t2')), { code: 'ok', line: unowned, make: null, claim: true });
  assert.equal(draftTarget([unowned], [v('sy_x', 'sl_7', 1, 'archived', 1)], SB, key('t2'), T('t2')).code, 'forbidden');   // версии есть — только по назначению
  assert.equal(draftTarget([unowned], [], SB, key('t9'), T('t9')).code, 'forbidden');                // не ведёт
  assert.equal(draftTarget([unowned], [], SB, key('t2'), dean).claim, false);
  // (5) главного нет
  assert.deepEqual(draftTarget([], [], SB, key('t2'), dean), { code: 'ok', line: null, make: { responsibleId: 't2' }, claim: false });
  assert.deepEqual(draftTarget([], [], SB, key(''), dean).make, { responsibleId: '' });
  assert.equal(draftTarget([], [], SB, key('t9'), T('t9')).code, 'forbidden');
  assert.deepEqual(draftTarget([], [], SB, { disciplineId: 'ds_1', semester: 1 }, { id: 'a', roles: ['admin'] }).make, { responsibleId: '' });
  // мусор вместо зрителя
  for (const bad of [null, undefined, 'dean', [], { id: 't1' }, { id: '', roles: ['teacher'] }, { id: 't1', roles: 'teacher' }, { roles: ['student'], id: 's' }, { roles: ['prorector'], id: 'p' }]) {
    assert.equal(draftTarget([], [], SB, key('t1'), bad).code, 'forbidden', JSON.stringify(bad));
    assert.equal(draftTarget([MAIN], S, SB, key('t1'), bad).code, 'forbidden', JSON.stringify(bad));
  }
});

test('versionTeacher and responsibleOf', () => {
  const pr = (subjectId, n) => Array.from({ length: n }, (_, i) => ({ id: `${subjectId}_${i}`, subjectId }));
  const pairs = [...pr('sb_1', 3), ...pr('sb_2', 5), ...pr('sb_x', 9)];
  assert.equal(versionTeacher(OWN[1], SB, pairs, 'f'), 't2');                                       // «свой» — его преподаватель
  assert.equal(versionTeacher(MAIN, SB, pairs, 'f'), 't1');                                         // ответственный ведёт
  assert.equal(versionTeacher(line('sl_5', 'main', { responsibleId: 't9' }), SB, pairs, 'f'), 't2'); // не ведёт: больше пар у t2
  assert.equal(versionTeacher(line('sl_5', 'main'), SB, pairs.filter((p) => p.subjectId === 'sb_2' || p.subjectId === 'sb_1').slice(0, 3), 'f'), 't1');
  assert.equal(versionTeacher(line('sl_5', 'main', { responsibleId: 't9' }), SB, [...pr('sb_1', 2), ...pr('sb_2', 2)], 'f'), 't1');   // равенство — меньший id
  assert.equal(versionTeacher(line('sl_5', 'main', { responsibleId: 't9' }), [], pairs, 'f'), 't9');                              // никто не ведёт — ответственный
  assert.equal(versionTeacher(line('sl_5', 'main'), [], pairs, 'f'), 'f');                                                       // нет и его — тот, кто начал
  assert.equal(versionTeacher(line('sl_5', 'main'), [sb('sb_9', 't7', 'ds_2')], pairs, 'f'), 'f');                                 // предмет другой дисциплины не считается

  assert.equal(responsibleOf({ 1: 't1', 2: 't1' }, SB, []), 't1');
  assert.equal(responsibleOf({ 1: 't1' }, SB, []), 't1');
  assert.equal(responsibleOf({ 2: 't2' }, SB, []), 't2');
  assert.equal(responsibleOf({ 1: 't9', 2: 't9' }, SB, []), '');                                    // не ведёт — никто
  assert.equal(responsibleOf({}, SB, []), '');
  assert.equal(responsibleOf({ 1: 't1', 2: 't2' }, SB, pairs), 't2');                               // больше пар
  assert.equal(responsibleOf({ 1: 't1', 2: 't2' }, SB, [...pr('sb_1', 2), ...pr('sb_2', 2)]), 't1'); // равенство — осень
  assert.equal(responsibleOf({ 1: 't9', 2: 't2' }, SB, pairs), 't2');                               // не ведущий не становится ответственным
  assert.equal(responsibleOf({ 1: 't1', 2: 't9' }, SB, []), 't1');
  assert.equal(responsibleOf({ 1: 't9', 2: 't8' }, SB, pairs), '');
});

test('rightsOn by the place on the syllabus of the discipline', () => {
  const draft = { id: 'sy_d', status: 'draft', teacherId: 't1' };
  const R = (see, edit, submit, approve = false, giveBack = false) => ({ see, edit, submit, approve, giveBack });
  const rights = (status, viewer) => rightsOn({ ...draft, status }, viewer);
  const resp = { id: 't1', roles: ['teacher'], part: 'responsible' };
  const teaches = { id: 't2', roles: ['teacher'], part: 'teaches' };
  const outsider = { id: 't9', roles: ['teacher'], part: null };
  const dean = { id: 'd', roles: ['dean'], part: null };
  const pro = { id: 'p', roles: ['prorector'], part: null };
  assert.deepEqual(rights('draft', resp), R(true, true, true));                                     // ответственный; teaches не нужен
  assert.deepEqual(rights('returned', resp), R(true, true, true));
  assert.deepEqual(rights('review', resp), R(true, false, false));
  assert.deepEqual(rights('draft', teaches), R(true, false, false));                                // ведущий читает
  assert.deepEqual(rights('review', teaches), R(true, false, false));
  assert.deepEqual(rights('draft', outsider), R(false, false, false));
  assert.deepEqual(rights('approved', outsider), R(true, false, false));
  assert.deepEqual(rights('draft', dean), R(true, true, true, true));
  assert.deepEqual(rights('review', dean), R(true, false, false, true, true));
  assert.deepEqual(rights('approved', dean), R(true, false, false));
  assert.deepEqual(['draft', 'review', 'returned'].map((s) => rights(s, pro).see), [false, true, true]);
  assert.deepEqual(rights('returned', pro), R(true, false, false));                                  // проректор «возвращённую» не правит
  assert.deepEqual(rights('approved', { id: 's', roles: ['student'] }), R(true, false, false));
  assert.deepEqual(rights('draft', { id: 's', roles: ['student'] }), R(false, false, false));
  // линия-история: деканат видит, не правит и не утверждает; остальные не видят и утверждённую
  const old = (viewer) => ({ ...viewer, archived: true });
  assert.deepEqual(rights('draft', old(dean)), R(true, false, false));
  assert.deepEqual(rights('review', old(dean)), R(true, false, false));
  assert.deepEqual(rights('approved', old(dean)), R(true, false, false));
  for (const viewer of [resp, teaches, outsider, pro, { id: 's', roles: ['student'] }]) {
    for (const status of ['draft', 'review', 'returned', 'approved']) assert.deepEqual(rights(status, old(viewer)), R(false, false, false), `${viewer.id} ${status}`);
  }
  // мусор: роли строкой, пустой id, часть без роли преподавателя
  assert.deepEqual(rights('draft', { id: 't1', roles: 'teacher', part: 'responsible' }), R(false, false, false));
  assert.deepEqual(rights('draft', { id: '', roles: ['teacher'], part: 'responsible' }), R(false, false, false));
  assert.deepEqual(rights('draft', { id: undefined, roles: ['teacher'], part: 'responsible' }), R(false, false, false));
  assert.deepEqual(rights('draft', { id: 'x', roles: ['student'], part: 'responsible' }), R(false, false, false));
  assert.deepEqual(rights('draft', { id: 'x', roles: ['prorector'], part: 'responsible' }), R(false, false, false));
  assert.deepEqual(rights('draft', { id: 't1', roles: ['teacher'], part: 'responsible', archived: 'yes' }), R(true, true, true));   // archived только булево true
  assert.deepEqual(rights('weird', dean), R(false, false, false));
  assert.deepEqual(rightsOn(null, dean), R(false, false, false));
  assert.deepEqual(rightsOn(draft, null), R(false, false, false));
});

test('draftVersion: the half the version is for', () => {
  const args = { teacherId: 't1', approved: null, planSemester: 1, course: 1, userId: 'sf_u', today: '2026-09-10', number: 3 };
  assert.equal(draftVersion({ ...args, line: MAIN, half: 2 }).semester, 2);                          // у главного половины нет — её даёт запрос
  assert.equal(draftVersion({ ...args, line: OWN[0] }).semester, 1);                                 // без half — половина линии
  assert.equal(draftVersion({ ...args, line: OWN[0], half: 2 }).semester, 2);
  assert.equal(draftVersion({ ...args, line: MAIN, half: 1 }).lineId, 'sl_1');
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

test('checkHeld withSubject names the subject of the pair; without it the answer is the old one', () => {
  const topic = (id, order, unit, name, hours = 2) => ({ id, order, unit, lessonKind: 'lecture', name, hours });
  const approved = [topic('tp_1', 1, 1, 'Тема А', 4), topic('tp_2', 2, 1, 'Тема Б'), topic('tp_3', 3, 1, 'Тема В'), topic('tp_4', 4, 1, 'Тема Г')];
  const pair = (id, subjectId, topicId, date, part = 1, lessonType = 'lecture') => ({ id, subjectId, topicId, date, status: 'closed', part, lessonType, slot: 1 });
  const pairs = [pair('p_1', 'sb_1', 'tp_1', '2026-09-02', 2), pair('p_2', 'sb_2', 'tp_2', '2026-09-03'), pair('p_3', 'sb_3', 'tp_3', '2026-09-04', 1, 'practice'),
    pair('p_4', 'sb_4', 'tp_4', '2026-09-05')];
  const draft = [topic('d_1', 1, 1, 'Тема А', 2), topic('d_3', 2, 1, 'Тема В'), { ...topic('d_4', 3, 2, 'Тема Г'), sourceId: 'tp_4' }].map((t, i) => ({ ...t, sourceId: t.sourceId || ['tp_1', 'tp_3'][i] }));
  const closures = [{ subjectId: 'sb_4', planSemester: 1, unit: 1, reopenedAt: '' }];
  const plain = checkHeld(draft, approved, pairs, closures, 1);
  assert.deepEqual(plain.map((e) => e.code), ['held_hours', 'held_missing', 'held_kind', 'held_closed']);
  assert.equal(plain.every((e) => e.subjectId === undefined), true);
  const withSubject = checkHeld(draft, approved, pairs, closures, 1, { withSubject: true });
  assert.deepEqual(withSubject.map((e) => [e.code, e.subjectId]), [['held_hours', 'sb_1'], ['held_missing', 'sb_2'], ['held_kind', 'sb_3'], ['held_closed', 'sb_4']]);
  assert.deepEqual(withSubject.map(({ subjectId, ...rest }) => rest), plain);
});

// ---- disciplineMigration ----

const sy = (id, teacherId, semester, status, version, extra = {}) => ({ id, lineId: '', disciplineId: 'ds_1', teacherId, semester, status, version, ...extra });
const pairsOf = (...counts) => counts.flatMap(([subjectId, n]) => Array.from({ length: n }, (_, i) => ({ id: `${subjectId}_${i}`, subjectId })));
const plan = (syllabi, extra = {}) => disciplineMigration({ syllabi, lines: [], subjects: SB, pairs: [], half: 1, ...extra });

// what the server does with a plan: new lines get ids, versions get their line and status, the rows without a kind go away
function apply(p, state) {
  const made = new Map();
  const added = p.lines.map((l, i) => {
    const { ref, ...rest } = l;
    made.set(ref, `sl_n${i + 1}`);
    return { ...rest, id: `sl_n${i + 1}`, dueDate: '', reviewDue: '', createdBy: '', createdAt: '2026-11-26 10:00:00' };
  });
  const moved = new Map(p.versions.map((x) => [x.id, x]));
  return {
    lines: [...state.lines.filter((l) => !p.wipe.includes(l.id)), ...added],
    syllabi: state.syllabi.map((s) => {
      const m = moved.get(s.id);
      const row = m ? { ...s, lineId: m.ref ? made.get(m.ref) : m.lineId, ...(m.status ? { status: m.status } : {}) } : s;
      return p.retire.includes(s.id) ? { ...row, status: 'archived' } : row;
    }),
  };
}
// the place of every version: «kind/half/teacher of the line» and the status
const where = (state) => Object.fromEntries(state.syllabi.map((s) => {
  const l = state.lines.find((x) => x.id === s.lineId);
  return [s.id, `${l ? `${l.kind}:${l.semester}:${l.teacherId}` : '-'} ${s.status}`];
}));
const run = (syllabi, extra = {}) => {
  const lines = extra.lines || [];
  const p = disciplineMigration({ syllabi, lines, subjects: SB, pairs: [], half: 1, ...extra });
  return { p, state: apply(p, { syllabi, lines }) };
};

test('migration (1): one winner per half becomes the syllabus of the discipline, the loser is history', () => {
  const rows = [sy('sy_1', 't1', 1, 'archived', 1), sy('sy_2', 't1', 1, 'approved', 2), sy('sy_3', 't1', 1, 'draft', 3), sy('sy_4', 't1', 2, 'approved', 1), sy('sy_5', 't2', 1, 'draft', 1)];
  const { p, state } = run(rows);
  assert.deepEqual(p.lines, [
    { ref: 'new:1', disciplineId: 'ds_1', kind: 'main', semester: null, teacherId: '', responsibleId: 't1' },
    { ref: 'new:2', disciplineId: 'ds_1', kind: 'archived', semester: 1, teacherId: 't2', responsibleId: '' },
  ]);
  assert.deepEqual(p.versions, [{ id: 'sy_1', ref: 'new:1' }, { id: 'sy_2', ref: 'new:1' }, { id: 'sy_3', ref: 'new:1' }, { id: 'sy_4', ref: 'new:1' }, { id: 'sy_5', ref: 'new:2', status: 'archived' }]);
  assert.deepEqual([p.wipe, p.retire, p.skipped, p.waiting, p.relay], [[], [], [], [], ['sb_2']]);   // t2 раньше без утверждённого, теперь идёт по силлабусу t1
  assert.equal(where(state).sy_5, 'archived:1:t2 archived');
});

test('migration (2): two approved in one half - the half waits, the other half has its only syllabus', () => {
  const rows = [sy('sy_1', 't1', 1, 'approved', 1), sy('sy_2', 't2', 1, 'approved', 1), sy('sy_3', 't1', 2, 'approved', 1)];
  const { p, state } = run(rows);
  assert.deepEqual(p.lines.map((l) => [l.kind, l.semester, l.teacherId, l.responsibleId]), [['own', 1, 't1', ''], ['own', 1, 't2', ''], ['own', 2, 't1', '']]);
  assert.deepEqual([p.waiting, p.relay, p.retire], [['ds_1'], [], []]);
  assert.deepEqual(where(state), { sy_1: 'own:1:t1 approved', sy_2: 'own:1:t2 approved', sy_3: 'own:2:t1 approved' });
});

test('migration (3): no approved, two drafts - waits for the choice', () => {
  const { p, state } = run([sy('sy_1', 't1', 1, 'draft', 1), sy('sy_2', 't2', 1, 'returned', 1)]);
  assert.deepEqual(p.lines.map((l) => [l.kind, l.teacherId]), [['own', 't1'], ['own', 't2']]);
  assert.deepEqual([p.waiting, state.syllabi.map((s) => s.status)], [['ds_1'], ['draft', 'returned']]);   // «свои» ждут выбора, статус не меняется
});

test('migration (4): the only syllabus of somebody who does not lead the discipline', () => {
  const { p } = run([sy('sy_1', 't9', 1, 'approved', 1)]);
  assert.deepEqual(p.lines, [{ ref: 'new:1', disciplineId: 'ds_1', kind: 'main', semester: null, teacherId: '', responsibleId: '' }]);
  assert.deepEqual(p.versions, [{ id: 'sy_1', ref: 'new:1' }]);
});

test('migration (5): a draft of a leader wins over an approved syllabus of somebody who does not lead', () => {
  const { p, state } = run([sy('sy_1', 't1', 1, 'draft', 1), sy('sy_2', 't9', 1, 'approved', 4)]);
  assert.deepEqual(p.lines.map((l) => [l.kind, l.teacherId, l.responsibleId]), [['main', '', 't1'], ['archived', 't9', '']]);
  assert.deepEqual(where(state), { sy_1: 'main:null: draft', sy_2: 'archived:1:t9 approved' });         // утверждённая статус не меняет
});

test('migration (6): the responsible when the halves have different owners', () => {
  const rows = [sy('sy_1', 't1', 1, 'approved', 1), sy('sy_2', 't2', 2, 'approved', 1)];
  const resp = (pairs) => run(rows, { pairs }).p.lines[0].responsibleId;
  assert.equal(resp(pairsOf(['sb_1', 3], ['sb_2', 2])), 't1');
  assert.equal(resp(pairsOf(['sb_1', 2], ['sb_2', 3])), 't2');
  assert.equal(resp(pairsOf(['sb_1', 2], ['sb_2', 2])), 't1');                                           // равенство — осень
  assert.equal(resp([]), 't1');
});

test('migration (7): versions that cannot be placed are skipped', () => {
  const rows = [sy('sy_1', 't1', 1, 'draft', 1, { disciplineId: '' }), sy('sy_2', '', 1, 'draft', 1), sy('sy_3', 't1', 3, 'draft', 1), sy('sy_4', 't1', null, 'draft', 1),
    sy('sy_5', 't1', '1', 'draft', 1), sy('sy_6', 't1', 1, 'draft', 1)];
  const { p } = run(rows);
  assert.deepEqual(p.skipped, ['sy_1', 'sy_2', 'sy_3', 'sy_4', 'sy_5']);
  assert.deepEqual(p.versions, [{ id: 'sy_6', ref: 'new:1' }]);
  assert.deepEqual(run(rows.slice(0, 5)).p, { wipe: [], lines: [], versions: [], retire: [], skipped: ['sy_1', 'sy_2', 'sy_3', 'sy_4', 'sy_5'], waiting: [], relay: [] });
});

test('migration (8): a line without a kind (from the shared syllabus) goes away, its versions move again by the teacher column', () => {
  const lines = [line('sl_old', '', { semester: 1 })];
  const rows = [sy('sy_1', 't1', 1, 'approved', 1, { lineId: 'sl_old' }), sy('sy_2', 't2', 1, 'draft', 1, { lineId: 'sl_old' }), sy('sy_3', 't1', 1, 'draft', 2, { lineId: 'sl_gone' })];
  const { p, state } = run(rows, { lines });
  assert.deepEqual(p.wipe, ['sl_old']);
  assert.deepEqual(p.lines.map((l) => [l.kind, l.semester, l.teacherId, l.responsibleId]), [['main', null, '', 't1'], ['archived', 1, 't2', '']]);
  assert.deepEqual(where(state), { sy_1: 'main:null: approved', sy_2: 'archived:1:t2 archived', sy_3: 'main:null: draft' });
  assert.deepEqual(state.lines.map((l) => l.id).includes('sl_old'), false);
});

test('migration (9): versions of the old code on a database that already has lines of the new kind', () => {
  const main = line('sl_1', 'main', { responsibleId: 't1' });
  const own = line('sl_2', 'own', { semester: 1, teacherId: 't2' });
  const placed = [sy('sy_1', 't1', 1, 'approved', 2, { lineId: 'sl_1' }), sy('sy_2', 't1', 2, 'approved', 2, { lineId: 'sl_1' })];
  // (б): the teacher column equals that of the latest version of main in the half -> main
  let r = run([...placed, sy('sy_3', 't1', 1, 'draft', 3)], { lines: [main] });
  assert.deepEqual(r.p.versions, [{ id: 'sy_3', lineId: 'sl_1' }]);
  assert.deepEqual(r.p.lines, []);
  // (а): an 'own' of the discipline, half and teacher
  r = run([sy('sy_4', 't2', 1, 'draft', 1)], { lines: [own] });
  assert.deepEqual(r.p.versions, [{ id: 'sy_4', lineId: 'sl_2' }]);
  // (в): another teacher column on main -> a line of history, the open version is archived
  r = run([...placed, sy('sy_5', 't2', 1, 'draft', 5), sy('sy_6', 't2', 1, 'approved', 6)], { lines: [main] });
  assert.deepEqual(r.p.lines, [{ ref: 'new:1', disciplineId: 'ds_1', kind: 'archived', semester: 1, teacherId: 't2', responsibleId: '' }]);
  assert.deepEqual(r.p.versions, [{ id: 'sy_5', ref: 'new:1', status: 'archived' }, { id: 'sy_6', ref: 'new:1' }]);
  // the second approved version of main does not appear: nothing to retire for a version that lies on the history line
  assert.deepEqual(r.p.retire, []);
  assert.deepEqual(r.state.lines.filter((l) => l.kind === 'main').length, 1);
  // the same on the other discipline does not mix
  r = run([sy('sy_7', 't1', 1, 'draft', 1, { disciplineId: 'ds_2' })], { lines: [main] });
  assert.deepEqual(r.p.lines.map((l) => [l.disciplineId, l.kind]), [['ds_2', 'main']]);
});

test('migration (10): a second run on the result is empty', () => {
  const rows = [sy('sy_1', 't1', 1, 'approved', 2), sy('sy_2', 't1', 1, 'draft', 3), sy('sy_3', 't2', 1, 'draft', 1), sy('sy_4', 't1', 3, 'draft', 1)];
  const first = run(rows);
  const again = disciplineMigration({ ...first.state, subjects: SB, pairs: [], half: 1 });
  assert.deepEqual(again, { wipe: [], lines: [], versions: [], retire: [], skipped: ['sy_4'], waiting: [], relay: [] });
  const waiting = run([sy('sy_1', 't1', 1, 'approved', 1), sy('sy_2', 't2', 1, 'approved', 1)]);
  assert.deepEqual(disciplineMigration({ ...waiting.state, subjects: SB, pairs: [], half: 1 }), { wipe: [], lines: [], versions: [], retire: [], skipped: [], waiting: ['ds_1'], relay: [] });
  assert.deepEqual(disciplineMigration({ syllabi: [], lines: [], subjects: [], pairs: [], half: 1 }), { wipe: [], lines: [], versions: [], retire: [], skipped: [], waiting: [], relay: [] });
});

test('migration (11): a move interrupted after the lines were written gives the same result on the repeat', () => {
  const rows = [sy('sy_1', 't1', 1, 'approved', 2), sy('sy_2', 't1', 2, 'approved', 1), sy('sy_3', 't2', 1, 'draft', 1)];
  const whole = run(rows);
  const reference = where(whole.state);
  // the first pass wrote only the new lines: the versions have no line yet
  const lines = whole.state.lines;
  const second = disciplineMigration({ syllabi: rows, lines, subjects: SB, pairs: [], half: 1 });
  assert.deepEqual(second.lines, []);                                                                    // ни одной лишней линии (пустая archived берётся повторно)
  assert.deepEqual(where(apply(second, { syllabi: rows, lines })), reference);
  // main without versions of the spring and a winner of the spring who is not the responsible
  const mainOnly = [line('sl_1', 'main', { responsibleId: 't1' })];
  const part = [sy('sy_1', 't1', 1, 'approved', 1, { lineId: 'sl_1' }), sy('sy_2', 't2', 2, 'approved', 1)];
  const r = run(part, { lines: mainOnly });
  assert.deepEqual(r.p.versions, [{ id: 'sy_2', lineId: 'sl_1' }]);
  // main with no responsible and the syllabus of somebody who does not lead
  const r2 = run([sy('sy_1', 't9', 1, 'approved', 1)], { lines: [line('sl_1', 'main')] });
  assert.deepEqual([r2.p.lines, r2.p.versions], [[], [{ id: 'sy_1', lineId: 'sl_1' }]]);
  // an empty 'own' gets its versions; an empty 'archived' is taken again, a second one does not appear
  const ownEmpty = run([sy('sy_1', 't2', 1, 'draft', 1)], { lines: [line('sl_5', 'own', { semester: 1, teacherId: 't2' }), line('sl_6', 'own', { semester: 1, teacherId: 't1' })] });
  assert.deepEqual([ownEmpty.p.lines, ownEmpty.p.versions], [[], [{ id: 'sy_1', lineId: 'sl_5' }]]);
  const archEmpty = run([sy('sy_1', 't1', 1, 'approved', 1, { lineId: 'sl_1' }), sy('sy_2', 't2', 1, 'draft', 1)],
    { lines: [line('sl_1', 'main', { responsibleId: 't1' }), line('sl_7', 'archived', { semester: 1, teacherId: 't2' })] });
  assert.deepEqual([archEmpty.p.lines, archEmpty.p.versions], [[], [{ id: 'sy_2', lineId: 'sl_7', status: 'archived' }]]);
  // the second one of the same key is not shared: a filled history line is not taken for another version
  const filled = run([sy('sy_1', 't1', 1, 'approved', 1, { lineId: 'sl_1' }), sy('sy_2', 't2', 1, 'draft', 1), sy('sy_3', 't2', 1, 'approved', 2, { lineId: 'sl_7' })],
    { lines: [line('sl_1', 'main', { responsibleId: 't1' }), line('sl_7', 'archived', { semester: 1, teacherId: 't2' })] });
  assert.deepEqual(filled.p.lines.map((l) => l.kind), ['archived']);
});

test('migration (12): two approved versions of one line and half - the earlier one retires; the history is not touched', () => {
  const main = line('sl_1', 'main', { responsibleId: 't1' });
  const rows = [sy('sy_1', 't1', 1, 'approved', 2, { lineId: 'sl_1' }), sy('sy_2', 't2', 1, 'approved', 3, { lineId: 'sl_1' }), sy('sy_3', 't1', 2, 'approved', 2, { lineId: 'sl_1' })];
  const r = run(rows, { lines: [main] });
  assert.deepEqual([r.p.retire, r.p.versions, r.p.lines], [['sy_1'], [], []]);
  assert.equal(where(r.state).sy_1, 'main:null: archived');
  assert.deepEqual(disciplineMigration({ ...r.state, subjects: SB, pairs: [], half: 1 }).retire, []);
  const history = line('sl_9', 'archived', { semester: 1, teacherId: 't2' });
  const hist = run([sy('sy_4', 't2', 1, 'approved', 1, { lineId: 'sl_9' }), sy('sy_5', 't2', 1, 'approved', 2, { lineId: 'sl_9' })], { lines: [history] });
  assert.deepEqual([hist.p.retire, hist.p.relay], [[], []]);
  // the same number: the greater id stays
  const tie = run([sy('sy_a', 't1', 1, 'approved', 2, { lineId: 'sl_1' }), sy('sy_b', 't1', 1, 'approved', 2, { lineId: 'sl_1' })], { lines: [main] });
  assert.deepEqual(tie.p.retire, ['sy_a']);
  // a version of the old code that lands on main and makes it two approved
  const landed = run([sy('sy_1', 't1', 1, 'approved', 2, { lineId: 'sl_1' }), sy('sy_6', 't1', 1, 'approved', 4)], { lines: [main] });
  assert.deepEqual([landed.p.versions, landed.p.retire], [[{ id: 'sy_6', lineId: 'sl_1' }], ['sy_1']]);
});

test('migration (13): an unfinished version of the loser is archived (draft, returned and on approval); an approved one stays', () => {
  const rows = [sy('sy_1', 't1', 1, 'approved', 1), sy('sy_2', 't2', 1, 'review', 1), sy('sy_3', 't2', 1, 'draft', 2), sy('sy_4', 't2', 1, 'returned', 3), sy('sy_5', 't2', 1, 'archived', 0)];
  const { p, state } = run(rows);
  assert.deepEqual(p.versions.filter((x) => x.status).map((x) => x.id), ['sy_2', 'sy_3', 'sy_4']);
  assert.deepEqual(where(state).sy_5, 'archived:1:t2 archived');
  assert.deepEqual(where(state).sy_1, 'main:null: approved');
});

test('migration: the discipline is by subjects of the discipline, and other disciplines do not mix; relay is for the current half only', () => {
  const subjects = [...SB, sb('sb_3', 't1', 'ds_2'), sb('sb_4', 't2', 'ds_2')];
  const rows = [sy('sy_1', 't1', 1, 'approved', 1), sy('sy_2', 't1', 1, 'draft', 1, { disciplineId: 'ds_2' }), sy('sy_3', 't2', 2, 'approved', 1)];
  const p = disciplineMigration({ syllabi: rows, lines: [], subjects, pairs: [], half: 1 });
  assert.deepEqual(p.lines.map((l) => [l.disciplineId, l.kind, l.responsibleId]), [['ds_1', 'main', 't1'], ['ds_2', 'main', 't1']]);
  assert.deepEqual(p.relay, ['sb_2']);                                                                   // у sb_3 и sb_4: ds_2 не утверждён; у sb_2 осень ds_1 утверждена
  assert.deepEqual(disciplineMigration({ syllabi: rows, lines: [], subjects, pairs: [], half: 2 }).relay, ['sb_1']);   // весна: утверждённая у t2, и t1 идёт по ней
});

test('migration: garbage in the arguments does not throw', () => {
  for (const arg of [undefined, null, {}, { syllabi: 5, lines: 'x', subjects: null }, { syllabi: [null, 1, 'a'], lines: [null], subjects: [undefined] }]) {
    const p = disciplineMigration(arg);
    assert.deepEqual([p.lines, p.versions, p.retire], [[], [], []]);
  }
});

test('draftTarget: while a half waits for the choice nobody becomes responsible by starting the other half', () => {
  const dean = { id: 'd', roles: ['dean'] };
  const spring = key('t3', 2);
  assert.equal(draftTarget(OWN, [], SB, spring, T('t1')).code, 'choose_first');
  assert.deepEqual(draftTarget(OWN, [], SB, spring, dean), { code: 'ok', line: null, make: { responsibleId: '' }, claim: false });
  const unowned = line('sl_7', 'main');
  assert.equal(draftTarget([...OWN, unowned], [], SB, key('t2', 2), T('t2')).code, 'choose_first');       // no claim while waiting
  assert.equal(draftTarget([...OWN, unowned], [], SB, key('t2', 2), dean).claim, false);
  assert.equal(draftTarget(OWN, [], SB, spring, T('t9')).code, 'forbidden');
});

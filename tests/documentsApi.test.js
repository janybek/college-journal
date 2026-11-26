import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './linesSetup.js';
import { DOCS_TABLES } from '../backend/documentsData.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);
const SECRETS = /responsible|dueDate|reviewDue|createdBy/;

// a title and a goal for a draft, as the form of the deanery would write them
function fill(s, syllabusId) {
  const form = s.call('syllabus.form', { syllabusId }, s.t.dean).data;
  const title = { ...form.doc.title, department: form.doc.title.department || 'Кафедра', academicYear: form.doc.title.academicYear || '2026–2027', course: form.doc.title.course || 1, credits: form.doc.title.credits || 1 };
  s.call('syllabus.saveSection', { syllabusId, section: 'title', data: title }, s.t.dean);
  s.call('syllabus.saveSection', { syllabusId, section: 'goals', data: { ...form.doc.goals, goal: form.doc.goals.goal || 'Цель курса' } }, s.t.dean);
}

function ready() {
  const s = setup();
  s.publish(s.sb1, s.FILE_A);
  return s;
}

// the responsible t5 (leads nothing) of the Chemistry has a draft with a plan, filled in
function chemistry(s) {
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '2026-12-01' }, s.t.dean);
  const applied = s.call('syllabus.apply', { disciplineId: s.ds2, sheets: s.FILE_A }, s.t.t5);
  assert.equal(applied.data.applied, true, JSON.stringify(applied));
  const [{ syllabusId }] = applied.data.drafts;
  fill(s, syllabusId);
  return syllabusId;
}

const mainOf = (s, ds) => s.store.list('syllabusLines').find((l) => l.disciplineId === ds && l.kind === 'main');
const tab = (s, key, name = 't1') => s.call('docs.syllabi', {}, s.t[key ?? name]).data;
const names = (rows) => rows.map((r) => r.disciplineName);

test('assign: rights, garbage and the line of the discipline; the tabs show it', () => {
  const s = ready();
  const assign = (data, token = s.t.dean) => s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '2026-12-01', ...data }, token);
  const was = s.snapshot();
  assert.deepEqual(['t1', 't4', 'prorector', 's1'].map((k) => code(assign({}, s.t[k]))), ['forbidden', 'forbidden', 'forbidden', 'forbidden']);
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '2026-12-01' })), 'unauthorized');
  for (const bad of [[s.ids.t5], 5, { id: 1 }, null]) assert.equal(code(assign({ teacherId: bad })), 'bad_request', JSON.stringify(bad));
  for (const odd of ['  x  y ', '__proto__']) { const r = assign({ teacherId: odd }); assert.ok(!r.ok && r.error.code !== 'internal', odd); }
  for (const odd of ['  ', '__proto__']) { const r = assign({ disciplineId: odd }); assert.ok(!r.ok && r.error.code !== 'internal', odd); }
  for (const bad of [[s.ds2], 5, { id: 1 }, null]) assert.equal(code(assign({ disciplineId: bad })), 'bad_request', JSON.stringify(bad));
  for (const bad of ['2026-13-45', 20261201, ['2026-12-01'], null, '2026-1-1']) assert.equal(code(assign({ dueDate: bad })), 'bad_request', JSON.stringify(bad));
  assert.deepEqual([code(assign({ teacherId: s.ids.prorector })), code(assign({ disciplineId: 'ds_none' })), code(assign({ teacherId: s.ids.s1 })), code(assign({ teacherId: 'sf_none' }))],
    ['not_teacher', 'not_found', 'not_teacher', 'not_teacher']);
  assert.deepEqual(s.snapshot(), was);

  const line = assign({}).data.line;                                                          // t5 does not lead the Chemistry: the responsible all the same
  assert.deepEqual([line.kind, line.responsibleId, line.dueDate, line.can.assign, line.responsibleName], ['main', s.ids.t5, '2026-12-01', true, s.names.t5]);
  assert.equal(mainOf(s, s.ds2).createdBy, s.ids.dean);
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(board.approved.map((r) => [r.disciplineName, r.teachers.length, r.next]), [['Анатомия', 3, null]]);
  assert.deepEqual(board.development.map((r) => [r.disciplineName, r.state, r.responsibleName, r.dueDate]), [['Химия', 'none', s.names.t5, '2026-12-01']]);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.t4).data.development.map((r) => r.disciplineName), ['Химия']);       // a teacher: only his own
  assert.deepEqual([s.call('docs.syllabi', {}, s.t.t4).data.approved, code(s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.t4))], [[], 'forbidden']);
  assert.deepEqual(s.oneMain(), []);

  // a second call changes the same line; nobody (teacherId '') leaves the date
  assert.equal(assign({ teacherId: '', dueDate: '2026-12-09' }).data.line.responsibleId, '');
  const kept = assign({ teacherId: '', dueDate: '2026-12-09' }).data.line;
  assert.deepEqual([kept.responsibleName, kept.dueDate, s.lines(s.ds2).length], ['', '2026-12-09', 1]);
  assert.equal(assign({ teacherId: s.ids.t4, dueDate: '' }).data.line.dueDate, '');
});

test('the responsible who does not lead the discipline writes the draft; the teacher column is the leader; a leader reads and does not edit', () => {
  const s = ready();
  const id = chemistry(s);
  const version = s.store.list('syllabi').find((v) => v.id === id);
  assert.equal(version.teacherId, s.ids.t4);                                               // the column «teacher»: the leader, not the responsible
  assert.deepEqual([s.main(s.ds2).responsibleId, s.oneMain()], [s.ids.t5, []]);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.t5).data.development.map((r) => [r.disciplineName, r.state]), [['Химия', 'draft']]);
  const form = s.call('syllabus.form', { syllabusId: id }, s.t.t4).data;
  assert.deepEqual([form.can.edit, form.line.mine], [false, 'teaches']);
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: id, section: 'goals', data: { goal: 'x' } }, s.t.t4)), 'forbidden');

  // sent: a row of the second tab with the name of the sender, no more in «development»
  assert.equal(s.call('syllabus.submit', { syllabusId: id }, s.t.t5).data.submitted, true);
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(board.review.map((r) => [r.disciplineName, r.submittedByName, r.teacherName, r.halves, r.reviewDue]), [['Химия', s.names.t5, s.names.t5, [1], '']]);
  assert.deepEqual(board.development, []);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.t4).data.review.map((r) => r.disciplineName), ['Химия']);
});

test('setReviewDue: the deanery writes and clears the date; a line without a version on approval, garbage and other roles refused', () => {
  const s = ready();
  const id = chemistry(s);
  const main = mainOf(s, s.ds2);
  const set = (data, token = s.t.dean) => s.call('syllabus.setReviewDue', { lineId: main.id, date: '2026-12-05', ...data }, token);
  const was = s.snapshot();
  assert.equal(code(set({})), 'syllabus_locked');                                          // nothing is on approval yet
  assert.equal(code(s.call('syllabus.setReviewDue', { lineId: mainOf(s, s.ds1).id, date: '2026-12-05' }, s.t.dean)), 'syllabus_locked');
  assert.deepEqual(s.snapshot(), was);
  s.call('syllabus.submit', { syllabusId: id }, s.t.t5);
  const sent = s.snapshot();
  assert.deepEqual(['t1', 't4', 't5', 'prorector', 's1'].map((k) => code(set({}, s.t[k]))), ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden']);
  assert.equal(code(s.call('syllabus.setReviewDue', { lineId: main.id, date: '2026-12-05' })), 'unauthorized');
  for (const bad of [[main.id], 5, { id: 1 }, null]) assert.equal(code(set({ lineId: bad })), 'bad_request', JSON.stringify(bad));
  for (const bad of ['2026-13-45', 20261201, ['2026-12-05'], null, undefined]) assert.equal(code(set({ date: bad })), 'bad_request', JSON.stringify(bad));
  for (const odd of ['__proto__', '  ', 'sl_none']) { const r = set({ lineId: odd }); assert.ok(!r.ok && r.error.code !== 'internal', odd); }
  assert.deepEqual(s.snapshot(), sent);
  const done = set({}).data.line;
  assert.deepEqual([done.reviewDue, done.dueDate, mainOf(s, s.ds2).reviewDue], ['2026-12-05', '2026-12-01', '2026-12-05']);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.dean).data.review.map((r) => r.reviewDue), ['2026-12-05']);
  assert.equal(set({ date: '' }).data.line.reviewDue, '');
  assert.deepEqual(s.oneMain(), []);
});

test('«Approve» clears both dates, «Return» only the date of the review; the discipline goes back to development as returned', () => {
  const s = ready();
  const id = chemistry(s);
  const main = mainOf(s, s.ds2);
  const line = () => mainOf(s, s.ds2);
  s.call('syllabus.submit', { syllabusId: id }, s.t.t5);
  s.call('syllabus.setReviewDue', { lineId: main.id, date: '2026-12-05' }, s.t.dean);
  assert.equal(s.call('syllabus.return', { syllabusId: id, remark: 'Допишите' }, s.t.dean).data.returned, true);
  assert.deepEqual([line().dueDate, line().reviewDue], ['2026-12-01', '']);
  const back = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(back.development.map((r) => [r.disciplineName, r.state, r.dueDate]), [['Химия', 'returned', '2026-12-01']]);
  assert.deepEqual(back.review, []);
  s.call('syllabus.submit', { syllabusId: id }, s.t.t5);
  s.call('syllabus.setReviewDue', { lineId: main.id, date: '2026-12-06' }, s.t.dean);
  const done = s.call('syllabus.approve', { syllabusId: id }, s.t.dean).data;
  assert.equal(done.approved, true);
  assert.deepEqual([line().dueDate, line().reviewDue], ['', '']);
  const after = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual([names(after.approved), after.development, after.review], [['Анатомия', 'Химия'], [], []]);
});

test('an approved syllabus with a new version: approved with «draft», sent - also under review; a repeated «Approve» leaves it as it is', () => {
  const s = ready();
  const started = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.dean).data.approved.map((r) => [r.disciplineName, r.next]), [['Анатомия', 'draft']]);
  assert.deepEqual(names(s.call('docs.syllabi', {}, s.t.dean).data.development), ['Химия']);       // Анатомия is approved: not in development
  assert.equal(s.call('syllabus.submit', { syllabusId: started }, s.t.t1).data.submitted, true);
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual([board.approved.map((r) => r.next), board.review.map((r) => [r.disciplineName, r.submittedByName, r.version])], [['review'], [['Анатомия', s.names.t1, 2]]]);
  s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: '2026-12-02' }, s.t.dean);
  s.call('syllabus.setReviewDue', { lineId: mainOf(s, s.ds1).id, date: '2026-12-03' }, s.t.dean);
  assert.equal(s.call('syllabus.approve', { syllabusId: started }, s.t.dean).data.approved, true);
  assert.deepEqual([mainOf(s, s.ds1).dueDate, mainOf(s, s.ds1).reviewDue], ['', '']);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.dean).data.approved.map((r) => [r.next, r.halves.map((h) => h.version)]), [[null, [2]]]);
});

test('the responsible is changed or taken away: the former one loses the right to write; an absent person is a name \'\' and never an error', () => {
  const s = ready();
  const id = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  const goals = { goal: 'Новая цель' };
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: id, section: 'goals', data: goals }, s.t.t1)), 'ok');
  s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t2, dueDate: '2026-12-02' }, s.t.dean);
  assert.deepEqual(['t1', 't2'].map((k) => code(s.call('syllabus.saveSection', { syllabusId: id, section: 'goals', data: goals }, s.t[k]))), ['forbidden', 'ok']);
  assert.equal(code(s.call('syllabus.submit', { syllabusId: id, dryRun: true }, s.t.t1)), 'forbidden');

  // roles taken away: he still is named as the responsible, cannot write; the deanery names another
  s.store.update('staff', s.ids.t2, { roles: '' });
  for (const [action, data] of [['syllabus.saveSection', { syllabusId: id, section: 'goals', data: goals }], ['syllabus.submit', { syllabusId: id }]]) assert.equal(code(s.call(action, data, s.t.t2)), 'forbidden', action);
  const row = s.call('docs.syllabi', {}, s.t.dean).data.approved.find((r) => r.disciplineName === 'Анатомия');
  assert.equal(row.next, 'draft');
  assert.equal(s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean).data.line.responsibleName, s.names.t2);
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t2, dueDate: '' }, s.t.dean)), 'not_teacher');
  assert.equal(s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t3, dueDate: '' }, s.t.dean).data.line.responsibleId, s.ids.t3);
  s.store.update('staff', s.ids.t2, { roles: 'teacher' });

  // deactivated: the token no more works; removed from «Staff»: a name \'\'; nothing is internal
  s.store.update('staff', s.ids.t3, { active: false });
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: id, section: 'goals', data: goals }, s.t.t3)), 'unauthorized');
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t3, dueDate: '' }, s.t.dean)), 'not_teacher');
  for (const state of ['off', 'gone']) {
    if (state === 'gone') s.store.remove('staff', s.ids.t3);
    const got = [s.call('docs.syllabi', {}, s.t.dean), s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean), s.call('syllabus.get', { disciplineId: s.ds1 }, s.t.dean),
      s.call('syllabus.get', { subjectId: s.sb1 }, s.t.t1), s.call('syllabus.form', { syllabusId: id }, s.t.dean), s.call('syllabus.queue', {}, s.t.dean), s.call('dir.card', { table: 'disciplines', id: s.ds1 }, s.t.dean)];
    assert.deepEqual(got.map(code), got.map(() => 'ok'), state);
    assert.equal(got[1].data.line.responsibleName, state === 'off' ? s.names.t3 : '', state);
    if (state === 'gone') assert.equal(got[6].data.syllabus.responsibleName, '');
  }
  assert.deepEqual(s.oneMain(), []);
});

test('teacher.mySubjects: «responsible» or «teaches»; a subject of a discipline without a line has no key', () => {
  const s = ready();
  const mine = (key) => s.call('teacher.mySubjects', {}, s.t[key]).data.subjects.map((x) => x.syllabus.mine);
  assert.deepEqual([mine('t1'), mine('t2'), mine('t3'), mine('t4')], [['responsible'], ['teaches'], ['teaches'], [undefined]]);
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '' }, s.t.dean);
  assert.deepEqual([mine('t4'), mine('t5')], [['teaches'], []]);
});

test('the rows of the tabs carry the subject the page is opened by; a discipline without anything is in no tab', () => {
  const s = ready();
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '' }, s.t.dean);
  const lonely = s.store.insert('disciplines', { name: 'Латынь' }).id;                    // no subject, nobody responsible, no version
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual([...board.approved, ...board.development].map((r) => [r.disciplineName, r.subjectId]), [['Анатомия', s.sb1], ['Химия', s.sb4]]);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.t2).data.approved.map((r) => r.subjectId), [s.sb2]);                  // a teacher: his own
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.prorector).data.approved.map((r) => r.subjectId), [s.sb1]);
  // the deanery names a responsible for a discipline with no subject: it appears with ''
  s.call('syllabus.assign', { disciplineId: lonely, teacherId: s.ids.t5, dueDate: '2026-12-31' }, s.t.dean);
  const after = s.call('docs.syllabi', {}, s.t.dean).data.development;
  assert.deepEqual(after.map((r) => [r.disciplineName, r.subjectId, r.lineId !== '']), [['Латынь', '', true], ['Химия', s.sb4, true]]);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.t5).data.development.map((r) => r.disciplineName), ['Латынь', 'Химия']);
});

test('a discipline that waits for the choice: in «approved» with a mark, no assigning, candidates and no history', () => {
  const s = setup();
  s.old(s.sb1, s.FILE_A);
  s.old(s.sb2, s.FILE_B);
  assert.equal(s.upgrade().waiting, 1);
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(board.approved.map((r) => [r.disciplineName, r.waiting, r.halves.length, r.lineId]), [['Анатомия', true, 2, '']]);
  assert.equal(board.can.choose, true);
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: '' }, s.t.dean)), 'choose_first');
  const card = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean).data;
  assert.deepEqual([card.waiting, card.line, card.halves, card.history, card.can.choose], [[1], null, [], [], true]);
  assert.deepEqual(card.candidates[1].map((c) => [c.teacherName, c.status, c.version, c.groups]).sort(), [[s.names.t1, 'approved', 1, ['01-1']], [s.names.t2, 'approved', 1, ['02-1']]].sort());
  assert.equal(card.candidates[2], undefined);
  assert.equal(s.call('docs.syllabi', {}, s.t.prorector).data.can.choose, false);
  assert.deepEqual(s.oneMain(), []);
});

test('the card of a discipline: halves, teachers with groups, history, the list of teachers for the deanery only', () => {
  const s = ready();
  const card = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean).data;
  assert.deepEqual(card.discipline, { id: s.ds1, name: 'Анатомия' });
  assert.deepEqual(card.halves.map((h) => [h.semester, h.approved.version, h.open]), [[1, 1, null]]);
  assert.deepEqual(card.teachers.map((t) => [t.fullName, t.groups]), [[s.names.t1, ['01-1']], [s.names.t2, ['02-1']], [s.names.t3, ['03-1']]]);
  assert.deepEqual([card.can.assign, card.can.setReviewDue, card.can.start, card.line.responsibleName, card.staff.length], [true, true, true, s.names.t1, 6]);
  assert.deepEqual(card.staff.find((p) => p.id === s.ids.t4), { id: s.ids.t4, fullName: s.names.t4, teaches: false });
  s.publish(s.sb1, s.FILE_B);                                                              // version 1 goes to the archive
  const history = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean).data.history;
  assert.deepEqual(history.map((h) => [h.semester, h.version, h.status, h.former, h.teacherName]), [[1, 1, 'archived', false, s.names.t1]]);
  const mine = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.t1).data;
  assert.deepEqual([mine.history, mine.staff, mine.can], [[], undefined, { assign: false, setReviewDue: false, choose: false, start: true }]);
  const pro = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.prorector).data;
  assert.deepEqual([pro.history.length, pro.staff, pro.can], [1, undefined, { assign: false, setReviewDue: false, choose: false, start: false }]);
  // a teacher of the discipline reads it, the one who leads nothing of it does not
  assert.deepEqual(['t2', 't4', 't5'].map((k) => code(s.call('docs.discipline', { disciplineId: s.ds1 }, s.t[k]))), ['ok', 'forbidden', 'forbidden']);
  assert.deepEqual(['s1', undefined].map((k) => code(s.call('docs.discipline', { disciplineId: s.ds1 }, s.t[k]))), ['forbidden', 'unauthorized']);
});

test('the prorector sees a draft in development as «none», no buttons; a student has no door and no secret in what he reads', () => {
  const s = ready();
  s.call('syllabus.startDraft', { subjectId: s.sb4, semester: 1 }, s.t.t4);
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t4, dueDate: '2026-12-07' }, s.t.dean);
  assert.deepEqual(s.call('docs.syllabi', {}, s.t.dean).data.development.map((r) => r.state), ['draft']);
  const pro = s.call('docs.syllabi', {}, s.t.prorector).data;
  assert.deepEqual([pro.development.map((r) => r.state), pro.can, pro.development[0].dueDate], [['none'], { assign: false, setReviewDue: false, choose: false }, '2026-12-07']);
  for (const [action, data] of [['docs.syllabi', {}], ['docs.discipline', { disciplineId: s.ds1 }], ['syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: '' }], ['syllabus.setReviewDue', { lineId: mainOf(s, s.ds1).id, date: '' }]]) {
    assert.equal(code(s.call(action, data, s.t.s1)), 'forbidden', action);
  }
  for (const [action, data, key] of [['syllabus.get', { subjectId: s.sb1 }, 's1'], ['syllabus.get', { subjectId: s.sb4 }, 's1'], ['student.subjects', {}, 's1'], ['syllabus.get', { subjectId: s.sb2 }, 's2'], ['student.grades', {}, 's1']]) {
    const r = s.call(action, data, s.t[key]);
    if (r.ok) assert.equal(SECRETS.test(JSON.stringify(r.data)), false, `${action} ${key}`);
  }
  assert.equal(code(s.call('syllabus.get', { disciplineId: s.ds1 }, s.t.s1)), 'forbidden');
});

test('a queue counts lines: two halves of one version are one; a row carries the line, the discipline and the date', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_AB);
  const id = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  assert.equal(s.call('syllabus.submit', { syllabusId: id }, s.t.t1).data.halves.length, 2);
  const line = mainOf(s, s.ds1);
  s.call('syllabus.setReviewDue', { lineId: line.id, date: '2026-12-04' }, s.t.dean);
  const queue = s.call('syllabus.queue', {}, s.t.dean).data;
  assert.deepEqual([queue.count, queue.rows.length, queue.rows.map((r) => [r.lineId, r.disciplineId, r.reviewDue])], [1, 2, [[line.id, s.ds1, '2026-12-04'], [line.id, s.ds1, '2026-12-04']]]);
  assert.deepEqual([s.call('syllabus.queue', { countOnly: true }, s.t.dean).data, s.call('syllabus.queue', { countOnly: true }, s.t.prorector).data], [{ count: 1 }, { count: 1 }]);
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(board.review.map((r) => [r.halves, r.reviewDue]), [[[1, 2], '2026-12-04']]);
});

test('the card of a discipline in the directory: a short «syllabus» and no «lines»', () => {
  const s = ready();
  s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t2, dueDate: '2026-12-02' }, s.t.dean);
  const card = s.call('dir.card', { table: 'disciplines', id: s.ds1 }, s.t.dean).data;
  assert.deepEqual(card.syllabus, { waiting: false, responsibleName: s.names.t2, dueDate: '2026-12-02', halves: [{ semester: 1, approved: true, open: null }, { semester: 2, approved: false, open: null }] });
  assert.equal(card.lines, undefined);
  s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  assert.deepEqual([s.call('dir.card', { table: 'disciplines', id: s.ds1 }, s.t.dean).data.syllabus.halves[0].open, s.call('dir.card', { table: 'disciplines', id: s.ds1 }, s.t.prorector).data.syllabus.halves[0].open], ['draft', null]);
  for (const key of ['t1', 's1']) assert.equal(code(s.call('dir.card', { table: 'disciplines', id: s.ds1 }, s.t[key])), 'forbidden');
});

test('every action by every role and without a token, with garbage: nothing is written', () => {
  const s = ready();
  s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: '2026-12-02' }, s.t.dean);
  const main = mainOf(s, s.ds1);
  const was = s.snapshot();
  const bad = [[], 5, { id: 1 }, null, '  ', '__proto__', 'x'.repeat(5000), '2026-13-45'];
  for (const token of [s.t.admin, s.t.dean, s.t.prorector, s.t.t1, s.t.t4, s.t.s1, undefined, 'garbage']) {
    for (const v of bad) {
      for (const [action, data] of [
        ['syllabus.assign', { disciplineId: v, teacherId: v, dueDate: v }], ['syllabus.assign', { disciplineId: s.ds1, teacherId: v, dueDate: '' }],
        ['syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: v }], ['syllabus.assign', { disciplineId: v, teacherId: s.ids.t1, dueDate: '' }],
        ['syllabus.setReviewDue', { lineId: v, date: v }], ['syllabus.setReviewDue', { lineId: main.id, date: v }], ['syllabus.setReviewDue', { lineId: v, date: '' }],
        ['docs.discipline', { disciplineId: v }], ['docs.syllabi', { disciplineId: v }],
      ]) {
        const r = s.call(action, data, token);
        assert.notEqual(r.ok ? 'ok' : r.error.code, 'internal', `${action} ${JSON.stringify(v)}`);
        if (action === 'docs.syllabi') continue;
        assert.equal(r.ok, false, `${action} ${JSON.stringify(data)}`);
      }
    }
  }
  assert.deepEqual(s.snapshot(), was);
  assert.deepEqual(s.oneMain(), []);
});

test('speed: the tabs and the card read every sheet once and no pairs or topics; assign does not read versions or pairs', () => {
  const s = ready();
  s.spy.reset();
  s.call('docs.syllabi', {}, s.t.dean);
  assert.deepEqual([Object.keys(s.spy.lists).sort(), Object.values(s.spy.lists).every((n) => n === 1), s.spy.writes], [[...DOCS_TABLES].sort(), true, {}]);
  s.spy.reset();
  s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.t1);
  assert.deepEqual([Object.keys(s.spy.lists).sort(), Object.values(s.spy.lists).every((n) => n === 1), s.spy.writes], [[...DOCS_TABLES].sort(), true, {}]);
  s.spy.reset();
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t5, dueDate: '2026-12-01' }, s.t.dean);
  assert.deepEqual([s.spy.lists.syllabi, s.spy.lists.pairs, s.spy.writes], [undefined, undefined, { 'insertMany:syllabusLines': 1 }]);
  assert.ok(Object.values(s.spy.lists).every((n) => n === 1));
  s.spy.reset();
  s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: s.ids.t4, dueDate: '' }, s.t.dean);
  assert.deepEqual([s.spy.lists.syllabi, s.spy.lists.pairs, s.spy.writes], [undefined, undefined, { 'updateMany:syllabusLines': 1 }]);
});

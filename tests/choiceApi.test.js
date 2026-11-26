import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../backend/api.js';
import { CHOICE_TABLES, choiceLocks } from '../backend/syllabusChoice.js';
import { setup } from './linesSetup.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);

// What the earlier code left laid on the pairs of a subject: the lessons of an old version, in order.
function lay(s, subjectId, versionId) {
  const rows = s.store.list('topics').filter((x) => x.syllabusId === versionId && x.lessonKind !== 'control').sort((a, b) => a.order - b.order);
  const pairs = s.store.list('pairs').filter((p) => p.subjectId === subjectId).sort((a, b) => a.date.localeCompare(b.date));
  rows.forEach((row, i) => { if (pairs[i]) s.store.update('pairs', pairs[i].id, { topicId: row.id, lessonType: 'lecture', part: 1 }); });
}

// Anatomy: t1 (sb1) has the approved «А», t2 (sb2) the approved «Б» (its pair of 2 September is held on «Б1»), t3 (sb3) nothing. After the move the discipline
// waits for the choice: [A, B] are the 'own' lines of t1 and t2 in autumn.
function world({ springToo = false, extra } = {}) {
  const s = setup();
  const a = s.old(s.sb1, s.FILE_A);
  const b = s.old(s.sb2, s.FILE_B);
  if (extra) extra(s);
  if (springToo) { s.old(s.sb1, s.FILE_A, { semester: 2 }); s.old(s.sb2, s.FILE_B, { semester: 2 }); }
  lay(s, s.sb1, a);
  lay(s, s.sb2, b);
  s.hold(s.sb2, '2026-09-02');
  s.upgrade();
  s.at('2026-09-03');
  const own = (key, half = 1) => s.lines(s.ds1).find((l) => l.kind === 'own' && l.semester === half && l.teacherId === s.ids[key]);
  return { s, a, b, A: own('t1'), B: own('t2'), own };
}

// a base without names of rows: ids are random, so people, lines, versions and pairs are written by what they are
function shape(s) {
  const who = new Map(Object.entries(s.ids).map(([key, id]) => [id, key]));
  const w = (id) => who.get(id) ?? id;
  const lineKey = new Map(s.store.list('syllabusLines').map((l) => [l.id, `${l.kind}|${l.disciplineId === s.ds1 ? 'ds1' : 'ds2'}|${l.semester}|${w(l.teacherId)}|${w(l.responsibleId)}`]));
  const subjectKey = new Map(['sb1', 'sb2', 'sb3', 'sb4'].map((k) => [s[k], k]));
  const topicName = new Map(s.store.list('topics').map((x) => [x.id, x.name]));
  return {
    lines: [...lineKey.values()].sort(),
    versions: s.store.list('syllabi').map((v) => `${w(v.teacherId)}|${v.semester}|${v.version}|${v.status}|${lineKey.get(v.lineId) ?? 'none'}`).sort(),
    pairs: s.store.list('pairs').map((p) => `${subjectKey.get(p.subjectId)}|${p.date}|${p.status}|${topicName.get(p.topicId) ?? ''}|${p.lessonType}|${p.part}`).sort(),
  };
}

const chooseOf = (s, A, over = {}) => (data = {}, token = s.t.dean) => s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: A.id, ...over, ...data }, token);

test('syllabus.choose: rights and garbage write nothing; the pick makes one syllabus of the discipline and the pairs follow it', () => {
  const { s, A, B } = world();
  const choose = chooseOf(s, A);
  const was = s.snapshot();
  assert.deepEqual(['t1', 't2', 'prorector', 's1'].map((k) => code(choose({}, s.t[k]))), ['forbidden', 'forbidden', 'forbidden', 'forbidden']);
  assert.equal(code(s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: A.id })), 'unauthorized');
  for (const bad of [[A.id], 5, { id: 1 }, null]) assert.equal(code(choose({ lineId: bad })), 'bad_request', JSON.stringify(bad));
  for (const bad of [[s.ds1], 5, { id: 1 }, null]) assert.equal(code(choose({ disciplineId: bad })), 'bad_request', JSON.stringify(bad));
  for (const bad of ['yes', 1, null, [], {}]) assert.equal(code(choose({ confirm: bad })), 'bad_request', JSON.stringify(bad));
  for (const odd of ['  ', '__proto__']) { const r = choose({ lineId: odd }); assert.ok(!r.ok && r.error.code !== 'internal', odd); }
  for (const odd of ['  ', '__proto__']) { const r = choose({ disciplineId: odd }); assert.ok(!r.ok && r.error.code !== 'internal', odd); }
  assert.deepEqual([code(choose({ semester: 2 })), code(choose({ semester: 3 })), code(choose({ semester: '1' })), code(choose({ lineId: 'sl_none' })), code(choose({ disciplineId: 'ds_none' })), code(choose({ disciplineId: s.ds2 }))],
    ['not_found', 'bad_request', 'bad_request', 'not_found', 'not_found', 'not_found']);
  assert.deepEqual(s.snapshot(), was);

  const mine1 = JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === s.sb1));
  const r = choose({}).data;
  assert.deepEqual([r.chosen, r.resolved, s.oneMain()], [true, true, []]);
  const main = s.main(s.ds1);
  assert.deepEqual([main.responsibleId, s.lines(s.ds1).filter((l) => l.kind === 'own').length], [s.ids.t1, 0]);
  assert.equal(JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === s.sb1)), mine1);                   // the chosen one: nothing changed
  assert.deepEqual(s.topicsOf(s.sb2).slice(0, 3), ['Б1', 'А2', 'А3']);                                              // the held one keeps its topic, the future ones go on
  assert.equal(s.topicsOf(s.sb3)[0], 'А1');                                                                         // a group without topics got them
  assert.deepEqual(s.store.list('syllabi').map((x) => [x.lineId === main.id, x.status]).sort(), [[false, 'approved'], [true, 'approved']]);   // the approved one of the loser stays on its line, as it was
  assert.equal(s.lines(s.ds1).find((l) => l.id === B.id).kind, 'archived');
  assert.equal(code(choose({})), 'not_found');                                                                       // the chosen line is not 'own' any more
  assert.equal(code(choose({ lineId: B.id })), 'not_found');                                                         // nor is the one that lost
});

test('syllabus.choose: the line must be an own line of this discipline and this half', () => {
  const { s, A } = world();
  const other = s.store.insert('syllabusLines', { disciplineId: s.ds2, kind: 'own', semester: 1, teacherId: s.ids.t4, createdAt: '2026-08-01 10:00:00' });
  const was = s.snapshot();
  assert.equal(code(s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: other.id }, s.t.dean)), 'not_found');          // a line of another discipline
  assert.equal(code(s.call('syllabus.choose', { disciplineId: s.ds1, semester: 2, lineId: A.id }, s.t.dean)), 'not_found');               // another half
  const archived = s.store.insert('syllabusLines', { disciplineId: s.ds1, kind: 'archived', semester: 1, teacherId: s.ids.t3, createdAt: '2026-08-01 10:00:00' });
  assert.equal(code(s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: archived.id }, s.t.dean)), 'not_found');
  s.store.insert('syllabusLines', { disciplineId: s.ds1, kind: 'main', semester: null, teacherId: '', responsibleId: '', createdAt: '2026-08-01 10:00:00' });
  const main = s.main(s.ds1);
  assert.equal(code(s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: main.id }, s.t.dean)), 'not_found');
  assert.equal(s.store.list('syllabi').length, was.syllabi.length);
});

test('syllabus.choose: a closed unit or an exam of a group of the current half forbids it, with the name of the group; nothing is written', () => {
  const { s, A } = world();
  const choose = chooseOf(s, A);
  const closure = s.closeUnit(s.sb2, 1);
  const was = s.snapshot();
  const r = choose({});
  assert.equal(code(r), 'line_locked');
  assert.deepEqual(r.error.fields, [{ field: 'group', code: 'unit_closed', name: '02-1' }]);
  assert.deepEqual(s.snapshot(), was);
  s.store.update('closures', closure.id, { reopenedBy: s.ids.dean, reopenedAt: '2026-10-02 10:00:00' });                // reopened: allowed
  assert.equal(code(choose({})), 'ok');

  const w = world();
  w.s.store.insert('subjectExams', { subjectId: w.s.sb2, planSemester: 1, date: '2026-12-25', examiner: '', assistants: '', updatedBy: '', updatedAt: '' });
  const r2 = chooseOf(w.s, w.A)({});
  assert.equal(code(r2), 'line_locked');
  assert.deepEqual(r2.error.fields, [{ field: 'group', code: 'exam_exists', name: '02-1' }]);

  const x = world();
  x.s.store.insert('examAttempts', { subjectId: x.s.sb3, planSemester: 1, studentId: x.s.ids.s3, no: 1, date: '2026-12-25', outcome: 'sat', score: 20, commission: '', updatedBy: '', updatedAt: '' });
  const r3 = chooseOf(x.s, x.A)({});                                                                                   // t3 follows no syllabus now, the chosen one lays the plan half 1, where he has an exam
  assert.deepEqual([code(r3), r3.error.fields], ['line_locked', [{ field: 'group', code: 'exam_exists', name: '03-1' }]]);
});

test('syllabus.choose: a closure of another plan half and a pick for a half that is not the current one do not hinder', () => {
  const { s, A } = world();
  s.closeUnit(s.sb2, 1, 2);                                                  // the plan half 2 of the group: not the half of this syllabus
  assert.equal(code(chooseOf(s, A)({})), 'ok');

  const w = world({ springToo: true });
  w.s.closeUnit(w.s.sb2, 1, 1);                                              // autumn is locked, spring is not the current half
  const spring = w.own('t1', 2);
  const was = shape(w.s);
  const r = chooseOf(w.s, spring, { semester: 2 })({});
  assert.deepEqual([code(r), r.data.resolved], ['ok', false]);              // autumn still waits
  assert.notDeepEqual(shape(w.s), was);
  assert.equal(code(chooseOf(w.s, w.A)({})), 'line_locked');                // the current half: locked
});

test('syllabus.choose: a pick without an approved version needs the confirm; the held pairs keep their topics, the groups of the other lose the future ones', () => {
  const { s, a, A, B } = world();
  s.store.update('syllabi', a, { status: 'draft' });                         // the pick of t1 has only a draft, the one of t2 is approved
  const choose = chooseOf(s, A);
  const was = s.snapshot();
  assert.equal(code(choose({})), 'needs_confirm');
  assert.deepEqual(s.snapshot(), was);
  assert.equal(code(choose({ confirm: false })), 'needs_confirm');
  assert.equal(code(choose({ confirm: true })), 'ok');
  assert.equal(s.topicsOf(s.sb2)[0], 'Б1');
  assert.deepEqual(s.topicsOf(s.sb2).slice(1).filter(Boolean), []);          // the groups of t2 stay without topics until the approval
  assert.equal(s.store.list('syllabi').find((x) => x.lineId === B.id).status, 'approved');   // the approved one of the loser keeps its status
  assert.deepEqual(s.oneMain(), []);

  const w = world();                                                         // the pick is approved: no confirm needed even if the other is approved too
  assert.equal(code(chooseOf(w.s, w.B)({})), 'ok');
  assert.equal(w.s.topicsOf(w.s.sb1)[0], 'Б1');
});

test('syllabus.choose: the open versions of the loser go to the archive and leave the queue', () => {
  const { s, B } = world({ extra: (t) => { t.old(t.sb2, t.FILE_B, { status: 'review', version: 2 }); t.old(t.sb3, t.FILE_B, { status: 'draft' }); } });
  assert.equal(s.call('syllabus.queue', {}, s.t.dean).data.count, 1);
  const r = chooseOf(s, s.lines(s.ds1).find((l) => l.kind === 'own' && l.teacherId === s.ids.t1))({});
  assert.equal(code(r), 'ok');
  const rows = s.store.list('syllabi');
  assert.deepEqual(rows.filter((x) => x.teacherId === s.ids.t2).map((x) => x.status).sort(), ['approved', 'archived']);
  assert.deepEqual(rows.filter((x) => x.teacherId === s.ids.t3).map((x) => x.status), ['archived']);
  assert.equal(rows.filter((x) => x.teacherId === s.ids.t2).every((x) => x.lineId === B.id), true);
  assert.deepEqual(s.call('syllabus.queue', {}, s.t.dean).data.count, 0);
  assert.deepEqual(s.call('syllabus.queue', {}, s.t.dean).data.rows, []);
});

test('syllabus.choose: two halves wait; the first pick leaves the discipline waiting, the second makes one syllabus of both halves', () => {
  const { s, A, own } = world({ springToo: true });
  const first = chooseOf(s, A)({});
  assert.deepEqual([code(first), first.data.resolved, s.main(s.ds1)], ['ok', false, undefined]);
  assert.deepEqual(s.lines(s.ds1).filter((l) => l.kind === 'own' && l.semester === 1).map((l) => l.id), [A.id]);          // the one left of the autumn
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds1, teacherId: s.ids.t1, dueDate: '' }, s.t.dean)), 'choose_first');
  assert.equal(s.topicsOf(s.sb2)[1], 'А2');                                                                              // the groups of the autumn already follow the pick
  assert.equal(code(s.call('syllabus.startDraft', { disciplineId: s.ds1, semester: 1 }, s.t.t1)), 'ok');                  // its owner works on the autumn line
  const winner = own('t2', 2);
  const second = chooseOf(s, winner, { semester: 2 })({});
  assert.deepEqual([code(second), second.data.resolved, s.oneMain()], ['ok', true, []]);
  const main = s.main(s.ds1);
  assert.equal(main.responsibleId, s.ids.t1);                                                                            // equal counts of pairs: the autumn one
  assert.equal(s.lines(s.ds1).filter((l) => l.kind === 'own').length, 0);
  const ofMain = s.store.list('syllabi').filter((x) => x.lineId === main.id);
  assert.deepEqual(ofMain.filter((x) => x.status === 'approved').map((x) => [x.semester, x.teacherId]).sort(), [[1, s.ids.t1], [2, s.ids.t2]]);
  assert.equal(s.store.list('syllabi').filter((x) => x.status === 'approved' && !x.lineId).length, 0);
});

test('syllabus.choose: a half left to wait while the other half already follows the main syllabus', () => {
  const { s, A, own } = world({ springToo: true });
  chooseOf(s, A)({});
  const winner = own('t2', 2);
  chooseOf(s, winner, { semester: 2 })({});
  assert.deepEqual(s.oneMain(), []);
  // a deanery that starts the autumn draft while only the spring waits: draftTarget looks at the requested half only
  const w = world({ springToo: true });
  w.s.store.insert('syllabusLines', { disciplineId: w.s.ds2, kind: 'main', semester: null, teacherId: '', responsibleId: '', createdAt: '2026-08-01 10:00:00' });
  assert.equal(code(w.s.call('syllabus.startDraft', { disciplineId: w.s.ds2, semester: 1 }, w.s.t.dean)), 'ok');
});

test('syllabus.choose: the main line that already exists takes the pick of the last half; its responsible stays', () => {
  const { s, A } = world();
  const main = s.store.insert('syllabusLines', { disciplineId: s.ds1, kind: 'main', semester: null, teacherId: '', responsibleId: s.ids.t3, createdAt: '2026-08-01 10:00:00' });
  assert.equal(code(chooseOf(s, A)({})), 'ok');
  assert.deepEqual([s.oneMain(), s.main(s.ds1).id, s.main(s.ds1).responsibleId], [[], main.id, s.ids.t3]);
  assert.equal(s.store.list('syllabi').find((x) => x.teacherId === s.ids.t1).lineId, main.id);
});

test('syllabus.choose: the other discipline, the column «teacher» and the other rows are not touched', () => {
  const { s, A } = world();
  const before = {
    chem: JSON.stringify([s.store.list('pairs').filter((p) => p.subjectId === s.sb4), s.lines(s.ds2)]),
    teachers: s.store.list('syllabi').map((x) => [x.id, x.teacherId, x.version, x.semester, x.planSemester]),
    tables: Object.fromEntries(['closures', 'subjectExams', 'examAttempts', 'topics', 'staff', 'subjects', 'settings'].map((t) => [t, s.store.list(t)])),
  };
  assert.equal(code(chooseOf(s, A)({})), 'ok');
  assert.equal(JSON.stringify([s.store.list('pairs').filter((p) => p.subjectId === s.sb4), s.lines(s.ds2)]), before.chem);
  assert.deepEqual(s.store.list('syllabi').map((x) => [x.id, x.teacherId, x.version, x.semester, x.planSemester]), before.teachers);
  for (const [t, rows] of Object.entries(before.tables)) assert.deepEqual(s.store.list(t), rows, t);
});

test('syllabus.choose: a pick shorter than what is held in the other group leaves the future pairs without topics, with no error', () => {
  const { s, B } = world();
  for (const p of s.store.list('pairs').filter((x) => x.subjectId === s.sb2).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12)) {
    if (p.status !== 'closed') s.store.update('pairs', p.id, { status: 'closed' });
  }
  const heldBefore = s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.status === 'closed').map(({ id, topicId, lessonType, part }) => [id, topicId, lessonType, part]);
  assert.equal(code(chooseOf(s, B)({})), 'ok');
  const heldAfter = s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.status === 'closed').map(({ id, topicId, lessonType, part }) => [id, topicId, lessonType, part]);
  assert.deepEqual(heldAfter.filter(([, t]) => t !== ''), heldBefore.filter(([, t]) => t !== ''));      // a held pair with a topic never changes
  assert.equal(s.store.list('pairs').filter((p) => p.subjectId === s.sb2 && p.status === 'planned').every((p) => p.topicId === '' || p.topicId), true);
});

test('syllabus.choose: after the pick the documents show one approved syllabus and the history', () => {
  const { s, A, B } = world();
  chooseOf(s, A)({});
  const board = s.call('docs.syllabi', {}, s.t.dean).data;
  assert.deepEqual(board.approved.filter((r) => r.disciplineName === 'Анатомия').map((r) => r.waiting), [false]);
  assert.deepEqual(board.development.filter((r) => r.disciplineName === 'Анатомия'), []);
  const card = s.call('docs.discipline', { disciplineId: s.ds1 }, s.t.dean).data;
  assert.deepEqual(card.waiting, []);
  assert.deepEqual(card.history.filter((h) => h.former).map((h) => [h.teacherName, h.status]), [[s.names.t2, 'approved']]);
  assert.equal(card.can.choose, false);
  // t2 reads the draft of the discipline and does not edit it
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1);
  assert.equal(code(draft), 'ok');
  const form = s.call('syllabus.form', { syllabusId: draft.data.syllabusId }, s.t.t2);
  assert.deepEqual([code(form), form.data.can.edit], ['ok', false]);
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: draft.data.syllabusId, section: 'goals', data: { goal: 'x' } }, s.t.t2)), 'forbidden');
  assert.equal(B.kind, 'own');
});

// a break of each write and the same request again: the result is the one of a clean pass
for (const [method, table] of [['insertMany', 'syllabusLines'], ['updateMany', 'pairs'], ['updateMany', 'syllabi'], ['updateMany', 'syllabusLines']]) {
  for (const approvedLoser of [false, true]) {
    test(`syllabus.choose: a break of ${method} ${table}${approvedLoser ? ' (the loser is approved)' : ''} is mended by the same request`, () => {
      const make = () => {
        const w = world();
        if (!approvedLoser) w.s.store.update('syllabi', w.s.store.list('syllabi').find((x) => x.teacherId === w.s.ids.t2).id, { status: 'draft' });
        return w;
      };
      const clean = make();
      assert.equal(code(chooseOf(clean.s, clean.A)({})), 'ok');
      const { s, A } = make();
      const request = JSON.stringify({ action: 'syllabus.choose', data: { disciplineId: s.ds1, semester: 1, lineId: A.id }, token: s.t.dean });
      const broken = handleRequest(request, { store: s.failingOn(method, table), platform: s.platform, log: () => {} });
      assert.equal(broken.ok, false);
      const again = s.call('syllabus.choose', { disciplineId: s.ds1, semester: 1, lineId: A.id }, s.t.dean);
      assert.equal(code(again), 'ok', JSON.stringify(again));
      assert.deepEqual(shape(s), shape(clean.s));
      assert.deepEqual(s.oneMain(), []);
    });
  }
}

test('syllabus.choose: a repeat checks the locks again; a unit closed between the two passes forbids the rest', () => {
  const { s, A } = world();
  const request = { disciplineId: s.ds1, semester: 1, lineId: A.id };
  const broken = handleRequest(JSON.stringify({ action: 'syllabus.choose', data: request, token: s.t.dean }), { store: s.failingOn('updateMany', 'syllabusLines'), platform: s.platform, log: () => {} });
  assert.equal(broken.ok, false);
  s.closeUnit(s.sb2, 1);
  const was = s.snapshot();
  assert.equal(code(s.call('syllabus.choose', request, s.t.dean)), 'line_locked');
  assert.deepEqual(s.snapshot(), was);
});

test('syllabus.choose: every table of the pick is read once; the lock rule is a function of the rows', () => {
  const { s, A } = world();
  s.spy.reset();
  assert.equal(code(chooseOf(s, A)({})), 'ok');
  for (const table of CHOICE_TABLES) assert.ok((s.spy.lists[table] || 0) <= 1, `${table} read ${s.spy.lists[table]} times`);
  assert.equal(Object.entries(s.spy.writes).filter(([key]) => key.startsWith('insertMany:syllabusLines')).length, 1);
  const settings = { semester: 1, semesterStart: '2026-09-01', semesterEnd: '2026-12-20' };
  const w = world();
  const open = () => Object.fromEntries(['subjects', 'syllabi', 'syllabusLines', 'topics', 'pairs', 'closures', 'subjectExams', 'examAttempts', 'groups'].map((t) => [t, w.s.store.list(t)]));
  assert.deepEqual([choiceLocks(open(), settings, w.A), choiceLocks(open(), { ...settings, semester: 2 }, w.A)], [[], []]);
  w.s.closeUnit(w.s.sb2, 1);
  assert.deepEqual([choiceLocks(open(), settings, w.A), choiceLocks(open(), { ...settings, semester: 2 }, w.A)], [[{ field: 'group', code: 'unit_closed', name: '02-1' }], []]);
});

test('syllabus.assign without a line writes nothing for nobody and no date; syllabus.setReviewDue reports a missing line before a bad date', () => {
  const s = setup();
  const was = s.snapshot();
  const r = s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: '', dueDate: '' }, s.t.dean);
  assert.deepEqual([code(r), r.data.line.responsibleId, r.data.line.kind], ['ok', '', 'main']);
  assert.deepEqual(s.snapshot(), was);
  assert.equal(code(s.call('syllabus.assign', { disciplineId: s.ds2, teacherId: '', dueDate: '2026-12-01' }, s.t.dean)), 'ok');
  assert.equal(s.lines(s.ds2).length, 1);
  assert.equal(code(s.call('syllabus.setReviewDue', { lineId: 'sl_none', date: '2026-13-45' }, s.t.dean)), 'not_found');
  assert.equal(code(s.call('syllabus.setReviewDue', { lineId: s.lines(s.ds2)[0].id, date: '2026-13-45' }, s.t.dean)), 'bad_request');
});

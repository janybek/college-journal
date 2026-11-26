import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../backend/api.js';
import { createMemoryFiles } from './fakes/memoryFiles.js';
import { SAMPLE, b64 } from './fakes/sampleFiles.js';
import { setup, FILE_A, FILE_B } from './linesSetup.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);
const GOALS = { goal: 'Цель курса' };

// a title and a goal for a draft, as the form of the deanery would write them
function fill(s, syllabusId) {
  const form = s.call('syllabus.form', { syllabusId }, s.t.dean).data;
  const title = { ...form.doc.title, department: form.doc.title.department || 'Кафедра', academicYear: form.doc.title.academicYear || '2026–2027', course: form.doc.title.course || 1, credits: form.doc.title.credits || 1 };
  s.call('syllabus.saveSection', { syllabusId, section: 'title', data: title }, s.t.dean);
  s.call('syllabus.saveSection', { syllabusId, section: 'goals', data: { ...form.doc.goals, goal: form.doc.goals.goal || 'Цель курса' } }, s.t.dean);
}

function ready(options) {
  const s = setup(options);
  s.publish(s.sb1, s.FILE_A);
  const draft = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  return { s, draft };
}

test('who saves, reads and submits the draft of the syllabus of the discipline', () => {
  const { s, draft } = ready();
  const save = (token) => code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: GOALS }, token));
  assert.deepEqual(['t1', 't2', 't4', 'dean', 'prorector'].map((k) => save(s.t[k])), ['ok', 'forbidden', 'forbidden', 'ok', 'forbidden']);
  const form = (token) => s.call('syllabus.form', { syllabusId: draft }, token);
  assert.deepEqual([form(s.t.t2).data.can.edit, form(s.t.t2).data.line.mine, code(form(s.t.t4)), code(form(s.t.t5)), code(form(s.t.s2))], [false, 'teaches', 'forbidden', 'forbidden', 'forbidden']);
  assert.deepEqual([form(s.t.t1).data.line.mine, form(s.t.t1).data.line.kind, form(s.t.t1).data.line.responsibleName], ['responsible', 'main', s.names.t1]);
  assert.deepEqual(['t2', 't4', 't1', 'prorector'].map((k) => code(s.call('syllabus.submit', { syllabusId: draft, dryRun: true }, s.t[k]))), ['forbidden', 'forbidden', 'ok', 'forbidden']);
  assert.equal(code(s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2)), 'forbidden');
  const before = s.snapshot();
  for (const k of ['t2', 't4', 't5', 's2']) assert.equal(code(s.call('syllabus.approve', { syllabusId: draft }, s.t[k])), 'forbidden');
  assert.deepEqual(s.snapshot(), before);
});

test('a student gets only the teacher of his group, nothing else about the syllabus of the discipline', () => {
  const { s } = ready();
  const page = s.call('syllabus.get', { subjectId: s.sb2 }, s.t.s2).data;
  assert.deepEqual(page.line, { teachers: [{ fullName: s.names.t2 }] });
  assert.equal(/responsible|dueDate|reviewDue|createdBy/.test(JSON.stringify(page)), false);
  for (const id of [s.ids.t1, s.ids.t3, s.ids.dean]) assert.equal(JSON.stringify(page).includes(id), false);
  assert.equal(page.subject.teacherId, s.ids.t2);
  const own = s.call('syllabus.get', { subjectId: s.sb1 }, s.t.s1).data;
  assert.deepEqual(own.line, { teachers: [{ fullName: s.names.t1 }] });
  assert.equal(code(s.call('syllabus.get', { subjectId: s.sb1 }, s.t.s2)), 'forbidden');
  assert.equal(/"(approved|open)":\{[^}]*"(authorName|members)"/.test(JSON.stringify(page)), false);
});

test('the first draft of a discipline without a syllabus: the leader becomes the responsible, the second leader and a second main are refused', () => {
  const s = setup();
  const done = s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2);
  assert.equal(done.data.created, true);
  const main = s.main(s.ds1);
  assert.deepEqual([main.kind, main.responsibleId, main.createdBy, s.lines(s.ds1).length], ['main', s.ids.t2, s.ids.t2, 1]);
  const before = s.snapshot();
  for (const [key, sb] of [['t1', s.sb1], ['t3', s.sb3]]) assert.equal(code(s.call('syllabus.startDraft', { subjectId: sb, semester: 1 }, s.t[key])), 'forbidden');
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual([s.oneMain(), s.lines(s.ds1).length], [[], 1]);
  // the deanery starts from the page of a subject: the responsible is the teacher of that subject
  const t = setup();
  assert.equal(t.call('syllabus.startDraft', { subjectId: t.sb3, semester: 1 }, t.t.dean).data.created, true);
  assert.deepEqual([t.main(t.ds1).responsibleId, t.main(t.ds1).createdBy, t.store.list('syllabi')[0].teacherId], [t.ids.t3, t.ids.dean, t.ids.t3]);
  assert.deepEqual(t.oneMain(), []);
});

test('a break after the line is made: the line stays without versions, the next click takes it again', () => {
  const s = setup();
  const broken = handleRequest(JSON.stringify({ action: 'syllabus.startDraft', data: { subjectId: s.sb1, semester: 1 }, token: s.t.t1 }),
    { store: s.failingOn('insertMany', 'syllabi'), platform: s.platform, log: () => {} });
  assert.equal(broken.ok, false);
  assert.deepEqual([s.lines(s.ds1).length, s.store.list('syllabi').length], [1, 0]);
  const line = s.main(s.ds1);
  const done = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1);
  assert.equal(done.data.created, true);
  assert.deepEqual([s.lines(s.ds1).length, s.main(s.ds1).id, s.store.list('syllabi')[0].lineId, s.oneMain()], [1, line.id, line.id, []]);
  // a second teacher cannot take the line meanwhile
  assert.equal(code(s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2)), 'forbidden');
});

test('the approval lays the pairs of every group of the discipline and does not touch another discipline; the number and the teacher of the version', () => {
  const { s, draft } = ready();
  assert.equal(s.store.list('syllabi').find((v) => v.id === draft).teacherId, s.ids.t1);
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  const chemistry = s.topicsOf(s.sb4);
  s.publish(s.sb1, s.FILE_B);
  assert.deepEqual([s.topicsOf(s.sb1)[0], s.topicsOf(s.sb2)[0], s.topicsOf(s.sb3)[0]], ['Б1', 'Б1', 'Б1']);
  assert.deepEqual(s.topicsOf(s.sb4), chemistry);
  assert.deepEqual(s.oneMain(), []);
  assert.deepEqual(s.store.list('syllabi').map((v) => [v.status, v.teacherId === s.ids.t1]).sort(), [['approved', true], ['archived', true]]);
});

test('a held pair of another group keeps its lesson: the error names the date and the group', () => {
  const { s, draft } = ready();
  s.store.update('syllabi', draft, { status: 'archived' });          // the draft of the helper is not needed
  s.hold(s.sb2, '2026-09-02');
  assert.equal(s.topicsOf(s.sb2)[0], 'А1');
  const next = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  fill(s, next);
  const form = s.call('syllabus.form', { syllabusId: next }, s.t.t1).data;
  const units = form.doc.plan.units.map((u) => ({ ...u, lecture: u.lecture.filter((l) => l.name !== 'А1') }));
  assert.equal(code(s.call('syllabus.saveSection', { syllabusId: next, section: 'plan', data: { units } }, s.t.t1)), 'ok');
  const checks = s.call('syllabus.form', { syllabusId: next }, s.t.dean).data.checks.errors.filter((e) => e.code === 'held_missing');
  assert.deepEqual(checks, [{ section: 'plan', code: 'held_missing', name: 'А1', date: '2026-09-02', group: '02-1' }]);
  const before = s.snapshot();
  const approved = s.call('syllabus.approve', { syllabusId: next }, s.t.dean).data;
  assert.deepEqual([approved.approved, approved.changedPairs], [false, 0]);
  assert.deepEqual(s.snapshot(), before);
});

test('the responsible is changed: the former one cannot save, the new one can', () => {
  const { s, draft } = ready();
  const save = (key) => code(s.call('syllabus.saveSection', { syllabusId: draft, section: 'goals', data: GOALS }, s.t[key]));
  s.store.update('syllabusLines', s.main(s.ds1).id, { responsibleId: s.ids.t2 });
  assert.deepEqual([save('t1'), save('t2')], ['forbidden', 'ok']);
  assert.equal(s.call('syllabus.form', { syllabusId: draft }, s.t.t1).data.can.edit, false);
  assert.equal(code(s.call('syllabus.form', { syllabusId: draft }, s.t.t1)), 'ok');            // he still leads the discipline: reads
  s.store.update('staff', s.ids.t2, { roles: 'student' });                                      // the new one loses the role of a teacher: nothing is allowed to him
  assert.deepEqual([save('t1'), save('t2')], ['forbidden', 'forbidden']);
  s.store.update('staff', s.ids.t2, { roles: 'teacher', active: false });                       // or he is disabled: his token is dead
  assert.deepEqual([save('t1'), save('t2')], ['forbidden', 'unauthorized']);
});

test('the file of a version: who gets it', () => {
  const { s, draft } = ready({ files: createMemoryFiles() });
  const attach = (token, id = draft) => s.call('syllabus.attachFile', { syllabusId: id, name: 'S.pdf', data: b64(SAMPLE.pdf) }, token);
  assert.deepEqual([code(attach(s.t.t2)), code(attach(s.t.prorector)), code(attach(s.t.t1))], ['forbidden', 'forbidden', 'ok']);
  const read = (key, id = draft) => code(s.call('syllabus.file', { syllabusId: id }, s.t[key]));
  assert.deepEqual(['t1', 't2', 'dean', 'prorector', 't4', 't5', 's1', 's2'].map((k) => read(k)), ['ok', 'ok', 'ok', 'forbidden', 'forbidden', 'forbidden', 'not_found', 'not_found']);
  fill(s, draft);
  assert.equal(code(s.call('syllabus.submit', { syllabusId: draft }, s.t.t1)), 'ok');
  assert.equal(code(s.call('syllabus.approve', { syllabusId: draft }, s.t.dean)), 'ok');
  assert.deepEqual(['t1', 't2', 't3', 'prorector', 't4', 't5', 's1', 's2', 's3'].map((k) => read(k)), ['ok', 'ok', 'ok', 'ok', 'forbidden', 'forbidden', 'ok', 'ok', 'ok']);
  // a version of a line of the history: the deanery and the administrator only
  const line = s.store.insert('syllabusLines', { disciplineId: s.ds1, kind: 'archived', semester: 1, teacherId: s.ids.t3, createdAt: '2026-08-01 10:00:00' });
  const old = s.store.insert('syllabi', { ...s.store.list('syllabi').find((v) => v.id === draft), id: undefined, lineId: line.id, status: 'approved', version: 9 });
  assert.deepEqual(['admin', 'dean', 't1', 't3', 'prorector', 's1'].map((k) => read(k, old.id)), ['ok', 'ok', 'forbidden', 'forbidden', 'forbidden', 'not_found']);
  for (const k of ['t1', 't3']) assert.equal(code(s.call('syllabus.saveSection', { syllabusId: old.id, section: 'goals', data: GOALS }, s.t[k])), 'forbidden');
});

test('the discipline waits for the choice in the spring, the autumn has the only own syllabus of t1: t2 reads it and cannot change it', () => {
  const s = setup({ files: createMemoryFiles() });
  const make = (key, sb, half, status = 'approved') => {
    const line = s.store.list('syllabusLines').find((l) => l.kind === 'own' && l.teacherId === s.ids[key] && l.semester === half)
      ?? s.store.insert('syllabusLines', { disciplineId: s.ds1, kind: 'own', semester: half, teacherId: s.ids[key], createdAt: '2026-08-01 10:00:00' });
    return s.store.insert('syllabi', { disciplineId: s.ds1, teacherId: s.ids[key], semester: half, planSemester: half, status, version: 1, lineId: line.id, course: 1 }).id;
  };
  const autumn = make('t1', s.sb1, 1);
  const spring1 = make('t1', s.sb1, 2);
  const spring2 = make('t2', s.sb2, 2);
  // the file of the autumn version (it is approved: the row is put by hand)
  const row = s.store.insert('files', { assignmentId: '', submissionId: '', ownerId: s.ids.t1, state: 'syllabus', name: 'S.pdf', kind: 'pdf', size: SAMPLE.pdf.length, stored: 'a'.repeat(32) + '.bin', at: '2026-08-31 10:00:00' });
  s.files.put(row.stored, SAMPLE.pdf);
  s.store.update('syllabi', autumn, { fileId: row.id });
  const form = s.call('syllabus.form', { syllabusId: autumn }, s.t.t2);
  assert.deepEqual([form.ok, form.data.can, form.data.line.mine], [true, { edit: false, submit: false, approve: false, giveBack: false }, 'teaches']);
  assert.equal(code(s.call('syllabus.file', { syllabusId: autumn }, s.t.t2)), 'ok');
  for (const action of ['syllabus.saveSection', 'syllabus.submit', 'syllabus.attachFile']) {
    assert.equal(code(s.call(action, { syllabusId: autumn, section: 'goals', data: GOALS, name: 'a.pdf' }, s.t.t2)), 'forbidden', action);
  }
  assert.equal(code(s.call('syllabus.form', { syllabusId: spring1 }, s.t.t2)), 'forbidden');
  assert.equal(code(s.call('syllabus.file', { syllabusId: spring1 }, s.t.t2)), 'forbidden');
  assert.equal(code(s.call('syllabus.form', { syllabusId: spring2 }, s.t.t1)), 'forbidden');
  assert.equal(code(s.call('syllabus.startDraft', { subjectId: s.sb3, semester: 2 }, s.t.t3)), 'choose_first');
  assert.equal(code(s.call('syllabus.startDraft', { subjectId: s.sb2, semester: 1 }, s.t.t2)), 'forbidden');
});

test('the queue names the responsible; a version without a line is not found, never internal', () => {
  const { s, draft } = ready({ files: createMemoryFiles() });
  fill(s, draft);
  s.call('syllabus.submit', { syllabusId: draft }, s.t.t1);
  const queue = s.call('syllabus.queue', {}, s.t.dean).data;
  assert.deepEqual(queue.rows.map((r) => [r.teacherName, r.subjectId, 'authorName' in r, 'members' in r]), [[s.names.t1, s.sb1, false, false]]);
  const lost = s.store.insert('syllabi', { disciplineId: s.ds1, teacherId: s.ids.t1, semester: 1, planSemester: 1, status: 'draft', version: 7 }).id;
  const before = s.snapshot();
  for (const [action, data] of [['syllabus.form', {}], ['syllabus.saveSection', { section: 'goals', data: GOALS }], ['syllabus.submit', {}], ['syllabus.approve', {}], ['syllabus.return', { remark: 'x' }],
    ['syllabus.attachFile', { name: 'a.pdf', data: 'QUJD' }], ['syllabus.dropFile', {}], ['syllabus.file', {}]]) {
    assert.equal(code(s.call(action, { syllabusId: lost, ...data }, s.t.dean)), 'not_found', action);
  }
  assert.deepEqual(s.snapshot(), before);
});

test('dir.remove: a person who is only in the responsible of a line and a discipline with a line stay (in_use)', () => {
  const { s } = ready();
  const free = s.store.insert('staff', { fullName: 'Свободный', login: 'free', passwordHash: 'x', roles: 'teacher', lang: 'ky', mustChangePassword: false, active: true }).id;
  const line = s.main(s.ds1);
  const remove = (table, id) => s.call('dir.remove', { table, id }, s.t.admin);
  for (const field of ['responsibleId', 'teacherId', 'createdBy']) {
    const was = line[field];
    s.store.update('syllabusLines', line.id, { [field]: free });
    const before = s.snapshot();
    assert.equal(code(remove('staff', free)), 'in_use', field);
    assert.deepEqual(s.snapshot(), before);
    s.store.update('syllabusLines', line.id, { [field]: was });
  }
  assert.equal(remove('staff', free).ok, true);
  const ds3 = s.store.insert('disciplines', { name: 'Латынь' }).id;
  const ghost = s.store.insert('syllabusLines', { disciplineId: ds3, kind: 'main', semester: null, createdAt: '2026-09-01 09:00:00' });
  assert.equal(code(remove('disciplines', ds3)), 'in_use');
  s.store.remove('syllabusLines', ghost.id);
  assert.equal(remove('disciplines', ds3).ok, true);
});

test('syllabus.apply and preview without the right write nothing', () => {
  const { s, draft } = ready();
  const before = s.snapshot();
  for (const key of ['t2', 't4', 't5', 'prorector', 's1']) {
    for (const action of ['syllabus.apply', 'syllabus.preview']) assert.equal(code(s.call(action, { subjectId: s.sb1, sheets: s.FILE_B }, s.t[key])), 'forbidden', `${action} ${key}`);
  }
  assert.equal(code(s.call('syllabus.apply', { subjectId: s.sb1, sheets: s.FILE_B }, s.t.t1)), 'ok');
  assert.notDeepEqual(s.snapshot(), before);
  assert.equal(draft.length > 0, true);
  // the file for a half where the discipline waits for the choice is refused as a whole
  const t = setup();
  const ln = (key, half) => t.store.insert('syllabusLines', { disciplineId: t.ds1, kind: 'own', semester: half, teacherId: t.ids[key], createdAt: '2026-08-01 10:00:00' });
  ln('t1', 2); ln('t2', 2);
  const year = [{ name: 'Сведения', cells: [['Семестр', '1-2']] }, { name: 'Тематический план', cells: [['Семестр', 'Юнит', '№', 'Тема', 'Лекция, ч', 'Практика, ч', 'Вид занятия', 'Описание'], [1, 1, '', 'Осень', 2, '', '', 'о'], [2, 1, '', 'Весна', 2, '', '', 'о']] }];
  const snap = t.snapshot();
  for (const key of ['t1', 'dean']) assert.equal(code(t.call('syllabus.apply', { subjectId: t.sb1, sheets: year }, t.t[key])), 'choose_first');
  assert.deepEqual(t.snapshot(), snap);
});

// every id of a request is a plain string: an array, a number, an object, spaces, an empty string, '__proto__' and the like give an error, never a write
test('garbage in the ids of every request about a syllabus: an error, not internal, nothing written', () => {
  const { s, draft } = ready({ files: createMemoryFiles() });
  const garbage = [[draft], 7, {}, ' ' + draft, draft + ' ', '   ', '', '__proto__', null, true, { id: draft }, ['__proto__'], 'constructor'];
  const before = s.snapshot();
  const who = ['dean', 'admin', 't1', 't2', 't4', 'prorector', 's1', 's2'];
  const actions = [['syllabus.form', {}], ['syllabus.saveSection', { section: 'goals', data: GOALS }], ['syllabus.submit', {}], ['syllabus.approve', {}], ['syllabus.return', { remark: 'x' }],
    ['syllabus.attachFile', { name: 'a.pdf', data: b64(SAMPLE.pdf) }], ['syllabus.dropFile', {}], ['syllabus.file', {}]];
  for (const [action, extra] of actions) {
    for (const bad of garbage) {
      for (const key of who) {
        const r = s.call(action, { syllabusId: bad, ...extra }, s.t[key]);
        assert.equal(r.ok, false, `${action} ${key} ${JSON.stringify(bad)}`);
        assert.notEqual(r.error.code, 'internal', `${action} ${key} ${JSON.stringify(bad)}`);
      }
    }
  }
  for (const [action, extra] of [['syllabus.startDraft', { semester: 1 }], ['syllabus.get', {}], ['syllabus.apply', { sheets: FILE_A }], ['syllabus.preview', { sheets: FILE_B }]]) {
    for (const bad of garbage) {
      for (const key of who) {
        const r = s.call(action, { subjectId: bad, ...extra }, s.t[key]);
        assert.equal(r.ok, false, `${action} ${key} ${JSON.stringify(bad)}`);
        assert.notEqual(r.error.code, 'internal', `${action} ${key} ${JSON.stringify(bad)}`);
      }
    }
  }
  for (const key of ['dean', 'admin', 't1', 't2']) assert.equal(code(s.call('syllabus.startDraft', { lineId: 'x', semester: 1 }, s.t[key])), 'bad_request');
  assert.deepEqual(s.snapshot(), before);
  assert.deepEqual(s.call('syllabus.form', { syllabusId: draft }, null).error, { code: 'unauthorized' });
});

test('the page of a syllabus: the line is shown to the staff by what they may see', () => {
  const { s } = ready();
  const staff = s.call('syllabus.get', { subjectId: s.sb1 }, s.t.dean).data;
  assert.deepEqual([staff.line.kind, staff.line.responsibleName, staff.line.teachers.map((t) => t.fullName), staff.line.mine], ['main', s.names.t1, [s.names.t1, s.names.t2, s.names.t3], null]);
  assert.deepEqual(staff.groups.map((g) => [g.groupName, g.teacherName]), [['01-1', s.names.t1], ['02-1', s.names.t2], ['03-1', s.names.t3]]);
  const mine = s.call('syllabus.get', { subjectId: s.sb2 }, s.t.t2).data;
  assert.deepEqual([mine.line.mine, mine.groups.map((g) => g.groupName), mine.can.fill, mine.can.edit], ['teaches', ['02-1'], false, false]);
  const lead = s.call('syllabus.get', { subjectId: s.sb1 }, s.t.t1).data;
  assert.deepEqual([lead.line.mine, lead.can.edit], ['responsible', true]);
  assert.equal(JSON.stringify(s.call('syllabus.get', { subjectId: s.sb2 }, s.t.s2).data).includes('passwordHash'), false);
});

test('speed: every table is read at most once per request about a syllabus', () => {
  const { s, draft } = ready({ files: createMemoryFiles() });
  fill(s, draft);
  const requests = [['syllabus.get', { subjectId: s.sb2 }, 't2'], ['syllabus.form', { syllabusId: draft }, 't1'], ['syllabus.submit', { syllabusId: draft }, 't1'],
    ['syllabus.approve', { syllabusId: draft }, 'dean'], ['syllabus.queue', {}, 'dean'], ['syllabus.queue', { countOnly: true }, 'dean'],
    ['syllabus.apply', { subjectId: s.sb1, sheets: FILE_B }, 't1'], ['student.subjects', {}, 's2']];
  for (const [action, data, key] of requests) {
    s.spy.reset();
    const r = s.call(action, data, s.t[key]);
    assert.equal(r.ok, true, `${action} ${JSON.stringify(r)}`);
    assert.ok(Object.values(s.spy.lists).every((n) => n === 1), `${action}: ${JSON.stringify(s.spy.lists)}`);
  }
  assert.deepEqual(s.oneMain(), []);
});

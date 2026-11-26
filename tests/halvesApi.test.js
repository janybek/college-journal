import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './linesSetup.js';
import { INFO, file } from './syllabusSetup.js';

const code = (r) => (r.ok ? 'ok' : r.error.code);
const topic = (unit, name) => [unit, '', name, 2, '', '', 'О теме ' + name];
const SPRING = file([topic(1, 'ВВ1'), topic(1, 'ВВ2'), [1, '', '', '', '', 'модуль', '']], [['Семестр', 2], ...INFO.slice(1)]);

// the deanery has approved the file for both halves: version 1 in the autumn and in the spring
function ready(file = 'FILE_AB') {
  const s = setup();
  s.publish(s.sb1, s[file]);
  const main = s.main(s.ds1);
  const mine = () => s.store.list('syllabi').filter((x) => x.lineId === main.id);
  const half = (semester, status) => mine().find((x) => x.semester === semester && (status === undefined || x.status === status));
  const start = (semester = 1, token = s.t.t1) => s.call('syllabus.startDraft', { subjectId: s.sb1, semester }, token).data.syllabusId;
  return { s, main, mine, half, start };
}

test('a new version is a draft of both halves with one number; sent, approved and returned together', () => {
  const { s, main, mine } = ready();
  const id1 = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  assert.deepEqual(mine().filter((x) => x.status === 'draft').map((x) => [x.semester, x.version]), [[1, 2], [2, 2]]);   // новая версия — обе половины, один номер
  const sent = s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1).data;
  assert.deepEqual([sent.submitted, sent.halves, mine().filter((x) => x.status === 'review').length], [true, [1, 2], 2]);
  const done = s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean).data;
  assert.deepEqual([done.approved, done.halves, mine().filter((x) => x.status === 'approved').map((x) => x.version)], [true, [1, 2], [2, 2]]);
  assert.deepEqual(mine().filter((x) => x.status === 'archived').length, 2);
  assert.deepEqual(s.oneMain(), []);
  assert.equal(s.main(s.ds1).id, main.id);
});

test('the deanery approves a draft or a returned version without sending: both halves', () => {
  const { s, mine, start } = ready();
  const id1 = start();
  assert.deepEqual(s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean).data.halves, [1, 2]);
  assert.deepEqual(mine().filter((x) => x.status === 'approved').map((x) => x.version), [2, 2]);
  const id2 = start();
  s.call('syllabus.submit', { syllabusId: id2 }, s.t.t1);
  assert.equal(s.call('syllabus.return', { syllabusId: id2, remark: 'доработать' }, s.t.dean).data.returned, true);
  assert.deepEqual(mine().filter((x) => x.status === 'returned').map((x) => x.semester), [1, 2]);
  const done = s.call('syllabus.approve', { syllabusId: id2 }, s.t.dean).data;
  assert.deepEqual([done.approved, done.halves], [true, [1, 2]]);
  assert.deepEqual(mine().filter((x) => x.status === 'approved').map((x) => x.version), [3, 3]);
});

test('the responsible teacher, a teacher who only leads, and others cannot approve; nothing is written', () => {
  const { s, start } = ready();
  const id1 = start();
  s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1);
  const before = s.snapshot();
  for (const key of ['t1', 't2', 't4', 't5', 'prorector', 's1', 's2']) assert.equal(code(s.call('syllabus.approve', { syllabusId: id1 }, s.t[key])), 'forbidden', key);
  assert.equal(code(s.call('syllabus.approve', { syllabusId: id1 })), 'unauthorized');
  for (const key of ['t1', 't2', 's1']) assert.equal(code(s.call('syllabus.return', { syllabusId: id1, remark: 'x' }, s.t[key])), 'forbidden', key);
  assert.deepEqual(s.snapshot(), before);
});

test('an unstarted spring does not take part; a started one with an error stops everything', () => {
  const { s, mine, half } = ready('FILE_A');
  const id1 = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 2 }, s.t.t1).data.syllabusId;
  assert.deepEqual(mine().filter((x) => x.status === 'draft').map((x) => [x.semester, x.version]), [[1, 2], [2, 2]]);   // the autumn copy and an empty spring
  assert.equal(s.store.list('topics').filter((t) => t.syllabusId === half(2, 'draft').id).length, 0);
  const sent = s.call('syllabus.submit', { syllabusId: half(1, 'draft').id }, s.t.t1).data;
  assert.deepEqual([sent.submitted, sent.halves, half(2, 'draft') !== undefined], [true, [1], true]);
  assert.deepEqual(s.call('syllabus.approve', { syllabusId: half(1, 'review').id }, s.t.dean).data.halves, [1]);
  assert.deepEqual([half(1, 'approved').version, half(2, 'draft').status], [2, 'draft']);
  // the spring is sent on its own once it is filled
  const empty = s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1).data;
  assert.deepEqual([empty.submitted, empty.checks.errors.some((e) => e.semester === undefined)], [false, true]);
  assert.equal(half(2, 'draft').status, 'draft');
  const filled = s.call('syllabus.apply', { subjectId: s.sb1, sheets: SPRING }, s.t.t1).data;
  assert.deepEqual([filled.applied, filled.drafts.map((d) => d.syllabusId)], [true, [id1]]);
  for (const section of ['title', 'goals']) {
    const form = s.call('syllabus.form', { syllabusId: id1 }, s.t.dean).data.doc;
    const data = section === 'title'
      ? { ...form.title, department: 'Кафедра', academicYear: '2026–2027', course: 1, credits: 1 } : { ...form.goals, goal: 'Цель' };
    assert.equal(s.call('syllabus.saveSection', { syllabusId: id1, section, data }, s.t.dean).ok, true);
  }
  const spring = s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1).data;
  assert.deepEqual([spring.submitted, spring.halves], [true, [2]]);
});

test('a started spring with an error: nothing is sent or approved, the error names the half', () => {
  const { s, half, start } = ready();
  const id1 = start();
  const before = () => JSON.stringify([s.store.list('syllabi'), s.store.list('pairs')]);
  s.store.update('syllabi', half(2, 'draft').id, { credits: null });
  const snap = before();
  const sent = s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1).data;
  assert.equal(sent.submitted, false);
  assert.deepEqual(sent.checks.errors.map((e) => [e.field, e.semester]), [['credits', 2]]);
  assert.equal(before(), snap);
  const done = s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean).data;
  assert.deepEqual([done.approved, done.changedPairs, done.checks.errors.map((e) => e.semester)], [false, 0, [2]]);
  assert.equal(before(), snap);
  const dry = s.call('syllabus.submit', { syllabusId: id1, dryRun: true }, s.t.t1).data;
  assert.deepEqual([dry.submitted, before() === snap], [false, true]);
});

test('apply leaves the versions drafts; publish approves them with one call; one half stays as before', () => {
  const s = setup();
  const done = s.call('syllabus.apply', { subjectId: s.sb1, sheets: s.FILE_AB }, s.t.dean).data;
  assert.deepEqual(done.drafts.map((d) => d.semester), [1, 2]);
  assert.deepEqual(s.store.list('syllabi').map((x) => [x.semester, x.status, x.version]), [[1, 'draft', 1], [2, 'draft', 1]]);
  s.publish(s.sb1, s.FILE_AB);
  assert.deepEqual(s.store.list('syllabi').filter((x) => x.status === 'approved').map((x) => x.semester), [1, 2]);
  const single = setup();
  single.publish(single.sb1, single.FILE_A);
  const id = single.call('syllabus.startDraft', { subjectId: single.sb1, semester: 1 }, single.t.t1).data.syllabusId;
  assert.equal(single.store.list('syllabi').filter((x) => x.status === 'draft').length, 1);
  assert.deepEqual([single.call('syllabus.submit', { syllabusId: id }, single.t.t1).data.halves, single.call('syllabus.approve', { syllabusId: id }, single.t.dean).data.halves], [[1], [1]]);
});

test('after the move: spring under review, autumn a draft — approving the spring leaves the autumn; one joint send aligns the numbers; returning takes both', () => {
  const { s, mine, half, start } = ready();
  const id1 = start();
  const auto = half(1, 'draft');
  const spring = half(2, 'draft');
  s.store.update('syllabi', auto.id, { version: 4 });
  s.store.update('syllabi', spring.id, { version: 2, status: 'review', submittedBy: s.ids.t1, submittedAt: '2026-08-31' });
  const done = s.call('syllabus.approve', { syllabusId: spring.id }, s.t.dean).data;
  assert.deepEqual([done.approved, done.halves, half(1, 'draft').version, half(2, 'approved').version], [true, [2], 4, 2]);
  // both open again: the autumn draft 4 and a new spring draft; one joint send gives one number: 1 + the greatest of the line
  const again = start(2);
  assert.equal(again, half(2, 'draft').id);
  const nums = () => mine().filter((x) => ['draft', 'review'].includes(x.status)).map((x) => [x.semester, x.version]);
  assert.deepEqual(nums(), [[1, 4], [2, 4]]);   // the new spring takes the number of the open autumn: it is greater than every number of the spring
  s.store.update('syllabi', half(2, 'draft').id, { version: 3 });
  const sent = s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1).data;
  assert.deepEqual([sent.submitted, sent.halves, mine().filter((x) => x.status === 'review').map((x) => x.version)], [true, [1, 2], [5, 5]]);
  const back = s.call('syllabus.return', { syllabusId: id1, remark: 'Нужна правка' }, s.t.dean).data;
  assert.deepEqual([back.returned, back.halves], [true, [1, 2]]);
  assert.deepEqual(mine().filter((x) => x.status === 'returned').map((x) => [x.semester, x.remark, x.decidedBy]), [[1, 'Нужна правка', s.ids.dean], [2, 'Нужна правка', s.ids.dean]]);
  assert.deepEqual(s.oneMain(), []);
});

test('a new version of one half is refused while the other is under review', () => {
  const { s, half } = ready();
  const first = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  s.call('syllabus.approve', { syllabusId: first }, s.t.dean);
  s.store.update('syllabi', half(1, 'approved').id, { status: 'review' });     // autumn: a version on approval, spring: approved only
  s.store.update('syllabi', half(2, 'approved').id, { status: 'archived' });
  const spring = s.store.insert('syllabi', { ...half(1, 'review'), id: undefined, semester: 2, status: 'approved', version: 1 });
  assert.equal(spring.status, 'approved');
  const before = s.snapshot();
  assert.equal(code(s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 2 }, s.t.t1)), 'syllabus_locked');
  assert.equal(code(s.call('syllabus.startDraft', { disciplineId: s.ds1, semester: 2 }, s.t.dean)), 'syllabus_locked');
  assert.deepEqual(s.snapshot(), before);
});

test('approving moves only the pairs of the current half; held pairs keep their topics', () => {
  const { s, half, start } = ready();
  const held = s.hold(s.sb1, '2026-09-01');
  const name = (id) => (s.store.list('topics').find((t) => t.id === id) || {}).name;
  const before = [name(held.topicId), held.lessonType, held.part];
  const chemistry = JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === s.sb4));      // another discipline
  const id1 = start();
  const done = s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean).data;
  assert.equal(done.approved, true);
  assert.equal(JSON.stringify(s.store.list('pairs').filter((p) => p.subjectId === s.sb4)), chemistry);
  const after = s.store.list('pairs').find((p) => p.id === held.id);
  assert.deepEqual([name(after.topicId), after.lessonType, after.part, after.status], [...before, 'closed']);
  assert.equal(after.topicId !== held.topicId, true);          // on the copy of the same topic
  assert.equal(half(1, 'approved').version, 2);
  assert.deepEqual(s.topicsOf(s.sb1).filter((x) => x !== '').slice(0, 2), ['АО1', 'АО2']);
});

test('held_missing in the spring half stops the approval of both; no pair moves', () => {
  const { s, half, start } = ready();
  const id1 = start();
  const old = s.store.list('topics').find((t) => t.syllabusId === half(2, 'approved').id && t.name === 'АВ1');
  const pair = s.store.list('pairs').find((p) => p.subjectId === s.sb1 && p.date === '2026-09-01');
  s.store.update('pairs', pair.id, { status: 'closed', topicId: old.id, lessonType: 'lecture', part: 1 });
  const copy = s.store.list('topics').find((t) => t.syllabusId === half(2, 'draft').id && t.sourceId === old.id);
  s.store.remove('topics', copy.id);
  const before = s.snapshot();
  const done = s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean).data;
  assert.deepEqual([done.approved, done.changedPairs, done.checks.errors.map((e) => [e.code, e.semester])], [false, 0, [['held_missing', 2]]]);
  assert.deepEqual(s.snapshot(), before);
});

test('a file for both halves when one is under review is refused as a whole', () => {
  const { s, half, start } = ready();
  start();
  s.store.update('syllabi', half(2, 'draft').id, { status: 'review' });
  const before = s.snapshot();
  for (const action of ['syllabus.apply', 'syllabus.preview']) {
    const refused = s.call(action, { subjectId: s.sb1, sheets: s.FILE_AB }, s.t.t1).data;
    assert.deepEqual([refused.ok, refused.applied, refused.errors.map((e) => e.code)], [false, false, ['in_review', 'in_review']]);
  }
  assert.deepEqual(s.snapshot(), before);
});

test('a file by the discipline: the same rights as a new draft', () => {
  const s = setup();
  const before = s.snapshot();
  for (const key of ['t4', 't5', 'prorector', 's1']) assert.equal(code(s.call('syllabus.apply', { disciplineId: s.ds1, sheets: s.FILE_AB }, s.t[key])), 'forbidden', key);
  assert.deepEqual(s.snapshot(), before);
  const done = s.call('syllabus.apply', { disciplineId: s.ds2, sheets: s.FILE_AB }, s.t.dean).data;
  assert.deepEqual([done.applied, done.drafts.map((d) => d.semester)], [true, [1, 2]]);
  assert.deepEqual([s.main(s.ds2).responsibleId, s.store.list('syllabi').filter((x) => x.disciplineId === s.ds2).map((x) => x.version)], ['', [1, 1]]);
  assert.equal(code(s.call('syllabus.apply', { disciplineId: s.ds2, subjectId: s.sb4, sheets: s.FILE_AB }, s.t.dean)), 'bad_request');
  assert.equal(code(s.call('syllabus.apply', { sheets: s.FILE_AB }, s.t.dean)), 'bad_request');
});

test('a file for a half that waits for the choice: the file error choose_first; the half with a syllabus of its own goes on', () => {
  const s = setup();
  const own = (semester, teacherId) => s.store.insert('syllabusLines', { disciplineId: s.ds2, kind: 'own', semester, teacherId, responsibleId: '', dueDate: '', reviewDue: '', createdBy: '', createdAt: '' });
  own(1, s.ids.t4); own(1, s.ids.t5); own(2, s.ids.t4);              // the autumn waits for the choice, the spring has one syllabus of its own
  const before = s.snapshot();
  for (const action of ['syllabus.preview', 'syllabus.apply']) {
    const result = s.call(action, { disciplineId: s.ds2, sheets: s.FILE_AB }, s.t.dean).data;
    assert.deepEqual([result.ok, result.applied, result.errors.filter((e) => e.code === 'choose_first')], [false, false, [{ sheet: 'info', row: 0, field: 'semester', code: 'choose_first', semester: 1 }]]);
  }
  assert.deepEqual(s.snapshot(), before);
  // the file for the spring alone goes into the syllabus of its own
  const spring = s.call('syllabus.apply', { disciplineId: s.ds2, sheets: SPRING }, s.t.dean).data;
  assert.deepEqual([spring.applied, spring.drafts.map((d) => d.semester)], [true, [2]]);
});

test('startDraft by the discipline: the deanery makes a main without a responsible and an empty draft', () => {
  const s = setup();
  const done = s.call('syllabus.startDraft', { disciplineId: s.ds2, semester: 1 }, s.t.dean).data;
  const main = s.main(s.ds2);
  const rows = s.store.list('syllabi').filter((x) => x.lineId === main.id);
  assert.deepEqual([done.created, main.responsibleId, rows.length, rows[0].status, rows[0].id === done.syllabusId, rows[0].teacherId], [true, '', 1, 'draft', true, s.ids.t4]);
  assert.deepEqual([rows[0].course, rows[0].planSemester], [1, 1]);
  assert.deepEqual(s.call('syllabus.startDraft', { disciplineId: s.ds2, semester: 1 }, s.t.dean).data, { syllabusId: done.syllabusId, created: false });
  assert.deepEqual(s.oneMain(), []);
});

test('startDraft by the discipline: who may, and garbage in the parameters', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_AB);
  const before = s.snapshot();
  const start = (data, key = 'dean') => s.call('syllabus.startDraft', data, s.t[key]);
  assert.equal(code(start({ disciplineId: s.ds2, semester: 1 }, 't1')), 'forbidden');       // a teacher of another discipline
  assert.equal(code(start({ disciplineId: s.ds1, semester: 1 }, 't2')), 'forbidden');       // leads, but is not the responsible
  assert.equal(code(start({ disciplineId: s.ds1, semester: 1 }, 's1')), 'forbidden');
  assert.equal(code(start({ disciplineId: s.ds1, semester: 1 }, 'prorector')), 'forbidden');
  assert.equal(code(s.call('syllabus.startDraft', { disciplineId: s.ds1, semester: 1 })), 'unauthorized');
  assert.equal(code(start({ disciplineId: s.ds1, subjectId: s.sb1, semester: 1 })), 'bad_request');
  assert.equal(code(start({ semester: 1 })), 'bad_request');
  assert.equal(code(start({ disciplineId: s.ds1 })), 'bad_request');
  assert.equal(code(start({ disciplineId: s.ds1, semester: 3 })), 'bad_request');
  for (const junk of [[s.ds1], 5, { id: s.ds1 }, null, true]) assert.equal(code(start({ disciplineId: junk, semester: 1 })), 'bad_request', JSON.stringify(junk));
  for (const junk of ['  ', '__proto__', 'нет такой', '']) {
    const answer = start({ disciplineId: junk, semester: 1 });
    assert.equal(answer.ok, false, junk);
    assert.notEqual(answer.error.code, 'internal', junk);
  }
  assert.deepEqual(s.snapshot(), before);
  assert.equal(code(start({ disciplineId: s.ds1, semester: 1 }, 't1')), 'ok');           // the responsible
});

test('syllabus.get by the discipline: the deanery, the administrator, the prorector, a teacher of the discipline', () => {
  const s = setup();
  s.publish(s.sb1, s.FILE_AB);
  const open = s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1).data.syllabusId;
  const before = s.snapshot();
  const get = (key, extra = {}) => s.call('syllabus.get', { disciplineId: s.ds1, ...extra }, s.t[key]);
  const page = get('dean').data;
  assert.deepEqual(page.subject, { id: '', name: 'Анатомия', disciplineId: s.ds1, groupId: '', groupName: '', course: null, teacherId: '', teacherName: '' });
  assert.deepEqual(page.groups.map((g) => g.groupName), ['01-1', '02-1', '03-1']);
  assert.equal(page.groups.every((g) => g.teacherName !== undefined), true);
  assert.deepEqual([page.syllabus.rows.length > 0, page.syllabus.rows.every((r) => r.pairs.length === 0), page.syllabus.schedule, page.semesters.map((x) => x.semester)], [true, true, null, [1, 2]]);
  assert.deepEqual([page.line.kind, page.line.mine, page.can.edit, page.can.fill], ['main', null, true, false]);
  assert.deepEqual([get('admin').ok, get('prorector').ok, get('t1').ok, get('t2').ok], [true, true, true, true]);
  for (const key of ['t4', 't5', 's1', 's2']) assert.equal(code(get(key)), 'forbidden', key);
  assert.equal(code(s.call('syllabus.get', { disciplineId: s.ds1 })), 'unauthorized');
  assert.deepEqual(get('t2').data.groups.map((g) => g.groupName), ['02-1']);
  // an open draft: the deanery and the responsible read it, the prorector does not (as by the subject), the leader does only for reading
  assert.equal(get('dean', { version: 'open' }).data.syllabus.id, open);
  assert.equal(get('t1', { version: 'open' }).data.syllabus.id, open);
  assert.equal(code(get('prorector', { version: 'open' })), 'forbidden');
  assert.equal(get('t2', { version: 'open' }).data.syllabus.id, open);
  // garbage; both or neither of the parameters
  for (const junk of [[s.ds1], 5, { id: 1 }, null]) assert.equal(code(s.call('syllabus.get', { disciplineId: junk }, s.t.dean)), 'bad_request');
  assert.equal(code(s.call('syllabus.get', { disciplineId: s.ds1, subjectId: s.sb1 }, s.t.dean)), 'bad_request');
  assert.equal(code(s.call('syllabus.get', {}, s.t.dean)), 'bad_request');
  assert.equal(code(s.call('syllabus.get', { disciplineId: 'нет' }, s.t.dean)), 'not_found');
  assert.notEqual(code(s.call('syllabus.get', { disciplineId: '__proto__' }, s.t.dean)), 'internal');
  assert.notEqual(code(s.call('syllabus.get', { disciplineId: '  ' }, s.t.dean)), 'internal');
  // a student never gets a word, whatever he asks; a read writes nothing
  assert.equal(JSON.stringify(s.call('syllabus.get', { disciplineId: s.ds1, semester: 1, version: 'open' }, s.t.s1)).includes('Анатомия'), false);
  assert.deepEqual(s.snapshot(), before);
});

test('syllabus.get by the discipline: a half that waits for the choice has no line, nothing may be done', () => {
  const s = setup();
  for (const teacherId of [s.ids.t4, s.ids.t5]) s.store.insert('syllabusLines', { disciplineId: s.ds2, kind: 'own', semester: 1, teacherId, responsibleId: '', dueDate: '', reviewDue: '', createdBy: '', createdAt: '' });
  const page = s.call('syllabus.get', { disciplineId: s.ds2, semester: 1 }, s.t.dean).data;
  assert.deepEqual([page.line, page.can, page.syllabus], [undefined, { fill: false, edit: false, submit: false, approve: false, giveBack: false }, null]);
});

test('syllabus.form shows the halves of the open version, or the approved ones', () => {
  const { s, mine, start } = ready();
  const approved = mine().find((x) => x.status === 'approved' && x.semester === 1);
  assert.deepEqual(s.call('syllabus.form', { syllabusId: approved.id }, s.t.dean).data.halves.map((h) => [h.semester, h.status]), [[1, 'approved'], [2, 'approved']]);
  const id1 = start();
  const halves = s.call('syllabus.form', { syllabusId: id1 }, s.t.t1).data.halves;
  assert.deepEqual(halves, mine().filter((x) => x.status === 'draft').map((x) => ({ semester: x.semester, syllabusId: x.id, status: 'draft' })));
});

test('a student: while the new version of a half is under review the half is «updating», the other half does not stand in', () => {
  const { s, start } = ready();
  const page = (extra = {}) => s.call('syllabus.get', { subjectId: s.sb2, ...extra }, s.t.s2).data;
  assert.deepEqual([page().hidden, page().syllabus !== null], [false, true]);
  const id1 = start();
  s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1);
  assert.deepEqual([page().hidden, page().syllabus, page({ semester: 2 }).hidden, page({ semester: 2 }).syllabus, page().semesters.map((x) => x.semester)], [true, null, true, null, [1, 2]]);
  const subjects = s.call('student.subjects', {}, s.t.s2).data.subjects;
  assert.deepEqual([subjects[0].hasSyllabus, subjects[0].updating], [false, true]);
  assert.equal(/ЧЕРНОВИК|submittedBy/.test(JSON.stringify(page())), false);
});

test('speed: every sheet is read once, written in one batch', () => {
  const { s, start } = ready();
  const check = (label, run) => {
    s.spy.reset();
    const answer = run();
    assert.equal(answer.ok, true, label + ' ' + JSON.stringify(answer));
    for (const [name, n] of [...Object.entries(s.spy.lists), ...Object.entries(s.spy.writes)]) assert.equal(n <= 1, true, `${label}: ${name} ${n}`);
    return answer;
  };
  const id1 = check('startDraft', () => s.call('syllabus.startDraft', { subjectId: s.sb1, semester: 1 }, s.t.t1)).data.syllabusId;
  check('startDraft by discipline', () => s.call('syllabus.startDraft', { disciplineId: s.ds1, semester: 2 }, s.t.dean));
  check('submit', () => s.call('syllabus.submit', { syllabusId: id1 }, s.t.t1));
  check('return', () => s.call('syllabus.return', { syllabusId: id1, remark: 'x' }, s.t.dean));
  check('approve', () => s.call('syllabus.approve', { syllabusId: id1 }, s.t.dean));
  check('apply', () => s.call('syllabus.apply', { subjectId: s.sb1, sheets: s.FILE_AB }, s.t.dean));
  check('apply by discipline', () => s.call('syllabus.apply', { disciplineId: s.ds1, sheets: s.FILE_AB }, s.t.dean));
  assert.equal(start().length > 0, true);
});

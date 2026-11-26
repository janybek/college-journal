// The read side of the syllabus: the page of a subject, the deanery's overview, the subjects of a student.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, A, file, T, M } from './syllabusSetup.js';

// A stand with the syllabus A loaded for «Информатика» of teacher1 (both groups).
function ready() {
  const x = setup();
  assert.equal(x.publish(x.sb1, A).data.applied, true);
  const get = (token, data = { subjectId: x.sb1 }) => x.call('syllabus.get', data, token);
  return { ...x, get };
}

test('syllabus.get: the page of a subject', () => {
  const { publish, call, send, get, pairOf, dean, staff, ds1, g1, sb1, sb2, sb3 } = ready();
  const d = get(dean).data;
  assert.deepEqual([d.today, d.currentSemester, d.semesters, d.semester], ['2026-08-31', 1, [{ semester: 1, planSemester: 1 }], 1]);
  assert.deepEqual(d.subject, { id: sb1, name: 'Информатика', disciplineId: ds1, groupId: g1, groupName: '01-1', course: 1, teacherId: staff.teacher1, teacherName: 'teacher1' });
  assert.deepEqual(d.groups, [{ subjectId: sb1, groupName: '01-1' }, { subjectId: sb3, groupName: '02-1' }]);
  const { id: versionId, rows, totals, schedule, title, goals, selfWork, literature, software, policies, units, ...info } = d.syllabus;
  assert.equal(typeof versionId, 'string');
  assert.deepEqual(info, { planSemester: 1, audience: 'Сестринское дело', credits: 1, totalHours: 10, classHours: 6, selfHours: 4, updated: '2026-08-31', file: null });
  // a row is one lesson: its kind, the number of the kind (Л1, П1, П2), the hours
  assert.deepEqual(rows.map((r) => [r.lessonKind, r.number, r.name, r.hours]),
    [['lecture', 1, 'Введение', 2], ['practice', 1, 'Введение', 2], ['practice', 2, 'Практикум', 2], ['control', 1, '', 0]]);
  assert.deepEqual(rows.map((r) => [r.unit, r.lessonKind, r.controlForms, r.selfHours, r.description]),
    [[1, 'lecture', '', null, 'О теме Введение'], [1, 'practice', '', null, ''], [1, 'practice', '', null, 'О теме Практикум'], [1, 'control', '', null, '']]);
  assert.deepEqual(rows.map((r) => r.planned), [1, 1, 1, 0]);
  assert.deepEqual(rows.map((r) => r.pairs), [[{ date: '2026-09-01', lessonType: 'lecture', part: 1, status: 'planned' }],
    [{ date: '2026-09-08', lessonType: 'practice', part: 1, status: 'planned' }], [], []]);
  assert.deepEqual(totals, { topics: 3, units: 1, lectureHours: 2, practiceHours: 4, controlHours: 0, hours: 6, selfHours: 0, pairs: 3 });
  assert.deepEqual(schedule, { pairs: 2, unplaced: 1, withoutTopic: 0 });
  // the same syllabus of another group: its own dates
  const second = get(dean, { subjectId: sb3 }).data;
  assert.deepEqual([second.subject.groupName, second.syllabus.rows.flatMap((r) => r.pairs.map((p) => p.date))], ['02-1', ['2026-09-02', '2026-09-09']]);
  // a subject without a syllabus; another semester
  assert.deepEqual([get(dean, { subjectId: sb2 }).data.syllabus, get(dean, { subjectId: sb2 }).data.semesters], [null, []]);
  assert.deepEqual([get(dean, { subjectId: sb1, semester: 2 }).data.semester, get(dean, { subjectId: sb1, semester: 2 }).data.syllabus], [2, null]);
  publish(sb1, file([T('Таблицы', 2, ''), M], [['Курс', 2], ['Семестр', 4]]));
  const other = get(dean, { subjectId: sb1, semester: 2 }).data;
  assert.deepEqual([other.semesters, other.syllabus.planSemester, other.syllabus.schedule, other.syllabus.rows[0].pairs],
    [[{ semester: 1, planSemester: 1 }, { semester: 2, planSemester: 4 }], 4, null, []]);
  // a cancelled pair is not shown among the dates of its topic
  call('schedule.cancelPair', { id: pairOf(sb1, '2026-09-01').id }, dean);
  assert.deepEqual(get(dean).data.syllabus.rows[0].pairs.map((p) => [p.date, p.lessonType]), [['2026-09-08', 'lecture']]);
  // a module without hours shows the pair its mark stands on
  publish(sb2, file([T('Кости', 2, ''), T('Мышцы', '', 2), M]));
  assert.deepEqual(get(dean, { subjectId: sb2 }).data.syllabus.rows[2].pairs.map((p) => [p.date, p.lessonType]), [['2026-09-11', 'practice']]);
  // a line break in the description reaches the page as it is
  publish(sb1, file([[1, '', 'Введение', 2, 2, '', 'Первая строка\nвторая строка'], T('Практикум', '', 2), M]));
  assert.equal(get(dean).data.syllabus.rows[0].description, 'Первая строка\nвторая строка');
});

test('syllabus.get: who sees which subject', () => {
  const { call, get, pairOf, dean, prorector, teacher1, teacher2, s1, s2, staff, sb1, sb2, sb3 } = ready();
  for (const token of [dean, prorector, teacher1, s1]) assert.equal(get(token).ok, true);
  assert.deepEqual([get(prorector).data.can.edit, get(teacher1).data.can.edit, get(s1).data.can.edit], [false, true, false]);
  assert.deepEqual([get(teacher1).data.groups.length, get(s1).data.groups], [2, [{ subjectId: sb1, groupName: '01-1' }]]);
  for (const token of [teacher2, s2]) assert.deepEqual(get(token).error, { code: 'forbidden' });
  assert.equal(get(s2, { subjectId: sb3 }).ok, true);
  // teacher2 replaces on one pair of sb1: the syllabus opens, but only of that group
  call('schedule.changePair', { id: pairOf(sb1, '2026-09-08').id, teacherId: staff.teacher2 }, dean);
  assert.deepEqual(get(teacher2).data.groups, [{ subjectId: sb1, groupName: '01-1' }]);
  assert.deepEqual(get(dean, { subjectId: 'sb_nope' }).error, { code: 'not_found' });
  for (const data of [{ subjectId: [sb1] }, { subjectId: 5 }, {}, { subjectId: sb1, semester: 3 }, { subjectId: sb1, semester: '1' }]) {
    assert.deepEqual(get(s1, data).error, { code: 'bad_request' });
  }
  assert.deepEqual(get(s1, { subjectId: ` ${sb2} ` }).error, { code: 'not_found' });
  for (const token of [s1, teacher2, dean]) assert.deepEqual(get(token, { subjectId: [sb2] }).error, { code: 'bad_request' });
  assert.deepEqual(get(teacher1, { subjectId: sb2 }).error, { code: 'forbidden' });
  assert.equal(JSON.stringify(get(s1).data).includes('passwordHash'), false);
});

test('subjects.overview and student.subjects', () => {
  const { call, prorector, dean, teacher1, s1, s2, staff, ds1, ds2, g1, g2, sb1, sb2, sb3 } = ready();
  const view = call('subjects.overview', {}, prorector).data;
  assert.deepEqual([view.currentSemester, view.reviewCount], [1, 0]);
  assert.deepEqual(view.rows, [
    { disciplineId: ds2, disciplineName: 'Анатомия', teacherId: staff.teacher2, teacherName: 'teacher2',
      groups: [{ subjectId: sb2, groupId: g2, groupName: '02-1', scheduledPairs: 2 }], syllabusStatus: 'none', open: null, otherSemester: false, plannedHours: 0, plannedPairs: 0 },
    { disciplineId: ds1, disciplineName: 'Информатика', teacherId: staff.teacher1, teacherName: 'teacher1',
      groups: [{ subjectId: sb1, groupId: g1, groupName: '01-1', scheduledPairs: 2 }, { subjectId: sb3, groupId: g2, groupName: '02-1', scheduledPairs: 2 }],
      syllabusStatus: 'approved', open: null, otherSemester: false, plannedHours: 6, plannedPairs: 3 }]);
  assert.deepEqual(view.disciplines, [{ id: ds2, name: 'Анатомия' }, { id: ds1, name: 'Информатика' }]);
  assert.deepEqual(view.groups, [{ id: g1, name: '01-1' }, { id: g2, name: '02-1' }]);
  assert.deepEqual(view.teachers, [{ id: staff.dean, fullName: 'dean' }, { id: staff.teacher1, fullName: 'teacher1' }, { id: staff.teacher2, fullName: 'teacher2' }]);
  // one discipline, two teachers: two rows; both follow the one syllabus of the discipline
  call('dir.save', { table: 'subjects', row: { id: sb3, teacherId: staff.teacher2 } }, dean);
  assert.deepEqual(call('subjects.overview', {}, dean).data.rows.map((r) => [r.disciplineName, r.teacherName, r.groups.map((g) => g.groupName), r.syllabusStatus]),
    [['Анатомия', 'teacher2', ['02-1'], 'none'], ['Информатика', 'teacher1', ['01-1'], 'approved'], ['Информатика', 'teacher2', ['02-1'], 'approved']]);
  for (const token of [teacher1, s1]) assert.deepEqual(call('subjects.overview', {}, token).error, { code: 'forbidden' });
  assert.deepEqual(call('student.subjects', {}, s1).data, { subjects: [{ id: sb1, name: 'Информатика', teacherName: 'teacher1', hasSyllabus: true, updating: false }] });
  assert.deepEqual(call('student.subjects', {}, s2).data, { subjects: [{ id: sb2, name: 'Анатомия', teacherName: 'teacher2', hasSyllabus: false, updating: false },
    { id: sb3, name: 'Информатика', teacherName: 'teacher2', hasSyllabus: true, updating: false }] });
  assert.deepEqual(call('student.subjects', {}, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('topics.plan', { subjectId: sb1 }, dean).error, { code: 'bad_request' });       // the action is gone
});

test('a syllabus of another semester only counts as otherSemester in the overview', () => {
  const { publish, call, send, dean, sb1 } = ready();
  publish(sb1, file([T('Таблицы', 2, ''), M], [['Курс', 2], ['Семестр', 4]]));
  call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: [], bells: ['08:00'], semester: 2 } }, dean);
  const row = call('subjects.overview', {}, dean).data.rows.find((r) => r.disciplineName === 'Информатика');
  assert.deepEqual([row.syllabusStatus, row.otherSemester, row.plannedPairs], ['approved', true, 1]);
});

test('reading: every sheet once, nothing written', () => {
  const { call, lists, calls, writes, reset, sb1, dean, teacher1, s1 } = ready();
  const overview = { subjects: 1, groups: 1, staff: 1, syllabi: 1, syllabusLines: 1, topics: 1, pairs: 1, settings: 1, disciplines: 1 };
  const page = { subjects: 1, groups: 1, staff: 1, syllabi: 1, syllabusLines: 1, pairs: 1, settings: 1, topics: 1, units: 1, outcomes: 1, selfWork: 1, literature: 1, software: 1, grading: 1, rules: 1 };
  for (const [action, data, token, expected] of [['syllabus.get', { subjectId: sb1 }, s1, page], ['syllabus.get', { subjectId: sb1 }, teacher1, page],
    ['syllabus.get', { subjectId: sb1, version: 'open' }, dean, page], ['subjects.overview', {}, dean, overview],
    ['student.subjects', {}, s1, { subjects: 1, staff: 1, syllabi: 1, syllabusLines: 1 }]]) {
    reset();
    assert.equal(call(action, data, token).ok, true);
    assert.deepEqual(lists, expected, action);
    assert.deepEqual([calls.get, Object.keys(writes).length, (calls.update || 0) + (calls.insert || 0) + (calls.remove || 0)], [1, 0, 0], action);
  }
});

test('two modules without hours on one pair: the pair view and the page carry both marks as a list', () => {
  const { publish, call, send, get, dean, g1, sb1 } = ready();
  const two = [T('Введение', 2, ''), [1, '', 'Модуль А', '', '', 'модуль', ''], [1, '', 'Модуль Б', '', '', 'модуль', '']];
  assert.equal(publish(sb1, file(two)).data.applied, true);
  const views = () => call('schedule.list', { from: '2026-09-01', to: '2026-09-11', groupId: g1 }, dean).data.pairs;
  assert.deepEqual(views().filter((p) => p.topic).map((p) => p.topic.controls), [[{ name: 'Модуль А', unit: 1 }, { name: 'Модуль Б', unit: 1 }]]);
  assert.equal('control' in views().find((p) => p.topic).topic, false);
  const rows = get(dean).data.syllabus.rows;
  assert.deepEqual(rows.map((r) => r.pairs.map((p) => p.date)), [['2026-09-01'], ['2026-09-01'], ['2026-09-01']]);
  // a pair with no mark has an empty list
  publish(sb1, file([T('Введение', 2, 2)]));
  assert.deepEqual(views().filter((p) => p.topic).map((p) => p.topic.controls), [[], []]);
});

test('only an approved version of another half of the year counts as otherSemester: a draft does not', () => {
  const { publish, call, dean, teacher1, sb1 } = ready();
  const overview = () => call('subjects.overview', {}, dean).data.rows.find((r) => r.disciplineName === 'Информатика');
  publish(sb1, file([T('Осень', 2, ''), M]));
  assert.equal(overview().otherSemester, false);
  const draft = call('syllabus.startDraft', { subjectId: sb1, semester: 2 }, teacher1).data.syllabusId;       // a draft of the spring half
  assert.deepEqual([draft !== undefined, overview().otherSemester], [true, false]);
  publish(sb1, file([T('Весна', 2, ''), M], [['Семестр', 2]]));
  assert.equal(overview().otherSemester, true);
});

// ---- the page with every section and version (task 40) ----

test('syllabus.get: every section of the approved version', () => {
  const { get, dean } = ready();
  const d = get(dean).data;
  assert.deepEqual([d.shown, d.hidden, d.state.approved, d.state.open], ['approved', false, { version: 1, decidedAt: '2026-08-31' }, null]);
  for (const key of ['title', 'goals', 'selfWork', 'literature', 'software', 'policies', 'units']) assert.equal(key in d.syllabus, true, key);
  assert.deepEqual([d.syllabus.title.department, d.syllabus.goals.goal, d.syllabus.units.units.map((u) => u.unit)], ['Кафедра информатики', 'Цель курса', [1]]);
  assert.equal(JSON.stringify(d).includes('passwordHash'), false);
});

test('who sees which version: a student never sees an open version or a remark; under review the syllabus is hidden from students', () => {   // Review Focus 23
  const { call, get, draft, lessons, pairOf, dean, prorector, teacher1, teacher2, s1, staff, sb1 } = ready();
  const page = (token, data = {}) => get(token, { subjectId: sb1, ...data });
  // no open version yet: the student and the prorector get the same refusal as for a draft; the deanery and the teacher of the subject get syllabus null
  assert.deepEqual([page(s1, { version: 'open' }).error, page(prorector, { version: 'open' }).error, page(dean, { version: 'open' }).data.syllabus,
    page(teacher1, { version: 'open' }).data.syllabus], [{ code: 'forbidden' }, { code: 'forbidden' }, null, null]);
  const open = draft(sb1, 1, teacher1);                                                      // a copy of the approved one
  // a draft: the student sees the approved version and knows nothing of the open one
  assert.deepEqual([page(s1).data.shown, page(s1).data.state.open, page(s1).data.hidden, page(s1, { version: 'open' }).error], ['approved', null, false, { code: 'forbidden' }]);
  assert.deepEqual([page(teacher1).data.state.open.status, page(teacher1, { version: 'open' }).data.shown, page(dean, { version: 'open' }).data.syllabus.rows.length > 0], ['draft', 'open', true]);
  assert.deepEqual([page(prorector).data.state.open, page(prorector, { version: 'open' }).error], [null, { code: 'forbidden' }]);
  assert.deepEqual(page(teacher1, { version: 'open' }).data.syllabus.schedule, null);
  assert.deepEqual(page(teacher1, { version: 'open' }).data.syllabus.rows.map((r) => r.pairs), [[], [], [], []]);
  const listed = () => { const x = call('student.subjects', {}, s1).data.subjects.find((r) => r.id === sb1); return [x.hasSyllabus, x.updating]; };
  assert.deepEqual(listed(), [true, false]);
  // under review: the student sees no syllabus at all; on the list of subjects it is «updating» and leads to its page; the lessons on the pairs stay
  call('syllabus.submit', { syllabusId: open }, teacher1);
  assert.deepEqual([page(s1).data.syllabus, page(s1).data.hidden, listed()], [null, true, [false, true]]);
  assert.deepEqual(lessons(sb1).map((x) => x[1]), ['Введение', 'Введение']);
  assert.deepEqual([page(teacher1).data.hidden, page(prorector, { version: 'open' }).data.shown], [false, 'open']);
  // returned: the student sees the approved version again; the remark is in no field of his answer nor of the replacing teacher's
  call('syllabus.return', { syllabusId: open, remark: 'ТАЙНОЕ-ЗАМЕЧАНИЕ' }, dean);
  call('schedule.changePair', { id: pairOf(sb1, '2026-09-08').id, teacherId: staff.teacher2 }, dean);
  for (const token of [s1, teacher2]) assert.equal(JSON.stringify(page(token)).includes('ТАЙНОЕ-ЗАМЕЧАНИЕ'), false);
  assert.deepEqual([page(s1).data.hidden, page(s1).data.shown, page(teacher2, { version: 'open' }).error, listed()], [false, 'approved', { code: 'forbidden' }, [true, false]]);
  for (const token of [teacher1, dean, prorector]) assert.equal(page(token).data.state.open.remark, 'ТАЙНОЕ-ЗАМЕЧАНИЕ');
  assert.equal(page(teacher1).data.state.open.status, 'returned');
  for (const version of [['open'], 'draft', 'archived', ' open', 5, null]) assert.deepEqual(page(dean, { version }).error, { code: 'bad_request' });
});

test('a draft and its remark never reach a student, whatever the status', () => {
  const { call, get, draft, save, dean, teacher1, s1, sb1 } = ready();
  const open = draft(sb1, 1, teacher1);
  const title = get(dean, { subjectId: sb1, version: 'open' }).data.syllabus.title;
  save(open, 'title', { ...title, department: 'ЧЕРНОВИК-КАФЕДРА' }, teacher1);
  const seen = () => JSON.stringify([get(s1), call('student.subjects', {}, s1)]);
  for (const status of ['draft', 'review', 'returned']) {
    if (status === 'review') call('syllabus.submit', { syllabusId: open }, teacher1);
    if (status === 'returned') call('syllabus.return', { syllabusId: open, remark: 'СЕКРЕТ' }, dean);
    assert.equal(seen().includes('ЧЕРНОВИК-КАФЕДРА') || seen().includes('СЕКРЕТ'), false, status);
  }
});

test('a half under review is hidden from the student: «updating», and the other half does not stand in for it', () => {          // Review Focus 32
  const { store, call, draft, fill, dean, teacher1, s1, sb1 } = ready();
  const spring = draft(sb1, 2, teacher1);
  fill(spring, teacher1);
  call('syllabus.submit', { syllabusId: spring }, teacher1);                // a send takes every started half: the autumn copy goes too
  const page = (data = {}) => call('syllabus.get', { subjectId: sb1, ...data }, s1).data;
  const subject = () => call('student.subjects', {}, s1).data.subjects.find((x) => x.id === sb1);
  assert.deepEqual([page().hidden, page().syllabus, page({ semester: 2 }).syllabus, page({ semester: 2 }).hidden, subject().hasSyllabus, subject().updating], [true, null, null, false, false, true]);
  // both halves approved, then both under review again: «updating» in both, the hidden halves stay in `semesters`
  call('syllabus.approve', { syllabusId: spring }, dean);
  const autumn = draft(sb1, 1, teacher1);
  call('syllabus.submit', { syllabusId: autumn }, teacher1);
  assert.deepEqual([page().hidden, page().syllabus, page().semesters.map((x) => x.semester)], [true, null, [1, 2]]);
  assert.deepEqual([page({ semester: 2 }).hidden, page({ semester: 2 }).syllabus], [true, null]);
  // only the autumn under review (a base moved from the old build): the spring stays readable
  const onSpring = store.list('syllabi').find((x) => x.semester === 2 && x.status === 'review');
  store.update('syllabi', onSpring.id, { status: 'draft' });
  assert.deepEqual([page().hidden, page({ semester: 2 }).hidden, page({ semester: 2 }).syllabus !== null, page().semesters.map((x) => x.semester)], [true, false, true, [1, 2]]);
});

test('can: what each person may do from the page', () => {
  const { call, draft, dean, prorector, teacher1, teacher2, s1, s2, sb1, sb2 } = ready();
  const can = (token, subjectId = sb1) => Object.entries(call('syllabus.get', { subjectId }, token).data.can).filter(([, yes]) => yes).map(([k]) => k).join();
  assert.deepEqual([can(teacher2, sb2), can(dean, sb2), can(prorector, sb2), can(s2, sb2)], ['fill,edit', 'fill,edit', '', '']);      // no versions
  assert.deepEqual([can(teacher1), can(dean), can(s1)], ['edit', 'edit', '']);                                             // an approved one
  const open = draft(sb1, 1, teacher1);
  assert.deepEqual([can(teacher1), can(dean)], ['edit,submit', 'edit,submit,approve']);
  call('syllabus.submit', { syllabusId: open }, dean);
  assert.deepEqual([can(teacher1), can(dean)], ['', 'approve,giveBack']);
  assert.equal(call('syllabus.get', { subjectId: sb1 }, teacher1).data.can.edit, false);
});

test('statuses in the lists: the overview of the deanery and the subjects of a teacher', () => {
  const { call, draft, reset, lists, writes, calls, dean, prorector, teacher1, teacher2, sb1, sb2 } = ready();
  const row = (token = dean, name = 'Информатика') => call('subjects.overview', {}, token).data.rows.find((r) => r.disciplineName === name);
  assert.deepEqual([row().syllabusStatus, row().open, call('subjects.overview', {}, dean).data.reviewCount], ['approved', null, 0]);
  // a draft of the other half does not give the mark «a syllabus of another semester exists»
  draft(sb2, 2, teacher2);
  assert.deepEqual([row(dean, 'Анатомия').syllabusStatus, row(dean, 'Анатомия').otherSemester, row(dean, 'Анатомия').open], ['none', false, null]);
  const open = draft(sb1, 1, teacher1);
  assert.deepEqual([row().open, row(prorector).open], ['draft', null]);                         // the prorector does not see drafts
  call('syllabus.submit', { syllabusId: open }, teacher1);
  assert.deepEqual([row().syllabusStatus, row().open, row(prorector).open, call('subjects.overview', {}, dean).data.reviewCount], ['approved', 'review', 'review', 1]);
  assert.deepEqual(call('teacher.mySubjects', {}, teacher1).data.subjects.map((x) => x.syllabus), [{ approved: true, open: 'review' }, { approved: true, open: 'review' }]);
  assert.deepEqual(call('teacher.mySubjects', {}, teacher2).data.subjects.map((x) => x.syllabus), [{ approved: false, open: null }]);
  // speed: «My subjects» reads every sheet once and writes nothing
  reset();
  call('teacher.mySubjects', {}, teacher1);
  assert.deepEqual([lists, writes, calls.get], [{ groups: 1, students: 1, subjects: 1, syllabi: 1, syllabusLines: 1, settings: 1 }, {}, 1]);
});

test('the earlier answer fields of the page, the pairs and the overview are gone', () => {
  const { call, dean, sb1 } = ready();
  const gone = ['kind', 'label', 'lectureHours', 'practiceHours', 'practiceKind'];
  const page = call('syllabus.get', { subjectId: sb1 }, dean).data;
  assert.deepEqual([gone.filter((k) => k in page.syllabus.rows[0]), 'canUpload' in page], [[], false]);
  assert.deepEqual(Object.keys(page.syllabus.rows[0]).sort(), ['controlForms', 'description', 'hours', 'id', 'lessonKind', 'name', 'number', 'pairs', 'planned', 'selfHours', 'unit', 'unitTitle']);
  const pair = call('schedule.list', { from: '2026-09-01', to: '2026-09-11' }, dean).data.pairs.find((p) => p.topic);
  assert.deepEqual(Object.keys(pair.topic).sort(), ['controls', 'id', 'lessonKind', 'lessonType', 'name', 'number', 'part', 'parts', 'unit']);
  assert.equal('uploaded' in call('subjects.overview', {}, dean).data.rows[0], false);
});

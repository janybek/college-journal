// The read side of the syllabus: the page of a subject, the deanery's overview, the subjects of a student.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, A, file, T, M } from './syllabusSetup.js';

// A stand with the syllabus A loaded for «Информатика» of teacher1 (both groups).
function ready() {
  const x = setup();
  assert.equal(x.send('syllabus.apply', x.sb1, A, x.dean).data.applied, true);
  const get = (token, data = { subjectId: x.sb1 }) => x.call('syllabus.get', data, token);
  return { ...x, get };
}

test('syllabus.get: the page of a subject', () => {
  const { call, send, get, pairOf, dean, staff, ds1, g1, sb1, sb2, sb3 } = ready();
  const d = get(dean).data;
  assert.deepEqual([d.today, d.currentSemester, d.semesters, d.semester, d.canUpload], ['2026-08-31', 1, [{ semester: 1, planSemester: 1 }], 1, true]);
  assert.deepEqual(d.subject, { id: sb1, name: 'Информатика', disciplineId: ds1, groupId: g1, groupName: '01-1', course: 1, teacherId: staff.teacher1, teacherName: 'teacher1' });
  assert.deepEqual(d.groups, [{ subjectId: sb1, groupName: '01-1' }, { subjectId: sb3, groupName: '02-1' }]);
  const { rows, totals, schedule, ...info } = d.syllabus;
  assert.deepEqual(info, { planSemester: 1, audience: 'Сестринское дело', credits: 1, totalHours: 10, classHours: 6, selfHours: 4, updated: '2026-08-31' });
  assert.deepEqual(rows.map((r) => [r.kind, r.unit, r.label, r.name, r.lectureHours, r.practiceHours, r.practiceKind, r.selfHours, r.description]),
    [['topic', 1, '', 'Введение', 2, 2, '', null, 'О теме Введение'], ['topic', 1, '', 'Практикум', 0, 2, '', null, 'О теме Практикум'], ['control', 1, '', '', 0, 0, '', null, '']]);
  assert.deepEqual(rows.map((r) => r.planned), [2, 1, 0]);
  assert.deepEqual(rows.map((r) => r.pairs), [[{ date: '2026-09-01', lessonType: 'lecture', part: 1, status: 'planned' },
    { date: '2026-09-08', lessonType: 'practice', part: 1, status: 'planned' }], [], []]);
  assert.deepEqual(totals, { topics: 2, units: 1, lectureHours: 2, practiceHours: 4, controlHours: 0, hours: 6, selfHours: 0, pairs: 3 });
  assert.deepEqual(schedule, { pairs: 2, unplaced: 1, withoutTopic: 0 });
  // the same syllabus of another group: its own dates
  const second = get(dean, { subjectId: sb3 }).data;
  assert.deepEqual([second.subject.groupName, second.syllabus.rows[0].pairs.map((p) => p.date)], ['02-1', ['2026-09-02', '2026-09-09']]);
  // a subject without a syllabus; another semester
  assert.deepEqual([get(dean, { subjectId: sb2 }).data.syllabus, get(dean, { subjectId: sb2 }).data.semesters], [null, []]);
  assert.deepEqual([get(dean, { subjectId: sb1, semester: 2 }).data.semester, get(dean, { subjectId: sb1, semester: 2 }).data.syllabus], [2, null]);
  send('syllabus.apply', sb1, file([T('Таблицы', 2, ''), M], [['Семестр', 4]]), dean);
  const other = get(dean, { subjectId: sb1, semester: 2 }).data;
  assert.deepEqual([other.semesters, other.syllabus.planSemester, other.syllabus.schedule, other.syllabus.rows[0].pairs],
    [[{ semester: 1, planSemester: 1 }, { semester: 2, planSemester: 4 }], 4, null, []]);
  // a cancelled pair is not shown among the dates of its topic
  call('schedule.cancelPair', { id: pairOf(sb1, '2026-09-01').id }, dean);
  assert.deepEqual(get(dean).data.syllabus.rows[0].pairs.map((p) => [p.date, p.lessonType]), [['2026-09-08', 'lecture']]);
  // a module without hours shows the pair its mark stands on
  send('syllabus.apply', sb2, file([T('Кости', 2, ''), T('Мышцы', '', 2), M]), dean);
  assert.deepEqual(get(dean, { subjectId: sb2 }).data.syllabus.rows[2].pairs.map((p) => [p.date, p.lessonType]), [['2026-09-11', 'practice']]);
  // a line break in the description reaches the page as it is
  send('syllabus.apply', sb1, file([[1, '', 'Введение', 2, 2, '', 'Первая строка\nвторая строка'], T('Практикум', '', 2), M]), dean);
  assert.equal(get(dean).data.syllabus.rows[0].description, 'Первая строка\nвторая строка');
});

test('syllabus.get: who sees which subject', () => {
  const { call, get, pairOf, dean, prorector, teacher1, teacher2, s1, s2, staff, sb1, sb2, sb3 } = ready();
  for (const token of [dean, prorector, teacher1, s1]) assert.equal(get(token).ok, true);
  assert.deepEqual([get(prorector).data.canUpload, get(teacher1).data.canUpload, get(s1).data.canUpload], [false, false, false]);
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
  assert.equal(view.currentSemester, 1);
  assert.deepEqual(view.rows, [
    { disciplineId: ds2, disciplineName: 'Анатомия', teacherId: staff.teacher2, teacherName: 'teacher2',
      groups: [{ subjectId: sb2, groupId: g2, groupName: '02-1', scheduledPairs: 2 }], uploaded: false, otherSemester: false, plannedHours: 0, plannedPairs: 0 },
    { disciplineId: ds1, disciplineName: 'Информатика', teacherId: staff.teacher1, teacherName: 'teacher1',
      groups: [{ subjectId: sb1, groupId: g1, groupName: '01-1', scheduledPairs: 2 }, { subjectId: sb3, groupId: g2, groupName: '02-1', scheduledPairs: 2 }],
      uploaded: true, otherSemester: false, plannedHours: 6, plannedPairs: 3 }]);
  assert.deepEqual(view.disciplines, [{ id: ds2, name: 'Анатомия' }, { id: ds1, name: 'Информатика' }]);
  assert.deepEqual(view.groups, [{ id: g1, name: '01-1' }, { id: g2, name: '02-1' }]);
  assert.deepEqual(view.teachers, [{ id: staff.dean, fullName: 'dean' }, { id: staff.teacher1, fullName: 'teacher1' }, { id: staff.teacher2, fullName: 'teacher2' }]);
  // one discipline, two teachers: two rows; the second has no syllabus
  call('dir.save', { table: 'subjects', row: { id: sb3, teacherId: staff.teacher2 } }, dean);
  assert.deepEqual(call('subjects.overview', {}, dean).data.rows.map((r) => [r.disciplineName, r.teacherName, r.groups.map((g) => g.groupName), r.uploaded]),
    [['Анатомия', 'teacher2', ['02-1'], false], ['Информатика', 'teacher1', ['01-1'], true], ['Информатика', 'teacher2', ['02-1'], false]]);
  for (const token of [teacher1, s1]) assert.deepEqual(call('subjects.overview', {}, token).error, { code: 'forbidden' });
  assert.deepEqual(call('student.subjects', {}, s1).data, { subjects: [{ id: sb1, name: 'Информатика', teacherName: 'teacher1', hasSyllabus: true }] });
  assert.deepEqual(call('student.subjects', {}, s2).data, { subjects: [{ id: sb2, name: 'Анатомия', teacherName: 'teacher2', hasSyllabus: false },
    { id: sb3, name: 'Информатика', teacherName: 'teacher2', hasSyllabus: false }] });
  assert.deepEqual(call('student.subjects', {}, teacher1).error, { code: 'forbidden' });
  assert.deepEqual(call('topics.plan', { subjectId: sb1 }, dean).error, { code: 'bad_request' });       // the action is gone
});

test('a syllabus of another semester only counts as otherSemester in the overview', () => {
  const { call, send, dean, sb1 } = ready();
  send('syllabus.apply', sb1, file([T('Таблицы', 2, ''), M], [['Семестр', 4]]), dean);
  call('settings.save', { settings: { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: [], bells: ['08:00'], semester: 2 } }, dean);
  const row = call('subjects.overview', {}, dean).data.rows.find((r) => r.disciplineName === 'Информатика');
  assert.deepEqual([row.uploaded, row.otherSemester, row.plannedPairs], [true, true, 1]);
});

test('reading: every sheet once, nothing written', () => {
  const { call, lists, calls, writes, reset, sb1, dean, teacher1, s1 } = ready();
  const page = { subjects: 1, groups: 1, staff: 1, syllabi: 1, topics: 1, pairs: 1, settings: 1 };
  for (const [action, data, token, expected] of [['syllabus.get', { subjectId: sb1 }, s1, page], ['syllabus.get', { subjectId: sb1 }, teacher1, page],
    ['subjects.overview', {}, dean, { ...page, disciplines: 1 }], ['student.subjects', {}, s1, { subjects: 1, staff: 1, syllabi: 1 }]]) {
    reset();
    assert.equal(call(action, data, token).ok, true);
    assert.deepEqual(lists, expected, action);
    assert.deepEqual([calls.get, Object.keys(writes).length, (calls.update || 0) + (calls.insert || 0) + (calls.remove || 0)], [1, 0, 0], action);
  }
});

test('two modules without hours on one pair: the pair view and the page carry both marks as a list', () => {
  const { call, send, get, dean, g1, sb1 } = ready();
  const two = [T('Введение', 2, ''), [1, '', 'Модуль А', '', '', 'модуль', ''], [1, '', 'Модуль Б', '', '', 'модуль', '']];
  assert.equal(send('syllabus.apply', sb1, file(two), dean).data.applied, true);
  const views = () => call('schedule.list', { from: '2026-09-01', to: '2026-09-11', groupId: g1 }, dean).data.pairs;
  assert.deepEqual(views().filter((p) => p.topic).map((p) => p.topic.controls), [[{ name: 'Модуль А', unit: 1 }, { name: 'Модуль Б', unit: 1 }]]);
  assert.equal('control' in views().find((p) => p.topic).topic, false);
  const rows = get(dean).data.syllabus.rows;
  assert.deepEqual(rows.map((r) => r.pairs.map((p) => p.date)), [['2026-09-01'], ['2026-09-01'], ['2026-09-01']]);
  // a pair with no mark has an empty list
  send('syllabus.apply', sb1, file([T('Введение', 2, 2)]), dean);
  assert.deepEqual(views().filter((p) => p.topic).map((p) => p.topic.controls), [[], []]);
});

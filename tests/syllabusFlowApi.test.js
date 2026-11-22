import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, FIRST, A } from './syllabusSetup.js';
import { handleRequest } from '../backend/api.js';

const book = { authors: 'Автор', title: 'Книга', year: '2020', publisher: 'Издат', availability: 'библиотека' };
const warn = (section) => ({ section, code: 'empty' });
const FOUR_EMPTY = [warn('literature'), warn('software'), warn('policies'), warn('units')];
const code = (r) => r.error && r.error.code;

// A world with a filled draft of teacher1 for «Информатика» (title, goal, the lessons of the sample A) and the helpers of the file.
function ready() {
  const env = setup();
  const { store, call, save, fill, teacher1, sb1 } = env;
  let last = null;
  const draft = (subjectId, semester, token = env.dean) => {
    last = env.draft(subjectId, semester, token);
    return last;
  };
  const syllabusId = draft(sb1, 1, teacher1);
  fill(syllabusId, teacher1);
  const planOf = (id = last) => structuredClone(call('syllabus.form', { syllabusId: id }, env.dean).data.doc.plan);
  const topicsOf = (id) => store.list('topics').filter((t) => t.syllabusId === id).sort((a, b) => a.order - b.order);
  const without = (name, lessonKind) => {
    const plan = planOf();
    for (const u of plan.units) u[lessonKind] = u[lessonKind].filter((r) => r.name !== name);
    return plan;
  };
  const withLecture = (name) => {
    const plan = planOf();
    plan.units[0].lecture.push({ id: '', name, hours: 2 });
    return plan;
  };
  const withFirstLectureAndWithout = (name) => {
    const plan = planOf();
    plan.units[0].lecture.unshift({ id: '', name: 'Нулевая', hours: 2 });
    for (const u of plan.units) for (const kind of ['lecture', 'practice', 'seminar', 'lab']) u[kind] = u[kind].filter((r) => r.name !== name);
    return plan;
  };
  const pick = (id, ...fields) => fields.map((f) => store.get('syllabi', id)[f]);
  const approveFirst = () => {
    assert.equal(call('syllabus.submit', { syllabusId }, teacher1).data.submitted, true);
    assert.equal(call('syllabus.approve', { syllabusId }, env.dean).data.approved, true);
  };
  const approveSpring = () => {
    approveFirst();
    const spring = draft(sb1, 2, teacher1);
    fill(spring, teacher1);
    save(spring, 'plan', { units: [{ title: '', lecture: [{ name: 'Весенняя тема', hours: 2 }], practice: [{ name: 'Весенняя тема', hours: 2 }], control: [] }] }, teacher1);
    assert.equal(call('syllabus.submit', { syllabusId: spring }, teacher1).data.submitted, true);
    return call('syllabus.approve', { syllabusId: spring }, env.dean).data;
  };
  const nameOf = (topicId) => store.get('topics', topicId).name;
  const versionOf = (topicId) => store.get('topics', topicId).syllabusId;
  // a new empty draft of «Анатомия» of teacher2
  const empty = draft(env.sb2, 1, env.teacher2);
  return { ...env, draft, syllabusId, empty, topicsOf, without, withLecture, withFirstLectureAndWithout, pick, approveFirst, approveSpring, nameOf, versionOf };
}

test('draft → review → returned → review → approved: the lessons reach the pairs of every group only at the approval', () => {
  const { store, call, save, reset, lists, writes, calls, lessons, pick, syllabusId, teacher1, dean, sb1, sb3, staff } = ready();
  assert.deepEqual(lessons(sb1).map((x) => x[1]), ['', '']);
  assert.deepEqual(call('syllabus.submit', { syllabusId, dryRun: true }, teacher1).data, { submitted: false, checks: { errors: [], warnings: FOUR_EMPTY } });
  assert.equal(store.get('syllabi', syllabusId).status, 'draft');
  reset();
  assert.equal(call('syllabus.submit', { syllabusId }, teacher1).data.submitted, true);
  assert.deepEqual([lists, writes], [{ subjects: 1, syllabi: 1, topics: 1, units: 1, outcomes: 1, selfWork: 1, literature: 1, software: 1, grading: 1, rules: 1, pairs: 1, groups: 1 },
    { 'updateMany:syllabi': 1 }]);
  assert.deepEqual(pick(syllabusId, 'status', 'submittedBy', 'submittedAt'), ['review', staff.teacher1, '2026-08-31']);
  assert.deepEqual(lessons(sb1).map((x) => x[1]), ['', '']);
  reset();
  assert.deepEqual(call('syllabus.return', { syllabusId, remark: '  Допишите литературу  ' }, dean).data, { returned: true });
  assert.deepEqual([lists, writes, calls.get], [{ syllabi: 1, subjects: 1 }, { 'updateMany:syllabi': 1 }, 1]);
  assert.deepEqual(pick(syllabusId, 'status', 'remark', 'decidedBy'), ['returned', 'Допишите литературу', staff.dean]);
  assert.equal(save(syllabusId, 'literature', { main: [book], extra: [] }, teacher1).ok, true);
  call('syllabus.submit', { syllabusId }, teacher1);
  reset();
  const done = call('syllabus.approve', { syllabusId }, dean).data;
  assert.deepEqual([done.approved, done.checks.errors, done.changedPairs], [true, [], 4]);
  assert.deepEqual(pick(syllabusId, 'status', 'remark', 'decidedBy', 'decidedAt'), ['approved', '', staff.dean, '2026-08-31']);
  assert.deepEqual([lessons(sb1), lessons(sb3)], [[['2026-09-01', ...FIRST[0]], ['2026-09-08', ...FIRST[1]]], [['2026-09-02', ...FIRST[0]], ['2026-09-09', ...FIRST[1]]]]);
  assert.deepEqual(writes, { 'updateMany:syllabi': 1, 'updateMany:pairs': 1 });
  assert.deepEqual(lists, { subjects: 1, syllabi: 1, topics: 1, units: 1, outcomes: 1, selfWork: 1, literature: 1, software: 1, grading: 1, rules: 1, pairs: 1, settings: 1, groups: 1 });
  assert.deepEqual([calls.get, calls.update || 0, calls.insert || 0], [1, 0, 0]);
});

test('submit with gaps writes nothing and names every gap', () => {
  const { call, snapshotAll, empty, teacher2 } = ready();
  const before = snapshotAll();
  const answer = call('syllabus.submit', { syllabusId: empty }, teacher2).data;
  assert.deepEqual([answer.submitted, answer.checks.errors.map((e) => [e.section, e.field ?? e.code])],
    [false, [['title', 'department'], ['title', 'academicYear'], ['title', 'credits'], ['goals', 'goal'], ['plan', 'empty']]]);
  assert.equal(snapshotAll(), before);
});

test('who may do what: a teacher never approves; return needs a remark and a version under review', () => {
  const { store, call, draft, fill, syllabusId, teacher1, teacher2, prorector, dean, s1, sb2 } = ready();
  assert.deepEqual([code(call('syllabus.approve', { syllabusId }, teacher1)), code(call('syllabus.return', { syllabusId, remark: 'x' }, teacher1)),
    code(call('syllabus.approve', { syllabusId }, prorector)), code(call('syllabus.submit', { syllabusId }, teacher2)), code(call('syllabus.submit', { syllabusId }, s1))],
  ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden']);
  for (const id of [[syllabusId], syllabusId + ' ', 7, { id: syllabusId }]) for (const action of ['syllabus.submit', 'syllabus.approve']) assert.equal(code(call(action, { syllabusId: id }, dean)), 'bad_request', action);
  assert.deepEqual([code(call('syllabus.submit', { syllabusId, dryRun: 'true' }, teacher1)), store.get('syllabi', syllabusId).status], ['bad_request', 'draft']);
  assert.equal(code(call('syllabus.return', { syllabusId, remark: 'x' }, dean)), 'syllabus_locked');
  call('syllabus.submit', { syllabusId }, teacher1);
  // somebody else's teacher, a student and the prorector neither approve nor return a version under review
  for (const token of [teacher2, s1, prorector]) for (const action of ['syllabus.approve', 'syllabus.return']) assert.equal(code(call(action, { syllabusId, remark: 'x' }, token)), 'forbidden', action);
  assert.deepEqual([call('syllabus.return', { syllabusId, remark: '   ' }, dean).error, code(call('syllabus.return', { syllabusId, remark: ['x'] }, dean)),
    code(call('syllabus.return', { syllabusId: [syllabusId], remark: 'x' }, dean)), code(call('syllabus.submit', { syllabusId }, teacher1)),
    code(call('syllabus.submit', { syllabusId }, prorector)), code(call('syllabus.return', { syllabusId, remark: 'x'.repeat(5001) }, dean))],
  [{ code: 'invalid', fields: [{ field: 'remark', code: 'required' }] }, 'bad_request', 'bad_request', 'syllabus_locked', 'forbidden', 'invalid']);
  assert.deepEqual(call('syllabus.return', { syllabusId, remark: 'x'.repeat(5001) }, dean).error.fields, [{ field: 'remark', code: 'too_long' }]);
  assert.equal(store.get('syllabi', syllabusId).status, 'review');
  assert.equal(call('syllabus.approve', { syllabusId }, dean).data.approved, true);
  assert.equal(code(call('syllabus.approve', { syllabusId }, dean)), 'syllabus_locked');
  assert.equal(code(call('syllabus.approve', { syllabusId: 'nope' }, dean)), 'not_found');
  // the dean approves a draft without submitting
  const direct = draft(sb2, 1, dean);
  fill(direct, dean);
  assert.equal(call('syllabus.approve', { syllabusId: direct }, dean).data.approved, true);
});

test('the dean who teaches the discipline approves his own syllabus', () => {
  const { store, call, draft, fill, dean, sb1, staff } = ready();
  store.update('subjects', sb1, { teacherId: staff.dean });
  const own = draft(sb1, 1, dean);
  fill(own, dean);
  assert.equal(call('syllabus.submit', { syllabusId: own }, dean).data.submitted, true);
  assert.equal(call('syllabus.approve', { syllabusId: own }, dean).data.approved, true);
});

test('a new version and held pairs: nothing held changes, new lessons stand after the held ones', () => {
  const { store, call, save, draft, snapshotAll, lessons, pairOf, nameOf, versionOf, approveFirst, withFirstLectureAndWithout, without, topicsOf,
    teacher1, dean, sb1, sb3, ds1 } = ready();
  approveFirst();
  store.update('pairs', pairOf(sb3, '2026-09-02').id, { status: 'closed' });
  const second = draft(sb1, 1, teacher1);
  save(second, 'plan', withFirstLectureAndWithout('Практикум'), teacher1);
  assert.equal(call('syllabus.approve', { syllabusId: second }, dean).data.approved, true);
  const held = pairOf(sb3, '2026-09-02');
  assert.deepEqual([held.status, nameOf(held.topicId), held.lessonType, held.part, versionOf(held.topicId)], ['closed', 'Введение', 'lecture', 1, second]);
  assert.deepEqual(lessons(sb3), [['2026-09-02', 'Введение', 'lecture', 1], ['2026-09-09', 'Нулевая', 'lecture', 1]]);
  assert.deepEqual(lessons(sb1), [['2026-09-01', 'Нулевая', 'lecture', 1], ['2026-09-08', 'Введение', 'practice', 1]]);
  assert.deepEqual(store.list('syllabi').filter((s) => s.disciplineId === ds1 && s.status !== 'draft').map((s) => [s.version, s.status]).sort(), [[1, 'archived'], [2, 'approved']]);
  assert.equal(topicsOf(second).length > 0, true);
  const third = draft(sb1, 1, teacher1);
  save(third, 'plan', without('Введение', 'lecture'), teacher1);
  const before = snapshotAll();
  const expected = [{ section: 'plan', code: 'held_missing', name: 'Введение', date: '2026-09-02' }];
  assert.deepEqual([call('syllabus.submit', { syllabusId: third }, teacher1).data, call('syllabus.approve', { syllabusId: third }, dean).data.checks.errors],
    [{ submitted: false, checks: { errors: expected, warnings: FOUR_EMPTY } }, expected]);
  assert.equal(call('syllabus.approve', { syllabusId: third }, dean).data.approved, false);
  assert.equal(snapshotAll(), before);
});

test('a held lesson deleted and written again under the same name: submitted, approved, the held pair stands on the new row', () => {
  const { store, call, save, draft, pairOf, topicsOf, approveFirst, without, withLecture, teacher1, dean, sb1, sb3 } = ready();
  approveFirst();
  store.update('pairs', pairOf(sb3, '2026-09-02').id, { status: 'closed' });
  const next = draft(sb1, 1, teacher1);
  save(next, 'plan', without('Введение', 'lecture'), teacher1);
  save(next, 'plan', withLecture(' введение '), teacher1);
  const fresh = topicsOf(next).find((t) => t.lessonKind === 'lecture' && t.sourceId === '');
  assert.equal(fresh.name, 'введение');
  assert.deepEqual([call('syllabus.submit', { syllabusId: next }, teacher1).data.submitted, call('syllabus.approve', { syllabusId: next }, dean).data.approved], [true, true]);
  const held = pairOf(sb3, '2026-09-02');
  assert.deepEqual([held.status, held.topicId, held.lessonType, held.part], ['closed', fresh.id, 'lecture', 1]);
});

test('a running pair keeps its lesson; planned pairs of every group move to the new version', () => {
  const { store, call, save, draft, pairOf, lessons, approveFirst, withFirstLectureAndWithout, teacher1, dean, sb1, sb3 } = ready();
  approveFirst();
  store.update('pairs', pairOf(sb1, '2026-09-01').id, { status: 'running' });
  const second = draft(sb1, 1, teacher1);
  save(second, 'plan', withFirstLectureAndWithout('Практикум'), teacher1);
  assert.equal(call('syllabus.approve', { syllabusId: second }, dean).data.approved, true);
  assert.deepEqual(lessons(sb1)[0], ['2026-09-01', 'Введение', 'lecture', 1]);
  assert.equal(lessons(sb3)[0][1], 'Нулевая');
});

test('the other half of the year: approving it touches no pair; the semester switch lays it', () => {
  const { call, lessons, approveSpring, dean, sb1, S } = ready();
  assert.deepEqual([approveSpring().changedPairs, lessons(sb1).map((x) => x[1])], [0, ['Введение', 'Введение']]);
  call('settings.save', { settings: { ...S, semester: 2 } }, dean);
  assert.deepEqual(lessons(sb1).map((x) => x[1]), ['Весенняя тема', 'Весенняя тема']);
});

test('the queue: versions under review for the deanery, the administrator and the prorector', () => {
  const { call, reset, lists, writes, syllabusId, sb1, teacher1, dean, prorector, s1 } = ready();
  call('syllabus.submit', { syllabusId }, teacher1);
  reset();
  const queue = call('syllabus.queue', {}, prorector).data;
  assert.deepEqual([queue.count, queue.rows], [1, [{ syllabusId, subjectId: sb1, disciplineName: 'Информатика', teacherName: 'teacher1', semester: 1, planSemester: 1,
    version: 1, submittedAt: '2026-08-31', submittedByName: 'teacher1' }]]);
  assert.deepEqual([lists, writes], [{ syllabi: 1, subjects: 1, disciplines: 1, staff: 1, groups: 1 }, {}]);
  reset();
  assert.deepEqual([call('syllabus.queue', { countOnly: true }, dean).data, lists, call('syllabus.queue', { countOnly: 'yes' }, dean).error], [{ count: 1 }, { syllabi: 1 }, { code: 'bad_request' }]);
  assert.deepEqual([call('syllabus.queue', {}, teacher1).error, call('syllabus.queue', {}, s1).error], [{ code: 'forbidden' }, { code: 'forbidden' }]);
  call('syllabus.return', { syllabusId, remark: 'x' }, dean);
  assert.equal(call('syllabus.queue', {}, dean).data.count, 0);
});

test('approving reads the settings before the first write', () => {
  const { call, publish, order, reset, dean, sb1 } = setup();
  publish(sb1, A);
  const second = call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, dean).data.syllabusId;
  reset();
  assert.equal(call('syllabus.approve', { syllabusId: second }, dean).data.approved, true);
  const firstWrite = order.findIndex((entry) => /^(insert|update|remove)(Many)?:/.test(entry));
  assert.equal(order.indexOf('list:settings') > -1, true);
  assert.equal(order.indexOf('list:settings') < firstWrite, true, order.join(' '));
});

// A store over the one of the test whose write of `table` fails `times` times (a timeout of Google between the two writes of the approval).
function failingOn(store, table, times = 1) {
  let left = times;
  return { ...store, updateMany: (name, rows) => {
    if (name === table && left > 0) {
      left -= 1;
      throw new Error('Service Spreadsheets timed out');
    }
    return store.updateMany(name, rows);
  } };
}

test('approving writes «Пары» first: a failed write of «Силлабусы» leaves the version under review, «Утвердить» again gives the same end', () => {
  const { store, spy, platform, call, save, draft, pairOf, lessons, nameOf, versionOf, approveFirst, teacher1, dean, sb1, ds1, S } = ready();
  approveFirst();
  store.update('pairs', pairOf(sb1, '2026-09-01').id, { status: 'closed' });              // «Введение» held
  const second = draft(sb1, 1, teacher1);
  const units = call('syllabus.form', { syllabusId: second }, teacher1).data.doc.plan.units;
  units[0].lecture.unshift({ id: '', name: 'Новая в начале', hours: 2 });
  save(second, 'plan', { units }, teacher1);
  assert.equal(call('syllabus.submit', { syllabusId: second }, teacher1).data.submitted, true);
  const order = [];
  const watched = { ...spy, updateMany: (name, rows) => { order.push(name); return spy.updateMany(name, rows); } };
  const failed = handleRequest(JSON.stringify({ action: 'syllabus.approve', data: { syllabusId: second }, token: dean }), { store: failingOn(watched, 'syllabi'), platform, log: () => {} });
  assert.equal(failed.ok, false);
  assert.deepEqual(order, ['pairs']);                                                     // «Пары» were written, «Силлабусы» were not
  const statuses = () => store.list('syllabi').filter((s) => s.disciplineId === ds1 && s.semester === 1).map((s) => [s.version, s.status]).sort();
  assert.deepEqual(statuses(), [[1, 'approved'], [2, 'review']]);
  const held = pairOf(sb1, '2026-09-01');
  assert.deepEqual([nameOf(held.topicId), versionOf(held.topicId)], ['Введение', second]);
  const again = call('syllabus.approve', { syllabusId: second }, dean);
  assert.deepEqual([again.ok, again.data.approved], [true, true]);
  assert.deepEqual(statuses(), [[1, 'archived'], [2, 'approved']]);
  const after = pairOf(sb1, '2026-09-01');
  assert.deepEqual([after.status, nameOf(after.topicId), versionOf(after.topicId), after.lessonType, after.part], ['closed', 'Введение', second, 'lecture', 1]);
  const end = lessons(sb1);
  call('settings.save', { settings: S }, dean);
  assert.deepEqual(lessons(sb1), end);                                                    // the next layout moves nothing
  assert.deepEqual(end.map((l) => l[1]), ['Введение', 'Новая в начале']);
});

test('a row of an unknown kind (typed by hand in the sheet) is named and stops both sending and approving', () => {      // final M3
  const { store, call, snapshotAll, syllabusId, teacher1, dean } = ready();
  const row = store.list('topics').find((t) => t.syllabusId === syllabusId && t.name === 'Практикум');
  store.update('topics', row.id, { lessonKind: 'практика' });
  const before = snapshotAll();
  const expected = [{ section: 'plan', code: 'bad_kind', id: row.id, name: 'Практикум' }];
  assert.deepEqual([call('syllabus.submit', { syllabusId }, teacher1).data.checks.errors, call('syllabus.approve', { syllabusId }, dean).data], [expected,
    { approved: false, checks: { errors: expected, warnings: FOUR_EMPTY }, changedPairs: 0 }]);
  assert.equal(snapshotAll(), before);
});

const groupWarnings = (checks) => checks.warnings.filter((w) => w.code === 'group_course');

test('a group of another course than the title warns at the form, submitting and approving; the same course does not', () => {
  const { store, call, syllabusId, g2, teacher1, dean } = ready();
  assert.deepEqual(groupWarnings(call('syllabus.submit', { syllabusId, dryRun: true }, teacher1).data.checks), []);
  assert.deepEqual(groupWarnings(call('syllabus.form', { syllabusId }, teacher1).data.checks), []);
  // 02-1 is on the 2nd course, the title says the 1st: only that group is named
  store.update('groups', g2, { course: 2 });
  const expected = [{ section: 'title', code: 'group_course', groups: ['02-1'] }];
  assert.deepEqual(groupWarnings(call('syllabus.form', { syllabusId }, teacher1).data.checks), expected);
  assert.deepEqual(groupWarnings(call('syllabus.submit', { syllabusId, dryRun: true }, teacher1).data.checks), expected);
  const sent = call('syllabus.submit', { syllabusId }, teacher1).data;
  assert.deepEqual([sent.submitted, groupWarnings(sent.checks)], [true, expected]);
  const done = call('syllabus.approve', { syllabusId }, dean).data;
  assert.deepEqual([done.approved, groupWarnings(done.checks)], [true, expected]);
});

test('the groups of another teacher of the same discipline are not named in the warning', () => {
  const { store, call, syllabusId, ds1, teacher1, staff } = ready();
  const g3 = store.insert('groups', { name: '03-1', course: 3 }).id;
  store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g3, teacherId: staff.teacher2, scheme: 'A' });
  assert.deepEqual(groupWarnings(call('syllabus.form', { syllabusId }, teacher1).data.checks), []);
  assert.deepEqual(groupWarnings(call('syllabus.submit', { syllabusId, dryRun: true }, teacher1).data.checks), []);
});

test('a title of the 2nd course with the plan semester of the 1st is refused at submitting and approving, nothing is written', () => {
  const { store, call, snapshotAll, syllabusId, teacher1, dean } = ready();
  store.update('syllabi', syllabusId, { course: 2, planSemester: 1 });
  const before = snapshotAll();
  const expected = { section: 'title', field: 'planSemester', code: 'course_semester', course: 2 };
  assert.deepEqual(call('syllabus.form', { syllabusId }, teacher1).data.checks.errors, [expected]);
  const sent = call('syllabus.submit', { syllabusId }, teacher1).data;
  assert.deepEqual([sent.submitted, sent.checks.errors], [false, [expected]]);
  assert.equal(store.get('syllabi', syllabusId).status, 'draft');
  const direct = call('syllabus.approve', { syllabusId }, dean).data;
  assert.deepEqual([direct.approved, direct.changedPairs, direct.checks.errors], [false, 0, [expected]]);
  assert.equal(snapshotAll(), before);
});

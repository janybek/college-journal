import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, A } from './syllabusSetup.js';
import { DOC_TABLES } from '../core/syllabusDoc.js';

const code = (r) => r.error && r.error.code;
const book = (title) => ({ authors: 'Автор', title, year: '2020', publisher: 'Издат', availability: 'библиотека' });

// Every section of the form with fictional contents; some names are in Kyrgyz. `plan` has two units: the second one has no title.
const SECTIONS_VALUE = {
  title: { department: 'Кафедра информатики', faculty: 'Медицинский', academicYear: '2026–2027', course: 1, planSemester: 1, credits: 2,
    audience: 'Сестринское дело', totalHours: 60, classHours: 36, selfHours: 24, contacts: 'каб. 204\nвт 14:00–15:00', place: 'ауд. 204' },
  goals: { goal: 'Цель курса', knowledge: ['=СУММ(A1) остаётся текстом', '<script>alert(1)</script>'], skill: ['Умеет'], attitude: [], prerequisite: [], postrequisite: [] },
  plan: { units: [
    { title: 'Негиздер', lecture: [{ name: 'Жалпы анатомия', hours: 2 }], practice: [{ name: 'Практика сөөктөр', hours: 2 }], seminar: [], lab: [], control: [{ name: 'Модуль', hours: 2 }] },
    { title: '', lecture: [{ name: 'Сөөктөр жана муундар', hours: 2 }], practice: [], seminar: [], lab: [], control: [] },
  ] },
  selfWork: { items: [{ unit: 1, name: 'Реферат', tasks: 'Написать реферат', hours: 4 }] },
  literature: { main: [book('Основная книга')], extra: [book('Дополнительная книга')] },
  software: { items: [{ name: 'Moodle', link: 'https://moodle.example' }] },
  policies: { grading: [{ name: 'Экзамен', maxPoints: 100, rangeFail: '0-49', rangeFair: '50-69', rangeGood: '70-84', rangeExcellent: '85-100',
    criteriaFail: 'a', criteriaFair: 'b', criteriaGood: 'c', criteriaExcellent: 'd' }], behavior: ['Не опаздывать'], ethics: ['Не списывать'], sanctionBehavior: 'Замечание', sanctionEthics: 'Пересдача' },
  units: { units: [
    { unit: 1, description: 'О первом юните', questions: 'Вопросы', guidance: 'Указания', results: 'Результаты', literature: [book('Книга юнита')] },
    { unit: 2, description: 'О втором юните', questions: '', guidance: '', results: '', literature: [] },
  ] },
};

// a draft of teacher1 with every section saved; `order` puts the practice before the lecture in the first unit
function fullDraft(env) {
  const { call, draft, save, sb1, teacher1 } = env;
  const syllabusId = draft(sb1, 1, teacher1);
  for (const section of ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units']) {
    const r = save(syllabusId, section, SECTIONS_VALUE[section], teacher1);
    assert.equal(r.ok, true, section + ' ' + JSON.stringify(r));
  }
  const lessons = call('syllabus.form', { syllabusId }, teacher1).data.doc.lessons;
  const byName = (name) => lessons.find((l) => l.name === name).id;
  const order = [byName('Практика сөөктөр'), byName('Жалпы анатомия'), byName('Модуль'), byName('Сөөктөр жана муундар')];
  const r = save(syllabusId, 'order', { order }, teacher1);
  assert.equal(r.ok, true, JSON.stringify(r));
  return { syllabusId, savedOrder: ['Практика сөөктөр', 'Жалпы анатомия', 'Модуль', 'Сөөктөр жана муундар'], order };
}

test('startDraft: an empty draft; a second click gives the same one and writes nothing', () => {
  const { store, call, writes, lists, reset, teacher1, staff, ds1, sb1, sb3 } = setup();
  reset();
  const first = call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, teacher1).data;
  const [row] = store.list('syllabi');
  assert.deepEqual([first.created, row.id, row.status, row.version, row.disciplineId, row.teacherId, row.semester, row.planSemester, row.course, row.editedBy, row.manualOrder],
    [true, first.syllabusId, 'draft', 1, ds1, staff.teacher1, 1, 1, 1, staff.teacher1, false]);
  assert.deepEqual([lists, writes], [{ subjects: 1, groups: 1, syllabi: 1, syllabusLines: 1 }, { 'insertMany:syllabusLines': 1, 'insertMany:syllabi': 1 }]);
  reset();
  assert.deepEqual([call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, teacher1).data, writes, store.list('syllabi').length], [{ syllabusId: row.id, created: false }, {}, 1]);
  // у другой группы того же преподавателя — та же версия; у второй половины года — своя
  assert.equal(call('syllabus.startDraft', { subjectId: sb3, semester: 1 }, teacher1).data.syllabusId, row.id);
  const second = call('syllabus.startDraft', { subjectId: sb1, semester: 2 }, teacher1).data;
  assert.equal(second.created, true);
  assert.equal(store.list('syllabi').find((s) => s.id === second.syllabusId).planSemester, 2);
});

test('startDraft: a group above the 4th course gets no plan semester', () => {
  const { store, call, teacher2, sb2 } = setup();
  store.update('groups', store.get('subjects', sb2).groupId, { course: 5 });
  const { syllabusId } = call('syllabus.startDraft', { subjectId: sb2, semester: 1 }, teacher2).data;
  assert.deepEqual([store.get('syllabi', syllabusId).course, store.get('syllabi', syllabusId).planSemester], [5, null]);
});

test('startDraft: a subject without a discipline is invalid', () => {
  const { store, call, dean, sb1 } = setup();
  store.update('subjects', sb1, { disciplineId: '' });
  assert.deepEqual(call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, dean).error, { code: 'invalid', fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  assert.equal(store.list('syllabi').length, 0);
});

test('startDraft: a copy of the approved version with every section; pairs and the approved version stay as they are', () => {
  const { store, call, publish, dean, prorector, teacher1, teacher2, s1, sb1, writes, lists, reset } = setup();
  assert.equal(publish(sb1, A).data.applied, true);
  const approved = store.list('syllabi').find((s) => s.status === 'approved');
  const own = { syllabusId: approved.id };
  store.update('units', store.list('units').find((u) => u.syllabusId === approved.id && u.unit === 1).id, { title: 'Негиздер', description: 'О юните' });   // the file made the row of its unit
  store.insert('outcomes', { ...own, kind: 'knowledge', order: 1, text: 'Знает' });
  store.insert('selfWork', { ...own, order: 1, unit: 1, name: 'Реферат', tasks: '', hours: 2 });
  store.insert('literature', { ...own, kind: 'main', unit: null, order: 1, authors: '', title: 'Книга', year: '', publisher: '', availability: '' });
  store.insert('software', { ...own, order: 1, name: 'Moodle', link: '' });
  store.insert('grading', { ...own, order: 1, name: 'Экзамен', maxPoints: 100 });
  store.insert('rules', { ...own, kind: 'behavior', order: 1, text: 'Правило' });
  store.update('syllabi', approved.id, { manualOrder: true });
  const approvedRows = () => DOC_TABLES.map((t) => store.list(t).filter((r) => r.syllabusId === approved.id));
  const before = JSON.stringify([store.list('pairs'), approvedRows()]);
  reset();
  const { syllabusId } = call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, teacher1).data;
  const draft = store.list('syllabi').find((s) => s.id === syllabusId);
  assert.deepEqual([draft.status, draft.version, draft.manualOrder], ['draft', 2, true]);
  const approvedTopics = store.list('topics').filter((t) => t.syllabusId === approved.id);
  assert.equal(approvedTopics.length > 0, true);
  assert.deepEqual(store.list('topics').filter((t) => t.syllabusId === syllabusId).map((t) => [t.sourceId, t.order, t.name, t.lessonKind, t.hours]),
    approvedTopics.map((t) => [t.id, t.order, t.name, t.lessonKind, t.hours]));
  for (const table of ['units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules']) {
    assert.equal(store.list(table).filter((r) => r.syllabusId === syllabusId).length, 1, table);
  }
  assert.equal(JSON.stringify([store.list('pairs'), approvedRows()]), before);
  assert.deepEqual(writes, { 'insertMany:syllabi': 1, 'insertMany:topics': 1, 'insertMany:units': 1, 'insertMany:outcomes': 1, 'insertMany:selfWork': 1,
    'insertMany:literature': 1, 'insertMany:software': 1, 'insertMany:grading': 1, 'insertMany:rules': 1 });
  assert.equal(Object.values(lists).every((n) => n === 1), true);
  // an approved version by id: the form opens only for its own people (like syllabus.get); a student and someone else's teacher get forbidden
  assert.deepEqual([call('syllabus.form', { syllabusId: approved.id }, teacher2).error, call('syllabus.form', { syllabusId: approved.id }, s1).error,
    ...[teacher1, dean, prorector].map((token) => call('syllabus.form', { syllabusId: approved.id }, token).ok)], [{ code: 'forbidden' }, { code: 'forbidden' }, true, true, true]);
  // the form of the copy knows the key has an approved version
  assert.equal(call('syllabus.form', { syllabusId }, teacher1).data.syllabus.copyOfApproved, true);
});

test('saveSection: every section is stored in its own sheets and comes back from syllabus.form', () => {
  const env = setup();
  const { store, call, save, reset, writes, teacher1, sb1, sb3, g1, g2 } = env;
  const { syllabusId, savedOrder } = fullDraft(env);
  const form = call('syllabus.form', { syllabusId }, teacher1).data;
  assert.deepEqual(form.doc.title, SECTIONS_VALUE.title);
  assert.deepEqual(form.doc.goals.knowledge, ['=СУММ(A1) остаётся текстом', '<script>alert(1)</script>']);
  assert.deepEqual(form.doc.plan.units.map((u) => [u.unit, u.title, u.lecture.map((r) => r.name), u.control.length]),
    [[1, 'Негиздер', ['Жалпы анатомия'], 1], [2, '', ['Сөөктөр жана муундар'], 0]]);
  assert.deepEqual(form.doc.lessons.map((l) => l.name), savedOrder);
  assert.equal(form.doc.plan.manualOrder, true);
  assert.deepEqual([form.syllabus.status, form.can, form.checks.errors], ['draft', { edit: true, submit: true, approve: false, giveBack: false }, []]);
  assert.deepEqual(form.doc.units.units.map((u) => [u.unit, u.title, u.description, u.literature.length]), [[1, 'Негиздер', 'О первом юните', 1], [2, '', 'О втором юните', 0]]);
  assert.deepEqual([form.doc.selfWork.items.length, form.doc.literature.main.length, form.doc.software.items[0].link, form.doc.policies.grading[0].name, form.doc.policies.sanctionEthics],
    [1, 1, 'https://moodle.example', 'Экзамен', 'Пересдача']);
  assert.equal(store.list('topics').every((t) => t.unitTitle === (t.unit === 1 ? 'Негиздер' : '')), true);
  assert.deepEqual([form.subject.name, form.subject.id, form.subject.teacherName, form.subject.groups],
    ['Информатика', sb1, 'teacher1', [{ subjectId: sb1, groupName: '01-1' }, { subjectId: sb3, groupName: '02-1' }]]);
  assert.deepEqual([g1 !== g2, form.syllabus.updated, form.today], [true, '2026-08-31', '2026-08-31']);
  // the same section a second time: not one write
  reset();
  assert.equal(save(syllabusId, 'literature', SECTIONS_VALUE.literature, teacher1).ok, true);
  assert.deepEqual(writes, {});
});

test('saveSection: an error writes nothing', () => {
  const env = setup();
  const { save, snapshotAll, teacher1 } = env;
  const { syllabusId } = fullDraft(env);
  const before = snapshotAll();
  const bad = save(syllabusId, 'plan', { units: [{ lecture: [{ name: 'Хорошая', hours: 2 }, { name: 'Плохая', hours: 3 }] }] }, teacher1);
  assert.deepEqual(bad.error, { code: 'invalid', fields: [{ unit: 1, list: 'lecture', index: 1, field: 'hours', code: 'bad_hours' }] });
  assert.equal(snapshotAll(), before);
  // a section that is not an object, a unit that does not exist
  assert.equal(code(save(syllabusId, 'goals', 'text', teacher1)), 'invalid');
  assert.deepEqual(save(syllabusId, 'units', { units: [{ unit: 9, description: 'x', questions: '', guidance: '', results: '', literature: [] }] }, teacher1).error,
    { code: 'invalid', fields: [{ list: 'units', index: 0, field: 'unit', code: 'bad_ref' }] });
  // the plan semester must have the parity of the half of the year
  assert.deepEqual(save(syllabusId, 'title', { ...SECTIONS_VALUE.title, planSemester: 2 }, teacher1).error, { code: 'invalid', fields: [{ field: 'planSemester', code: 'semester_half' }] });
  assert.equal(snapshotAll(), before);
});

test('saveSection: a topic with a bad unit stops the saving of the plan and nothing is written', () => {
  const env = setup();
  const { store, save, call, snapshotAll, teacher1 } = env;
  const { syllabusId } = fullDraft(env);
  const lost = store.list('topics').find((t) => t.syllabusId === syllabusId && t.name === 'Жалпы анатомия');
  store.update('topics', lost.id, { unit: 0 });
  const before = snapshotAll();
  assert.deepEqual(save(syllabusId, 'plan', SECTIONS_VALUE.plan, teacher1).error, { code: 'invalid', fields: [{ code: 'bad_unit', id: lost.id, name: 'Жалпы анатомия' }] });
  assert.equal(snapshotAll(), before);
  assert.deepEqual(call('syllabus.form', { syllabusId }, teacher1).data.checks.errors.filter((e) => e.code === 'bad_unit'), [{ section: 'plan', code: 'bad_unit', id: lost.id, name: 'Жалпы анатомия' }]);
});

test('saveSection: a unit without a title is found through the plan', () => {
  const env = setup();
  const { save, teacher1, store } = env;
  const syllabusId = env.draft(env.sb1, 1, teacher1);
  assert.equal(save(syllabusId, 'plan', SECTIONS_VALUE.plan, teacher1).ok, true);
  assert.equal(store.list('units').filter((u) => u.syllabusId === syllabusId).length, 1);        // unit 2 has no row yet
  assert.equal(save(syllabusId, 'units', SECTIONS_VALUE.units, teacher1).ok, true);
  assert.equal(store.list('units').filter((u) => u.syllabusId === syllabusId).length, 2);
});

test('rights: someone else\'s syllabus, a row of another version, an array or spaces instead of an id', () => {
  const env = setup();
  const { store, call, save, snapshotAll, teacher1, teacher2, dean, prorector, s1, staff, sb1, sb2, sb3 } = env;
  const { syllabusId } = fullDraft(env);
  const otherId = env.draft(sb2, 1, teacher2);
  assert.equal(save(otherId, 'plan', { units: [{ lecture: [{ name: 'Чужая', hours: 2 }] }] }, teacher2).ok, true);
  const topicOfOtherVersion = store.list('topics').find((t) => t.syllabusId === otherId).id;
  // someone else's syllabus: teacher2 does not create, read or save the version of teacher1; the prorector does not save it; a student does not read the form
  assert.deepEqual([code(call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, teacher2)), code(call('syllabus.form', { syllabusId }, teacher2)),
    code(save(syllabusId, 'goals', { goal: 'x' }, teacher2)), code(save(syllabusId, 'goals', { goal: 'x' }, prorector)), code(call('syllabus.form', { syllabusId }, s1)),
    code(save(syllabusId, 'goals', { goal: 'x' }, s1))],
  ['forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden', 'forbidden']);
  // the prorector does not see a draft; the dean edits the version of any teacher
  assert.deepEqual([code(call('syllabus.form', { syllabusId }, prorector)), save(syllabusId, 'goals', { ...SECTIONS_VALUE.goals, goal: 'Цель деканата' }, dean).ok], ['forbidden', true]);
  // an array, a number, spaces, an empty string, a missing id
  for (const id of [[syllabusId], ' ' + syllabusId, syllabusId + ' ', 7, '', {}, null]) {
    assert.equal(code(call('syllabus.form', { syllabusId: id }, dean)), 'bad_request', JSON.stringify(id));
    assert.equal(code(save(id, 'goals', { goal: 'x' }, dean)), 'bad_request', JSON.stringify(id));
  }
  assert.equal(code(call('syllabus.form', {}, dean)), 'bad_request');
  for (const subjectId of [[sb1], sb1 + ' ', '', 5]) assert.equal(code(call('syllabus.startDraft', { subjectId, semester: 1 }, dean)), 'bad_request', JSON.stringify(subjectId));
  for (const semester of [3, 0, '1', [1], undefined]) assert.equal(code(call('syllabus.startDraft', { subjectId: sb1, semester }, dean)), 'bad_request', JSON.stringify(semester));
  for (const section of ['grades', 'Plan', '', 7, ['goals'], undefined]) assert.equal(code(save(syllabusId, section, {}, dean)), 'bad_request', JSON.stringify(section));
  assert.equal(code(save('sy_missing', 'goals', {}, dean)), 'not_found');
  assert.equal(code(call('syllabus.form', { syllabusId: 'sy_missing' }, dean)), 'not_found');
  // a row of another version in the plan
  assert.deepEqual(save(syllabusId, 'plan', { units: [{ lecture: [{ id: topicOfOtherVersion, name: 'Чужая', hours: 2 }] }] }, teacher1).error,
    { code: 'invalid', fields: [{ unit: 1, list: 'lecture', index: 0, field: 'id', code: 'bad_ref' }] });
  // the discipline went to another teacher: the responsible stays the responsible until the deanery names another one, then the former one neither edits nor reads
  for (const id of [sb1, sb3]) assert.equal(call('dir.save', { table: 'subjects', row: { id, teacherId: staff.teacher2 } }, dean).ok, true);
  assert.equal(save(syllabusId, 'goals', { ...SECTIONS_VALUE.goals, goal: 'Ещё его' }, teacher1).ok, true);
  assert.equal(code(save(syllabusId, 'goals', { goal: 'x' }, teacher2)), 'forbidden');
  const line = store.list('syllabusLines').find((l) => l.kind === 'main' && l.disciplineId === store.get('syllabi', syllabusId).disciplineId);
  store.update('syllabusLines', line.id, { responsibleId: staff.teacher2 });
  const before = snapshotAll();
  assert.deepEqual([code(save(syllabusId, 'goals', { goal: 'x' }, teacher1)), code(call('syllabus.form', { syllabusId }, teacher1))], ['forbidden', 'forbidden']);
  assert.equal(snapshotAll(), before);
  assert.equal(save(syllabusId, 'goals', { ...SECTIONS_VALUE.goals, goal: 'Теперь его' }, teacher2).ok, true);
});

test('rights: a teacher who leads the same discipline reads the draft of the responsible, but does not change it', () => {
  const { store, call, save, teacher1, teacher2, staff, sb1, ds1, g2 } = setup();
  const id = call('syllabus.startDraft', { subjectId: sb1, semester: 1 }, teacher1).data.syllabusId;
  store.insert('subjects', { name: 'Информатика', disciplineId: ds1, groupId: g2, teacherId: staff.teacher2, scheme: 'A' });
  const form = call('syllabus.form', { syllabusId: id }, teacher2);
  assert.deepEqual([form.ok, form.data.can.edit, form.data.line.mine, code(save(id, 'goals', { goal: 'x' }, teacher2))], [true, false, 'teaches', 'forbidden']);
});

test('a version under review or approved is locked', () => {
  const env = setup();
  const { store, call, save, snapshotAll, teacher1, dean } = env;
  const { syllabusId } = fullDraft(env);
  store.update('syllabi', syllabusId, { status: 'review' });
  const before = snapshotAll();
  assert.deepEqual([save(syllabusId, 'goals', { goal: 'x' }, teacher1).error, save(syllabusId, 'goals', { goal: 'x' }, dean).error, call('syllabus.form', { syllabusId }, teacher1).data.can.edit],
    [{ code: 'syllabus_locked' }, { code: 'syllabus_locked' }, false]);
  store.update('syllabi', syllabusId, { status: 'approved' });
  assert.deepEqual(save(syllabusId, 'goals', { goal: 'x' }, dean).error, { code: 'syllabus_locked' });
  store.update('syllabi', syllabusId, { status: 'review' });
  assert.equal(snapshotAll(), before);
  // a returned version is edited again
  store.update('syllabi', syllabusId, { status: 'returned' });
  assert.equal(save(syllabusId, 'goals', { ...SECTIONS_VALUE.goals, goal: 'Исправлено' }, teacher1).ok, true);
});

test('speed: a section reads only its own sheets, each once; the form reads every sheet once', () => {
  const env = setup();
  const { call, save, reset, lists, calls, writes, teacher1 } = env;
  const { syllabusId } = fullDraft(env);
  const changed = {
    title: { ...SECTIONS_VALUE.title, credits: 3 },
    goals: { ...SECTIONS_VALUE.goals, goal: 'Другая цель' },
    plan: { units: [{ ...SECTIONS_VALUE.plan.units[0], lecture: [{ ...SECTIONS_VALUE.plan.units[0].lecture[0], id: call('syllabus.form', { syllabusId }, teacher1).data.doc.plan.units[0].lecture[0].id, name: 'Жалпы анатомия 2' }] }, SECTIONS_VALUE.plan.units[1]] },
    selfWork: { items: [{ unit: 1, name: 'Реферат', tasks: 'Другое', hours: 6 }] },
    literature: { main: [book('Другая книга')], extra: [] },
    software: { items: [{ name: 'Moodle', link: 'https://moodle.example/2' }] },
    policies: { ...SECTIONS_VALUE.policies, behavior: ['Другое правило'] },
    units: { units: [{ ...SECTIONS_VALUE.units.units[0], description: 'Новое описание' }, SECTIONS_VALUE.units.units[1]] },
  };
  const reads = { title: {}, goals: { outcomes: 1 }, plan: { topics: 1, units: 1, literature: 1 }, selfWork: { selfWork: 1 }, literature: { literature: 1 }, software: { software: 1 },
    policies: { grading: 1, rules: 1 }, units: { units: 1, literature: 1 }, order: { topics: 1 } };
  for (const [section, own] of Object.entries(reads)) {
    if (section === 'order') {
      const ids = call('syllabus.form', { syllabusId }, teacher1).data.doc.lessons.map((l) => l.id);
      changed.order = { order: [ids[1], ids[0], ...ids.slice(2)] };
    }
    reset();
    const answer = save(syllabusId, section, changed[section], teacher1);
    assert.equal(answer.ok, true, section + ' ' + JSON.stringify(answer));
    assert.equal(answer.data.lessons === null, !['plan', 'order'].includes(section), section);
    assert.deepEqual(lists, { syllabi: 1, subjects: 1, syllabusLines: 1, ...own }, section);
    assert.deepEqual([calls.get, calls.insert || 0, calls.update || 0, calls.remove || 0], [1, 0, 0, 0], section);
    assert.equal(Object.values(writes).every((n) => n === 1) && writes['updateMany:syllabi'] === 1, true, section);
  }
  reset();
  call('syllabus.form', { syllabusId }, teacher1);
  assert.deepEqual([lists, writes], [{ subjects: 1, staff: 1, groups: 1, syllabi: 1, syllabusLines: 1, topics: 1, units: 1, outcomes: 1, selfWork: 1, literature: 1, software: 1, grading: 1, rules: 1, pairs: 1 }, {}]);
});

test('saveSection: the answer carries the section, the order of lessons, the flag and the date', () => {
  const env = setup();
  const { save, teacher1 } = env;
  const syllabusId = env.draft(env.sb1, 1, teacher1);
  const plan = save(syllabusId, 'plan', SECTIONS_VALUE.plan, teacher1).data;
  assert.deepEqual([plan.doc.units.length, plan.lessons.map((l) => l.name), plan.manualOrder, plan.updated], [2, ['Жалпы анатомия', 'Практика сөөктөр', 'Модуль', 'Сөөктөр жана муундар'], false, '2026-08-31']);
  const order = save(syllabusId, 'order', { order: [plan.lessons[1].id, plan.lessons[0].id, plan.lessons[2].id, plan.lessons[3].id] }, teacher1).data;
  assert.deepEqual([order.lessons.map((l) => l.name), order.manualOrder], [['Практика сөөктөр', 'Жалпы анатомия', 'Модуль', 'Сөөктөр жана муундар'], true]);
  const goals = save(syllabusId, 'goals', SECTIONS_VALUE.goals, teacher1).data;
  assert.deepEqual([goals.doc.goal, goals.lessons], ['Цель курса', null]);
});

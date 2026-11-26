import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionsOf, rightsOn, EDITABLE_STATUSES, copiesOf, checkHeld, checkSubmit, approvalPlan } from '../core/syllabusFlow.js';

const key = { disciplineId: 'ds_1', teacherId: 'sf_t', semester: 1 };
const v = (status, version = 1) => ({ id: 'sy_' + status, ...key, status, version });

test('versionsOf: the approved version, the open one and the last number of a key', () => {
  assert.deepEqual(versionsOf([v('archived'), v('approved', 2), v('returned', 3), { ...v('draft'), semester: 2 }], key), { approved: v('approved', 2), open: v('returned', 3), last: 3 });
  assert.deepEqual(versionsOf([], key), { approved: null, open: null, last: 0 });
  // another discipline or another teacher is another key
  assert.deepEqual(versionsOf([{ ...v('approved'), disciplineId: 'ds_2' }, { ...v('draft'), teacherId: 'sf_x' }], key), { approved: null, open: null, last: 0 });
  // every open status counts as open
  assert.deepEqual(['draft', 'review', 'returned'].map((status) => versionsOf([v(status)], key).open.status), ['draft', 'review', 'returned']);
});

test('versionsOf: two matching rows (two simultaneous «Fill») give one answer, whatever their order', () => {
  // выбор однозначный — больший номер, затем больший id
  assert.deepEqual([versionsOf([{ ...v('draft', 2), id: 'sy_a' }, { ...v('draft', 3), id: 'sy_b' }], key).open.id, versionsOf([{ ...v('draft', 2), id: 'sy_b' }, { ...v('draft', 2), id: 'sy_a' }], key).open.id],
    ['sy_b', 'sy_b']);
  assert.deepEqual([[{ ...v('approved', 1), id: 'sy_z' }, { ...v('approved', 2), id: 'sy_a' }], [{ ...v('approved', 2), id: 'sy_a' }, { ...v('approved', 1), id: 'sy_z' }]]
    .map((rows) => versionsOf(rows, key).approved.id), ['sy_a', 'sy_a']);
});

// ---- задача 36: права, проверка перед отправкой, проведённые пары, план утверждения ----

const viewers = { owner: { id: 'sf_t', roles: ['teacher'], part: 'responsible' }, former: { id: 'sf_t', roles: ['teacher'], part: null },
  other: { id: 'sf_x', roles: ['teacher'], part: null }, dean: { id: 'sf_d', roles: ['dean', 'teacher'], part: null },
  prorector: { id: 'sf_p', roles: ['prorector'], part: null }, student: { id: 'st_1', roles: ['student'], part: null } };
const flags = (status, who) => Object.entries(rightsOn(v(status), viewers[who])).filter(([, yes]) => yes).map(([name]) => name).join();

test('rightsOn: who sees and does what in each status', () => {
  assert.deepEqual(EDITABLE_STATUSES, ['draft', 'returned']);
  assert.deepEqual(['owner', 'former', 'other', 'dean', 'prorector', 'student'].map((who) => flags('draft', who)), ['see,edit,submit', '', '', 'see,edit,submit,approve', '', '']);
  assert.deepEqual(['owner', 'other', 'dean', 'prorector', 'student'].map((who) => flags('review', who)), ['see', '', 'see,approve,giveBack', 'see', '']);
  assert.deepEqual(['owner', 'dean', 'prorector'].map((who) => flags('returned', who)), ['see,edit,submit', 'see,edit,submit,approve', 'see']);
  assert.deepEqual(['owner', 'dean', 'student'].map((who) => flags('approved', who)), ['see', 'see', 'see']);
  assert.deepEqual(['owner', 'dean'].map((who) => flags('archived', who)), ['', '']);
  // сотрудник деканата, который сам ведёт дисциплину, свою версию утверждает (решение владельца)
  assert.equal(rightsOn(v('draft'), { id: 'sf_t', roles: ['dean', 'teacher'], part: 'responsible' }).approve, true);
});

test('rightsOn: the place on the syllabus of the discipline (responsible, teaches) and the line of the history', () => {
  const flagsOf = (status, viewer) => Object.entries(rightsOn(v(status), viewer)).filter(([, yes]) => yes).map(([name]) => name).join();
  const teacher = (part, extra = {}) => ({ id: 'sf_t', roles: ['teacher'], part, ...extra });
  assert.deepEqual(['draft', 'review', 'returned', 'approved'].map((s) => flagsOf(s, teacher('responsible'))), ['see,edit,submit', 'see', 'see,edit,submit', 'see']);   // дисциплину может уже не вести
  assert.deepEqual(['draft', 'review', 'approved'].map((s) => flagsOf(s, teacher('teaches'))), ['see', 'see', 'see']);
  assert.equal(flagsOf('returned', viewers.prorector), 'see');
  assert.equal(flagsOf('draft', { ...viewers.dean, archived: true }), 'see');
  assert.equal(flagsOf('approved', teacher('responsible', { archived: true })), '');
});

test('rightsOn: attempts to get around the rules', () => {
  const none = { see: false, edit: false, submit: false, approve: false, giveBack: false };
  // преподаватель не утверждает и не возвращает сам себе
  for (const status of ['draft', 'review', 'returned']) {
    const r = rightsOn(v(status), viewers.owner);
    assert.deepEqual([r.approve, r.giveBack], [false, false], status);
  }
  // студент не просит ни черновик, ни замечание
  for (const status of ['draft', 'review', 'returned', 'archived']) assert.deepEqual(rightsOn(v(status), viewers.student), none, status);
  // проректор не видит черновик и ничего не меняет
  assert.deepEqual(rightsOn(v('draft'), viewers.prorector), none);
  for (const status of ['review', 'returned', 'approved']) {
    const r = rightsOn(v(status), viewers.prorector);
    assert.deepEqual([r.edit, r.submit, r.approve, r.giveBack], [false, false, false, false], status);
  }
  // чужая линия (человек не на ней), роли строкой вместо массива
  assert.deepEqual(rightsOn(v('draft'), { ...viewers.owner, part: null }), none);
  assert.deepEqual(rightsOn(v('draft'), { id: 'sf_t', roles: 'teacher', part: 'responsible' }), none);
  // без места на линии прав нет (раньше владельцем считался тот, чей id стоит в колонке версии)
  assert.deepEqual(rightsOn(v('draft'), { id: 'sf_t', roles: ['teacher'] }), none);
  // пустой или неизвестный id зрителя прав не даёт, даже с местом на линии
  assert.deepEqual(rightsOn(v('draft'), { id: undefined, roles: ['teacher'], part: 'responsible' }), none);
  assert.deepEqual(rightsOn(v('draft'), { id: '', roles: ['teacher'], part: 'responsible' }), none);
  // нет версии, неизвестный статус, нет зрителя
  assert.deepEqual(rightsOn(null, viewers.dean), none);
  assert.deepEqual(rightsOn(v('weird'), viewers.dean), none);
  assert.deepEqual(rightsOn(v('draft'), null), none);
});

const emptyDoc = { title: { department: '', academicYear: '', course: null, planSemester: null, credits: null }, goals: { goal: '' }, plan: { manualOrder: false, units: [] },
  selfWork: { items: [] }, literature: { main: [], extra: [] }, software: { items: [] }, policies: { grading: [], behavior: [], ethics: [], sanctionBehavior: '', sanctionEthics: '' },
  units: { units: [] } };
const row = (name, hours = 2) => ({ id: 'r_' + name, name, hours, controlForms: '', selfHours: null, description: '', number: 1 });
const fullDoc = { title: { department: 'Кафедра', academicYear: '2026–2027', course: 1, planSemester: 1, credits: 3 }, goals: { goal: 'Цель' },
  plan: { manualOrder: false, units: [{ unit: 1, title: 'Основы', lecture: [row('Л', 4)], practice: [row('П')], seminar: [], lab: [], control: [row('М')] }] },
  selfWork: { items: [{ unit: 1, name: 'Работа', tasks: '', hours: 2 }] }, literature: { main: [{ title: 'Книга' }], extra: [] }, software: { items: [{ name: 'ПО', link: '' }] },
  policies: { grading: [{ name: 'Экзамен' }], behavior: [], ethics: [], sanctionBehavior: '', sanctionEthics: '' }, units: { units: [{ unit: 1, description: 'Описание' }] } };

test('checkSubmit: an empty document and a full one', () => {
  assert.deepEqual(checkSubmit(emptyDoc).errors, [...['department', 'academicYear', 'course', 'planSemester', 'credits'].map((field) => ({ section: 'title', field, code: 'required' })),
    { section: 'plan', code: 'empty' }]);
  assert.deepEqual(checkSubmit(emptyDoc).warnings, ['goals', 'literature', 'software', 'policies', 'units'].map((section) => ({ section, code: 'empty' })));
  const second = structuredClone(fullDoc);
  second.plan.units.push({ unit: 2, title: '', lecture: [], practice: [], seminar: [], lab: [], control: [row('М2')] });
  second.selfWork.items[0].unit = 5;
  assert.deepEqual(checkSubmit(second).errors, [{ section: 'plan', unit: 2, code: 'unit_empty' }, { section: 'selfWork', index: 0, code: 'bad_unit' }]);
  assert.deepEqual(checkSubmit(fullDoc), { errors: [], warnings: [] });
  const noGoal = structuredClone(fullDoc);
  noGoal.goals.goal = '   ';
  assert.deepEqual(checkSubmit(noGoal), { errors: [], warnings: [{ section: 'goals', code: 'empty' }] });
  // пробелы вместо значения — не заполнено
  const blank = structuredClone(fullDoc);
  blank.title.department = '   ';
  assert.deepEqual(checkSubmit(blank).errors, [{ section: 'title', field: 'department', code: 'required' }]);
});

test('checkSubmit: hours that are not 2 or 4 (a row edited by hand in the table)', () => {
  const odd = structuredClone(fullDoc);
  odd.plan.units[0].lecture[0].hours = 3;
  assert.deepEqual(checkSubmit(odd).errors, [{ section: 'plan', code: 'bad_hours', name: odd.plan.units[0].lecture[0].name }]);
  const control = structuredClone(fullDoc);
  control.plan.units[0].control[0].hours = 0;
  assert.deepEqual(checkSubmit(control).errors, []);
  control.plan.units[0].control[0].hours = 4;
  assert.deepEqual(checkSubmit(control).errors.map((e) => e.code), ['bad_hours']);
});

test('checkSubmit: the held errors come last and do not change the warnings', () => {
  const held = [{ section: 'plan', code: 'held_missing', name: 'b', date: '2026-09-01' }];
  assert.deepEqual(checkSubmit(fullDoc, held), { errors: held, warnings: [] });
});

// утверждённая версия: a (лекция 4 ч), b (практика 2 ч), c (лекция 2 ч); проведены a часть 2 (2026-09-08), b часть 1 (2026-09-01)
const topic = (id, order, lessonKind, hours) => ({ id, syllabusId: 'sy_approved', order, unit: 1, lessonKind, name: id, hours, controlForms: '', selfHours: null, description: '', unitTitle: '', sourceId: '' });
const approvedTopics = [topic('a', 1, 'lecture', 4), topic('b', 2, 'practice', 2), topic('c', 3, 'lecture', 2)];
const pairs = [{ id: 'p_a2', topicId: 'a', lessonType: 'lecture', part: 2, status: 'closed', date: '2026-09-08', slot: 1 },
  { id: 'p_b1', topicId: 'b', lessonType: 'practice', part: 1, status: 'closed', date: '2026-09-01', slot: 1 },
  { id: 'p_c1', topicId: 'c', lessonType: 'lecture', part: 1, status: 'planned', date: '2026-09-15', slot: 1 }];
const copyOf = (id, extra = {}) => ({ ...approvedTopics.find((t) => t.id === id), id: id + '2', sourceId: id, syllabusId: 'sy_review', ...extra });

test('checkHeld: held pairs against the copies of their rows', () => {
  assert.deepEqual(checkHeld([copyOf('a'), copyOf('b'), copyOf('c')], approvedTopics, pairs), []);
  assert.deepEqual(checkHeld([{ ...copyOf('c'), order: 1 }, copyOf('a'), copyOf('b')], approvedTopics, pairs), []);
  assert.deepEqual(checkHeld([copyOf('a', { hours: 2 }), copyOf('b', { lessonKind: 'lecture' })], approvedTopics, pairs),
    [{ section: 'plan', code: 'held_hours', name: 'a', date: '2026-09-08', held: 4 }, { section: 'plan', code: 'held_kind', name: 'b', date: '2026-09-01' }]);
  assert.deepEqual(checkHeld([copyOf('a')], approvedTopics, pairs), [{ section: 'plan', code: 'held_missing', name: 'b', date: '2026-09-01' }]);
  assert.deepEqual(checkHeld([copyOf('a', { lessonKind: 'lecture' }), copyOf('b', { lessonKind: 'seminar' })], approvedTopics, pairs), []);
  // планируемые пары проверку не трогают
  assert.deepEqual(checkHeld([], approvedTopics, pairs.filter((p) => p.status === 'planned')), []);
  // пара не на строке утверждённой версии в расчёт не входит
  assert.deepEqual(checkHeld([], approvedTopics, [{ ...pairs[0], topicId: 'zzz' }]), []);
});

test('copiesOf: by sourceId first, then by kind and name; one row is the copy of one row at most', () => {
  const rewritten = { ...copyOf('b'), id: 'b9', sourceId: '', name: '  B ' };
  assert.deepEqual([...copiesOf([copyOf('a'), rewritten, { ...rewritten, id: 'b8' }], approvedTopics)].map(([from, r]) => [from, r.id]), [['a', 'a2'], ['b', 'b9']]);
  assert.deepEqual(checkHeld([copyOf('a'), rewritten], approvedTopics, pairs), []);
  // регистр и повторные пробелы внутри названия не важны; одинаковые названия — по счёту в порядке order
  const twins = [topic('t1', 1, 'lecture', 2), topic('t2', 2, 'lecture', 2)].map((t) => ({ ...t, name: 'Две  Темы' }));
  const fresh = [{ ...twins[0], id: 'n2', order: 2, sourceId: '', name: 'две темы' }, { ...twins[0], id: 'n1', order: 1, sourceId: '', name: 'ДВЕ ТЕМЫ' }];
  assert.deepEqual([...copiesOf(fresh, twins)].map(([from, r]) => [from, r.id]), [['t1', 'n1'], ['t2', 'n2']]);
  // то же название, но другой вид, или чужой sourceId — не копия
  assert.deepEqual(checkHeld([copyOf('a'), { ...rewritten, lessonKind: 'lecture' }], approvedTopics, pairs), [{ section: 'plan', code: 'held_missing', name: 'b', date: '2026-09-01' }]);
  assert.deepEqual(checkHeld([copyOf('a'), { ...rewritten, sourceId: 'c' }], approvedTopics, pairs), [{ section: 'plan', code: 'held_missing', name: 'b', date: '2026-09-01' }]);
  // две строки с одним sourceId: копия — первая, вторая запасным сопоставлением не берётся
  const dup = [copyOf('a'), { ...copyOf('a'), id: 'a3' }, copyOf('b'), copyOf('c')];
  assert.deepEqual([...copiesOf(dup, approvedTopics)].map(([from, r]) => [from, r.id]), [['a', 'a2'], ['b', 'b2'], ['c', 'c2']]);
});

test('approvalPlan: the new version is approved, the previous one archived, the pairs follow their copies', () => {
  const plan = approvalPlan({ version: v('review', 2), approved: v('approved'), topics: [copyOf('a'), copyOf('b')], approvedTopics, pairs, userId: 'sf_d', today: '2026-09-10' });
  assert.deepEqual(plan.syllabi, [{ id: 'sy_review', patch: { status: 'approved', decidedBy: 'sf_d', decidedAt: '2026-09-10', remark: '' } }, { id: 'sy_approved', patch: { status: 'archived' } }]);
  assert.deepEqual(plan.pairs, [{ id: 'p_a2', patch: { topicId: 'a2' } }, { id: 'p_b1', patch: { topicId: 'b2' } }, { id: 'p_c1', patch: { topicId: '', lessonType: '', part: null } }]);
  const rewritten = { ...copyOf('b'), id: 'b9', sourceId: '', name: '  B ' };
  assert.deepEqual(approvalPlan({ version: v('review', 2), approved: v('approved'), topics: [copyOf('a'), rewritten], approvedTopics, pairs, userId: 'sf_d', today: '2026-09-10' }).pairs,
    [{ id: 'p_a2', patch: { topicId: 'a2' } }, { id: 'p_b1', patch: { topicId: 'b9' } }, { id: 'p_c1', patch: { topicId: '', lessonType: '', part: null } }]);
  // первая версия: одна запись версии, пары не трогаются
  assert.deepEqual(approvalPlan({ version: v('review'), approved: null, topics: [copyOf('a')], approvedTopics: [], pairs, userId: 'sf_d', today: '2026-09-10' }),
    { syllabi: [{ id: 'sy_review', patch: { status: 'approved', decidedBy: 'sf_d', decidedAt: '2026-09-10', remark: '' } }], pairs: [] });
});

test('checkSubmit: a checkpoint without hours first in its unit and a lesson of an unknown kind are named', () => {      // final M2, M3
  const lesson = (id, unit, lessonKind, hours = 2) => ({ id, unit, lessonKind, number: 1, name: 'Тема ' + id, hours });
  const doc = structuredClone(fullDoc);
  doc.plan.units.push({ unit: 2, title: '', lecture: [row('Л2')], practice: [], seminar: [], lab: [], control: [row('М2', 0)] });
  doc.lessons = [lesson('a', 1, 'lecture'), lesson('m1', 1, 'control', 0), lesson('m2', 2, 'control', 0), lesson('b', 2, 'lecture')];
  assert.deepEqual(checkSubmit(doc).errors, [{ section: 'order', unit: 2, code: 'control_first' }]);
  // a checkpoint of two hours is a pair of its own: it may come first
  doc.lessons[2].hours = 2;
  assert.deepEqual(checkSubmit(doc).errors, []);
  // a unit of nothing but a checkpoint is only «unit_empty»
  const lone = structuredClone(fullDoc);
  lone.plan.units.push({ unit: 2, title: '', lecture: [], practice: [], seminar: [], lab: [], control: [row('М2', 0)] });
  lone.lessons = [lesson('a', 1, 'lecture'), lesson('m2', 2, 'control', 0)];
  assert.deepEqual(checkSubmit(lone).errors, [{ section: 'plan', unit: 2, code: 'unit_empty' }]);
  // «практика» typed by hand in the sheet instead of the code: not in any table of the plan, never a pair
  const odd = structuredClone(fullDoc);
  odd.lessons = [lesson('a', 1, 'lecture'), lesson('x', 1, 'практика')];
  assert.deepEqual(checkSubmit(odd).errors, [{ section: 'plan', code: 'bad_kind', id: 'x', name: 'Тема x' }]);
});

test('checkSubmit: the course must match the plan semester (rule 7); a group of another course is a warning', () => {
  const doc = (course, planSemester) => ({ ...fullDoc, title: { ...fullDoc.title, course, planSemester } });
  assert.deepEqual(checkSubmit(doc(2, 1)).errors, [{ section: 'title', field: 'planSemester', code: 'course_semester', course: 2 }]);
  assert.deepEqual(checkSubmit(doc(2, 3)).errors, []);
  const of = (groups) => checkSubmit(doc(1, 1), [], groups).warnings.filter((w) => w.code === 'group_course');
  assert.deepEqual(of([{ name: '03-1', course: 2 }, { name: '01-1', course: 1 }]), [{ section: 'title', code: 'group_course', groups: ['03-1'] }]);
  assert.deepEqual(of([{ name: '01-1', course: 1 }]), []);
  assert.deepEqual(of([{ name: '03-1', course: 2 }, { name: '02-1', course: 3 }]), [{ section: 'title', code: 'group_course', groups: ['02-1', '03-1'] }]);
});

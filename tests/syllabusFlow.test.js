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

const viewers = { owner: { id: 'sf_t', roles: ['teacher'], teaches: true }, former: { id: 'sf_t', roles: ['teacher'], teaches: false },
  other: { id: 'sf_x', roles: ['teacher'], teaches: true }, dean: { id: 'sf_d', roles: ['dean', 'teacher'], teaches: false },
  prorector: { id: 'sf_p', roles: ['prorector'], teaches: false }, student: { id: 'st_1', roles: ['student'], teaches: false } };
const flags = (status, who) => Object.entries(rightsOn(v(status), viewers[who])).filter(([, yes]) => yes).map(([name]) => name).join();

test('rightsOn: who sees and does what in each status', () => {
  assert.deepEqual(EDITABLE_STATUSES, ['draft', 'returned']);
  assert.deepEqual(['owner', 'former', 'other', 'dean', 'prorector', 'student'].map((who) => flags('draft', who)), ['see,edit,submit', '', '', 'see,edit,submit,approve', '', '']);
  assert.deepEqual(['owner', 'other', 'dean', 'prorector', 'student'].map((who) => flags('review', who)), ['see', '', 'see,approve,giveBack', 'see', '']);
  assert.deepEqual(['owner', 'dean', 'prorector'].map((who) => flags('returned', who)), ['see,edit,submit', 'see,edit,submit,approve', 'see']);
  assert.deepEqual(['owner', 'dean', 'student'].map((who) => flags('approved', who)), ['see', 'see', 'see']);
  assert.deepEqual(['owner', 'dean'].map((who) => flags('archived', who)), ['', '']);
  // сотрудник деканата, который сам ведёт дисциплину, свою версию утверждает (решение владельца)
  assert.equal(rightsOn(v('draft'), { id: 'sf_t', roles: ['dean', 'teacher'], teaches: true }).approve, true);
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
  // чужая версия (другой преподаватель), роли строкой вместо массива, teaches не булево
  assert.deepEqual(rightsOn({ ...v('draft'), teacherId: 'sf_x' }, viewers.owner), none);
  assert.deepEqual(rightsOn(v('draft'), { id: 'sf_t', roles: 'teacher', teaches: true }), none);
  assert.deepEqual(rightsOn(v('draft'), { id: 'sf_t', roles: ['teacher'], teaches: 'yes' }), none);
  // пустой id зрителя не совпадает с пустым id преподавателя версии
  assert.deepEqual(rightsOn({ ...v('draft'), teacherId: undefined }, { id: undefined, roles: ['teacher'], teaches: true }), none);
  assert.deepEqual(rightsOn({ ...v('draft'), teacherId: '' }, { id: '', roles: ['teacher'], teaches: true }), none);
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
    { section: 'goals', field: 'goal', code: 'required' }, { section: 'plan', code: 'empty' }]);
  assert.deepEqual(checkSubmit(emptyDoc).warnings, ['literature', 'software', 'policies', 'units'].map((section) => ({ section, code: 'empty' })));
  const second = structuredClone(fullDoc);
  second.plan.units.push({ unit: 2, title: '', lecture: [], practice: [], seminar: [], lab: [], control: [row('М2')] });
  second.selfWork.items[0].unit = 5;
  assert.deepEqual(checkSubmit(second).errors, [{ section: 'plan', unit: 2, code: 'unit_empty' }, { section: 'selfWork', index: 0, code: 'bad_unit' }]);
  assert.deepEqual(checkSubmit(fullDoc), { errors: [], warnings: [] });
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

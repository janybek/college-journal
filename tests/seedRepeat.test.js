import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { DEFAULT_BELLS } from '../core/settings.js';
import { addDays } from '../core/dates.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { readLedgerRows } from '../backend/ledgerData.js';
import { halfResults } from '../backend/repeatSnapshot.js';
import { bishkek } from './journalSetup.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek
const NUMBERS = [{ key: 'scoreSemester', value: '50' }, { key: 'scoreExam', value: '50' }, { key: 'scoreAdmission', value: '25' }];

function stand(settings = []) {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  if (settings.length > 0) store.insertMany('settings', settings);
  seed(store, platform);
  const ctx = { store, platform };
  const tokens = {};
  const call = (action, data, who) => {
    if (!tokens[who]) tokens[who] = handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, ctx).data.token;
    return handleRequest({ action, token: tokens[who], data }, ctx);
  };
  const group = store.list('groups').find((g) => g.name === '02-1');
  const teacherId = (login) => store.list('staff').find((p) => p.login === login).id;
  const subject = store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === group.id && s.teacherId === teacherId('teacher1'));
  const cardNo = (id) => store.list('students').find((s) => s.id === id).cardNo;
  const cardOf = (kind, status) => {
    const found = store.list('repeats').filter((c) => c.kind === kind && c.status === status && c.teacherId === teacherId('teacher1'));
    assert.equal(found.length, 1, `${kind} ${status}`);
    return found[0];
  };
  return { store, platform, call, group, subject, cardNo, cardOf, teacherId };
}

for (const [label, settings] of [['default numbers', []], ['50 / 50 / 25', NUMBERS]]) {
  test(`seedRepeat: four cards in the states open, overdue and passed, the lists of the people (${label})`, () => {
    const { store, call, subject, cardNo, cardOf } = stand(settings);
    const cards = store.list('repeats');
    assert.deepEqual(cards.map((c) => c.status).sort(), ['open', 'open', 'open', 'passed']);
    assert.equal(cards.every((c) => c.orderNo === '12-с' && c.orderDate === addDays(TODAY, -4) && c.createdAt.startsWith(addDays(TODAY, -4))), true);
    assert.equal(cards.filter((c) => c.deadline < TODAY).length, 1);

    const list = (who) => call('repeat.list', {}, who);
    assert.deepEqual(['dean', 'teacher1', 'teacher3', 'teacher2'].map((who) => list(who).data.repeats.length), [4, 3, 1, 0]);
    assert.equal(list('dean').data.repeats.filter((r) => r.overdue).length, 1);

    // the old tables got only what the repeat needs: the final sheet closed, the retakes
    const final = store.list('closures').filter((c) => c.subjectId === subject.id && c.unit === 0);
    assert.equal(final.length, 1);
    assert.equal(final[0].closedAt.startsWith(addDays(TODAY, -9)), true);
    const tries = new Map();
    for (const a of store.list('examAttempts').filter((r) => r.subjectId === subject.id)) tries.set(a.studentId, (tries.get(a.studentId) || 0) + 1);
    assert.deepEqual([...tries.values()].filter((n) => n > 1), [3]);
    assert.equal(store.list('examAttempts').some((a) => a.commission === 'Комиссия Стендовая' && a.no === 3), true);

    // the candidates: by the result of the exam
    const half = call('repeat.candidates', { subjectId: subject.id }, 'dean').data.halves;
    assert.deepEqual(half.map((h) => [h.planSemester, h.current]), [[1, true]]);
    const byNo = new Map(half[0].students.map((s) => [cardNo(s.id), s]));
    const full = cardOf('full', 'open');
    const examCard = cardOf('exam', 'open');
    const passed = cardOf('full', 'passed');
    const overdue = store.list('repeats').find((c) => c.deadline < TODAY);
    for (const card of [full, examCard, overdue]) assert.equal(byNo.get(cardNo(card.studentId)).blocked, 'has_open');
    assert.equal(byNo.has(cardNo(passed.studentId)), false);
    const free = [...byNo.values()].filter((s) => s.blocked === null && s.prev.status === 'done');
    assert.equal(free.length, 1);                                  // the second «неуд.» after one sit
    assert.equal(byNo.get(cardNo(full.studentId)).prev.tries, 3);
    assert.equal(byNo.get(cardNo(full.studentId)).prev.retakesLeft, false);
    assert.equal(byNo.get(cardNo(overdue.studentId)).prev.retakesLeft, true);
    assert.equal([...byNo.values()].some((s) => s.blocked === null && s.prev.status === 'incomplete'), true);

    // the card «весь предмет»: the works, no exam; the card «только экзамен»: preliminary «удовл.»
    const fullView = call('repeat.get', { repeatId: full.id }, 'teacher1').data.repeat;
    assert.deepEqual([fullView.works.value, fullView.works.note, fullView.result.status, fullView.status], [Math.round(fullView.split.semester * 0.75), 'Реферат и две практические работы', 'none', 'open']);
    const exam = call('repeat.get', { repeatId: examCard.id }, 'teacher1').data.repeat;
    assert.deepEqual([exam.result.word, exam.attempts.length, exam.attempts[0].date], ['fair', 1, addDays(TODAY, -2)]);
    assert.equal(call('repeat.get', { repeatId: overdue.id }, 'teacher3').data.repeat.overdue, true);

    // the student sees only his own card
    const mine = (who) => call('repeat.mine', {}, who).data.repeats;
    assert.deepEqual(mine(cardNo(passed.studentId)).map((r) => [r.status, r.word, r.preliminary]), [['passed', 'good', false]]);
    const grades = call('student.grades', {}, cardNo(passed.studentId)).data;
    assert.equal(grades.subjects.find((s) => s.name === 'Информатика').repeat.main, true);
    const own = mine(cardNo(examCard.studentId));
    assert.deepEqual([own[0].word, own[0].preliminary], ['fair', true]);
    const plain = store.list('students').filter((s) => s.groupId === subject.groupId).find((s) => !store.list('repeats').some((c) => c.studentId === s.id));
    assert.equal('repeats' in call('student.grades', {}, plain.cardNo).data, false);
    assert.deepEqual(mine(plain.cardNo), []);
  });

  test(`seedRepeat: the numbers of the half do not change when the semester is switched, and the deanery can enrol one more (${label})`, () => {
    const { store, platform, call, subject } = stand(settings);
    const dean = { id: store.list('staff').find((p) => p.login === 'dean').id, roles: ['dean', 'teacher'] };
    const numbers = () => halfResults(readLedgerRows(store, platform), platform, subject, 1, dean).students
      .map((s) => ({ ...s })).sort((a, b) => a.id.localeCompare(b.id));
    const before = numbers();
    assert.equal(before.length, 22);
    const saved = call('settings.save', { settings: { semesterStart: '2027-01-11', semesterEnd: '2027-05-30', holidays: [], bells: DEFAULT_BELLS, semester: 2 }, extra: { examStart: '2027-05-24', examEnd: '2027-05-30', collegeName: 'Учебный колледж (стенд)' } }, 'dean');
    assert.equal(saved.ok, true, JSON.stringify(saved.error));
    assert.deepEqual(numbers(), before);
    assert.equal(call('repeat.list', {}, 'dean').data.repeats.length, 4);

    const { halves, teachers } = call('repeat.candidates', { subjectId: subject.id }, 'dean').data;
    const free = halves[0].students.find((s) => s.blocked === null && s.prev.status === 'done');
    const res = call('repeat.enrol', {
      subjectId: subject.id, planSemester: 1, studentId: free.id, kind: 'full', orderNo: '13-с', orderDate: TODAY, deadline: addDays(TODAY, 20), teacherId: teachers[0].id,
    }, 'dean');
    assert.equal(res.ok, true, JSON.stringify(res.error));
  });
}

test('seedRepeat: the stand without the repeat courses has no card and the final sheet open', () => {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform, null, { repeats: false });
  assert.deepEqual([store.list('repeats').length, store.list('repeatAttempts').length, store.list('closures').some((c) => c.unit === 0)], [0, 0, false]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { readExtra, readSettings } from '../core/settings.js';
import { addDays, daysBetween } from '../core/dates.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { bishkek } from './journalSetup.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek

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
  const subjectOf = (group, teacher = 'teacher1') => {
    const g = store.list('groups').find((x) => x.name === group);
    const t = store.list('staff').find((x) => x.login === teacher);
    return store.list('subjects').find((s) => s.name === 'Информатика' && s.groupId === g.id && s.teacherId === t.id);
  };
  return { store, platform, call, subjectOf };
}

const NUMBERS = [{ key: 'scoreSemester', value: '50' }, { key: 'scoreExam', value: '50' }, { key: 'scoreAdmission', value: '25' }];

for (const [label, settings] of [['default numbers', []], ['50 / 50 / 25', NUMBERS]]) {
  test(`seedLedger: the closings, requests, announcements and the state exam of the stand (${label})`, () => {
    const { store, call, subjectOf } = stand(settings);
    const first = subjectOf('01-1');
    const second = subjectOf('02-1');
    const live = (subject) => store.list('closures').filter((c) => c.subjectId === subject.id && c.reopenedAt === '');
    assert.deepEqual(live(first).map((c) => c.unit), [1]);
    assert.deepEqual(live(second).map((c) => c.unit).sort(), [1, 2]);
    assert.equal(store.list('closures').some((c) => c.unit === 0), false);
    const teacher1 = store.list('staff').find((p) => p.login === 'teacher1');
    assert.equal(live(first)[0].closedBy, teacher1.id);

    assert.equal(call('ledger.get', { subjectId: first.id }, 'teacher1').data.ledger.units.find((u) => u.unit === 1).closed, true);
    assert.equal(call('ledger.get', { subjectId: first.id }, 'dean').ok, true);
    assert.equal(call('journal.get', { subjectId: first.id }, 'teacher1').ok, true);
    assert.equal(call('journal.get', { subjectId: second.id }, 'dean').ok, true);

    assert.deepEqual(store.list('requests').map((r) => r.status).sort(), ['applied', 'dean', 'prorector', 'rejected']);
    assert.equal(call('request.queue', {}, 'dean').data.waiting, 1);
    assert.equal(call('request.queue', {}, 'prorector').data.waiting, 1);
    const applied = store.list('requests').find((r) => r.status === 'applied');
    assert.equal(store.list('changeLog').some((r) => r.requestId === applied.id), true);

    assert.equal(call('announce.list', {}, 'dean').data.items.length, 3);
    assert.deepEqual(call('announce.list', {}, 'S1001').data.items.map((i) => i.title).sort(), ['Консультация перед рубежным', 'Субботник в пятницу']);
    assert.equal(call('announce.list', {}, 'S3001').data.items.length, 1);

    const extra = readExtra(store.list('settings'));
    const end = readSettings(store.list('settings')).semesterEnd;
    assert.equal(extra.examEnd, end);
    assert.equal(daysBetween(extra.examStart, extra.examEnd) + 1, 7);
    assert.equal(extra.collegeName, 'Учебный колледж (стенд)');

    assert.equal(store.list('stateExams').length, 1);
    const exam = call('stateExam.list', {}, 'dean').data.exams[0];
    assert.deepEqual([exam.groupName, exam.name, exam.date, exam.students, exam.entered], ['03-1', 'Государственный экзамен по специальности', addDays(TODAY, -3), 22, 20]);
    const scores = call('stateExam.get', { examId: exam.id }, 'dean').data.students.map((s) => s.score).filter((v) => v !== null);
    assert.equal(Math.min(...scores), 52);
    assert.equal(Math.max(...scores), 96);
    assert.equal(call('student.grades', {}, 'S3001').data.stateExams.length, 1);
    assert.equal(call('student.grades', {}, 'S1001').data.stateExams.length, 0);
  });

  test(`seedExam: the exam of «Информатика» 02-1 is ready, the retake and the closing work (${label})`, () => {
    const { call, subjectOf, store } = stand(settings);
    const subject = subjectOf('02-1');
    const get = () => call('ledger.get', { subjectId: subject.id }, 'dean').data.ledger;
    const ledger = get();
    assert.equal(ledger.exam.ready, true);
    assert.equal(ledger.exam.date, addDays(TODAY, -3));
    assert.equal(ledger.exam.assistants, 'Ассистент Стендовый');
    const by = (status) => ledger.students.filter((s) => s.status === status);
    const words = by('done').map((s) => s.word).sort();
    assert.deepEqual([...new Set(words)].sort(), ['excellent', 'fail', 'fair', 'good']);
    assert.equal(words.filter((w) => w === 'fail').length, 1);
    assert.deepEqual([by('absent').length, by('incomplete').length, by('none').length], [1, 1, 2]);
    assert.equal(by('not_admitted').length >= 3, true);
    assert.equal(by('not_admitted').some((s) => s.complete === false), true);
    assert.equal(by('not_admitted').filter((s) => s.complete === true).length >= 2, true);
    assert.deepEqual(ledger.final.blocking, [{ code: 'exam_missing', n: 2 }]);
    assert.equal(ledger.final.closed, false);
    assert.equal(call('ledger.get', { subjectId: subject.id }, 'teacher1').data.ledger.units.every((u) => u.closed), true);

    // the stand writes the exam straight into its tables: no line of the exam in the change log
    assert.equal(store.list('changeLog').some((r) => r.entity === 'subjectExam'), false);

    const none = by('none');
    const items = none.map((s, i) => ({ studentId: s.id, outcome: 'score', score: 20 + i }));
    assert.equal(call('ledger.saveExam', { subjectId: subject.id, date: ledger.exam.date, examiner: '', assistants: ledger.exam.assistants, items }, 'dean').ok, true);
    assert.equal(call('ledger.closeFinal', { subjectId: subject.id }, 'dean').data.ledger.final.closed, true);
    const failed = get().students.find((s) => s.word === 'fail');
    const again = call('ledger.addAttempt', { subjectId: subject.id, studentId: failed.id, date: TODAY, outcome: 'score', score: 30, commission: '' }, 'dean');
    assert.equal(again.ok, true, JSON.stringify(again.error));
    assert.equal(get().students.find((s) => s.id === failed.id).attempts.length, 2);
  });
}

test('seedExam: a student of 02-1 sees the semester and the admission and no final before the closing; the first group has no exam rows', () => {
  const { call, subjectOf, store } = stand();
  const grades = call('student.grades', {}, 'S2001').data.subjects.find((s) => s.name === 'Информатика');
  assert.equal(grades.final, null);
  assert.equal(typeof grades.semester, 'number');
  assert.equal(typeof grades.admitted, 'boolean');
  const first = subjectOf('01-1');
  assert.equal(store.list('subjectExams').some((r) => r.subjectId === first.id), false);
  assert.equal(store.list('examAttempts').some((r) => r.subjectId === first.id), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute } from '../site/js/router.js';

const dean = { mustChangePassword: false, permissions: ['dir.list:groups', 'import.apply:groups'] };

test('resolveRoute', () => {
  assert.equal(resolveRoute('#/dir/groups', null).view, 'login');
  assert.equal(resolveRoute('#/dir/groups', { ...dean, mustChangePassword: true }).view, 'changePassword');
  assert.deepEqual(resolveRoute('#/dir/groups', dean), { view: 'directory', params: { table: 'groups' } });
  assert.equal(resolveRoute('#/dir/staff', dean).view, 'home');
  assert.equal(resolveRoute('#/import', dean).view, 'import');
  assert.equal(resolveRoute('#/import', { mustChangePassword: false, permissions: [] }).view, 'home');
  assert.equal(resolveRoute('#/что-то', dean).view, 'home');
});

test('resolveRoute: the semester settings need settings.get; only real directories open as directories', () => {
  const office = { mustChangePassword: false, permissions: ['settings.get', 'dir.list:groups', 'dir.list:topics', 'dir.list:weekTemplate'] };
  assert.deepEqual(resolveRoute('#/settings', office), { view: 'settings', params: {} });
  assert.equal(resolveRoute('#/settings', { mustChangePassword: false, permissions: [] }).view, 'home');
  assert.equal(resolveRoute('#/dir/topics', office).view, 'home');
  assert.equal(resolveRoute('#/dir/weekTemplate', office).view, 'home');
  assert.equal(resolveRoute('#/dir/groups', office).view, 'directory');
});

test('resolveRoute: the week template needs dir.list:weekTemplate', () => {
  const office = { mustChangePassword: false, permissions: ['settings.get', 'dir.list:groups', 'dir.list:weekTemplate'] };
  assert.equal(resolveRoute('#/template', office).view, 'weekTemplate');
  assert.deepEqual(resolveRoute('#/template', office).params, {});
  assert.equal(resolveRoute('#/template', { mustChangePassword: false, permissions: ['settings.get'] }).view, 'home');
});

test('resolveRoute: the week template of a group and its weekday', () => {
  const office = { mustChangePassword: false, permissions: ['dir.list:weekTemplate'] };
  assert.deepEqual(resolveRoute('#/template', office), { view: 'weekTemplate', params: {} });
  assert.deepEqual(resolveRoute('#/template/g_12ab34cd', office), { view: 'weekTemplate', params: { groupId: 'g_12ab34cd' } });
  assert.deepEqual(resolveRoute('#/template/g_12ab34cd/3', office), { view: 'weekTemplate', params: { groupId: 'g_12ab34cd', weekday: 3 } });
  assert.equal(resolveRoute('#/template/g_12ab34cd/6', office).view, 'home');
  assert.equal(resolveRoute('#/template/g_12ab34cd/3/x', office).view, 'home');
  assert.equal(resolveRoute('#/template/g_12ab34cd/3', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'home');
});


test('resolveRoute: the deanery schedule needs schedule.list', () => {
  assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'schedule');
  assert.deepEqual(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.list'] }).params, {});
  assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.mine'] }).view, 'home');
});

test('resolveRoute: my own schedule needs schedule.mine', () => {
  const student = { mustChangePassword: false, permissions: ['schedule.mine'] };
  assert.equal(resolveRoute('#/my', student).view, 'mySchedule');
  assert.equal(resolveRoute('#/my', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'home');
  assert.equal(resolveRoute('#/plan/sb_12ab34cd', student).view, 'home');
});

test('resolveRoute: the syllabus is uploaded on its own page, the import screen has no syllabus mode', () => {
  const teacher = { mustChangePassword: false, permissions: ['syllabus.get', 'syllabus.preview', 'syllabus.apply', 'schedule.mine', 'teacher.mySubjects'] };
  const dean = { mustChangePassword: false, permissions: ['syllabus.get', 'syllabus.preview', 'syllabus.apply', 'import.preview:groups', 'import.apply:groups'] };
  assert.equal(resolveRoute('#/syllabus', teacher).view, 'home');
  assert.equal(resolveRoute('#/import', teacher).view, 'home');                                // общий импорт преподавателю не открывается
  assert.deepEqual(resolveRoute('#/import', dean), { view: 'import', params: {} });
  // the address of a subject's syllabus opens the syllabus page (where the file is uploaded), never the import screen
  assert.deepEqual(resolveRoute('#/syllabus/sb_12ab34cd', dean), { view: 'syllabus', params: { subjectId: 'sb_12ab34cd' } });
  assert.equal(resolveRoute('#/import/sb_12ab34cd', dean).view, 'home');
  assert.equal(resolveRoute('#/syllabus/sb_12ab34cd', { mustChangePassword: false, permissions: ['syllabus.preview', 'syllabus.apply', 'import.apply:groups'] }).view, 'home');
});

test('resolveRoute: the syllabus page of a subject needs syllabus.get; the topics screen and the plan page are gone', () => {
  const viewer = { mustChangePassword: false, permissions: ['syllabus.get'] };
  assert.deepEqual(resolveRoute('#/syllabus/sb_12ab34cd', viewer), { view: 'syllabus', params: { subjectId: 'sb_12ab34cd' } });
  assert.deepEqual(resolveRoute('#/syllabus/sb_12ab34cd/2', viewer), { view: 'syllabus', params: { subjectId: 'sb_12ab34cd', semester: 2 } });
  assert.equal(resolveRoute('#/syllabus/sb_12ab34cd/3', viewer).view, 'home');
  // the new version of the syllabus (the open one) has its own address
  assert.deepEqual(resolveRoute('#/syllabus/sb_1/1/draft', viewer), { view: 'syllabus', params: { subjectId: 'sb_1', semester: 1, version: 'open' } });
  assert.deepEqual(resolveRoute('#/syllabus/sb_1/2/draft', viewer), { view: 'syllabus', params: { subjectId: 'sb_1', semester: 2, version: 'open' } });
  for (const bad of ['#/syllabus/sb_1/draft', '#/syllabus/sb_1/1/open', '#/syllabus/sb_1/1/draft/x']) assert.equal(resolveRoute(bad, viewer).view, 'home', bad);
  assert.equal(resolveRoute('#/syllabus/sb_12ab34cd', { mustChangePassword: false, permissions: ['syllabus.apply'] }).view, 'home');
  for (const old of ['#/topics', '#/topics/sb_1', '#/plan/sb_1']) {
    assert.equal(resolveRoute(old, { mustChangePassword: false, permissions: ['dir.list:topics', 'syllabus.get'] }).view, 'home', old);
  }
});

test('resolveRoute: «Предметы» of the deanery is a screen of its own; «Дисциплины» is a directory, subjects are not', () => {
  const office = { mustChangePassword: false, permissions: ['subjects.overview', 'dir.list:subjects', 'dir.list:disciplines'] };
  assert.deepEqual(resolveRoute('#/subjects', office), { view: 'subjects', params: {} });
  assert.equal(resolveRoute('#/dir/subjects', office).view, 'home');
  assert.deepEqual(resolveRoute('#/dir/disciplines', office), { view: 'directory', params: { table: 'disciplines' } });
  assert.equal(resolveRoute('#/subjects', { mustChangePassword: false, permissions: ['teacher.mySubjects'] }).view, 'home');
});

test('resolveRoute: «Силлабусы на утверждении» (#/review) with the right to the queue, home without it', () => {
  assert.deepEqual(resolveRoute('#/review', { mustChangePassword: false, permissions: ['syllabus.queue', 'subjects.overview'] }), { view: 'review', params: {} });
  assert.equal(resolveRoute('#/review', { mustChangePassword: false, permissions: ['subjects.overview', 'teacher.mySubjects'] }).view, 'home');
  assert.equal(resolveRoute('#/review/x', { mustChangePassword: false, permissions: ['syllabus.queue'] }).view, 'home');
});

test('resolveRoute tolerates an empty hash and a user without permissions', () => {
  assert.deepEqual(resolveRoute('', dean), { view: 'home', params: {} });
  assert.equal(resolveRoute('#/dir/groups', { mustChangePassword: false }).view, 'home');
});

test('resolveRoute: the syllabus form of a version and its tab need syllabus.form', () => {
  const teacher = { mustChangePassword: false, permissions: ['syllabus.get', 'syllabus.form'] };
  assert.deepEqual(resolveRoute('#/syllabus-form/sy_1', teacher), { view: 'syllabusForm', params: { syllabusId: 'sy_1', tab: 'title' } });
  assert.deepEqual(resolveRoute('#/syllabus-form/sy_1/plan', teacher), { view: 'syllabusForm', params: { syllabusId: 'sy_1', tab: 'plan' } });
  assert.deepEqual(resolveRoute('#/syllabus-form/sy_1/grades', teacher), { view: 'syllabusForm', params: { syllabusId: 'sy_1', tab: 'title' } });
  assert.equal(resolveRoute('#/syllabus-form/sy_1', { mustChangePassword: false, permissions: ['syllabus.get'] }).view, 'home');      // студент
  assert.equal(resolveRoute('#/syllabus-form', teacher).view, 'home');
});

test('resolveRoute: the list of journals needs journal.list, a journal of a subject journal.get', () => {
  const teacher = { mustChangePassword: false, permissions: ['journal.list', 'journal.get'] };
  const student = { mustChangePassword: false, permissions: ['schedule.mine', 'syllabus.get'] };
  assert.deepEqual(resolveRoute('#/journal', teacher), { view: 'journalList', params: {} });
  assert.deepEqual(resolveRoute('#/journal/sb_1', teacher), { view: 'journal', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/journal', student).view, 'home');
  assert.equal(resolveRoute('#/journal/sb_1', student).view, 'home');
  assert.equal(resolveRoute('#/journal', { mustChangePassword: false, permissions: ['journal.get'] }).view, 'home');
  assert.equal(resolveRoute('#/journal/sb_1', { mustChangePassword: false, permissions: ['journal.list'] }).view, 'home');
  assert.equal(resolveRoute('#/journal/sb_1/x', teacher).view, 'home');
});

test('resolveRoute: the change log is for the deanery, the admin and the vice-rector; a teacher only reaches the log of a subject', () => {
  const office = { mustChangePassword: false, roles: ['dean'], permissions: ['journal.log', 'journal.list'] };
  const both = { mustChangePassword: false, roles: ['dean', 'teacher'], permissions: ['journal.log'] };
  const teacher = { mustChangePassword: false, roles: ['teacher'], permissions: ['journal.log', 'journal.list'] };
  const student = { mustChangePassword: false, roles: ['student'], permissions: ['schedule.mine'] };
  assert.deepEqual(resolveRoute('#/journal-log', office), { view: 'journalLog', params: {} });
  assert.deepEqual(resolveRoute('#/journal-log', both), { view: 'journalLog', params: {} });
  for (const role of ['admin', 'prorector']) assert.equal(resolveRoute('#/journal-log', { ...office, roles: [role] }).view, 'journalLog', role);
  assert.equal(resolveRoute('#/journal-log', teacher).view, 'home');
  assert.deepEqual(resolveRoute('#/journal-log/sb_1', teacher), { view: 'journalLog', params: { subjectId: 'sb_1' } });
  assert.deepEqual(resolveRoute('#/journal-log/sb_1', office), { view: 'journalLog', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/journal-log', student).view, 'home');
  // a broken escape in the id is «not found», not an exception; a good one is decoded
  assert.equal(resolveRoute('#/journal-log/%E0%A4%A', teacher).view, 'home');
  assert.equal(resolveRoute('#/journal/%E0%A4%A', teacher).view, 'home');
  assert.equal(resolveRoute('#/grades/%', student).view, 'home');
  assert.deepEqual(resolveRoute('#/journal-log/sb%5F1', teacher), { view: 'journalLog', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/journal-log/sb_1', student).view, 'home');
  assert.equal(resolveRoute('#/journal-log/sb_1/x', office).view, 'home');
});

test('resolveRoute: the grades of a student need student.grades', () => {
  const student = { mustChangePassword: false, permissions: ['student.grades', 'schedule.mine'] };
  const staff = { mustChangePassword: false, permissions: ['journal.list', 'journal.get'] };
  assert.deepEqual(resolveRoute('#/grades', student), { view: 'grades', params: {} });
  assert.deepEqual(resolveRoute('#/grades/sb_1', student), { view: 'grades', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/grades/sb_1/x', student).view, 'home');
  assert.equal(resolveRoute('#/grades', staff).view, 'home');
  assert.equal(resolveRoute('#/grades/sb_1', staff).view, 'home');
});

test('resolveRoute: the pair screen needs lesson.get', () => {
  const teacher = { mustChangePassword: false, permissions: ['lesson.get', 'lesson.mine'] };
  assert.deepEqual(resolveRoute('#/lesson/p_1', teacher), { view: 'lesson', params: { pairId: 'p_1' } });
  assert.deepEqual(resolveRoute('#/lesson/p%2F1', teacher), { view: 'lesson', params: { pairId: 'p/1' } });
  assert.equal(resolveRoute('#/lesson/p_1', { mustChangePassword: false, permissions: ['journal.get'] }).view, 'home');
  assert.equal(resolveRoute('#/lesson/%E0%A4%A', teacher).view, 'home');
  assert.equal(resolveRoute('#/lesson/p_1/x', teacher).view, 'home');
});

test('resolveRoute: «#/here» is the check-in of a student; staff go home, a visitor to the sign-in with the address kept', () => {
  const student = { mustChangePassword: false, permissions: ['checkin.mark', 'checkin.current'] };
  assert.deepEqual(resolveRoute('#/here', student), { view: 'checkin', params: {} });
  assert.equal(resolveRoute('#/here/x', student).view, 'home');
  assert.equal(resolveRoute('#/here', { mustChangePassword: false, permissions: ['lesson.get'] }).view, 'home');
  assert.equal(resolveRoute('#/here', null).view, 'login');
  assert.equal(resolveRoute('#/here', { mustChangePassword: true, permissions: ['checkin.mark'] }).view, 'changePassword');
});

test('resolveRoute: the assignments screens', () => {
  const teacher = { mustChangePassword: false, permissions: ['work.overview', 'work.list', 'work.get', 'work.save', 'work.remove'] };
  const student = { mustChangePassword: false, permissions: ['work.mine', 'work.get', 'work.upload'] };
  assert.deepEqual(resolveRoute('#/tasks', teacher), { view: 'tasks', params: {} });
  assert.deepEqual(resolveRoute('#/tasks', student), { view: 'tasks', params: {} });
  assert.equal(resolveRoute('#/tasks', { mustChangePassword: false, permissions: [] }).view, 'home');
  assert.deepEqual(resolveRoute('#/tasks/sb_1', teacher), { view: 'tasks', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/tasks/sb_1', student).view, 'home');
  assert.equal(resolveRoute('#/tasks/sb_1/x', teacher).view, 'home');
  for (const user of [teacher, student]) assert.deepEqual(resolveRoute('#/task/as_1', user), { view: 'task', params: { assignmentId: 'as_1' } });
  assert.equal(resolveRoute('#/task/as_1', { mustChangePassword: false, permissions: [] }).view, 'home');
  assert.equal(resolveRoute('#/task/%E0%A4%A', teacher).view, 'home');
  assert.equal(resolveRoute('#/tasks/%E0%A4%A', teacher).view, 'home');
});

test('resolveRoute: the list of ledgers needs ledger.list, the ledger of a subject ledger.get', () => {
  const teacher = { mustChangePassword: false, permissions: ['ledger.list', 'ledger.get'] };
  const office = { mustChangePassword: false, roles: ['dean'], permissions: ['ledger.list', 'ledger.get', 'journal.list'] };
  const student = { mustChangePassword: false, permissions: ['schedule.mine', 'syllabus.get'] };
  assert.deepEqual(resolveRoute('#/ledger', teacher), { view: 'ledgerList', params: {} });
  assert.deepEqual(resolveRoute('#/ledger', office), { view: 'ledgerList', params: {} });
  assert.deepEqual(resolveRoute('#/ledger/sb_1', teacher), { view: 'ledger', params: { subjectId: 'sb_1' } });
  assert.equal(resolveRoute('#/ledger', student).view, 'home');
  assert.equal(resolveRoute('#/ledger/sb_1', student).view, 'home');
  assert.equal(resolveRoute('#/ledger', { mustChangePassword: false, permissions: ['ledger.get'] }).view, 'home');
  assert.equal(resolveRoute('#/ledger/sb_1', { mustChangePassword: false, permissions: ['ledger.list'] }).view, 'home');
  assert.equal(resolveRoute('#/ledger/%E0%A4%A', teacher).view, 'home');
  assert.equal(resolveRoute('#/ledger/sb_1/x', teacher).view, 'home');
});

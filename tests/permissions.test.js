import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, listPermissions, actionKind } from '../core/permissions.js';

test('can: role-gated table actions', () => {
  assert.equal(can(['dean'], 'dir.save', 'students'), true);
  assert.equal(can(['dean'], 'dir.save', 'staff'), false);
  assert.equal(can(['dean'], 'dir.resetPassword', 'staff'), false);
  assert.equal(can(['dean'], 'dir.resetPassword', 'students'), true);
  assert.equal(can(['admin'], 'dir.resetPassword', 'staff'), true);
  assert.equal(can(['admin'], 'dir.resetPassword', 'groups'), false);
  assert.equal(can(['prorector'], 'dir.list', 'staff'), true);
  assert.equal(can(['prorector'], 'dir.save', 'groups'), false);
  assert.equal(can(['teacher'], 'dir.list', 'students'), false);
  assert.equal(can(['admin'], 'import.apply', 'staff'), true);
  assert.equal(can(['dean'], 'dir.list', 'nope'), false);
  assert.equal(can(['admin'], 'dir.list'), false);
});

test('can: table-less, public and any actions', () => {
  assert.equal(can(['dean', 'teacher'], 'teacher.mySubjects'), true);
  assert.equal(can(['dean'], 'teacher.mySubjects'), false);
  assert.equal(can(['student'], 'auth.me'), true);
  assert.equal(can(['student'], 'user.setLang'), true);
  assert.equal(can([], 'auth.me'), false);
  assert.equal(can([], 'auth.login'), true);
  assert.equal(can([], 'i18n.overrides'), true);
  assert.equal(can(['admin'], 'нет.такого'), false);
  assert.equal(can(undefined, 'auth.login'), true);
});

test('actionKind', () => {
  assert.equal(actionKind('auth.login'), 'public');
  assert.equal(actionKind('auth.me'), 'any');
  assert.equal(actionKind('dir.list'), 'role');
  assert.equal(actionKind('teacher.mySubjects'), 'role');
  assert.equal(actionKind('нет.такого'), null);
  assert.equal(actionKind('toString'), null);
});

test('listPermissions', () => {
  assert.deepEqual(listPermissions(['student']), ['schedule.mine', 'student.subjects', 'syllabus.get']);
  const dean = listPermissions(['dean']);
  assert.ok(dean.includes('import.apply:students'));
  assert.ok(!dean.includes('dir.save:staff'));
  assert.deepEqual(dean, [...dean].sort());
  const both = listPermissions(['dean', 'teacher']);
  assert.ok(both.includes('teacher.mySubjects'));
  assert.equal(new Set(both).size, both.length);
  assert.ok(listPermissions(['admin']).includes('dir.resetPassword:staff'));
  assert.ok(!listPermissions(['admin']).includes('auth.me'));
});

test('can: schedule actions', () => {
  assert.equal(can(['dean'], 'dir.save', 'weekTemplate'), true);
  assert.equal(can(['prorector'], 'dir.save', 'weekTemplate'), false);
  assert.equal(can(['prorector'], 'dir.list', 'weekTemplate'), true);
  assert.equal(can(['teacher'], 'dir.list', 'topics'), false);
  assert.equal(can(['dean'], 'import.apply', 'weekTemplate'), false);
  assert.equal(can(['prorector'], 'schedule.list'), true);
  assert.equal(can(['prorector'], 'schedule.changePair'), false);
  assert.equal(can(['teacher'], 'schedule.changePair'), false);
  assert.equal(can(['teacher'], 'syllabus.get'), true);
  assert.equal(can(['student'], 'schedule.mine'), true);
  assert.equal(can(['student'], 'schedule.list'), false);
  assert.equal(can(['dean'], 'schedule.mine'), false);
  assert.ok(listPermissions(['dean']).includes('settings.save'));
});

test('the syllabus is uploaded by the deanery and the administrator; topics have no directory', () => {
  for (const role of ['admin', 'dean']) assert.equal(can([role], 'syllabus.apply'), true);
  for (const role of ['admin', 'dean']) assert.equal(can([role], 'syllabus.preview'), true);
  for (const role of ['teacher', 'prorector', 'student']) assert.equal(can([role], 'syllabus.apply'), false);
  for (const role of ['teacher', 'prorector', 'student']) assert.equal(can([role], 'syllabus.preview'), false);
  for (const role of ['admin', 'dean', 'teacher']) for (const action of ['dir.list', 'dir.save', 'dir.remove', 'import.apply']) assert.equal(can([role], action, 'topics'), false);
  assert.equal(can(['teacher'], 'dir.save', 'weekTemplate'), false);
  assert.deepEqual(listPermissions(['teacher']),
    ['schedule.mine', 'syllabus.form', 'syllabus.get', 'syllabus.saveSection', 'syllabus.startDraft', 'syllabus.submit', 'teacher.mySubjects']);
  assert.deepEqual(listPermissions(['student']), ['schedule.mine', 'student.subjects', 'syllabus.get']);
  assert.equal(can(['dean'], 'topics.plan'), false);
  assert.equal(can(['student'], 'student.subjects'), true);
  assert.equal(can(['teacher'], 'student.subjects'), false);
  for (const role of ['admin', 'dean', 'prorector', 'teacher', 'student']) assert.equal(can([role], 'syllabus.get'), true);
});

test('disciplines and subjects actions', () => {
  assert.deepEqual([can(['dean'], 'dir.save', 'disciplines'), can(['prorector'], 'dir.list', 'disciplines'), can(['prorector'], 'dir.save', 'disciplines'),
    can(['teacher'], 'dir.list', 'disciplines'), can(['dean'], 'import.apply', 'disciplines')], [true, true, false, false, true]);
  assert.deepEqual([can(['dean'], 'subjects.add'), can(['prorector'], 'subjects.add'), can(['prorector'], 'subjects.overview'), can(['teacher'], 'subjects.overview')], [true, false, true, false]);
});

test('syllabus form actions by role', () => {
  const roles = ['admin', 'dean', 'prorector', 'teacher', 'student'];
  const who = (action) => roles.map((r) => can([r], action));
  for (const action of ['syllabus.startDraft', 'syllabus.saveSection', 'syllabus.submit']) assert.deepEqual(who(action), [true, true, false, true, false], action);
  assert.deepEqual([who('syllabus.form'), who('syllabus.approve'), who('syllabus.return'), who('syllabus.queue')],
    [[true, true, true, true, false], [true, true, false, false, false], [true, true, false, false, false], [true, true, true, false, false]]);
});

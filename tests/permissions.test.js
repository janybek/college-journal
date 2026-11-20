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
  assert.deepEqual(listPermissions(['student']), []);
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

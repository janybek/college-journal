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

test('resolveRoute: the topics screen needs dir.list:topics', () => {
  const office = { mustChangePassword: false, permissions: ['settings.get', 'dir.list:groups', 'dir.list:topics', 'dir.list:weekTemplate'] };
  assert.equal(resolveRoute('#/topics', office).view, 'topics');
  assert.deepEqual(resolveRoute('#/topics', office).params, {});
  assert.equal(resolveRoute('#/topics', { mustChangePassword: false, permissions: ['dir.list:weekTemplate'] }).view, 'home');
});

test('resolveRoute: the deanery schedule needs schedule.list', () => {
  assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'schedule');
  assert.deepEqual(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.list'] }).params, {});
  assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.mine'] }).view, 'home');
});

test('resolveRoute: my own schedule needs schedule.mine; the topic plan of a subject needs topics.plan', () => {
  const student = { mustChangePassword: false, permissions: ['schedule.mine'] };
  assert.equal(resolveRoute('#/my', student).view, 'mySchedule');
  assert.equal(resolveRoute('#/my', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'home');
  assert.deepEqual(resolveRoute('#/plan/sb_12ab34cd', { mustChangePassword: false, permissions: ['topics.plan'] }), { view: 'plan', params: { subjectId: 'sb_12ab34cd' } });
  assert.equal(resolveRoute('#/plan/sb_12ab34cd', student).view, 'home');
});

test('resolveRoute tolerates an empty hash and a user without permissions', () => {
  assert.deepEqual(resolveRoute('', dean), { view: 'home', params: {} });
  assert.equal(resolveRoute('#/dir/groups', { mustChangePassword: false }).view, 'home');
});

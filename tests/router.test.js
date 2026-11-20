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

test('resolveRoute tolerates an empty hash and a user without permissions', () => {
  assert.deepEqual(resolveRoute('', dean), { view: 'home', params: {} });
  assert.equal(resolveRoute('#/dir/groups', { mustChangePassword: false }).view, 'home');
});

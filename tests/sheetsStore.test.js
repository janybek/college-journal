import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA } from '../core/schema.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createSheetsStore, ensureSheets } from '../backend/store/sheetsStore.js';
import { createFakeSpreadsheet } from './fakes/fakeSpreadsheet.js';

const platform = createNodePlatform({ now: () => 1000, secret: 's' });

function groupsSheet() {
  return createFakeSpreadsheet({ 'Группы': [
    ['курс', 'моя заметка', 'id', 'название'],
    [1, 'не трогать', 'g_1', '01-1'],
    ['', '', '', ''],
    [2, 'и эту', 'g_2', 1002],
  ] });
}

test('sheetsStore: reads by header title, skips empty ids, coerces types', () => {
  const s = createSheetsStore(SCHEMA, platform, groupsSheet());
  assert.deepEqual(s.list('groups'), [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '1002', course: 2 }]);
});

test('sheetsStore: update and remove leave foreign columns intact', () => {
  const ss = groupsSheet();
  const s = createSheetsStore(SCHEMA, platform, ss);
  s.update('groups', 'g_2', { name: '02-1' });
  assert.deepEqual(ss.dump('Группы')[3], [2, 'и эту', 'g_2', '02-1']);
  s.remove('groups', 'g_1');
  assert.equal(s.get('groups', 'g_1'), null);
  assert.deepEqual(ss.dump('Группы')[0], ['курс', 'моя заметка', 'id', 'название']);
  assert.throws(() => s.update('groups', 'g_nope', {}), e => e.code === 'not_found');
  assert.throws(() => s.remove('groups', 'g_nope'), e => e.code === 'not_found');
  assert.throws(() => s.list('nope'), e => e.code === 'bad_request');
});

test('sheetsStore: insert and insertMany write only schema columns', () => {
  const ss = groupsSheet();
  const s = createSheetsStore(SCHEMA, platform, ss);
  const g = s.insert('groups', { name: '03-1', course: 3 });
  assert.match(g.id, /^g_[0-9a-f]{8}$/);
  assert.deepEqual(s.get('groups', g.id), g);
  const [a, b] = s.insertMany('groups', [{ name: 'A', course: 1 }, { name: 'B' }]);
  assert.equal(s.get('groups', b.id).course, null);
  const dump = ss.dump('Группы');
  assert.deepEqual(dump[dump.length - 3], [3, '', g.id, '03-1']);
  assert.deepEqual(dump[dump.length - 2], [1, '', a.id, 'A']);
  assert.throws(() => s.insert('groups', { id: 'g_1', name: 'dup' }), e => e.code === 'bad_request');
});

test('sheetsStore: bool reading and writing', () => {
  const ss = createFakeSpreadsheet({ 'Сотрудники': [
    ['id', 'активен', 'сменить пароль', 'логин'],
    ['sf_1', 'TRUE', 'да', 'a'],
    ['sf_2', 'false', 0, 'b'],
    ['sf_3', true, 1, 'c'],
  ] });
  const s = createSheetsStore(SCHEMA, platform, ss);
  assert.deepEqual(s.list('staff').map((r) => [r.active, r.mustChangePassword]),
    [[true, true], [false, false], [true, true]]);
  const r = s.insert('staff', { login: 'd', active: false, mustChangePassword: true });
  assert.deepEqual(ss.dump('Сотрудники')[4], [r.id, false, true, 'd']);
});

test('sheetsStore: int parsing', () => {
  const ss = createFakeSpreadsheet({ 'Группы': [
    ['id', 'название', 'курс'], ['g_1', 'a', '2'], ['g_2', 'b', 'x'], ['g_3', 'c', ''],
  ] });
  const s = createSheetsStore(SCHEMA, platform, ss);
  assert.deepEqual(s.list('groups').map((r) => r.course), [2, null, null]);
});

test('sheetsStore: writes go through withLock; missing sheet is internal error', () => {
  let locked = 0;
  const s = createSheetsStore(SCHEMA, platform, groupsSheet(), (fn) => { locked++; return fn(); });
  s.insert('groups', { name: 'x' });
  s.update('groups', 'g_1', { course: 5 });
  s.remove('groups', 'g_2');
  assert.equal(locked, 3);
  const empty = createSheetsStore(SCHEMA, platform, createFakeSpreadsheet({}));
  assert.throws(() => empty.list('groups'), e => e.code === 'internal');
});

test('ensureSheets: creates sheets, adds missing columns, is repeatable', () => {
  const ss = createFakeSpreadsheet({ 'Группы': [['id', 'название']] });
  const made = ensureSheets(SCHEMA, ss);
  assert.deepEqual(made.addedColumns, ['Группы.курс']);
  assert.equal(made.created.length, 6);
  assert.deepEqual(ss.dump('Группы')[0], ['id', 'название', 'курс']);
  assert.deepEqual(ss.dump('Аудитории')[0], ['id', 'название']);
  assert.deepEqual(ensureSheets(SCHEMA, ss), { created: [], addedColumns: [] });
});

test('fakeSpreadsheet: mimics Apps Script limits', () => {
  const ss = createFakeSpreadsheet({ T: [['a', 'b'], ['c']] });
  const sh = ss.getSheetByName('T');
  assert.deepEqual(sh.getRange(1, 1, 2, 2).getValues(), [['a', 'b'], ['c', '']]);
  assert.throws(() => sh.getRange(1, 1, 1, 2).setValues([['x']]));
  assert.throws(() => sh.getRange(0, 1, 1, 1));
  const empty = ss.insertSheet('E');
  assert.equal(empty.getLastRow(), 0);
  assert.equal(empty.getLastColumn(), 0);
  assert.equal(ss.getSheetByName('nope'), null);
});

test('sheetsStore: insert and insertMany grow a full grid', () => {
  const rows = [['id', 'название', 'курс'], ['g_1', 'a', 1]];
  const mk = () => createFakeSpreadsheet({ 'Группы': rows }, { 'Группы': { maxRows: 4, maxColumns: 3 } });
  const s = createSheetsStore(SCHEMA, platform, mk());
  for (let i = 0; i < 3; i++) s.insert('groups', { name: `n${i}`, course: 1 });
  assert.equal(s.list('groups').length, 4);
  const ss2 = mk();
  const s2 = createSheetsStore(SCHEMA, platform, ss2);
  const many = s2.insertMany('groups', Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, course: 2 })));
  assert.equal(many.length, 5);
  assert.equal(s2.list('groups').length, 6);
  assert.ok(ss2.getSheetByName('Группы').getMaxRows() >= 6);
});

test('fakeSpreadsheet: enforces the grid', () => {
  const ss = createFakeSpreadsheet({ T: [['a'], ['b']] });
  const sh = ss.getSheetByName('T');
  const max = sh.getMaxRows();
  assert.throws(() => sh.getRange(max + 1, 1, 1, 1).setValues([[1]]));
  sh.insertRowsAfter(max, 1);
  sh.getRange(max + 1, 1, 1, 1).setValues([[1]]);
  assert.equal(ss.insertSheet('N').getMaxRows(), 1000);
});

test('ensureSheets keeps strings as text; a bare sheet loses them (fake models Sheets)', () => {
  const ss = createFakeSpreadsheet({});
  ensureSheets(SCHEMA, ss);
  const s = createSheetsStore(SCHEMA, platform, ss);
  const g = s.insert('groups', { name: '01-1', course: 1 });
  const st = s.insert('students', { fullName: 'A', cardNo: '0012', groupId: g.id });
  const [gm] = s.insertMany('groups', [{ name: '2025-09-01', course: 1 }]);
  assert.equal(s.get('students', st.id).cardNo, '0012');
  assert.equal(s.get('groups', g.id).name, '01-1');
  assert.equal(s.get('groups', gm.id).name, '2025-09-01');
  assert.ok(ss.dump('Студенты').flat().includes('0012'));
  assert.equal(ss.getSheetByName('Студенты').getRange(1, 1, 1, 1).getNumberFormat(), '@');

  const bare = createFakeSpreadsheet({ 'Группы': [['id', 'название', 'курс']] });
  createSheetsStore(SCHEMA, platform, bare).insert('groups', { id: 'g_1', name: '0012', course: 1 });
  assert.equal(bare.dump('Группы')[1][1], 12);
});

test('sheetsStore: a Date in a string column reads as YYYY-MM-DD', () => {
  const ss = createFakeSpreadsheet({ 'Группы': [['id', 'название', 'курс'], ['g_1', new Date(Date.UTC(2026, 8, 1)), 1]] });
  assert.equal(createSheetsStore(SCHEMA, platform, ss).list('groups')[0].name, '2026-09-01');
});

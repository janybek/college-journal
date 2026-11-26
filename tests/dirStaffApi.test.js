import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './journalSetup.js';
import { applyLinesUpgrade } from '../backend/linesUpgrade.js';
import { mainLine } from '../core/disciplineSyllabus.js';

const byId = (rows, id) => rows.find((r) => r.id === id);
const codeOf = (r) => (r.ok === false || r.error ? (r.error?.code ?? r.code) : 'ok');
const card = (s, id, token = s.t.dean, extra = {}) => s.call('dir.person', { table: 'staff', id, ...extra }, token).data;

test('dir.people and dir.person of staff: what a teacher leads, unfilled pairs and units', () => {
  const s = setup();
  const { call, t, store, ids } = s;
  const list = call('dir.people', { table: 'staff' }, t.dean).data;
  assert.deepEqual(list.rows.map((r) => r.id), store.list('staff').map((x) => x.id));
  assert.deepEqual(byId(list.rows, ids.teacher1), { id: ids.teacher1, subjects: ['Информатика'], weekPairs: 1 });
  assert.deepEqual(byId(list.rows, ids.teacher3), { id: ids.teacher3, subjects: [], weekPairs: 0 });
  s.at('2026-09-30');
  const c = call('dir.person', { table: 'staff', id: ids.teacher1 }, t.dean).data;
  assert.deepEqual(c.person, { id: ids.teacher1, fullName: 'Иванова Нургуль', roles: ['teacher'], active: true });
  const responsible = mainLine(store.list('syllabusLines'), s.ds1)?.responsibleId === ids.teacher1;
  assert.deepEqual(c.teacher.rows, [{ subjectId: s.sb1, disciplineId: s.ds1, name: 'Информатика', groupId: s.g1, groupName: '01-1', weekPairs: 1,
    syllabus: { approved: true, open: null }, responsible }]);
  assert.deepEqual(c.teacher.unfilledPairs.map((p) => p.date), ['2026-09-29', '2026-09-22']);
  assert.deepEqual(c.teacher.unfilledUnits, [{ subjectId: s.sb1, name: 'Информатика', groupName: '01-1', unit: 1, control: 3, self: 3 },
    { subjectId: s.sb1, name: 'Информатика', groupName: '01-1', unit: 2, control: 3, self: 3 }]);
  assert.deepEqual([c.teacher.weekPairs, c.teacher.hours, c.teacher.subjects, c.teacher.unfilled], [1, 2, 1, 4]);
});

test('the numbers of unit 1 and the closed units', () => {
  const s = setup();
  s.at('2026-09-30');
  s.unitNumbers();
  const unit1 = card(s, s.ids.teacher1).teacher.unfilledUnits.find((u) => u.unit === 1);
  assert.deepEqual([unit1.control, unit1.self], [1, 1]);
  s.closeUnit(1);
  assert.ok(card(s, s.ids.teacher1).teacher.unfilledUnits.every((u) => u.unit !== 1));
  const w = setup();
  w.at('2026-09-22');
  const c = card(w, w.ids.teacher1).teacher;
  assert.deepEqual(c.unfilledUnits.map((u) => [u.unit, u.control, u.self]), [[1, 3, 3]]);
  assert.deepEqual(c.unfilledPairs.map((p) => p.date), ['2026-09-22']);
  const v = setup();
  v.at('2026-09-30');
  v.closeUnit(2);
  assert.deepEqual(card(v, v.ids.teacher1).teacher.unfilledPairs.map((p) => p.date), []);
});

test('the substitute and the week', () => {
  const s = setup();
  s.at('2026-09-30');
  const c = card(s, s.ids.teacher3).teacher;
  assert.deepEqual(c.unfilledPairs.map((p) => p.pairId), [s.p0915]);
  assert.deepEqual([c.rows, c.weekPairs], [[], 0]);
  const w = card(s, s.ids.teacher3, s.t.dean, { from: '2026-09-16' }).teacher;
  assert.deepEqual([w.from, w.to, w.pairs.length], ['2026-09-14', '2026-09-20', 1]);
  assert.deepEqual([w.pairs[0].id, w.pairs[0].substitution, w.pairs[0].groupName, w.pairs[0].subjectName], [s.p0915, true, '01-1', 'Информатика']);
  assert.deepEqual(card(s, s.ids.teacher1, s.t.dean, { from: '2026-09-16' }).teacher.pairs, []);
});

test('cancelled and missed pairs', () => {
  const s = setup();
  s.at('2026-09-30');
  s.store.update('pairs', s.p0922, { status: 'cancelled' });
  const c = card(s, s.ids.teacher1, s.t.dean, { from: '2026-09-21' }).teacher;
  assert.equal(c.pairs.find((p) => p.id === s.p0922).status, 'cancelled');
  assert.ok(!c.unfilledPairs.some((p) => p.pairId === s.p0922));
  s.store.update('pairs', s.p0922, { status: 'missed' });
  assert.ok(!card(s, s.ids.teacher1).teacher.unfilledPairs.some((p) => p.pairId === s.p0922));
});

test('without the teacher role', () => {
  const s = setup();
  s.at('2026-09-30');
  const { ids } = s;
  s.spy.reset();
  const pr = card(s, ids.prorector, s.t.prorector);
  assert.deepEqual(Object.keys(s.spy.lists), ['staff']);
  assert.deepEqual(s.spy.writes, {});
  assert.deepEqual([pr.person.roles, pr.teacher, pr.semester], [['prorector'], null, null]);
  const ad = card(s, ids.admin);
  assert.deepEqual([ad.person.roles, ad.teacher], [['admin'], null]);
  const dn = card(s, ids.dean);
  assert.deepEqual(dn.person.roles, ['dean', 'teacher']);
  assert.deepEqual([dn.teacher.weekPairs, dn.teacher.rows, dn.teacher.unfilledPairs, dn.teacher.unfilledUnits], [0, [], [], []]);
});

test('a draft is not seen by the pro-rector', () => {
  const s = setup();
  s.at('2026-09-30');
  s.store.insert('syllabi', { disciplineId: s.ds2, teacherId: s.ids.teacher2, semester: 1, planSemester: 1, status: 'draft', version: 1 });
  applyLinesUpgrade(s.store, s.platform);
  assert.deepEqual(card(s, s.ids.teacher2).teacher.rows[0].syllabus, { approved: false, open: 'draft' });
  assert.deepEqual(card(s, s.ids.teacher2, s.t.prorector).teacher.rows[0].syllabus, { approved: false, open: null });
});

test('rights and bad input', () => {
  const s = setup();
  s.at('2026-09-30');
  const { call, t, ids } = s;
  const ok = { table: 'staff', id: ids.teacher1 };
  for (const action of ['dir.people', 'dir.person']) {
    assert.equal(codeOf(call(action, ok, t.a1)), 'forbidden');
    assert.equal(codeOf(call(action, ok, t.teacher1)), 'forbidden');
    assert.equal(codeOf(call(action, ok, undefined)), 'unauthorized');
    for (const who of [t.dean, t.prorector, t.admin]) assert.equal(codeOf(call(action, ok, who)), 'ok');
  }
  assert.equal(codeOf(call('dir.person', { table: 'staff', id: s.a1 }, t.dean)), 'not_found');
  for (const id of [[ids.teacher1], 5, {}, null, '']) assert.equal(codeOf(call('dir.person', { table: 'staff', id }, t.dean)), 'bad_request');
  for (const id of ['  ', ' ' + ids.teacher1, '__proto__', 'constructor', 'st_none']) assert.equal(codeOf(call('dir.person', { table: 'staff', id }, t.dean)), 'not_found');
  for (const from of ['2026-13-01', 5, '', null]) assert.equal(codeOf(call('dir.person', { ...ok, from }, t.dean)), 'bad_request');
  const row = { id: ids.teacher1, fullName: 'x', login: 'teacher1', roles: 'teacher' };
  assert.equal(codeOf(call('dir.save', { table: 'staff', row }, t.dean)), 'forbidden');
  assert.equal(codeOf(call('dir.save', { table: 'staff', row }, t.prorector)), 'forbidden');
  assert.equal(codeOf(call('dir.save', { table: 'staff', row }, t.admin)), 'ok');
});

test('no foreign data and nothing written', () => {
  const s = setup();
  s.at('2026-09-30');
  const list = s.call('dir.people', { table: 'staff' }, s.t.dean).data;
  for (const row of list.rows) assert.deepEqual(Object.keys(row).sort(), ['id', 'subjects', 'weekPairs']);
  const text = JSON.stringify(list) + JSON.stringify(card(s, s.ids.teacher1)) + JSON.stringify(card(s, s.ids.teacher3));
  for (const word of ['passwordHash', 'mustChangePassword', 'lang', 'login', 'tempPassword', 'Асанов Айдар', 'Өмүров Канат']) assert.ok(!text.includes(word), word);
  const before = structuredClone(s.snapshot());
  for (const [action, data] of [['dir.people', { table: 'staff' }], ['dir.person', { table: 'staff', id: s.ids.teacher1 }]]) {
    s.spy.reset();
    assert.equal(s.call(action, data, s.t.dean).ok, true);
    assert.deepEqual(s.spy.writes, {});
    assert.ok(Object.values(s.spy.lists).every((n) => n === 1), JSON.stringify(s.spy.lists));
  }
  assert.deepEqual(s.snapshot(), before);
  const old = s.call('dir.list', { table: 'staff' }, s.t.dean).data;
  assert.ok(JSON.stringify(old).includes('Иванова Нургуль') && !JSON.stringify(old).includes('passwordHash'));
});

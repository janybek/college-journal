import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, bishkek } from './journalSetup.js';
import { DEFAULT_BELLS, extraToRows } from '../core/settings.js';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { compareNames } from '../core/names.js';
import { SCHEMA } from '../core/schema.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';

const byId = (rows, id) => rows.find((r) => r.id === id);

// three rooms; the rows of the week template and all pairs of sb1 / sb2 get rooms
function rooms(s) {
  const { store } = s;
  const rA = store.insert('rooms', { name: 'А-204' }).id;
  const rB = store.insert('rooms', { name: 'Б-101' }).id;
  const rC = store.insert('rooms', { name: 'В-305' }).id;
  for (const row of store.list('weekTemplate')) store.update('weekTemplate', row.id, { roomId: row.subjectId === s.sb1 ? rA : rB });
  store.insert('weekTemplate', { weekday: 4, slot: 2, subjectId: s.sb1, roomId: rA });
  store.updateMany('pairs', store.list('pairs').map((p) => ({ id: p.id, patch: { roomId: p.subjectId === s.sb1 ? rA : rB } })));
  return { rA, rB, rC };
}

const CALLS = (s, r) => [
  ['dir.summary', { table: 'groups' }], ['dir.summary', { table: 'rooms' }], ['dir.summary', { table: 'disciplines' }],
  ['dir.card', { table: 'groups', id: s.g1 }], ['dir.card', { table: 'rooms', id: r.rA }], ['dir.card', { table: 'disciplines', id: s.ds1 }],
];

test('dir.summary: groups and rooms right now', () => {
  const s = setup();
  const { call, t, g1, g2 } = s;
  const { rA, rC } = rooms(s);
  s.at('2026-09-15', '08:30');
  const g = call('dir.summary', { table: 'groups' }, t.dean).data;
  assert.deepEqual([g.today, g.time, g.term], ['2026-09-15', '08:30', 'on']);
  assert.deepEqual([g.semesterStart, g.semesterEnd], ['2026-09-01', '2026-12-20']);
  assert.deepEqual(byId(g.rows, g1), { id: g1, students: 3, inactive: 1, disciplines: ['Информатика'], weekPairs: 2,
    now: { state: 'busy', until: '09:30', roomName: 'А-204', subjectName: 'Информатика' } });
  assert.deepEqual(byId(g.rows, g2).now, { state: 'none' });
  const r = call('dir.summary', { table: 'rooms' }, t.dean).data;
  assert.deepEqual(byId(r.rows, rA), { id: rA, weekPairs: 2, top: { disciplineName: 'Информатика', groupNames: ['01-1'] },
    now: { state: 'busy', until: '09:30', groupName: '01-1', subjectName: 'Информатика' } });
  assert.deepEqual(byId(r.rows, rC), { id: rC, weekPairs: 0, top: null, now: { state: 'freeDay' } });
});

test('dir.summary: next, done, another day', () => {
  const s = setup();
  const { call, t, g1 } = s;
  const { rA } = rooms(s);
  const look = (date, time) => {
    s.at(date, time);
    return [byId(call('dir.summary', { table: 'groups' }, t.dean).data.rows, g1).now, byId(call('dir.summary', { table: 'rooms' }, t.dean).data.rows, rA).now];
  };
  assert.deepEqual(look('2026-09-15', '07:30'), [{ state: 'next', at: '08:00', roomName: 'А-204', subjectName: 'Информатика' }, { state: 'free', until: '08:00' }]);
  assert.deepEqual(look('2026-09-15', '09:30'), [{ state: 'done' }, { state: 'freeRest' }]);
  assert.deepEqual(look('2026-09-16', '12:00'), [{ state: 'none' }, { state: 'freeDay' }]);
});

test('dir.summary and dir.card: a cancelled pair is not "now" but stays in the week', () => {
  const s = setup();
  const { call, t, g1 } = s;
  const { rA } = rooms(s);
  s.store.update('pairs', s.p0922, { status: 'cancelled' });
  s.at('2026-09-22', '08:30');
  assert.deepEqual(byId(call('dir.summary', { table: 'groups' }, t.dean).data.rows, g1).now, { state: 'none' });
  assert.deepEqual(byId(call('dir.summary', { table: 'rooms' }, t.dean).data.rows, rA).now, { state: 'freeDay' });
  const card = call('dir.card', { table: 'rooms', id: rA, from: '2026-09-21' }, t.dean).data;
  assert.equal(card.pairs.find((p) => p.id === s.p0922).status, 'cancelled');
});

test('Saturday move: busy now, moved in the card', () => {
  const s = setup();
  const { call, t, g2 } = s;
  const { rB } = rooms(s);
  const q0918 = s.pairOf(s.sb2, '2026-09-18').id;
  s.store.update('pairs', q0918, { date: '2026-09-19', slot: 2, startTime: '09:40' });
  s.at('2026-09-19', '10:00');
  const g = call('dir.summary', { table: 'groups' }, t.dean).data;
  assert.deepEqual(byId(g.rows, g2).now, { state: 'busy', until: '11:10', roomName: 'Б-101', subjectName: 'Анатомия' });
  const card = call('dir.card', { table: 'rooms', id: rB, from: '2026-09-16' }, t.dean).data;
  assert.equal(card.from, '2026-09-14');
  assert.equal(card.to, '2026-09-20');
  const moved = card.pairs.find((p) => p.date === '2026-09-19');
  assert.equal(moved.moved, true);
  assert.equal(moved.planDate, '2026-09-18');
  assert.equal(moved.endTime, '11:10');
});

test('the term of the semester', () => {
  const s = setup();
  const { call, t, store } = s;
  rooms(s);
  const term = () => call('dir.summary', { table: 'groups' }, t.dean).data.term;
  s.at('2026-08-31'); assert.equal(term(), 'before');
  s.at('2026-12-21'); assert.equal(term(), 'after');
  store.insertMany('settings', extraToRows({ examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: '' }));
  s.at('2026-12-15'); assert.equal(term(), 'exam');
  s.at('2026-09-15', '08:30');
  store.removeMany('pairs', store.list('pairs').map((p) => p.id));
  const g = call('dir.summary', { table: 'groups' }, t.dean).data;
  assert.equal(g.term, 'none');
  for (const row of g.rows) assert.deepEqual(row.now, { state: 'none' });
});

test('dir.summary and dir.card of disciplines', () => {
  const s = setup();
  const { call, t, ids, ds1, ds2, store } = s;
  rooms(s);
  s.at('2026-09-15', '08:30');
  const d = call('dir.summary', { table: 'disciplines' }, t.dean).data;
  assert.equal(d.currentSemester, 1);
  assert.deepEqual(byId(d.rows, ds1), { id: ds1, teachers: [{ teacherId: ids.teacher1, teacherName: 'Иванова Нургуль', groupNames: ['01-1'] }],
    syllabi: { approved: 1, review: 0, returned: 0, draft: 0, none: 0 } });
  assert.deepEqual(byId(d.rows, ds2).syllabi, { approved: 0, review: 0, returned: 0, draft: 0, none: 1 });
  store.insert('syllabi', { disciplineId: ds2, teacherId: ids.teacher2, semester: 1, planSemester: 1, status: 'draft', version: 1 });
  assert.deepEqual(byId(call('dir.summary', { table: 'disciplines' }, t.dean).data.rows, ds2).syllabi, { approved: 0, review: 0, returned: 0, draft: 1, none: 0 });
  assert.deepEqual(byId(call('dir.summary', { table: 'disciplines' }, t.prorector).data.rows, ds2).syllabi, { approved: 0, review: 0, returned: 0, draft: 0, none: 1 });
  const card2 = call('dir.card', { table: 'disciplines', id: ds2 }, t.prorector).data;
  assert.deepEqual(card2.rows[0].syllabus, { approved: false, open: null });
  const card1 = call('dir.card', { table: 'disciplines', id: ds1 }, t.dean).data;
  assert.equal(card1.currentSemester, 1);
  assert.deepEqual(card1.discipline, { id: ds1, name: 'Информатика' });
  assert.deepEqual(card1.rows, [{ subjectId: s.sb1, groupId: s.g1, groupName: '01-1', teacherId: ids.teacher1, teacherName: 'Иванова Нургуль',
    syllabus: { approved: true, open: null }, weekPairs: 2 }]);
});

test('dir.card of a group', () => {
  const s = setup();
  const { call, t, ids, g1, ds1, sb1, store } = s;
  rooms(s);
  s.at('2026-09-15', '08:30');
  const c = call('dir.card', { table: 'groups', id: g1 }, t.dean).data;
  assert.deepEqual(c.group, { id: g1, name: '01-1', course: 1 });
  assert.deepEqual(c.counts, { students: 3, inactive: 1, subjects: 1, weekPairs: 2, repeats: 0 });
  assert.deepEqual(c.now, { state: 'busy', until: '09:30', roomName: 'А-204', subjectName: 'Информатика' });
  assert.deepEqual(c.subjects, [{ subjectId: sb1, disciplineId: ds1, disciplineName: 'Информатика', teacherId: ids.teacher1, teacherName: 'Иванова Нургуль',
    syllabus: { approved: true, open: null }, weekPairs: 2 }]);
  assert.equal(c.students.length, 3);
  for (const st of c.students) assert.deepEqual(Object.keys(st).sort(), ['cardNo', 'fullName', 'id']);
  assert.deepEqual(c.students.map((st) => st.fullName), c.students.map((st) => st.fullName).sort(compareNames));
  assert.ok(!c.students.some((st) => st.id === ids.a4));
  const json = JSON.stringify(c);
  for (const bad of ['passwordHash', 'mustChangePassword', 'lang', 'Яковлев Улан']) assert.ok(!json.includes(bad), bad);
  s.repeatCard();
  assert.equal(call('dir.card', { table: 'groups', id: g1 }, t.dean).data.counts.repeats, 1);
  s.repeatCard({ status: 'passed' });
  s.repeatCard({ studentId: ids.a1, status: 'cancelled' });
  assert.equal(call('dir.card', { table: 'groups', id: g1 }, t.dean).data.counts.repeats, 1);
  assert.equal(store.list('repeats').length, 3);
});

test('dir.card of a room', () => {
  const s = setup();
  const { call, t } = s;
  const { rA } = rooms(s);
  s.at('2026-09-15', '08:30');
  const c = call('dir.card', { table: 'rooms', id: rA, from: '2026-09-16' }, t.dean).data;
  assert.deepEqual(c.room, { id: rA, name: 'А-204' });
  assert.equal(c.weekPairs, 2);
  assert.deepEqual(c.bells, DEFAULT_BELLS);
  assert.deepEqual(c.exam, { start: '', end: '' });
  assert.deepEqual(c.holidays, []);
  assert.equal(c.from, '2026-09-14');
  assert.equal(c.pairs.length, 1);
  const p = c.pairs[0];
  assert.equal(p.id, s.p0915);
  assert.equal(p.substitution, true);
  assert.equal(p.teacherName, 'Сидорова Алина');
  assert.deepEqual(Object.keys(p).sort(), ['date', 'endTime', 'groupId', 'groupName', 'id', 'moved', 'planDate', 'planSlot', 'slot', 'startTime', 'status', 'subjectName', 'substitution', 'teacherName'].sort());
  // from is read as a Monday and defaults to the Monday of today
  assert.equal(call('dir.card', { table: 'rooms', id: rA }, t.dean).data.from, '2026-09-14');
});

test('rights and hostile input', () => {
  const s = setup();
  const { call, t } = s;
  const r = rooms(s);
  s.at('2026-09-15', '08:30');
  for (const [action, data] of CALLS(s, r)) {
    assert.equal(call(action, data, t.a1).error.code, 'forbidden', `${action} student`);
    assert.equal(call(action, data, t.teacher1).error.code, 'forbidden', `${action} teacher`);
    assert.equal(call(action, data).error.code, 'unauthorized', `${action} no token`);
    assert.equal(call(action, data, t.dean).ok, true, `${action} dean`);
    assert.equal(call(action, data, t.prorector).ok, true, `${action} prorector`);
    assert.equal(call(action, data, t.admin).ok, true, `${action} admin`);
  }
  for (const action of ['dir.summary', 'dir.card']) {
    for (const table of ['students', 'staff', 'subjects', 'weekTemplate', 'syllabi', '', '__proto__', 'constructor', 5, null, ['groups'], { x: 1 }, undefined]) {
      const res = call(action, { table, id: s.g1 }, t.dean);
      assert.equal(res.error.code, 'forbidden', `${action} ${JSON.stringify(table)}`);
    }
    assert.equal(call(action, {}, t.dean).error.code, 'forbidden');
  }
  for (const id of [undefined, '', 5, null, ['x'], { id: 'x' }, '__proto__', 'constructor', 'nope', ' ']) {
    const res = call('dir.card', { table: 'groups', id }, t.dean);
    assert.ok(['bad_request', 'not_found'].includes(res.error.code), `${JSON.stringify(id)} ${res.error.code}`);
    assert.equal(res.error.code, typeof id === 'string' && id !== '' ? 'not_found' : 'bad_request');
  }
  for (const from of ['2026-13-01', 5, '', null, 'x']) {
    assert.equal(call('dir.card', { table: 'rooms', id: r.rA, from }, t.dean).error.code, 'bad_request', JSON.stringify(from));
  }
  assert.equal(call('dir.card', { table: 'groups', id: s.g1, from: 'junk' }, t.dean).ok, true);
  assert.equal(call('dir.card', { table: 'disciplines', id: s.ds1, from: 5 }, t.dean).ok, true);
  assert.equal(call('dir.remove', { table: 'rooms', id: r.rC }, t.dean).ok, true);
  assert.equal(call('dir.card', { table: 'rooms', id: r.rC }, t.dean).error.code, 'not_found');
});

test('nothing is written, each table is read once', () => {
  const s = setup();
  const { call, t, store, spy } = s;
  const r = rooms(s);
  s.running(s.p0915, '2026-09-15 08:05:00');
  s.at('2026-09-15', '08:30');
  const all = () => ({ ...s.snapshot(), ...Object.fromEntries(['groups', 'students', 'staff', 'rooms', 'disciplines', 'subjects', 'weekTemplate', 'syllabi', 'topics'].map((n) => [n, JSON.parse(JSON.stringify(store.list(n)))])) });
  for (const [action, data] of CALLS(s, r)) {
    const before = all();
    spy.reset();
    const res = call(action, data, t.dean);
    assert.equal(res.ok, true);
    assert.deepEqual(all(), before, action);
    assert.deepEqual(spy.writes, {}, action);
    for (const [name, n] of Object.entries(spy.lists)) assert.equal(n, 1, `${action} ${name}`);
  }
});

test('disciplines do not read the pairs sheet', () => {
  const s = setup();
  const { call, t, spy } = s;
  rooms(s);
  for (const [action, data] of [['dir.summary', { table: 'disciplines' }], ['dir.card', { table: 'disciplines', id: s.ds1 }]]) {
    spy.reset();
    assert.equal(call(action, data, t.dean).ok, true, action);
    assert.equal(spy.lists.pairs, undefined, action);
  }
});

test('the old answers do not change', () => {
  const s = setup();
  const { call, t, store } = s;
  rooms(s);
  for (const table of ['groups', 'rooms', 'disciplines']) {
    assert.deepEqual(call('dir.list', { table }, t.dean).data, { rows: store.list(table) });
  }
  assert.equal(call('dir.save', { table: 'groups', row: { id: s.g1, name: 'x', course: 1 } }, t.prorector).error.code, 'forbidden');
});

test('the stand: numbers and speed', () => {
  const platform = createNodePlatform({ now: () => bishkek('2026-11-18', '12:00'), secret: 'test-secret' });
  const store = createMemoryStore(SCHEMA, platform);
  seed(store, platform);
  const lists = {};
  const spied = {};
  for (const name of Object.keys(store)) {
    spied[name] = (...args) => { if (name === 'list') lists[args[0]] = (lists[args[0]] || 0) + 1; return store[name](...args); };
  }
  const ctx = { store: spied, platform };
  const tokens = {};
  const call = (action, data, who) => {
    if (!tokens[who]) tokens[who] = handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, ctx).data.token;
    return handleRequest({ action, token: tokens[who], data }, ctx);
  };
  call('auth.me', {}, 'dean');
  call('auth.me', {}, 'prorector');   // sign in beforehand: the sign-in reads the sheets too
  const g02 = store.list('groups').find((g) => g.name === '02-1').id;
  const room = (name) => store.list('rooms').find((x) => x.name === name).id;
  const disc = (name) => store.list('disciplines').find((x) => x.name === name).id;
  const timed = (action, data, who = 'dean') => {
    for (const k of Object.keys(lists)) delete lists[k];
    const t0 = performance.now();
    const res = call(action, data, who);
    assert.ok(performance.now() - t0 < 1000, `${action} slow`);
    assert.equal(res.ok, true, action);
    for (const [name, n] of Object.entries(lists)) assert.equal(n, 1, `${action} ${name}`);
    return res.data;
  };
  const g = timed('dir.summary', { table: 'groups' });
  const row = byId(g.rows, g02);
  assert.deepEqual([row.students, row.inactive, row.weekPairs, row.disciplines], [22, 0, 3, ['Анатомия', 'Информатика']]);
  assert.equal(timed('dir.card', { table: 'groups', id: g02 }).counts.repeats, 3);
  const r = timed('dir.summary', { table: 'rooms' });
  const r101 = byId(r.rows, room('101'));
  assert.equal(r101.weekPairs, 6);
  assert.deepEqual(r101.top, { disciplineName: 'Анатомия', groupNames: ['01-1', '02-1', '03-1'] });
  assert.deepEqual(r101.now, { state: 'busy', until: '12:50', groupName: '03-1', subjectName: 'Анатомия' });
  assert.equal(byId(r.rows, room('204')).weekPairs, 3);
  assert.deepEqual(byId(r.rows, room('204')).now, { state: 'freeDay' });
  assert.equal(byId(r.rows, room('305')).weekPairs, 0);
  assert.equal(byId(r.rows, room('305')).top, null);
  timed('dir.card', { table: 'rooms', id: room('101') });
  const d = timed('dir.summary', { table: 'disciplines' });
  assert.deepEqual(byId(d.rows, disc('Информатика')).syllabi, { approved: 1, review: 0, returned: 1, draft: 1, none: 0 });
  assert.deepEqual(byId(d.rows, disc('Анатомия')).syllabi, { approved: 0, review: 1, returned: 0, draft: 0, none: 0 });
  const dp = timed('dir.summary', { table: 'disciplines' }, 'prorector');
  assert.deepEqual(byId(dp.rows, disc('Информатика')).syllabi, { approved: 1, review: 0, returned: 1, draft: 0, none: 1 });
  timed('dir.card', { table: 'disciplines', id: disc('Информатика') });
});

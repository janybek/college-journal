import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNodePlatform } from '../backend/platform/nodePlatform.js';
import { createMemoryStore } from '../backend/store/memoryStore.js';
import { handleRequest } from '../backend/api.js';
import { SCHEMA } from '../core/schema.js';
import { seed, DEV_PASSWORD } from '../dev/seed.js';
import { bishkek } from './journalSetup.js';

const TODAY = '2026-11-18';   // a Wednesday, 12:00 in Bishkek

function stand(options) {
  const platform = createNodePlatform({ now: () => bishkek(TODAY, '12:00'), secret: 'test-secret' });
  const memory = createMemoryStore(SCHEMA, platform);
  seed(memory, platform, null, options);
  // a spy over every method of the store: the reads per table, the gets and the writes
  const spy = { lists: {}, gets: 0, writes: 0 };
  const store = new Proxy(memory, {
    get(target, name) {
      const f = target[name];
      if (typeof f !== 'function') return f;
      return (...args) => {
        if (name === 'list') spy.lists[args[0]] = (spy.lists[args[0]] || 0) + 1;
        else if (name === 'get') spy.gets += 1;
        else spy.writes += 1;
        return f.apply(target, args);
      };
    },
  });
  const ctx = { store, platform };
  const tokens = {};
  const login = (who) => {
    if (!tokens[who]) tokens[who] = handleRequest({ action: 'auth.login', data: { login: who, password: DEV_PASSWORD } }, ctx).data.token;
    return tokens[who];
  };
  Object.values(['dean', 'teacher2']).forEach(login);
  const timed = (action, data, who = 'dean') => {
    const token = login(who);
    spy.lists = {}; spy.gets = 0; spy.writes = 0;
    const t0 = performance.now();
    const r = handleRequest({ action, token, data }, ctx);
    const ms = performance.now() - t0;
    assert.equal(r.ok, true, action);
    assert.ok(ms < 1000, `${action} took ${Math.round(ms)} ms`);
    for (const [table, n] of Object.entries(spy.lists)) assert.equal(n, 1, `${action} reads ${table} ${n} times`);
    assert.ok(spy.gets <= 1, `${action} gets ${spy.gets}`);
    assert.equal(spy.writes, 0, `${action} wrote`);
    return r.data;
  };
  const group = (name) => memory.list('groups').find((g) => g.name === name).id;
  const student = (no) => memory.list('students').find((x) => x.cardNo === no).id;
  const staff = (login) => memory.list('staff').find((x) => x.login === login).id;
  return { store: memory, timed, group, student, staff };
}

const s = stand({ progress: true });
const byId = (rows, id) => rows.find((r) => r.id === id);

test('the students at risk and the debts of the stand', () => {
  const list = s.timed('dir.people', { table: 'students' }).rows;
  assert.deepEqual([byId(list, s.student('S3001')).risk, byId(list, s.student('S3002')).risk, byId(list, s.student('S1001')).risk], [1, 1, 0]);

  const a = s.timed('dir.person', { table: 'students', id: s.student('S3001') });
  assert.deepEqual(a.subjects.map((x) => x.name), ['Анатомия', 'Информатика', 'Физиология']);
  assert.deepEqual(a.subjects.map((x) => x.state), ['going', 'risk', 'going']);
  const subjectId = a.debts[0].subjectId;
  assert.deepEqual(a.debts, [{ name: 'Информатика', groupName: '03-1', planSemester: 2, state: 'fail', total: 47, repeat: 'open', subjectId }]);
  assert.equal(a.totals.repeats, 1);

  const b = s.timed('dir.person', { table: 'students', id: s.student('S3002') });
  assert.equal(b.debts.length, 1);
  assert.deepEqual([b.debts[0].state, b.debts[0].total, b.debts[0].repeat], ['notAdmitted', null, null]);
  assert.deepEqual(s.timed('dir.person', { table: 'students', id: s.student('S3003') }).debts, []);
});

test('the progress of the groups and of the discipline', () => {
  const names = new Map(s.store.list('subjects').map((x) => [x.id, x.name]));
  const sub = (data, name) => data.subjects.find((x) => names.get(x.subjectId) === name);
  const g3 = s.timed('dir.progress', { table: 'groups', id: s.group('03-1') });
  assert.equal(sub(g3, 'Информатика').counts.risk, 2);
  assert.equal(g3.totals.risk, 2);
  const g2 = s.timed('dir.progress', { table: 'groups', id: s.group('02-1') });
  assert.deepEqual(sub(g2, 'Информатика').counts, { risk: 0, fail: 3, notAdmitted: 3, absent: 1, incomplete: 1 });
  assert.equal(sub(g2, 'Анатомия').inHalf, true);
  assert.deepEqual(sub(g2, 'Анатомия').counts, { risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 });
  assert.equal(sub(g2, 'Биология').inHalf, false);
  assert.equal(sub(s.timed('dir.progress', { table: 'groups', id: s.group('01-1') }), 'Химия').inHalf, false);
  const dId = s.store.list('disciplines').find((d) => d.name === 'Информатика').id;
  assert.deepEqual(s.timed('dir.progress', { table: 'disciplines', id: dId }).units, [
    { unit: 1, groups: 3, closedGroups: 2, average: 78 }, { unit: 2, groups: 3, closedGroups: 1, average: 70 }]);
});

test('the staff: what they lead, the unfilled pairs and units', () => {
  const list = s.timed('dir.people', { table: 'staff' }).rows;
  const of = (login) => { const r = byId(list, s.staff(login)); return [r.subjects, r.weekPairs]; };
  assert.deepEqual(of('teacher1'), [['Информатика', 'Латинский язык'], 2]);
  assert.deepEqual(of('teacher2'), [['Анатомия', 'Физиология', 'Химия'], 7]);
  assert.deepEqual(of('teacher3'), [['Биология', 'Информатика', 'Физиология'], 2]);
  for (const login of ['dean', 'prorector', 'admin']) assert.deepEqual(of(login), [[], 0]);

  const t2 = s.timed('dir.person', { table: 'staff', id: s.staff('teacher2') }).teacher;
  assert.deepEqual(t2.unfilledPairs.map((p) => [p.date, p.groupName]), [['2026-11-18', '02-1'], ['2026-11-18', '01-1'], ['2026-11-12', '02-1']]);
  const sid = t2.unfilledUnits[0].subjectId;
  assert.deepEqual(t2.unfilledUnits, [{ name: 'Физиология', groupName: '01-1', unit: 1, control: 22, self: 22, subjectId: sid }]);
  const t3 = s.timed('dir.person', { table: 'staff', id: s.staff('teacher3') }).teacher;
  assert.deepEqual(t3.unfilledPairs, []);
  assert.deepEqual(t3.unfilledUnits.map((u) => [u.name, u.groupName, u.unit, u.control, u.self]), [['Информатика', '03-1', 1, 20, 20], ['Физиология', '03-1', 1, 22, 22]]);
  assert.equal(s.timed('dir.person', { table: 'staff', id: s.staff('prorector') }).teacher, null);
});

test('without progress the stand is as before', () => {
  const plain = stand();
  assert.equal(plain.store.list('unitResults').some((r) => r.planSemester === 2), false);
  assert.equal(plain.store.list('repeats').length, 4);
});

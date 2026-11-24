import { test } from 'node:test';
import assert from 'node:assert/strict';

// Shared checks run against every store (memory, file, sheets). makeStore() -> empty store over SCHEMA.
export function storeContract(name, makeStore) {
  test(`${name}: basic contract`, () => {
    const s = makeStore();
    const g = s.insert('groups', { name: '01-1', course: 1 });
    assert.match(g.id, /^g_[0-9a-f]{8}$/);
    assert.deepEqual(s.get('groups', g.id), g);
    s.list('groups')[0].name = 'x';
    assert.equal(s.get('groups', g.id).name, '01-1');
    assert.equal(s.update('groups', g.id, { course: 2 }).course, 2);
    s.remove('groups', g.id);
    assert.equal(s.get('groups', g.id), null);
    assert.throws(() => s.update('groups', 'g_nope', {}), e => e.code === 'not_found');
    assert.throws(() => s.remove('groups', 'g_nope'), e => e.code === 'not_found');
    assert.throws(() => s.list('nope'), e => e.code === 'bad_request');
  });

  test(`${name}: insertMany, caller ids, collisions`, () => {
    const s = makeStore();
    const rows = s.insertMany('rooms', [{ name: 'A' }, { name: 'B' }]);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.equal(s.insert('rooms', { id: 'r_custom', name: 'C' }).id, 'r_custom');
    assert.throws(() => s.insert('rooms', { id: 'r_custom', name: 'D' }), e => e.code === 'bad_request');
    assert.equal(s.list('rooms').length, 3);
  });

  test(`${name}: insert copies the input and update keeps id`, () => {
    const s = makeStore();
    const input = { name: 'A' };
    const r = s.insert('rooms', input);
    input.name = 'changed';
    assert.equal(s.get('rooms', r.id).name, 'A');
    assert.equal(s.update('rooms', r.id, { id: 'other', name: 'B' }).id, r.id);
  });

  test(`${name}: rows have the same shape in every store`, () => {
    const s = makeStore();
    const st = s.insert('students', { fullName: ' Асанов А ', cardNo: 1002, groupId: 'g_1', junk: 'x' });
    assert.deepEqual(st, { id: st.id, fullName: 'Асанов А', groupId: 'g_1', cardNo: '1002', passwordHash: '',
      lang: '', mustChangePassword: false, active: false });
    assert.deepEqual(s.get('students', st.id), st);
    assert.deepEqual(s.update('students', st.id, { active: 'да', lang: undefined, nope: 1 }), { ...st, active: true });
    assert.equal(s.insert('groups', { name: '01-1', course: '2' }).course, 2);
    assert.equal(s.insert('groups', { name: '01-2', course: 'два' }).course, null);
  });

  test(`${name}: a key set to null or undefined in a patch clears the field`, () => {
    const s = makeStore();
    const st = s.insert('students', { fullName: 'A', lang: 'ru', active: true });
    assert.equal(s.update('students', st.id, { lang: null }).lang, '');
    assert.equal(s.update('students', st.id, { active: undefined }).active, false);
    const g = s.insert('groups', { name: 'G', course: 3 });
    assert.equal(s.update('groups', g.id, { course: null }).course, null);
  });

  test(`${name}: updateMany and removeMany`, () => {
    const s = makeStore();
    const [a, b, c] = s.insertMany('rooms', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    assert.deepEqual(s.updateMany('rooms', [{ id: c.id, patch: { name: 'C2' } }, { id: a.id, patch: { name: 'A2' } }]).map(r => r.name), ['C2', 'A2']);
    assert.throws(() => s.updateMany('rooms', [{ id: b.id, patch: { name: 'B2' } }, { id: 'r_nope', patch: {} }]), e => e.code === 'not_found');
    assert.equal(s.get('rooms', b.id).name, 'B');
    assert.throws(() => s.removeMany('rooms', [b.id, 'r_nope']), e => e.code === 'not_found');
    assert.equal(s.list('rooms').length, 3);
    s.removeMany('rooms', [a.id, a.id, c.id]);
    assert.deepEqual(s.list('rooms').map(r => r.name), ['B']);
    assert.deepEqual(s.updateMany('rooms', []), []);
    s.removeMany('rooms', []);
    assert.throws(() => s.removeMany('nope', []), e => e.code === 'bad_request');
  });

  test(`${name}: the tables of the repeat course keep ints and bools`, () => {
    const s = makeStore();
    const card = s.insert('repeats', { studentId: 'st_1', subjectId: 'sb_1', planSemester: '1', kind: 'full', prevAdmitted: true, prevExam: 20, works: null, status: 'open' });
    assert.match(card.id, /^rp_[0-9a-f]{8}$/);
    assert.deepEqual([card.planSemester, card.prevAdmitted, card.prevExam, card.works, card.prevWord], [1, true, 20, null, '']);
    const attempt = s.insert('repeatAttempts', { repeatId: card.id, no: 1, date: '2027-01-15', outcome: 'score', score: 30 });
    assert.match(attempt.id, /^rx_[0-9a-f]{8}$/);
    assert.deepEqual(s.get('repeatAttempts', attempt.id), { id: attempt.id, repeatId: card.id, no: 1, date: '2027-01-15', outcome: 'score', score: 30, commission: '', updatedBy: '', updatedAt: '' });
    assert.equal(s.update('repeats', card.id, { works: 45 }).works, 45);
    assert.equal(s.list('repeats').length, 1);
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_TABLES } from '../backend/journalData.js';
import { setup } from './journalSetup.js';

const snapshotOf = (s) => JSON.stringify(['attendance', 'unitResults', 'changeLog', 'pairs'].map((table) => s.store.list(table)));

// a foreign subject sb3 (group 02-1, teacher2) with a control result and change log rows of its own
function withForeignSubject(s) {
  const { store, ids, b1, g2, ds2 } = s;
  const sb3 = store.insert('subjects', { name: 'Физиология', disciplineId: ds2, groupId: g2, teacherId: ids.teacher2, scheme: 'A' }).id;
  store.insert('unitResults', { subjectId: sb3, studentId: b1, planSemester: 1, unit: 1, control: 30, self: null, currentManual: null, updatedBy: ids.teacher2, updatedAt: '2026-09-20 10:00:00' });
  store.insert('changeLog', { at: '2026-09-20 10:00:00', actorId: ids.teacher2, entity: 'unit', subjectId: sb3, studentId: b1, unit: 1, field: 'control', before: '20', after: '30', reason: 'x', late: false });
  store.insert('changeLog', { at: '2026-09-21 10:00:00', actorId: ids.teacher2, entity: 'mark', subjectId: sb3, pairId: s.q0904, studentId: b1, field: 'status', before: 'absent', after: 'present', reason: 'y', late: true });
  return sb3;
}

test('journal.saveResults: control, self and manual current points', () => {
  const s = setup();
  const { call, t, at, store, spy, a1, a2, a3, b1, sb1, sb2 } = s;
  at('2026-09-30', '12:00');
  const sb3 = withForeignSubject(s);
  const foreignRows = () => JSON.stringify([store.list('unitResults').filter((x) => x.subjectId === sb3), store.list('changeLog').filter((x) => x.subjectId === sb3)]);
  const save = (field, items, extra = {}, token = t.teacher1, unit = 1) => call('journal.saveResults', { subjectId: sb1, unit, field, items, ...extra }, token);
  const journal = (token) => call('journal.get', { subjectId: sb1 }, token).data.journal;
  const mine = () => store.list('changeLog').filter((x) => x.subjectId === sb1);
  const foreign = foreignRows();
  const logBefore = mine().length;

  // control: the first value needs no reason; the change log has the rows
  const r = save('control', [{ studentId: a1, value: 30 }, { studentId: a2, value: 20 }]);
  assert.equal(r.ok, true);
  assert.deepEqual([r.data.journal.results[a1].units[0].control, r.data.journal.results[a2].units[0].controlLow], [30, true]);
  assert.deepEqual(mine().map((x) => [x.entity, x.field, x.unit, x.before, x.after, x.reason]), [['unit', 'control', 1, '', '30', ''], ['unit', 'control', 1, '', '20', '']]);
  // a saved value changes only with a reason
  assert.deepEqual(save('control', [{ studentId: a1, value: 35 }]).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(save('control', [{ studentId: a1, value: 35 }], { reason: 'пересдача' }).ok, true);
  assert.equal(save('control', [{ studentId: a1, value: 35 }], { reason: 'пересдача' }).ok, true);
  assert.equal(mine().length - logBefore, 3);
  assert.equal(store.list('unitResults').filter((x) => x.studentId === a1 && x.subjectId === sb1).length, 1);
  // self-work and the total of the unit
  save('self', [{ studentId: a1, value: 16 }]);
  const unit = journal(t.teacher1).results[a1].units[0];
  assert.equal(unit.total, unit.current + 16 + 35);
  // manual current: a reason always; remove with null
  assert.deepEqual(save('current', [{ studentId: a1, value: 30 }]).error.fields, [{ field: 'reason', code: 'required' }]);
  save('current', [{ studentId: a1, value: 30 }], { reason: 'работа на конференции' });
  assert.deepEqual([journal(t.teacher1).results[a1].units[0].manual, journal(t.teacher1).results[a1].units[0].current], [30, 30]);
  save('current', [{ studentId: a1, value: null }], { reason: 'ошибка' });
  assert.equal(journal(t.teacher1).results[a1].units[0].manual, null);
  assert.equal(store.list('unitResults').find((x) => x.studentId === a1 && x.subjectId === sb1).currentManual, null);

  // limits and foreign things: nothing is written
  const before = snapshotOf(s);
  assert.deepEqual(save('control', [{ studentId: a1, value: 41 }], { reason: 'x' }).error.fields, [{ index: 0, field: 'value', code: 'bad_value' }]);
  assert.deepEqual(save('self', [{ studentId: a1, value: 21 }], { reason: 'x' }).error.fields, [{ index: 0, field: 'value', code: 'bad_value' }]);
  assert.deepEqual(save('control', [{ studentId: b1, value: 30 }]).error.fields, [{ index: 0, field: 'studentId', code: 'bad_ref' }]);
  assert.deepEqual(save('control', [{ studentId: a1, value: 30 }], {}, t.teacher1, 7).error.fields, [{ field: 'unit', code: 'bad_value' }]);
  assert.equal(save('штраф', [{ studentId: a1, value: 1 }]).error.code, 'bad_request');
  for (const token of [t.teacher2, t.teacher3, t.prorector, t.a1]) assert.equal(save('control', [{ studentId: a2, value: 30 }], { reason: 'x' }, token).error.code, 'forbidden');
  assert.deepEqual(save('control', [{ studentId: a2, value: 30 }], {}, t.dean).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.equal(call('journal.saveResults', { subjectId: sb2, unit: 1, field: 'control', items: [{ studentId: b1, value: 30 }] }, t.teacher2).error.code, 'no_syllabus');
  for (const bad of [[sb1], 5, ` ${sb1} `]) assert.equal(call('journal.saveResults', { subjectId: bad, unit: 1, field: 'control', items: [{ studentId: a1, value: 1 }] }, t.dean).error.code, 'not_found');
  for (const bad of [[a1], 5, { id: a1 }]) assert.equal(save('control', [{ studentId: bad, value: 30 }]).error.code, 'bad_request');
  for (const items of ['x', [], [null], [5], [{ studentId: a1, value: 1 }, { studentId: a1, value: 2 }], Array.from({ length: 201 }, () => ({ studentId: a1, value: 1 }))]) assert.equal(save('control', items).error.code, 'bad_request');
  assert.deepEqual(save('control', [{ studentId: a1, value: 'x' }], { reason: 'x' }).error.fields, [{ index: 0, field: 'value', code: 'bad_value' }]);
  assert.deepEqual(save('control', [{ studentId: a1, value: 36 }], { reason: '   ' }).error.fields, [{ field: 'reason', code: 'required' }]);
  assert.deepEqual(save('control', [{ studentId: a1, value: 36 }], { reason: 'я'.repeat(301) }).error.fields, [{ field: 'reason', code: 'too_long' }]);
  assert.equal(snapshotOf(s), before);
  // the rows of the foreign subject are not touched by a save in sb1
  assert.equal(save('self', [{ studentId: a3, value: 5 }]).ok, true);
  assert.equal(foreignRows(), foreign);
  assert.equal(JSON.stringify(journal(t.teacher1)).includes(b1), false);

  // the dean sets a value with a reason; a no-change save writes nothing
  assert.equal(save('control', [{ studentId: a2, value: 25 }], { reason: 'деканат' }, t.dean).ok, true);
  const same = snapshotOf(s);
  assert.equal(save('control', [{ studentId: a2, value: 25 }], { reason: 'деканат' }, t.dean).ok, true);
  assert.equal(snapshotOf(s), same);

  // each table is read once, each batch written once
  spy.reset();
  save('self', [{ studentId: a2, value: 12 }, { studentId: a3, value: 14 }], { reason: 'уточнение' });
  for (const table of JOURNAL_TABLES) assert.equal(spy.lists[table], 1, table);
  assert.equal(spy.lists.changeLog ?? 0, 0);
  assert.deepEqual([spy.writes['insertMany:unitResults'] ?? 0, spy.writes['updateMany:unitResults'] ?? 0, spy.writes['insertMany:changeLog']].map((n) => n <= 1), [true, true, true]);
  assert.equal(Object.keys(spy.writes).some((k) => k.startsWith('update:') || k.startsWith('insert:') || k.startsWith('remove:')), false);
});

test('journal.log: reading the change log', () => {
  const s = setup();
  const { call, t, at, sb1, sb2, a1, p0901 } = s;
  at('2026-09-30', '12:00');
  const sb3 = withForeignSubject(s);
  call('journal.saveResults', { subjectId: sb1, unit: 1, field: 'control', items: [{ studentId: a1, value: 30 }] }, t.teacher1);
  call('journal.saveResults', { subjectId: sb1, unit: 1, field: 'control', items: [{ studentId: a1, value: 31 }], reason: 'пересдача' }, t.teacher1);
  const log = call('journal.log', { subjectId: sb1 }, t.teacher1).data;
  assert.deepEqual(Object.keys(log.rows[0]).sort(), ['actorName', 'after', 'at', 'before', 'entity', 'field', 'groupName', 'id', 'late', 'pairDate', 'pairId', 'pairSlot', 'reason', 'studentId', 'studentName', 'subjectId', 'subjectName', 'unit']);
  assert.equal(log.rows.length, 2);
  assert.equal(log.rows[0].at >= log.rows.at(-1).at, true);
  assert.equal(log.rows[0].actorName, 'Иванова Нургуль');
  assert.equal(log.rows[0].studentName, 'Асанов Айдар');
  assert.equal(log.rows[0].groupName, '01-1');
  assert.equal(log.rows.every((x) => x.subjectId === sb1), true);
  assert.equal(JSON.stringify(log).includes(sb3), false);
  assert.equal(JSON.stringify(log).includes('Беков'), false);
  // foreign rows are visible to a manager and a reader, with pair data
  const all = call('journal.log', {}, t.dean).data;
  const markRow = all.rows.find((x) => x.entity === 'mark');
  assert.deepEqual([markRow.pairDate, markRow.pairSlot, markRow.subjectName, markRow.late], ['2026-09-04', 1, 'Физиология', true]);
  assert.equal(all.rows.length, 4);
  assert.equal(call('journal.log', { subjectId: sb3, from: '2026-09-21', to: '2026-09-21' }, t.dean).data.rows.length, 1);
  assert.equal(call('journal.log', { pairId: s.q0904 }, t.dean).data.rows.length, 1);
  assert.equal(call('journal.log', { studentId: a1 }, t.dean).data.rows.length, 2);
  // rights
  assert.equal(call('journal.log', {}, t.teacher1).error.code, 'forbidden');
  assert.equal(call('journal.log', { subjectId: sb2 }, t.teacher1).error.code, 'forbidden');
  assert.equal(call('journal.log', { subjectId: sb1 }, t.teacher3).error.code, 'forbidden');
  assert.equal(call('journal.log', { subjectId: sb1 }, t.a1).error.code, 'forbidden');
  assert.equal(call('journal.log', {}, t.a1).error.code, 'forbidden');
  assert.equal(call('journal.log', {}, t.prorector).ok, true);
  assert.equal(call('journal.log', { limit: 1 }, t.dean).data.more, true);
  assert.equal(call('journal.log', { limit: 1 }, t.dean).data.rows.length, 1);
  assert.equal(call('journal.log', { limit: 4 }, t.dean).data.more, false);
  for (const bad of [0, 501, 1.5, '5']) assert.equal(call('journal.log', { limit: bad }, t.dean).error.code, 'bad_request');
  assert.equal(call('journal.log', { from: '2026-13-01' }, t.dean).error.code, 'bad_request');
  assert.equal(call('journal.log', { to: 5 }, t.dean).error.code, 'bad_request');
  for (const bad of [[p0901], 7, { id: p0901 }]) assert.equal(call('journal.log', { pairId: bad }, t.dean).error.code, 'bad_request');
  for (const bad of [[a1], 7]) assert.equal(call('journal.log', { studentId: bad }, t.dean).error.code, 'bad_request');
  for (const bad of [[sb1], 7]) assert.equal(call('journal.log', { subjectId: bad }, t.dean).error.code, 'bad_request');
  assert.equal(call('journal.log', {}, t.dean).data.today, call('journal.list', {}, t.dean).data.today);
  assert.equal(JSON.stringify(log).includes('passwordHash'), false);
  assert.equal(JSON.stringify(all).includes('passwordHash'), false);
  // one read of each table
  s.spy.reset();
  call('journal.log', {}, t.dean);
  for (const table of ['changeLog', 'staff', 'students', 'subjects', 'groups', 'pairs']) assert.equal(s.spy.lists[table], 1, table);
});

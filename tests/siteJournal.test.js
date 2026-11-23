import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRows, listBadges, journalColumns, cellView, pairHead, draftMarks, changedMarks, activityAllowed, coatAllowed, canMark, pairHint, lateOptions, logLine, pairScore, parsePoints, resultItems, needsReason, savedResult, pairActions, unitLine, absenceList, pointsText } from '../site/js/journal.js';

test('listRows: a teacher sees only their own subjects and those where they covered pairs; the office sees all', () => {
  assert.deepEqual(listRows([{ own: true }, { own: false, covers: true }, { own: false, covers: false }], 'teacher').length, 2);
  assert.deepEqual(listRows([{ own: true }, { own: false, covers: false }], 'dean').length, 2);
  assert.deepEqual(listRows([{ own: false, covers: false }], 'prorector').length, 1);
  assert.deepEqual(listRows(undefined, 'teacher'), []);
});

test('listBadges: the pairs not filled in yet, then the overdue ones; nothing when all is filled in', () => {
  assert.deepEqual(listBadges({ unfilled: 3, overdue: 1 }), [
    { tone: 'warning', key: 'journal.list.unfilled', params: { n: 2 } },
    { tone: 'danger', key: 'journal.list.overdue', params: { n: 1 } },
  ]);
  assert.deepEqual([listBadges({ unfilled: 0, overdue: 0 }), listBadges({ unfilled: 1, overdue: 1 }).map((b) => b.tone)], [[], ['danger']]);
  assert.deepEqual(listBadges({ unfilled: 2, overdue: 0 }), [{ tone: 'warning', key: 'journal.list.unfilled', params: { n: 2 } }]);
});

const P = (id, unit, status = 'closed') => ({ id, unit, status, date: '2026-09-0' + id.slice(1), lessonType: 'lecture', state: 'late' });
const J = { partial: false, pairs: [P('p1', 1), P('p2', 1), P('p3', 2), P('p4', null)], units: [{ unit: 1, title: '' }, { unit: 2, title: '' }, { unit: 3, title: '' }] };
const name = (c) => (c.type === 'pair' ? c.pair.id : c.type === 'unit' ? `u${c.unit}.${c.field}` : c.type === 'summary' ? c.field : c.type);

test('journalColumns: the four columns of a unit stand after its last pair; units without pairs, «outside» and the summary at the end', () => {
  assert.deepEqual(journalColumns(J).map(name),
    ['p1', 'p2', 'u1.current', 'u1.self', 'u1.control', 'u1.total', 'p3', 'u2.current', 'u2.self', 'u2.control', 'u2.total', 'p4',
      'u3.current', 'u3.self', 'u3.control', 'u3.total', 'outside', 'absences', 'percent', 'preliminary']);
});

test('journalColumns: a partial journal has only pairs; no «outside» column without held pairs outside units', () => {
  assert.deepEqual(journalColumns({ ...J, partial: true, units: [] }).map((c) => c.type), ['pair', 'pair', 'pair', 'pair']);
  assert.ok(!journalColumns({ ...J, pairs: [P('p4', null, 'planned')] }).some((c) => c.type === 'outside'));
});

test('cellView and pairHead: the mark of a cell and the head of a pair', () => {
  assert.deepEqual(cellView({ status: 'late', noCoat: true, activity: 5 }, {}), { key: 'journal.short.late', tone: 'warning', activity: 5, noCoat: true });
  assert.equal(cellView(null, {}), null);
  assert.equal(cellView({ status: 'absent' }, {}).tone, 'danger');
  assert.deepEqual(pairHead({ lessonType: 'control', status: 'planned', state: 'late' }), { kindKey: 'journal.kind.control', stateKey: 'journal.state.overdue' });
  assert.deepEqual(pairHead({ lessonType: 'practice', status: 'planned', state: 'open' }), { kindKey: 'journal.kind.practice', stateKey: 'journal.state.unfilled' });
  assert.deepEqual(pairHead({ lessonType: '', status: 'closed', state: 'open' }), { kindKey: 'journal.kind.none', stateKey: null });
  assert.equal(pairHead({ lessonType: 'lecture', status: 'cancelled', state: 'cancelled' }).stateKey, 'journal.state.cancelled');
  assert.equal(pairHead({ lessonType: 'lecture', status: 'missed', state: 'missed' }).stateKey, 'journal.state.missed');
  assert.equal(pairHead({ lessonType: 'lecture', status: 'planned', state: 'future' }).stateKey, 'journal.state.future');
});

// ---- Task 19: the marks of a pair ----

const MJ = {
  pairs: [{ id: 'a', status: 'planned' }, { id: 'b', status: 'closed' }],
  students: [{ id: 's1', fullName: 'Асанов Аман', left: false }, { id: 's2', fullName: 'Бекова Бермет', left: false }, { id: 's3', fullName: 'Выбыл Студент', left: true }],
  marks: { b: { s1: { status: 'late', noCoat: true, activity: 3 }, s2: { status: 'absent', noCoat: false, activity: null }, s3: { status: 'present', noCoat: false, activity: null } } },
};

test('draftMarks: an unfilled pair starts with everybody present; a held pair with the saved marks; students who left are not on the list', () => {
  assert.deepEqual(draftMarks(MJ, 'a'), [
    { studentId: 's1', fullName: 'Асанов Аман', status: 'present', noCoat: false, activity: null },
    { studentId: 's2', fullName: 'Бекова Бермет', status: 'present', noCoat: false, activity: null },
  ]);
  assert.deepEqual(draftMarks(MJ, 'b').map((m) => [m.studentId, m.status, m.noCoat, m.activity]), [['s1', 'late', true, 3], ['s2', 'absent', false, null]]);
});

test('changedMarks: all marks of an unfilled pair; only the changed ones of a held pair', () => {
  assert.equal(changedMarks(draftMarks(MJ, 'a'), MJ, 'a').length, 2);
  assert.deepEqual(changedMarks(draftMarks(MJ, 'b'), MJ, 'b'), []);
  const draft = draftMarks(MJ, 'b');
  draft[0].activity = 5;
  assert.deepEqual(changedMarks(draft, MJ, 'b'), [{ studentId: 's1', status: 'late', noCoat: true, activity: 5 }]);
});

test('activityAllowed and coatAllowed follow the rules of the server', () => {
  assert.equal(activityAllowed('absent', {}), false);
  assert.equal(activityAllowed('excused', {}), false);
  assert.equal(activityAllowed('present', { first: true }), false);
  assert.equal(activityAllowed('present', { lessonType: 'control' }), false);
  assert.equal(activityAllowed('late', { lessonType: 'practice' }), true);
  assert.equal(activityAllowed('madeup', {}), true);
  assert.equal(coatAllowed({ lessonType: 'lecture' }), false);
  assert.equal(coatAllowed({ lessonType: 'practice' }), true);
  assert.equal(coatAllowed({ lessonType: '' }), true);
});

test('canMark and pairHint: only free and reason heads open; the others say why', () => {
  assert.equal(canMark({ mode: 'free' }), true);
  assert.equal(canMark({ mode: 'reason' }), true);
  assert.equal(canMark({ mode: 'limited' }), false);
  assert.equal(canMark({ mode: 'none' }), false);
  assert.equal(pairHint({ mode: 'none', state: 'future', status: 'planned' }), 'journal.marks.notBegun');
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'teacher'), 'journal.marks.termPassed');
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'prorector'), null);
  assert.equal(pairHint({ mode: 'none', state: 'late', status: 'planned' }, 'dean'), null);
  assert.equal(pairHint({ mode: 'none', state: 'future', status: 'planned' }, 'prorector'), 'journal.marks.notBegun');
  assert.equal(pairHint({ mode: 'limited', state: 'late', status: 'closed' }), null);
  assert.equal(pairHint({ mode: 'free', state: 'open', status: 'planned' }), null);
});

// ---- The window of a cell (task 20) ----

test('lateOptions: after the term only «excused» and «madeup» for a student who was absent, «madeup» for an excused one', () => {
  assert.deepEqual(lateOptions({ status: 'absent' }), ['excused', 'madeup']);
  assert.deepEqual(lateOptions({ status: 'excused' }), ['madeup']);
  assert.deepEqual(lateOptions({ status: 'present' }), []);
  assert.deepEqual(lateOptions({ status: 'madeup' }), []);
  assert.deepEqual(lateOptions(null), []);
  assert.deepEqual(lateOptions(undefined), []);
});

test('logLine: a line of the history with the dictionary key, its numbers and the values that are keys themselves', () => {
  assert.deepEqual(logLine({ entity: 'mark', field: 'status', before: 'absent', after: 'madeup' }),
    { key: 'journal.log.mark.status', params: { before: 'journal.marks.status.absent', after: 'journal.marks.status.madeup' }, keyParams: ['before', 'after'] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'status', before: '', after: 'late' }),
    { key: 'journal.log.mark.statusSet', params: { after: 'journal.marks.status.late' }, keyParams: ['after'] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'noCoat', before: 'no', after: 'yes' }), { key: 'journal.log.mark.noCoatOn', params: {}, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'noCoat', before: 'yes', after: 'no' }), { key: 'journal.log.mark.noCoatOff', params: {}, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'activity', before: '', after: '8' }), { key: 'journal.log.mark.activitySet', params: { after: '8' }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'activity', before: '3', after: '8' }), { key: 'journal.log.mark.activity', params: { before: '3', after: '8' }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'activity', before: '3', after: '' }),
    { key: 'journal.log.mark.cleared', params: { what: 'journal.log.field.activity' }, keyParams: ['what'] });
  assert.deepEqual(logLine({ entity: 'unit', field: 'control', unit: 2, before: '', after: '17' }),
    { key: 'journal.log.unit', params: { what: 'journal.log.field.control', unit: 2, before: '—', after: '17' }, keyParams: ['what'] });
  assert.deepEqual(logLine({ entity: 'unit', field: 'current', unit: 1, before: '20', after: '' }).params, { what: 'journal.log.field.current', unit: 1, before: '20', after: '—' });
  assert.deepEqual(logLine({ entity: 'pair', field: 'status', before: 'closed', after: 'missed' }),
    { key: 'journal.log.pair.status', params: { before: 'journal.log.pairStatus.closed', after: 'journal.log.pairStatus.missed' }, keyParams: ['before', 'after'] });
  assert.deepEqual(logLine({ entity: 'x', field: 'y', before: 'a', after: 'b' }), { key: 'journal.log.other', params: { field: 'y', before: 'a', after: 'b' }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'mark', field: 'status', before: 'weird', after: 'absent' }).params, { before: 'weird', after: 'journal.marks.status.absent' });
  assert.deepEqual(logLine(null).key, 'journal.log.other');
});

test('pairScore: the points of a student for a pair as the server counts them; nothing for excused, control and unmarked', () => {
  const scheme = { attendance: 10, activity: 20 };
  const pair = { status: 'closed', lessonType: 'lecture', first: false };
  assert.deepEqual(pairScore({ status: 'present', activity: 17 }, pair, scheme), { earned: 27, possible: 30 });
  assert.deepEqual(pairScore({ status: 'late', activity: null }, pair, scheme), { earned: 10, possible: 30 });
  assert.deepEqual(pairScore({ status: 'absent', activity: null }, pair, scheme), { earned: 0, possible: 30 });
  assert.deepEqual(pairScore({ status: 'present', activity: 9 }, { ...pair, first: true }, scheme), { earned: 10, possible: 10 });
  assert.equal(pairScore({ status: 'excused' }, pair, scheme), null);
  assert.equal(pairScore({ status: 'present' }, { ...pair, lessonType: 'control' }, scheme), null);
  assert.equal(pairScore({ status: 'present' }, { ...pair, status: 'planned' }, scheme), null);
  assert.equal(pairScore(null, pair, scheme), null);
});

const RJ = { results: {
  a: { units: [{ unit: 1, control: 30, self: null, manual: null }] },
  b: { units: [{ unit: 1, control: null, self: 12, manual: 20 }] },
  c: { units: [] },
} };

test('parsePoints: empty is not set, whole numbers up to the maximum, anything else is an error', () => {
  assert.equal(parsePoints('', 40), null);
  assert.equal(parsePoints('  ', 40), null);
  assert.equal(parsePoints('0', 40), 0);
  assert.equal(parsePoints('40', 40), 40);
  assert.equal(parsePoints(' 30 ', 40), 30);
  assert.equal(parsePoints('41', 40), undefined);
  assert.equal(parsePoints('3,5', 40), undefined);
  assert.equal(parsePoints('3.5', 40), undefined);
  assert.equal(parsePoints('-1', 40), undefined);
  assert.equal(parsePoints('abc', 40), undefined);
});

test('resultItems: only the changed students; an empty field over a saved value gives null', () => {
  assert.equal(savedResult(RJ, 'a', 1, 'control'), 30);
  assert.equal(savedResult(RJ, 'b', 1, 'current'), 20);
  assert.equal(savedResult(RJ, 'c', 1, 'control'), null);
  const draft = new Map([['a', 30], ['b', 5], ['c', null]]);
  assert.deepEqual(resultItems(draft, RJ, 1, 'control'), [{ studentId: 'b', value: 5 }]);
  assert.deepEqual(resultItems(new Map([['a', null], ['c', 7]]), RJ, 1, 'control'), [{ studentId: 'a', value: null }, { studentId: 'c', value: 7 }]);
});

test('needsReason: the first value of the own teacher needs none; a change, the office and the manual current always do', () => {
  assert.equal(needsReason([{ studentId: 'c', value: 7 }], RJ, 1, 'control', true), false);
  assert.equal(needsReason([{ studentId: 'c', value: 7 }, { studentId: 'a', value: 31 }], RJ, 1, 'control', true), true);
  assert.equal(needsReason([{ studentId: 'c', value: 7 }], RJ, 1, 'control', false), true);
  assert.equal(needsReason([{ studentId: 'c', value: 7 }], RJ, 1, 'current', true), true);
});

test('pairActions: the deanery actions on a pair by its status and state; none without can.manage', () => {
  const can = { manage: true };
  assert.deepEqual(pairActions({ status: 'planned', state: 'open' }, can), ['miss']);
  assert.deepEqual(pairActions({ status: 'planned', state: 'late' }, can), ['miss']);
  assert.deepEqual(pairActions({ status: 'planned', state: 'future' }, can), []);
  assert.deepEqual(pairActions({ status: 'missed', state: 'missed' }, can), ['reopen']);
  assert.deepEqual(pairActions({ status: 'closed', state: 'open' }, can), ['clear']);
  assert.deepEqual(pairActions({ status: 'cancelled', state: 'cancelled' }, can), []);
  assert.deepEqual(pairActions({ status: 'running', state: 'open' }, can), []);
  for (const none of [{ manage: false }, {}, undefined]) {
    assert.deepEqual(pairActions({ status: 'planned', state: 'open' }, none), []);
    assert.deepEqual(pairActions({ status: 'closed', state: 'open' }, none), []);
  }
});

test('unitLine: all three results, only the current control, nothing yet', () => {
  assert.deepEqual(unitLine({ unit: 1, current: 38, self: 16, control: 30, total: 84 }),
    { key: 'grades.unit.full', params: { current: 38, self: 16, control: 30, total: 84 } });
  const parts = (u) => unitLine({ unit: 2, total: null, ...u }).parts.map((p) => p.key.replace('grades.unit.part.', '') + '=' + Object.values(p.params)[0]);
  assert.deepEqual(parts({ current: 31, self: null, control: null }), ['current=31']);
  assert.deepEqual(parts({ current: 38, self: null, control: 18 }), ['current=38', 'control=18']);
  assert.deepEqual(parts({ current: null, self: 12, control: null }), ['self=12']);
  assert.deepEqual(parts({ current: null, self: 12, control: 18 }), ['self=12', 'control=18']);
  assert.deepEqual(parts({ current: 31, self: 10, control: null }), ['current=31', 'self=10']);
  assert.equal(unitLine({ unit: 2, current: 38, self: null, control: 18, total: null }).key, 'grades.unit.parts');
  assert.deepEqual(unitLine({ unit: 3, current: null, self: null, control: null, total: null }), { key: 'grades.unit.empty', params: {} });
});

test('changedMarks: an active student without a saved mark on a held pair is sent with what the window shows', () => {
  const journal = { pairs: [{ id: 'p1', status: 'closed' }], students: [{ id: 's1', fullName: 'A' }, { id: 's2', fullName: 'B' }], marks: { p1: { s1: { status: 'present', noCoat: false, activity: null } } } };
  const draft = draftMarks(journal, 'p1');
  const sent = changedMarks(draft, journal, 'p1');
  assert.deepEqual(sent.map((m) => m.studentId + ':' + m.status), ['s2:present']);
});

test('absenceList: only absent, excused and madeup, the newest first', () => {
  const pairs = [
    { date: '2026-09-01', slot: 1, status: 'present' }, { date: '2026-09-03', slot: 2, status: 'absent' },
    { date: '2026-09-02', slot: 1, status: 'late' }, { date: '2026-09-03', slot: 1, status: 'excused' }, { date: '2026-09-05', slot: 1, status: 'madeup' },
  ];
  assert.deepEqual(absenceList(pairs).map((p) => p.date + '/' + p.slot), ['2026-09-05/1', '2026-09-03/2', '2026-09-03/1']);
  assert.deepEqual(absenceList(undefined), []);
  assert.equal(pairs.length, 5);
});

test('pointsText: the points of a pair, or «not counted»', () => {
  assert.deepEqual(pointsText({ earned: 27, possible: 30 }), { key: 'grades.points', params: { earned: 27, possible: 30 } });
  assert.deepEqual(pointsText({ earned: 0, possible: 30 }), { key: 'grades.points', params: { earned: 0, possible: 30 } });
  assert.deepEqual(pointsText({ earned: null, possible: null }), { key: 'grades.notCounted', params: {} });
});

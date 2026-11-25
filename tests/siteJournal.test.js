import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRows, listBadges, journalColumns, cellView, pairHead, draftMarks, changedMarks, activityAllowed, coatAllowed, canMark, pairHint, lateOptions, logLine, pairScore, parsePoints, resultItems, needsReason, savedResult, pairActions, unitLine, selfCell, absenceList, pointsText, weekRange, addDays, isoWeekday, pairsOfDay, pairsOfWeek, pairsOfUnit, nearestPairDate, stepPairDate, unitOptions, currentUnit, viewColumns, semesterCell, semesterLine, admissionLine, requestNote, examLines, stateExamLine } from '../site/js/journal.js';
import ruDict from '../site/js/i18n/ru.js';
import kyDict from '../site/js/i18n/ky.js';
import enDict from '../site/js/i18n/en.js';

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
  assert.deepEqual(pairHead({ status: 'running', lessonType: 'practice', state: 'open' }), { kindKey: 'journal.kind.practice', stateKey: 'journal.state.running' });
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

test('logLine: an assignment title that looks like a dictionary key stays text', () => {
  for (const title of ['work.state.checked', 'journal.col.self']) {
    const line = logLine({ entity: 'work', field: 'status', before: 'submitted', after: 'checked', assignmentTitle: title });
    assert.equal(line.params.title, title);
    assert.deepEqual(line.keyParams, ['before', 'after']);
    assert.deepEqual(logLine({ entity: 'work', field: 'points', before: '8', after: '9', assignmentTitle: title }).keyParams, []);
  }
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

test('a student without a saved mark: no status on a held pair and not sent until set; present by default on a pair not held', () => {
  const journal = { pairs: [{ id: 'p1', status: 'closed' }, { id: 'p2', status: 'planned' }], students: [{ id: 's1', fullName: 'A' }, { id: 's2', fullName: 'B' }], marks: { p1: { s1: { status: 'present', noCoat: false, activity: null } } } };
  const draft = draftMarks(journal, 'p1');
  assert.deepEqual(draft.map((m) => m.studentId + ':' + m.status), ['s1:present', 's2:null']);
  assert.deepEqual(changedMarks(draft, journal, 'p1'), []);
  draft[1].status = 'present';
  assert.deepEqual(changedMarks(draft, journal, 'p1').map((m) => m.studentId + ':' + m.status), ['s2:present']);
  assert.deepEqual(draftMarks(journal, 'p2').map((m) => m.status), ['present', 'present']);
  assert.equal(changedMarks(draftMarks(journal, 'p2'), journal, 'p2').length, 2);
  assert.equal(activityAllowed(null, {}), false);
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

// ---- The views: day, week, unit, the whole term ----

const V = (id, date, unit, extra = {}) => ({ id, date, unit, status: 'closed', lessonType: 'lecture', ...extra });
const VJ = {
  partial: false,
  units: [{ unit: 1, title: '' }, { unit: 2, title: '' }, { unit: 3, title: '' }],
  pairs: [V('a', '2026-11-09', 1), V('b', '2026-11-16', 1), V('c', '2026-11-18', 1), V('d', '2026-11-18', 2), V('e', '2026-11-30', 2), V('f', '2026-12-02', null)],
};
const ids = (rows) => rows.map((p) => p.id);

test('weekRange and addDays: Monday to Sunday, across months and years', () => {
  assert.deepEqual(weekRange('2026-11-18'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(weekRange('2026-11-22'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(weekRange('2026-11-16'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(weekRange('2026-12-02'), { from: '2026-11-30', to: '2026-12-06' });
  assert.deepEqual(weekRange('2026-12-31'), { from: '2026-12-28', to: '2027-01-03' });
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual([isoWeekday('2026-11-16'), isoWeekday('2026-11-22')], [1, 7]);
});

test('pairsOfDay, pairsOfWeek, pairsOfUnit pick the pairs; nothing for a day or week without pairs', () => {
  assert.deepEqual(ids(pairsOfDay(VJ.pairs, '2026-11-18')), ['c', 'd']);
  assert.deepEqual(ids(pairsOfDay(VJ.pairs, '2026-11-17')), []);
  assert.deepEqual(ids(pairsOfWeek(VJ.pairs, '2026-11-22')), ['b', 'c', 'd']);
  assert.deepEqual(ids(pairsOfWeek(VJ.pairs, '2026-12-01')), ['e', 'f']);
  assert.deepEqual(ids(pairsOfWeek(VJ.pairs, '2026-11-25')), []);
  assert.deepEqual(ids(pairsOfUnit(VJ.pairs, 2)), ['d', 'e']);
  assert.deepEqual([pairsOfDay(undefined, 'x'), pairsOfWeek(null, '2026-11-18')], [[], []]);
});

test('nearestPairDate: today, else the next pair date, else the last; null without pairs', () => {
  assert.deepEqual(nearestPairDate(VJ.pairs, '2026-11-18'), { date: '2026-11-18', exact: true });
  assert.deepEqual(nearestPairDate(VJ.pairs, '2026-11-17'), { date: '2026-11-18', exact: false });
  assert.deepEqual(nearestPairDate(VJ.pairs, '2026-11-22'), { date: '2026-11-30', exact: false });   // Sunday
  assert.deepEqual(nearestPairDate(VJ.pairs, '2026-08-01'), { date: '2026-11-09', exact: false });   // all pairs in the future
  assert.deepEqual(nearestPairDate(VJ.pairs, '2027-01-01'), { date: '2026-12-02', exact: false });   // all pairs past
  assert.equal(nearestPairDate([], '2026-11-18'), null);
});

test('stepPairDate: the previous and the next date that has a pair', () => {
  assert.equal(stepPairDate(VJ.pairs, '2026-11-18', -1), '2026-11-16');
  assert.equal(stepPairDate(VJ.pairs, '2026-11-18', 1), '2026-11-30');
  assert.equal(stepPairDate(VJ.pairs, '2026-11-09', -1), null);
  assert.equal(stepPairDate(VJ.pairs, '2026-12-02', 1), null);
  assert.equal(stepPairDate(VJ.pairs, '2026-11-20', 1), '2026-11-30');
});

test('unitOptions and currentUnit: the units of the half; the unit of the nearest pair and whether it runs now', () => {
  assert.deepEqual(unitOptions(VJ), [1, 2, 3]);
  assert.deepEqual(unitOptions({ pairs: [V('x', '2026-11-18', 4)], units: [] }), [4]);
  assert.deepEqual(unitOptions({ pairs: [], units: [] }), []);
  assert.deepEqual(currentUnit(VJ.pairs, '2026-11-18'), { unit: 1, running: true });
  assert.deepEqual(currentUnit(VJ.pairs, '2026-11-25'), { unit: 2, running: true });
  assert.deepEqual(currentUnit(VJ.pairs, '2026-11-01'), { unit: 1, running: false });
  assert.equal(currentUnit([], '2026-11-18'), null);
  assert.equal(currentUnit([V('z', '2026-11-18', null)], '2026-11-18'), null);
});

test('viewColumns: the totals of the units of the visible pairs only, after the last visible pair of the unit', () => {
  const names = (r) => r.columns.map(name);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'day', day: '2026-11-18' })),
    ['c', 'u1.current', 'u1.self', 'u1.control', 'u1.total', 'd', 'u2.current', 'u2.self', 'u2.control', 'u2.total', 'absences', 'percent', 'preliminary']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'week', week: '2026-11-16' })).slice(0, 2), ['b', 'c']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'week', week: '2026-12-01' })),
    ['e', 'u2.current', 'u2.self', 'u2.control', 'u2.total', 'f', 'outside', 'absences', 'percent', 'preliminary']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'unit', unit: 2 })),
    ['d', 'e', 'u2.current', 'u2.self', 'u2.control', 'u2.total', 'absences', 'percent', 'preliminary']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'unit', unit: 3 })), ['u3.current', 'u3.self', 'u3.control', 'u3.total', 'absences', 'percent', 'preliminary']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'week', week: '2026-11-25' })), ['absences', 'percent', 'preliminary']);
  assert.deepEqual(names(viewColumns(VJ, { mode: 'all' })), names({ columns: journalColumns(VJ) }));
});

test('viewColumns: missed and cancelled pairs stay in view; a partial journal shows pairs only; no pairs at all', () => {
  const J2 = { partial: false, units: [{ unit: 1, title: '' }], pairs: [V('m', '2026-11-18', 1, { status: 'missed' }), V('n', '2026-11-18', 1, { status: 'cancelled' })] };
  assert.deepEqual(ids(viewColumns(J2, { mode: 'day', day: '2026-11-18' }).pairs), ['m', 'n']);
  assert.deepEqual(viewColumns({ ...VJ, partial: true, units: [] }, { mode: 'week', week: '2026-11-16' }).columns.map(name), ['b', 'c', 'd']);
  assert.deepEqual(viewColumns({ partial: false, units: [], pairs: [] }, { mode: 'all' }).columns.map(name), ['absences', 'percent', 'preliminary']);
});

test('selfCell: self-work of a unit without assignments stays as it was; by assignments it is counted by them, or provisional', () => {
  assert.deepEqual(selfCell({ unit: 1, self: 12 }), { value: 12, key: null, params: {} });
  assert.deepEqual(selfCell({ unit: 1, self: null }), { value: null, key: null, params: {} });
  assert.deepEqual(selfCell({ unit: 2, self: 15, selfWork: { earned: 15, max: 20, pending: 0, value: 15 } }), { value: 15, key: 'journal.self.byWork', params: {} });
  assert.deepEqual(selfCell({ unit: 2, self: null, selfWork: { earned: 5, max: 20, pending: 2, value: 5 } }), { value: 5, key: 'journal.self.pending', params: { n: 2 } });
  assert.deepEqual(selfCell({ unit: 2, self: null, selfWork: { earned: 0, max: 0, pending: 0, value: null } }), { value: null, key: 'journal.self.byWork', params: {} });
  assert.deepEqual(selfCell(null), { value: null, key: null, params: {} });
});

test('logLine: the lines of assignments (points, status, maximum, deadline) and the old mark line stays', () => {
  const row = { entity: 'work', assignmentTitle: 'СРС А' };
  assert.deepEqual(logLine({ ...row, field: 'points', before: '8', after: '9' }), { key: 'journal.log.work.points', params: { title: 'СРС А', before: '8', after: '9' }, keyParams: [] });
  assert.deepEqual(logLine({ ...row, field: 'points', before: '', after: '8' }).params, { title: 'СРС А', before: '—', after: '8' });
  assert.deepEqual(logLine({ ...row, field: 'status', before: 'submitted', after: 'checked' }),
    { key: 'journal.log.work.status', params: { title: 'СРС А', before: 'work.state.submitted', after: 'work.state.checked' }, keyParams: ['before', 'after'] });
  assert.deepEqual(logLine({ ...row, field: 'status', before: '', after: 'checked' }).params, { title: 'СРС А', before: '—', after: 'work.state.checked' });
  assert.deepEqual(logLine({ ...row, field: 'maxPoints', before: '20', after: '15' }), { key: 'journal.log.work.maxPoints', params: { title: 'СРС А', before: '20', after: '15' }, keyParams: [] });
  assert.deepEqual(logLine({ ...row, field: 'dueAt', before: '2026-09-27 23:59:00', after: '2026-10-04 23:59:00' }),
    { key: 'journal.log.work.dueAt', params: { title: 'СРС А', before: '27.09.2026 23:59', after: '04.10.2026 23:59' }, keyParams: [] });
  assert.equal(logLine({ ...row, assignmentTitle: '', field: 'points', before: '1', after: '2' }).params.title, '—');
  assert.equal(logLine({ ...row, field: 'weird', before: 'a', after: 'b' }).key, 'journal.log.other');
  assert.deepEqual(logLine({ entity: 'mark', field: 'status', before: 'absent', after: 'madeup' }).key, 'journal.log.mark.status');
});

test('unitLine: a unit with self-work by assignments says so, and says «provisional» while some assignments wait', () => {
  const done = unitLine({ current: 20, self: 15, control: 25, total: 60, selfWork: { earned: 15, max: 20, pending: 0, value: 15 } });
  assert.deepEqual(done.parts.map((p) => p.key), ['grades.unit.part.current', 'grades.unit.part.selfByWork', 'grades.unit.part.control', 'grades.unit.part.total']);
  assert.equal(done.parts[1].params.self, 15);
  const wait = unitLine({ current: 20, self: null, control: null, total: null, selfWork: { earned: 5, max: 20, pending: 1, value: 5 } });
  assert.deepEqual(wait.parts.map((p) => p.key), ['grades.unit.part.current', 'grades.unit.part.selfPending']);
  assert.deepEqual(wait.parts[1].params, { self: 5, n: 1 });
  assert.equal(unitLine({ current: 1, self: 2, control: 3, total: 6 }).key, 'grades.unit.full');
});

test('semester points and the admission: numbers come from the split of the answer', () => {
  const SP = { semester: 60, exam: 40, admission: 30 };
  assert.deepEqual(semesterCell({ semester: null, complete: false, admitted: false }, SP), { text: '—', key: null, params: {}, tone: 'neutral' });
  assert.deepEqual(semesterCell({ semester: 43, complete: false, admitted: false }, SP), { text: '43', key: 'journal.tip.semesterSoFar', params: { max: 60 }, tone: 'neutral' });
  assert.deepEqual(semesterCell({ semester: 47, complete: true, admitted: true }, SP), { text: '47', key: 'journal.tip.admitted', params: { max: 60 }, tone: 'neutral' });
  assert.deepEqual(semesterCell({ semester: 29, complete: true, admitted: false }, SP), { text: '29', key: 'journal.tip.notAdmitted', params: { max: 60, need: 30 }, tone: 'danger' });
  assert.deepEqual(semesterCell({ semester: 24, complete: true, admitted: false }, { semester: 50, exam: 50, admission: 25 }).params, { max: 50, need: 25 });
  assert.deepEqual([semesterLine({ semester: null, complete: false, admitted: false }, SP), semesterLine({ semester: 43, complete: false, admitted: false }, SP), semesterLine({ semester: 47, complete: true, admitted: true }, SP), semesterLine({ semester: 29, complete: true, admitted: false }, SP)],
    [null, { key: 'grades.semesterSoFar', params: { value: 43, max: 60 }, tone: 'neutral' }, { key: 'grades.semester', params: { value: 47, max: 60 }, tone: 'success' }, { key: 'grades.semester', params: { value: 29, max: 60 }, tone: 'danger' }]);
  assert.deepEqual([admissionLine({ semester: 43, complete: false, admitted: false }, SP), admissionLine({ semester: 47, complete: true, admitted: true }, SP), admissionLine({ semester: 29, complete: true, admitted: false }, SP)],
    [null, { key: 'grades.admitted', params: {}, tone: 'success' }, { key: 'grades.notAdmitted', params: { value: 29, max: 60, need: 30 }, tone: 'danger' }]);
});

test('logLine: closing and opening of a unit and of the final ledger', () => {
  assert.deepEqual(logLine({ entity: 'ledger', field: 'closed', unit: 2, before: 'open', after: 'closed' }), { key: 'journal.log.ledger.closed', params: { unit: 2 }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'ledger', field: 'closed', unit: 2, before: 'closed', after: 'open' }), { key: 'journal.log.ledger.opened', params: { unit: 2 }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'ledger', field: 'final', unit: null, before: 'open', after: 'closed' }), { key: 'journal.log.ledger.finalClosed', params: {}, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'ledger', field: 'final', unit: null, before: 'closed', after: 'open' }), { key: 'journal.log.ledger.finalOpened', params: {}, keyParams: [] });
});

test('logLine: a state exam result keeps the name of the exam as text', () => {
  const line = logLine({ entity: 'exam', field: 'score', examName: 'journal.col.self', before: '', after: '70' });
  assert.deepEqual(line, { key: 'journal.log.exam.score', params: { name: 'journal.col.self', before: '—', after: '70' }, keyParams: [] });
  assert.equal(logLine({ entity: 'exam', field: 'score', examName: '', before: '70', after: '' }).params.name, '—');
});

test('logLine: an attempt of the exam of a subject; the words absent and incomplete are keys', () => {
  assert.deepEqual(logLine({ entity: 'subjectExam', field: 'try1', before: '', after: '35' }),
    { key: 'journal.log.subjectExam.result', params: { no: 1, before: '—', after: '35' }, keyParams: [] });
  assert.deepEqual(logLine({ entity: 'subjectExam', field: 'try2', before: '20', after: 'absent' }),
    { key: 'journal.log.subjectExam.result', params: { no: 2, before: '20', after: 'ledger.exam.absent' }, keyParams: ['after'] });
  assert.deepEqual(logLine({ entity: 'subjectExam', field: 'try3', before: 'incomplete', after: '40' }).keyParams, ['before']);
});

test('requestNote: the people who approved a request; none without a request', () => {
  assert.deepEqual(requestNote({ requestId: 'r1', approvedBy: ['Dean A.', 'Vice B.'] }), { key: 'journal.log.byRequest', params: { names: 'Dean A., Vice B.' } });
  assert.deepEqual(requestNote({ requestId: 'r1', approvedBy: ['Dean A.', ''] }).params, { names: 'Dean A.' });
  assert.equal(requestNote({ entity: 'mark' }), null);
  assert.equal(requestNote(null), null);
});

// ---- task 26: the exam and the total of a subject, the state exam of a student ----

const SPLIT = { semester: 60, exam: 40, admission: 30 };
const fin = (status, extra = {}) => ({ final: { status, exam: null, total: null, word: null, canRetake: false, attempts: [], ...extra } });

test('examLines: an open final sheet shows nothing', () => {
  assert.deepEqual(examLines({ final: null }, SPLIT), []);
});

test('examLines: done gives the exam and the total with the word; the maxima come from the split', () => {
  const lines = examLines(fin('done', { exam: 35, total: 82, word: 'good' }), SPLIT);
  assert.deepEqual(lines, [
    { key: 'grades.exam', params: { value: 35, max: 40 }, tone: 'neutral' },
    { key: 'grades.final', params: { value: 82, max: 100 }, tone: 'primary', word: 'good' },
  ]);
  const other = examLines(fin('done', { exam: 30, total: 70, word: 'fair' }), { semester: 50, exam: 50, admission: 25 });
  assert.deepEqual([other[0].params.max, other[1].params.max], [50, 100]);
});

test('examLines: failed with a retake, absent, incomplete, none, not admitted', () => {
  const failed = examLines(fin('done', { exam: 12, total: 58, word: 'fail', canRetake: true }), SPLIT);
  assert.deepEqual([failed[1].word, failed[1].tone, failed[2]], ['fail', 'danger', { key: 'grades.exam.canRetake', params: {}, tone: 'neutral' }]);
  assert.deepEqual(examLines(fin('absent', { canRetake: true }), SPLIT).map((l) => l.key), ['grades.exam.absent', 'grades.exam.canRetake']);
  assert.deepEqual(examLines(fin('incomplete'), SPLIT), [{ key: 'grades.exam.incomplete', params: {}, tone: 'warning' }]);
  assert.deepEqual(examLines(fin('none'), SPLIT), [{ key: 'grades.exam.none', params: {}, tone: 'neutral' }]);
  assert.deepEqual(examLines(fin('not_admitted'), SPLIT), [{ key: 'grades.final.notAdmitted', params: {}, tone: 'danger' }]);
});

test('stateExamLine: with a score, and without', () => {
  assert.deepEqual(stateExamLine({ name: 'X', date: '2026-06-01', score: 90, word: 'excellent' }), { key: 'grades.stateExam.score', params: { score: 90 }, word: 'excellent' });
  assert.deepEqual(stateExamLine({ name: 'X', date: '2026-06-01', score: null, word: null }), { key: 'grades.stateExam.none', params: {}, word: null });
});

test('unitLine of a closed unit is the same as of an open one', () => {
  const unit = { current: 20, self: 10, control: 15, total: 45, selfWork: false };
  assert.deepEqual(unitLine({ ...unit, closed: true }), unitLine(unit));
});

test('task 26 keys are in three dictionaries; value and max are placeholders, no 40 or 100 in digits', () => {
  const keys = ['grades.final', 'grades.final.notAdmitted', 'grades.exam', 'grades.exam.absent', 'grades.exam.incomplete', 'grades.exam.none', 'grades.exam.canRetake',
    'grades.stateExam.title', 'grades.stateExam.score', 'grades.stateExam.none', 'grades.unitClosed', 'work.closedUnit', 'announce.home.all', 'announce.home.empty'];
  for (const dict of [ruDict, kyDict, enDict]) {
    for (const key of keys) assert.equal(typeof dict[key], 'string', key);
    for (const key of ['grades.exam', 'grades.final']) assert.ok(dict[key].includes('{value}') && dict[key].includes('{max}') && !/(40|100)/.test(dict[key]), key);
    assert.equal('home.newsSoon' in dict, false);
  }
});

test('logLine: the lines of a repeat course, one expectation for each field; an unknown field is «other»', () => {
  const row = (field, before, after) => ({ entity: 'repeat', field, before, after });
  assert.deepEqual(logLine(row('enrol', '', 'full')), { key: 'journal.log.repeat.enrol', params: { kind: 'journal.log.repeat.kind.full' }, keyParams: ['kind'] });
  assert.deepEqual(logLine(row('enrol', '', 'exam')).params, { kind: 'journal.log.repeat.kind.exam' });
  assert.deepEqual(logLine(row('orderNo', '12', '14')), { key: 'journal.log.repeat.orderNo', params: { before: '12', after: '14' }, keyParams: [] });
  assert.deepEqual(logLine(row('orderDate', '2026-11-10', '2026-11-12')).params, { before: '10.11.2026', after: '12.11.2026' });
  assert.deepEqual(logLine(row('deadline', '2027-02-01', '2027-03-01')), { key: 'journal.log.repeat.deadline', params: { before: '01.02.2027', after: '01.03.2027' }, keyParams: [] });
  assert.deepEqual(logLine(row('teacher', 'Первый', 'Третий')).params, { before: 'Первый', after: 'Третий' });
  assert.deepEqual(logLine(row('works', '', '50')), { key: 'journal.log.repeat.works', params: { before: '—', after: '50' }, keyParams: [] });
  assert.deepEqual(logLine(row('worksNote', '', 'Реферат')), { key: 'journal.log.repeat.worksNote', params: { before: '—', after: 'Реферат' }, keyParams: [] });
  assert.deepEqual(logLine(row('works', '45', '50')).params, { before: '45', after: '50' });
  assert.deepEqual(logLine(row('try1', '', '30')), { key: 'journal.log.repeat.try', params: { no: 1, before: '—', after: '30' }, keyParams: [] });
  assert.deepEqual(logLine(row('try2', 'absent', 'incomplete')), { key: 'journal.log.repeat.try', params: { no: 2, before: 'ledger.exam.absent', after: 'ledger.exam.incomplete' }, keyParams: ['before', 'after'] });
  assert.deepEqual(logLine(row('status', 'open', 'passed')), { key: 'journal.log.repeat.status', params: { before: 'journal.log.repeat.state.open', after: 'journal.log.repeat.state.passed' }, keyParams: ['before', 'after'] });
  assert.equal(logLine(row('status', 'passed', 'open')).params.after, 'journal.log.repeat.state.open');
  assert.equal(logLine(row('status', 'open', 'cancelled')).params.after, 'journal.log.repeat.state.cancelled');
  assert.equal(logLine(row('whatever', 'a', 'b')).key, 'journal.log.other');
  assert.equal(logLine(row('try0', '', '1')).key, 'journal.log.other');
  for (const dict of [ruDict, kyDict, enDict]) {
    for (const key of ['enrol', 'orderNo', 'orderDate', 'deadline', 'teacher', 'works', 'worksNote', 'try', 'status']) assert.ok(dict['journal.log.repeat.' + key], key);
  }
});

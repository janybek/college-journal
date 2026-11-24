import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ledgerColumns, unitCellText, isLow, admissionCell, examCell, finalCell, closeNote, canCloseUnit, wordCounts, examNote,
} from '../site/js/ledger.js';

const U = (over) => ({ unit: 1, current: 38, manual: false, self: 16, selfPending: 0, control: 30, total: 84, word: 'good', currentLow: false, controlLow: false, ...over });
const SP = { semester: 60, exam: 40, admission: 30 };
const St = (over) => ({ left: false, semester: 47, complete: true, admitted: true, status: 'done', exam: 35, total: 82, word: 'good', ...over });

test('the cells of a unit: a number, a dash, and a preliminary self-work with a star', () => {
  assert.deepEqual([unitCellText(U(), 'current'), unitCellText(U({ control: null }), 'control'), unitCellText(U({ self: 5, selfPending: 2 }), 'self')], ['38', '—', '5*']);
  assert.deepEqual([isLow(U({ currentLow: true }), 'current'), isLow(U({ controlLow: true }), 'control'), isLow(U({ word: 'fail' }), 'total'), isLow(U(), 'self')], [true, true, true, false]);
});

test('the admission cell: nothing before every unit is closed, then admitted or the reason; the minimum comes from the answer', () => {
  assert.deepEqual([admissionCell(St(), false, SP), admissionCell(St(), true, SP), admissionCell(St({ complete: false, admitted: false }), true, SP), admissionCell(St({ semester: 29, admitted: false }), true, SP)],
    [{ key: null, params: {}, tone: 'neutral' }, { key: 'ledger.admission.yes', params: {}, tone: 'success' }, { key: 'ledger.admission.noUnit', params: {}, tone: 'danger' }, { key: 'ledger.admission.low', params: { need: 30 }, tone: 'danger' }]);
  assert.deepEqual(admissionCell(St({ semester: 24, admitted: false }), true, { semester: 50, exam: 50, admission: 25 }).params, { need: 25 });
});

test('the exam cell and the final cell', () => {
  assert.deepEqual([examCell(St()), examCell(St({ status: 'absent', exam: null })), examCell(St({ status: 'incomplete', exam: null })), examCell(St({ status: 'none', exam: null })), examCell(St({ status: 'not_admitted', exam: null }))],
    [{ text: '35', key: null }, { text: '', key: 'ledger.exam.absent' }, { text: '', key: 'ledger.exam.incomplete' }, { text: '—', key: null }, { text: '—', key: null }]);
  assert.deepEqual(finalCell(St(), { ready: true, closed: true }), { text: '82', key: 'journal.grade.good', tone: 'primary', draft: false });
  assert.deepEqual(finalCell(St(), { ready: true, closed: false }), { text: '82', key: 'journal.grade.good', tone: 'primary', draft: true });
  assert.deepEqual(finalCell(St({ total: 58, word: 'fail' }), { ready: true, closed: true }), { text: '58', key: 'journal.grade.fail', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'not_admitted', total: null, word: null }), { ready: true, closed: true }), { text: '—', key: 'ledger.final.notAdmitted', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'absent', total: null, word: null }), { ready: true, closed: true }), { text: '—', key: 'ledger.final.absent', tone: 'danger', draft: false });
  assert.deepEqual(finalCell(St({ status: 'incomplete', total: null, word: null }), { ready: true, closed: false }), { text: '—', key: 'ledger.final.incomplete', tone: 'warning', draft: true });
  assert.deepEqual([finalCell(St({ status: 'none', total: null, word: null }), { ready: true, closed: false }), finalCell(St({ status: 'not_admitted', total: null, word: null }), { ready: false, closed: false })],
    [{ text: '—', key: null, tone: 'neutral', draft: false }, { text: '—', key: null, tone: 'neutral', draft: false }]);
  assert.equal(finalCell(St({ total: 95, word: 'excellent' }), { ready: true, closed: true }).tone, 'success');
  assert.equal(finalCell(St({ total: 65, word: 'fair' }), { ready: true, closed: true }).tone, 'warning');
});

test('closing a unit: the note instead of the button, and who may close', () => {
  assert.deepEqual(closeNote({ closed: false, blocking: [{ code: 'pairs_not_held', n: 3 }], missing: 3 }), { key: 'ledger.block.pairs_not_held', params: { n: 3 }, tone: 'warning' });
  assert.deepEqual(closeNote({ closed: false, blocking: [], missing: 1 }), { key: 'ledger.missing', params: { n: 1 }, tone: 'neutral' });
  assert.equal(closeNote({ closed: false, blocking: [], missing: 0 }), null);
  assert.deepEqual(closeNote({ closed: true, closedAt: '2026-11-20 10:05:00', closedByName: 'Иванов И.', blocking: [], missing: 0 }),
    { key: 'ledger.unit.closedAt', params: { date: '20.11.2026', name: 'Иванов И.' }, tone: 'success' });
  assert.deepEqual([canCloseUnit({ closed: false, blocking: [] }, { close: true }), canCloseUnit({ closed: true, blocking: [] }, { close: true }), canCloseUnit({ closed: false, blocking: [{ code: 'self_pending', n: 1 }] }, { close: true }), canCloseUnit({ closed: false, blocking: [] }, { close: false })], [true, false, false, false]);
});

test('the counts of words skip those who left', () => {
  assert.deepEqual(wordCounts([St(), St({ total: 58, word: 'fail' }), St({ status: 'absent', word: null }), St({ status: 'incomplete', word: null }), St({ status: 'not_admitted', word: null }), St({ status: 'none', word: null }), St({ left: true, total: 95, word: 'excellent' })]),
    { excellent: 0, good: 1, fair: 0, fail: 1, absent: 1, incomplete: 1, notAdmitted: 1, none: 1 });
});

test('the line about the credit week', () => {
  const week = { start: '2026-12-14', end: '2026-12-20' };
  assert.deepEqual([examNote(week, '2026-12-15', { closed: false }).key, examNote(week, '2026-12-01', { closed: false }).key,
    examNote({ start: '', end: '' }, '2026-12-15', { closed: false }), examNote(week, '2026-12-15', { closed: true }), examNote(week, '2026-12-21', { closed: false })], ['ledger.exam.now', 'ledger.exam.from', null, null, null]);
  assert.deepEqual(examNote(week, '2026-12-01', { closed: false }).params, { date: '14.12.2026' });
  assert.equal(examNote(week, '2026-12-15').key, 'ledger.exam.now');
});

test('the columns: a group per unit, then the semester, the admission, the exam, the total and the grade', () => {
  const columns = ledgerColumns({ units: [{ unit: 1, title: 'Основы', closed: true }, { unit: 2, title: '', closed: false }] });
  assert.deepEqual(columns.map((c) => c.type), ['unit', 'unit', 'semester', 'admission', 'exam', 'final', 'word']);
  assert.deepEqual(columns[0], { type: 'unit', unit: 1, title: 'Основы', closed: true, fields: ['current', 'self', 'control', 'total'] });
  assert.equal(columns[1].closed, false);
});

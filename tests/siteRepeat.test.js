import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_STATES, EXAM_TRIES_MAX, stateOf, stateBadge, filterOptions, filterRepeats, prevLine, totalLine, enrolDraft, retakesLeft, orderLine } from '../site/js/repeat.js';
import { EXAM } from '../core/exam.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';

const ROWS = [
  { id: 'a', status: 'open', overdue: false, groupName: '02-1', subjectName: 'Информатика', own: true },
  { id: 'b', status: 'open', overdue: true, groupName: '02-1', subjectName: 'Информатика', own: false },
  { id: 'c', status: 'passed', overdue: false, groupName: '03-2', subjectName: 'Физика', own: false },
  { id: 'd', status: 'failed', overdue: false, groupName: '03-2', subjectName: 'Информатика', own: true },
  { id: 'e', status: 'cancelled', overdue: false, groupName: '02-1', subjectName: 'Физика', own: false },
];
const ids = (list) => list.map((r) => r.id).join('');

test('stateOf and stateBadge: the five states', () => {
  assert.deepEqual(ROWS.map(stateOf), ['open', 'overdue', 'passed', 'failed', 'cancelled']);
  assert.deepEqual(ROWS.map(stateBadge), [
    { key: 'repeat.state.open', tone: 'primary' }, { key: 'repeat.state.overdue', tone: 'warning' }, { key: 'repeat.state.passed', tone: 'success' },
    { key: 'repeat.state.failed', tone: 'danger' }, { key: 'repeat.state.cancelled', tone: 'neutral' }]);
  assert.equal(stateOf({ status: 'passed', overdue: true }), 'passed');
});

test('filterRepeats: by group, subject, overdue and own; filterOptions without repeats', () => {
  assert.equal(ids(filterRepeats(ROWS, {})), 'abcde');
  assert.equal(ids(filterRepeats(ROWS, { group: '03-2' })), 'cd');
  assert.equal(ids(filterRepeats(ROWS, { subject: 'Физика' })), 'ce');
  assert.equal(ids(filterRepeats(ROWS, { state: 'overdue' })), 'b');
  assert.equal(ids(filterRepeats(ROWS, { state: 'open' })), 'a');
  assert.equal(ids(filterRepeats(ROWS, { own: true })), 'ad');
  assert.equal(ids(filterRepeats(ROWS, { group: '02-1', subject: 'Информатика', state: 'overdue', own: true })), '');
  assert.deepEqual(filterOptions(ROWS), { groups: ['02-1', '03-2'], subjects: ['Информатика', 'Физика'] });
  assert.deepEqual(REPEAT_STATES, ['all', 'open', 'overdue', 'passed', 'failed', 'cancelled']);
});

test('prevLine: the four statuses, the maximum from split', () => {
  const split = { semester: 60, exam: 40 };
  assert.deepEqual(prevLine({ status: 'done', semester: 40, exam: 12, total: 52 }, split), { key: 'repeat.prev.done', params: { total: 52, max: 100, semester: 40, exam: 12 } });
  assert.equal(prevLine({ status: 'done', semester: 20, exam: 20, total: 40 }, { semester: 50, exam: 50 }).params.max, 100);
  assert.deepEqual(prevLine({ status: 'not_admitted', semester: 25 }, split), { key: 'repeat.prev.notAdmitted', params: { semester: 25 } });
  assert.deepEqual(prevLine({ status: 'absent', semester: 45 }, split), { key: 'repeat.prev.absent', params: { semester: 45 } });
  assert.deepEqual(prevLine({ status: 'incomplete', semester: 45 }, split), { key: 'repeat.prev.incomplete', params: { semester: 45 } });
  assert.equal(prevLine({ status: 'absent', semester: null }, split).params.semester, '—');
});

test('totalLine: preliminary, closed, not admitted, nothing', () => {
  const split = { semester: 60, exam: 40 };
  const open = { status: 'open', split, result: { status: 'done', total: 75, word: 'fair' } };
  assert.deepEqual(totalLine(open), { key: 'repeat.total.preliminary', params: { total: 75, max: 100 }, tone: 'warning', word: 'fair' });
  const passed = { status: 'passed', split, result: { status: 'done', total: 80, word: 'good' } };
  assert.deepEqual(totalLine(passed), { key: 'repeat.total', params: { total: 80, max: 100 }, tone: 'primary', word: 'good' });
  assert.equal(totalLine({ status: 'open', split, result: { status: 'not_admitted', total: null, word: null } }).key, 'repeat.total.notAdmitted');
  assert.equal(totalLine({ status: 'open', split, result: { status: 'none', total: null, word: null } }), null);
  assert.equal(totalLine({ ...open, split: { semester: 50, exam: 50 } }).params.max, 100);
});

test('enrolDraft: the suggested kind, the date of today, the teacher of the subject', () => {
  const subject = { teacherId: 'st_1' };
  assert.deepEqual(enrolDraft({ suggest: 'full' }, subject, '2026-11-25'), { kind: 'full', orderNo: '', orderDate: '2026-11-25', deadline: '', teacherId: 'st_1' });
  assert.equal(enrolDraft({ suggest: null }, subject, '2026-11-25').kind, 'full');
});

test('retakesLeft and orderLine; the number of sittings is the one of the server', () => {
  assert.equal(EXAM_TRIES_MAX, EXAM.triesMax);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 1 }), 2);
  assert.equal(retakesLeft({ retakesLeft: true, tries: 3 }), 0);
  assert.equal(retakesLeft({ retakesLeft: false, tries: 1 }), 0);
  assert.deepEqual(orderLine('45-А', '2026-11-20'), { key: 'repeat.order', params: { no: '45-А', date: '20.11.2026' } });
  assert.equal(orderLine('', ''), null);
});

test('every text the repeat screens ask for exists in the three dictionaries', () => {
  for (const state of REPEAT_STATES) for (const dict of [ru, ky, en]) assert.ok(dict['repeat.state.' + state], state);
  for (const key of ['repeat.title', 'repeat.mine.title', 'repeat.hint', 'repeat.empty', 'repeat.enrol', 'repeat.order', 'repeat.prev.done', 'repeat.prev.notAdmitted', 'repeat.prev.absent', 'repeat.prev.incomplete',
    'repeat.total', 'repeat.total.preliminary', 'repeat.total.notAdmitted', 'error.repeat_closed', 'error.deadline_passed']) {
    for (const dict of [ru, ky, en]) assert.ok(dict[key], key);
  }
  assert.equal(ru['error.repeat_closed'], 'Повторный курс закрыт или отменён: изменить нельзя.');
  assert.equal(ru['error.deadline_passed'], 'Срок повтора вышел: баллы не ставятся, пока деканат не продлит срок.');
});

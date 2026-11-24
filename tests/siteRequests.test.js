import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markToText, textToMark, valueLine, targetLine, statusView, requestProblems, markRequestNeeded, normalizePoints, queueParts, stepText } from '../site/js/requests.js';
import { markText, parseMarkText } from '../core/requests.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';

const MARKS = [null, { status: 'present', noCoat: false, activity: null }, { status: 'madeup', noCoat: true, activity: 7 }, { status: 'absent', noCoat: false, activity: 0 }, { status: 'late', noCoat: true, activity: null }];
const TEXTS = ['', 'present|0|', 'madeup|1|7', 'absent|0|0', 'bogus|0|', 'present|2|', 'present|0|x', 'a|b', 5, undefined];

test('markToText and textToMark give what core/requests.js gives', () => {
  for (const m of MARKS) assert.equal(markToText(m), markText(m));
  for (const text of TEXTS) assert.deepEqual(textToMark(text), parseMarkText(text), String(text));
});

test('valueLine: numbers, the empty value, the calculated one, the exam words and a mark', () => {
  assert.deepEqual(valueLine('control', '31'), { key: 'request.value.number', params: { value: '31' }, keyParams: [] });
  assert.deepEqual(valueLine('control', ''), { key: 'request.value.none', params: {}, keyParams: [] });
  assert.deepEqual(valueLine('current', ''), { key: 'request.value.auto', params: {}, keyParams: [] });
  assert.deepEqual(valueLine('exam', '24'), { key: 'request.value.number', params: { value: '24' }, keyParams: [] });
  assert.deepEqual(valueLine('exam', 'absent'), { key: 'ledger.exam.absent', params: {}, keyParams: [] });
  assert.deepEqual(valueLine('exam', 'incomplete'), { key: 'ledger.exam.incomplete', params: {}, keyParams: [] });
  assert.deepEqual(valueLine('mark', 'madeup|1|7'), { key: 'request.value.mark', params: { status: 'journal.marks.status.madeup', activity: 7, coat: true }, keyParams: ['status'] });
  assert.deepEqual(valueLine('mark', 'present|0|'), { key: 'request.value.mark', params: { status: 'journal.marks.status.present', activity: null, coat: false }, keyParams: ['status'] });
  assert.deepEqual(valueLine('mark', ''), { key: 'request.value.none', params: {}, keyParams: [] });
});

test('targetLine for the six kinds', () => {
  assert.deepEqual(targetLine({ kind: 'control', unit: 2 }), { key: 'request.target.control', params: { unit: 2 } });
  assert.deepEqual(targetLine({ kind: 'self', unit: 1 }), { key: 'request.target.self', params: { unit: 1 } });
  assert.deepEqual(targetLine({ kind: 'current', unit: 3 }), { key: 'request.target.current', params: { unit: 3 } });
  assert.deepEqual(targetLine({ kind: 'mark', pairDate: '2026-11-05', pairSlot: 2 }), { key: 'request.target.mark', params: { date: '05.11.2026', slot: 2 } });
  assert.deepEqual(targetLine({ kind: 'work', assignmentTitle: 'Эссе' }), { key: 'request.target.work', params: { title: 'Эссе' } });
  assert.deepEqual(targetLine({ kind: 'exam', attemptNo: 2 }), { key: 'request.target.exam', params: { no: 2 } });
});

test('statusView: the six states', () => {
  assert.deepEqual(['dean', 'prorector', 'applied', 'rejected', 'stale', 'withdrawn'].map(statusView), [
    { key: 'request.status.dean', tone: 'warning' }, { key: 'request.status.prorector', tone: 'warning' }, { key: 'request.status.applied', tone: 'success' },
    { key: 'request.status.rejected', tone: 'danger' }, { key: 'request.status.stale', tone: 'danger' }, { key: 'request.status.withdrawn', tone: 'neutral' }]);
});

test('requestProblems: the fields of the answer become texts of the form', () => {
  const codes = ['bad_value', 'same', 'changed', 'required', 'too_long', 'not_allowed', 'self_by_work', 'bad_ref', 'no_attempt'];
  const map = requestProblems(codes.map((code, i) => ({ field: 'f' + i, code })));
  codes.forEach((code, i) => assert.equal(map.get('f' + i), 'request.form.error.' + code));
  for (const code of codes) for (const dict of [ru, ky, en]) assert.ok(dict['request.form.error.' + code], code);
  assert.equal(requestProblems([{ field: 'after', code: 'weird' }]).get('after'), 'request.form.error.bad_value');
  assert.equal(requestProblems(undefined).size, 0);
});

test('markRequestNeeded: a closed unit always, an open one only after the term and beyond the two small changes', () => {
  const absent = { status: 'absent', noCoat: false, activity: null };
  const toNext = (status) => ({ status, noCoat: false, activity: null });
  const held = (over) => ({ status: 'closed', unit: 1, state: 'open', ...over });
  const closedUnit = { closed: { units: [1] } };
  const openUnit = { closed: { units: [] } };
  assert.equal(markRequestNeeded(held(), closedUnit, absent, toNext('excused')), true);
  assert.equal(markRequestNeeded(held(), openUnit, absent, toNext('present')), false);
  assert.equal(markRequestNeeded(held({ state: 'late' }), openUnit, absent, toNext('excused')), false);
  assert.equal(markRequestNeeded(held({ state: 'late' }), openUnit, absent, toNext('madeup')), false);
  assert.equal(markRequestNeeded(held({ state: 'late' }), openUnit, absent, toNext('present')), true);
  assert.equal(markRequestNeeded(held({ state: 'late' }), openUnit, null, toNext('present')), true);
  assert.equal(markRequestNeeded(held({ status: 'planned' }), closedUnit, absent, toNext('present')), false);
});

test('normalizePoints: digits without leading zeros, nothing else', () => {
  assert.equal(normalizePoints('025'), '25');
  assert.equal(normalizePoints(' 7 '), '7');
  assert.equal(normalizePoints('000'), '0');
  assert.equal(normalizePoints(''), '');
  assert.equal(normalizePoints('2,5'), null);
  assert.equal(normalizePoints('-1'), null);
  assert.equal(normalizePoints('1234'), null);
});

test('the dictionaries have the texts of the request screens', () => {
  const keys = ['error.not_needed', 'error.request_exists', 'error.request_closed', 'error.request_changed', 'error.too_many', 'request.title', 'request.submit', 'request.mine.empty'];
  for (const dict of [ru, ky, en]) for (const key of keys) assert.ok(dict[key], key);
  for (const kind of ['control', 'self', 'current', 'mark', 'work', 'exam']) for (const dict of [ru, ky, en]) assert.ok(dict['request.target.' + kind], kind);
});

const req = (id, status, decide) => ({ id, status, can: { decide, withdraw: false } });

test('queueParts: the ones to decide, the open ones of others and the closed, in the order of the answer', () => {
  const list = [req('a', 'dean', true), req('b', 'prorector', false), req('c', 'prorector', true), req('d', 'applied', false), req('e', 'rejected', false), req('f', 'stale', false)];
  const parts = queueParts(list);
  assert.deepEqual(parts.mine.map((r) => r.id), ['a', 'c']);
  assert.deepEqual(parts.waiting.map((r) => r.id), ['b']);
  assert.deepEqual(parts.closed.map((r) => r.id), ['d', 'e', 'f']);
  assert.deepEqual(queueParts(undefined), { mine: [], waiting: [], closed: [] });
  // a closed request is never "to decide", whatever the flag says
  assert.deepEqual(queueParts([req('x', 'applied', true)]).mine, []);
});

test('stepText: whose decision an open request waits for', () => {
  assert.deepEqual(stepText({ status: 'dean' }), { key: 'request.step.dean' });
  assert.deepEqual(stepText({ status: 'prorector' }), { key: 'request.step.prorector' });
  assert.equal(stepText({ status: 'applied' }), null);
});

test('the keys of the queue screen are in the three dictionaries', () => {
  for (const key of ['request.queue.title', 'request.queue.hint', 'request.step.dean', 'request.step.prorector', 'request.queue.decided.dean', 'request.queue.decided.prorector', 'request.queue.decided.stale', 'request.queue.decided.changed', 'journal.log.byRequest', 'journal.log.exam.score', 'journal.log.subjectExam.result', 'journal.log.ledger.closed', 'journal.log.ledger.opened', 'journal.log.ledger.finalClosed', 'journal.log.ledger.finalOpened', 'home.requests.waiting']) {
    for (const dict of [ru, ky, en]) assert.ok(typeof dict[key] === 'string' && dict[key] !== '', key);
  }
});

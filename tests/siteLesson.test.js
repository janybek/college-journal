import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortName, clockText, qrLink, arrivedList, stageOf, todayAction, lessonDraft, lessonChanges, sourceKey, readQrLink, cleanCode, checkinMessage, cameMark } from '../site/js/lesson.js';
import { deviceId, keepPass, takePass } from '../site/js/device.js';

test('shortName: surname and the first initial', () => {
  assert.deepEqual(['Асанов Айдар Бекович', ' Өмүров Канат ', 'Асанов', '  '].map(shortName), ['Асанов А.', 'Өмүров К.', 'Асанов', '']);
});

test('clockText: seconds rounded up, never negative', () => {
  assert.deepEqual([0, 1, 59999, 286000, 5386000, -5, null].map(clockText), ['00:00', '00:01', '01:00', '04:46', '89:46', '00:00', '00:00']);
});

test('qrLink: everything before the # and the pass address', () => {
  assert.equal(qrLink('https://x.io/college-journal/#/lesson/p_1', 'p_1', 'ab'.repeat(8)), 'https://x.io/college-journal/#/q/p_1/' + 'ab'.repeat(8));
  assert.equal(qrLink('http://localhost:5273/', 'p/1', 'ab'.repeat(8)), 'http://localhost:5273/#/q/p%2F1/' + 'ab'.repeat(8));
});

const L = { phase: 'checkin', students: [
  { id: 's1', fullName: 'Ёлкин Бакыт', mark: { status: 'present' }, checkin: { at: '08:01:10' } },
  { id: 's2', fullName: 'Асанов Айдар', mark: { status: 'present' }, checkin: { at: '08:00:05' } },
  { id: 's3', fullName: 'Беков Нурлан', mark: { status: 'absent' }, checkin: null },
  { id: 's4', fullName: 'Абаев Тимур', mark: { status: 'late' }, checkin: null },
  { id: 's5', fullName: 'Жунусов Али', mark: null, checkin: null }] };

test('arrivedList: by check-in time, those without it last, then by name', () => {
  assert.deepEqual(arrivedList(L).map((x) => x.name), ['Асанов А.', 'Ёлкин Б.', 'Абаев Т.']);
  assert.deepEqual(arrivedList({ students: [] }), []);
});

test('stageOf: the chosen tab wins while it exists', () => {
  assert.deepEqual([stageOf(L, null), stageOf(L, 'summary'), stageOf({ phase: 'lesson' }, null), stageOf({ phase: 'lesson' }, 'checkin'), stageOf({ phase: 'over' }, null), stageOf({ phase: 'none' }, 'material')],
    ['checkin', 'summary', 'material', 'material', 'summary', 'material']);
  assert.equal(stageOf({ phase: 'none' }, null), 'summary');
});

test('todayAction: what the pair offers', () => {
  assert.deepEqual([{ lesson: 'start' }, { lesson: 'open' }, { lesson: null }, {}].map(todayAction), ['start', 'open', null, null]);
});

const S = (id, fullName, mark, extra = {}) => ({ id, fullName, left: false, mark, checkin: null, ...extra });
const SUM = { students: [
  S('a', 'Асанов Айдар', { status: 'present', noCoat: false, activity: null, source: 'code' }, { checkin: { at: '08:01:10', way: 'code' } }),
  S('b', 'Беков Нурлан', null),
  S('c', 'Чолпонов Тимур', { status: 'absent', noCoat: false, activity: null, source: 'auto' }),
  S('d', 'Выбывший Иван', { status: 'present', noCoat: false, activity: null, source: 'teacher' }, { left: true })] };

test('lessonDraft: active students only; a student without a mark has status null', () => {
  assert.deepEqual(lessonDraft(SUM).map((m) => [m.studentId, m.fullName, m.status, m.noCoat, m.activity]), [
    ['a', 'Асанов Айдар', 'present', false, null], ['b', 'Беков Нурлан', null, false, null], ['c', 'Чолпонов Тимур', 'absent', false, null]]);
  assert.deepEqual(lessonDraft(SUM)[0].checkin, { at: '08:01:10', way: 'code' });
  assert.deepEqual(lessonDraft({ students: [] }), []);
});

test('lessonChanges: only what changed and has a status', () => {
  assert.deepEqual(lessonChanges(lessonDraft(SUM), SUM), []);
  const one = lessonDraft(SUM);
  one[0].activity = 4;
  assert.deepEqual(lessonChanges(one, SUM), [{ studentId: 'a', status: 'present', noCoat: false, activity: 4 }]);
  const two = lessonDraft(SUM);
  two[2].status = 'late';
  two[1].noCoat = true;
  assert.deepEqual(lessonChanges(two, SUM), [{ studentId: 'c', status: 'late', noCoat: false, activity: null }]);
  const three = lessonDraft(SUM);
  three[1].status = 'present';
  assert.deepEqual(lessonChanges(three, SUM), [{ studentId: 'b', status: 'present', noCoat: false, activity: null }]);
});

test('sourceKey: where the mark came from', () => {
  const key = (source) => sourceKey({ mark: { source } });
  assert.deepEqual(['code', 'qr', 'auto', 'teacher'].map(key), ['lesson.source.code', 'lesson.source.qr', 'lesson.source.auto', 'lesson.source.teacher']);
  assert.equal(sourceKey({ mark: null }), null);
  assert.equal(sourceKey({}), null);
});

test('readQrLink: the pair and the key from the address of the QR; anything else is null', () => {
  assert.deepEqual(readQrLink('#/q/p_1/' + 'ab'.repeat(8)), { pairId: 'p_1', qr: 'ab'.repeat(8) });
  assert.deepEqual(readQrLink('#/q/p%2F1/' + 'ab'.repeat(8)), { pairId: 'p/1', qr: 'ab'.repeat(8) });
  for (const bad of ['#/q/p_1/' + 'AB'.repeat(8), '#/q/p_1/abc', '#/q/p_1/' + 'ab'.repeat(8) + '/x', '#/q//' + 'ab'.repeat(8), '#/q/%E0%A4%A/' + 'ab'.repeat(8), '#/here', '', null]) assert.equal(readQrLink(bad), null, String(bad));
});

test('cleanCode: digits only, the first four', () => {
  assert.deepEqual([' 4 8-2 7', '48271', 'abc', null].map(cleanCode), ['4827', '4827', '', '']);
});

test('checkinMessage: an answer or an error code becomes a text key, its values and a tone', () => {
  assert.deepEqual(checkinMessage({ result: 'wrong_code', attemptsLeft: 3 }), { key: 'checkin.wrong', params: { n: 3 }, tone: 'danger' });
  assert.deepEqual(checkinMessage({ result: 'ok', at: '08:03' }), { key: 'checkin.ok', params: { at: '08:03' }, tone: 'success' });
  assert.deepEqual(checkinMessage({ result: 'already', status: 'late', at: '08:03' }), { key: 'checkin.already', params: { at: '08:03' }, tone: 'success' });
  for (const status of ['absent', 'excused']) assert.deepEqual(checkinMessage({ result: 'already', status, at: '08:03' }), { key: 'checkin.alreadyOther', params: {}, tone: 'warning' }, status);
  assert.equal(checkinMessage('device_used').key, 'error.device_used');
  assert.equal(checkinMessage('device_used').tone, 'danger');
  assert.equal(checkinMessage('code_expired').tone, 'warning');
  for (const code of ['code_expired', 'too_many_codes', 'device_used', 'window_closed', 'not_running', 'bad_pass', 'bad_code', 'forbidden']) {
    assert.equal(checkinMessage(code).key, 'error.' + code, code);
    assert.deepEqual(['warning', 'danger'].includes(checkinMessage(code).tone), true, code);
  }
});

test('deviceId: 32 hex characters, the same on every call; a pass is taken once', () => {
  const first = deviceId();
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal(deviceId(), first);
  keepPass({ pairId: 'p_1', pass: 'pass1.x' });
  assert.equal(takePass('p_2'), null);
  assert.equal(takePass('p_1'), 'pass1.x');
  assert.equal(takePass('p_1'), null);
});

test('cameMark: present, late and made-up marks count as a check-in; «не был» and no mark do not', () => {
  assert.deepEqual(['present', 'late', 'madeup', 'absent', 'excused'].map((status) => cameMark({ status })), [true, true, true, false, false]);
  assert.deepEqual([null, undefined].map(cameMark), [false, false]);
});

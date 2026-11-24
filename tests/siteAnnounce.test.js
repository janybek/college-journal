import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audienceText, untilText, topItems, announceProblems, firstLine } from '../site/js/announce.js';
import ru from '../site/js/i18n/ru.js';
import ky from '../site/js/i18n/ky.js';
import en from '../site/js/i18n/en.js';

test('audienceText: to everybody, to the teachers, to a group', () => {
  assert.deepEqual(audienceText({ audience: 'all', groupName: '' }), { key: 'announce.to.all', params: {} });
  assert.deepEqual(audienceText({ audience: 'teachers', groupName: '' }), { key: 'announce.to.teachers', params: {} });
  assert.deepEqual(audienceText({ audience: 'group', groupName: '01-1' }), { key: 'announce.to.group', params: { group: '01-1' } });
});

test('untilText: today, or the day and month', () => {
  assert.deepEqual(untilText({ until: '2026-11-24' }, '2026-11-24'), { key: 'announce.until.today', params: {} });
  assert.deepEqual(untilText({ until: '2026-12-05' }, '2026-11-24'), { key: 'announce.until.date', params: { date: '05.12' } });
});

test('topItems: the first three in the order of the answer, fewer when there are fewer', () => {
  const list = [1, 2, 3, 4, 5].map((id) => ({ id }));
  assert.deepEqual(topItems(list).map((i) => i.id), [1, 2, 3]);
  assert.deepEqual(topItems(list.slice(0, 2)).map((i) => i.id), [1, 2]);
  assert.deepEqual(topItems(list, 1).map((i) => i.id), [1]);
  assert.deepEqual(topItems(undefined), []);
});

test('firstLine: the first non-empty line of a text', () => {
  assert.equal(firstLine('\n  Первая строка \nвторая'), 'Первая строка');
  assert.equal(firstLine(''), '');
  assert.equal(firstLine(undefined), '');
});

test('announceProblems: the fields of the answer become the texts of the form', () => {
  const codes = ['empty', 'too_long', 'bad_ref', 'bad_value', 'in_past', 'too_far'];
  const map = announceProblems(codes.map((code, i) => ({ field: 'f' + i, code })));
  codes.forEach((code, i) => assert.equal(map.get('f' + i), 'announce.form.error.' + code));
  for (const code of codes) for (const dict of [ru, ky, en]) assert.ok(dict['announce.form.error.' + code], code);
  assert.equal(announceProblems([{ field: 'title', code: 'weird' }]).get('title'), 'announce.form.error.bad_value');
  assert.equal(announceProblems([{ field: 'title', code: 'empty' }, { field: 'title', code: 'too_long' }]).get('title'), 'announce.form.error.empty');
  assert.equal(announceProblems(undefined).size, 0);
});

test('announce texts exist in every language with the same keys', () => {
  const src = Object.keys(ru).filter((key) => key.startsWith('announce.'));
  assert.ok(src.length > 30);
  for (const [lang, dict] of Object.entries({ ky, en })) {
    assert.deepEqual(Object.keys(dict).filter((key) => key.startsWith('announce.')).sort(), src.slice().sort(), lang);
  }
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    assert.ok(dict['announce.to.group'].includes('{group}'), lang);
    assert.ok(dict['announce.until.date'].includes('{date}'), lang);
    assert.ok(dict['announce.error.too_many'].includes('{n}'), lang);
    assert.ok(dict['announce.remove.text'].includes('{title}'), lang);
    assert.ok(dict['announce.by'].includes('{name}') && dict['announce.by'].includes('{date}'), lang);
  }
});

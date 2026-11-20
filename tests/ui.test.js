import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTheme } from '../site/js/theme.js';
import { initials, avatarTone, AVATAR_TONES } from '../site/js/ui.js';
import { navFor } from '../site/js/shell.js';

test('pickTheme: only a stored "light" gives the light theme; dark is the default', () => {
  assert.equal(pickTheme('light'), 'light');
  assert.equal(pickTheme('dark'), 'dark');
  assert.equal(pickTheme(null), 'dark');
  assert.equal(pickTheme(undefined), 'dark');
  assert.equal(pickTheme(''), 'dark');
  assert.equal(pickTheme('LIGHT'), 'dark');
  assert.equal(pickTheme('{"theme":"light"}'), 'dark');
});

test('initials: first letters of the first two words, one letter for one word, a fallback for none', () => {
  assert.equal(initials('Asanov Aidar'), 'AA');
  assert.equal(initials('  асанов   айдар  бекович '), 'АА');
  assert.equal(initials('өмүрбек үсөнов'), 'ӨҮ');
  assert.equal(initials('Мээрим'), 'М');
  assert.equal(initials(''), '?');
  assert.equal(initials('   '), '?');
  assert.equal(initials(null), '?');
  assert.equal(initials(undefined), '?');
});

test('avatarTone: the same name always gets the same tone, and names spread over the tones', () => {
  const names = ['Asanov Aidar', 'Bekov Aizada', 'Isaev Bakyt', 'Orozov Meerim', 'Usenov Talant', 'Dean Demo', 'Admin Demo', 'Teacher One'];
  for (const name of names) {
    const tone = avatarTone(name);
    assert.ok(Number.isInteger(tone) && tone >= 0 && tone < AVATAR_TONES, name);
    assert.equal(avatarTone(name), tone, name);
  }
  assert.equal(avatarTone('  asanov   AIDAR '), avatarTone('Asanov Aidar'));
  assert.ok(new Set(names.map(avatarTone)).size > 2);
  assert.equal(avatarTone(''), avatarTone(null));
});

const DEAN = ['dir.list:groups', 'dir.list:rooms', 'dir.list:staff', 'dir.list:students', 'dir.list:subjects',
  'import.apply:groups', 'import.apply:students', 'teacher.mySubjects'];
const outline = (groups) => groups.map((group) => [group.titleKey, group.items.map((item) => item.name)]);

test('navFor: the office roles see the directories they may list and the import screen', () => {
  assert.deepEqual(outline(navFor(DEAN, 'dean')), [
    [null, ['home']],
    ['home.directories', ['groups', 'students', 'staff', 'subjects', 'rooms']],
    ['nav.data', ['import']],
  ]);
  assert.deepEqual(outline(navFor(['dir.list:groups', 'dir.list:rooms'], 'prorector')), [
    [null, ['home']],
    ['home.directories', ['groups', 'rooms']],
  ]);
  const [home] = navFor(DEAN, 'dean');
  assert.deepEqual(home.items[0], { name: 'home', href: '#/', textKey: 'nav.home', icon: 'home' });
  assert.equal(navFor(DEAN, 'dean')[1].items[1].href, '#/dir/students');
});

test('navFor: the teacher role sees its subjects; nothing is shown without permissions', () => {
  assert.deepEqual(outline(navFor(DEAN, 'teacher')), [['nav.teaching', ['home']]]);
  assert.equal(navFor(DEAN, 'teacher')[0].items[0].textKey, 'home.mySubjects');
  assert.deepEqual(outline(navFor([], 'teacher')), [[null, ['home']]]);
  assert.deepEqual(outline(navFor([], 'dean')), [[null, ['home']]]);
  assert.deepEqual(outline(navFor(undefined, undefined)), [[null, ['home']]]);
});

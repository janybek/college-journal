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
    ['home.directories', ['groups', 'students', 'staff', 'rooms']],
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

test('navFor: the office roles with settings.get get a schedule group between home and the directories', () => {
  assert.deepEqual(outline(navFor([...DEAN, 'settings.get'], 'dean')), [
    [null, ['home']],
    ['nav.schedule', ['settings']],
    ['home.directories', ['groups', 'students', 'staff', 'rooms']],
    ['nav.data', ['import']],
  ]);
  assert.deepEqual(navFor([...DEAN, 'settings.get'], 'dean')[1].items[0],
    { name: 'settings', href: '#/settings', textKey: 'settings.title', icon: 'settings', hintKey: 'settings.hint' });
  assert.deepEqual(outline(navFor(DEAN, 'dean')).map(([title]) => title), [null, 'home.directories', 'nav.data']);
  assert.deepEqual(outline(navFor(['settings.get'], 'teacher')), [[null, ['home']]]);
});

test('navFor: the week template comes before the settings in the schedule group', () => {
  assert.deepEqual(outline(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate'], 'dean'))[1], ['nav.schedule', ['weekTemplate', 'settings']]);
  assert.deepEqual(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate'], 'dean')[1].items[0],
    { name: 'weekTemplate', href: '#/template', textKey: 'template.title', icon: 'grid', hintKey: 'template.hint' });
  assert.deepEqual(outline(navFor([...DEAN, 'dir.list:weekTemplate'], 'dean'))[1], ['nav.schedule', ['weekTemplate']]);
});

test('navFor: «Предметы» of the deanery is in the schedule group, «Дисциплины» in the directories, subjects are no directory', () => {
  const nav = navFor(['schedule.list', 'dir.list:weekTemplate', 'subjects.overview', 'settings.get', 'dir.list:groups', 'dir.list:disciplines', 'dir.list:subjects'], 'dean');
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['schedule', 'weekTemplate', 'subjects', 'settings']);
  assert.deepEqual(nav.find((g) => g.titleKey === 'home.directories').items.map((i) => i.name), ['groups', 'disciplines']);
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items[2],
    { name: 'subjects', href: '#/subjects', textKey: 'subjects.title', icon: 'book', hintKey: 'subjects.hint' });
  assert.equal(navFor(['subjects.overview'], 'teacher').flatMap((g) => g.items).some((i) => i.name === 'subjects'), false);
});

test('navFor: «Силлабусы на утверждении» comes after «Предметы» with the right to the queue, and carries the count', () => {
  const office = ['schedule.list', 'dir.list:weekTemplate', 'subjects.overview', 'settings.get'];
  const nav = navFor([...office, 'syllabus.queue'], 'dean');
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['schedule', 'weekTemplate', 'subjects', 'review', 'settings']);
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items[3],
    { name: 'review', href: '#/review', textKey: 'review.title', icon: 'clipboard', hintKey: 'review.hint', count: true });
  assert.deepEqual(navFor(office, 'dean').find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['schedule', 'weekTemplate', 'subjects', 'settings']);
  assert.equal(navFor(['syllabus.queue', 'teacher.mySubjects'], 'teacher').flatMap((g) => g.items).some((i) => i.name === 'review'), false);
  assert.deepEqual(navFor(['subjects.overview', 'syllabus.queue'], 'prorector').find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['subjects', 'review']);
});

test('navFor: the deanery menu has no «Темы» any more', () => {
  assert.equal(navFor(['schedule.list', 'dir.list:weekTemplate', 'dir.list:topics', 'settings.get'], 'dean').flatMap((g) => g.items).some((i) => i.name === 'topics'), false);
});

test('navFor: the schedule itself comes first in the schedule group', () => {
  assert.deepEqual(outline(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate', 'dir.list:topics', 'schedule.list'], 'dean'))[1],
    ['nav.schedule', ['schedule', 'weekTemplate', 'settings']]);
  assert.deepEqual(navFor([...DEAN, 'schedule.list'], 'dean')[1].items[0],
    { name: 'schedule', href: '#/schedule', textKey: 'schedule.title', icon: 'calendar', hintKey: 'schedule.hint' });
  assert.deepEqual(outline(navFor(['schedule.list'], 'teacher')), [[null, ['home']]]);
});

test('navFor: every item but home names the hint its tile shows', () => {
  for (const group of navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate', 'dir.list:topics', 'schedule.list'], 'dean').slice(1)) {
    for (const item of group.items) assert.equal(typeof item.hintKey, 'string', item.name);
  }
  assert.equal(navFor(DEAN, 'dean')[1].items[0].hintKey, 'dir.groups.hint');
  assert.equal(navFor(DEAN, 'dean')[2].items[0].hintKey, 'import.hint');
});

test('navFor: the teacher role sees its subjects; nothing is shown without permissions', () => {
  assert.deepEqual(outline(navFor(DEAN, 'teacher')), [['nav.teaching', ['home']]]);
  assert.equal(navFor(DEAN, 'teacher')[0].items[0].textKey, 'home.mySubjects');
  assert.deepEqual(outline(navFor([], 'teacher')), [[null, ['home']]]);
  assert.deepEqual(outline(navFor([], 'dean')), [[null, ['home']]]);
  assert.deepEqual(outline(navFor(undefined, undefined)), [[null, ['home']]]);
});

test('navFor: a teacher with schedule.mine gets «Моё расписание» after «Мои предметы»', () => {
  assert.deepEqual(outline(navFor([...DEAN, 'schedule.mine'], 'teacher')), [['nav.teaching', ['home', 'mySchedule']]]);
  assert.deepEqual(outline(navFor(DEAN, 'teacher')), [['nav.teaching', ['home']]]);
  assert.deepEqual(navFor([...DEAN, 'schedule.mine'], 'teacher')[0].items[1],
    { name: 'mySchedule', href: '#/my', textKey: 'my.title', icon: 'calendar' });
});

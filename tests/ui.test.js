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

test('navFor: «Документы» takes the place of the review queue; the count only with the right to the queue; no item «review»', () => {
  const office = ['schedule.list', 'dir.list:weekTemplate', 'subjects.overview', 'settings.get', 'docs.syllabi'];
  const nav = navFor([...office, 'syllabus.queue'], 'dean');
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['schedule', 'weekTemplate', 'subjects', 'documents', 'settings']);
  assert.deepEqual(nav.find((g) => g.titleKey === 'nav.schedule').items[3],
    { name: 'documents', href: '#/documents', textKey: 'docs.title', icon: 'clipboard', count: true, hintKey: 'docs.hint' });
  assert.equal(navFor(office, 'prorector').flatMap((g) => g.items).find((i) => i.name === 'documents').count, false);
  assert.deepEqual(navFor(['subjects.overview', 'docs.syllabi', 'syllabus.queue'], 'prorector').find((g) => g.titleKey === 'nav.schedule').items.map((i) => i.name), ['subjects', 'documents']);
  const teacher = navFor(['teacher.mySubjects', 'docs.syllabi', 'announce.list'], 'teacher').flatMap((g) => g.items);
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'documents', 'announcements']);
  assert.equal(teacher[1].count, false);
  for (const roleNav of [nav, navFor(['docs.syllabi', 'syllabus.queue'], 'admin')]) assert.equal(roleNav.flatMap((g) => g.items).some((i) => i.name === 'review'), false);
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

test('navFor: the teacher gets «Журнал» after «Моё расписание»; the office a group «Журнал» before «Расписание»; the student nothing', () => {
  assert.deepEqual(navFor([...DEAN, 'schedule.mine', 'journal.list'], 'teacher')[0].items.map((i) => i.name), ['home', 'mySchedule', 'journalList']);
  assert.deepEqual(navFor([...DEAN, 'schedule.mine', 'journal.list'], 'teacher')[0].items[2],
    { name: 'journalList', href: '#/journal', textKey: 'journal.title', icon: 'table' });
  const office = navFor(['schedule.list', 'settings.get', 'journal.list', 'journal.get'], 'dean');
  assert.deepEqual(office.map((g) => g.titleKey), [null, 'nav.journal', 'nav.schedule']);
  assert.deepEqual(office[1].items.map((i) => i.name), ['journalList']);
  assert.equal(office[1].items[0].hintKey, 'journal.hint');
  assert.equal(office[1].items[0].href, '#/journal');
  for (const role of ['admin', 'prorector']) assert.ok(navFor(['journal.list'], role).some((g) => g.titleKey === 'nav.journal'), role);
  assert.equal(navFor(['schedule.list'], 'dean').some((g) => g.titleKey === 'nav.journal'), false);
  assert.equal(navFor(['journal.list', 'schedule.mine'], 'student').flatMap((g) => g.items).some((i) => i.name === 'journalList'), false);
});

test('navFor: the group «Журнал» of the office has «Журнал изменений» as the second item; the teacher has none', () => {
  const office = navFor(['schedule.list', 'journal.list', 'journal.get', 'journal.log'], 'dean');
  const group = office.find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(group.items.map((i) => i.name), ['journalList', 'journalLog']);
  assert.equal(group.items[1].href, '#/journal-log');
  assert.equal(group.items[1].textKey, 'journalLog.title');
  assert.equal(navFor(['journal.list', 'journal.log'], 'teacher').flatMap((g) => g.items).some((i) => i.name === 'journalLog'), false);
  assert.equal(navFor(['journal.list'], 'dean').find((g) => g.titleKey === 'nav.journal').items.length, 1);
});

test('scrollToShow: the menu moves only when the current item is out of view', async () => {
  const { scrollToShow } = await import('../site/js/shell.js');
  assert.equal(scrollToShow(120, 300, 150, 190), 120);
  assert.equal(scrollToShow(120, 300, 50, 90), 50);
  assert.equal(scrollToShow(0, 300, 380, 420), 120);
  assert.equal(scrollToShow(0, 300, 380, 420, 48), 168);
  assert.equal(scrollToShow(100, 300, 40, 80, 48), 0);
});

test('navFor: «Задания» follows «Журнал» for the teacher and sits in the group «Журнал» of the office, with the right to the overview', () => {
  const teacher = navFor([...DEAN, 'schedule.mine', 'journal.list', 'work.overview'], 'teacher')[0].items;
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'mySchedule', 'journalList', 'tasks']);
  assert.deepEqual(teacher[3], { name: 'tasks', href: '#/tasks', textKey: 'tasks.title', icon: 'clipboard' });
  assert.equal(navFor([...DEAN, 'journal.list'], 'teacher')[0].items.some((i) => i.name === 'tasks'), false);
  const office = navFor(['journal.list', 'journal.log', 'work.overview'], 'dean').find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(office.items.map((i) => i.name), ['journalList', 'tasks', 'journalLog']);
  assert.equal(office.items[1].href, '#/tasks');
  assert.equal(navFor(['work.mine', 'schedule.mine'], 'student').flatMap((g) => g.items).some((i) => i.name === 'tasks'), false);
});

test('navFor: «Ведомости» follow «Задания» for the teacher and «Журналы» in the group of the office, with the right ledger.list', () => {
  const teacher = navFor([...DEAN, 'schedule.mine', 'journal.list', 'work.overview', 'ledger.list'], 'teacher')[0].items;
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'mySchedule', 'journalList', 'tasks', 'ledgerList']);
  assert.deepEqual(teacher[4], { name: 'ledgerList', href: '#/ledger', textKey: 'ledger.title', icon: 'sheet' });
  assert.equal(navFor([...DEAN, 'journal.list'], 'teacher')[0].items.some((i) => i.name === 'ledgerList'), false);
  const office = navFor(['journal.list', 'journal.log', 'work.overview', 'ledger.list'], 'dean').find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(office.items.map((i) => i.name), ['journalList', 'ledgerList', 'tasks', 'journalLog']);
  assert.equal(office.items[1].href, '#/ledger');
  assert.equal(office.items[1].hintKey, 'ledger.hint');
  assert.equal(navFor(['schedule.mine'], 'student').flatMap((g) => g.items).some((i) => i.name === 'ledgerList'), false);
});

test('navFor: «Заявки» come after «Ведомости» for a teacher with request.mine, and only for the teacher menu', () => {
  const items = navFor([...DEAN, 'schedule.mine', 'journal.list', 'work.overview', 'ledger.list', 'request.mine'], 'teacher')[0].items;
  assert.deepEqual(items.map((i) => i.name), ['home', 'mySchedule', 'journalList', 'tasks', 'ledgerList', 'requests']);
  assert.deepEqual(items[5], { name: 'requests', href: '#/requests', textKey: 'request.mine.title', icon: 'clipboard' });
  assert.equal(navFor([...DEAN, 'journal.list'], 'teacher')[0].items.some((i) => i.name === 'requests'), false);
});

test('navFor: «Заявки» of the office come after «Задания», for those with request.queue', () => {
  const office = navFor(['journal.list', 'journal.log', 'work.overview', 'ledger.list', 'request.queue'], 'dean').find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(office.items.map((i) => i.name), ['journalList', 'ledgerList', 'tasks', 'requests', 'journalLog']);
  assert.deepEqual(office.items[3], { name: 'requests', href: '#/requests', textKey: 'request.queue.title', icon: 'clipboard', hintKey: 'request.queue.hint' });
  assert.equal(navFor(['journal.list', 'work.overview'], 'dean').flatMap((g) => g.items).some((i) => i.name === 'requests'), false);
});

test('navFor: «Гос. экзамены» come after «Заявки», in the journal group of the office and in the teacher menu', () => {
  const office = navFor(['journal.list', 'journal.log', 'work.overview', 'ledger.list', 'request.queue', 'stateExam.list'], 'dean').find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(office.items.map((i) => i.name), ['journalList', 'ledgerList', 'tasks', 'requests', 'stateExams', 'journalLog']);
  assert.deepEqual(office.items[4], { name: 'stateExams', href: '#/state-exams', textKey: 'stateExam.title', icon: 'sheet', hintKey: 'stateExam.hint' });
  const teacher = navFor([...DEAN, 'schedule.mine', 'journal.list', 'work.overview', 'ledger.list', 'request.mine', 'stateExam.list'], 'teacher')[0].items;
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'mySchedule', 'journalList', 'tasks', 'ledgerList', 'requests', 'stateExams']);
  assert.deepEqual(teacher[6], { name: 'stateExams', href: '#/state-exams', textKey: 'stateExam.title', icon: 'sheet' });
  assert.equal(navFor(['journal.list'], 'dean').flatMap((g) => g.items).some((i) => i.name === 'stateExams'), false);
  assert.equal(navFor(['schedule.mine'], 'student').flatMap((g) => g.items).some((i) => i.name === 'stateExams'), false);
});

test('navFor: «Объявления» come right after home for the office and after the state exams for the teacher', () => {
  const office = navFor(['journal.list', 'stateExam.list', 'announce.list'], 'dean');
  assert.deepEqual(office[0].items.map((i) => i.name), ['home', 'announcements']);
  assert.deepEqual(office[0].items[1], { name: 'announcements', href: '#/announcements', textKey: 'announce.title', icon: 'bell' });
  assert.deepEqual(navFor(['announce.list'], 'prorector')[0].items.map((i) => i.name), ['home', 'announcements']);
  const teacher = navFor(['teacher.mySubjects', 'schedule.mine', 'stateExam.list', 'announce.list'], 'teacher')[0].items;
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'mySchedule', 'stateExams', 'announcements']);
  assert.equal(navFor(['journal.list'], 'dean').flatMap((g) => g.items).some((i) => i.name === 'announcements'), false);
  assert.equal(navFor(['announce.list'], 'student').flatMap((g) => g.items).some((i) => i.name === 'announcements'), false);
});

test('navFor: «Повторный курс» follows «Ведомости» for the office and the teacher, and a student has none', () => {
  const office = navFor(['journal.list', 'ledger.list', 'work.overview', 'repeat.list'], 'dean').find((g) => g.titleKey === 'nav.journal');
  assert.deepEqual(office.items.map((i) => i.name), ['journalList', 'ledgerList', 'repeats', 'tasks']);
  assert.deepEqual(office.items[2], { name: 'repeats', href: '#/repeats', textKey: 'repeat.title', icon: 'sheet', hintKey: 'repeat.hint' });
  const teacher = navFor([...DEAN, 'schedule.mine', 'journal.list', 'work.overview', 'ledger.list', 'repeat.list', 'request.mine'], 'teacher')[0].items;
  assert.deepEqual(teacher.map((i) => i.name), ['home', 'mySchedule', 'journalList', 'tasks', 'ledgerList', 'repeats', 'requests']);
  assert.deepEqual(teacher[5], { name: 'repeats', href: '#/repeats', textKey: 'repeat.mine.title', icon: 'sheet' });
  assert.equal(navFor(['schedule.mine'], 'student').flatMap((g) => g.items).some((i) => i.name === 'repeats'), false);
});

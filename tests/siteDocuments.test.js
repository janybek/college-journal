import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_TABS, tabOf, tabCounts, overdue, nextKey, stateKey, teachersLine, openHref, cardHref, candidateLine, candidateParts, chooseError } from '../site/js/documents.js';
import { setLang } from '../site/js/i18n.js';

test('tabs: the three of them, an unknown one is «Утверждённые»', () => {
  assert.deepEqual(DOC_TABS, ['approved', 'review', 'development']);
  assert.equal(tabOf('review'), 'review');
  assert.equal(tabOf('development'), 'development');
  assert.equal(tabOf('x'), 'approved');
  assert.equal(tabOf(undefined), 'approved');
});

test('tabCounts counts the rows of every tab', () => {
  assert.deepEqual(tabCounts({ approved: [1, 2], review: [], development: [1] }), { approved: 2, review: 0, development: 1 });
  assert.deepEqual(tabCounts(null), { approved: 0, review: 0, development: 0 });
});

test('overdue: only a set date before today', () => {
  assert.equal(overdue('2026-11-24', '2026-11-26'), true);
  assert.equal(overdue('', '2026-11-26'), false);
  assert.equal(overdue('2026-11-26', '2026-11-26'), false);
  assert.equal(overdue('2026-12-01', '2026-11-26'), false);
});

test('nextKey and stateKey', () => {
  assert.equal(nextKey('draft'), 'docs.next.draft');
  assert.equal(nextKey('returned'), 'docs.next.draft');
  assert.equal(nextKey('review'), 'docs.next.review');
  assert.equal(nextKey(null), null);
  assert.equal(stateKey('draft'), 'docs.state.draft');
  assert.equal(stateKey('returned'), 'docs.state.returned');
  assert.equal(stateKey('none'), 'docs.state.none');
});

test('teachersLine: surname and initials', () => {
  assert.equal(teachersLine(['Иванова Анна Сергеевна', 'Петров Бакыт Кубанович']), 'Иванова А. С., Петров Б. К.');
  assert.equal(teachersLine(['Асанова']), 'Асанова');
  assert.equal(teachersLine([]), '');
});

test('openHref: the page of the discipline, in its half of the year (the new version: draft)', () => {
  assert.equal(openHref({ disciplineId: 'd1', subjectId: 's1', semester: 2 }), '#/syllabus/d/d1/2');
  assert.equal(openHref({ disciplineId: 'd1', semester: 1, draft: true }), '#/syllabus/d/d1/1/draft');
  assert.equal(openHref({ disciplineId: 'a b', semester: 1 }), '#/syllabus/d/a%20b/1');
  assert.equal(openHref({ disciplineId: 'd1' }), '#/syllabus/d/d1');
  assert.equal(openHref({ semester: 1 }), '#/documents/syllabi');
  assert.equal(cardHref('a b'), '#/documents/discipline/a%20b');
});

test('candidateLine: who, the state and the version, the plan semester and course, the groups', () => {
  setLang('ru');
  const row = { teacherName: 'Иванова Анна Сергеевна', status: 'approved', version: 2, planSemester: 1, course: 1, groups: ['01-1', '02-1'] };
  assert.equal(candidateLine(row), 'Иванова А. С. · утверждён, версия 2 · 1 семестр, 1 курс · группы: 01-1, 02-1');
  assert.equal(candidateLine({ ...row, status: 'review', planSemester: null, course: null, groups: [] }), 'Иванова А. С. · на утверждении, версия 2');
  assert.equal(candidateLine({ teacherName: 'Асанова', status: 'none', version: null, groups: ['03-1'] }), 'Асанова · силлабуса нет · группы: 03-1');
});

test('candidateParts: two lines of the window, «who · state · version» and «semester · course · groups»', () => {
  setLang('ru');
  const row = { teacherName: 'Петров Бакыт Кубанович', status: 'draft', version: 1, planSemester: 3, course: 2, groups: ['02-1'] };
  assert.deepEqual(candidateParts(row), { head: 'Петров Б. К. · черновик · версия 1', meta: '3 семестр · 2 курс · 02-1' });
  assert.deepEqual(candidateParts({ teacherName: 'Асанова', status: 'none', version: null, groups: [] }), { head: 'Асанова · силлабуса нет', meta: '' });
});

test('chooseError: groups and reasons of line_locked, the confirmation of needs_confirm, the code for the rest', () => {
  setLang('ru');
  const locked = chooseError({ code: 'line_locked', fields: [{ field: 'group', code: 'unit_closed', name: '01-1' }, { field: 'group', code: 'exam_exists', name: '02-1' }] });
  assert.equal(locked.key, 'docs.choose.locked');
  assert.deepEqual(locked.params, { groups: '01-1, 02-1', reason: 'закрыт юнит; есть экзамен' });
  assert.equal(locked.confirm, undefined);
  const same = chooseError({ code: 'line_locked', fields: [{ code: 'unit_closed', name: '01-1' }, { code: 'unit_closed', name: '01-2' }] });
  assert.equal(same.params.reason, 'закрыт юнит');
  assert.deepEqual(chooseError({ code: 'needs_confirm' }), { key: 'docs.choose.warning', params: {}, confirm: true });
  assert.deepEqual(chooseError({ code: 'forbidden' }), { key: 'error.forbidden', params: {} });
  assert.deepEqual(chooseError(null), { key: 'error.internal', params: {} });
});

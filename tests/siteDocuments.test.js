import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_TABS, tabOf, tabCounts, overdue, nextKey, stateKey, teachersLine, openHref, cardHref } from '../site/js/documents.js';

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

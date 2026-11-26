import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_TABLES, cardHref, infoById, groupNowLabel, roomNowLabel, syllabusCountBadges, fullDate, termNote, syllabusHalves,
} from '../site/js/dirInfo.js';

test('cardHref and the tables with a card', () => {
  assert.deepEqual(CARD_TABLES, ['groups', 'rooms', 'disciplines']);
  assert.equal(cardHref('groups', 'g 1'), '#/dir/groups/g%201');
  assert.equal(cardHref('rooms', 'r1'), '#/dir/rooms/r1');
});

test('infoById: a map by id, null stays null', () => {
  assert.equal(infoById(null), null);
  const map = infoById({ rows: [{ id: 'a', weekPairs: 1 }, { id: 'b', weekPairs: 2 }] });
  assert.equal(map.get('b').weekPairs, 2);
  assert.equal(map.get('x'), undefined);
});

test('groupNowLabel', () => {
  assert.deepEqual(groupNowLabel({ state: 'busy', until: '10:30', roomName: '101' }), { key: 'dir.now.busy', params: { until: '10:30', room: '101' }, tone: 'success' });
  assert.deepEqual(groupNowLabel({ state: 'busy', until: '10:30', roomName: '' }), { key: 'dir.now.busyNoRoom', params: { until: '10:30' }, tone: 'success' });
  assert.deepEqual(groupNowLabel({ state: 'next', at: '11:20', roomName: '7' }), { key: 'dir.now.next', params: { at: '11:20', room: '7' }, tone: 'info' });
  assert.deepEqual(groupNowLabel({ state: 'next', at: '11:20' }), { key: 'dir.now.nextNoRoom', params: { at: '11:20' }, tone: 'info' });
  assert.deepEqual(groupNowLabel({ state: 'done' }), { key: 'dir.now.done', params: {}, tone: 'neutral' });
  assert.deepEqual(groupNowLabel({ state: 'none' }), { key: 'dir.now.none', params: {}, tone: 'neutral' });
  assert.deepEqual(groupNowLabel(null), { key: 'dir.now.none', params: {}, tone: 'neutral' });
});

test('roomNowLabel', () => {
  assert.deepEqual(roomNowLabel({ state: 'busy', until: '10:30', groupName: '01-1' }), { key: 'dir.room.busy', params: { until: '10:30', group: '01-1' }, tone: 'warning' });
  assert.deepEqual(roomNowLabel({ state: 'free', until: '13:30' }), { key: 'dir.room.free', params: { until: '13:30' }, tone: 'success' });
  assert.deepEqual(roomNowLabel({ state: 'freeRest' }), { key: 'dir.room.freeRest', params: {}, tone: 'success' });
  assert.deepEqual(roomNowLabel({ state: 'freeDay' }), { key: 'dir.room.freeDay', params: {}, tone: 'success' });
});

test('syllabusCountBadges', () => {
  assert.deepEqual(syllabusCountBadges({ approved: 1, review: 0, returned: 1, draft: 0, none: 2 }), [
    { key: 'dir.syllabi.approved', count: 1, tone: 'success' },
    { key: 'dir.syllabi.returned', count: 1, tone: 'warning' },
    { key: 'dir.syllabi.none', count: 2, tone: 'danger' },
  ]);
  assert.deepEqual(syllabusCountBadges({ approved: 0, review: 3, returned: 0, draft: 4, none: 0 }), [
    { key: 'dir.syllabi.review', count: 3, tone: 'info' },
    { key: 'dir.syllabi.draft', count: 4, tone: 'neutral' },
  ]);
  assert.deepEqual(syllabusCountBadges({ approved: 0, review: 0, returned: 0, draft: 0, none: 0 }), [{ key: 'dir.syllabi.nothing', count: 0, tone: 'neutral' }]);
});

test('fullDate', () => {
  assert.equal(fullDate('2026-09-01'), '01.09.2026');
  assert.equal(fullDate('сентябрь'), 'сентябрь');
  assert.equal(fullDate(undefined), '');
});

test('termNote', () => {
  assert.equal(termNote({ rows: [] }), null);
  assert.equal(termNote({ term: 'on' }), null);
  assert.equal(termNote(null), null);
  assert.deepEqual(termNote({ term: 'before', semesterStart: '2026-09-01' }), { key: 'dir.term.before', params: { date: '01.09.2026' } });
  assert.deepEqual(termNote({ term: 'after', semesterEnd: '2027-01-20' }), { key: 'dir.term.after', params: { date: '20.01.2027' } });
  assert.deepEqual(termNote({ term: 'exam' }), { key: 'dir.term.exam' });
  assert.deepEqual(termNote({ term: 'none' }), { key: 'dir.term.none' });
});

import { readFileSync } from 'node:fs';
import { syllabusBadges, gridRows, FIRST_STUDENTS } from '../site/js/dirInfo.js';

test('syllabusBadges', () => {
  assert.deepEqual(syllabusBadges({ approved: true, open: 'returned' }), [
    { key: 'home.syllabusState.approved', tone: 'success' },
    { key: 'home.syllabusState.returned', tone: 'warning' },
  ]);
  assert.deepEqual(syllabusBadges({ approved: false, open: 'review' }), [{ key: 'home.syllabusState.review', tone: 'info' }]);
  assert.deepEqual(syllabusBadges({ approved: true, open: 'draft' }).map((b) => b.tone), ['success', 'neutral']);
  assert.deepEqual(syllabusBadges({ approved: false, open: null }), [{ key: 'home.syllabusState.none', tone: 'danger' }]);
  assert.deepEqual(syllabusBadges(null), [{ key: 'home.syllabusState.none', tone: 'danger' }]);
});

test('gridRows: the bells, and pair numbers past them', () => {
  assert.deepEqual(gridRows(['08:00', '09:40'], [{ slot: 3, startTime: '11:20' }, { slot: 1, startTime: '08:00' }]),
    [{ slot: 1, time: '08:00' }, { slot: 2, time: '09:40' }, { slot: 3, time: '11:20' }]);
  assert.deepEqual(gridRows(['08:00'], [{ slot: 1, startTime: '08:00' }]), [{ slot: 1, time: '08:00' }]);
  assert.equal(FIRST_STUDENTS, 5);
});

test('dir.card.inactive has the four plural forms in Russian', () => {
  const ru = readFileSync(new URL('../site/js/i18n/ru.js', import.meta.url), 'utf8');
  for (const form of ['one', 'few', 'many', 'other']) assert.ok(ru.includes(`'dir.card.inactive.${form}'`), form);
});

test('syllabusHalves: the halves of the discipline with their marks; a waiting discipline has none', () => {
  const halves = [{ semester: 1, approved: true, open: 'review' }, { semester: 2, approved: false, open: null }];
  assert.deepEqual(syllabusHalves({ waiting: false, halves }), [
    { semester: 1, badges: [{ key: 'home.syllabusState.approved', tone: 'success' }, { key: 'home.syllabusState.review', tone: 'info' }] },
    { semester: 2, badges: [{ key: 'home.syllabusState.none', tone: 'danger' }] },
  ]);
  assert.deepEqual(syllabusHalves({ waiting: true, halves }), []);
  assert.deepEqual(syllabusHalves(null), []);
});

import {
  PERSON_TABLES, COUNTED_STATES, ATTENDANCE_LOW, ATTENDANCE_MID, percentText, attendanceTone, stateLabel, countBadges,
  markEditFromCard, takeEditFromCard,
} from '../site/js/dirInfo.js';
import ru from '../site/js/i18n/ru.js';

test('percentText and attendanceTone', () => {
  assert.deepEqual(PERSON_TABLES, ['students', 'staff']);
  assert.equal([ATTENDANCE_LOW, ATTENDANCE_MID].join(), '70,85');
  assert.equal(percentText(null), '—');
  assert.equal(percentText(87), '87 %');
  assert.deepEqual([null, 69, 70, 84, 85].map(attendanceTone), [null, 'danger', 'warning', 'warning', null]);
});

test('stateLabel', () => {
  assert.deepEqual(stateLabel('passed', 82), { key: 'dir.state.passed', params: { total: 82 }, tone: 'success' });
  assert.deepEqual(stateLabel('risk', null), { key: 'dir.state.risk', params: {}, tone: 'warning' });
  assert.equal(stateLabel('going', null).tone, 'neutral');
  assert.equal(stateLabel('noExam', null).tone, 'neutral');
  assert.equal(stateLabel('fail', null).tone, 'danger');
  assert.equal(stateLabel('incomplete', null).tone, 'warning');
});

test('countBadges: only the states that exist, in order', () => {
  assert.deepEqual(COUNTED_STATES, ['risk', 'fail', 'notAdmitted', 'absent', 'incomplete']);
  assert.deepEqual(countBadges({ risk: 1, fail: 0, notAdmitted: 2, absent: 0, incomplete: 1 }), [
    { key: 'dir.count.risk', count: 1, tone: 'warning' },
    { key: 'dir.count.notAdmitted', count: 2, tone: 'danger' },
    { key: 'dir.count.incomplete', count: 1, tone: 'warning' },
  ]);
  assert.deepEqual(countBadges({ risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 }), []);
});

test('the edit window remembers the card it was opened from, once', () => {
  assert.equal(takeEditFromCard(), null);
  markEditFromCard('#/dir/groups/g1');
  assert.equal(takeEditFromCard(), '#/dir/groups/g1');
  assert.equal(takeEditFromCard(), null);
});

test('the new counted texts have all four forms', () => {
  for (const key of ['dir.riskSubjects', 'dir.card.riskStudents', 'dir.card.groupsCount']) {
    for (const form of ['one', 'few', 'many', 'other']) assert.ok(ru[`${key}.${form}`], `${key}.${form}`);
  }
});

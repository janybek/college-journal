// What the directory lists say about a record, from the answer of dir.summary. Pure: no DOM, no requests.

export const CARD_TABLES = ['groups', 'rooms', 'disciplines'];

export const cardHref = (table, id) => '#/dir/' + table + '/' + encodeURIComponent(id);

// The rows of an answer by id; no answer, no map.
export function infoById(summary) {
  if (!summary) return null;
  return new Map((summary.rows ?? []).map((row) => [row.id, row]));
}

// "Now" of a group: { key, params, tone } for a badge.
export function groupNowLabel(now) {
  const state = now?.state;
  if (state === 'busy') {
    return now.roomName
      ? { key: 'dir.now.busy', params: { until: now.until, room: now.roomName }, tone: 'success' }
      : { key: 'dir.now.busyNoRoom', params: { until: now.until }, tone: 'success' };
  }
  if (state === 'next') {
    return now.roomName
      ? { key: 'dir.now.next', params: { at: now.at, room: now.roomName }, tone: 'info' }
      : { key: 'dir.now.nextNoRoom', params: { at: now.at }, tone: 'info' };
  }
  if (state === 'done') return { key: 'dir.now.done', params: {}, tone: 'neutral' };
  return { key: 'dir.now.none', params: {}, tone: 'neutral' };
}

// "Now" of a room.
export function roomNowLabel(now) {
  const state = now?.state;
  if (state === 'busy') return { key: 'dir.room.busy', params: { until: now.until, group: now.groupName }, tone: 'warning' };
  if (state === 'free') return { key: 'dir.room.free', params: { until: now.until }, tone: 'success' };
  if (state === 'freeRest') return { key: 'dir.room.freeRest', params: {}, tone: 'success' };
  return { key: 'dir.room.freeDay', params: {}, tone: 'success' };
}

const SYLLABUS_STATES = [
  ['approved', 'success'],
  ['review', 'info'],
  ['returned', 'warning'],
  ['draft', 'neutral'],
  ['none', 'danger'],
];

// Labels of how many syllabi are in which state; only the states that exist.
export function syllabusCountBadges(counts) {
  const badges = SYLLABUS_STATES
    .filter(([name]) => Number(counts?.[name]) > 0)
    .map(([name, tone]) => ({ key: 'dir.syllabi.' + name, count: counts[name], tone }));
  return badges.length > 0 ? badges : [{ key: 'dir.syllabi.nothing', count: 0, tone: 'neutral' }];
}

// '2026-09-01' -> '01.09.2026'; anything else as it is.
export function fullDate(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(date ?? '');
}

// The line above the table when it is not a term day: { key, params? } or null.
export function termNote(summary) {
  const term = summary?.term;
  if (term === 'before') return { key: 'dir.term.before', params: { date: fullDate(summary.semesterStart) } };
  if (term === 'after') return { key: 'dir.term.after', params: { date: fullDate(summary.semesterEnd) } };
  if (term === 'exam') return { key: 'dir.term.exam' };
  if (term === 'none') return { key: 'dir.term.none' };
  return null;
}

// The labels of a syllabus of a subject in the cards: the approved one, then the open version when there is one.
const OPEN_TONES = { review: 'info', returned: 'warning', draft: 'neutral' };
export function syllabusBadges(syllabus) {
  const badges = [];
  if (syllabus?.approved) badges.push({ key: 'home.syllabusState.approved', tone: 'success' });
  if (OPEN_TONES[syllabus?.open]) badges.push({ key: 'home.syllabusState.' + syllabus.open, tone: OPEN_TONES[syllabus.open] });
  return badges.length > 0 ? badges : [{ key: 'home.syllabusState.none', tone: 'danger' }];
}

// The short «Силлабус» of the card of a discipline: the halves of the year with their marks. A discipline that waits for
// the choice of the deanery has no halves to show.
export function syllabusHalves(syllabus) {
  if (!syllabus || syllabus.waiting === true || !Array.isArray(syllabus.halves)) return [];
  return syllabus.halves.map((half) => ({ semester: half.semester, badges: syllabusBadges(half) }));
}

// The rows of the week of a room: every bell, and the numbers past the bells that some pair has (with its own time).
export function gridRows(bells, pairs) {
  const rows = bells.map((time, i) => ({ slot: i + 1, time }));
  const extra = new Map();
  for (const pair of pairs) {
    if (pair.slot > bells.length && (!extra.has(pair.slot) || pair.startTime < extra.get(pair.slot))) extra.set(pair.slot, pair.startTime);
  }
  for (const slot of [...extra.keys()].sort((a, b) => a - b)) rows.push({ slot, time: extra.get(slot) });
  return rows;
}

// The students a group card shows before «Все N студентов».
export const FIRST_STUDENTS = 5;

// ---- Progress of people, groups and disciplines (dir.people, dir.progress) ----

export const PERSON_TABLES = ['students', 'staff'];
// The states the cards count; a copy of the server's list (the site does not import core/).
export const COUNTED_STATES = ['risk', 'fail', 'notAdmitted', 'absent', 'incomplete'];
// Attendance below these is shown red and amber: a rule of the screen, not of the journal.
export const ATTENDANCE_LOW = 70;
export const ATTENDANCE_MID = 85;

export const percentText = (percent) => (percent === null || percent === undefined ? '—' : percent + ' %');

export function attendanceTone(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent < ATTENDANCE_LOW) return 'danger';
  return percent < ATTENDANCE_MID ? 'warning' : null;
}

const STATE_TONES = { going: 'neutral', risk: 'warning', passed: 'success', fail: 'danger', notAdmitted: 'danger', absent: 'danger', incomplete: 'warning', noExam: 'neutral' };

// The state of a student in a subject: { key, params, tone } for a badge.
export function stateLabel(state, total) {
  return { key: 'dir.state.' + state, params: state === 'passed' ? { total } : {}, tone: STATE_TONES[state] ?? 'neutral' };
}

// Labels of how many students are in which state; only the states that exist.
export function countBadges(counts) {
  return COUNTED_STATES
    .filter((name) => Number(counts?.[name]) > 0)
    .map((name) => ({ key: 'dir.count.' + name, count: counts[name], tone: STATE_TONES[name] }));
}

// The edit window opened from a card by the button (not by a typed address): «Back» of the browser returns to the card.
let editFrom = null;
export function markEditFromCard(href) { editFrom = href; }
export function takeEditFromCard() {
  const href = editFrom;
  editFrom = null;
  return href;
}

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

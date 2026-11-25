// Rules of the directory details (group, room and discipline cards). Pure functions, no storage.
import { minutesOf, addMinutes, isTime, isDate } from './dates.js';
import { PAIR_MINUTES } from './settings.js';
import { versionsOf, rightsOn } from './syllabusFlow.js';
import { compareNames } from './names.js';
import { joinedLineId, versionsOfLine } from './syllabusLines.js';

export const CARD_TABLES = ['groups', 'rooms', 'disciplines'];

export function pairEnd(pair) {
  return addMinutes(pair.startTime, PAIR_MINUTES);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Pairs of one group or one room (any dates) -> what is going on there right now.
export function nowOf(pairs, today, time) {
  const list = (pairs || [])
    .filter((p) => p && p.date === today && p.status !== 'cancelled' && isTime(p.startTime))
    .sort((a, b) => cmp(a.startTime, b.startTime) || (Number(a.slot) || 0) - (Number(b.slot) || 0) || cmp(String(a.id), String(b.id)));
  if (list.length === 0) return { state: 'none' };
  const now = minutesOf(time);
  const busy = list.find((p) => minutesOf(p.startTime) <= now && now < minutesOf(pairEnd(p)));
  if (busy) return { state: 'busy', pair: busy };
  const next = list.find((p) => minutesOf(p.startTime) > now);
  if (next) return { state: 'next', pair: next };
  return { state: 'done' };
}

// 'none' | 'before' | 'on' | 'exam' | 'after'
export function termOf({ settings, extra, today, hasPairs }) {
  const start = settings && settings.semesterStart;
  const end = settings && settings.semesterEnd;
  if (!start || !end) return 'none';
  if (today < start) return 'before';
  if (today > end) return 'after';
  if (!hasPairs) return 'none';
  const examStart = extra && extra.examStart;
  const examEnd = extra && extra.examEnd;
  if (isDate(examStart) && isDate(examEnd) && examStart <= today && today <= examEnd) return 'exam';
  return 'on';
}

// items: one { disciplineName, groupName } per row of the week template in a room.
export function topOf(items) {
  const rows = items || [];
  if (rows.length === 0) return null;
  const count = new Map();
  for (const it of rows) count.set(it.disciplineName, (count.get(it.disciplineName) || 0) + 1);
  const max = Math.max(...count.values());
  const best = [...count.keys()].filter((name) => count.get(name) === max).sort(compareNames)[0];
  const groups = [...new Set(rows.filter((it) => it.disciplineName === best).map((it) => it.groupName))].sort(compareNames);
  return { disciplineName: best, groupNames: groups };
}

// viewer: { id, roles }. The open version is shown only to those who may see it.
export function syllabusState(syllabi, { disciplineId, teacherId, semester }, viewer, members) {
  const { approved, open } = members === undefined   // TEMP task 4
    ? versionsOf(syllabi, { disciplineId, teacherId, semester })
    : versionsOfLine(syllabi, joinedLineId(members, { disciplineId, teacherId, semester }));
  const visible = open && rightsOn(open, { ...viewer, teaches: false }).see;
  return { approved: approved !== null, open: visible ? open.status : null };
}

export function syllabusCounts(states) {
  const counts = { approved: 0, review: 0, returned: 0, draft: 0, none: 0 };
  for (const s of states || []) {
    if (s.approved === true) counts.approved += 1;
    if (s.open === 'review' || s.open === 'returned' || s.open === 'draft') counts[s.open] += 1;
    if (!s.approved && s.open === null) counts.none += 1;
  }
  return counts;
}

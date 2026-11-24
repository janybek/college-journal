// The pair of a teacher: today's pairs, the start, the screen with the codes, the end of the check-in and the finish.
// The codes leave the server only here, only to the teacher who leads the pair and only while the window is open.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { addMinutes, localDate, localDateTime } from '../core/dates.js';
import { FIXED_STATUSES, ATTENDED_STATUSES } from '../core/schema.js';
import { PAIR_MINUTES, readSettings } from '../core/settings.js';
import { readScheme } from '../core/scoring.js';
import { inSemester } from '../core/topics.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { compareNames } from '../core/names.js';
import { isSubstitution } from '../core/schedule.js';
import { firstPairId } from '../core/grades.js';
import { markMode, markState } from '../core/journal.js';
import { LESSON, codeAt, lessonClock, pairKey, qrAt, startFrom, startProblem } from '../core/lesson.js';
import { JOURNAL_TABLES, lastOf, pairUnitClosed, readJournalRows, viewerOf } from './journalData.js';
import { settleLessons } from './lessonSettle.js';
import { pairViews } from './scheduleData.js';
import { subjectRights } from './workData.js';

export const LESSON_TABLES = [...JOURNAL_TABLES, 'rooms', 'checkins'];

const MIN_MS = 60000;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function readLessonRows(store, withCheckins) {
  const rows = readJournalRows(store);
  rows.rooms = store.list('rooms');
  if (withCheckins) rows.checkins = store.list('checkins');
  return rows;
}

// The pair of the request, or `not_found` / `forbidden`. `pairId` must be a string.
function ledPair(rows, data, user) {
  const pair = typeof data.pairId === 'string' ? rows.pairs.find((p) => p.id === data.pairId) : undefined;
  if (!pair) throw new AppError('not_found');
  if (pair.teacherId !== user.id) throw new AppError('forbidden');
  return pair;
}

// Today's pairs of this teacher (after settling), by pair number.
export function lessonMine(store, platform, user) {
  const rows = settleLessons(store, platform, readLessonRows(store, false));
  const nowMs = platform.now();
  const today = localDate(nowMs);
  const byId = new Map(rows.pairs.map((p) => [p.id, p]));
  const pairs = pairViews(store, (p) => p.date === today && p.teacherId === user.id, rows).map((v) => {
    const pair = byId.get(v.id);
    const problem = pair.status === 'running' ? 'running' : startProblem(pair, nowMs);
    const shut = problem === null && pairUnitClosed(rows, rows.subjects.find((s) => s.id === pair.subjectId), pair);
    const lesson = shut ? null : problem === 'running' ? 'open' : problem === null ? 'start' : null;
    return {
      id: v.id, slot: v.slot, startTime: v.startTime, endTime: v.endTime, subjectId: v.subjectId, subjectName: v.subjectName,
      groupName: v.groupName, roomName: v.roomName, topic: v.topic, status: v.status,
      lesson, problem: shut ? 'unit_closed' : lesson === null ? problem : null, startFrom: startFrom(pair),
    };
  });
  return { today, pairs };
}

// `rows`: settled rows with `checkins`. The pair is already known to be led by `user`.
export function lessonView(rows, platform, pair, user) {
  const nowMs = platform.now();
  const viewer = viewerOf(user);
  const settings = readSettings(rows.settings);
  const scheme = readScheme(rows.settings);
  const subject = rows.subjects.find((s) => s.id === pair.subjectId);
  const group = rows.groups.find((g) => g.id === pair.groupId);
  const room = rows.rooms.find((r) => r.id === pair.roomId);
  const topic = rows.topics.find((t) => t.id === pair.topicId);
  const number = topic ? lessonNumbers(rows.topics.filter((t) => t.syllabusId === topic.syllabusId)).get(topic.id) : undefined;
  const first = firstPairId(rows.pairs.filter((p) => p.subjectId === pair.subjectId && inSemester(p.date, settings)));
  const state = markState(pair, { date: localDate(nowMs), time: localDateTime(nowMs).slice(11, 16) }, scheme);
  const teacher = viewer.teacher && (pair.teacherId === viewer.id || (!!subject && subject.teacherId === viewer.id));
  const clock = lessonClock(pair, nowMs);

  let code = null;
  if (clock.phase === 'checkin' && pair.teacherId === user.id) {
    const key = pairKey(platform, pair);
    code = {
      now: codeAt(platform, key, clock.step), next: codeAt(platform, key, clock.step + 1),
      qr: qrAt(platform, key, clock.step), nextQr: qrAt(platform, key, clock.step + 1), msToNext: clock.msToNext,
    };
  }

  // the last mark and the last good check-in of each student on this pair
  const marksOf = new Map();
  for (const row of rows.attendance) {
    if (row.pairId !== pair.id) continue;
    if (!marksOf.has(row.studentId)) marksOf.set(row.studentId, []);
    marksOf.get(row.studentId).push(row);
  }
  const checkinsOf = new Map();
  for (const row of rows.checkins) {
    if (row.pairId !== pair.id || row.result !== 'ok') continue;
    if (!checkinsOf.has(row.studentId)) checkinsOf.set(row.studentId, []);
    checkinsOf.get(row.studentId).push(row);
  }
  const byName = (a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id);
  const listed = rows.students.filter((s) => s.groupId === pair.groupId && s.active === true).sort(byName);
  const listedIds = new Set(listed.map((s) => s.id));
  const left = rows.students.filter((s) => !listedIds.has(s.id) && marksOf.has(s.id)).sort(byName);
  const studentOf = (s, isLeft) => {
    const mark = marksOf.has(s.id) ? lastOf(marksOf.get(s.id), 'markedAt') : null;
    const checkin = checkinsOf.has(s.id) ? lastOf(checkinsOf.get(s.id), 'at') : null;
    return {
      id: s.id, fullName: s.fullName, left: isLeft,
      mark: mark ? { status: mark.status, noCoat: mark.noCoat === true, activity: mark.activity ?? null, source: mark.source } : null,
      checkin: checkin ? { at: checkin.at.slice(11), way: checkin.way } : null,
    };
  };
  const students = [...listed.map((s) => studentOf(s, false)), ...left.map((s) => studentOf(s, true))];

  return {
    now: localDateTime(nowMs).slice(11),
    pair: {
      id: pair.id, date: pair.date, slot: pair.slot, startTime: pair.startTime, endTime: addMinutes(pair.startTime, PAIR_MINUTES), status: pair.status,
      subjectId: pair.subjectId, subjectName: subject ? subject.name : '', groupName: group ? group.name : '', roomName: room ? room.name : '',
      topicName: topic ? topic.name : '', number: number ?? '', lessonType: pair.lessonType, first: pair.id === first,
      mode: markMode({ state, held: FIXED_STATUSES.includes(pair.status), teacher, manager: viewer.manager }),
      topicId: pair.topicId ?? '', unit: topic ? topic.unit : null,
    },
    phase: clock.phase, startedAt: pair.startedAt || '', checkinLeftMs: clock.checkinLeftMs, lessonLeftMs: clock.lessonLeftMs,
    code,
    attended: students.filter((s) => !s.left && s.mark && ATTENDED_STATUSES.includes(s.mark.status)).length,
    total: listed.length,
    students,
    scheme: { activity: scheme.activity },
    assign: !!subject && subjectRights(subject, user).manage,
  };
}

const answer = (rows, platform, pairId, user) => ({ lesson: lessonView(rows, platform, rows.pairs.find((p) => p.id === pairId), user) });

export function getLesson(store, platform, data, user) {
  const rows = readLessonRows(store, true);
  const pair = ledPair(rows, data, user);
  return answer(settleLessons(store, platform, rows), platform, pair.id, user);
}

export function startLesson(store, platform, data, user) {
  const rows = readLessonRows(store, true);
  const pair = ledPair(rows, data, user);
  const nowMs = platform.now();
  const problem = startProblem(pair, nowMs);
  if (problem === 'running') return answer(settleLessons(store, platform, rows), platform, pair.id, user);
  if (problem !== null) throw new AppError(problem);
  const subject = rows.subjects.find((s) => s.id === pair.subjectId);
  if (subject && pairUnitClosed(rows, subject, pair)) throw new AppError('unit_closed');
  const others = rows.pairs.filter((p) => p.status === 'running' && p.teacherId === user.id && p.id !== pair.id).map((p) => p.id);
  const after = settleLessons(store, platform, rows, { finish: others, actorId: user.id });
  const patch = {
    status: 'running', startedAt: localDateTime(nowMs), startedBy: user.id, checkinUntil: localDateTime(nowMs + LESSON.checkinMinutes * MIN_MS),
    checkinClosed: false, finishedAt: '', finishedBy: '', substitute: isSubstitution(pair, subject),
  };
  store.updateMany('pairs', [{ id: pair.id, patch }]);
  const pairs = after.pairs.map((p) => (p.id === pair.id ? { ...p, ...patch } : p));
  return answer({ ...after, pairs }, platform, pair.id, user);
}

export function endCheckin(store, platform, data, user) {
  const rows = readLessonRows(store, true);
  const pair = ledPair(rows, data, user);
  if (pair.status !== 'running') throw new AppError('pair_locked');
  return answer(settleLessons(store, platform, rows, { endCheckin: [pair.id] }), platform, pair.id, user);
}

export function finishLesson(store, platform, data, user) {
  const rows = readLessonRows(store, true);
  const pair = ledPair(rows, data, user);
  if (pair.status === 'running') return answer(settleLessons(store, platform, rows, { finish: [pair.id], actorId: user.id }), platform, pair.id, user);
  if (pair.status === 'closed' && pair.startedAt) return answer(settleLessons(store, platform, rows), platform, pair.id, user);
  throw new AppError('pair_locked');
}

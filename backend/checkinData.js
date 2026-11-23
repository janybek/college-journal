// The check-in of a student on a started pair: by the code of 4 digits or by a QR pass, one phone per pair, at most 5 wrong codes.
// The codes are never sent to a student. A wrong code is the only refusal that writes (a row of the phone check-ins), and it answers `ok`.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime, parseLocalDateTime } from '../core/dates.js';
import { LESSON, isDevice, issuePass, lessonClock, matchCode, readPass } from '../core/lesson.js';
import { lastOf, writeMarks } from './journalData.js';
import { settleLessons } from './lessonSettle.js';

const hhmm = (stamp) => String(stamp).slice(11, 16);
const isString = (value) => typeof value === 'string';

// The wrong codes of a student on this start of a pair.
function wrongCodes(checkins, pair, studentId) {
  return checkins.filter((c) => c.pairId === pair.id && c.studentId === studentId && c.result === 'wrong' && c.at >= pair.startedAt).length;
}

export function checkinCurrent(store, platform, user) {
  const settled = settleLessons(store, platform, { attendance: store.list('attendance') });
  const today = localDate(platform.now());
  const nowMs = platform.now();
  const pair = settled.pairs
    .filter((p) => p.status === 'running' && p.date === today && p.groupId === user.row.groupId && ['checkin', 'lesson'].includes(lessonClock(p, nowMs).phase))
    .sort((a, b) => a.slot - b.slot)[0];
  if (!pair) return { pair: null };
  const subject = store.list('subjects').find((s) => s.id === pair.subjectId);
  const room = store.list('rooms').find((r) => r.id === pair.roomId);
  const teacher = store.list('staff').find((s) => s.id === pair.teacherId);
  const checkins = store.list('checkins');
  const clock = lessonClock(pair, nowMs);
  const own = settled.attendance.filter((a) => a.pairId === pair.id && a.studentId === user.id);
  const mark = own.length > 0 ? lastOf(own, 'markedAt') : null;
  return {
    pair: {
      id: pair.id, subjectName: subject ? subject.name : '', roomName: room ? room.name : '', startTime: pair.startTime,
      teacherName: teacher ? teacher.fullName : '', phase: clock.phase, checkinLeftMs: clock.phase === 'checkin' ? clock.checkinLeftMs : 0,
      mark: mark ? { status: mark.status, at: hhmm(mark.markedAt) } : null,
      attemptsLeft: Math.max(0, LESSON.wrongCodes - wrongCodes(checkins, pair, user.id)),
    },
  };
}

export function checkinPass(store, platform, data) {
  if (!isDevice(data.device) || !isString(data.qr) || !isString(data.pairId)) throw new AppError('bad_request');
  const { pairs } = settleLessons(store, platform);
  const pair = pairs.find((p) => p.id === data.pairId);
  if (!pair || pair.status !== 'running') throw new AppError('not_running');
  const nowMs = platform.now();
  const clock = lessonClock(pair, nowMs);
  if (clock.phase !== 'checkin') throw new AppError('window_closed');
  const found = matchCode(platform, pair, 'qr', data.qr, nowMs);
  if (found === 'expired') throw new AppError('code_expired');
  if (found !== 'ok') throw new AppError('bad_code');
  return { pass: issuePass(platform, { pairId: pair.id, device: data.device, exp: clock.checkinEndMs }), checkinLeftMs: clock.checkinLeftMs };
}

export function checkinMark(store, platform, data, user) {
  const hasCode = isString(data.code);
  const hasPass = isString(data.pass);
  if (!isDevice(data.device) || hasCode === hasPass) throw new AppError('bad_request');
  const settled = settleLessons(store, platform, { attendance: store.list('attendance') });
  const pair = isString(data.pairId) ? settled.pairs.find((p) => p.id === data.pairId) : undefined;
  if (!pair) throw new AppError('not_found');
  if (pair.groupId !== user.row.groupId) throw new AppError('forbidden');
  if (pair.status !== 'running') throw new AppError('not_running');
  const nowMs = platform.now();
  const clock = lessonClock(pair, nowMs);
  if (clock.phase !== 'checkin') throw new AppError('window_closed');
  const own = settled.attendance.filter((a) => a.pairId === pair.id && a.studentId === user.id);
  if (own.length > 0) {
    const mark = lastOf(own, 'markedAt');
    return { result: 'already', status: mark.status, at: hhmm(mark.markedAt) };
  }
  const checkins = store.list('checkins');
  const phone = (c) => c.pairId === pair.id && c.at >= pair.startedAt;
  if (checkins.some((c) => phone(c) && c.result === 'ok' && c.device === data.device && c.studentId !== user.id)) throw new AppError('device_used');
  const at = localDateTime(nowMs);
  const way = hasPass ? 'qr' : 'code';
  if (hasPass) {
    const pass = readPass(platform, data.pass, nowMs);
    if (!pass || pass.pairId !== pair.id || pass.device !== data.device || pass.exp !== parseLocalDateTime(pair.checkinUntil)) throw new AppError('bad_pass');
  } else {
    const wrong = wrongCodes(checkins, pair, user.id);
    if (wrong >= LESSON.wrongCodes) throw new AppError('too_many_codes');
    const found = matchCode(platform, pair, 'code', data.code, nowMs);
    if (found === 'expired') throw new AppError('code_expired');
    if (found !== 'ok') {
      store.insertMany('checkins', [{ pairId: pair.id, studentId: user.id, device: data.device, way, result: 'wrong', at }]);
      return { result: 'wrong_code', attemptsLeft: Math.max(0, LESSON.wrongCodes - wrong - 1) };
    }
  }
  const subject = store.list('subjects').find((s) => s.id === pair.subjectId);
  writeMarks(store, {
    pair, subject, items: [{ studentId: user.id, status: 'present', noCoat: false, activity: null }],
    existing: new Map(), actorId: user.id, at, source: way,
  });
  store.insertMany('checkins', [{ pairId: pair.id, studentId: user.id, device: data.device, way, result: 'ok', at }]);
  return { result: 'ok', at: hhmm(at), subjectName: subject ? subject.name : '' };
}

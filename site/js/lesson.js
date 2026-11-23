// Small pure helpers of the pair screen and the «Пары сегодня» cards (no DOM): names, the clock, the pass address,
// who has arrived, which stage is shown.

// 'Асанов Айдар Бекович' -> 'Асанов А.'; the surname alone stays as it is.
export function shortName(fullName) {
  const words = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  return words[0] + ' ' + Array.from(words[1])[0] + '.';
}

// Milliseconds left -> 'MM:SS', seconds rounded up; nothing or a negative number is '00:00'.
export function clockText(ms) {
  const left = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  const two = (n) => String(n).padStart(2, '0');
  return two(Math.floor(left / 60)) + ':' + two(left % 60);
}

// The address a phone opens from the QR: this site's own address without the part after '#', plus the pass of the step.
export function qrLink(pageUrl, pairId, qr) {
  const url = String(pageUrl);
  const hash = url.indexOf('#');
  return (hash === -1 ? url : url.slice(0, hash)) + '#/q/' + encodeURIComponent(pairId) + '/' + qr;
}

// Pixels per module of the QR (the quiet zone is inside `modules`): in full screen about two thirds of the height
// (never wider than 90 % of the width), otherwise half of the height up to 440 px; a whole number, at least 2.
export function qrCell(height, width, modules, fullscreen) {
  const target = fullscreen ? Math.min(height * 0.66, width * 0.9) : Math.min(height * 0.5, 440);
  return Math.max(2, Math.floor(target / modules));
}

const ARRIVED = ['present', 'late', 'madeup'];

// True when the mark of checkin.current says the student came (a teacher's «не был» is not a check-in).
export const cameMark = (mark) => Boolean(mark) && ARRIVED.includes(mark.status);

// Students already marked (present, late, made up): by the time of the check-in (those without one last), then by name.
export function arrivedList(lesson) {
  const students = Array.isArray(lesson && lesson.students) ? lesson.students : [];
  return students
    .filter((s) => s.mark && ARRIVED.includes(s.mark.status))
    .sort((a, b) => {
      const ta = a.checkin ? a.checkin.at : null;
      const tb = b.checkin ? b.checkin.at : null;
      if (ta !== tb) {
        if (ta === null) return 1;
        if (tb === null) return -1;
        return ta < tb ? -1 : 1;
      }
      return a.fullName.localeCompare(b.fullName, 'ru');
    })
    .map((s) => ({ id: s.id, name: shortName(s.fullName) }));
}

// The tab shown: the one the teacher chose (the check-in tab exists only during the window), else by phase.
export function stageOf(lesson, chosen) {
  const phase = lesson ? lesson.phase : 'none';
  if (chosen === 'summary' || chosen === 'material') return chosen;
  if (chosen === 'checkin' && phase === 'checkin') return 'checkin';
  if (phase === 'checkin') return 'checkin';
  if (phase === 'lesson') return 'material';
  return 'summary';
}

// 'start' | 'open' | null: what a pair of the journal or of lesson.mine offers.
export function todayAction(pair) {
  return pair && (pair.lesson === 'start' || pair.lesson === 'open') ? pair.lesson : null;
}

// ---- The stage «Итог»: the marks of the active students, edited on the pair itself ----

// The active students of lesson.get: a student without a mark has status null (the teacher sets it); one who left is not listed.
export function lessonDraft(lesson) {
  const students = Array.isArray(lesson && lesson.students) ? lesson.students : [];
  return students.filter((s) => !s.left).map((s) => ({
    studentId: s.id, fullName: s.fullName, status: s.mark ? s.mark.status : null,
    noCoat: s.mark ? s.mark.noCoat === true : false, activity: s.mark && s.mark.activity !== undefined ? s.mark.activity : null,
    checkin: s.checkin || null,
  }));
}

// What journal.savePair gets: the students whose status, coat or activity differ from the saved mark. A student still
// without a status is not sent.
export function lessonChanges(draft, lesson) {
  const saved = new Map((Array.isArray(lesson && lesson.students) ? lesson.students : []).filter((s) => s.mark).map((s) => [s.id, s.mark]));
  return draft
    .filter((m) => {
      if (m.status === null) return false;
      const old = saved.get(m.studentId);
      return !old || old.status !== m.status || (old.noCoat === true) !== (m.noCoat === true) || (old.activity ?? null) !== (m.activity ?? null);
    })
    .map((m) => ({ studentId: m.studentId, status: m.status, noCoat: m.noCoat === true, activity: m.activity ?? null }));
}

// ---- The check-in of a student ----

// '#/q/<pairId>/<16 hex>' -> { pairId, qr }; anything else (more parts, not hex, a broken %-code) is null.
export function readQrLink(hash) {
  const match = /^#\/q\/([^/]+)\/([0-9a-f]{16})$/.exec(typeof hash === 'string' ? hash : '');
  if (!match) return null;
  try { return { pairId: decodeURIComponent(match[1]), qr: match[2] }; } catch (error) { return null; }
}

// What the code field keeps: digits only, the first four.
export function cleanCode(text) {
  return String(text ?? '').replace(/\D/g, '').slice(0, 4);
}

const REFUSALS = {
  code_expired: 'warning', too_many_codes: 'danger', device_used: 'danger', window_closed: 'warning',
  not_running: 'warning', bad_pass: 'warning', bad_code: 'warning', forbidden: 'danger',
};

// The answer of checkin.mark ({ result, ... }) or an error code -> the text to show: { key, params, tone }.
export function checkinMessage(answer) {
  if (answer !== null && typeof answer === 'object') {
    if (answer.result === 'ok') return { key: 'checkin.ok', params: { at: answer.at }, tone: 'success' };
    if (answer.result === 'already') {
      return ARRIVED.includes(answer.status) ? { key: 'checkin.already', params: { at: answer.at }, tone: 'success' }
        : { key: 'checkin.alreadyOther', params: {}, tone: 'warning' };
    }
    if (answer.result === 'wrong_code') return { key: 'checkin.wrong', params: { n: answer.attemptsLeft }, tone: 'danger' };
    return { key: 'error.internal', params: {}, tone: 'danger' };
  }
  const code = String(answer);
  return { key: 'error.' + code, params: {}, tone: Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : 'danger' };
}

const SOURCES = { code: 'lesson.source.code', qr: 'lesson.source.qr', auto: 'lesson.source.auto', teacher: 'lesson.source.teacher' };

// The dictionary key of how a student's mark came to be; null when there is no mark.
export function sourceKey(student) {
  const source = student && student.mark ? student.mark.source : null;
  return Object.hasOwn(SOURCES, source) ? SOURCES[source] : null;
}

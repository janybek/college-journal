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

const ARRIVED = ['present', 'late', 'madeup'];

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

const SOURCES = { code: 'lesson.source.code', qr: 'lesson.source.qr', auto: 'lesson.source.auto', teacher: 'lesson.source.teacher' };

// The dictionary key of how a student's mark came to be; null when there is no mark.
export function sourceKey(student) {
  const source = student && student.mark ? student.mark.source : null;
  return Object.hasOwn(SOURCES, source) ? SOURCES[source] : null;
}

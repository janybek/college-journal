// The cabinet of a student: only the points and absences of the person who asks. Nothing is read from the request.
import { localDate } from '../core/dates.js';
import { FIXED_STATUSES } from '../core/schema.js';
import { readSettings } from '../core/settings.js';
import { readScheme, readSplit } from '../core/scoring.js';
import { inSemester } from '../core/topics.js';
import { syllabusFor } from '../core/syllabus.js';
import { compareNames } from '../core/names.js';
import { firstPairId, pairPoints, studentResults } from '../core/grades.js';
import { liveAttempts, subjectResult } from '../core/exam.js';
import { closedOfSubject, selfWorkOf } from './journalData.js';
import { studentStateExams } from './stateExamData.js';
import { attemptsOfCard, repeatMark, shownCard, studentRepeats } from './repeatData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Of several rows the last one wins: by `stamp`, then by id.
function lastOf(list, stamp) {
  let best = null;
  for (const row of list) {
    if (best === null || (cmp(row[stamp] || '', best[stamp] || '') || cmp(row.id, best.id)) > 0) best = row;
  }
  return best;
}

// The own exam of the student, shown only when the final sheet is closed: the last attempt decides, the commission and the dates of the others stay out.
function finalOf(rows, subjectId, planSemester, me, result, scheme, onRepeat) {
  const mine = (rows.examAttempts || []).filter((r) => r.studentId === me && r.subjectId === subjectId && (r.planSemester ?? null) === planSemester);
  const admitted = result.admitted === true && Number.isInteger(result.semester);
  const live = admitted ? liveAttempts(mine) : [];
  const res = subjectResult({ semester: result.semester, admitted, attempts: live, scheme });
  return {
    status: res.status, exam: res.exam, total: res.total, word: res.word, tries: res.tries, canRetake: res.next !== null && !onRepeat,
    attempts: live.map((a) => ({ no: a.no, date: a.date, outcome: a.outcome, score: a.score })),
  };
}

export function studentGrades(rows, platform, user) {
  const me = user.id;
  const student = rows.students.find((s) => s.id === me);
  const settings = readSettings(rows.settings);
  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const splitOut = { semester: split.semester, exam: split.exam, admission: split.admission };
  const today = localDate(platform.now());
  const schemeOut = {
    attendance: scheme.attendance, activity: scheme.activity, current: scheme.current, self: scheme.self, control: scheme.control,
    minimum: scheme.minimum, fair: scheme.fair, good: scheme.good, excellent: scheme.excellent,
  };
  const groupId = student ? student.groupId : '';
  const repeats = studentRepeats(rows, platform, me);
  const repeatKey = repeats.length > 0 ? { repeats } : {};
  const myCards = (rows.repeats || []).filter((c) => c.studentId === me);
  if (!groupId) return { today, scheme: schemeOut, split: splitOut, subjects: [], stateExams: [], ...repeatKey };

  // the own marks only: of one pair the last row
  const mine = new Map();
  for (const row of rows.attendance) {
    if (row.studentId !== me) continue;
    if (!mine.has(row.pairId)) mine.set(row.pairId, []);
    mine.get(row.pairId).push(row);
  }
  const markOf = new Map();
  for (const [pairId, list] of mine) {
    const row = lastOf(list, 'markedAt');
    markOf.set(pairId, { status: row.status, noCoat: row.noCoat === true, activity: row.activity ?? null });
  }
  const topics = new Map(rows.topics.map((t) => [t.id, t]));
  const held = (p) => FIXED_STATUSES.includes(p.status);

  const subjects = rows.subjects.filter((sb) => sb.groupId === groupId)
    .sort((a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id))
    .map((subject) => {
      const all = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
      const first = firstPairId(all);
      const syllabus = syllabusFor(subject, rows.syllabi, settings.semester, rows.syllabusMembers);
      const { planSemester, closed } = closedOfSubject(rows, subject, settings, all);
      const unitOf = (p) => { const t = topics.get(p.topicId); return t && Number.isInteger(t.unit) ? t.unit : null; };

      const unitNumbers = new Set();
      const titles = new Map();
      if (syllabus) {
        for (const t of rows.topics) if (t.syllabusId === syllabus.id && Number.isInteger(t.unit)) unitNumbers.add(t.unit);
        for (const u of rows.units) if (u.syllabusId === syllabus.id) titles.set(u.unit, u.title || '');
      }
      for (const p of all) if (held(p) && unitOf(p) !== null) unitNumbers.add(unitOf(p));
      for (const u of closed.units) unitNumbers.add(u);       // a closed unit stays on the sheet even when no syllabus is in force
      const unitList = [...unitNumbers].sort((a, b) => a - b);

      const unitRows = new Map();
      for (const r of rows.unitResults) {
        if (r.studentId !== me || r.subjectId !== subject.id || (r.planSemester ?? null) !== planSemester) continue;
        const prev = unitRows.get(r.unit);
        if (!prev || lastOf([prev, r], 'updatedAt') === r) unitRows.set(r.unit, r);
      }

      const forCount = all.map((p) => ({ id: p.id, status: p.status, lessonType: p.lessonType, unit: unitOf(p), first: p.id === first, date: p.date, slot: p.slot, topicId: p.topicId }));
      const selfWork = selfWorkOf(rows, subject, planSemester, me, platform.now(), scheme.self);
      const result = studentResults({ pairs: forCount, marks: markOf, unitRows, units: unitList, scheme, split, selfWork });
      const pairs = forCount.filter((p) => held(p) && markOf.has(p.id))
        .sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot || cmp(a.id, b.id))
        .map((p) => {
          const mark = markOf.get(p.id);
          const points = pairPoints(mark, p, scheme);
          const topic = topics.get(p.topicId);
          return {
            date: p.date, slot: p.slot, lessonType: p.lessonType, unit: p.unit, topicName: topic ? topic.name : '',
            status: mark.status, noCoat: mark.noCoat, activity: mark.activity,
            earned: points ? points.earned : null, possible: points ? points.possible : null,
          };
        });
      const teacher = rows.staff.find((x) => x.id === subject.teacherId);
      const card = shownCard(myCards, me, subject.id, planSemester);
      return {
        subjectId: subject.id, name: subject.name, teacherName: teacher ? teacher.fullName : '', hasSyllabus: syllabus !== null,
        units: result.units.map((u) => ({
          unit: u.unit, title: titles.get(u.unit) || '', current: u.current, manual: u.manual !== null,
          self: u.self, control: u.control, total: u.total, word: u.word, currentLow: u.currentLow, controlLow: u.controlLow,
          ...(u.selfWork ? { selfWork: u.selfWork } : {}),
          ...(closed.units.includes(u.unit) ? { closed: true } : {}),
        })),
        outside: result.outside, preliminary: result.preliminary, semester: result.semester, complete: result.complete, admitted: result.admitted, attendance: result.attendance, pairs,
        final: closed.final ? finalOf(rows, subject.id, planSemester, me, result, scheme, card !== null) : null,
        ...(card ? { repeat: repeatMark(card, attemptsOfCard({ repeatAttempts: rows.repeatAttempts || [] }, card), scheme, split) } : {}),
      };
    });
  return { today, scheme: schemeOut, split: splitOut, subjects, stateExams: studentStateExams(rows, groupId, me, scheme), ...repeatKey };
}

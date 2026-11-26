// The per-subject count shared by the progress of the directories (group, discipline, student and staff cards). Read-only: nothing is settled or written.
// The numbers are the ones of the journal (journalView) and of the final sheet (subjectResult); the new rules are in core/progress.js.
import { subjectResult } from '../core/exam.js';
import { semesterHalf } from '../core/syllabus.js';
import { inSemester } from '../core/topics.js';
import { subjectState } from '../core/progress.js';
import { JOURNAL_TABLES, closedOfSubject, journalView } from './journalData.js';
import { examRowsOf } from './ledgerData.js';

// `units` is left out: the journal takes only the titles of the units from it and the new answers do not need them.
export const PROGRESS_SHEETS = JOURNAL_TABLES.filter((name) => name !== 'units');
export const EXAM_SHEETS = ['subjectExams', 'examAttempts'];
const EMPTY_SHEETS = ['units', 'subjectExams', 'examAttempts', 'repeats', 'repeatAttempts'];

// Every sheet of `names` once, as store.list; the sheets the journal reads but the answer does not need stay empty.
export function readSheets(store, names) {
  const rows = {};
  for (const name of names) if (!(name in rows)) rows[name] = store.list(name);
  for (const name of EMPTY_SHEETS) if (!(name in rows)) rows[name] = [];
  return rows;
}

// Does the subject count in the current half? -> { planSemester } | null
export function halfOf(rows, subject, settings) {
  const all = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
  const { planSemester } = closedOfSubject(rows, subject, settings, all);
  if (planSemester !== null) return semesterHalf(planSemester) === settings.semester ? { planSemester } : null;
  return all.some((p) => p.status !== 'cancelled') ? { planSemester: null } : null;
}

// The figures of one subject for every student of its journal. `user` is the administrator, the deanery or the pro-rector (the whole journal).
export function subjectProgress(rows, platform, subject, user) {
  const view = journalView(rows, platform, subject.id, user);
  const { planSemester } = view.subject;
  const finalClosed = view.closed.final;
  const { attempts } = examRowsOf(rows, subject.id, planSemester);
  const scheme = view.scheme;
  const split = view.split;
  const students = view.students.map((s) => {
    const result = view.results[s.id];
    const final = finalClosed
      ? subjectResult({ semester: result.semester, admitted: result.admitted === true && Number.isInteger(result.semester), attempts: attempts.get(s.id) || [], scheme })
      : null;
    return {
      id: s.id,
      left: s.left,
      units: result.units.map((u) => ({ unit: u.unit, total: u.total, control: u.control, self: u.self })),
      semester: result.semester,
      attendance: { marked: result.attendance.marked, attended: result.attendance.attended, absent: result.attendance.absent, percent: result.attendance.percent },
      state: subjectState(result, final, { scheme, split }),
      total: final ? final.total : null,
    };
  });
  return {
    subjectId: subject.id, planSemester, units: view.units.map((u) => u.unit), closedUnits: view.closed.units, finalClosed, pairs: view.pairs, students,
  };
}

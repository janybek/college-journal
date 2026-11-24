// The previous result of a subject half: the halves with a closed final sheet and the result of every student in them.
// Pure functions over the ledger tables (read once by the caller); nothing is read from the store and nothing is written.
// The current half is the sheet of the ledger itself; a past half (after the semester was switched) is counted from the same
// rows by the same rules, so the numbers of one student do not change when the semester is switched.
import { readSettings } from '../core/settings.js';
import { readScheme, readSplit } from '../core/scoring.js';
import { syllabusFor } from '../core/syllabus.js';
import { compareNames } from '../core/names.js';
import { FINAL_UNIT, closedUnitsOf } from '../core/ledger.js';
import { studentResults, firstPairId } from '../core/grades.js';
import { subjectResult } from '../core/exam.js';
import { ledgerView, examRowsOf } from './ledgerData.js';
import { lastOf, pairKeyOf, selfWorkOf } from './journalData.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The half of the plan of the syllabus in force of the subject, or null.
function currentHalf(rows, subject) {
  const syllabus = syllabusFor(subject, rows.syllabi, readSettings(rows.settings).semester);
  return syllabus && Number.isInteger(syllabus.planSemester) ? syllabus.planSemester : null;
}

// -> [{ planSemester, current }] ascending: the halves of the subject whose final sheet is closed now (not reopened)
export function halvesOf(rows, subject) {
  const halves = new Set();
  for (const c of rows.closures) if (c.subjectId === subject.id && c.unit === FINAL_UNIT && c.reopenedAt === '' && Number.isInteger(c.planSemester)) halves.add(c.planSemester);
  const now = currentHalf(rows, subject);
  return [...halves].sort((a, b) => a - b)
    .filter((planSemester) => closedUnitsOf(rows.closures, subject.id, planSemester).final)
    .map((planSemester) => ({ planSemester, current: planSemester === now }));
}

// One row of the result; `next` is counted from the attempts alone (no `left`, no card of the repeat).
function rowOf({ id, fullName, semester, complete, admitted, attempts }, scheme) {
  const res = subjectResult({ semester, admitted: admitted === true && Number.isInteger(semester), attempts, scheme });
  return { id, fullName, semester, complete, admitted, attempts, status: res.status, tries: res.tries, exam: res.exam, total: res.total, word: res.word, next: res.next };
}

// The numbers of a half that is not the current one, counted from the pairs, marks and results that belong to it.
function pastStudents(rows, platform, subject, planSemester, scheme, split) {
  const keyed = [];
  for (const p of rows.pairs) {
    if (p.subjectId !== subject.id) continue;
    const key = pairKeyOf(rows, p);
    if (key && key.planSemester === planSemester) keyed.push({ pair: p, unit: key.unit });
  }
  const first = firstPairId(keyed.map((k) => k.pair));
  const forCount = keyed.map((k) => ({ id: k.pair.id, status: k.pair.status, lessonType: k.pair.lessonType, unit: k.unit, first: k.pair.id === first }));
  const pairIds = new Set(keyed.map((k) => k.pair.id));
  const units = closedUnitsOf(rows.closures, subject.id, planSemester).units;

  const markLists = new Map();
  for (const r of rows.attendance) {
    if (!pairIds.has(r.pairId)) continue;
    const key = r.pairId + '\n' + r.studentId;
    if (!markLists.has(key)) markLists.set(key, []);
    markLists.get(key).push(r);
  }
  const marks = new Map();              // student id -> Map(pair id -> mark)
  for (const list of markLists.values()) {
    const row = lastOf(list, 'markedAt');
    if (!marks.has(row.studentId)) marks.set(row.studentId, new Map());
    marks.get(row.studentId).set(row.pairId, { status: row.status, noCoat: row.noCoat === true, activity: row.activity });
  }

  const unitLists = new Map();
  for (const r of rows.unitResults) {
    if (r.subjectId !== subject.id || (r.planSemester ?? null) !== planSemester) continue;
    const key = r.studentId + '\n' + r.unit;
    if (!unitLists.has(key)) unitLists.set(key, []);
    unitLists.get(key).push(r);
  }
  const unitRows = new Map();           // student id -> Map(unit -> row)
  for (const list of unitLists.values()) {
    const row = lastOf(list, 'updatedAt');
    if (!unitRows.has(row.studentId)) unitRows.set(row.studentId, new Map());
    unitRows.get(row.studentId).set(row.unit, row);
  }

  const { attempts } = examRowsOf(rows, subject.id, planSemester);
  const traced = new Set([...marks.keys(), ...unitRows.keys(), ...attempts.keys()]);
  const byName = (a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id);
  const found = rows.students.filter((s) => traced.has(s.id));
  const listed = found.filter((s) => s.groupId === subject.groupId && s.active === true).sort(byName);
  const rest = found.filter((s) => !(s.groupId === subject.groupId && s.active === true)).sort(byName);
  const nowMs = platform.now();

  return [...listed, ...rest].map((s) => {
    const selfWork = selfWorkOf(rows, subject, planSemester, s.id, nowMs, scheme.self);
    const r = studentResults({ pairs: forCount, marks: marks.get(s.id) || new Map(), unitRows: unitRows.get(s.id) || new Map(), units, scheme, split, selfWork });
    return rowOf({ id: s.id, fullName: s.fullName, semester: r.semester, complete: r.complete, admitted: r.admitted, attempts: attempts.get(s.id) || [] }, scheme);
  });
}

// rows: the tables LEDGER_TABLES (read once by the caller); user: the deanery or the administrator who records.
// -> { current, students: [{ id, fullName, semester, complete, admitted, attempts, status, tries, exam, total, word, next }] }
export function halfResults(rows, platform, subject, planSemester, user) {
  const scheme = readScheme(rows.settings);
  const current = currentHalf(rows, subject) === planSemester;
  if (current) return { current, students: ledgerView(rows, platform, subject.id, user).students.map((s) => rowOf(s, scheme)) };
  return { current, students: pastStudents(rows, platform, subject, planSemester, scheme, readSplit(rows.settings)) };
}

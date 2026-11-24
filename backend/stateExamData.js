// The state exams of a group: the list, the sheet with the scores, saving, entering the scores, removing.
// The only module that writes the state exams and their results. The number is the score of the exam, the word comes from the thresholds of the scheme.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { readExtra } from '../core/settings.js';
import { readScheme } from '../core/scoring.js';
import { gradeWord } from '../core/grades.js';
import { compareNames } from '../core/names.js';
import { checkReason } from '../core/journal.js';
import { STATE_EXAM, checkScore, checkStateExam, examStats } from '../core/stateExam.js';
import { lastOf } from './journalData.js';

export const STATE_EXAM_TABLES = ['stateExams', 'stateExamResults', 'groups', 'students', 'staff', 'settings'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const invalid = (fields) => new AppError('invalid', { fields });
const canManage = (user) => Array.isArray(user.roles) && (user.roles.includes('admin') || user.roles.includes('dean'));

function readRows(store) {
  const rows = {};
  for (const table of STATE_EXAM_TABLES) rows[table] = store.list(table);
  return rows;
}

// The live result of every student of one exam: of several rows the last one wins. -> Map(student id -> row)
function resultsOf(results, examId) {
  const byStudent = new Map();
  for (const r of results) {
    if (r.examId !== examId) continue;
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId).push(r);
  }
  return new Map([...byStudent].map(([id, list]) => [id, lastOf(list, 'updatedAt')]));
}

const hasScore = (row) => row !== undefined && row !== null && row.score !== null && row.score !== undefined;
const activeOf = (students, groupId) => students.filter((s) => s.groupId === groupId && s.active !== false);

function findExam(rows, id) {
  const exam = typeof id === 'string' ? rows.stateExams.find((e) => e.id === id) : undefined;
  if (!exam) throw new AppError('not_found');
  return exam;
}

// The sheet of one exam; `results` are the rows of the results as they stand. A result of a person who is not in the students is not shown.
function sheetOf(rows, results, exam, platform, user) {
  const scheme = readScheme(rows.settings);
  const live = resultsOf(results, exam.id);
  const active = activeOf(rows.students, exam.groupId).sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));
  const inGroup = new Set(active.map((s) => s.id));
  const left = rows.students.filter((s) => !inGroup.has(s.id) && hasScore(live.get(s.id)))
    .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));
  const line = (s, isLeft) => {
    const score = hasScore(live.get(s.id)) ? live.get(s.id).score : null;
    return { id: s.id, fullName: s.fullName, left: isLeft, score, word: gradeWord(score, scheme) };
  };
  const students = [...active.map((s) => line(s, false)), ...left.map((s) => line(s, true))];
  const group = rows.groups.find((g) => g.id === exam.groupId);
  return {
    today: localDate(platform.now()),
    collegeName: readExtra(rows.settings).collegeName,
    can: { manage: canManage(user) },
    exam: { id: exam.id, groupId: exam.groupId, groupName: group ? group.name : '', name: exam.name, date: exam.date },
    scheme: { fair: scheme.fair, good: scheme.good, excellent: scheme.excellent },
    students,
    stats: examStats(students.map((s) => s.score), scheme),
  };
}

// 'stateExam.list' {}
export function stateExamList(store, platform, user) {
  const rows = readRows(store);
  const manage = canManage(user);
  const exams = rows.stateExams.map((e) => {
    const active = activeOf(rows.students, e.groupId);
    const live = resultsOf(rows.stateExamResults, e.id);
    const group = rows.groups.find((g) => g.id === e.groupId);
    return {
      id: e.id, groupId: e.groupId, groupName: group ? group.name : '', name: e.name, date: e.date,
      students: active.length, entered: active.filter((s) => hasScore(live.get(s.id))).length,
    };
  }).sort((a, b) => cmp(b.date, a.date) || compareNames(a.groupName, b.groupName) || cmp(a.id, b.id));
  const groups = manage ? rows.groups.map((g) => ({ id: g.id, name: g.name })).sort((a, b) => compareNames(a.name, b.name) || cmp(a.id, b.id)) : [];
  return { today: localDate(platform.now()), can: { manage }, groups, exams };
}

// 'stateExam.get' { examId }
export function stateExamGet(store, platform, data, user) {
  const rows = readRows(store);
  return sheetOf(rows, rows.stateExamResults, findExam(rows, data.examId), platform, user);
}

// 'stateExam.save' { id?, groupId, name, date } -> { exam: { id } }
export function saveStateExam(store, platform, data, user) {
  const rows = readRows(store);
  const old = data.id === undefined ? null : findExam(rows, data.id);
  const hasScores = old !== null && rows.stateExamResults.some((r) => r.examId === old.id && hasScore(r));
  const checked = checkStateExam({ groupId: data.groupId, name: data.name, date: data.date }, { groups: rows.groups, old, hasScores });
  if (checked.problems.length > 0) throw invalid(checked.problems);
  const value = checked.value;
  const same = rows.stateExams.some((e) => (old === null || e.id !== old.id) && e.groupId === value.groupId && e.date === value.date
    && String(e.name).trim().toLowerCase() === value.name.toLowerCase());
  if (same) throw invalid([{ field: 'name', code: 'duplicate' }]);

  const at = localDateTime(platform.now());
  if (old === null) {
    const inserted = store.insertMany('stateExams', [{ ...value, createdBy: user.id, createdAt: at, updatedBy: '', updatedAt: '' }]);
    return { exam: { id: inserted[0].id } };
  }
  if (old.groupId !== value.groupId || old.name !== value.name || old.date !== value.date) {
    store.updateMany('stateExams', [{ id: old.id, patch: { ...value, updatedBy: user.id, updatedAt: at } }]);
  }
  return { exam: { id: old.id } };
}

// 'stateExam.saveScores' { examId, items: [{ studentId, score }], reason } -> the sheet
export function saveStateExamScores(store, platform, data, user) {
  const rows = readRows(store);
  const exam = findExam(rows, data.examId);
  const items = data.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > STATE_EXAM.itemsMax) throw new AppError('bad_request');
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.studentId !== 'string' || seen.has(item.studentId)) throw new AppError('bad_request');
    seen.add(item.studentId);
  }

  const live = resultsOf(rows.stateExamResults, exam.id);
  const known = new Set(rows.students.map((s) => s.id));
  const inGroup = new Set(activeOf(rows.students, exam.groupId).map((s) => s.id));
  const problems = [];
  const changes = [];
  items.forEach((item, index) => {
    if (!known.has(item.studentId) || (!inGroup.has(item.studentId) && !live.has(item.studentId))) { problems.push({ index, field: 'studentId', code: 'bad_ref' }); return; }
    const code = checkScore(item.score);
    if (code) { problems.push({ index, field: 'score', code }); return; }
    const row = live.get(item.studentId) || null;
    const was = hasScore(row) ? row.score : null;
    if (was !== item.score) changes.push({ studentId: item.studentId, row, was, score: item.score });
  });
  if (problems.length > 0) throw invalid(problems);
  if (changes.length === 0) return sheetOf(rows, rows.stateExamResults, exam, platform, user);

  let reason = '';
  if (changes.some((c) => c.was !== null)) {
    const code = checkReason(data.reason);
    if (code) throw invalid([{ field: 'reason', code }]);
    reason = data.reason.trim();
  }

  const at = localDateTime(platform.now());
  const stamp = { updatedBy: user.id, updatedAt: at };
  const patches = changes.filter((c) => c.row).map((c) => ({ id: c.row.id, patch: { score: c.score, ...stamp } }));
  const fresh = changes.filter((c) => !c.row).map((c) => ({ examId: exam.id, studentId: c.studentId, score: c.score, ...stamp }));
  let results = rows.stateExamResults;
  if (patches.length > 0) {
    const replaced = new Map(store.updateMany('stateExamResults', patches).map((r) => [r.id, r]));
    results = results.map((r) => replaced.get(r.id) || r);
  }
  if (fresh.length > 0) results = [...results, ...store.insertMany('stateExamResults', fresh)];
  store.insertMany('changeLog', changes.map((c) => ({
    at, actorId: user.id, entity: 'exam', examId: exam.id, studentId: c.studentId, field: 'score',
    before: c.was === null ? '' : String(c.was), after: c.score === null ? '' : String(c.score), reason: c.was !== null ? reason : '',
    subjectId: '', pairId: '', unit: null, late: false,
  })));
  return sheetOf(rows, results, exam, platform, user);
}

// 'stateExam.remove' { examId } -> {}
export function removeStateExam(store, platform, data) {
  const rows = readRows(store);
  const exam = findExam(rows, data.examId);
  const own = rows.stateExamResults.filter((r) => r.examId === exam.id);
  if (own.some(hasScore)) throw new AppError('in_use');
  if (own.length > 0) store.removeMany('stateExamResults', own.map((r) => r.id));
  store.removeMany('stateExams', [exam.id]);
  return {};
}

// For 'student.grades': the exams of the group of the student and the ones where he has a score; only his own score and word.
export function studentStateExams(rows, groupId, me, scheme) {
  const mine = new Map();
  for (const r of rows.stateExamResults || []) {
    if (r.studentId !== me) continue;
    if (!mine.has(r.examId)) mine.set(r.examId, []);
    mine.get(r.examId).push(r);
  }
  return (rows.stateExams || []).map((e) => {
    const row = mine.has(e.id) ? lastOf(mine.get(e.id), 'updatedAt') : null;
    return { exam: e, score: hasScore(row) ? row.score : null };
  }).filter(({ exam, score }) => exam.groupId === groupId || score !== null)
    .sort((a, b) => cmp(b.exam.date, a.exam.date) || compareNames(a.exam.name, b.exam.name) || cmp(a.exam.id, b.exam.id))
    .map(({ exam, score }) => ({ name: exam.name, date: exam.date, score, word: gradeWord(score, scheme) }));
}

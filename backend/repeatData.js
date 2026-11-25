// The card of the repeat course: candidates, enrolment, list, reading, editing, cancelling.
// Writes the table 'Повторный курс' (with backend/repeatScores.js). The finished tables of the ledger are only read.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localDateTime } from '../core/dates.js';
import { readExtra } from '../core/settings.js';
import { readScheme, readSplit } from '../core/scoring.js';
import { compareNames } from '../core/names.js';
import { checkReason } from '../core/journal.js';
import { liveAttempts } from '../core/exam.js';
import {
  checkOrder, closeState, enrolProblem, isMain, isOverdue, prevOf, repeatResult, snapshotOf, suggestKind,
} from '../core/repeat.js';
import { viewerOf } from './journalData.js';
import { readLedgerRows } from './ledgerData.js';
import { halfResults, halvesOf } from './repeatSnapshot.js';

export const REPEAT_TABLES = ['repeats', 'repeatAttempts', 'subjects', 'groups', 'staff', 'students', 'settings'];
const CANDIDATE_TABLES = ['subjects', 'groups', 'staff', 'closures', 'syllabi', 'syllabusMembers', 'settings', 'repeats'];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const invalid = (fields) => new AppError('invalid', { fields });
const nameOf = (list, id) => (list.find((r) => r.id === id) || { fullName: '' }).fullName;
const isAdmin = (user) => Array.isArray(user.roles) && user.roles.includes('admin');

function readTables(store, tables) {
  const rows = {};
  for (const table of tables) rows[table] = store.list(table);
  return rows;
}

export const readRepeatRows = (store) => readTables(store, REPEAT_TABLES);

export const mayRead = (viewer, card) => viewer.manager || viewer.reader || (viewer.teacher && card.teacherId === viewer.id && card.status !== 'cancelled');
export const mayScore = (viewer, card) => viewer.manager || (viewer.teacher && card.teacherId === viewer.id && card.status !== 'cancelled');

export const findCard = (rows, repeatId) => {
  const card = typeof repeatId === 'string' ? rows.repeats.find((c) => c.id === repeatId) : undefined;
  if (!card) throw new AppError('not_found');
  return card;
};

export const attemptsOfCard = (rows, card) => liveAttempts(rows.repeatAttempts.filter((a) => a.repeatId === card.id));
// The card shown beside the total of a student in a half: of the not cancelled ones the last by the time of creation.
export function shownCard(cards, studentId, subjectId, planSemester) {
  let best = null;
  for (const c of cards || []) {
    if (c.status === 'cancelled' || c.studentId !== studentId || c.subjectId !== subjectId || (c.planSemester ?? null) !== (planSemester ?? null)) continue;
    if (best === null || (cmp(c.createdAt || '', best.createdAt || '') || cmp(c.id, best.id)) > 0) best = c;
  }
  return best;
}

const hasResults = (card, attempts) => Number.isInteger(card.works) || attempts.length > 0;

function resultOf(rows, card, attempts) {
  return repeatResult({ card, attempts, scheme: readScheme(rows.settings), split: readSplit(rows.settings) });
}

// 'repeat' of the response: the whole card.
export function cardView(rows, platform, card, user) {
  const viewer = viewerOf(user);
  const today = localDate(platform.now());
  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const subject = rows.subjects.find((s) => s.id === card.subjectId) || { id: card.subjectId, name: '', groupId: '' };
  const group = rows.groups.find((g) => g.id === subject.groupId);
  const attempts = attemptsOfCard(rows, card);
  const result = repeatResult({ card, attempts, scheme, split });
  const close = closeState({ card, result });
  const open = card.status === 'open';
  const overdue = isOverdue(card, today);
  const score = mayScore(viewer, card);
  const prev = prevOf(card);
  return {
    id: card.id, today, status: card.status, kind: card.kind, overdue, collegeName: readExtra(rows.settings).collegeName,
    student: { id: card.studentId, fullName: nameOf(rows.students, card.studentId), groupName: group ? group.name : '', course: group && Number.isInteger(group.course) ? group.course : null },
    subject: { id: subject.id, name: subject.name, planSemester: card.planSemester },
    teacher: { id: card.teacherId, fullName: nameOf(rows.staff, card.teacherId) },
    order: { no: card.orderNo, date: card.orderDate }, deadline: card.deadline,
    prev: { ...prev, fromRepeat: card.prevRepeatId !== '' && card.prevRepeatId !== undefined && card.prevRepeatId !== null },
    works: { value: Number.isInteger(card.works) ? card.works : null, note: card.worksNote || '' },
    attempts: attempts.map((a) => ({ id: a.id, no: a.no, date: a.date, outcome: a.outcome, score: a.score, commission: a.commission })),
    result: { semester: result.semester, admitted: result.admitted, status: result.status, tries: result.tries, exam: result.exam, total: result.total, word: result.word, next: result.next },
    close: { blocking: close.blocking, outcome: close.outcome, retakesLeft: close.retakesLeft },
    closedAt: card.closedAt || '', closedByName: nameOf(rows.staff, card.closedBy),
    split: { semester: split.semester, exam: split.exam, admission: split.admission },
    scheme: { fair: scheme.fair, good: scheme.good, excellent: scheme.excellent },
    can: {
      edit: viewer.manager && open,
      cancel: viewer.manager && open && !hasResults(card, attempts),
      works: score && open && !overdue && card.kind === 'full',
      attempt: score && open && !overdue && result.next !== null && result.admitted === true,
      commission: viewer.manager,
      close: score && open,
      force: viewer.manager && open && overdue,
      reopen: isAdmin(user) && (card.status === 'passed' || card.status === 'failed'),
    },
  };
}

// The mark beside the total of the ledger and of "Оценки": only the kind, the state and the total of the repeat.
export function repeatMark(card, attempts, scheme, split) {
  const result = repeatResult({ card, attempts, scheme, split });
  return { kind: card.kind, status: card.status, total: result.total, word: result.word, main: isMain(card) };
}

// The own cards of a student, the newest first; no id of a card or of a try, no commission.
export function studentRepeats(rows, platform, studentId) {
  const today = localDate(platform.now());
  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const byCard = new Map();
  for (const a of rows.repeatAttempts || []) {
    if (!byCard.has(a.repeatId)) byCard.set(a.repeatId, []);
    byCard.get(a.repeatId).push(a);
  }
  const mine = (rows.repeats || []).filter((c) => c.studentId === studentId && c.status !== 'cancelled')
    .sort((a, b) => cmp(b.createdAt || '', a.createdAt || '') || cmp(b.id, a.id));
  return mine.map((card) => {
    const attempts = liveAttempts(byCard.get(card.id) || []);
    const result = repeatResult({ card, attempts, scheme, split });
    const subject = rows.subjects.find((s) => s.id === card.subjectId) || { name: '' };
    const prev = prevOf(card);
    return {
      subjectId: card.subjectId, subjectName: subject.name, planSemester: card.planSemester, kind: card.kind, orderNo: card.orderNo, orderDate: card.orderDate,
      deadline: card.deadline, overdue: isOverdue(card, today), status: card.status, teacherName: nameOf(rows.staff, card.teacherId),
      works: { value: Number.isInteger(card.works) ? card.works : null, note: card.worksNote || '', max: split.semester },
      attempts: attempts.map((a) => ({ no: a.no, date: a.date, outcome: a.outcome, score: a.score })),
      exam: result.exam, total: result.total, word: result.word, preliminary: card.status === 'open',
      prev: { semester: prev.semester, status: prev.status, exam: prev.exam, total: prev.total, word: prev.word },
    };
  });
}

// 'repeat.mine' {} -> { today, split, repeats }
export function repeatMine(store, platform, user) {
  const rows = readRepeatRows(store);
  const split = readSplit(rows.settings);
  return {
    today: localDate(platform.now()),
    split: { semester: split.semester, exam: split.exam, admission: split.admission },
    repeats: studentRepeats(rows, platform, user.id),
  };
}

// 'repeat.list' {} -> { today, can: { enrol }, repeats: [row] }
export function repeatList(store, platform, user) {
  const rows = readRepeatRows(store);
  const viewer = viewerOf(user);
  const today = localDate(platform.now());
  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const byCard = new Map();
  for (const a of rows.repeatAttempts) {
    if (!byCard.has(a.repeatId)) byCard.set(a.repeatId, []);
    byCard.get(a.repeatId).push(a);
  }
  const list = rows.repeats.filter((c) => mayRead(viewer, c)).map((c) => {
    const subject = rows.subjects.find((s) => s.id === c.subjectId) || { name: '', groupId: '' };
    const group = rows.groups.find((g) => g.id === subject.groupId);
    const result = repeatResult({ card: c, attempts: liveAttempts(byCard.get(c.id) || []), scheme, split });
    return {
      id: c.id, studentName: nameOf(rows.students, c.studentId), groupName: group ? group.name : '', subjectId: c.subjectId, subjectName: subject.name,
      planSemester: c.planSemester, kind: c.kind, orderNo: c.orderNo, orderDate: c.orderDate, deadline: c.deadline, overdue: isOverdue(c, today),
      teacherName: nameOf(rows.staff, c.teacherId), own: c.teacherId === user.id, status: c.status, total: result.total, word: result.word, tries: result.tries,
    };
  });
  list.sort((a, b) => ((a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1)) || cmp(a.deadline, b.deadline) || compareNames(a.studentName, b.studentName) || cmp(a.id, b.id));
  return { today, can: { enrol: viewer.manager }, repeats: list };
}

// 'repeat.get' { repeatId } -> { repeat }
export function repeatGet(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const card = findCard(rows, data.repeatId);
  if (!mayRead(viewerOf(user), card)) throw new AppError('forbidden');
  return { repeat: cardView(rows, platform, card, user) };
}

function managerOnly(user) {
  if (!viewerOf(user).manager) throw new AppError('forbidden');
}

function findSubject(rows, subjectId) {
  const subject = typeof subjectId === 'string' ? rows.subjects.find((s) => s.id === subjectId) : undefined;
  if (!subject) throw new AppError('not_found');
  return subject;
}

const lastClosedCard = (cards) => {
  let last = null;
  for (const c of cards) {
    if (!isMain(c)) continue;
    if (!last || cmp(c.closedAt || '', last.closedAt || '') > 0 || (c.closedAt === last.closedAt && cmp(c.id, last.id) > 0)) last = c;
  }
  return last;
};

// The previous result of one student in a half: the last closed failed card of the repeat, else the row of the ledger.
// -> { snap (columns prev*), prev (as in a card), fromRepeat, prevRepeatId, tries, next, cards }
function previousOf(rows, row, subjectId, planSemester, scheme, split) {
  const cards = rows.repeats.filter((c) => c.studentId === row.id && c.subjectId === subjectId && c.planSemester === planSemester);
  const last = lastClosedCard(cards);
  if (last && last.status === 'failed') {
    const attempts = attemptsOfCard(rows, last);
    const res = repeatResult({ card: last, attempts, scheme, split });
    const snap = snapshotOf({ ...res, attempts });
    return { snap, prev: prevOf(snap), fromRepeat: true, prevRepeatId: last.id, tries: res.tries, next: res.next, cards };
  }
  const snap = snapshotOf({ ...row, admitted: row.admitted === true });
  return { snap, prev: prevOf(snap), fromRepeat: false, prevRepeatId: '', tries: row.tries, next: row.next, cards };
}

const teacherOf = (rows, id) => {
  const t = typeof id === 'string' ? rows.staff.find((s) => s.id === id) : undefined;
  if (!t || t.active !== true) return null;
  return String(t.roles ?? '').split(',').map((r) => r.trim()).includes('teacher') ? t : null;
};

// 'repeat.candidates' { subjectId? }
export function repeatCandidates(store, platform, data, user) {
  managerOnly(user);
  if (data.subjectId === undefined) {
    const rows = readTables(store, CANDIDATE_TABLES);
    const subjects = [];
    for (const subject of rows.subjects) {
      const halves = halvesOf(rows, subject);
      if (halves.length === 0) continue;
      const group = rows.groups.find((g) => g.id === subject.groupId);
      subjects.push({ subjectId: subject.id, name: subject.name, groupName: group ? group.name : '', teacherName: nameOf(rows.staff, subject.teacherId), halves: halves.map((h) => h.planSemester) });
    }
    subjects.sort((a, b) => compareNames(a.groupName, b.groupName) || compareNames(a.name, b.name) || cmp(a.subjectId, b.subjectId));
    return { subjects };
  }
  const rows = readAll(store, platform);
  const subject = findSubject(rows, data.subjectId);
  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const group = rows.groups.find((g) => g.id === subject.groupId);
  const halves = halvesOf(rows, subject).map((h) => {
    const students = [];
    for (const row of halfResults(rows, platform, subject, h.planSemester, user).students) {
      const info = previousOf(rows, row, subject.id, h.planSemester, scheme, split);
      const blocked = info.cards.some((c) => c.status === 'open');
      if (!blocked && enrolProblem({ prev: info.prev, kind: 'full', cards: info.cards, fromRepeat: info.fromRepeat })) continue;
      const p = info.prev;
      students.push({
        id: row.id, fullName: row.fullName,
        prev: { semester: p.semester, admitted: p.admitted, status: p.status, exam: p.exam, total: p.total, word: p.word, tries: info.tries, retakesLeft: info.next !== null },
        suggest: suggestKind(p), blocked: blocked ? 'has_open' : null,
      });
    }
    return { planSemester: h.planSemester, current: h.current, students };
  });
  const teachers = rows.staff.filter((t) => teacherOf(rows, t.id)).map((t) => ({ id: t.id, fullName: t.fullName }))
    .sort((a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id));
  return { subject: { id: subject.id, name: subject.name, groupName: group ? group.name : '', teacherId: subject.teacherId }, teachers, halves };
}

// The tables of the ledger (settled; they include the two of the repeat), each read once.
const readAll = (store, platform) => readLedgerRows(store, platform);

export const logRow = (at, user, card, field, before, after, reason = '') => ({
  at, actorId: user.id, entity: 'repeat', subjectId: card.subjectId, pairId: '', studentId: card.studentId, unit: null, field, before, after, reason, late: false,
});

// 'repeat.enrol' { subjectId, planSemester, studentId, kind, orderNo, orderDate, deadline, teacherId } -> { repeat }
export function enrol(store, platform, data, user) {
  managerOnly(user);
  const rows = readAll(store, platform);
  const subject = findSubject(rows, data.subjectId);
  const half = halvesOf(rows, subject).find((h) => h.planSemester === data.planSemester);
  if (!half) throw invalid([{ field: 'planSemester', code: 'final_open' }]);
  const row = halfResults(rows, platform, subject, half.planSemester, user).students.find((s) => s.id === data.studentId);
  if (!row) throw invalid([{ field: 'studentId', code: 'bad_ref' }]);

  const scheme = readScheme(rows.settings);
  const split = readSplit(rows.settings);
  const today = localDate(platform.now());
  const info = previousOf(rows, row, subject.id, half.planSemester, scheme, split);
  const problems = [];
  const problem = enrolProblem({ prev: info.prev, kind: data.kind, cards: info.cards, fromRepeat: info.fromRepeat });
  if (problem) problems.push(problem);
  const order = checkOrder(data, { today });
  problems.push(...order.problems);
  const teacher = teacherOf(rows, data.teacherId);
  if (!teacher) problems.push({ field: 'teacherId', code: 'bad_ref' });
  if (problems.length > 0) throw invalid(problems);

  const at = localDateTime(platform.now());
  const [card] = store.insertMany('repeats', [{
    studentId: row.id, subjectId: subject.id, planSemester: half.planSemester, kind: data.kind, ...order.value, teacherId: teacher.id,
    ...info.snap, prevRepeatId: info.prevRepeatId, works: null, worksNote: '', status: 'open',
    createdBy: user.id, createdAt: at, updatedBy: user.id, updatedAt: at, closedBy: '', closedAt: '',
  }]);
  store.insertMany('changeLog', [logRow(at, user, card, 'enrol', '', card.kind)]);
  return { repeat: cardView({ ...rows, repeats: [...rows.repeats, card] }, platform, card, user) };
}

function openCard(rows, data, user) {
  const card = findCard(rows, data.repeatId);
  managerOnly(user);
  if (card.status !== 'open') throw new AppError('repeat_closed');
  return card;
}

// 'repeat.save' { repeatId, orderNo, orderDate, deadline, teacherId } -> { repeat }
export function saveCard(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const card = openCard(rows, data, user);
  const today = localDate(platform.now());
  const sameDeadline = data.deadline === card.deadline;
  const order = checkOrder({ ...data, deadline: sameDeadline ? today : data.deadline }, { today });
  const problems = [...order.problems];
  const sameTeacher = data.teacherId === card.teacherId;
  const teacher = sameTeacher ? { id: card.teacherId, fullName: nameOf(rows.staff, card.teacherId) } : teacherOf(rows, data.teacherId);
  if (!teacher) problems.push({ field: 'teacherId', code: 'bad_ref' });
  const attempts = attemptsOfCard(rows, card);
  if (order.value && attempts.length > 0 && order.value.orderDate > attempts.reduce((min, a) => (a.date < min ? a.date : min), attempts[0].date)) {
    problems.push({ field: 'orderDate', code: 'after_attempt' });
  }
  if (problems.length > 0) throw invalid(problems);

  const value = { ...order.value, deadline: sameDeadline ? card.deadline : order.value.deadline };
  const at = localDateTime(platform.now());
  const log = [];
  for (const field of ['orderNo', 'orderDate', 'deadline']) {
    if (value[field] !== card[field]) log.push(logRow(at, user, card, field, card[field], value[field]));
  }
  if (teacher.id !== card.teacherId) log.push(logRow(at, user, card, 'teacher', nameOf(rows.staff, card.teacherId), teacher.fullName));
  if (log.length === 0) return { repeat: cardView(rows, platform, card, user) };

  const patch = { ...value, teacherId: teacher.id, updatedBy: user.id, updatedAt: at };
  const [saved] = store.updateMany('repeats', [{ id: card.id, patch }]);
  store.insertMany('changeLog', log);
  return { repeat: cardView(rows, platform, saved || { ...card, ...patch }, user) };
}

// 'repeat.cancel' { repeatId, reason } -> { repeat }
export function cancelCard(store, platform, data, user) {
  const rows = readRepeatRows(store);
  const card = openCard(rows, data, user);
  if (hasResults(card, attemptsOfCard(rows, card))) throw invalid([{ field: 'repeat', code: 'has_results' }]);
  const code = checkReason(data.reason);
  if (code) throw invalid([{ field: 'reason', code }]);
  const at = localDateTime(platform.now());
  const patch = { status: 'cancelled', closedBy: user.id, closedAt: at, updatedBy: user.id, updatedAt: at };
  const [saved] = store.updateMany('repeats', [{ id: card.id, patch }]);
  store.insertMany('changeLog', [logRow(at, user, card, 'status', 'open', 'cancelled', data.reason.trim())]);
  return { repeat: cardView(rows, platform, saved || { ...card, ...patch }, user) };
}

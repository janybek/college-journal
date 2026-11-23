// The journal of a subject: reading with points, units and rights. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { isDate, localDate, localDateTime, localTime } from '../core/dates.js';
import { FIXED_STATUSES, RESULT_FIELDS } from '../core/schema.js';
import { readSettings } from '../core/settings.js';
import { readScheme } from '../core/scoring.js';
import { NO_LESSON, inSemester } from '../core/topics.js';
import { syllabusFor } from '../core/syllabus.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { compareNames } from '../core/names.js';
import { isSubstitution } from '../core/schedule.js';
import { firstPairId, studentResults } from '../core/grades.js';
import { LESSON_CLEAR, startProblem } from '../core/lesson.js';
import { currentAttempt, selfByWork } from '../core/work.js';
import { checkMark, checkReason, checkResultValue, markChanges, markMode, markState, normalizeMark } from '../core/journal.js';
import { relayout } from './scheduleData.js';
import { settleLessons } from './lessonSettle.js';

export const JOURNAL_TABLES = ['subjects', 'groups', 'staff', 'students', 'pairs', 'topics', 'syllabi', 'units', 'settings', 'attendance', 'unitResults', 'assignments', 'submissions'];

// Every table of the journal, each read once. `settings` stays the rows of the sheet.
export function readJournalRows(store) {
  const rows = {};
  for (const table of JOURNAL_TABLES) rows[table] = store.list(table);
  return rows;
}

// The same rows with the started pairs settled (the window ended, the pair closed); written in the same request.
export function readSettledRows(store, platform) {
  return settleLessons(store, platform, readJournalRows(store));
}

// -> { id, teacher, manager (admin or dean), reader (prorector) }
export function viewerOf(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return {
    id: user.id,
    teacher: roles.includes('teacher'),
    manager: roles.includes('admin') || roles.includes('dean'),
    reader: roles.includes('prorector'),
  };
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The self-work assignments of a subject in the plan half in force, by unit.
function srsByUnit(rows, subject, planSemester) {
  const byUnit = new Map();
  for (const a of rows.assignments) {
    if (a.kind !== 'srs' || a.subjectId !== subject.id || (a.planSemester ?? null) !== planSemester || !Number.isInteger(a.unit)) continue;
    if (!byUnit.has(a.unit)) byUnit.set(a.unit, []);
    byUnit.get(a.unit).push(a);
  }
  return byUnit;
}

// The self-work of one student counted from the assignments: Map(unit -> selfByWork(...)), only of the units that have assignments.
export function selfWorkOf(rows, subject, planSemester, studentId, nowMs, self) {
  const byUnit = srsByUnit(rows, subject, planSemester);
  const result = new Map();
  if (byUnit.size === 0) return result;
  const ids = new Set([...byUnit.values()].flat().map((a) => a.id));
  const lists = new Map();
  for (const r of rows.submissions) {
    if (r.studentId !== studentId || !ids.has(r.assignmentId)) continue;
    if (!lists.has(r.assignmentId)) lists.set(r.assignmentId, []);
    lists.get(r.assignmentId).push(r);
  }
  const attemptOf = new Map([...lists].map(([id, list]) => [id, currentAttempt(list)]));
  for (const [unit, assignments] of byUnit) result.set(unit, selfByWork({ assignments, attemptOf, nowMs, self }));
  return result;
}

const nameOf = (rows, id) => (rows.find((r) => r.id === id) || { fullName: '' }).fullName;

// Of several rows of one key the last one wins: by `stamp`, then by id.
export function lastOf(list, stamp) {
  let best = null;
  for (const row of list) {
    const order = best === null ? 1 : cmp(row[stamp] || '', best[stamp] || '') || cmp(row.id, best.id);
    if (order > 0) best = row;
  }
  return best;
}

export function journalView(rows, platform, subjectId, user) {
  const subject = typeof subjectId === 'string' ? rows.subjects.find((s) => s.id === subjectId) : undefined;
  if (!subject) throw new AppError('not_found');
  const viewer = viewerOf(user);
  const settings = readSettings(rows.settings);
  const scheme = readScheme(rows.settings);
  const owner = viewer.teacher && subject.teacherId === viewer.id;
  const all = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
  const whole = viewer.manager || viewer.reader || owner;
  const visible = whole ? all : all.filter((p) => viewer.teacher && p.teacherId === viewer.id);
  if (visible.length === 0 && !whole) throw new AppError('forbidden');
  const partial = !whole;

  const nowMs = platform.now();
  const now = { date: localDate(nowMs), time: localTime(nowMs) };
  const syllabus = syllabusFor(subject, rows.syllabi, settings.semester);
  const planSemester = syllabus && Number.isInteger(syllabus.planSemester) ? syllabus.planSemester : null;

  // lessons of the pairs
  const topics = new Map(rows.topics.map((t) => [t.id, t]));
  const numbersOf = new Map();
  const numberOf = (topic) => {
    if (!numbersOf.has(topic.syllabusId)) numbersOf.set(topic.syllabusId, lessonNumbers(rows.topics.filter((r) => r.syllabusId === topic.syllabusId)));
    return numbersOf.get(topic.syllabusId).get(topic.id);
  };
  const first = firstPairId(all);
  const unitOf = (p) => { const t = topics.get(p.topicId); return t && Number.isInteger(t.unit) ? t.unit : null; };
  const held = (p) => FIXED_STATUSES.includes(p.status);

  const pairs = [...visible].sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot || cmp(a.id, b.id)).map((p) => {
    const topic = topics.get(p.topicId);
    const unit = unitOf(p);
    const state = markState(p, now, scheme);
    const teacher = viewer.teacher && (p.teacherId === viewer.id || subject.teacherId === viewer.id);
    // 'open': the pair runs and this person leads it; 'start': this person may start it now; otherwise null
    const leads = viewer.teacher && p.teacherId === viewer.id;
    const lesson = leads && p.status === 'running' ? 'open' : leads && startProblem(p, nowMs) === null ? 'start' : null;
    return {
      id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, startedAt: p.startedAt || '', lesson, status: p.status, state,
      mode: markMode({ state, held: held(p), teacher, manager: viewer.manager }),
      lessonType: p.lessonType, unit, topicName: topic ? topic.name : '', number: topic ? (numberOf(topic) ?? '') : '',
      first: p.id === first, counts: held(p) && p.lessonType !== 'control' && unit !== null,
      teacherId: p.teacherId, teacherName: nameOf(rows.staff, p.teacherId), substitution: isSubstitution(p, subject),
    };
  });

  // marks of the visible pairs: of the rows of one pair and student the last one
  const visibleIds = new Set(visible.map((p) => p.id));
  const byKey = new Map();
  for (const row of rows.attendance) {
    if (!visibleIds.has(row.pairId)) continue;
    const key = row.pairId + '\n' + row.studentId;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  const marks = {};
  const rawMarks = new Map();       // student id -> Map(pair id -> mark)
  for (const list of byKey.values()) {
    const row = lastOf(list, 'markedAt');
    if (!marks[row.pairId]) marks[row.pairId] = {};
    marks[row.pairId][row.studentId] = { status: row.status, noCoat: row.noCoat === true, activity: row.activity ?? null, source: row.source, markedAt: row.markedAt };
    if (!rawMarks.has(row.studentId)) rawMarks.set(row.studentId, new Map());
    rawMarks.get(row.studentId).set(row.pairId, { status: row.status, noCoat: row.noCoat === true, activity: row.activity });
  }

  // unit rows of this subject and half of the plan
  const unitRows = new Map();       // student id -> Map(unit -> row)
  if (!partial) {
    const grouped = new Map();
    for (const r of rows.unitResults) {
      if (r.subjectId !== subject.id || (r.planSemester ?? null) !== planSemester) continue;
      const key = r.studentId + '\n' + r.unit;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(r);
    }
    for (const list of grouped.values()) {
      const row = lastOf(list, 'updatedAt');
      if (!unitRows.has(row.studentId)) unitRows.set(row.studentId, new Map());
      unitRows.get(row.studentId).set(row.unit, row);
    }
  }

  // students: the active ones of the group, then those who have marks or unit rows here but are not in the list
  const group = rows.groups.find((g) => g.id === subject.groupId);
  const byName = (a, b) => compareNames(a.fullName, b.fullName) || cmp(a.id, b.id);
  const listed = rows.students.filter((s) => s.groupId === subject.groupId && s.active === true).sort(byName);
  const listedIds = new Set(listed.map((s) => s.id));
  const known = new Set([...rawMarks.keys(), ...unitRows.keys()]);
  const left = rows.students.filter((s) => !listedIds.has(s.id) && known.has(s.id)).sort(byName);
  const students = [...listed.map((s) => ({ id: s.id, fullName: s.fullName, left: false })), ...left.map((s) => ({ id: s.id, fullName: s.fullName, left: true }))];

  // units: of the syllabus in force and of the held pairs
  const unitNumbers = new Set();
  const titles = new Map();
  if (!partial) {
    if (syllabus) {
      for (const t of rows.topics) if (t.syllabusId === syllabus.id && Number.isInteger(t.unit)) unitNumbers.add(t.unit);
      for (const u of rows.units) if (u.syllabusId === syllabus.id) titles.set(u.unit, u.title || '');
    }
    for (const p of all) if (held(p) && unitOf(p) !== null) unitNumbers.add(unitOf(p));
  }
  const unitList = [...unitNumbers].sort((a, b) => a - b);

  const byWork = partial ? new Map() : srsByUnit(rows, subject, planSemester);
  const results = {};
  if (!partial) {
    const forCount = all.map((p) => ({ id: p.id, status: p.status, lessonType: p.lessonType, unit: unitOf(p), first: p.id === first }));
    for (const s of students) {
      const selfWork = selfWorkOf(rows, subject, planSemester, s.id, nowMs, scheme.self);
      results[s.id] = studentResults({ pairs: forCount, marks: rawMarks.get(s.id) || new Map(), unitRows: unitRows.get(s.id) || new Map(), units: unitList, scheme, selfWork });
    }
  }

  return {
    today: now.date, now: now.time,
    subject: {
      id: subject.id, name: subject.name, groupId: subject.groupId, groupName: group ? group.name : '',
      teacherId: subject.teacherId, teacherName: nameOf(rows.staff, subject.teacherId),
      semester: settings.semester, planSemester, hasSyllabus: syllabus !== null,
    },
    scheme, partial, can: { results: viewer.manager || owner, manage: viewer.manager },
    students, pairs, marks,
    units: unitList.map((unit) => (byWork.has(unit) ? { unit, title: titles.get(unit) || '', byWork: true } : { unit, title: titles.get(unit) || '' })),
    results,
  };
}

// The list of journals: the subjects the person may open, with the counters of the pairs still to be marked.
// A teacher who only substituted gets the counters of his own pairs, never the numbers of the whole subject.
export function journalList(rows, platform, user) {
  const viewer = viewerOf(user);
  const settings = readSettings(rows.settings);
  const scheme = readScheme(rows.settings);
  const nowMs = platform.now();
  const now = { date: localDate(nowMs), time: localTime(nowMs) };

  const pairsOf = new Map();
  for (const p of rows.pairs) {
    if (!inSemester(p.date, settings)) continue;
    if (!pairsOf.has(p.subjectId)) pairsOf.set(p.subjectId, []);
    pairsOf.get(p.subjectId).push(p);
  }
  const groupName = (id) => (rows.groups.find((g) => g.id === id) || { name: '' }).name;

  const list = [];
  for (const subject of rows.subjects) {
    const all = pairsOf.get(subject.id) || [];
    const mine = viewer.teacher ? all.filter((p) => p.teacherId === viewer.id) : [];
    const own = viewer.teacher && subject.teacherId === viewer.id;
    const covers = mine.length > 0;
    if (!viewer.manager && !viewer.reader && !own && !covers) continue;
    const counted = viewer.manager || viewer.reader || own ? all : mine;
    let heldCount = 0;
    let unfilled = 0;
    let overdue = 0;
    for (const p of counted) {
      if (FIXED_STATUSES.includes(p.status)) heldCount += 1;
      if (p.status !== 'planned') continue;
      const state = markState(p, now, scheme);
      if (state === 'open' || state === 'late') unfilled += 1;
      if (state === 'late') overdue += 1;
    }
    list.push({
      subjectId: subject.id, name: subject.name, groupId: subject.groupId, groupName: groupName(subject.groupId),
      teacherId: subject.teacherId, teacherName: nameOf(rows.staff, subject.teacherId),
      own, covers, held: heldCount, unfilled, overdue,
    });
  }
  list.sort((a, b) => compareNames(a.groupName, b.groupName) || compareNames(a.name, b.name) || cmp(a.subjectId, b.subjectId));
  return { today: now.date, subjects: list };
}

const MARKS_MAX = 200;
const sameMark = (a, b) => a.status === b.status && a.noCoat === b.noCoat && a.activity === b.activity;

// Writes the marks of one pair: the new rows in one batch, the changed ones in another; a pair not yet held becomes closed.
// Low level: no rights, no term. items: [{ studentId, status, noCoat, activity }]; existing: Map(studentId -> the row of the pair).
// -> { inserted, updated (the saved rows), closed (the pair was closed by this write) }
export function writeMarks(store, { pair, subject, items, existing, actorId, at, source = 'teacher' }) {
  const stamp = { source, markedBy: actorId, markedAt: at };
  const fresh = [];
  const patches = [];
  for (const item of items) {
    const next = { status: item.status, noCoat: item.noCoat === true, activity: item.activity === undefined ? null : item.activity };
    const old = existing.get(item.studentId);
    if (!old) fresh.push({ pairId: pair.id, studentId: item.studentId, ...next, ...stamp });
    else if (!sameMark({ status: old.status, noCoat: old.noCoat === true, activity: old.activity ?? null }, next)) patches.push({ id: old.id, patch: { ...next, ...stamp } });
  }
  const inserted = fresh.length > 0 ? store.insertMany('attendance', fresh) : [];
  const updated = patches.length > 0 ? store.updateMany('attendance', patches) : [];
  const closed = pair.status === 'planned' && items.length > 0;
  if (closed) store.updateMany('pairs', [{ id: pair.id, patch: { status: 'closed', substitute: isSubstitution(pair, subject) } }]);
  return { inserted, updated, closed };
}

const badRef = (index) => ({ index, field: 'studentId', code: 'bad_ref' });
const markOf = (row) => (row ? { status: row.status, noCoat: row.noCoat === true, activity: row.activity ?? null } : null);

// 'journal.savePair': the marks of every student of a pair, all or nothing. Returns { journal }.
export function savePairMarks(store, platform, data, user) {
  const rows = readSettledRows(store, platform);
  const pair = typeof data.pairId === 'string' ? rows.pairs.find((p) => p.id === data.pairId) : undefined;
  if (!pair) throw new AppError('not_found');
  const marks = data.marks;
  if (!Array.isArray(marks) || marks.length === 0 || marks.length > MARKS_MAX) throw new AppError('bad_request');
  const seen = new Set();
  for (const m of marks) {
    if (m === null || typeof m !== 'object' || Array.isArray(m) || typeof m.studentId !== 'string' || seen.has(m.studentId)) throw new AppError('bad_request');
    seen.add(m.studentId);
  }

  const subject = rows.subjects.find((s) => s.id === pair.subjectId);
  const viewer = viewerOf(user);
  const teacher = viewer.teacher && (pair.teacherId === user.id || (!!subject && subject.teacherId === user.id));
  if (!subject || (!teacher && !viewer.manager)) throw new AppError('forbidden');

  const scheme = readScheme(rows.settings);
  const settings = readSettings(rows.settings);
  const nowMs = platform.now();
  const state = markState(pair, { date: localDate(nowMs), time: localTime(nowMs) }, scheme);
  if (state === 'future') throw new AppError('too_early');
  if (state === 'cancelled' || state === 'missed') throw new AppError('pair_locked');
  const held = FIXED_STATUSES.includes(pair.status);
  const mode = markMode({ state, held, teacher, manager: viewer.manager });
  if (mode === 'none') throw new AppError('journal_closed');

  // the saved marks of this pair: of the rows of one student the last one
  const byStudent = new Map();
  for (const row of rows.attendance) {
    if (row.pairId !== pair.id) continue;
    const list = byStudent.get(row.studentId) || [];
    list.push(row);
    byStudent.set(row.studentId, list);
  }
  const existing = new Map([...byStudent].map(([id, list]) => [id, lastOf(list, 'markedAt')]));

  // who is on the list: the active students of the group (a held pair also keeps the students who have a mark on it)
  const active = rows.students.filter((s) => s.groupId === pair.groupId && s.active === true);
  const activeIds = new Set(active.map((s) => s.id));
  const known = new Set(rows.students.map((s) => s.id));
  const refs = [];
  marks.forEach((m, index) => {
    if (!activeIds.has(m.studentId) && !(held && existing.has(m.studentId) && known.has(m.studentId))) refs.push(badRef(index));
  });
  if (refs.length > 0) throw new AppError('invalid', { fields: refs });
  if (!held && active.some((s) => !seen.has(s.id))) throw new AppError('invalid', { fields: [{ field: 'marks', code: 'incomplete' }] });

  // every mark against the rules of its mode
  const all = rows.pairs.filter((p) => p.subjectId === subject.id && inSemester(p.date, settings));
  const markPair = { first: pair.id === firstPairId(all), lessonType: pair.lessonType };
  const problems = [];
  const items = [];
  marks.forEach((m, index) => {
    const next = normalizeMark(m);
    if (next === null) { problems.push({ index, field: 'status', code: 'bad_value' }); return; }
    const old = markOf(existing.get(m.studentId));
    for (const e of checkMark(old, next, { mode, pair: markPair, scheme })) problems.push({ index, ...e });
    items.push({ studentId: m.studentId, old, next });
  });
  if (problems.length > 0) throw new AppError('invalid', { fields: problems });

  const changed = items.filter((i) => markChanges(i.old, i.next).length > 0);
  let reason = '';
  if (mode !== 'free' && changed.length > 0) {
    const code = checkReason(data.reason);
    if (code) throw new AppError('invalid', { fields: [{ field: 'reason', code }] });
    reason = data.reason.trim();
  }
  if (changed.length === 0) return { journal: journalView(rows, platform, subject.id, user) };

  const at = localDateTime(nowMs);
  const written = writeMarks(store, { pair, subject, items: changed.map((i) => ({ studentId: i.studentId, ...i.next })), existing, actorId: user.id, at });
  const entry = { at, actorId: user.id, subjectId: subject.id, pairId: pair.id, reason, late: state === 'late' };
  const log = [];
  if (!held && mode === 'reason') log.push({ ...entry, entity: 'pair', field: 'status', before: 'planned', after: 'closed' });
  // a first mark of a pair is not logged; the mark of a student on a held pair is, even a new one.
  // During the pair the teacher's log keeps only a changed status of a student who already had a mark.
  const during = pair.status === 'running' && mode === 'free';
  if (held) {
    for (const i of changed) {
      for (const c of markChanges(i.old, i.next)) {
        if (during && (c.field !== 'status' || i.old === null)) continue;
        log.push({ ...entry, entity: 'mark', studentId: i.studentId, ...c });
      }
    }
  }
  if (log.length > 0) store.insertMany('changeLog', log);

  // the answer is built from the rows as they are now, without a second read
  const replaced = new Map(written.updated.map((r) => [r.id, r]));
  const after = {
    ...rows,
    attendance: [...rows.attendance.map((r) => replaced.get(r.id) || r), ...written.inserted],
    pairs: rows.pairs.map((p) => (p.id === pair.id && written.closed ? { ...p, status: 'closed', substitute: isSubstitution(pair, subject) } : p)),
  };
  return { journal: journalView(after, platform, subject.id, user) };
}

const COLUMN_OF = { control: 'control', self: 'self', current: 'currentManual' };
const logText = (value) => (value === null || value === undefined ? '' : String(value));

// 'journal.saveResults': the control, self-work or manual current points of one unit for several students, all or nothing.
// Returns { journal }.
export function saveUnitResults(store, platform, data, user) {
  const rows = readSettledRows(store, platform);
  const subject = typeof data.subjectId === 'string' ? rows.subjects.find((s) => s.id === data.subjectId) : undefined;
  if (!subject) throw new AppError('not_found');
  const field = data.field;
  const items = data.items;
  if (!RESULT_FIELDS.includes(field) || !Array.isArray(items) || items.length === 0 || items.length > MARKS_MAX) throw new AppError('bad_request');
  const seen = new Set();
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item) || typeof item.studentId !== 'string' || seen.has(item.studentId)) throw new AppError('bad_request');
    seen.add(item.studentId);
  }

  const viewer = viewerOf(user);
  const owner = viewer.teacher && subject.teacherId === user.id;
  if (!owner && !viewer.manager) throw new AppError('forbidden');

  const settings = readSettings(rows.settings);
  const scheme = readScheme(rows.settings);
  const syllabus = syllabusFor(subject, rows.syllabi, settings.semester);
  if (!syllabus) throw new AppError('no_syllabus');
  const planSemester = Number.isInteger(syllabus.planSemester) ? syllabus.planSemester : null;

  const view = journalView(rows, platform, subject.id, user);
  if (!Number.isInteger(data.unit) || !view.units.some((u) => u.unit === data.unit)) throw new AppError('invalid', { fields: [{ field: 'unit', code: 'bad_value' }] });
  if (field === 'self' && view.units.find((u) => u.unit === data.unit).byWork === true) throw new AppError('invalid', { fields: [{ field: 'unit', code: 'self_by_work' }] });

  // the saved rows of this subject: of the rows of one student and unit the last one wins
  const grouped = new Map();
  const withRows = new Set();
  for (const r of rows.unitResults) {
    if (r.subjectId !== subject.id) continue;
    withRows.add(r.studentId);
    if ((r.planSemester ?? null) !== planSemester || r.unit !== data.unit) continue;
    const list = grouped.get(r.studentId) || [];
    list.push(r);
    grouped.set(r.studentId, list);
  }
  const existing = new Map([...grouped].map(([id, list]) => [id, lastOf(list, 'updatedAt')]));

  const active = new Set(rows.students.filter((s) => s.groupId === subject.groupId && s.active === true).map((s) => s.id));
  const known = new Set(rows.students.map((s) => s.id));
  const problems = [];
  items.forEach((item, index) => {
    if (!active.has(item.studentId) && !(withRows.has(item.studentId) && known.has(item.studentId))) problems.push(badRef(index));
    else if (checkResultValue(field, item.value, scheme) !== null) problems.push({ index, field: 'value', code: 'bad_value' });
  });
  if (problems.length > 0) throw new AppError('invalid', { fields: problems });

  const column = COLUMN_OF[field];
  const changed = [];
  for (const item of items) {
    const row = existing.get(item.studentId);
    const old = row && row[column] !== undefined ? row[column] : null;
    if (old !== item.value) changed.push({ studentId: item.studentId, row, old, value: item.value });
  }
  if (changed.length === 0) return { journal: view };

  let reason = '';
  if (field === 'current' || !owner || changed.some((c) => c.old !== null)) {
    const code = checkReason(data.reason);
    if (code) throw new AppError('invalid', { fields: [{ field: 'reason', code }] });
    reason = data.reason.trim();
  }

  const at = localDateTime(platform.now());
  const stamp = { updatedBy: user.id, updatedAt: at };
  const fresh = changed.filter((c) => !c.row).map((c) => ({
    subjectId: subject.id, studentId: c.studentId, planSemester, unit: data.unit, control: null, self: null, currentManual: null, [column]: c.value, ...stamp,
  }));
  const patches = changed.filter((c) => c.row).map((c) => ({ id: c.row.id, patch: { [column]: c.value, ...stamp } }));
  const inserted = fresh.length > 0 ? store.insertMany('unitResults', fresh) : [];
  const updated = patches.length > 0 ? store.updateMany('unitResults', patches) : [];
  store.insertMany('changeLog', changed.map((c) => ({
    at, actorId: user.id, entity: 'unit', subjectId: subject.id, studentId: c.studentId, unit: data.unit, field,
    before: logText(c.old), after: logText(c.value), reason, late: false,
  })));

  const replaced = new Map(updated.map((r) => [r.id, r]));
  const after = { ...rows, unitResults: [...rows.unitResults.map((r) => replaced.get(r.id) || r), ...inserted] };
  return { journal: journalView(after, platform, subject.id, user) };
}

const LOG_LIMIT = 200;
const LOG_LIMIT_MAX = 500;

// 'journal.log': the change log, the newest first. Optional filters: subjectId, pairId, studentId, groupId (the group of the row's subject), from, to; they are applied before the limit. A teacher reads only the log of his own subject.
export function changeLogView(store, platform, data, user) {
  const viewer = viewerOf(user);
  if (!viewer.manager && !viewer.reader && !viewer.teacher) throw new AppError('forbidden');
  const given = (key) => data[key] !== undefined && data[key] !== null;
  for (const key of ['subjectId', 'pairId', 'studentId', 'groupId']) if (given(key) && typeof data[key] !== 'string') throw new AppError('bad_request');
  for (const key of ['from', 'to']) if (given(key) && !isDate(data[key])) throw new AppError('bad_request');
  if (given('limit') && !(Number.isInteger(data.limit) && data.limit >= 1 && data.limit <= LOG_LIMIT_MAX)) throw new AppError('bad_request');
  const limit = given('limit') ? data.limit : LOG_LIMIT;

  const changeLog = store.list('changeLog');
  const staff = store.list('staff');
  const students = store.list('students');
  const subjects = store.list('subjects');
  const groups = store.list('groups');
  const pairs = store.list('pairs');
  const assignments = store.list('assignments');

  if (!viewer.manager && !viewer.reader) {
    const own = given('subjectId') && subjects.some((s) => s.id === data.subjectId && s.teacherId === user.id);
    if (!own) throw new AppError('forbidden');
  }

  const byId = (list) => new Map(list.map((r) => [r.id, r]));
  const staffOf = byId(staff);
  const studentOf = byId(students);
  const subjectOf = byId(subjects);
  const groupOf = byId(groups);
  const pairOf = byId(pairs);
  const assignmentOf = byId(assignments);

  const picked = changeLog.filter((r) => {
    if (given('subjectId') && r.subjectId !== data.subjectId) return false;
    if (given('pairId') && r.pairId !== data.pairId) return false;
    if (given('studentId') && r.studentId !== data.studentId) return false;
    if (given('groupId') && (subjectOf.get(r.subjectId) || {}).groupId !== data.groupId) return false;
    const day = String(r.at || '').slice(0, 10);
    if (given('from') && day < data.from) return false;
    if (given('to') && day > data.to) return false;
    return true;
  }).sort((a, b) => cmp(b.at || '', a.at || '') || cmp(b.id, a.id));

  const nameIn = (map, id) => (map.get(id) || {}).fullName || '';
  const out = picked.slice(0, limit).map((r) => {
    const subject = subjectOf.get(r.subjectId);
    const pair = pairOf.get(r.pairId);
    const group = subject ? groupOf.get(subject.groupId) : undefined;
    const row = {
      id: r.id, at: r.at, actorName: nameIn(staffOf, r.actorId), entity: r.entity, field: r.field,
      before: r.before ?? '', after: r.after ?? '', reason: r.reason ?? '', late: r.late === true,
      subjectId: r.subjectId || '', subjectName: subject ? subject.name : '', groupName: group ? group.name : '',
      pairId: r.pairId || '', pairDate: pair ? pair.date : '', pairSlot: pair ? pair.slot : '',
      studentId: r.studentId || '', studentName: nameIn(studentOf, r.studentId), unit: r.unit ?? null,
    };
    if (r.entity === 'work') {
      row.assignmentId = r.assignmentId || '';
      row.assignmentTitle = (assignmentOf.get(r.assignmentId) || {}).title || '';
    }
    return row;
  });
  return { today: localDate(platform.now()), rows: out, more: picked.length > limit };
}

// The marks of a pair that has none left, as lines of the change log: the last row of each student, one line per filled field.
function clearedMarkLog(rows, entry) {
  const byStudent = new Map();
  for (const row of rows) byStudent.set(row.studentId, [...(byStudent.get(row.studentId) || []), row]);
  const log = [];
  for (const [studentId, list] of byStudent) {
    const old = markOf(lastOf(list, 'markedAt'));
    for (const c of markChanges(old, { status: '', noCoat: false, activity: null })) log.push({ ...entry, entity: 'mark', studentId, field: c.field, before: c.before, after: '' });
  }
  return log;
}

// 'journal.missPair' and 'journal.reopenPair': the deanery moves a pair to or from "missed", or clears the marks of a held pair.
// The pair is written together with the lessons of its subject laid out again; the answer is the journal after the write.
function changePairStatus(store, platform, data, user, reopen) {
  if (!viewerOf(user).manager) throw new AppError('forbidden');
  const rows = readSettledRows(store, platform);
  const pair = typeof data.pairId === 'string' ? rows.pairs.find((p) => p.id === data.pairId) : undefined;
  const subject = pair && rows.subjects.find((s) => s.id === pair.subjectId);
  if (!pair || !subject) throw new AppError('not_found');
  const code = checkReason(data.reason);
  if (code) throw new AppError('invalid', { fields: [{ field: 'reason', code }] });
  const reason = data.reason.trim();

  const nowMs = platform.now();
  const state = markState({ ...pair, status: 'planned' }, { date: localDate(nowMs), time: localTime(nowMs) }, readScheme(rows.settings));
  const marks = rows.attendance.filter((r) => r.pairId === pair.id);
  let patch;
  if (!reopen) {
    if (pair.status !== 'planned') throw new AppError('pair_locked');
    if (state === 'future') throw new AppError('too_early');
    if (marks.length > 0) throw new AppError('has_marks');
    patch = { status: 'missed', ...NO_LESSON };
  } else if (pair.status === 'missed' || pair.status === 'closed') patch = pair.status === 'closed' && pair.startedAt ? { status: 'planned', ...LESSON_CLEAR } : { status: 'planned' };
  else throw new AppError('pair_locked');

  const at = localDateTime(nowMs);
  const entry = { at, actorId: user.id, subjectId: subject.id, pairId: pair.id, reason, late: state === 'late' };
  const log = [...(reopen && pair.status === 'closed' ? clearedMarkLog(marks, entry) : []),
    { ...entry, entity: 'pair', field: 'status', before: pair.status, after: patch.status }];
  if (reopen && marks.length > 0) store.removeMany('attendance', marks.map((r) => r.id));
  store.insertMany('changeLog', log);
  const pairs = rows.pairs.map((p) => (p.id === pair.id ? { ...p, ...patch } : p));
  const laid = relayout(store, [subject.id], { ...rows, settings: readSettings(rows.settings), pairs }, [{ id: pair.id, patch }]);
  const after = { ...rows, pairs: laid.pairs, attendance: reopen ? rows.attendance.filter((r) => r.pairId !== pair.id) : rows.attendance };
  return { journal: journalView(after, platform, subject.id, user) };
}

export const missPair = (store, platform, data, user) => changePairStatus(store, platform, data, user, false);
export const reopenPair = (store, platform, data, user) => changePairStatus(store, platform, data, user, true);

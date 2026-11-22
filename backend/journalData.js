// The journal of a subject: reading with points, units and rights. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, localTime } from '../core/dates.js';
import { FIXED_STATUSES } from '../core/schema.js';
import { readSettings } from '../core/settings.js';
import { readScheme } from '../core/scoring.js';
import { inSemester } from '../core/topics.js';
import { syllabusFor } from '../core/syllabus.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { compareNames } from '../core/names.js';
import { isSubstitution } from '../core/schedule.js';
import { firstPairId, studentResults } from '../core/grades.js';
import { markMode, markState } from '../core/journal.js';

export const JOURNAL_TABLES = ['subjects', 'groups', 'staff', 'students', 'pairs', 'topics', 'syllabi', 'units', 'settings', 'attendance', 'unitResults'];

// Every table of the journal, each read once. `settings` stays the rows of the sheet.
export function readJournalRows(store) {
  const rows = {};
  for (const table of JOURNAL_TABLES) rows[table] = store.list(table);
  return rows;
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
const nameOf = (rows, id) => (rows.find((r) => r.id === id) || { fullName: '' }).fullName;

// Of several rows of one key the last one wins: by `stamp`, then by id.
function lastOf(list, stamp) {
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
    return {
      id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, status: p.status, state,
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

  const results = {};
  if (!partial) {
    const forCount = all.map((p) => ({ id: p.id, status: p.status, lessonType: p.lessonType, unit: unitOf(p), first: p.id === first }));
    for (const s of students) {
      results[s.id] = studentResults({ pairs: forCount, marks: rawMarks.get(s.id) || new Map(), unitRows: unitRows.get(s.id) || new Map(), units: unitList, scheme });
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
    units: unitList.map((unit) => ({ unit, title: titles.get(unit) || '' })),
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

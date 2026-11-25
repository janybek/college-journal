// Syllabi: the semester of the year, whose syllabus a subject follows, totals, how the lessons fit the pairs,
// and the plan of an upload (which rows are added, changed or dropped; held pairs are protected).
import { FIXED_STATUSES } from './schema.js';
import { HOURS_PER_PAIR, inSemester, lessonKey, lessonTypeOf, lessonsOf, partsOf } from './topics.js';
import { joinedLineId, versionsOfLine } from './syllabusLines.js';
import { docLessons } from './syllabusPlan.js';

// The plan semester (1-8, as in the curriculum) -> the semester of the year: odd is autumn (1), even is spring (2).
export const semesterHalf = (planSemester) => (planSemester % 2 === 1 ? 1 : 2);

// The approved syllabus of the line where the subject's teacher leads the discipline in this half of the year; null if there is none.
export function syllabusFor(subject, syllabi, half, members) {
  if (!subject || !subject.disciplineId) return null;
  const key = { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: half };
  if (!Array.isArray(members)) throw new TypeError('syllabusFor: the members of the lines are required');
  return versionsOfLine(syllabi, joinedLineId(members, key)).approved;
}

// -> { syllabi, members, topicsOf: Map(syllabus id -> its rows by order), syllabusOf: Map(topic id -> syllabus row) }
export function syllabusIndex(syllabi, topics, members) {
  const byId = new Map((syllabi || []).map((s) => [s.id, s]));
  const topicsOf = new Map((syllabi || []).map((s) => [s.id, []]));
  const syllabusOf = new Map();
  for (const row of topics || []) {
    if (!byId.has(row.syllabusId)) continue;
    topicsOf.get(row.syllabusId).push(row);
    syllabusOf.set(row.id, byId.get(row.syllabusId));
  }
  for (const rows of topicsOf.values()) rows.sort((a, b) => a.order - b.order);
  return { syllabi: syllabi || [], members, topicsOf, syllabusOf };
}

// Narrows the pairs of ONE subject (one group) to its current semester, for layoutLessons.
export function subjectScope(subject, pairs, index, settings) {
  const syllabus = syllabusFor(subject, index.syllabi, settings.semester, index.members);
  const topics = syllabus ? index.topicsOf.get(syllabus.id) || [] : [];
  const own = new Set(topics.map((t) => t.id));
  const all = pairs || [];
  const fixed = (p) => FIXED_STATUSES.includes(p.status);
  const clear = all
    .filter((p) => !fixed(p) && !inSemester(p.date, settings) && p.topicId && (own.has(p.topicId) || !index.syllabusOf.has(p.topicId) || index.syllabusOf.get(p.topicId).semester === settings.semester))
    .map((p) => p.id);
  const skip = all.filter((p) => {
    if (!fixed(p) || !inSemester(p.date, settings)) return false;
    const other = index.syllabusOf.get(p.topicId);
    return other !== undefined && (!syllabus || other.id !== syllabus.id) && other.semester === settings.semester;
  }).length;
  return { syllabus, topics, pairs: all.filter((p) => inSemester(p.date, settings) || (fixed(p) && lessonKey(p) !== '')), clear, skip };
}

const sum = (rows, field) => rows.reduce((total, r) => total + (Number(r[field]) || 0), 0);

export function syllabusTotals(rows) {
  const all = rows || [];
  const lectureHours = sum(all.filter((r) => r.lessonKind === 'lecture'), 'hours');
  const practiceHours = sum(all.filter((r) => lessonTypeOf(r) === 'practice'), 'hours');
  const controlHours = sum(all.filter((r) => r.lessonKind === 'control'), 'hours');
  return {
    topics: all.filter((r) => r.lessonKind !== 'control').length, units: new Set(all.map((r) => r.unit)).size, lectureHours, practiceHours, controlHours,
    hours: lectureHours + practiceHours + controlHours, selfHours: sum(all, 'selfHours'), pairs: lessonsOf(all).length,
  };
}

// The rows of a syllabus against the pairs of ONE subject.
export function scheduleFit(rows, pairs, settings, skip = 0) {
  const all = pairs || [];
  const inDates = all.filter((p) => inSemester(p.date, settings));
  const placed = new Set(all.map(lessonKey));
  const missing = lessonsOf(rows).filter((l) => !placed.has(lessonKey(l))).length;
  return {
    pairs: inDates.filter((p) => ['planned', 'running', 'closed'].includes(p.status)).length,
    unplaced: Math.max(0, missing - skip),
    withoutTopic: inDates.filter((p) => p.status === 'planned' && !lessonKey(p)).length,
  };
}

// ---- Upload plan ----

const norm = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const text = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ROW_FIELDS = ['unit', 'unitTitle', 'lessonKind', 'name', 'hours', 'selfHours', 'description'];
const NUMERIC = new Set(['unit', 'hours', 'selfHours']);
const same = (field, a, b) => (NUMERIC.has(field) ? num(a) === num(b) : text(a) === text(b));
// The column of the file that gives the hours of a lesson of this kind (the window names it).
const HELD_FIELD = { lecture: 'lectureHours', practice: 'practiceHours', control: 'practiceHours' };
const INFO_FIELDS = ['audience', 'credits', 'course', 'totalHours', 'classHours', 'selfHours'];
const NONE = { syllabus: null, rows: [], held: new Map() };

// part: { syllabus, rows, held } of this half of the year; lessons: docLessons of the file for this half.
function planPart(half, lessons, part, ctx, errors, warnings) {
  const { syllabus } = part;
  const stored = [...part.rows].sort((a, b) => a.order - b.order);
  const planSemester = lessons.planSemester;
  // Another semester of the curriculum in the same half of the year replaces the stored one in every group: the window says so.
  const storedPlan = syllabus ? Number(syllabus.planSemester) || 0 : 0;
  if (storedPlan > 0 && storedPlan !== planSemester) {
    warnings.push({ code: 'semester_replaces', stored: storedPlan, file: planSemester, groups: ctx.groups || [] });
  }
  const held = new Map();                                              // row id -> held pairs by date
  for (const t of stored) {
    const list = [...(part.held.get(t.id) || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slot - b.slot));
    if (list.length) held.set(t.id, list);
  }

  // Lessons of the file by place (1, 2, 3, ... in this half of the year).
  const file = lessons.rows.map((r, i) => ({ ...r, place: i + 1, type: lessonTypeOf(r) }));
  const match = new Map();                                             // file place -> stored row
  const taken = new Set();
  const queues = new Map();
  for (const t of stored) {
    const key = `${lessonTypeOf(t)}|${norm(t.name)}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(t);
  }
  for (const r of file) {
    const next = (queues.get(`${r.type}|${norm(r.name)}`) || []).shift();
    if (next) { match.set(r.place, next); taken.add(next.id); }
  }

  // A stored row with a held pair that found no name: a rename on the same place and of the same kind, or an error.
  const partErrors = [];
  for (const t of stored) {
    if (taken.has(t.id) || !held.has(t.id)) continue;
    const date = held.get(t.id)[0].date;
    const at = file.find((r) => !match.has(r.place) && r.type === lessonTypeOf(t) && r.place === t.order);
    if (at) {
      match.set(at.place, t); taken.add(t.id);
      warnings.push({ code: 'held_renamed', order: t.order, from: t.name, to: at.name, date });
      continue;
    }
    // The name is still in the file, but the lesson of this kind is gone (its hours are empty): the file cuts the held part short.
    const type = lessonTypeOf(t);
    const gone = file.every((r) => r.type !== type || norm(r.name) !== norm(t.name));
    const cut = gone ? ctx.doc.rows.find((r) => semesterHalf(r.semester) === half && r.kind !== 'control' && norm(r.name) === norm(t.name)) : null;
    if (cut) {
      const most = Math.max(...held.get(t.id).filter((p) => p.lessonType === type).map((p) => Number(p.part) || 1), 1);
      partErrors.push({ sheet: 'plan', row: cut.row, field: HELD_FIELD[type], code: 'held_hours', held: most * HOURS_PER_PAIR, date });
    } else partErrors.push({ sheet: 'plan', row: 0, field: 'name', code: 'held_missing', name: t.name, date });
  }

  // A held pair must keep its part.
  for (const r of file) {
    const t = match.get(r.place);
    if (!t || !held.has(t.id)) continue;
    const pairs = held.get(t.id).filter((p) => p.lessonType === r.type);
    if (!pairs.length) continue;
    const most = Math.max(...pairs.map((p) => Number(p.part) || 1));
    if (most > partsOf(r, r.type)) {
      partErrors.push({ sheet: 'plan', row: r.row, field: HELD_FIELD[r.type], code: 'held_hours', held: most * HOURS_PER_PAIR, date: pairs[0].date });
    }
  }
  partErrors.sort((a, b) => a.row - b.row);
  errors.push(...partErrors);

  const toInsert = [];
  const toUpdate = [];
  for (const r of file) {
    const t = match.get(r.place);
    const wanted = {
      order: r.place, unit: r.unit, unitTitle: r.unitTitle ?? '', lessonKind: r.lessonKind, name: r.name, hours: r.hours,
      selfHours: r.selfHours, description: r.description,
    };
    if (!t) {
      toInsert.push({ syllabusId: syllabus ? syllabus.id : null, ...wanted, controlForms: '', sourceId: '' });
      continue;
    }
    const patch = {};
    for (const field of ['order', ...ROW_FIELDS]) if (!same(field, t[field], wanted[field])) patch[field] = wanted[field];
    if (Object.keys(patch).length) toUpdate.push({ id: t.id, patch });
  }
  const toRemove = stored.filter((t) => !taken.has(t.id)).map((t) => t.id);

  const kindOf = new Map(stored.map((t) => [t.id, t.lessonKind]));
  const totals = syllabusTotals(file.map((r) => ({ id: 'r' + r.place, order: r.place, ...r })));
  const info = ctx.doc.info;
  const filled = INFO_FIELDS.filter((f) => info[f] !== undefined && info[f] !== null && info[f] !== '');
  return {
    semester: half, planSemester,
    syllabus: {
      id: syllabus ? syllabus.id : null,
      row: {
        disciplineId: ctx.discipline.id, teacherId: ctx.teacher.id, semester: half, planSemester, updated: ctx.today, manualOrder: true,
        ...Object.fromEntries(filled.map((f) => [f, info[f]])),
      },
    },
    units: lessons.units, toInsert, toUpdate, toRemove,
    summary: {
      semester: half, planSemester, replaces: syllabus !== null, topics: totals.topics, units: totals.units, lectureHours: totals.lectureHours,
      practiceHours: totals.practiceHours, controlHours: totals.controlHours, pairs: totals.pairs,
      added: toInsert.filter((r) => r.lessonKind !== 'control').length,
      changed: toUpdate.filter((u) => kindOf.get(u.id) !== 'control' && Object.keys(u.patch).some((k) => k !== 'order')).length,
      removed: toRemove.filter((id) => kindOf.get(id) !== 'control').length,
    },
  };
}

// doc comes from parseSyllabus. versions: { 1: part, 2: part } — where the file goes in each half of the year; a part is
// { syllabus: the row of the version or null, rows: its plan rows, held: Map(row id -> the held pairs of that row) }.
// groups — the names of the groups the teacher teaches the discipline in (for the remark that a file replaces another semester).
export function planSyllabusUpload(doc, { discipline, teacher, versions = {}, today, groups = [] }) {
  const errors = [];
  const warnings = [];
  const { info } = doc;
  if (norm(info.discipline) && norm(info.discipline) !== norm(discipline.name)) {
    warnings.push({ code: 'discipline_differs', file: info.discipline, discipline: discipline.name });
  }
  const surname = norm(teacher.fullName).split(' ')[0];
  if (norm(info.teacher) && !norm(info.teacher).split(/[\s,;.]+/).includes(surname)) {
    warnings.push({ code: 'teacher_differs', file: info.teacher, teacher: teacher.fullName });
  }

  const ctx = { doc, discipline, teacher, today, groups };
  const parts = docLessons(doc).map((lessons) => planPart(lessons.semester, lessons, versions[lessons.semester] ?? NONE, ctx, errors, warnings));
  // All or nothing: one error anywhere empties every part.
  if (errors.length) {
    for (const p of parts) Object.assign(p, { toInsert: [], toUpdate: [], toRemove: [] }, { summary: { ...p.summary, added: 0, changed: 0, removed: 0 } });
  }
  return { errors, warnings, parts };
}

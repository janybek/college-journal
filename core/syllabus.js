// Syllabi: the semester of the year, whose syllabus a subject follows, totals, how the lessons fit the pairs,
// and the plan of an upload (which rows are added, changed or dropped; held pairs are protected).
import { FIXED_STATUSES } from './schema.js';
import { HOURS_PER_PAIR, inSemester, lessonKey, lessonsOf, partsOf } from './topics.js';

// The plan semester (1-8, as in the curriculum) -> the semester of the year: odd is autumn (1), even is spring (2).
export const semesterHalf = (planSemester) => (planSemester % 2 === 1 ? 1 : 2);

// The syllabus row of the subject's discipline and teacher for this semester of the year; null if there is none.
export function syllabusFor(subject, syllabi, half) {
  if (!subject || !subject.disciplineId) return null;
  return (syllabi || []).find((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId && s.semester === half) || null;
}

// -> { syllabi, topicsOf: Map(syllabus id -> its rows by order), syllabusOf: Map(topic id -> syllabus row) }
export function syllabusIndex(syllabi, topics) {
  const byId = new Map((syllabi || []).map((s) => [s.id, s]));
  const topicsOf = new Map((syllabi || []).map((s) => [s.id, []]));
  const syllabusOf = new Map();
  for (const row of topics || []) {
    if (!byId.has(row.syllabusId)) continue;
    topicsOf.get(row.syllabusId).push(row);
    syllabusOf.set(row.id, byId.get(row.syllabusId));
  }
  for (const rows of topicsOf.values()) rows.sort((a, b) => a.order - b.order);
  return { syllabi: syllabi || [], topicsOf, syllabusOf };
}

// Narrows the pairs of ONE subject (one group) to its current semester, for layoutLessons.
export function subjectScope(subject, pairs, index, settings) {
  const syllabus = syllabusFor(subject, index.syllabi, settings.semester);
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
  return { syllabus, topics, pairs: all.filter((p) => fixed(p) || inSemester(p.date, settings)), clear, skip };
}

const sum = (rows, field) => rows.reduce((total, r) => total + (Number(r[field]) || 0), 0);

export function syllabusTotals(rows) {
  const all = rows || [];
  const topics = all.filter((r) => r.kind !== 'control');
  const controls = all.filter((r) => r.kind === 'control');
  const lectureHours = sum(topics, 'lectureHours');
  const practiceHours = sum(topics, 'practiceHours');
  const controlHours = sum(controls, 'practiceHours');
  return {
    topics: topics.length, units: new Set(all.map((r) => r.unit)).size, lectureHours, practiceHours, controlHours,
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
const ROW_FIELDS = ['unit', 'unitTitle', 'label', 'name', 'lectureHours', 'practiceHours', 'practiceKind', 'selfHours', 'description'];
const NUMERIC = new Set(['unit', 'lectureHours', 'practiceHours', 'selfHours']);
const same = (field, a, b) => (NUMERIC.has(field) ? num(a) === num(b) : text(a) === text(b));
const HELD_FIELD = { lecture: 'lectureHours', practice: 'practiceHours', control: 'practiceHours' };

function planPart(half, fileRows, ctx, errors, warnings) {
  const { today } = ctx;
  const syllabus = (ctx.syllabi || []).find((s) => s.semester === half && s.disciplineId === ctx.discipline.id && s.teacherId === ctx.teacher.id) || null;
  const stored = syllabus ? (ctx.topics || []).filter((t) => t.syllabusId === syllabus.id).sort((a, b) => a.order - b.order) : [];
  const planSemester = fileRows[0].semester;
  // Another semester of the curriculum in the same half of the year replaces the stored one in every group: the window says so.
  const storedPlan = syllabus ? Number(syllabus.planSemester) || 0 : 0;
  if (storedPlan > 0 && storedPlan !== planSemester) {
    warnings.push({ code: 'semester_replaces', stored: storedPlan, file: planSemester, groups: ctx.groups || [] });
  }
  const storedIds = new Set(stored.map((t) => t.id));
  const held = new Map();                                              // topic id -> held pairs by date
  for (const p of ctx.pairs || []) {
    if (!storedIds.has(p.topicId) || !FIXED_STATUSES.includes(p.status)) continue;
    if (!held.has(p.topicId)) held.set(p.topicId, []);
    held.get(p.topicId).push(p);
  }
  for (const list of held.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slot - b.slot));

  // Rows of the file by place (1, 2, 3, ... in this semester).
  const file = fileRows.map((r, i) => ({ ...r, place: i + 1 }));
  const match = new Map();                                             // file place -> stored row
  const taken = new Set();
  const queues = new Map();
  for (const t of stored) {
    const key = `${t.kind}|${norm(t.name)}`;
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(t);
  }
  for (const r of file) {
    const next = (queues.get(`${r.kind}|${norm(r.name)}`) || []).shift();
    if (next) { match.set(r.place, next); taken.add(next.id); }
  }

  // A stored row with a held pair that found no name: a rename on the same place, or an error.
  const partErrors = [];
  for (const t of stored) {
    if (taken.has(t.id) || !held.has(t.id)) continue;
    const date = held.get(t.id)[0].date;
    const at = file.find((r) => !match.has(r.place) && r.kind === t.kind && r.place === t.order);
    if (at) {
      match.set(at.place, t); taken.add(t.id);
      warnings.push({ code: 'held_renamed', order: t.order, from: t.name, to: at.name, date });
    } else partErrors.push({ sheet: 'plan', row: 0, field: 'name', code: 'held_missing', name: t.name, date });
  }

  // A held pair must keep its part.
  for (const r of file) {
    const t = match.get(r.place);
    if (!t || !held.has(t.id)) continue;
    for (const lessonType of ['lecture', 'practice', 'control']) {
      const pairs = held.get(t.id).filter((p) => p.lessonType === lessonType);
      if (!pairs.length) continue;
      const most = Math.max(...pairs.map((p) => Number(p.part) || 1));
      if (most > partsOf(r, lessonType)) {
        partErrors.push({ sheet: 'plan', row: r.row, field: HELD_FIELD[lessonType], code: 'held_hours', held: most * HOURS_PER_PAIR, date: pairs[0].date });
      }
    }
  }
  partErrors.sort((a, b) => a.row - b.row);
  errors.push(...partErrors);

  const toInsert = [];
  const toUpdate = [];
  let toRemove = [];
  for (const r of file) {
    const t = match.get(r.place);
    const wanted = { order: r.place, unit: r.unit, unitTitle: r.unitTitle ?? '', label: r.label, name: r.name, lectureHours: r.lectureHours, practiceHours: r.practiceHours, practiceKind: r.practiceKind, selfHours: r.selfHours, description: r.description };
    if (!t) {
      toInsert.push({ syllabusId: syllabus ? syllabus.id : null, ...wanted, kind: r.kind });
      continue;
    }
    const patch = {};
    for (const field of ['order', ...ROW_FIELDS]) if (!same(field, t[field], wanted[field])) patch[field] = wanted[field];
    if (Object.keys(patch).length) toUpdate.push({ id: t.id, patch });
  }
  toRemove = stored.filter((t) => !taken.has(t.id)).map((t) => t.id);

  const kindOf = new Map(stored.map((t) => [t.id, t.kind]));
  const totals = syllabusTotals(file.map((r) => ({ id: 'r' + r.place, order: r.place, ...r })));
  const info = ctx.doc.info;
  return {
    semester: half, planSemester,
    syllabus: {
      id: syllabus ? syllabus.id : null,
      row: { disciplineId: ctx.discipline.id, teacherId: ctx.teacher.id, semester: half, planSemester, audience: info.audience, credits: info.credits,
        totalHours: info.totalHours, classHours: info.classHours, selfHours: info.selfHours, updated: today },
    },
    toInsert, toUpdate, toRemove,
    summary: {
      semester: half, planSemester, replaces: syllabus !== null, topics: totals.topics, units: totals.units, lectureHours: totals.lectureHours,
      practiceHours: totals.practiceHours, controlHours: totals.controlHours, pairs: totals.pairs,
      added: toInsert.filter((r) => r.kind === 'topic').length,
      changed: toUpdate.filter((u) => kindOf.get(u.id) === 'topic' && Object.keys(u.patch).some((k) => k !== 'order')).length,
      removed: toRemove.filter((id) => kindOf.get(id) === 'topic').length,
    },
  };
}

// doc comes from parseSyllabus. syllabi and topics are those of this discipline and teacher; pairs — of any group;
// groups — the names of the groups the teacher teaches the discipline in (for the remark that a file replaces another semester).
export function planSyllabusUpload(doc, { discipline, teacher, syllabi, topics, pairs, today, groups = [] }) {
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

  const byHalf = new Map();
  for (const r of doc.rows) {
    const half = semesterHalf(r.semester);
    if (!byHalf.has(half)) byHalf.set(half, []);
    byHalf.get(half).push(r);
  }
  const ctx = { doc, discipline, teacher, syllabi, topics, pairs, today, groups };
  const parts = [...byHalf.keys()].sort((a, b) => a - b).map((half) => planPart(half, byHalf.get(half), ctx, errors, warnings));
  // All or nothing: one error anywhere empties every part.
  if (errors.length) {
    for (const p of parts) Object.assign(p, { toInsert: [], toUpdate: [], toRemove: [] }, { summary: { ...p.summary, added: 0, changed: 0, removed: 0 } });
  }
  return { errors, warnings, parts };
}

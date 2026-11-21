// A file of the syllabus template fills the open version (the draft) of each half of the year it names. The version is made when there is none.
// Sheets are read once per request and written in batches. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { FIXED_STATUSES } from '../core/schema.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { planSyllabusUpload } from '../core/syllabus.js';
import { plainId } from '../core/syllabusSections.js';
import { DOC_TABLES } from '../core/syllabusDoc.js';
import { copiesOf, versionsOf } from '../core/syllabusFlow.js';
import { todayOf } from './scheduleData.js';
import { createDraft, draftForm, saveSection } from './syllabusDraft.js';
import { approveSyllabus } from './syllabusFlow.js';

const MAX_SHEETS = 10;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUnit = (u) => Number.isInteger(u) && u >= 1;
const blank = (v) => v === undefined || v === null || v === '';
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');

// A cell is text, a finite number, a boolean or empty: an object or an array would be stored as «[object Object]» or «a,b».
const isCell = (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// The request carries the subject (a plain id) and 1-10 sheets of cells.
function checkRequest(data) {
  const { subjectId, sheets } = isObject(data) ? data : {};
  if (plainId(subjectId) === null) throw new AppError('bad_request');
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > MAX_SHEETS) throw new AppError('bad_request');
  for (const sheet of sheets) {
    if (!isObject(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.cells) || sheet.cells.some((row) => !Array.isArray(row) || !row.every(isCell))) {
      throw new AppError('bad_request');
    }
  }
  return { subjectId, sheets };
}

// Held pairs by the id of the row they stand on.
function heldOn(pairs, ids) {
  const held = new Map();
  for (const p of pairs) {
    if (!ids.has(p.topicId) || !FIXED_STATUSES.includes(p.status)) continue;
    if (!held.has(p.topicId)) held.set(p.topicId, []);
    held.get(p.topicId).push(p);
  }
  return held;
}

// Where the file goes in one half of the year: { syllabus, rows, held } for planSyllabusUpload.
//   an open version: its rows; the held pairs stand on the rows of the approved version, so they are carried to the copies of those rows;
//   only an approved version: its rows (this is how the copy will look), the held pairs stand on them;
//   none: nothing.
function partOf(open, approved, tables, pairs) {
  const rowsOf = (v) => tables.topics.filter((t) => t.syllabusId === v.id);
  if (open) {
    const rows = rowsOf(open);
    const held = new Map();
    if (approved) {
      const old = rowsOf(approved);
      const onApproved = heldOn(pairs, new Set(old.map((t) => t.id)));
      for (const [oldId, copy] of copiesOf(rows, old)) if (onApproved.has(oldId)) held.set(copy.id, onApproved.get(oldId));
    }
    return { syllabus: open, rows, held };
  }
  if (approved) {
    const rows = rowsOf(approved);
    return { syllabus: approved, rows, held: heldOn(pairs, new Set(rows.map((t) => t.id))) };
  }
  return { syllabus: null, rows: [], held: new Map() };
}

// The units a file with `count` units takes out of a version: the rows of units above `count` and the books of those units.
function goneOf(unitRows, books, count) {
  const units = unitRows.filter((u) => !(isUnit(u.unit) && u.unit <= count));
  const bookIds = books.filter((b) => isUnit(b.unit) && b.unit > count).map((b) => b.id);
  const lost = new Set();
  for (const u of units) {
    if (['description', 'questions', 'guidance', 'results'].some((f) => !blank(u[f]))) lost.add(u.unit);
  }
  for (const b of books) if (isUnit(b.unit) && b.unit > count) lost.add(b.unit);
  return { unitIds: units.map((u) => u.id), bookIds, lost: lost.size };
}

// The unit rows a file changes in a version: every unit 1…count has a row with the title of the file (a missing one is made), the rest of its row is not touched. -> { insert, update }
function unitWrites(units, unitRows, syllabusId) {
  const insert = [];
  const update = [];
  for (const { unit, title } of units) {
    const old = unitRows.find((u) => u.unit === unit);
    if (old) {
      if ((old.title ?? '') !== title) update.push({ id: old.id, patch: { title } });
    } else {
      insert.push({ syllabusId, unit, title, description: '', questions: '', guidance: '', results: '' });
    }
  }
  return { insert, update };
}

// Everything about a file for a subject: the plan against the versions there are now. `tables`: syllabi, topics, units, literature, pairs.
function planFile(doc, subject, ctx) {
  const { staff, groups, tables, platform } = ctx;
  const teacher = staff.find((s) => s.id === subject.teacherId);
  const discipline = { id: subject.disciplineId, name: subject.name };
  const owner = { id: subject.teacherId, fullName: teacher ? teacher.fullName : '' };
  const keyOf = (semester) => ({ disciplineId: discipline.id, teacherId: owner.id, semester });
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const names = ctx.subjects.filter((s) => s.disciplineId === discipline.id && s.teacherId === owner.id)
    .map((s) => groupName.get(s.groupId) ?? '').filter((name) => name !== '').sort();
  const found = {};
  const versions = {};
  for (const half of [1, 2]) {
    const { approved, open } = versionsOf(tables.syllabi, keyOf(half));
    found[half] = { approved, open };
    versions[half] = partOf(open, approved, tables, tables.pairs);
  }
  const plan = planSyllabusUpload(doc, { discipline, teacher: owner, versions, today: todayOf(platform), groups: names });
  return { plan, found, keyOf };
}

// 'syllabus.preview' / 'syllabus.apply'. -> { ok, applied, found, summaries, errors, warnings, drafts }
export function uploadSyllabus(store, platform, data, user, write) {
  const { subjectId, sheets: cells } = checkRequest(data);
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  if (!(isManager(user) || (user.roles.includes('teacher') && subject.teacherId === user.id))) throw new AppError('forbidden');
  if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
    throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  }

  const parsed = parseSyllabus(cells);
  if (parsed.doc === null) return { ok: false, applied: false, found: parsed.found, summaries: [], errors: parsed.errors, warnings: parsed.warnings, drafts: [] };

  const staff = store.list('staff');
  const groups = store.list('groups');
  const tables = { syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs'), units: store.list('units'), literature: store.list('literature') };
  const ctx = { staff, groups, subjects, tables, platform };
  const { plan, found, keyOf } = planFile(parsed.doc, subject, ctx);

  // a version under review is not touched: the file is refused as a whole
  const busy = plan.parts.filter((p) => found[p.semester].open && found[p.semester].open.status === 'review')
    .map((p) => ({ sheet: 'info', row: 0, field: 'semester', code: 'in_review', semester: p.semester }));
  if (busy.length > 0) {
    return { ok: false, applied: false, found: parsed.found, summaries: [], errors: [...parsed.errors, ...busy], warnings: parsed.warnings, drafts: [] };
  }

  const removed = plan.parts.map((p) => {
    const { open, approved } = found[p.semester];
    const source = open || approved;
    if (!source) return 0;
    return goneOf(tables.units.filter((u) => u.syllabusId === source.id), tables.literature.filter((b) => b.syllabusId === source.id), p.units.length).lost;
  });
  const remarks = plan.parts.flatMap((p, i) => (removed[i] > 0 ? [{ code: 'units_removed', semester: p.semester, count: removed[i] }] : []));

  const errors = [...parsed.errors, ...plan.errors];
  const warnings = [...parsed.warnings, ...plan.warnings, ...remarks];
  const ok = errors.length === 0;
  const result = { ok, applied: false, found: parsed.found, summaries: plan.parts.map((p) => p.summary), errors, warnings, drafts: [] };
  if (write !== true || !ok) return result;

  const drafts = writeDrafts(store, platform, { subject, user, doc: parsed.doc, found, keyOf, ctx, planned: plan });
  if (drafts.errors) return { ...result, ok: false, errors: drafts.errors, summaries: drafts.summaries };
  return { ...result, applied: true, drafts: drafts.list };
}

// Makes the missing versions, plans the file again against their rows and writes it. -> { list, errors?, summaries? }
function writeDrafts(store, platform, { subject, user, doc, found, keyOf, ctx, planned }) {
  const { tables } = ctx;
  const today = todayOf(platform);
  const made = {};                                                       // half -> { version, units (rows), books (rows) }
  let others = null;                                                     // the sheets only a copy of an approved version needs
  for (const part of planned.parts) {
    const half = part.semester;
    const { open, approved } = found[half];
    if (open) {
      made[half] = { version: open, units: tables.units.filter((u) => u.syllabusId === open.id), books: tables.literature.filter((b) => b.syllabusId === open.id) };
      continue;
    }
    let copy;
    if (approved) {
      if (others === null) {
        others = {};
        for (const name of DOC_TABLES) if (!tables[name]) others[name] = store.list(name);
      }
      copy = createDraft(store, platform, { key: keyOf(half), approved, group: null, userId: user.id }, { ...tables, ...others });
      made[half] = { version: copy.version, units: copy.rows.units, books: copy.rows.literature };
    } else {
      const group = ctx.groups.find((g) => g.id === subject.groupId) || null;
      copy = createDraft(store, platform, { key: keyOf(half), approved: null, group, userId: user.id }, { syllabi: tables.syllabi });
      made[half] = { version: copy.version, units: [], books: [] };
    }
    tables.syllabi = [...tables.syllabi, copy.version];
    if (approved) tables.topics = [...tables.topics, ...copy.rows.topics];
  }

  // the file again, now against the rows of the versions it will fill (for a copy: the rows of the copy)
  const again = planFile(doc, subject, { ...ctx, tables }).plan;
  if (again.errors.length > 0) return { errors: again.errors, summaries: again.parts.map((p) => p.summary) };

  const syllabi = again.parts.map((p) => ({ id: made[p.semester].version.id, patch: { ...p.syllabus.row, editedBy: user.id, updated: today } }));
  store.updateMany('syllabi', syllabi);

  const removeTopics = new Set();
  const updateTopics = [];
  const insertTopics = [];
  const units = { insert: [], update: [], remove: [] };
  const books = [];
  for (const p of again.parts) {
    const { version, units: unitRows, books: bookRows } = made[p.semester];
    for (const id of p.toRemove) removeTopics.add(id);
    updateTopics.push(...p.toUpdate);
    insertTopics.push(...p.toInsert.map((row) => ({ ...row, syllabusId: version.id })));
    const w = unitWrites(p.units, unitRows, version.id);
    units.insert.push(...w.insert);
    units.update.push(...w.update);
    const gone = goneOf(unitRows, bookRows, p.units.length);
    units.remove.push(...gone.unitIds);
    books.push(...gone.bookIds);
  }
  if (removeTopics.size > 0) store.removeMany('topics', [...removeTopics]);
  if (updateTopics.length > 0) store.updateMany('topics', updateTopics);
  if (insertTopics.length > 0) store.insertMany('topics', insertTopics);
  if (units.remove.length > 0) store.removeMany('units', units.remove);
  if (units.update.length > 0) store.updateMany('units', units.update);
  if (units.insert.length > 0) store.insertMany('units', units.insert);
  if (books.length > 0) store.removeMany('literature', books);
  return { list: again.parts.map((p) => ({ semester: p.semester, syllabusId: made[p.semester].version.id })) };
}

// For the dev stand: a ready document -> the draft (as syllabus.apply does) -> the title and the goal written -> the approved version
// (as syllabus.approve does). `user` is a manager (a dean or the administrator). Throws an Error with the list when a file or a check fails.
export function publishSyllabusDoc(store, platform, subjectId, doc, user, title = {}, goal = '') {
  const subject = store.list('subjects').find((s) => s.id === subjectId);
  if (!subject || !subject.disciplineId) throw new Error(`publishSyllabusDoc: no subject with a discipline: ${subjectId}`);
  const staff = store.list('staff');
  const groups = store.list('groups');
  const tables = { syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs'), units: store.list('units'), literature: store.list('literature') };
  const ctx = { staff, groups, subjects: store.list('subjects'), tables, platform };
  const first = planFile(doc, subject, ctx);
  if (first.plan.errors.length > 0) throw new Error('publishSyllabusDoc: ' + JSON.stringify(first.plan.errors));
  const written = writeDrafts(store, platform, { subject, user, doc, found: first.found, keyOf: first.keyOf, ctx, planned: first.plan });
  if (written.errors) throw new Error('publishSyllabusDoc: ' + JSON.stringify(written.errors));
  for (const { syllabusId } of written.list) {
    const form = draftForm(store, platform, { syllabusId }, user).doc;
    saveSection(store, platform, { syllabusId, section: 'title', data: { ...form.title, ...title } }, user);
    saveSection(store, platform, { syllabusId, section: 'goals', data: { ...form.goals, goal: goal || form.goals.goal } }, user);
    const done = approveSyllabus(store, platform, { syllabusId }, user);
    if (!done.approved) throw new Error('publishSyllabusDoc: ' + JSON.stringify(done.checks.errors));
  }
}

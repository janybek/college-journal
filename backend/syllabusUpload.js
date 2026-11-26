// A file of the syllabus template fills the open version (the draft) of each half of the year it names. The version is made when there is none.
// Sheets are read once per request and written in batches. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { FIXED_STATUSES } from '../core/schema.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { planSyllabusUpload } from '../core/syllabus.js';
import { plainId } from '../core/syllabusSections.js';
import { DOC_TABLES } from '../core/syllabusDoc.js';
import { copiesOf } from '../core/syllabusFlow.js';
import { draftTarget, lineFor, lineSubjects, reviewRows, versionsOfLine } from '../core/disciplineSyllabus.js';
import { todayOf } from './scheduleData.js';
import { draftForm, firstGroup, openDrafts, saveSection } from './syllabusDraft.js';
import { approveSyllabus } from './syllabusFlow.js';
import { openLine } from './syllabusLines.js';

const MAX_SHEETS = 10;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUnit = (u) => Number.isInteger(u) && u >= 1;
const blank = (v) => v === undefined || v === null || v === '';
const isManager = (user) => user.roles.includes('admin') || user.roles.includes('dean');

// A cell is text, a finite number, a boolean or empty: an object or an array would be stored as «[object Object]» or «a,b».
const isCell = (v) => v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

// The request carries the subject or the discipline (exactly one of them, a plain id) and 1-10 sheets of cells.
function checkRequest(data) {
  const { subjectId, disciplineId, sheets } = isObject(data) ? data : {};
  if ((subjectId === undefined) === (disciplineId === undefined) || plainId(subjectId === undefined ? disciplineId : subjectId) === null) {
    throw new AppError('bad_request');
  }
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > MAX_SHEETS) throw new AppError('bad_request');
  for (const sheet of sheets) {
    if (!isObject(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.cells) || sheet.cells.some((row) => !Array.isArray(row) || !row.every(isCell))) {
      throw new AppError('bad_request');
    }
  }
  return { subjectId: subjectId ?? null, disciplineId: disciplineId ?? null, sheets };
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

// Everything about a file for a subject: the plan against the versions there are now, on the line the subject follows in each half of the year.
// `tables`: syllabi, topics, pairs, units, literature; `lines`: the rows of «Силлабусы дисциплин» (those the request has just made too).
// The teacher of the file is the owner of an old «own» syllabus when the subject follows one; the syllabus of the discipline has no single teacher.
function planFile(doc, subject, ctx) {
  const { staff, groups, tables, platform, lines } = ctx;
  const discipline = { id: subject.disciplineId, name: subject.name };
  const keyOf = (semester) => ({ disciplineId: discipline.id, teacherId: subject.teacherId, semester });
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const found = {};
  const versions = {};
  const taught = new Map();
  let ownerId = '';
  for (const half of [1, 2]) {
    const lineId = lineFor(lines, keyOf(half));
    const line = lineId === null ? null : lines.find((l) => l.id === lineId) || null;
    const { approved, open } = versionsOfLine(tables.syllabi, lineId, half);
    found[half] = { approved, open };
    versions[half] = partOf(open, approved, tables, tables.pairs);
    if (line && line.kind === 'own' && ownerId === '') ownerId = line.teacherId;
    const followers = line ? lineSubjects(ctx.subjects, line, lines, half) : ctx.subjects.filter((x) => x.disciplineId === discipline.id);
    for (const x of followers) taught.set(x.id, x);
  }
  const person = staff.find((x) => x.id === ownerId);
  const owner = { id: ownerId, fullName: person ? person.fullName : '' };
  const names = [...new Set([...taught.values()].map((x) => groupName.get(x.groupId) ?? '').filter((name) => name !== ''))].sort();
  const plan = planSyllabusUpload(doc, { discipline, teacher: owner, versions, today: todayOf(platform), groups: names });
  return { plan, found, keyOf };
}

// 'syllabus.preview' / 'syllabus.apply'. -> { ok, applied, found, summaries, errors, warnings, drafts }
export function uploadSyllabus(store, platform, data, user, write) {
  const { subjectId, disciplineId, sheets: cells } = checkRequest(data);
  const byDiscipline = subjectId === null;
  const subjects = store.list('subjects');
  let subject;
  if (byDiscipline) {
    // a file by the discipline has no subject: the teacher of the version is the responsible, the group of an empty draft the first one of the discipline
    if (!(isManager(user) || user.roles.includes('teacher'))) throw new AppError('forbidden');
    const discipline = store.list('disciplines').find((d) => d.id === disciplineId);
    if (!discipline) throw new AppError('not_found');
    subject = { id: '', name: discipline.name, disciplineId, groupId: '', teacherId: '' };
  } else {
    subject = subjects.find((s) => s.id === subjectId);
    if (!subject) throw new AppError('not_found');
    if (!(isManager(user) || user.roles.includes('teacher'))) throw new AppError('forbidden');
    if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
      throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
    }
  }
  // the right is the one of a new draft of each half the file names (draftTarget); a person who may start none gets no word about the file
  const syllabi = store.list('syllabi');
  const lines = store.list('syllabusLines');
  const target = (half) => draftTarget(lines, syllabi, subjects, { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: half }, user);
  if (![1, 2].some((half) => target(half).code === 'ok')) throw new AppError(target(1).code);

  const parsed = parseSyllabus(cells);
  if (parsed.doc === null) return { ok: false, applied: false, found: parsed.found, summaries: [], errors: parsed.errors, warnings: parsed.warnings, drafts: [] };

  const staff = store.list('staff');
  const groups = store.list('groups');
  const tables = { syllabi, topics: store.list('topics'), pairs: store.list('pairs'), units: store.list('units'), literature: store.list('literature') };
  const ctx = { staff, groups, subjects, tables, platform, lines };
  const { plan, found, keyOf } = planFile(parsed.doc, subject, ctx);
  // by the discipline a half that waits for the choice (no line of its own to take the file) is a mistake of the file; any other refusal is a refusal of the request
  const waiting = [];
  for (const part of plan.parts) {
    const { code } = target(part.semester);
    if (code === 'choose_first' && byDiscipline) waiting.push({ sheet: 'info', row: 0, field: 'semester', code: 'choose_first', semester: part.semester });
    else if (code !== 'ok') throw new AppError(code);
  }
  if (waiting.length > 0) {
    return { ok: false, applied: false, found: parsed.found, summaries: [], errors: [...parsed.errors, ...waiting], warnings: parsed.warnings, drafts: [] };
  }

  // a line with a version under review is not touched in any half: the file is refused as a whole
  const busy = plan.parts.filter((p) => {
    const lineId = lineFor(lines, keyOf(p.semester));
    return lineId !== null && reviewRows(syllabi, lineId).length > 0;
  }).map((p) => ({ sheet: 'info', row: 0, field: 'semester', code: 'in_review', semester: p.semester }));
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
  const missing = [];                                                    // the halves of the file that have no open version yet
  for (const part of planned.parts) {
    const { open } = found[part.semester];
    if (open) made[part.semester] = { version: open, units: tables.units.filter((u) => u.syllabusId === open.id), books: tables.literature.filter((b) => b.syllabusId === open.id) };
    else missing.push(part.semester);
  }
  // the line of each missing half (made when there is none), then the new versions of every line at once (openDrafts: a new version covers both halves)
  const byLine = new Map();
  const rows = { syllabusLines: ctx.lines, syllabi: tables.syllabi, subjects: ctx.subjects };
  for (const half of missing) {
    const line = openLine(store, platform, keyOf(half), user, rows);
    if (!byLine.has(line.id)) byLine.set(line.id, { line, halves: [] });
    byLine.get(line.id).halves.push(half);
  }
  ctx.lines = rows.syllabusLines;                                        // a line made now is a part of the lines for the next look at the file
  let others = null;                                                     // the sheets only a copy of an approved version needs
  for (const { line, halves } of byLine.values()) {
    if (others === null && [1, 2].some((h) => versionsOfLine(tables.syllabi, line.id, h).approved)) {
      others = {};
      for (const name of DOC_TABLES) if (!tables[name]) others[name] = store.list(name);
    }
    const group = subject.id !== '' ? ctx.groups.find((g) => g.id === subject.groupId) || null : firstGroup(ctx.groups, ctx.subjects, subject.disciplineId);
    const opened = openDrafts(store, platform, { line, halves, group, user, subjects: ctx.subjects, pairs: tables.pairs }, { ...tables, ...others });
    for (const [half, version] of opened) {
      const copied = opened.rows.get(half) || {};
      if (halves.includes(half)) made[half] = { version, units: copied.units || [], books: copied.literature || [] };
      if (!opened.created.has(half)) continue;
      tables.syllabi = [...tables.syllabi, version];
      if (copied.topics) tables.topics = [...tables.topics, ...copied.topics];
    }
  }

  // the file again, now against the rows of the versions it will fill (for a copy: the rows of the copy)
  const again = planFile(doc, subject, { ...ctx, tables }).plan;
  if (again.errors.length > 0) return { errors: again.errors, summaries: again.parts.map((p) => p.summary) };

  // the teacher of a version stays what the draft made it: the file does not name the author
  const syllabi = again.parts.map((p) => {
    const { teacherId, ...row } = p.syllabus.row;
    return { id: made[p.semester].version.id, patch: { ...row, editedBy: user.id, updated: today } };
  });
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
  const ctx = { staff, groups, subjects: store.list('subjects'), tables, platform, lines: store.list('syllabusLines') };
  const first = planFile(doc, subject, ctx);
  if (first.plan.errors.length > 0) throw new Error('publishSyllabusDoc: ' + JSON.stringify(first.plan.errors));
  const written = writeDrafts(store, platform, { subject, user, doc, found: first.found, keyOf: first.keyOf, ctx, planned: first.plan });
  if (written.errors) throw new Error('publishSyllabusDoc: ' + JSON.stringify(written.errors));
  for (const { syllabusId } of written.list) {
    const form = draftForm(store, platform, { syllabusId }, user).doc;
    saveSection(store, platform, { syllabusId, section: 'title', data: { ...form.title, ...title } }, user);
    saveSection(store, platform, { syllabusId, section: 'goals', data: { ...form.goals, goal: goal || form.goals.goal } }, user);
  }
  // one approval for the first half approves every started half of the line; the others are only checked
  const [firstHalf, ...rest] = written.list;
  const done = approveSyllabus(store, platform, { syllabusId: firstHalf.syllabusId }, user);
  if (!done.approved) throw new Error('publishSyllabusDoc: ' + JSON.stringify(done.checks.errors));
  const status = new Map(store.list('syllabi').map((s) => [s.id, s.status]));
  for (const { syllabusId } of rest) if (status.get(syllabusId) !== 'approved') throw new Error('publishSyllabusDoc: a half is not approved: ' + syllabusId);
}

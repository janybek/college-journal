// Uploading the syllabus of «discipline + teacher»: read the sheets once, plan, write in batches, lay the lessons over every group.
// No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate } from '../core/dates.js';
import { parseSyllabus } from '../core/syllabusFile.js';
import { planSyllabusUpload } from '../core/syllabus.js';
import { loadSettings, relayout } from './scheduleData.js';

const MAX_SHEETS = 10;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The request carries the subject (a plain non-empty string, not trimmed) and 1-10 sheets of cells.
function checkRequest(data) {
  const { subjectId, sheets } = isObject(data) ? data : {};
  if (typeof subjectId !== 'string' || subjectId === '') throw new AppError('bad_request');
  if (!Array.isArray(sheets) || sheets.length < 1 || sheets.length > MAX_SHEETS) throw new AppError('bad_request');
  for (const sheet of sheets) {
    if (!isObject(sheet) || typeof sheet.name !== 'string' || !Array.isArray(sheet.cells) || sheet.cells.some((row) => !Array.isArray(row))) {
      throw new AppError('bad_request');
    }
  }
  return { subjectId, sheets };
}

// The syllabus belongs to the discipline of the subject and its teacher.
function ownerOf(staff, subject) {
  const teacher = staff.find((s) => s.id === subject.teacherId);
  return { discipline: { id: subject.disciplineId, name: subject.name }, teacher: { id: subject.teacherId, fullName: teacher ? teacher.fullName : '' } };
}

function planFor(doc, sheets, owner, platform) {
  const { discipline, teacher } = owner;
  const syllabi = sheets.syllabi.filter((s) => s.disciplineId === discipline.id && s.teacherId === teacher.id);
  const own = new Set(syllabi.map((s) => s.id));
  const topics = sheets.topics.filter((t) => own.has(t.syllabusId));
  return planSyllabusUpload(doc, { discipline, teacher, syllabi, topics, pairs: sheets.pairs, today: localDate(platform.now()) });
}

// Writes a plan that has no errors: syllabus rows, then topic rows (removed, changed, new), then the lessons of every group of the teacher.
// Sheets are kept as they are after the write, so the layout reads nothing again.
function writePlan(store, platform, plan, sheets, subject) {
  const settings = loadSettings(store);
  const fresh = plan.parts.filter((p) => p.syllabus.id === null);
  const known = plan.parts.filter((p) => p.syllabus.id !== null);

  const created = fresh.length > 0 ? store.insertMany('syllabi', fresh.map((p) => p.syllabus.row)) : [];
  const changed = known.length > 0 ? store.updateMany('syllabi', known.map((p) => ({ id: p.syllabus.id, patch: p.syllabus.row }))) : [];
  const idOfHalf = new Map([...fresh.map((p, i) => [p.semester, created[i].id]), ...known.map((p) => [p.semester, p.syllabus.id])]);
  const syllabi = [...sheets.syllabi.map((s) => changed.find((c) => c.id === s.id) ?? s), ...created];

  const removed = new Set(plan.parts.flatMap((p) => p.toRemove));
  const updates = plan.parts.flatMap((p) => p.toUpdate);
  const inserts = plan.parts.flatMap((p) => p.toInsert.map((row) => ({ ...row, syllabusId: idOfHalf.get(p.semester) })));
  if (removed.size > 0) store.removeMany('topics', [...removed]);
  const updated = updates.length > 0 ? store.updateMany('topics', updates) : [];
  const added = inserts.length > 0 ? store.insertMany('topics', inserts) : [];
  const byId = new Map(updated.map((t) => [t.id, t]));
  const topics = [...sheets.topics.filter((t) => !removed.has(t.id)).map((t) => byId.get(t.id) ?? t), ...added];

  const ids = sheets.subjects.filter((s) => s.disciplineId === subject.disciplineId && s.teacherId === subject.teacherId).map((s) => s.id);
  relayout(store, ids, { subjects: sheets.subjects, syllabi, topics, pairs: sheets.pairs, settings });
}

// -> { ok, applied, found, summaries, errors, warnings }. `write`: save the file (when it has no errors), otherwise only check it.
export function uploadSyllabus(store, platform, data, write) {
  const { subjectId, sheets: cells } = checkRequest(data);
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) throw new AppError('not_found');
  if (typeof subject.disciplineId !== 'string' || subject.disciplineId === '') {
    throw new AppError('invalid', { fields: [{ field: 'disciplineId', code: 'bad_ref' }] });
  }

  const parsed = parseSyllabus(cells);
  if (parsed.doc === null) return { ok: false, applied: false, found: parsed.found, summaries: [], errors: parsed.errors, warnings: parsed.warnings };

  const sheets = { subjects, staff: store.list('staff'), syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs') };
  const plan = planFor(parsed.doc, sheets, ownerOf(sheets.staff, subject), platform);
  const errors = [...parsed.errors, ...plan.errors];
  const ok = errors.length === 0;
  const applied = write === true && ok;
  if (applied) writePlan(store, platform, plan, sheets, subject);
  return {
    ok, applied, found: parsed.found, summaries: plan.parts.map((p) => p.summary), errors, warnings: [...parsed.warnings, ...plan.warnings],
  };
}

// For the dev stand: the same plan and the same writes from a ready document. Throws when the plan has errors.
export function saveSyllabusDoc(store, platform, subjectId, doc) {
  const subjects = store.list('subjects');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject || !subject.disciplineId) throw new Error(`saveSyllabusDoc: no subject with a discipline: ${subjectId}`);
  const sheets = { subjects, staff: store.list('staff'), syllabi: store.list('syllabi'), topics: store.list('topics'), pairs: store.list('pairs') };
  const plan = planFor(doc, sheets, ownerOf(sheets.staff, subject), platform);
  if (plan.errors.length > 0) throw new Error('saveSyllabusDoc: ' + JSON.stringify(plan.errors));
  writePlan(store, platform, plan, sheets, subject);
}

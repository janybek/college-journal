// Versions of a syllabus and what may be done with them. No storage, no network.
import { FIXED_STATUSES, OPEN_STATUSES } from './schema.js';
import { HOURS_PER_PAIR, NO_LESSON, lessonTypeOf, partsOf } from './topics.js';

// The greater version wins, then the greater id: two matching rows (two simultaneous «Fill» on Google) give one answer.
const later = (a, b) => (!a || b.version > a.version || (b.version === a.version && b.id > a.id) ? b : a);

// The versions of one key «discipline + teacher + half of the year» -> { approved, open, last }.
// approved: the row with status 'approved'; open: the row with a status of OPEN_STATUSES (rows or null); last: the greatest version number (0: none).
export function versionsOf(syllabi, { disciplineId, teacherId, semester }) {
  let approved = null;
  let open = null;
  let last = 0;
  for (const s of syllabi || []) {
    if (s.disciplineId !== disciplineId || s.teacherId !== teacherId || s.semester !== semester) continue;
    last = Math.max(last, Number(s.version) || 0);
    if (s.status === 'approved') approved = later(approved, s);
    else if (OPEN_STATUSES.includes(s.status)) open = later(open, s);
  }
  return { approved, open, last };
}

export const EDITABLE_STATUSES = ['draft', 'returned'];

const NO_RIGHTS = { see: false, edit: false, submit: false, approve: false, giveBack: false };
const hasRole = (viewer, role) => Array.isArray(viewer.roles) && viewer.roles.includes(role);

// What the viewer may do with a version. viewer: { id, roles (array), teaches (true: teaches the discipline now) }.
export function rightsOn(version, viewer) {
  if (!version || !viewer || typeof viewer !== 'object') return { ...NO_RIGHTS };
  const status = version.status;
  const manager = hasRole(viewer, 'admin') || hasRole(viewer, 'dean');
  const owner = hasRole(viewer, 'teacher') && viewer.teaches === true && typeof viewer.id === 'string' && viewer.id !== '' && version.teacherId === viewer.id;
  let see = false;
  if (status === 'approved') see = true;
  else if (OPEN_STATUSES.includes(status)) see = manager || owner || (hasRole(viewer, 'prorector') && (status === 'review' || status === 'returned'));
  const worker = manager || owner;
  const edit = EDITABLE_STATUSES.includes(status) && worker;
  return { see, edit, submit: edit, approve: manager && OPEN_STATUSES.includes(status), giveBack: manager && status === 'review' };
}

const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const emptyId = (id) => id === undefined || id === null || id === '';
const nameKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Map(id of a row of the approved version -> its copy in the new version): by sourceId, then (a copy has no sourceId) by kind and name.
export function copiesOf(topics, approvedTopics) {
  const mine = [...(topics || [])].sort(byOrder);
  const approved = [...(approvedTopics || [])].sort(byOrder);
  const taken = new Set();
  const found = new Map();
  for (const a of approved) {
    if (found.has(a.id)) continue;
    const copy = mine.find((t) => !taken.has(t) && t.sourceId === a.id);
    if (copy) {
      taken.add(copy);
      found.set(a.id, copy);
    }
  }
  for (const a of approved) {
    if (found.has(a.id)) continue;
    const copy = mine.find((t) => !taken.has(t) && emptyId(t.sourceId) && t.lessonKind === a.lessonKind && nameKey(t.name) === nameKey(a.name));
    if (copy) {
      taken.add(copy);
      found.set(a.id, copy);
    }
  }
  return new Map(approved.filter((a) => found.has(a.id)).map((a) => [a.id, found.get(a.id)]));
}

const pairOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.slot || 0) - (b.slot || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Held pairs of the rows of the approved version against the copies of those rows in the new version.
export function checkHeld(draftTopics, approvedTopics, pairs) {
  const copies = copiesOf(draftTopics, approvedTopics);
  const held = new Map();
  for (const p of pairs || []) {
    if (!FIXED_STATUSES.includes(p.status) || !p.topicId) continue;
    if (!held.has(p.topicId)) held.set(p.topicId, []);
    held.get(p.topicId).push(p);
  }
  const errors = [];
  for (const a of [...(approvedTopics || [])].sort(byOrder)) {
    const mine = held.get(a.id);
    if (!mine) continue;
    held.delete(a.id);
    mine.sort(pairOrder);
    const where = { name: a.name, date: mine[0].date };
    const copy = copies.get(a.id);
    if (!copy) errors.push({ section: 'plan', code: 'held_missing', ...where });
    else if (mine.some((p) => p.lessonType !== lessonTypeOf(copy))) errors.push({ section: 'plan', code: 'held_kind', ...where });
    else if (mine.some((p) => p.part > partsOf(copy, p.lessonType))) {
      errors.push({ section: 'plan', code: 'held_hours', ...where, held: Math.max(...mine.map((p) => p.part)) * HOURS_PER_PAIR });
    }
  }
  return errors;
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const LESSON_LISTS = ['lecture', 'practice', 'seminar', 'lab'];

// Errors that stop the submitting and warnings that do not. doc — from buildDoc; held — errors of checkHeld.
export function checkSubmit(doc, held = []) {
  const errors = [];
  const warnings = [];
  const title = doc?.title || {};
  for (const field of ['department', 'academicYear', 'course', 'planSemester', 'credits']) {
    if (blank(title[field])) errors.push({ section: 'title', field, code: 'required' });
  }
  if (blank(doc?.goals?.goal)) errors.push({ section: 'goals', field: 'goal', code: 'required' });

  const units = doc?.plan?.units || [];
  const lessonsOf = (u) => LESSON_LISTS.flatMap((k) => u[k] || []);
  if (!units.some((u) => lessonsOf(u).length > 0)) errors.push({ section: 'plan', code: 'empty' });
  else for (const u of units) if (lessonsOf(u).length === 0) errors.push({ section: 'plan', unit: u.unit, code: 'unit_empty' });
  for (const u of units) {
    for (const kind of [...LESSON_LISTS, 'control']) {
      const allowed = kind === 'control' ? [0, 2] : [2, 4];
      for (const r of u[kind] || []) if (!allowed.includes(r.hours)) errors.push({ section: 'plan', code: 'bad_hours', name: r.name });
    }
  }
  (doc?.selfWork?.items || []).forEach((item, index) => {
    if (blank(item.unit)) return;
    if (!Number.isInteger(item.unit) || item.unit < 1 || item.unit > units.length) errors.push({ section: 'selfWork', index, code: 'bad_unit' });
  });
  errors.push(...held);

  if (!(doc?.literature?.main?.length || doc?.literature?.extra?.length)) warnings.push({ section: 'literature', code: 'empty' });
  if (!doc?.software?.items?.length) warnings.push({ section: 'software', code: 'empty' });
  const pol = doc?.policies || {};
  if (!(pol.grading?.length || pol.behavior?.length || pol.ethics?.length || !blank(pol.sanctionBehavior) || !blank(pol.sanctionEthics))) {
    warnings.push({ section: 'policies', code: 'empty' });
  }
  if (!(doc?.units?.units || []).some((u) => !blank(u.description))) warnings.push({ section: 'units', code: 'empty' });
  return { errors, warnings };
}

// What approving writes: the version becomes approved, the previous approved one is archived, the pairs move to the copies of their rows.
export function approvalPlan({ version, approved, topics, approvedTopics, pairs, userId, today }) {
  const syllabi = [{ id: version.id, patch: { status: 'approved', decidedBy: userId, decidedAt: today, remark: '' } }];
  if (approved) syllabi.push({ id: approved.id, patch: { status: 'archived' } });
  const copies = copiesOf(topics, approvedTopics);
  const old = new Set((approvedTopics || []).map((t) => t.id));
  const moved = [];
  for (const p of pairs || []) {
    if (!p.topicId || !old.has(p.topicId)) continue;
    const copy = copies.get(p.topicId);
    moved.push({ id: p.id, patch: copy ? { topicId: copy.id } : { ...NO_LESSON } });
  }
  return { syllabi, pairs: moved };
}

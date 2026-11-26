// Versions of a syllabus and what may be done with them. No storage, no network.
import { FIXED_STATUSES, LESSON_KINDS, OPEN_STATUSES } from './schema.js';
import { compareNames } from './names.js';
import { courseOf } from './syllabusFile.js';
import { closedUnitsOf } from './ledger.js';
import { HOURS_PER_PAIR, NO_LESSON, lessonTypeOf, partsOf } from './topics.js';

// The greater version wins, then the greater id: two matching rows (two simultaneous «Fill» on Google) give one answer.
const later = (a, b) => (!a || b.version > a.version || (b.version === a.version && b.id > a.id) ? b : a);

// The versions of one key «discipline + teacher + half of the year» -> { approved, open, last }.
// approved: the row with status 'approved'; open: the row with a status of OPEN_STATUSES (rows or null); last: the greatest version number (0: none).
export function versionsOf(syllabi, { disciplineId, teacherId, semester }) {
  return versionsIn((syllabi || []).filter((s) => s.disciplineId === disciplineId && s.teacherId === teacherId && s.semester === semester));
}

// The same for rows already picked (by a key or by a line).
export function versionsIn(rows) {
  let approved = null;
  let open = null;
  let last = 0;
  for (const s of rows || []) {
    last = Math.max(last, Number(s.version) || 0);
    if (s.status === 'approved') approved = later(approved, s);
    else if (OPEN_STATUSES.includes(s.status)) open = later(open, s);
  }
  return { approved, open, last };
}

export const EDITABLE_STATUSES = ['draft', 'returned'];

const NO_RIGHTS = { see: false, edit: false, submit: false, approve: false, giveBack: false };
const hasRole = (viewer, role) => Array.isArray(viewer.roles) && viewer.roles.includes(role);

// What the viewer may do with a version. viewer: { id, roles (array), part ('responsible' | 'teaches' | null: the place on the syllabus of the
// discipline, from partOf), archived (true: the version lies on a line of the history) }.
// TEMP task 3: the parts 'author', 'member', 'invited' of the old shared lines work as before, with teaches === true.
export function rightsOn(version, viewer) {
  if (!version || !viewer || typeof viewer !== 'object') return { ...NO_RIGHTS };
  const status = version.status;
  const manager = hasRole(viewer, 'admin') || hasRole(viewer, 'dean');
  const teacher = hasRole(viewer, 'teacher') && typeof viewer.id === 'string' && viewer.id !== '';
  const part = viewer.part ?? null;
  const archived = viewer.archived === true;
  const old = teacher && viewer.teaches === true ? part : null; // TEMP task 3
  const responsible = teacher && part === 'responsible';
  const worker = !archived && (manager || responsible || old === 'author' || old === 'member'); // TEMP task 3 (old)
  let see = false;
  if (status === 'approved') see = !archived || manager;
  else if (OPEN_STATUSES.includes(status)) {
    see = worker || (archived && manager)
      || (!archived && ((teacher && part === 'teaches') || old === 'invited' || (hasRole(viewer, 'prorector') && (status === 'review' || status === 'returned'))));
  }
  const edit = EDITABLE_STATUSES.includes(status) && worker;
  const submit = edit && (manager || responsible || old === 'author'); // TEMP task 3 (old)
  const open = OPEN_STATUSES.includes(status) && !archived && manager;
  return { see, edit, submit, approve: open, giveBack: open && status === 'review' };
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
// closures + planSemester (of the approved version): a held pair of a unit that is closed now must stay in that unit.
// withSubject: every error also names the subject of the pair whose date it names.
export function checkHeld(draftTopics, approvedTopics, pairs, closures = [], planSemester = null, { withSubject = false } = {}) {
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
    const where = { name: a.name, date: mine[0].date, ...(withSubject ? { subjectId: mine[0].subjectId } : {}) };
    const copy = copies.get(a.id);
    if (!copy) errors.push({ section: 'plan', code: 'held_missing', ...where });
    else if (mine.some((p) => p.lessonType !== lessonTypeOf(copy))) errors.push({ section: 'plan', code: 'held_kind', ...where });
    else if (mine.some((p) => p.part > partsOf(copy, p.lessonType))) {
      errors.push({ section: 'plan', code: 'held_hours', ...where, held: Math.max(...mine.map((p) => p.part)) * HOURS_PER_PAIR });
    } else if (copy.unit !== a.unit) {
      const shut = mine.find((p) => closedUnitsOf(closures, p.subjectId, planSemester).units.includes(a.unit));
      if (shut) errors.push({ section: 'plan', code: 'held_closed', name: a.name, date: shut.date, ...(withSubject ? { subjectId: shut.subjectId } : {}) });
    }
  }
  return errors;
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const LESSON_LISTS = ['lecture', 'practice', 'seminar', 'lab'];

// Errors that stop the submitting and warnings that do not. doc — from buildDoc; held — errors of checkHeld.
// groups: [{ name, course }] — the groups where the teacher leads the discipline.
export function checkSubmit(doc, held = [], groups = []) {
  const errors = [];
  const warnings = [];
  const title = doc?.title || {};
  for (const field of ['department', 'academicYear', 'course', 'planSemester', 'credits']) {
    if (blank(title[field])) errors.push({ section: 'title', field, code: 'required' });
  }
  const { course, planSemester } = title;
  if (Number.isInteger(course) && Number.isInteger(planSemester) && courseOf(planSemester) !== course) {
    errors.push({ section: 'title', field: 'planSemester', code: 'course_semester', course });
  }

  const units = doc?.plan?.units || [];
  const lessonsOf = (u) => LESSON_LISTS.flatMap((k) => u[k] || []);
  if (!units.some((u) => lessonsOf(u).length > 0)) errors.push({ section: 'plan', code: 'empty' });
  else for (const u of units) if (lessonsOf(u).length === 0) errors.push({ section: 'plan', unit: u.unit, code: 'unit_empty' });
  // занятие с юнитом не 1, 2, 3… в плане не показывается: сохранить такой план нельзя, отправить тоже
  // занятие неизвестного вида (в листе «Темы» вписали «практика» вместо кода) тоже не видно в плане и не встаёт на пары
  for (const l of doc?.lessons || []) {
    if (!Number.isInteger(l.unit) || l.unit < 1) errors.push({ section: 'plan', code: 'bad_unit', id: l.id, name: l.name });
    else if (!LESSON_KINDS.includes(l.lessonKind)) errors.push({ section: 'plan', code: 'bad_kind', id: l.id, name: l.name });
  }
  // рубежный контроль без часов первым в юните: его отметке не на какую пару встать (вкладка «Порядок пар» его так и не сохранит)
  const firstOf = new Map();
  for (const l of doc?.lessons || []) if (!firstOf.has(l.unit)) firstOf.set(l.unit, l);
  for (const u of units) {
    const first = firstOf.get(u.unit);
    if (first && first.lessonKind === 'control' && !(first.hours > 0) && lessonsOf(u).length > 0) errors.push({ section: 'order', unit: u.unit, code: 'control_first' });
  }
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

  if (blank(doc?.goals?.goal)) warnings.push({ section: 'goals', code: 'empty' });
  if (!(doc?.literature?.main?.length || doc?.literature?.extra?.length)) warnings.push({ section: 'literature', code: 'empty' });
  if (!doc?.software?.items?.length) warnings.push({ section: 'software', code: 'empty' });
  const pol = doc?.policies || {};
  if (!(pol.grading?.length || pol.behavior?.length || pol.ethics?.length || !blank(pol.sanctionBehavior) || !blank(pol.sanctionEthics))) {
    warnings.push({ section: 'policies', code: 'empty' });
  }
  if (!(doc?.units?.units || []).some((u) => !blank(u.description))) warnings.push({ section: 'units', code: 'empty' });
  if (Number.isInteger(course)) {
    const other = (groups || []).filter((g) => Number.isInteger(g.course) && g.course !== course).map((g) => g.name).sort(compareNames);
    if (other.length) warnings.push({ section: 'title', code: 'group_course', groups: other });
  }
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

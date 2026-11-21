// Subjects and their disciplines for the handlers and for setup. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { normalizeRow, validateRow } from '../core/validate.js';
import { scheduleFit, syllabusFor, syllabusIndex, syllabusTotals } from '../core/syllabus.js';
import { rolesOf } from './users.js';
import { loadSettings } from './scheduleData.js';

export const MAX_SUBJECT_ITEMS = 30;

// Trimmed, whitespace runs collapsed: how a name is stored.
const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const same = (a, b) => tidy(a).toLowerCase() === tidy(b).toLowerCase();
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// Only plain text is an id: an array or a number must not slip through String().
const idOf = (v) => (typeof v === 'string' ? v : '');

// One discipline, several groups, each with its teacher. All or nothing; the name is always the discipline's.
export function addSubjects(store, { disciplineId, items }) {
  if (typeof disciplineId !== 'string' || !Array.isArray(items)
    || items.length < 1 || items.length > MAX_SUBJECT_ITEMS || !items.every(isObject)) {
    throw new AppError('bad_request');
  }
  const subjects = store.list('subjects');
  const staff = store.list('staff');
  const groups = store.list('groups');
  const disciplines = store.list('disciplines');
  const discipline = disciplines.find((d) => d.id === disciplineId);

  // Rows accepted so far are visible to the next ones (the same group twice is a duplicate).
  const work = [...subjects];
  const rows = [];
  const fields = [];
  items.forEach((item, index) => {
    const row = normalizeRow('subjects', {
      name: discipline ? discipline.name : '', disciplineId,
      teacherId: idOf(item.teacherId), groupId: idOf(item.groupId), scheme: 'A',
    });
    const db = { subjects: work, staff, groups, disciplines };
    for (const { field, code } of validateRow('subjects', row, db)) {
      // An unknown discipline is one error, on the first row.
      if (field === 'disciplineId' && code === 'bad_ref' && index > 0) continue;
      fields.push({ index, field, code });
    }
    work.push({ ...row, id: `new_${index}` });
    rows.push(row);
  });
  if (fields.length > 0) throw new AppError('invalid', { fields });
  return { rows: store.insertMany('subjects', rows) };
}

// Subjects without a discipline get one by their name (found without case and extra spaces, or created).
// The subject's name is rewritten with the discipline's. A second run writes nothing.
export function linkSubjects(store) {
  const subjects = store.list('subjects');
  const disciplines = store.list('disciplines');
  const todo = subjects.filter((s) => s.disciplineId === '' || s.disciplineId === undefined || s.disciplineId === null);
  const named = todo.filter((s) => tidy(s.name) !== '');
  const result = { created: 0, linked: 0, unlinked: todo.length - named.length };
  if (named.length === 0) return result;

  const byName = new Map();
  for (const d of disciplines) {
    const key = tidy(d.name).toLowerCase();
    if (!byName.has(key)) byName.set(key, d);
  }
  const fresh = [];
  for (const s of named) {
    const key = tidy(s.name).toLowerCase();
    if (!byName.has(key) && !fresh.some((n) => same(n, s.name))) fresh.push(tidy(s.name));
  }
  if (fresh.length > 0) {
    for (const d of store.insertMany('disciplines', fresh.map((name) => ({ name })))) byName.set(tidy(d.name).toLowerCase(), d);
    result.created = fresh.length;
  }
  const patches = named.map((s) => {
    const d = byName.get(tidy(s.name).toLowerCase());
    return { id: s.id, patch: { disciplineId: d.id, name: d.name } };
  });
  store.updateMany('subjects', patches);
  result.linked = patches.length;
  return result;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => cmp(String(a).toLowerCase(), String(b).toLowerCase());

// 'subjects.overview': one row per «discipline + teacher» with the groups they teach it in, and the state of the syllabus for the current semester.
// Every sheet is read once; nothing is written.
export function subjectsOverview(store) {
  const subjects = store.list('subjects');
  const groups = store.list('groups');
  const staff = store.list('staff');
  const syllabi = store.list('syllabi');
  const topics = store.list('topics');
  const pairs = store.list('pairs');
  const disciplines = store.list('disciplines');
  const settings = loadSettings(store);

  const index = syllabusIndex(syllabi, topics);
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const disciplineOf = new Map(disciplines.map((d) => [d.id, d]));
  const staffOf = new Map(staff.map((s) => [s.id, s]));
  const pairsOf = new Map();
  for (const p of pairs) {
    if (!pairsOf.has(p.subjectId)) pairsOf.set(p.subjectId, []);
    pairsOf.get(p.subjectId).push(p);
  }

  const byKey = new Map();
  for (const s of subjects) {
    if (typeof s.disciplineId !== 'string' || s.disciplineId === '') continue;
    const key = `${s.disciplineId}|${s.teacherId}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(s);
  }
  const rows = [...byKey.values()].map((list) => {
    const { disciplineId, teacherId } = list[0];
    const current = syllabusFor(list[0], syllabi, settings.semester);
    const totals = syllabusTotals(current ? index.topicsOf.get(current.id) || [] : []);
    const discipline = disciplineOf.get(disciplineId);
    return {
      disciplineId, disciplineName: discipline ? discipline.name : list[0].name,
      teacherId, teacherName: staffOf.has(teacherId) ? staffOf.get(teacherId).fullName : '',
      groups: list.map((s) => ({
        subjectId: s.id, groupId: s.groupId, groupName: groupOf.has(s.groupId) ? groupOf.get(s.groupId).name : '',
        scheduledPairs: scheduleFit([], pairsOf.get(s.id) || [], settings).pairs,
      })).sort((a, b) => byName(a.groupName, b.groupName) || cmp(a.subjectId, b.subjectId)),
      uploaded: current !== null,
      otherSemester: syllabi.some((y) => y.disciplineId === disciplineId && y.teacherId === teacherId && y.status === 'approved' && y.semester !== settings.semester),
      plannedHours: totals.hours, plannedPairs: totals.pairs,
    };
  }).sort((a, b) => byName(a.disciplineName, b.disciplineName) || byName(a.teacherName, b.teacherName) || cmp(a.teacherId, b.teacherId));

  return {
    currentSemester: settings.semester,
    rows,
    disciplines: disciplines.map((d) => ({ id: d.id, name: d.name })).sort((a, b) => byName(a.name, b.name) || cmp(a.id, b.id)),
    groups: groups.map((g) => ({ id: g.id, name: g.name })).sort((a, b) => byName(a.name, b.name) || cmp(a.id, b.id)),
    teachers: staff.filter((s) => s.active === true && rolesOf(s, 'staff').includes('teacher'))
      .map((s) => ({ id: s.id, fullName: s.fullName })).sort((a, b) => byName(a.fullName, b.fullName) || cmp(a.id, b.id)),
  };
}

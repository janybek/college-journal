// Subjects and their disciplines for the handlers and for setup. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { normalizeRow, validateRow } from '../core/validate.js';

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

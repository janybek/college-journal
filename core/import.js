import { STAFF_ROLES } from './schema.js';
import { normalizeRow, validateRow } from './validate.js';

export const MAX_IMPORT_ROWS = 2000;

const column = (key, ru, ky, en, required = false) => ({ key, titles: { ru, ky, en }, required });
const NAME = column('name', 'Название', 'Аталышы', 'Name', true);
const FULL_NAME = column('fullName', 'ФИО', 'Аты-жөнү', 'Full name', true);
const LANG = column('lang', 'Язык', 'Тил', 'Language');

export const IMPORT_SPECS = {
  groups: { uniqueBy: ['name'], columns: [NAME, column('course', 'Курс', 'Курс', 'Year', true)] },
  rooms: { uniqueBy: ['name'], columns: [NAME] },
  students: {
    uniqueBy: ['cardNo'],
    columns: [
      FULL_NAME,
      column('cardNo', '№ студ. билета', 'Студенттик билеттин №', 'Student ID', true),
      column('groupId', 'Группа', 'Тайпа', 'Group', true),
      LANG,
    ],
  },
  staff: {
    uniqueBy: ['login'],
    columns: [FULL_NAME, column('login', 'Логин', 'Логин', 'Login', true), column('roles', 'Роли', 'Ролдор', 'Roles', true), LANG],
  },
  subjects: {
    uniqueBy: ['name', 'groupId'],
    columns: [NAME, column('teacherId', 'Преподаватель', 'Окутуучу', 'Teacher', true), column('groupId', 'Группа', 'Тайпа', 'Group', true)],
  },
};

const ROLE_WORDS = {
  'админ': 'admin', 'admin': 'admin',
  'деканат': 'dean', 'dean': 'dean',
  'проректор': 'prorector', 'prorector': 'prorector',
  'преподаватель': 'teacher', 'окутуучу': 'teacher', 'teacher': 'teacher',
};

const LANG_WORDS = {
  'ky': 'ky', 'кыргызский': 'ky', 'кыргызча': 'ky',
  'ru': 'ru', 'русский': 'ru', 'орусча': 'ru',
  'en': 'en', 'английский': 'en', 'англисче': 'en',
};

// Trimmed, lower-cased, whitespace runs collapsed: used for every comparison.
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim().replace(/\s+/g, ' ');
}

// Existing row of `list` that has the same unique key as `fields`, or undefined.
function findByKey(spec, list, fields) {
  if (spec.uniqueBy.some(k => !cellText(fields[k]))) return undefined;
  return (list || []).find(r => spec.uniqueBy.every(k => norm(r[k]) === norm(fields[k])));
}

function mapHeaders(spec, headerRow) {
  const index = {};
  const unknownColumns = [];
  (headerRow || []).forEach((cell, i) => {
    const text = cellText(cell);
    if (!text) return;
    const col = spec.columns.find(c => Object.values(c.titles).some(t => norm(t) === norm(text)));
    if (!col || col.key in index) unknownColumns.push(text);
    else index[col.key] = i;
  });
  return { index, unknownColumns };
}

// Resolves one non-empty cell into a stored value, or returns { error }.
function resolveCell(key, text, db) {
  if (key === 'groupId') {
    const group = (db.groups || []).find(g => norm(g.name) === norm(text));
    return group ? { value: group.id } : { error: 'bad_ref' };
  }
  if (key === 'teacherId') {
    const staff = db.staff || [];
    const byLogin = staff.find(s => norm(s.login) === norm(text));
    if (byLogin) return { value: byLogin.id };
    const byName = staff.filter(s => norm(s.fullName) === norm(text));
    return byName.length === 1 ? { value: byName[0].id } : { error: 'bad_ref' };
  }
  if (key === 'roles') {
    const words = text.split(',').map(norm).filter(Boolean);
    if (!words.length || words.some(w => !(w in ROLE_WORDS))) return { error: 'bad_value' };
    const roles = new Set(words.map(w => ROLE_WORDS[w]));
    return { value: STAFF_ROLES.filter(r => roles.has(r)).join(',') };
  }
  if (key === 'lang') {
    const lang = LANG_WORDS[norm(text)];
    return lang ? { value: lang } : { error: 'bad_value' };
  }
  return { value: text };
}

export function parseSheet(table, cells, db) {
  const spec = IMPORT_SPECS[table];
  const rows = Array.isArray(cells) ? cells : [];
  const { index, unknownColumns } = mapHeaders(spec, rows[0]);
  const missingColumns = spec.columns.filter(c => c.required && !(c.key in index)).map(c => c.key);
  const result = { records: [], errors: [], unknownColumns, missingColumns };
  if (missingColumns.length) return result;
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    result.errors.push({ row: 0, field: '', code: 'too_many_rows' });
    return result;
  }

  // Working copy: accepted rows of the file are visible to the later ones.
  const work = {};
  for (const t of ['groups', 'students', 'staff', 'subjects', 'rooms']) work[t] = [...(db[t] || [])];
  const seen = new Set();
  const keyOf = (fields) => spec.uniqueBy.map(k => norm(fields[k])).join('\u0000');

  for (let i = 1; i < rows.length; i++) {
    const rowNo = i + 1;
    const cellsOfRow = Array.isArray(rows[i]) ? rows[i] : [];
    const texts = {};
    for (const c of spec.columns) if (c.key in index) texts[c.key] = cellText(cellsOfRow[index[c.key]]);
    if (Object.values(texts).every(t => t === '')) continue;

    const fields = {};
    const codes = {};
    for (const c of spec.columns) {
      if (!(c.key in index)) continue;
      if (texts[c.key] === '') {
        if (c.required) codes[c.key] = 'required';
        continue;
      }
      const res = resolveCell(c.key, texts[c.key], db);
      if (res.error) codes[c.key] = res.error;
      else fields[c.key] = res.value;
    }

    const existing = findByKey(spec, db[table], fields);
    if (spec.uniqueBy.every(k => k in fields) && seen.has(keyOf(fields)) && !(spec.uniqueBy[0] in codes)) {
      codes[spec.uniqueBy[0]] = 'duplicate';
    }
    const candidate = normalizeRow(table, { ...(existing || {}), ...fields });
    for (const { field, code } of validateRow(table, candidate, work)) {
      if (!(field in codes) && spec.columns.some(c => c.key === field)) codes[field] = code;
    }

    const errorFields = spec.columns.filter(c => c.key in codes);
    if (errorFields.length) {
      for (const c of errorFields) result.errors.push({ row: rowNo, field: c.key, code: codes[c.key] });
      continue;
    }
    seen.add(keyOf(fields));
    if (existing) work[table] = work[table].map(r => (r.id === existing.id ? candidate : r));
    else work[table].push({ ...candidate, id: `import_row_${rowNo}` });
    result.records.push({ row: rowNo, ...fields });
  }
  return result;
}

export function planImport(table, records, db) {
  const spec = IMPORT_SPECS[table];
  const plan = { toInsert: [], toUpdate: [] };
  for (const { row, ...fields } of records) {
    const existing = findByKey(spec, db[table], fields);
    if (!existing) {
      plan.toInsert.push(normalizeRow(table, fields));
      continue;
    }
    const normalized = normalizeRow(table, fields);
    const patch = {};
    for (const key of Object.keys(fields)) if (!spec.uniqueBy.includes(key)) patch[key] = normalized[key];
    plan.toUpdate.push({ id: existing.id, patch });
  }
  return plan;
}

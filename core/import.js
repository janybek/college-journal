import { STAFF_ROLES, FIXED_STATUSES } from './schema.js';
import { normalizeRow, validateRow } from './validate.js';
import { DEFAULT_SEMESTER } from './topics.js';

export const MAX_IMPORT_ROWS = 2000;

// `aliases`: other header titles accepted for the column (older template versions); never written to a template.
// `virtual`: checked like any column but never written to `records` (it only helps to resolve other cells of the row).
const column = (key, ru, ky, en, required = false, aliases, virtual = false) =>
  ({ key, titles: { ru, ky, en }, required, ...(aliases ? { aliases } : {}), ...(virtual ? { virtual: true } : {}) });
const NAME = column('name', 'Название', 'Аталышы', 'Name', true);
const FULL_NAME = column('fullName', 'ФИО', 'Аты-жөнү', 'Full name', true);
const LANG = column('lang', 'Язык', 'Тил', 'Language');
const GROUP = column('groupId', 'Группа', 'Топ', 'Group', true, ['Тайпа']);

const TOPIC_KEY = ['order', 'semester', 'subjectId'];
const TOPIC_KEY_DEFAULTS = { semester: DEFAULT_SEMESTER };
const TOPIC_COLUMNS = [
  column('semester', 'Семестр', 'Семестр', 'Semester', true),
  column('unit', 'Модуль', 'Модуль', 'Module', true, ['Юнит', 'Unit']),
  column('order', '№', '№', 'No.', true, ['№ по порядку', '№ темы', 'No', 'N']),
  column('name', 'Тема', 'Тема', 'Topic', true, ['Название']),
  column('lessonType', 'Тип', 'Түрү', 'Type', true, ['Тип пары']),
];

// A topic whose pair is already held keeps its name, type and unit.
function topicHeld(existing, candidate, db) {
  const held = (db.pairs || []).some(p => p.topicId === existing.id && FIXED_STATUSES.includes(p.status));
  const changed = ['name', 'lessonType', 'unit'].some(k => String(existing[k]) !== String(candidate[k]));
  return held && changed ? { field: 'name', code: 'held' } : null;
}

export const IMPORT_SPECS = {
  groups: { uniqueBy: ['name'], columns: [NAME, column('course', 'Курс', 'Курс', 'Year', true)] },
  rooms: { uniqueBy: ['name'], columns: [NAME] },
  disciplines: { uniqueBy: ['name'], columns: [NAME] },
  students: {
    uniqueBy: ['cardNo'],
    columns: [
      FULL_NAME,
      column('cardNo', '№ студ. билета', 'Студенттик билеттин №', 'Student ID', true),
      GROUP,
      LANG,
    ],
  },
  staff: {
    uniqueBy: ['login'],
    columns: [FULL_NAME, column('login', 'Логин', 'Логин', 'Login', true), column('roles', 'Роли', 'Ролдор', 'Roles', true), LANG],
  },
  subjects: {
    uniqueBy: ['name', 'groupId'],
    columns: [NAME, column('teacherId', 'Преподаватель', 'Окутуучу', 'Teacher', true), GROUP],
  },
  topics: {
    uniqueBy: TOPIC_KEY,
    keyDefaults: TOPIC_KEY_DEFAULTS,
    columns: [
      column('subjectId', 'Предмет', 'Сабак', 'Subject', true),
      column('groupId', 'Группа', 'Топ', 'Group', true, ['Тайпа'], true),
      ...TOPIC_COLUMNS,
    ],
    check: topicHeld,
  },
  // The teacher's own file: one subject for the whole file (`fixed`), stored in the topics table.
  syllabus: { table: 'topics', fixedKeys: ['subjectId'], uniqueBy: TOPIC_KEY, keyDefaults: TOPIC_KEY_DEFAULTS, columns: TOPIC_COLUMNS, check: topicHeld },
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

const LESSON_WORDS = {
  'лекция': 'lecture', 'lecture': 'lecture',
  'практика': 'practice', 'практическое': 'practice', 'practice': 'practice',
  'рубежный': 'control', 'рубежный контроль': 'control', 'экзамен': 'control',
  'аралык текшерүү': 'control', 'control': 'control', 'exam': 'control',
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
  const defaults = spec.keyDefaults || {};
  const stored = (r, k) => (cellText(r[k]) === '' && k in defaults ? defaults[k] : r[k]);
  return (list || []).find(r => spec.uniqueBy.every(k => norm(stored(r, k)) === norm(fields[k])));
}

function mapHeaders(spec, headerRow) {
  const index = {};
  const unknownColumns = [];
  (headerRow || []).forEach((cell, i) => {
    const text = cellText(cell);
    if (!text) return;
    const col = spec.columns.find(c => [...Object.values(c.titles), ...(c.aliases || [])].some(t => norm(t) === norm(text)));
    if (!col || col.key in index) unknownColumns.push(text);
    else index[col.key] = i;
  });
  return { index, unknownColumns };
}

// Resolves one non-empty cell into a stored value, or returns { error }.
function resolveCell(key, text, db, rowGroup) {
  if (key === 'subjectId' && rowGroup !== undefined) {
    const subject = (db.subjects || []).find(s => s.groupId === rowGroup && norm(s.name) === norm(text));
    return subject ? { value: subject.id } : { error: 'bad_ref' };
  }
  if (key === 'semester' && /^\d+$/.test(text)) return { value: Number(text) };
  if (key === 'lessonType') {
    const type = LESSON_WORDS[norm(text)];
    return type ? { value: type } : { error: 'bad_value' };
  }
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

// `fixed`: fields equal for every row of the file (the subject of a syllabus); they join the key, the checks and the records.
export function parseSheet(table, cells, db, fixed = {}) {
  const spec = IMPORT_SPECS[table];
  const storage = spec.table ?? table;
  const rows = Array.isArray(cells) ? cells : [];
  const { index, unknownColumns } = mapHeaders(spec, rows[0]);
  const missingColumns = spec.columns.filter(c => c.required && !(c.key in index)).map(c => c.key);
  const result = { records: [], errors: [], unknownColumns, missingColumns };
  if (missingColumns.length) return result;
  // The fixed fields are not cells of the file, so a wrong one is an error of the whole file.
  for (const key of spec.fixedKeys || []) {
    const code = fixed[key] === undefined || fixed[key] === '' ? 'required'
      : validateRow(storage, { [key]: fixed[key] }, db).find(e => e.field === key)?.code;
    if (code) result.errors.push({ row: 0, field: key, code });
  }
  if (result.errors.length) return result;
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    result.errors.push({ row: 0, field: '', code: 'too_many_rows' });
    return result;
  }

  // Working copy: accepted rows of the file are visible to the later ones.
  const work = {};
  for (const t of Object.keys(db)) if (Array.isArray(db[t])) work[t] = [...db[t]];
  work[storage] = work[storage] || [];
  const seen = new Set();
  const keyOf = (fields) => spec.uniqueBy.map(k => norm(fields[k])).join('\u0000');

  for (let i = 1; i < rows.length; i++) {
    const rowNo = i + 1;
    const cellsOfRow = Array.isArray(rows[i]) ? rows[i] : [];
    const texts = {};
    for (const c of spec.columns) if (c.key in index) texts[c.key] = cellText(cellsOfRow[index[c.key]]);
    if (Object.values(texts).every(t => t === '')) continue;

    // A subject is looked up by name inside the group of the same row.
    const hasGroupColumn = spec.columns.some(c => c.virtual && c.key === 'groupId');
    let rowGroup;
    let groupMissing = false;
    if (hasGroupColumn) {
      const g = resolveCell('groupId', texts.groupId || '', db);
      if (g.error) groupMissing = true;
      else rowGroup = g.value;
    }

    const fields = { ...fixed };
    const codes = {};
    for (const c of spec.columns) {
      if (!(c.key in index)) continue;
      if (texts[c.key] === '') {
        if (c.required) codes[c.key] = 'required';
        continue;
      }
      if (c.key === 'subjectId' && groupMissing) continue;
      const res = resolveCell(c.key, texts[c.key], db, c.key === 'subjectId' ? rowGroup : undefined);
      if (res.error) codes[c.key] = res.error;
      else fields[c.key] = res.value;
    }

    const existing = findByKey(spec, db[storage], fields);
    if (spec.uniqueBy.every(k => k in fields) && seen.has(keyOf(fields)) && !(spec.uniqueBy[0] in codes)) {
      codes[spec.uniqueBy[0]] = 'duplicate';
    }
    const candidate = normalizeRow(storage, { ...(existing || {}), ...fields });
    for (const { field, code } of validateRow(storage, candidate, work)) {
      if (field === 'subjectId' && groupMissing) continue;
      if (!(field in codes) && spec.columns.some(c => c.key === field)) codes[field] = code;
    }
    if (existing && spec.check && !Object.keys(codes).length) {
      const found = spec.check(existing, candidate, db);
      if (found && !(found.field in codes)) codes[found.field] = found.code;
    }

    const errorFields = spec.columns.filter(c => c.key in codes);
    if (errorFields.length) {
      for (const c of errorFields) result.errors.push({ row: rowNo, field: c.key, code: codes[c.key] });
      continue;
    }
    seen.add(keyOf(fields));
    if (existing) work[storage] = work[storage].map(r => (r.id === existing.id ? candidate : r));
    else work[storage].push({ ...candidate, id: `import_row_${rowNo}` });
    const stored = { ...fields };
    for (const c of spec.columns) if (c.virtual) delete stored[c.key];
    result.records.push({ row: rowNo, ...stored });
  }
  return result;
}

export function planImport(table, records, db) {
  const spec = IMPORT_SPECS[table];
  const storage = spec.table ?? table;
  const plan = { toInsert: [], toUpdate: [] };
  for (const { row, ...fields } of records) {
    const existing = findByKey(spec, db[storage], fields);
    if (!existing) {
      plan.toInsert.push(normalizeRow(storage, fields));
      continue;
    }
    const normalized = normalizeRow(storage, fields);
    const patch = {};
    for (const key of Object.keys(fields)) if (!spec.uniqueBy.includes(key)) patch[key] = normalized[key];
    plan.toUpdate.push({ id: existing.id, patch });
  }
  return plan;
}

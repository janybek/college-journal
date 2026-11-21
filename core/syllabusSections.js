// Проверка разделов формы силлабуса. Чистые функции без обращений к платформе.
// checkSection(section, data, ctx) -> { value, errors }: value собран всегда, но при ошибках писать его нельзя.

export const LIMITS = { text: 5000, short: 200, description: 1000, list: 100, planRows: 300, units: 20 };
export const SECTIONS = ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units', 'order'];
// листы, которые читает и пишет сохранение раздела (кроме «Силлабусов»: они читаются всегда)
// plan читает и «Литературу»: книги юнитов, которые это сохранение удаляет, уходят вместе с юнитом
export const SECTION_TABLES = { title: [], goals: ['outcomes'], plan: ['topics', 'units', 'literature'], selfWork: ['selfWork'], literature: ['literature'],
  software: ['software'], policies: ['grading', 'rules'], units: ['units', 'literature'], order: ['topics'] };

const PLAN_LISTS = ['lecture', 'practice', 'seminar', 'lab', 'control'];
const WITH_FORMS = ['practice', 'seminar', 'lab'];
const BOOK_FIELDS = ['authors', 'title', 'year', 'publisher', 'availability'];
const GRADING_RANGES = ['rangeFail', 'rangeFair', 'rangeGood', 'rangeExcellent'];
const GRADING_CRITERIA = ['criteriaFail', 'criteriaFair', 'criteriaGood', 'criteriaExcellent'];
const LINK_MAX = 500;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const textOf = (v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function plainId(value) {
  return typeof value === 'string' && value !== '' && value === value.trim() ? value : null;
}

// Целое: число или строка из цифр; пустое -> null без ошибки.
function intOf(v) {
  if (blank(v)) return { value: null, bad: false };
  if (typeof v === 'number') return Number.isInteger(v) ? { value: v, bad: false } : { value: null, bad: true };
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return { value: Number(v.trim()), bad: false };
  return { value: null, bad: true };
}

// Строка не длиннее max; add получает ошибку поля.
function limited(raw, max, add, field) {
  const value = textOf(raw);
  if (value.length > max) add({ field, code: 'too_long' });
  return value;
}
const shortOf = (o, key, add, field = key) => limited(o[key], LIMITS.short, add, field);
const longOf = (o, key, add, field = key) => limited(o[key], LIMITS.text, add, field);

function ranged(raw, min, max, add, field) {
  const { value, bad } = intOf(raw);
  if (bad || (value !== null && (value < min || value > max))) {
    add({ field, code: 'bad_value' });
    return null;
  }
  return value;
}

// Список: one(пункт, add) возвращает приведённый пункт или undefined (пункт выброшен).
function listOf(raw, name, base, errors, limit, one) {
  if (blank(raw)) return [];
  if (!Array.isArray(raw)) {
    errors.push({ ...base, list: name, code: 'bad_value' });
    return [];
  }
  if (raw.length > limit) errors.push({ ...base, list: name, code: 'too_many' });
  const out = [];
  raw.forEach((item, index) => {
    const add = (e) => errors.push({ ...base, list: name, index, ...e });
    const result = one(item, add);
    if (result !== undefined) out.push(result);
  });
  return out;
}

function stringItem(max) {
  return (item, add) => {
    if (!blank(item) && typeof item !== 'string' && typeof item !== 'number') {
      add({ field: 'text', code: 'bad_value' });
      return undefined;
    }
    const value = textOf(item);
    if (value === '') return undefined;
    if (value.length > max) add({ field: 'text', code: 'too_long' });
    return value;
  };
}

// Пункт-объект: пустой выбрасывается, не объект — bad_value.
function objectItem(keys, read, keepBlank = false) {
  return (item, add) => {
    if (!isObject(item) && !blank(item)) {
      add({ code: 'bad_value' });
      return undefined;
    }
    const o = isObject(item) ? item : {};
    if (!keepBlank && keys.every((k) => blank(o[k]))) return undefined;
    return read(o, add);
  };
}

function readBook(o, add) {
  const book = {};
  for (const key of BOOK_FIELDS) book[key] = shortOf(o, key, add);
  if (book.title === '') add({ field: 'title', code: 'required' });
  return book;
}

function titleSection(data, ctx) {
  const errors = [];
  const add = (e) => errors.push(e);
  const value = {};
  value.department = shortOf(data, 'department', add);
  value.faculty = shortOf(data, 'faculty', add);
  value.academicYear = academicYear(data.academicYear, add);
  value.course = ranged(data.course, 1, 6, add, 'course');
  value.planSemester = ranged(data.planSemester, 1, 8, add, 'planSemester');
  if (value.planSemester !== null && (ctx.half === 1 || ctx.half === 2) && value.planSemester % 2 !== ctx.half % 2) {
    add({ field: 'planSemester', code: 'semester_half' });
  }
  value.credits = ranged(data.credits, 1, 60, add, 'credits');
  value.audience = shortOf(data, 'audience', add);
  value.totalHours = ranged(data.totalHours, 1, 2000, add, 'totalHours');
  value.classHours = ranged(data.classHours, 0, 2000, add, 'classHours');
  value.selfHours = ranged(data.selfHours, 0, 2000, add, 'selfHours');
  value.contacts = longOf(data, 'contacts', add);
  value.place = shortOf(data, 'place', add);
  return { value, errors };
}

function academicYear(raw, add) {
  const text = textOf(raw).replace(/\s*[-‐‑‒–—−]\s*/g, '–');
  if (text === '') return '';
  const m = /^(\d{4})–(\d{4})$/.exec(text);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) {
    add({ field: 'academicYear', code: 'bad_value' });
    return text;
  }
  return text;
}

function goalsSection(data) {
  const errors = [];
  const add = (e) => errors.push(e);
  const value = { goal: longOf(data, 'goal', add) };
  for (const key of ['knowledge', 'skill', 'attitude']) value[key] = listOf(data[key], key, {}, errors, LIMITS.list, stringItem(LIMITS.text));
  for (const key of ['prerequisite', 'postrequisite']) value[key] = listOf(data[key], key, {}, errors, LIMITS.list, stringItem(LIMITS.short));
  return { value, errors };
}

function planRow(kind) {
  return (item, add) => {
    const o = isObject(item) ? item : {};
    if (!isObject(item) && !blank(item)) add({ code: 'bad_value' });
    const row = {};
    if (blank(o.id)) row.id = '';
    else {
      const id = plainId(o.id);
      if (id === null) add({ field: 'id', code: 'bad_value' });
      row.id = id === null ? '' : id;
    }
    row.name = shortOf(o, 'name', add);
    if (row.name === '' && kind !== 'control') add({ field: 'name', code: 'required' });
    const hours = intOf(o.hours);
    const allowed = kind === 'control' ? [0, 2] : [2, 4];
    if (hours.bad || !allowed.includes(hours.value)) add({ field: 'hours', code: 'bad_hours' });
    row.hours = hours.value;
    row.controlForms = WITH_FORMS.includes(kind) ? shortOf(o, 'controlForms', add) : '';
    row.selfHours = ranged(o.selfHours, 0, 200, add, 'selfHours');
    row.description = limited(o.description, LIMITS.description, add, 'description');
    return row;
  };
}

function planSection(data) {
  const errors = [];
  const raw = data.units;
  if (!Array.isArray(raw)) {
    errors.push({ list: 'units', code: blank(raw) ? 'required' : 'bad_value' });
    return { value: { units: [] }, errors };
  }
  if (raw.length === 0) errors.push({ list: 'units', code: 'required' });
  if (raw.length > LIMITS.units) errors.push({ list: 'units', code: 'too_many' });
  let rows = 0;
  for (const unit of raw) {
    if (!isObject(unit)) continue;
    for (const kind of PLAN_LISTS) if (Array.isArray(unit[kind])) rows += unit[kind].length;
  }
  if (rows > LIMITS.planRows) errors.push({ list: 'units', code: 'too_many_rows' });
  const units = raw.map((rawUnit, i) => {
    const o = isObject(rawUnit) ? rawUnit : {};
    const base = { unit: i + 1 };
    if (!isObject(rawUnit) && !blank(rawUnit)) errors.push({ ...base, field: 'unit', code: 'bad_value' });
    const unit = { title: shortOf(o, 'title', (e) => errors.push({ ...base, ...e })) };
    for (const kind of PLAN_LISTS) unit[kind] = listOf(o[kind], kind, base, errors, Infinity, planRow(kind));
    return unit;
  });
  return { value: { units }, errors };
}

function selfWorkSection(data) {
  const errors = [];
  const keys = ['unit', 'name', 'tasks', 'hours'];
  const items = listOf(data.items, 'items', {}, errors, LIMITS.list, objectItem(keys, (o, add) => {
    const unit = ranged(o.unit, 1, LIMITS.units, add, 'unit');
    const name = shortOf(o, 'name', add);
    if (name === '') add({ field: 'name', code: 'required' });
    const tasks = longOf(o, 'tasks', add);
    const hours = ranged(o.hours, 0, 200, add, 'hours');
    return { unit, name, tasks, hours };
  }));
  return { value: { items }, errors };
}

const bookItem = (keepBlank = false) => objectItem(BOOK_FIELDS, readBook, keepBlank);

function literatureSection(data) {
  const errors = [];
  const value = {};
  for (const key of ['main', 'extra']) value[key] = listOf(data[key], key, {}, errors, LIMITS.list, bookItem());
  return { value, errors };
}

function linkOf(o, add) {
  const link = textOf(o.link);
  if (link !== '' && (!/^https?:\/\//.test(link) || link.length > LINK_MAX)) add({ field: 'link', code: 'bad_value' });
  return link;
}

function softwareSection(data) {
  const errors = [];
  const items = listOf(data.items, 'items', {}, errors, LIMITS.list, objectItem(['name', 'link'], (o, add) => {
    const name = shortOf(o, 'name', add);
    if (name === '') add({ field: 'name', code: 'required' });
    return { name, link: linkOf(o, add) };
  }));
  return { value: { items }, errors };
}

function policiesSection(data) {
  const errors = [];
  const keys = ['name', 'maxPoints', ...GRADING_RANGES, ...GRADING_CRITERIA];
  const grading = listOf(data.grading, 'grading', {}, errors, LIMITS.list, objectItem(keys, (o, add) => {
    const row = { name: shortOf(o, 'name', add) };
    if (row.name === '') add({ field: 'name', code: 'required' });
    row.maxPoints = ranged(o.maxPoints, 0, 100, add, 'maxPoints');
    for (const key of GRADING_RANGES) row[key] = shortOf(o, key, add);
    for (const key of GRADING_CRITERIA) row[key] = longOf(o, key, add);
    return row;
  }));
  const behavior = listOf(data.behavior, 'behavior', {}, errors, LIMITS.list, stringItem(LIMITS.text));
  const ethics = listOf(data.ethics, 'ethics', {}, errors, LIMITS.list, stringItem(LIMITS.text));
  const add = (e) => errors.push(e);
  const sanctionBehavior = shortOf(data, 'sanctionBehavior', add);
  const sanctionEthics = shortOf(data, 'sanctionEthics', add);
  return { value: { grading, behavior, ethics, sanctionBehavior, sanctionEthics }, errors };
}

function unitsSection(data) {
  const errors = [];
  const seen = new Set();
  const keys = ['unit', 'description', 'questions', 'guidance', 'results', 'literature'];
  const units = listOf(data.units, 'units', {}, errors, LIMITS.units, objectItem(keys, (o, add) => {
    const unit = ranged(o.unit, 1, LIMITS.units, add, 'unit');
    if (unit === null && blank(o.unit)) add({ field: 'unit', code: 'required' });
    else if (unit !== null && seen.has(unit)) add({ field: 'unit', code: 'duplicate' });
    if (unit !== null) seen.add(unit);
    const row = { unit };
    for (const key of ['description', 'questions', 'guidance', 'results']) row[key] = longOf(o, key, add);
    row.literature = listOf(o.literature, 'literature', { unit }, errors, LIMITS.list, bookItem(true));
    return row;
  }));
  return { value: { units }, errors };
}

function orderSection(data) {
  const errors = [];
  const seen = new Set();
  const order = listOf(data.order, 'order', {}, errors, LIMITS.planRows, (item, add) => {
    const id = plainId(item);
    if (id === null) {
      add({ field: 'id', code: 'bad_value' });
      return undefined;
    }
    if (seen.has(id)) {
      add({ field: 'id', code: 'duplicate' });
      return undefined;
    }
    seen.add(id);
    return id;
  });
  return { value: { order }, errors };
}

const CHECKS = {
  title: titleSection, goals: goalsSection, plan: planSection, selfWork: selfWorkSection, literature: literatureSection,
  software: softwareSection, policies: policiesSection, units: unitsSection, order: orderSection,
};

export function checkSection(section, data, ctx = {}) {
  if (typeof section !== 'string' || !Object.prototype.hasOwnProperty.call(CHECKS, section)) {
    return { value: null, errors: [{ field: 'section', code: 'bad_value' }] };
  }
  if (!isObject(data)) return { value: null, errors: [{ field: 'data', code: 'bad_value' }] };
  return CHECKS[section](data, ctx || {});
}

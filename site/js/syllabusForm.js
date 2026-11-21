// The syllabus form (#/syllabus-form/<version>/<tab>) without the DOM: the tabs, list editing, what a section sends
// to syllabus.saveSection, the errors of the server by field, the numbers of the lessons before they are saved.

export const TABS = ['title', 'goals', 'plan', 'selfWork', 'literature', 'software', 'policies', 'units', 'order'];

// The kinds of lessons of a unit, in the order of its tables.
export const PLAN_KINDS = ['lecture', 'practice', 'seminar', 'lab', 'control'];

// The tab of an address; an empty or unknown part opens the title page.
export function tabOf(part) {
  return TABS.includes(part) ? part : 'title';
}

export function listAdd(list, item) {
  return [...list, item];
}

export function listRemove(list, index) {
  return list.filter((_, i) => i !== index);
}

// step -1 moves the item up, 1 down; past the edge the list comes back unchanged (as a copy).
export function listMove(list, index, step) {
  const out = [...list];
  const to = index + step;
  if (index < 0 || index >= out.length || to < 0 || to >= out.length) return out;
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

const BOOK = ['authors', 'title', 'year', 'publisher', 'availability'];
const GRADING = ['name', 'maxPoints', 'rangeFail', 'rangeFair', 'rangeGood', 'rangeExcellent', 'criteriaFail', 'criteriaFair', 'criteriaGood', 'criteriaExcellent'];
const NUMBERS = new Set(['unit', 'hours', 'maxPoints']);

const blankItem = (keys) => Object.fromEntries(keys.map((key) => [key, NUMBERS.has(key) ? null : '']));

// A new empty item of a list of the form.
export function emptyItem(kind) {
  switch (kind) {
    case 'lesson': return { id: '', name: '', hours: 2, controlForms: '', selfHours: null, description: '' };
    case 'control': return { id: '', name: '', hours: 0, controlForms: '', selfHours: null, description: '' };
    case 'unit': return { title: '', lecture: [], practice: [], seminar: [], lab: [], control: [] };
    case 'book': return blankItem(BOOK);
    case 'selfWork': return blankItem(['unit', 'name', 'tasks', 'hours']);
    case 'software': return blankItem(['name', 'link']);
    case 'grading': return blankItem(GRADING);
    default: return '';
  }
}

const isBlank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
// A row nobody filled in: a blank text, or an object whose every field is blank.
const blankRow = (row) => (row !== null && typeof row === 'object' ? Object.values(row).every(isBlank) : isBlank(row));
const filled = (list) => (Array.isArray(list) ? list.filter((row) => !blankRow(row)) : list);

// The section without the rows nobody filled in (the form never sends them: the server would name an empty book
// `required`, and the places of its errors would not be the places on the screen). Lessons of the plan always stay:
// a lesson without a name is a mistake the server names at its field. Nothing dropped: the same object back.
export function withoutBlankRows(section, value) {
  if (!value || typeof value !== 'object') return value;
  const lists = {
    goals: ['knowledge', 'skill', 'attitude', 'prerequisite', 'postrequisite'],
    selfWork: ['items'], literature: ['main', 'extra'], software: ['items'], policies: ['grading', 'behavior', 'ethics'],
  }[section] || [];
  let out = value;
  for (const key of lists) {
    if (Array.isArray(value[key]) && value[key].some(blankRow)) out = { ...out, [key]: filled(value[key]) };
  }
  if (section === 'units' && Array.isArray(value.units) && value.units.some((u) => Array.isArray(u.literature) && u.literature.some(blankRow))) {
    out = { ...out, units: value.units.map((u) => (Array.isArray(u.literature) ? { ...u, literature: filled(u.literature) } : u)) };
  }
  return out;
}

const without = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const copy = (value) => JSON.parse(JSON.stringify(value ?? null));

// What syllabus.saveSection gets for a section of the form's document: the section without the empty rows and without
// what the server counts itself (the number of a lesson, the number of a unit of the plan, the title of a unit description).
export function sectionData(section, doc) {
  const value = withoutBlankRows(section, doc ? doc[section] : null);
  if (section === 'plan') {
    return { units: ((value && value.units) || []).map((unit) => Object.fromEntries([['title', unit.title ?? ''],
      ...PLAN_KINDS.map((kind) => [kind, (unit[kind] || []).map((row) => without(row, ['number']))])])) };
  }
  if (section === 'units') return { units: ((value && value.units) || []).map((unit) => without(unit, ['title'])) };
  if (section === 'order') return { order: ((doc && doc.lessons) || []).map((lesson) => lesson.id) };
  return copy(value) ?? {};
}

// The section on the screen differs from the one last saved.
export function isDirty(section, doc, saved) {
  return JSON.stringify(sectionData(section, doc)) !== JSON.stringify(sectionData(section, saved));
}

// The errors of the server -> Map(key of the field -> code); the first error of a field wins. A key reads like its
// place: 'credits', 'knowledge' (the list as a whole), 'knowledge.2.text', 'u1.lecture.0.hours' (unit 1), 'units'.
// An error with no place (e.g. a lesson of no unit) gets the key ''.
export function errorMap(fields) {
  const out = new Map();
  for (const error of Array.isArray(fields) ? fields : []) {
    if (!error || typeof error !== 'object') continue;
    const parts = [];
    if (error.unit !== undefined && error.unit !== null) parts.push('u' + error.unit);
    if (error.list !== undefined) parts.push(error.list);
    if (error.index !== undefined) parts.push(error.index);
    if (error.field !== undefined) parts.push(error.field);
    const key = parts.join('.');
    if (!out.has(key)) out.set(key, error.code);
  }
  return out;
}

// The numbers of the lessons as the tables of the form stand (before saving): Map('<unit>.<kind>.<place>' -> number),
// one after another by kind through the units: Л1, Л2 in unit 1, Л3 in unit 2…
export function tableNumbers(units) {
  const counts = {};
  const out = new Map();
  (units || []).forEach((unit, u) => {
    for (const kind of PLAN_KINDS) {
      (unit[kind] || []).forEach((_, index) => {
        counts[kind] = (counts[kind] || 0) + 1;
        out.set(`${u + 1}.${kind}.${index}`, counts[kind]);
      });
    }
  });
  return out;
}

// The unit has at least one row in any of its tables.
export function unitHasContent(unit) {
  return PLAN_KINDS.some((kind) => Array.isArray(unit[kind]) && unit[kind].length > 0);
}

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
const BLANK_LISTS = {
  goals: ['knowledge', 'skill', 'attitude', 'prerequisite', 'postrequisite'],
  selfWork: ['items'], literature: ['main', 'extra'], software: ['items'], policies: ['grading', 'behavior', 'ethics'],
};

export function withoutBlankRows(section, value) {
  if (!value || typeof value !== 'object') return value;
  const lists = BLANK_LISTS[section] || [];
  let out = value;
  for (const key of lists) {
    if (Array.isArray(value[key]) && value[key].some(blankRow)) out = { ...out, [key]: filled(value[key]) };
  }
  if (section === 'units' && Array.isArray(value.units) && value.units.some((u) => Array.isArray(u.literature) && u.literature.some(blankRow))) {
    out = { ...out, units: value.units.map((u) => (Array.isArray(u.literature) ? { ...u, literature: filled(u.literature) } : u)) };
  }
  return out;
}

// The places on the screen of the server's errors: the form sends a section without its empty rows (and keeps them on
// the screen), so the index of a row in the list the server saw is turned back into the index of that row on the screen.
// value: the section as it stood on the screen when it was sent.
export function placeErrors(section, value, errors) {
  if (!Array.isArray(errors)) return [];
  if (!value || typeof value !== 'object') return errors;
  const lists = BLANK_LISTS[section] || [];
  const places = (list) => (Array.isArray(list) ? list.map((row, i) => (blankRow(row) ? -1 : i)).filter((i) => i >= 0) : []);
  return errors.map((error) => {
    if (!error || typeof error !== 'object' || error.list === undefined || typeof error.index !== 'number') return error;
    let list = null;
    if (section === 'units' && error.list === 'literature') list = ((value.units || []).find((u) => u.unit === error.unit) || {}).literature;
    else if (lists.includes(error.list)) list = value[error.list];
    const at = list ? places(list)[error.index] : undefined;
    return at === undefined ? error : { ...error, index: at };
  });
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

// The same value whatever the order of the keys of its objects (arrays keep their order).
export function sameValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key]));
}

// A description of a unit with nothing in it: typed and erased again it is no change (it is still sent: an emptied
// description must reach the server).
const blankUnit = (unit) => ['description', 'questions', 'guidance', 'results'].every((key) => isBlank(unit[key]))
  && !(Array.isArray(unit.literature) && unit.literature.length > 0);

// The section on the screen differs from the one last saved.
export function isDirty(section, doc, saved) {
  const of = (source) => {
    const data = sectionData(section, source);
    return section === 'units' ? { units: data.units.filter((unit) => !blankUnit(unit)) } : data;
  };
  return !sameValue(of(doc), of(saved));
}

// The key of an error on the screen. A key reads like its place: 'credits', 'knowledge' (the list as a whole),
// 'knowledge.2.text', 'u1.lecture.0.hours' (unit 1), 'units'. An error with no place (e.g. a lesson of no unit) gets
// a key of its own, '!<its place in the list>', so that every one of them is shown.
export function errorKeyOf(error, index) {
  const parts = [];
  if (error.unit !== undefined && error.unit !== null) parts.push('u' + error.unit);
  if (error.list !== undefined) parts.push(error.list);
  if (error.index !== undefined) parts.push(error.index);
  if (error.field !== undefined) parts.push(error.field);
  return parts.length > 0 ? parts.join('.') : '!' + index;
}

// The errors of the server -> Map(key of the field -> code); the first error of a field wins.
export function errorMap(fields) {
  const out = new Map();
  (Array.isArray(fields) ? fields : []).forEach((error, index) => {
    if (!error || typeof error !== 'object') return;
    const key = errorKeyOf(error, index);
    if (!out.has(key)) out.set(key, error.code);
  });
  return out;
}

// What the line beside «Сохранить» says: 'locked' | 'invalid' | 'error' | 'dirty' | 'saved' | 'clean'.
// status: what the last save of the tab ended with ({ kind }); errors: how many of its marks are still on the screen.
// «Исправьте отмеченные поля» stays only while a mark is left.
export function statusKind({ locked = false, status = null, errors = 0, dirty = false }) {
  if (locked) return 'locked';
  if (status && status.kind === 'invalid' && errors > 0) return 'invalid';
  if (status && status.kind === 'error') return 'error';
  if (dirty) return 'dirty';
  if (status && status.kind === 'saved') return 'saved';
  return 'clean';
}

// The errors of the form after a change of a list of a section: removing or moving rows takes the marks off the
// section (their keys name the places of rows, which are other rows now); adding a row at the end keeps them.
export function errorsAfterEdit(errors, section, edit) {
  if ((edit !== 'remove' && edit !== 'move') || !errors || !(section in errors)) return errors;
  const rest = { ...errors };
  delete rest[section];
  return rest;
}

// ---- «Порядок пар» ----

const PAIR_HOURS = 2;

// The pairs each lesson takes in the order of the list: [{ id, from, to }]; a lesson of 4 hours takes two (from 3,
// to 4), a control without hours none (from and to null: it is a mark on the last pair of its unit).
export function pairNumbers(lessons) {
  let next = 1;
  return (lessons || []).map((lesson) => {
    const count = Math.floor((typeof lesson.hours === 'number' ? lesson.hours : 0) / PAIR_HOURS);
    if (count <= 0) return { id: lesson.id, from: null, to: null };
    const from = next;
    next += count;
    return { id: lesson.id, from, to: next - 1 };
  });
}

const markOnly = (lesson) => lesson.lessonKind === 'control' && !(lesson.hours > 0);

// The lesson at `index` can go a step up (-1) or down (1): the neighbour that way is of the same unit, and the unit
// does not start with a control without hours afterwards (it is the mark on the last pair: the server refuses it).
export function canMove(lessons, index, step) {
  const list = lessons || [];
  const to = index + step;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length || list[to].unit !== list[index].unit) return false;
  const moved = listMove(list, index, step);
  const first = moved.find((lesson) => lesson.unit === list[index].unit);
  return !markOnly(first);
}

// A new list with the lesson moved; where it cannot go, the same order (as a copy).
export function moveLesson(lessons, index, step) {
  return canMove(lessons, index, step) ? listMove(lessons, index, step) : [...(lessons || [])];
}

// The lessons after the plan is saved, in the order the person set on «Порядок пар» and has not saved yet.
// unsaved: the lessons of the form before the save; saved: the lessons as last saved; fresh: those of the answer.
// Nothing moved by hand: the order of the answer. Otherwise each unit of the answer keeps its places: the places of
// the lessons the person had arranged take them in the person's order, a new lesson stays where the answer put it
// (the end of its unit), a removed one is gone. A unit that would start with a module without hours (the server
// refuses that order) keeps the order of the answer.
export function keptOrder(unsaved, saved, fresh) {
  const list = Array.isArray(fresh) ? fresh : [];
  const ids = (lessons) => (Array.isArray(lessons) ? lessons.map((lesson) => lesson.id) : []);
  if (!Array.isArray(unsaved) || sameValue(ids(unsaved), ids(saved))) return [...list];
  const place = new Map(unsaved.map((lesson, i) => [lesson.id, { i, unit: lesson.unit }]));
  const known = (lesson) => place.has(lesson.id) && place.get(lesson.id).unit === lesson.unit;
  const units = [...new Set(list.map((lesson) => lesson.unit))];
  return units.flatMap((unit) => {
    const own = list.filter((lesson) => lesson.unit === unit);
    const arranged = own.filter(known).sort((a, b) => place.get(a.id).i - place.get(b.id).i);
    const out = own.map((lesson) => (known(lesson) ? arranged.shift() : lesson));
    return markOnly(out[0]) && !markOnly(own[0]) ? own : out;
  });
}

// What an answer of syllabus.submit means: 'sent'; 'checks' — not sent, the list says what to fix; 'failed' — not
// sent and nothing to fix (the form says so instead of closing silently).
export function submitOutcome(result) {
  if (result && result.submitted === true) return 'sent';
  const errors = result && result.checks && Array.isArray(result.checks.errors) ? result.checks.errors : [];
  return errors.length > 0 ? 'checks' : 'failed';
}

// ---- The checks before submitting (syllabus.submit with dryRun) ----

// { errors, warnings } -> Map(tab -> { errors, warnings }) with the numbers, in the order of the tabs; the tab of
// a check is its section.
export function checkTabs(checks) {
  const counts = new Map();
  const count = (list, kind) => {
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.section !== 'string') continue;
      if (!counts.has(item.section)) counts.set(item.section, { errors: 0, warnings: 0 });
      counts.get(item.section)[kind] += 1;
    }
  };
  count(checks && checks.errors, 'errors');
  count(checks && checks.warnings, 'warnings');
  const rank = (tab) => (TABS.includes(tab) ? TABS.indexOf(tab) : TABS.length);
  return new Map([...counts].sort((a, b) => rank(a[0]) - rank(b[0])));
}

// An error or a warning of the checks -> { key, params } for t(): with a field 'sform.checks.<section>.<field>.<code>'
// when has(key) says the dictionary holds it, else 'sform.checks.<section>.<field>'; without a field
// 'sform.checks.<section>.<code>'. params: the topic (name), the date of its held pair (as the server gives it), the
// hours held, the unit and the number of a row (n, from 1), the course and its two semesters (a, b), the groups.
export function checkLine(item, has = () => false) {
  const known = typeof has === 'function' ? has : () => false;
  let key = `sform.checks.${item.section}.${item.code}`;
  if (item.field) {
    const withCode = `sform.checks.${item.section}.${item.field}.${item.code}`;
    key = known(withCode) ? withCode : `sform.checks.${item.section}.${item.field}`;
  }
  const course = Number.isInteger(item.course) ? item.course : undefined;
  return {
    key,
    params: {
      name: item.name, date: item.date, held: item.held, unit: item.unit, n: typeof item.index === 'number' ? item.index + 1 : undefined,
      course, a: course === undefined ? undefined : course * 2 - 1, b: course === undefined ? undefined : course * 2,
      groups: Array.isArray(item.groups) ? item.groups.join(', ') : undefined,
    },
  };
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

const ABOUT_FIELDS = ['description', 'questions', 'guidance', 'results'];

// What the tab «Описание юнитов» holds for unit n (units: doc.units): the plan saved without the unit removes it too.
// -> { texts: a filled description, key questions, guidance or results; books: the number of its books }
export function unitAbout(units, n) {
  const entry = ((units && units.units) || []).find((u) => u.unit === n);
  if (!entry) return { texts: false, books: 0 };
  return {
    texts: ABOUT_FIELDS.some((f) => typeof entry[f] === 'string' && entry[f].trim() !== ''),
    books: Array.isArray(entry.literature) ? entry.literature.length : 0,
  };
}

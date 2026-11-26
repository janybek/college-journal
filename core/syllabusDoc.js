// The document of one syllabus version: built from the rows of the section sheets, and the writes a saved section gives.
// Pure functions: no storage, no platform.
import { SECTION_TABLES } from './syllabusSections.js';
import { lessonNumbers, orderWrites, planWrites } from './syllabusPlan.js';

export const DOC_TABLES = ['topics', 'units', 'outcomes', 'selfWork', 'literature', 'software', 'grading', 'rules'];

const TITLE_FIELDS = ['department', 'faculty', 'academicYear', 'course', 'planSemester', 'credits', 'audience', 'totalHours', 'classHours', 'selfHours', 'contacts', 'place'];
const TITLE_NUMBERS = ['course', 'planSemester', 'credits', 'totalHours', 'classHours', 'selfHours'];
const OUTCOME_KINDS = ['knowledge', 'skill', 'attitude', 'prerequisite', 'postrequisite'];
const BOOK_FIELDS = ['authors', 'title', 'year', 'publisher', 'availability'];
const GRADING_FIELDS = ['name', 'maxPoints', 'rangeFail', 'rangeFair', 'rangeGood', 'rangeExcellent', 'criteriaFail', 'criteriaFair', 'criteriaGood', 'criteriaExcellent'];
const PLAN_LISTS = ['lecture', 'practice', 'seminar', 'lab', 'control'];
const UNIT_FIELDS = ['description', 'questions', 'guidance', 'results'];

const keyOf = (table) => (table === 'units' ? 'unit' : 'order');
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const isUnit = (u) => Number.isInteger(u) && u >= 1;
const noUnit = (v) => v === undefined || v === null || v === '';
const orNull = (v) => (v === undefined || v === null || v === '' ? null : v);
const text = (v) => (v === undefined || v === null ? '' : v);
const same = (a, b) => (a === undefined || a === null ? '' : a) === (b === undefined || b === null ? '' : b);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

export function rowsOfVersion(tables, syllabusId) {
  const out = {};
  for (const name of DOC_TABLES) {
    const key = keyOf(name);
    out[name] = ((tables && tables[name]) || []).filter((r) => r.syllabusId === syllabusId).sort((a, b) => num(a[key]) - num(b[key]));
  }
  return out;
}

const bookOf = (b) => ({ authors: text(b.authors), title: text(b.title), year: text(b.year), publisher: text(b.publisher), availability: text(b.availability) });

export function buildDoc(version, rows) {
  const topics = rows.topics || [];
  const unitRows = rows.units || [];
  const numbers = lessonNumbers(topics);
  const known = new Set([...unitRows, ...topics].map((r) => r.unit).filter(isUnit));
  const top = Math.max(0, ...known);
  const texts = (kind) => (rows.outcomes || []).filter((o) => o.kind === kind).map((o) => text(o.text));
  const ruleTexts = (kind) => (rows.rules || []).filter((r) => r.kind === kind).map((r) => text(r.text));
  const books = (list) => list.map(bookOf);
  const course = (rows.literature || []).filter((b) => noUnit(b.unit));

  const plan = { manualOrder: version.manualOrder === true, units: [] };
  for (let unit = 1; unit <= top; unit++) {
    const own = topics.filter((t) => t.unit === unit);
    const entry = { unit, title: text(unitRows.find((u) => u.unit === unit)?.title) };
    for (const kind of PLAN_LISTS) {
      entry[kind] = own.filter((t) => t.lessonKind === kind).map((t) => ({
        id: t.id, name: text(t.name), hours: orNull(t.hours), controlForms: text(t.controlForms), selfHours: orNull(t.selfHours),
        description: text(t.description), number: numbers.get(t.id),
      }));
    }
    plan.units.push(entry);
  }

  return {
    title: Object.fromEntries(TITLE_FIELDS.map((f) => [f, TITLE_NUMBERS.includes(f) ? orNull(version[f]) : text(version[f])])),
    goals: { goal: text(version.goal), ...Object.fromEntries(OUTCOME_KINDS.map((k) => [k, texts(k)])) },
    plan,
    lessons: topics.map((t) => ({ id: t.id, unit: t.unit, lessonKind: t.lessonKind, number: numbers.get(t.id), name: text(t.name), hours: orNull(t.hours) })),
    selfWork: { items: (rows.selfWork || []).map((s) => ({ unit: orNull(s.unit), name: text(s.name), tasks: text(s.tasks), hours: orNull(s.hours) })) },
    literature: { main: books(course.filter((b) => b.kind === 'main')), extra: books(course.filter((b) => b.kind === 'extra')) },
    software: { items: (rows.software || []).map((s) => ({ name: text(s.name), link: text(s.link) })) },
    policies: {
      grading: (rows.grading || []).map((g) => Object.fromEntries(GRADING_FIELDS.map((f) => [f, f === 'maxPoints' ? orNull(g[f]) : text(g[f])]))),
      behavior: ruleTexts('behavior'),
      ethics: ruleTexts('ethics'),
      sanctionBehavior: ruleTexts('sanction_behavior')[0] || '',
      sanctionEthics: ruleTexts('sanction_ethics')[0] || '',
    },
    units: {
      units: [...known].sort((a, b) => a - b).map((unit) => {
        const row = unitRows.find((u) => u.unit === unit) || {};
        return {
          unit, title: text(row.title), ...Object.fromEntries(UNIT_FIELDS.map((f) => [f, text(row[f])])),
          literature: books((rows.literature || []).filter((b) => b.unit === unit)),
        };
      }),
    },
  };
}

// ---- writes of a saved section ----

const emptyTable = () => ({ insert: [], update: [], remove: [] });

// A list written in place: the i-th stored row is updated if it changed, the extra ones are removed, the new ones are added.
function listWrites(stored, wanted, syllabusId) {
  const out = emptyTable();
  wanted.forEach((w, i) => {
    const old = stored[i];
    if (!old) {
      out.insert.push({ syllabusId, ...w });
      return;
    }
    const patch = {};
    for (const f of Object.keys(w)) if (!same(old[f], w[f])) patch[f] = w[f];
    if (Object.keys(patch).length) out.update.push({ id: old.id, patch });
  });
  for (const old of stored.slice(wanted.length)) out.remove.push(old.id);
  return out;
}

function join(target, part) {
  target.insert.push(...part.insert);
  target.update.push(...part.update);
  target.remove.push(...part.remove);
}

const bookRow = (b, i, kind, unit) => ({ kind, unit, order: i + 1, ...bookOf(b) });

function titlePatch(value, version) {
  const patch = {};
  for (const f of TITLE_FIELDS) if (!same(version[f], value[f])) patch[f] = value[f];
  return patch;
}

export function sectionWrites(section, value, version, rows) {
  const tables = Object.fromEntries((SECTION_TABLES[section] || []).map((name) => [name, emptyTable()]));
  const fail = (errors) => ({ errors, syllabus: null, tables: Object.fromEntries(Object.keys(tables).map((n) => [n, emptyTable()])) });
  if (!Object.prototype.hasOwnProperty.call(SECTION_TABLES, section) || !value || typeof value !== 'object') return fail([{ field: 'section', code: 'bad_value' }]);
  const id = version.id;
  let patch = {};

  if (section === 'title') {
    patch = titlePatch(value, version);
  } else if (section === 'goals') {
    if (!same(version.goal, value.goal)) patch.goal = value.goal;
    for (const kind of OUTCOME_KINDS) {
      const stored = rows.outcomes.filter((o) => o.kind === kind);
      join(tables.outcomes, listWrites(stored, (value[kind] || []).map((t, i) => ({ kind, order: i + 1, text: t })), id));
    }
  } else if (section === 'plan') {
    const lost = rows.topics.filter((t) => !isUnit(t.unit));
    if (lost.length) return fail(lost.map((t) => ({ code: 'bad_unit', id: t.id, name: text(t.name) })));
    const w = planWrites(value, rows.topics, version.manualOrder === true);
    if (w.errors.length) return fail(w.errors);
    tables.topics.insert = w.insert.map((r) => ({ syllabusId: id, ...r }));
    tables.topics.update = w.update;
    tables.topics.remove = w.remove;
    const count = w.units.length;
    for (const { unit, title } of w.units) {
      const old = rows.units.find((u) => u.unit === unit);
      if (old) {
        if (!same(old.title, title)) tables.units.update.push({ id: old.id, patch: { title } });
      } else if (title !== '') {
        tables.units.insert.push({ syllabusId: id, unit, title, description: '', questions: '', guidance: '', results: '' });
      }
    }
    const gone = rows.units.filter((u) => !(isUnit(u.unit) && u.unit <= count));
    tables.units.remove = gone.map((u) => u.id);
    const goneUnits = new Set(gone.map((u) => u.unit));
    tables.literature.remove = rows.literature.filter((b) => goneUnits.has(b.unit)).map((b) => b.id);
  } else if (section === 'order') {
    const w = orderWrites(value.order, rows.topics);
    if (w.errors.length) return fail(w.errors);
    tables.topics.update = w.update;
    if (version.manualOrder !== true) patch.manualOrder = true;
  } else if (section === 'selfWork') {
    const wanted = (value.items || []).map((s, i) => ({ order: i + 1, unit: s.unit, name: s.name, tasks: s.tasks, hours: s.hours }));
    join(tables.selfWork, listWrites(rows.selfWork, wanted, id));
  } else if (section === 'literature') {
    const course = rows.literature.filter((b) => noUnit(b.unit));
    for (const kind of ['main', 'extra']) {
      const stored = course.filter((b) => b.kind === kind);
      join(tables.literature, listWrites(stored, (value[kind] || []).map((b, i) => bookRow(b, i, kind, null)), id));
    }
  } else if (section === 'software') {
    join(tables.software, listWrites(rows.software, (value.items || []).map((s, i) => ({ order: i + 1, name: s.name, link: s.link })), id));
  } else if (section === 'policies') {
    join(tables.grading, listWrites(rows.grading, (value.grading || []).map((g, i) => ({ order: i + 1, ...pick(g, GRADING_FIELDS) })), id));
    const lists = { behavior: value.behavior || [], ethics: value.ethics || [],
      sanction_behavior: value.sanctionBehavior ? [value.sanctionBehavior] : [], sanction_ethics: value.sanctionEthics ? [value.sanctionEthics] : [] };
    for (const [kind, items] of Object.entries(lists)) {
      join(tables.rules, listWrites(rows.rules.filter((r) => r.kind === kind), items.map((t, i) => ({ kind, order: i + 1, text: t })), id));
    }
  } else if (section === 'units') {
    const known = new Set([...rows.units, ...rows.topics].map((r) => r.unit).filter(isUnit));
    const errors = [];
    const seen = new Set();
    (value.units || []).forEach((u, index) => {
      if (!known.has(u.unit)) errors.push({ list: 'units', index, field: 'unit', code: 'bad_ref' });
      else if (seen.has(u.unit)) errors.push({ list: 'units', index, field: 'unit', code: 'duplicate' });
      seen.add(u.unit);
    });
    if (errors.length) return fail(errors);
    for (const u of value.units || []) {
      const fields = pick(u, UNIT_FIELDS);
      const old = rows.units.find((r) => r.unit === u.unit);
      if (old) {
        const p = {};
        for (const f of UNIT_FIELDS) if (!same(old[f], fields[f])) p[f] = fields[f];
        if (Object.keys(p).length) tables.units.update.push({ id: old.id, patch: p });
      } else if (UNIT_FIELDS.some((f) => fields[f] !== '')) {
        tables.units.insert.push({ syllabusId: id, unit: u.unit, title: '', ...fields });
      }
      const stored = rows.literature.filter((b) => b.unit === u.unit);
      join(tables.literature, listWrites(stored, (u.literature || []).map((b, i) => bookRow(b, i, 'main', u.unit)), id));
    }
  }

  return { errors: [], syllabus: Object.keys(patch).length ? patch : null, tables };
}

// The rows of an approved version -> the rows of a new version (no ids, no version id); a topic remembers the row it was copied from.
export function copyRows(rows) {
  const out = {};
  for (const name of DOC_TABLES) {
    out[name] = (rows[name] || []).map(({ id, syllabusId, ...rest }) => (name === 'topics' ? { ...rest, sourceId: id } : rest));
  }
  return out;
}

const COPIED = [...TITLE_FIELDS, 'goal'];

// The row of a new version of a key. With an approved version it is a copy of its title and goal; without — the plan semester and course given.
// line: the line of the version (its discipline and half of the year); teacherId: the author of the version.
export function draftVersion({ line, half, teacherId, approved, planSemester, course, userId, today, number }) {
  const row = {
    disciplineId: line.disciplineId, teacherId, semester: half ?? line.semester, lineId: line.id, sourceId: approved ? approved.id : '',
    status: 'draft', version: number, remark: '', submittedBy: '', submittedAt: '', decidedBy: '', decidedAt: '', editedBy: userId, updated: today,
  };
  const source = approved || {};
  for (const f of COPIED) row[f] = TITLE_NUMBERS.includes(f) ? orNull(source[f]) : text(source[f]);
  row.manualOrder = approved ? approved.manualOrder === true : false;
  row.fileId = approved ? (approved.fileId || '') : '';
  if (!approved) {
    row.planSemester = planSemester ?? null;
    row.course = course ?? null;
  }
  return row;
}

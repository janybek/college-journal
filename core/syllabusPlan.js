// Порядок пар, номера занятий, записи плана и занятия из файла. Чистые функции без обращений к платформе.
import { semesterHalf } from './syllabus.js';

const ALTERNATING = ['lecture', 'practice', 'seminar', 'lab'];
const KNOWN = new Set([...ALTERNATING, 'control']);
const UNKNOWN = 'unknown';
const kindKey = (kind) => (KNOWN.has(kind) ? kind : UNKNOWN);

// Занятия одного юнита по спискам видов (каждый список уже в нужном порядке): i-я лекция, i-я практика, i-й семинар,
// i-я лабораторная, затем весь контроль, затем занятия неизвестного вида (они не пропадают: каждое остаётся в конце своего юнита).
function interleave(lists) {
  const out = [];
  const longest = Math.max(0, ...ALTERNATING.map((k) => (lists[k] || []).length));
  for (let i = 0; i < longest; i++) {
    for (const kind of ALTERNATING) if (i < (lists[kind] || []).length) out.push(lists[kind][i]);
  }
  out.push(...(lists.control || []));
  out.push(...(lists[UNKNOWN] || []));
  return out;
}

const byOrder = (a, b) => a.order - b.order;

export function autoOrder(rows) {
  const units = new Map();
  for (const r of [...rows].sort(byOrder)) {
    if (!units.has(r.unit)) units.set(r.unit, {});
    const lists = units.get(r.unit);
    (lists[kindKey(r.lessonKind)] ||= []).push(r.id);
  }
  return [...units.keys()].sort((a, b) => a - b).flatMap((u) => interleave(units.get(u)));
}

export function lessonNumbers(rows) {
  const counts = {};
  const numbers = new Map();
  for (const r of [...rows].sort(byOrder)) {
    counts[r.lessonKind] = (counts[r.lessonKind] || 0) + 1;
    numbers.set(r.id, counts[r.lessonKind]);
  }
  return numbers;
}

const FIELDS = ['unit', 'lessonKind', 'name', 'hours', 'controlForms', 'selfHours', 'description', 'unitTitle'];

export function planWrites(value, stored, manualOrder) {
  const errors = [];
  const byId = new Map(stored.map((r) => [r.id, r]));
  const seen = new Set();
  const wanted = []; // { unit, lessonKind, item, title, old }
  const units = [];
  value.units.forEach((u, i) => {
    const unit = i + 1;
    const title = u.title ?? '';
    units.push({ unit, title });
    for (const kind of [...ALTERNATING, 'control']) {
      (u[kind] || []).forEach((item, index) => {
        const id = item.id || '';
        let old = null;
        if (id !== '') {
          if (!byId.has(id)) errors.push({ unit, list: kind, index, field: 'id', code: 'bad_ref' });
          else if (seen.has(id)) errors.push({ unit, list: kind, index, field: 'id', code: 'duplicate' });
          else { seen.add(id); old = byId.get(id); }
        }
        wanted.push({ unit, lessonKind: kind, item, title, old });
      });
    }
  });
  // Строка неизвестного вида, которой нет в запросе, не пропадает: она остаётся в конце своего юнита (если юнита больше нет — ошибка).
  const kept = stored.filter((r) => !seen.has(r.id) && !KNOWN.has(r.lessonKind));
  for (const r of kept) {
    if (!units.some((u) => u.unit === r.unit)) errors.push({ unit: r.unit, list: r.lessonKind, field: 'id', code: 'unknown_kind', id: r.id });
    else seen.add(r.id);
  }
  if (errors.length) return { errors, insert: [], update: [], remove: [], units: [] };

  const ordered = [];
  for (const { unit, title } of units) {
    const mine = wanted.filter((w) => w.unit === unit);
    const lists = {};
    if (!manualOrder) {
      for (const w of mine) (lists[kindKey(w.lessonKind)] ||= []).push(w);
      ordered.push(...interleave(lists));
    } else {
      // «места»: прежний порядок строк, оставшихся в этом юните с тем же видом
      const placed = mine.filter((w) => w.old && w.old.unit === unit && w.old.lessonKind === w.lessonKind);
      const slots = placed.map((w) => w.old).sort(byOrder).map((r) => r.lessonKind);
      const queues = {};
      for (const w of placed) (queues[w.lessonKind] ||= []).push(w);
      ordered.push(...slots.map((kind) => queues[kind].shift()));
      for (const w of mine) if (!placed.includes(w)) (lists[kindKey(w.lessonKind)] ||= []).push(w);
      ordered.push(...interleave(lists));
    }
    for (const r of kept.filter((k) => k.unit === unit)) ordered.push({ unit, lessonKind: r.lessonKind, item: r, title, old: r });
  }

  const insert = [];
  const update = [];
  ordered.forEach((w, i) => {
    const next = {
      order: i + 1, unit: w.unit, lessonKind: w.lessonKind, name: w.item.name ?? '', hours: w.item.hours,
      controlForms: w.item.controlForms ?? '', selfHours: w.item.selfHours ?? null, description: w.item.description ?? '', unitTitle: w.title,
    };
    if (!w.old) {
      insert.push({ ...next, sourceId: '' });
      return;
    }
    const patch = {};
    for (const f of ['order', ...FIELDS]) if (w.old[f] !== next[f]) patch[f] = next[f];
    if (Object.keys(patch).length) update.push({ id: w.old.id, patch });
  });
  const remove = stored.filter((r) => !seen.has(r.id)).map((r) => r.id);
  return { errors, insert, update, remove, units };
}

export function orderWrites(ids, stored) {
  const byId = new Map(stored.map((r) => [r.id, r]));
  const same = Array.isArray(ids) && ids.length === stored.length && new Set(ids).size === ids.length && ids.every((id) => byId.has(id));
  if (!same) return { errors: [{ field: 'order', code: 'bad_order' }], update: [] };
  let last = 0;
  let unitOrder = false;
  let controlFirst = false;
  const started = new Set();
  for (const id of ids) {
    const r = byId.get(id);
    if (r.unit < last) unitOrder = true;
    last = Math.max(last, r.unit);
    if (!started.has(r.unit)) {
      started.add(r.unit);
      if (r.lessonKind === 'control' && !(r.hours > 0)) controlFirst = true;
    }
  }
  const errors = [];
  if (unitOrder) errors.push({ field: 'order', code: 'unit_order' });
  if (controlFirst) errors.push({ field: 'order', code: 'control_first' });
  if (errors.length) return { errors, update: [] };
  const update = [];
  ids.forEach((id, i) => {
    if (byId.get(id).order !== i + 1) update.push({ id, patch: { order: i + 1 } });
  });
  return { errors, update };
}

export function splitRow(row) {
  const first = { selfHours: row.selfHours ?? null, description: row.description ?? '' };
  const rest = { selfHours: null, description: '' };
  if (row.kind === 'control') return [{ lessonKind: 'control', hours: row.practiceHours, ...first }];
  const out = [];
  if (row.lectureHours > 0) out.push({ lessonKind: 'lecture', hours: row.lectureHours });
  if (row.practiceHours > 0) out.push({ lessonKind: row.practiceKind || 'practice', hours: row.practiceHours });
  return out.map((l, i) => ({ ...l, ...(i === 0 ? first : rest) }));
}

export function docLessons(doc) {
  const halves = [...new Set(doc.rows.map((r) => r.semester))].sort((a, b) => a - b);
  return halves.map((planSemester) => {
    const rows = doc.rows.filter((r) => r.semester === planSemester);
    const titles = new Map();
    let top = 0;
    for (const r of rows) {
      top = Math.max(top, r.unit);
      if (r.unitTitle && !titles.get(r.unit)) titles.set(r.unit, r.unitTitle);
    }
    const units = Array.from({ length: top }, (_, i) => ({ unit: i + 1, title: titles.get(i + 1) || '' }));
    const lessons = rows.flatMap((r) => splitRow(r).map((l) => ({
      unit: r.unit, unitTitle: titles.get(r.unit) || '', lessonKind: l.lessonKind, name: r.name, hours: l.hours, controlForms: '',
      selfHours: l.selfHours, description: l.description, row: r.row,
    })));
    return { semester: semesterHalf(planSemester), planSemester, units, rows: lessons };
  });
}

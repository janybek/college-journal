import fs from 'node:fs';
import crypto from 'node:crypto';
import { splitRow } from '../core/syllabusPlan.js';

// Carries a stand data file written before addendum 3 over to the new shape. Node only.
// The file is read as plain JSON before any store exists: the store does not hand out the old row fields.

const OLD_KEYS = ['label', 'lectureHours', 'practiceHours', 'practiceKind', 'kind'];
const isOldRow = (row) => 'lectureHours' in row || 'practiceHours' in row || 'kind' in row;
const isOldSyllabus = (s) => !s.status;

// data: { syllabi, topics, pairs, units, ... } changed in place; newId(prefix, takenSet) -> a new id.
export function upgradeData(data, newId) {
  const report = { changed: false, versions: 0, split: 0, units: 0, skipped: [], zeroHours: [] };
  const syllabi = data.syllabi || [];
  const migrated = new Set();
  for (const s of syllabi) {
    if (!isOldSyllabus(s)) continue;
    s.status = 'approved';
    s.version = 1;
    s.manualOrder = true;
    migrated.add(s.id);
    report.versions++;
  }

  const topics = data.topics || [];
  const taken = new Set(topics.map((t) => t.id));
  const touched = new Set(migrated);
  const secondOf = new Map();           // old row id -> id of its practice row
  const expanded = [];
  let converted = false;
  const position = new Map();           // row -> [old order, sequence]: second rows keep the order of the first
  for (const row of topics) {
    if (!isOldRow(row)) { expanded.push(row); continue; }
    touched.add(row.syllabusId);
    converted = true;
    let lessons = splitRow(row);
    if (!lessons.length) {
      lessons = [{ lessonKind: 'lecture', hours: 0, selfHours: row.selfHours ?? null, description: row.description ?? '' }];
      if (row.kind !== 'control') report.zeroHours.push(row.id);
    }
    const rest = { ...row };
    for (const key of OLD_KEYS) delete rest[key];
    lessons.forEach((l, i) => {
      const out = { ...rest, lessonKind: l.lessonKind, hours: l.hours ?? 0, controlForms: '', selfHours: l.selfHours, description: l.description, sourceId: '' };
      if (i === 0) {
        for (const key of OLD_KEYS) delete row[key];
        Object.assign(row, out);
        expanded.push(row);
      } else {
        out.id = newId('tp', taken);
        taken.add(out.id);
        secondOf.set(row.id, out.id);
        position.set(out, row.order);
        expanded.push(out);
        report.split++;
      }
    });
  }
  if (secondOf.size && data.pairs) {
    for (const p of data.pairs) {
      if (p.lessonType === 'practice' && secondOf.has(p.topicId)) p.topicId = secondOf.get(p.topicId);
    }
  }

  // Orders 1, 2, 3... per touched version, in the former sequence; a row that was not carried over is named.
  let orderChanged = false;
  for (const id of touched) {
    const rows = expanded.map((r, i) => ({ r, i })).filter((x) => x.r.syllabusId === id);
    rows.sort((a, b) => ((position.has(a.r) ? position.get(a.r) : a.r.order) - (position.has(b.r) ? position.get(b.r) : b.r.order)) || a.i - b.i);
    rows.forEach(({ r }, n) => {
      if (r.order !== n + 1) { r.order = n + 1; orderChanged = true; }
      if (!r.lessonKind) report.skipped.push(r.id);
    });
  }
  topics.splice(0, topics.length, ...expanded);

  // Units of the versions carried over now: 1..the greatest unit number, the title from the first non-empty unitTitle.
  for (const id of migrated) {
    data.units = data.units || [];
    if (data.units.some((u) => u.syllabusId === id)) continue;
    const rows = topics.filter((t) => t.syllabusId === id);
    const top = rows.reduce((m, t) => Math.max(m, Number(t.unit) || 0), 0);
    const unitsTaken = new Set(data.units.map((u) => u.id));
    for (let n = 1; n <= top; n++) {
      const title = (rows.find((t) => t.unit === n && t.unitTitle) || {}).unitTitle || '';
      const unitId = newId('un', unitsTaken);
      unitsTaken.add(unitId);
      data.units.push({ id: unitId, syllabusId: id, unit: n, title, description: '', questions: '', guidance: '', results: '' });
      report.units++;
    }
  }

  report.changed = report.versions > 0 || report.split > 0 || report.units > 0 || orderChanged || converted;
  return report;
}

const randomId = (prefix, taken) => {
  let id;
  do id = `${prefix}_${crypto.randomBytes(4).toString('hex')}`; while (taken.has(id));
  return id;
};

// Reads the data file, carries it over and writes it back; before the first change a copy of the old file is put beside it (kept if it exists).
export function upgradeFile(dataPath) {
  const none = { changed: false, versions: 0, split: 0, units: 0, skipped: [], zeroHours: [] };
  if (!fs.existsSync(dataPath)) return none;
  const text = fs.readFileSync(dataPath, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = null;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error(`файл ${dataPath} повреждён, перенос не сделан, файл не тронут`);
  const report = upgradeData(data, randomId);
  if (!report.changed) return report;
  const copy = dataPath + '.before-addendum-3.bak';
  if (!fs.existsSync(copy)) fs.writeFileSync(copy, text, 'utf8');
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
  return report;
}

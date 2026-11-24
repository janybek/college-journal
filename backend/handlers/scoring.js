import { AppError } from '../../core/errors.js';
import { readSettings } from '../../core/settings.js';
import { FINAL_UNIT } from '../../core/ledger.js';
import { liveAttempts } from '../../core/exam.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT, readScheme, readSplit, validateScheme, validateSplit, schemeToRows, splitToRows } from '../../core/scoring.js';

function get(data, ctx) {
  const rows = ctx.store.list('settings');
  return { scheme: readScheme(rows), defaults: { ...DEFAULT_SCHEME }, split: readSplit(rows), splitDefaults: { ...DEFAULT_SPLIT } };
}

const PAIR_FIELDS = ['attendance', 'activity', 'current', 'self', 'control', 'minimum'];
const WORD_FIELDS = ['fair', 'good', 'excellent'];
const SPLIT_FIELDS = ['semester', 'exam', 'admission'];

// The closings of the half of the year in force: not reopened, closed since the semester began (without a start date, all of them).
function activeClosures(closures, semesterStart) {
  return closures.filter((c) => c.reopenedAt === '' && (semesterStart === '' || String(c.closedAt).slice(0, 10) >= semesterStart));
}

// The best exam score already entered of the subjects whose final sheet is still open (the live attempts of each student).
function highestExamScore(attempts, closures) {
  const shut = new Set(closures.filter((c) => c.reopenedAt === '' && c.unit === FINAL_UNIT).map((c) => c.subjectId + '|' + (c.planSemester ?? null)));
  const groups = new Map();
  for (const a of attempts) {
    const key = a.subjectId + '|' + (a.planSemester ?? null);
    if (shut.has(key)) continue;
    const id = key + '|' + a.studentId;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(a);
  }
  let best = null;
  for (const list of groups.values()) {
    for (const a of liveAttempts(list)) if (a.outcome === 'score' && Number.isInteger(a.score) && (best === null || a.score > best)) best = a.score;
  }
  return best;
}

// Updates the row of each key whose value changed, adds missing keys; one batch each.
// A request without `split` (the former site) leaves the three rows of the split as they are.
// Rows of the semester settings are not touched.
function save(data, ctx) {
  const { store } = ctx;
  const withSplit = data.split !== undefined;
  const { value, errors } = validateScheme(data.scheme);
  const checked = withSplit ? validateSplit(data.split) : null;
  const all = checked ? [...errors, ...checked.errors] : errors;
  const settings = store.list('settings');
  const closures = store.list('closures');
  const attempts = store.list('examAttempts');
  if (checked && checked.errors.length === 0) {
    const best = highestExamScore(attempts, closures);
    if (best !== null && best > checked.value.exam) all.push({ field: 'exam', code: 'too_small' });
  }
  if (all.length > 0) throw new AppError('invalid', { fields: all });
  const was = readScheme(settings);
  const wasSplit = readSplit(settings);
  const live = activeClosures(closures, readSettings(settings).semesterStart);
  const changed = (fields, a, b) => fields.some((f) => a[f] !== b[f]);
  if (changed(PAIR_FIELDS, was, value) && live.length > 0) throw new AppError('units_closed');
  const finalShut = live.some((c) => c.unit === FINAL_UNIT);
  if (finalShut && (changed(WORD_FIELDS, was, value) || (checked && changed(SPLIT_FIELDS, wasSplit, checked.value)))) throw new AppError('final_closed');
  const existing = new Map();
  for (const row of settings) if (!existing.has(row.key)) existing.set(row.key, row);
  const updates = [];
  const inserts = [];
  for (const { key, value: text } of [...schemeToRows(value), ...(checked ? splitToRows(checked.value) : [])]) {
    const row = existing.get(key);
    if (!row) inserts.push({ key, value: text });
    else if (row.value !== text) updates.push({ id: row.id, patch: { value: text } });
  }
  if (updates.length > 0) store.updateMany('settings', updates);
  if (inserts.length > 0) store.insertMany('settings', inserts);
  return { scheme: value, split: checked ? checked.value : readSplit(settings) };
}

export const scoringHandlers = {
  'scoring.get': get,
  'scoring.save': save,
};

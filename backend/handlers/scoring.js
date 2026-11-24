import { AppError } from '../../core/errors.js';
import { DEFAULT_SCHEME, DEFAULT_SPLIT, readScheme, readSplit, validateScheme, validateSplit, schemeToRows, splitToRows } from '../../core/scoring.js';

function get(data, ctx) {
  const rows = ctx.store.list('settings');
  return { scheme: readScheme(rows), defaults: { ...DEFAULT_SCHEME }, split: readSplit(rows), splitDefaults: { ...DEFAULT_SPLIT } };
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
  if (all.length > 0) throw new AppError('invalid', { fields: all });
  const settings = store.list('settings');
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

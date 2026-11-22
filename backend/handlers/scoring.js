import { AppError } from '../../core/errors.js';
import { DEFAULT_SCHEME, readScheme, validateScheme, schemeToRows } from '../../core/scoring.js';

function get(data, ctx) {
  return { scheme: readScheme(ctx.store.list('settings')), defaults: { ...DEFAULT_SCHEME } };
}

// Updates the row of each key whose value changed, adds missing keys; one batch each.
// Rows of the semester settings are not touched.
function save(data, ctx) {
  const { store } = ctx;
  const { value, errors } = validateScheme(data.scheme);
  if (errors.length > 0) throw new AppError('invalid', { fields: errors });
  const existing = new Map();
  for (const row of store.list('settings')) if (!existing.has(row.key)) existing.set(row.key, row);
  const updates = [];
  const inserts = [];
  for (const { key, value: text } of schemeToRows(value)) {
    const row = existing.get(key);
    if (!row) inserts.push({ key, value: text });
    else if (row.value !== text) updates.push({ id: row.id, patch: { value: text } });
  }
  if (updates.length > 0) store.updateMany('settings', updates);
  if (inserts.length > 0) store.insertMany('settings', inserts);
  return { scheme: value };
}

export const scoringHandlers = {
  'scoring.get': get,
  'scoring.save': save,
};

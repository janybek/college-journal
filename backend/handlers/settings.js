import { AppError } from '../../core/errors.js';
import { relayout } from '../scheduleData.js';
import { DEFAULT_BELLS, PAIR_MINUTES, readSettings, validateSettings, settingsToRows } from '../../core/settings.js';

function get(data, ctx) {
  return { settings: readSettings(ctx.store.list('settings')), defaultBells: DEFAULT_BELLS, pairMinutes: PAIR_MINUTES };
}

// Updates the row of each key whose value changed, adds missing keys; one batch each.
function save(data, ctx) {
  const { store } = ctx;
  const { value, errors } = validateSettings(data.settings);
  if (errors.length > 0) throw new AppError('invalid', { fields: errors });
  const rowsNow = store.list('settings');
  const before = readSettings(rowsNow);
  const existing = new Map();
  for (const row of rowsNow) if (!existing.has(row.key)) existing.set(row.key, row);
  const updates = [];
  const inserts = [];
  for (const { key, value: text } of settingsToRows(value)) {
    const row = existing.get(key);
    if (!row) inserts.push({ key, value: text });
    else if (row.value !== text) updates.push({ id: row.id, patch: { value: text } });
  }
  if (updates.length > 0) store.updateMany('settings', updates);
  if (inserts.length > 0) store.insertMany('settings', inserts);
  const settings = { ...before, ...value };
  const moved = ['semester', 'semesterStart', 'semesterEnd'].some((k) => before[k] !== settings[k]);
  if (moved) relayout(store, null, { settings });
  return { settings };
}

export const settingsHandlers = {
  'settings.get': get,
  'settings.save': save,
};

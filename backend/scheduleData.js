// Reading and writing semester pairs for the handlers. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate } from '../core/dates.js';
import { readSettings } from '../core/settings.js';
import { planGeneration } from '../core/schedule.js';
import { layoutTopics } from '../core/topics.js';

export function todayOf(platform) {
  return localDate(platform.now());
}

export function loadSettings(store) {
  return readSettings(store.list('settings'));
}

const groupBy = (rows) => {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.subjectId)) map.set(row.subjectId, []);
    map.get(row.subjectId).push(row);
  }
  return map;
};

// Lays the topics of the given subjects (null: all) over their pairs and saves the pairs whose topic changed.
// `rows` holds sheets the request has already read, as they stand after its own write; those are not read again.
export function relayout(store, subjectIds = null, rows = {}) {
  const topics = rows.topics ?? store.list('topics');
  const pairs = rows.pairs ?? store.list('pairs');
  const topicsBySubject = groupBy(topics);
  const pairsBySubject = groupBy(pairs);
  const ids = subjectIds ?? [...new Set([...topicsBySubject.keys(), ...pairsBySubject.keys()])];

  const assigned = new Map();
  for (const subjectId of ids) {
    const { assign } = layoutTopics(topicsBySubject.get(subjectId) || [], pairsBySubject.get(subjectId) || []);
    for (const { id, topicId } of assign) assigned.set(id, topicId);
  }
  if (assigned.size === 0) return { changed: 0, topics, pairs };
  store.updateMany('pairs', [...assigned].map(([id, topicId]) => ({ id, patch: { topicId } })));
  return { changed: assigned.size, topics, pairs: pairs.map((p) => (assigned.has(p.id) ? { ...p, topicId: assigned.get(p.id) } : p)) };
}

export function generateSchedule(store, platform, { dryRun = false, restart = false } = {}) {
  const settings = loadSettings(store);
  if (settings.semesterStart === '' || settings.semesterEnd === '') {
    throw new AppError('invalid', { fields: [{ field: 'semesterStart', code: 'required' }] });
  }
  const template = store.list('weekTemplate');
  if (template.length === 0) throw new AppError('empty_template');
  const subjects = store.list('subjects');
  const pairs = store.list('pairs');

  const today = todayOf(platform);
  const from = pairs.length === 0 || restart || today < settings.semesterStart ? settings.semesterStart : today;
  const plan = planGeneration({ template, subjects, settings, pairs, from, restart });
  const result = {
    from, to: settings.semesterEnd,
    inserted: plan.toInsert.length, updated: plan.toUpdate.length, removed: plan.toRemove.length,
    kept: plan.kept, conflicts: plan.conflicts,
  };
  if (dryRun) return result;

  if (plan.toRemove.length > 0) store.removeMany('pairs', plan.toRemove);
  if (plan.toUpdate.length > 0) store.updateMany('pairs', plan.toUpdate);
  const created = plan.toInsert.length > 0 ? store.insertMany('pairs', plan.toInsert) : [];

  const gone = new Set(plan.toRemove);
  const patches = new Map(plan.toUpdate.map((u) => [u.id, u.patch]));
  const after = pairs.filter((p) => !gone.has(p.id)).map((p) => (patches.has(p.id) ? { ...p, ...patches.get(p.id) } : p));
  relayout(store, null, { pairs: [...after, ...created] });
  return result;
}

// Reading and writing semester pairs for the handlers. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, addMinutes } from '../core/dates.js';
import { readSettings, PAIR_MINUTES } from '../core/settings.js';
import { planGeneration } from '../core/schedule.js';
import { layoutTopics, semesterScope } from '../core/topics.js';

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
// Only the topics of the current semester are laid, over the pairs inside the semester dates (and the held ones).
// `rows` holds sheets the request has already read, as they stand after its own write; those are not read again.
export function relayout(store, subjectIds = null, rows = {}) {
  const topics = rows.topics ?? store.list('topics');
  const pairs = rows.pairs ?? store.list('pairs');
  const settings = rows.settings ?? loadSettings(store);
  const topicsBySubject = groupBy(topics);
  const pairsBySubject = groupBy(pairs);
  const ids = subjectIds ?? [...new Set([...topicsBySubject.keys(), ...pairsBySubject.keys()])];

  const assigned = new Map();
  for (const subjectId of ids) {
    const scope = semesterScope(topicsBySubject.get(subjectId) || [], pairsBySubject.get(subjectId) || [], settings);
    for (const id of scope.clear) assigned.set(id, '');
    const { assign } = layoutTopics(scope.topics, scope.pairs);
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
  // Existing pairs are looked at from today on, even before the semester starts (planned ones before the start are removed).
  const fresh = pairs.length === 0 || restart;
  const from = fresh ? settings.semesterStart : today;
  const plan = planGeneration({ template, subjects, settings, pairs, from, restart });
  const result = {
    from: from < settings.semesterStart ? settings.semesterStart : from, to: settings.semesterEnd,
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
  relayout(store, null, { pairs: [...after, ...created], settings });
  return result;
}

// Pairs the `keep` filter accepts, shaped for the screens (built field by field, never copying rows),
// ordered by date, pair number and group name. `rows` holds sheets the request has already read.
export function pairViews(store, keep, rows = {}) {
  const pairs = rows.pairs ?? store.list('pairs');
  const topics = new Map((rows.topics ?? store.list('topics')).map((t) => [t.id, t]));
  const groups = new Map((rows.groups ?? store.list('groups')).map((g) => [g.id, g]));
  const subjects = new Map((rows.subjects ?? store.list('subjects')).map((s) => [s.id, s]));
  const staff = new Map((rows.staff ?? store.list('staff')).map((s) => [s.id, s]));
  const rooms = new Map((rows.rooms ?? store.list('rooms')).map((r) => [r.id, r]));
  const nameOf = (map, id, field) => (map.has(id) ? map.get(id)[field] : '');

  const views = pairs.filter(keep).map((p) => {
    const topic = topics.get(p.topicId);
    const subject = subjects.get(p.subjectId);
    return {
      id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, endTime: addMinutes(p.startTime, PAIR_MINUTES), status: p.status,
      groupId: p.groupId, groupName: nameOf(groups, p.groupId, 'name'),
      subjectId: p.subjectId, subjectName: subject ? subject.name : '',
      teacherId: p.teacherId, teacherName: nameOf(staff, p.teacherId, 'fullName'),
      roomId: p.roomId, roomName: nameOf(rooms, p.roomId, 'name'),
      topic: topic ? { id: topic.id, unit: topic.unit, order: topic.order, name: topic.name, lessonType: topic.lessonType } : null,
      substitution: subject ? subject.teacherId !== p.teacherId : false,
      moved: p.date !== p.planDate || p.slot !== p.planSlot,
      planDate: p.planDate, planSlot: p.planSlot, note: p.note,
    };
  });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return views.sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot || cmp(a.groupName, b.groupName));
}

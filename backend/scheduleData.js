// Reading and writing semester pairs for the handlers. No Node or Apps Script objects here.
import { AppError } from '../core/errors.js';
import { localDate, addMinutes } from '../core/dates.js';
import { readSettings, readExtra, PAIR_MINUTES } from '../core/settings.js';
import { isSubstitution, planGeneration } from '../core/schedule.js';
import { NO_LESSON, controlMarks, layoutLessons, lessonKey, partsOf } from '../core/topics.js';
import { lessonNumbers } from '../core/syllabusPlan.js';
import { subjectScope, syllabusIndex } from '../core/syllabus.js';

// The credit week as the screens get it: empty strings when there is none.
export function examOf(store) {
  const { examStart, examEnd } = readExtra(store.list('settings'));
  return { start: examStart, end: examEnd };
}

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

// Lays the lessons of the syllabus each given subject follows (null: all subjects) over that subject's pairs; saves the pairs whose lesson changed.
// Only the syllabus of the current semester is laid, over the pairs inside the semester dates (and the held ones).
// `rows` holds sheets the request has already read, as they stand after its own write; those are not read again.
// `also`: other patches of pairs ([{ id, patch }], e.g. a new teacher) written in the same batch as the lessons.
// -> { changed, subjects, syllabi, topics, pairs }: the sheets as they are now, so the caller need not read them a second time.
export function relayout(store, subjectIds = null, rows = {}, also = []) {
  const subjects = rows.subjects ?? store.list('subjects');
  const syllabi = rows.syllabi ?? store.list('syllabi');
  const syllabusMembers = rows.syllabusMembers ?? store.list('syllabusMembers');
  const topics = rows.topics ?? store.list('topics');
  const pairs = rows.pairs ?? store.list('pairs');
  const settings = rows.settings ?? loadSettings(store);
  const index = syllabusIndex(syllabi, topics, syllabusMembers);
  const pairsBySubject = groupBy(pairs);
  const wanted = subjectIds === null ? null : new Set(subjectIds);

  const assigned = new Map(also.map(({ id, patch }) => [id, { ...patch }]));   // pair id -> { topicId, lessonType, part } and the patch of `also`
  const lesson = (id, patch) => assigned.set(id, { ...assigned.get(id), ...patch });
  for (const subject of subjects) {
    if (wanted !== null && !wanted.has(subject.id)) continue;
    const scope = subjectScope(subject, pairsBySubject.get(subject.id) || [], index, settings);
    for (const id of scope.clear) lesson(id, NO_LESSON);
    for (const { id, patch } of layoutLessons(scope.topics, scope.pairs, scope.skip).assign) lesson(id, patch);
  }
  if (assigned.size === 0) return { changed: 0, subjects, syllabi, syllabusMembers, topics, pairs };
  store.updateMany('pairs', [...assigned].map(([id, patch]) => ({ id, patch })));
  return { changed: assigned.size, subjects, syllabi, syllabusMembers, topics, pairs: pairs.map((p) => (assigned.has(p.id) ? { ...p, ...assigned.get(p.id) } : p)) };
}

export function generateSchedule(store, platform, { dryRun = false, restart = false } = {}) {
  const settingRows = store.list('settings');
  const settings = { ...readSettings(settingRows), exam: readExtra(settingRows) };
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
  relayout(store, null, { subjects, pairs: [...after, ...created], settings });
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
  // The marks of modules without hours, by syllabus: computed once for each syllabus the views touch.
  const rowsOfSyllabus = new Map();
  for (const t of topics.values()) {
    if (!rowsOfSyllabus.has(t.syllabusId)) rowsOfSyllabus.set(t.syllabusId, []);
    rowsOfSyllabus.get(t.syllabusId).push(t);
  }
  const marksOf = new Map();
  const numbersOf = new Map();
  const numberOf = (topic) => {
    if (!numbersOf.has(topic.syllabusId)) numbersOf.set(topic.syllabusId, lessonNumbers(rowsOfSyllabus.get(topic.syllabusId)));
    return numbersOf.get(topic.syllabusId).get(topic.id);
  };
  // All the marks of the pair (several modules without hours can stand after one lesson), in row order; [] when there are none.
  const marksOn = (topic, pair) => {
    if (!marksOf.has(topic.syllabusId)) marksOf.set(topic.syllabusId, controlMarks(rowsOfSyllabus.get(topic.syllabusId)));
    return (marksOf.get(topic.syllabusId).get(lessonKey(pair)) || []).map((mark) => ({ name: mark.name, unit: mark.unit }));
  };

  const views = pairs.filter(keep).map((p) => {
    const topic = topics.get(p.topicId);
    const subject = subjects.get(p.subjectId);
    return {
      id: p.id, date: p.date, slot: p.slot, startTime: p.startTime, endTime: addMinutes(p.startTime, PAIR_MINUTES), status: p.status,
      groupId: p.groupId, groupName: nameOf(groups, p.groupId, 'name'),
      subjectId: p.subjectId, subjectName: subject ? subject.name : '',
      teacherId: p.teacherId, teacherName: nameOf(staff, p.teacherId, 'fullName'),
      roomId: p.roomId, roomName: nameOf(rooms, p.roomId, 'name'),
      topic: topic ? {
        id: topic.id, unit: topic.unit, name: topic.name, lessonKind: topic.lessonKind, number: numberOf(topic), lessonType: p.lessonType, part: p.part,
        parts: partsOf(topic, p.lessonType), controls: marksOn(topic, p),
      } : null,
      substitution: isSubstitution(p, subject),
      moved: p.date !== p.planDate || p.slot !== p.planSlot,
      planDate: p.planDate, planSlot: p.planSlot, note: p.note,
    };
  });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return views.sort((a, b) => cmp(a.date, b.date) || a.slot - b.slot || cmp(a.groupName, b.groupName));
}

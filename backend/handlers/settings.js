import { AppError } from '../../core/errors.js';
import { relayout } from '../scheduleData.js';
import { closedUnitsOf } from '../../core/ledger.js';
import { syllabusFor } from '../../core/syllabus.js';
import {
  DEFAULT_BELLS, PAIR_MINUTES, readSettings, validateSettings, settingsToRows, readExtra, validateExtra, extraToRows, inExam,
} from '../../core/settings.js';

function get(data, ctx) {
  const rows = ctx.store.list('settings');
  return { settings: readSettings(rows), defaultBells: DEFAULT_BELLS, pairMinutes: PAIR_MINUTES, extra: readExtra(rows) };
}

// The extra object must be a plain object whose dates, when given, are strings: validateExtra reads anything else as
// "empty", which would silently wipe the credit week that is saved.
function checkExtraShape(extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw new AppError('bad_request');
  return ['examStart', 'examEnd']
    .filter((field) => extra[field] !== undefined && typeof extra[field] !== 'string')
    .map((field) => ({ field, code: 'bad_value' }));
}

// A held pair of a unit that is closed in the current half must stay inside the semester dates.
function cutsClosedUnit(pairs, rows, settings) {
  const closed = new Map();
  const subjects = new Map(rows.subjects.map((s) => [s.id, s]));
  const topics = new Map(rows.topics.map((t) => [t.id, t]));
  for (const pair of pairs) {
    if (pair.status !== 'closed' || (pair.date >= settings.semesterStart && pair.date <= settings.semesterEnd)) continue;
    const topic = topics.get(pair.topicId);
    const subject = subjects.get(pair.subjectId);
    if (!topic || !Number.isInteger(topic.unit) || !subject) continue;
    if (!closed.has(subject.id)) {
      const syllabus = syllabusFor(subject, rows.syllabi, settings.semester, rows.syllabusMembers);
      const planSemester = syllabus && Number.isInteger(syllabus.planSemester) ? syllabus.planSemester : null;
      closed.set(subject.id, closedUnitsOf(rows.closures, subject.id, planSemester).units);
    }
    if (closed.get(subject.id).includes(topic.unit)) return true;
  }
  return false;
}

// Updates the row of each key whose value changed, adds missing keys; one batch each.
// `extra` (the credit week and the college name) is saved only when the request has it.
function save(data, ctx) {
  const { store } = ctx;
  const hasExtra = data.extra !== undefined;
  const { value, errors } = validateSettings(data.settings);
  const shapeErrors = hasExtra ? checkExtraShape(data.extra) : [];
  const rowsNow = store.list('settings');
  const before = readSettings(rowsNow);
  const settings = { ...before, ...value };
  const extraCheck = validateExtra(hasExtra ? data.extra : readExtra(rowsNow), settings);
  const all = [...errors, ...shapeErrors, ...extraCheck.errors.filter((e) => !shapeErrors.some((s) => s.field === e.field))];
  if (all.length > 0) throw new AppError('invalid', { fields: all });
  const extra = hasExtra ? extraCheck.value : readExtra(rowsNow);

  const datesMoved = ['semesterStart', 'semesterEnd'].some((k) => before[k] !== settings[k]);
  const moved = datesMoved || before.semester !== settings.semester;
  let pairs = null;
  let rows = {};
  if (hasExtra || moved) pairs = store.list('pairs');
  if (datesMoved) {
    rows = { subjects: store.list('subjects'), syllabi: store.list('syllabi'), syllabusMembers: store.list('syllabusMembers'), topics: store.list('topics') };
    if (cutsClosedUnit(pairs, { ...rows, closures: store.list('closures') }, settings)) throw new AppError('unit_closed');
  }

  const existing = new Map();
  for (const row of rowsNow) if (!existing.has(row.key)) existing.set(row.key, row);
  const updates = [];
  const inserts = [];
  for (const { key, value: text } of [...settingsToRows(value), ...(hasExtra ? extraToRows(extra) : [])]) {
    const row = existing.get(key);
    if (!row) inserts.push({ key, value: text });
    else if (row.value !== text) updates.push({ id: row.id, patch: { value: text } });
  }
  if (updates.length > 0) store.updateMany('settings', updates);
  if (inserts.length > 0) store.insertMany('settings', inserts);
  const examPairs = pairs === null ? 0
    : pairs.filter((p) => p.status === 'planned' && p.changed === false && p.substitute !== true && inExam(p.date, extra)).length;
  if (moved) relayout(store, null, { ...rows, pairs, settings });
  return { settings, extra, examPairs };
}

export const settingsHandlers = {
  'settings.get': get,
  'settings.save': save,
};

import { AppError } from '../../core/errors.js';
import { addDays, daysBetween, isDate, mondayOf } from '../../core/dates.js';
import { checkPairChange, pairLock } from '../../core/schedule.js';
import { NO_LESSON } from '../../core/topics.js';
import { generateSchedule, loadSettings, pairViews, relayout, todayOf } from '../scheduleData.js';

const MAX_RANGE_DAYS = 30;
const NOTE_MAX = 200;
const PATCH_FIELDS = ['teacherId', 'date', 'slot', 'roomId', 'note'];

function generate(data, ctx) {
  return generateSchedule(ctx.store, ctx.platform, { dryRun: data.dryRun === true, restart: data.restart === true });
}

function list(data, ctx) {
  const today = todayOf(ctx.platform);
  const from = data.from === undefined ? mondayOf(today) : data.from;
  if (!isDate(from)) throw new AppError('bad_request');
  const to = data.to === undefined ? addDays(from, 6) : data.to;
  if (!isDate(to) || to < from || daysBetween(from, to) > MAX_RANGE_DAYS) throw new AppError('bad_request');
  const groupId = typeof data.groupId === 'string' && data.groupId !== '' ? data.groupId : null;
  const teacherId = typeof data.teacherId === 'string' && data.teacherId !== '' ? data.teacherId : null;
  const pairs = pairViews(ctx.store, (p) => p.date >= from && p.date <= to
    && (groupId === null || p.groupId === groupId) && (teacherId === null || p.teacherId === teacherId));
  return { today, from, to, pairs };
}

// The week of a student's group, or of the pairs a staff member teaches (a substitute sees the pairs they cover).
function mine(data, ctx, user) {
  const today = todayOf(ctx.platform);
  const given = data.from === undefined ? today : data.from;
  if (!isDate(given)) throw new AppError('bad_request');
  const from = mondayOf(given);
  const to = addDays(from, 6);
  const own = user.kind === 'student'
    ? (p) => p.groupId === user.row.groupId
    : (p) => p.teacherId === user.id;
  return { today, from, to, pairs: pairViews(ctx.store, (p) => p.date >= from && p.date <= to && own(p)) };
}

function findPair(pairs, id) {
  const pair = typeof id === 'string' ? pairs.find((p) => p.id === id) : undefined;
  if (!pair) throw new AppError('not_found');
  return pair;
}

// Saves one pair, lays the topics again when the pair's place may have changed, and answers with its view.
function saved(store, pairs, id, patch, rows, relay, settings) {
  if (Object.keys(patch).length > 0) store.update('pairs', id, patch);
  const after = pairs.map((p) => (p.id === id ? { ...p, ...patch } : p));
  const pair = after.find((p) => p.id === id);
  const result = relay ? relayout(store, [pair.subjectId], { pairs: after, settings, subjects: rows.subjects }) : { subjects: undefined, topics: undefined, pairs: after };
  return { pair: pairViews(store, (p) => p.id === id, { ...rows, pairs: result.pairs, topics: result.topics, subjects: result.subjects ?? rows.subjects })[0] };
}

function changePair(data, ctx) {
  const { store, platform } = ctx;
  const pairs = store.list('pairs');
  const pair = findPair(pairs, data.id);
  const today = todayOf(platform);
  const lock = pairLock(pair, today);
  if (lock) throw new AppError(lock);
  const patch = {};
  for (const key of PATCH_FIELDS) if (data[key] !== undefined) patch[key] = data[key];
  const staff = store.list('staff');
  const rooms = store.list('rooms');
  const subjects = store.list('subjects');
  const settings = loadSettings(store);
  const subject = subjects.find((s) => s.id === pair.subjectId);
  const { next, errors } = checkPairChange(pair, patch, { settings, today, staff, rooms, pairs, subject });
  if (errors.length > 0) throw new AppError('invalid', { fields: errors });
  const placeChanged = next.date !== pair.date || next.slot !== pair.slot;
  const changes = {};
  for (const key of Object.keys(next)) if (next[key] !== (key === 'substitute' ? pair.substitute === true : (pair[key] ?? ''))) changes[key] = next[key];
  return saved(store, pairs, pair.id, changes, { staff, rooms, subjects }, placeChanged, settings);
}

function cancelPair(data, ctx) {
  const { store, platform } = ctx;
  const pairs = store.list('pairs');
  const pair = findPair(pairs, data.id);
  const lock = pairLock(pair, todayOf(platform));
  if (lock) throw new AppError(lock);
  const patch = { status: 'cancelled', ...NO_LESSON, changed: true };
  if (data.note !== undefined) {
    const note = typeof data.note === 'string' ? data.note.trim() : null;
    if (note === null) throw new AppError('invalid', { fields: [{ field: 'note', code: 'bad_value' }] });
    if (note.length > NOTE_MAX) throw new AppError('invalid', { fields: [{ field: 'note', code: 'too_long' }] });
    patch.note = note;
  }
  return saved(store, pairs, pair.id, patch, {}, true);
}

function restorePair(data, ctx) {
  const { store, platform } = ctx;
  const pairs = store.list('pairs');
  const pair = findPair(pairs, data.id);
  const today = todayOf(platform);
  if (pair.status !== 'cancelled') throw new AppError('pair_locked');
  if (pair.date < today) throw new AppError('in_past');
  const staff = store.list('staff');
  const rooms = store.list('rooms');
  const settings = loadSettings(store);
  const { errors } = checkPairChange(pair, {}, { settings, today, staff, rooms, pairs });
  if (errors.length > 0) throw new AppError('invalid', { fields: errors });
  return saved(store, pairs, pair.id, { status: 'planned', note: '' }, { staff, rooms }, true, settings);
}

export const scheduleHandlers = {
  'schedule.list': list,
  'schedule.mine': mine,
  'schedule.changePair': changePair,
  'schedule.cancelPair': cancelPair,
  'schedule.restorePair': restorePair,
  'schedule.generate': generate,
};

// Semester pairs: what the week template asks for, and the rules for changing one pair by hand.
import { addDays, daysBetween, isDate, weekday } from './dates.js';
import { pairSlots, busyCodes } from './busy.js';

const NOTE_MAX = 200;
const BUSY_FIELD = { group_busy: 'slot', teacher_busy: 'teacherId', room_busy: 'roomId' };

// Dates Monday-Friday from `from` to semesterEnd inclusive, without holidays.
export function workingDays(settings, from = settings.semesterStart) {
  const start = from < settings.semesterStart ? settings.semesterStart : from;
  const holidays = new Set(settings.holidays || []);
  const days = [];
  for (let n = daysBetween(start, settings.semesterEnd), i = 0; i <= n; i++) {
    const date = addDays(start, i);
    if (weekday(date) <= 5 && !holidays.has(date)) days.push(date);
  }
  return days;
}

const keyOf = (groupId, date, slot) => groupId + '|' + date + '|' + slot;
const byPlace = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.slot - b.slot || (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));

export function planGeneration({ template, subjects, settings, pairs, from, restart = false }) {
  const subjectById = new Map((subjects || []).map(s => [s.id, s]));
  let conflicts = 0;

  const needed = new Map();
  for (const date of workingDays(settings, from)) {
    for (const row of template || []) {
      if (row.weekday !== weekday(date)) continue;
      const subject = subjectById.get(row.subjectId);
      if (!subject) continue;
      if (row.slot > settings.bells.length) { conflicts++; continue; }
      const key = keyOf(subject.groupId, date, row.slot);
      if (needed.has(key)) continue;
      needed.set(key, {
        date, slot: row.slot, startTime: settings.bells[row.slot - 1], groupId: subject.groupId, subjectId: row.subjectId,
        teacherId: subject.teacherId, roomId: row.roomId || '', topicId: '', status: 'planned',
        planDate: date, planSlot: row.slot, changed: false, note: '',
      });
    }
  }
  const sortedNeeded = [...needed.values()].sort(byPlace);

  if (restart) {
    return { toInsert: sortedNeeded, toUpdate: [], toRemove: (pairs || []).map(p => p.id), kept: 0, conflicts };
  }

  const considered = (pairs || []).filter(p => p.planDate >= from);
  const replaceable = p => p.status === 'planned' && p.changed === false;
  const fixed = considered.filter(p => !replaceable(p));
  const fixedSlots = pairSlots(fixed);
  const taken = new Set(fixed.map(p => keyOf(p.groupId, p.planDate, p.planSlot)));
  const toRemove = [];
  const toUpdate = [];
  let kept = fixed.length;

  for (const pair of considered.filter(replaceable)) {
    const key = keyOf(pair.groupId, pair.planDate, pair.planSlot);
    const want = needed.get(key);
    if (taken.has(key) || !want) { toRemove.push(pair.id); continue; }
    taken.add(key);
    const patch = {};
    for (const field of ['subjectId', 'teacherId', 'roomId', 'startTime']) {
      if (pair[field] !== want[field]) patch[field] = want[field];
    }
    if (patch.subjectId !== undefined) patch.topicId = '';
    if (!Object.keys(patch).length) { kept++; continue; }
    if ((patch.teacherId !== undefined || patch.roomId !== undefined)
      && busyCodes(fixedSlots, { id: pair.id, day: want.date, slot: want.slot, groupId: want.groupId, teacherId: want.teacherId, roomId: want.roomId }).length) {
      conflicts++;
      continue;
    }
    toUpdate.push({ id: pair.id, patch, date: want.date, slot: want.slot, groupId: want.groupId });
  }

  const toInsert = [];
  for (const want of sortedNeeded) {
    const key = keyOf(want.groupId, want.date, want.slot);
    if (taken.has(key)) continue;
    if (busyCodes(fixedSlots, { id: '', day: want.date, slot: want.slot, groupId: want.groupId, teacherId: want.teacherId, roomId: want.roomId }).length) {
      conflicts++;
      continue;
    }
    toInsert.push(want);
  }

  toUpdate.sort(byPlace);
  return { toInsert, toUpdate: toUpdate.map(({ id, patch }) => ({ id, patch })), toRemove, kept, conflicts };
}

export function pairLock(pair, today) {
  if (pair.status !== 'planned') return 'pair_locked';
  if (pair.date < today) return 'in_past';
  return null;
}

export function checkPairChange(pair, patch, ctx) {
  const { settings, today } = ctx;
  const has = key => patch[key] !== undefined;
  const next = {
    date: has('date') ? patch.date : pair.date,
    slot: has('slot') ? patch.slot : pair.slot,
    teacherId: has('teacherId') ? patch.teacherId : pair.teacherId,
    roomId: has('roomId') ? patch.roomId : pair.roomId,
    note: has('note') ? (typeof patch.note === 'string' ? patch.note.trim() : patch.note) : (pair.note || ''),
  };
  const errors = [];
  const failed = new Set();
  const fail = (field, code) => { if (!failed.has(field)) { failed.add(field); errors.push({ field, code }); } };

  if (!isDate(next.date)) fail('date', 'bad_value');
  else if (next.date < today) fail('date', 'in_past');
  else if (next.date < settings.semesterStart || next.date > settings.semesterEnd) fail('date', 'out_of_semester');
  else if (weekday(next.date) === 7 || (settings.holidays || []).includes(next.date)) fail('date', 'day_off');

  const slotOk = Number.isInteger(next.slot) && next.slot >= 1 && next.slot <= settings.bells.length;
  if (!slotOk) fail('slot', 'bad_value');

  const teacher = (ctx.staff || []).find(s => s.id === next.teacherId);
  if (!teacher) fail('teacherId', 'bad_ref');
  else if (!teacher.active || !String(teacher.roles || '').split(',').map(r => r.trim()).includes('teacher')) fail('teacherId', 'bad_value');

  if (next.roomId && !(ctx.rooms || []).some(r => r.id === next.roomId)) fail('roomId', 'bad_ref');

  if (typeof next.note !== 'string') fail('note', 'bad_value');
  else if (next.note.length > NOTE_MAX) fail('note', 'too_long');

  if (!failed.has('date') && slotOk) {
    const cand = { id: pair.id, day: next.date, slot: next.slot, groupId: pair.groupId, teacherId: next.teacherId, roomId: next.roomId };
    for (const code of busyCodes(pairSlots(ctx.pairs), cand)) fail(BUSY_FIELD[code], code);
  }

  const order = ['date', 'slot', 'teacherId', 'roomId', 'note'];
  errors.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  return {
    next: { ...next, startTime: slotOk ? settings.bells[next.slot - 1] : pair.startTime, changed: true },
    errors,
  };
}

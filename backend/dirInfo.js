// Directory details: numbers for the columns of the lists and the card of one group, room or discipline. Read-only.
import { AppError } from '../core/errors.js';
import { readSettings, readExtra } from '../core/settings.js';
import { localDate, localTime, isDate, mondayOf, addDays } from '../core/dates.js';
import { isSubstitution } from '../core/schedule.js';
import { compareNames } from '../core/names.js';
import { ownLines } from '../core/disciplineSyllabus.js';
import { CARD_TABLES, pairEnd, nowOf, termOf, topOf, syllabusState, syllabusCounts } from '../core/dirInfo.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (key) => (a, b) => compareNames(a[key], b[key]);

function checkTable(table) {
  if (typeof table !== 'string' || !CARD_TABLES.includes(table)) throw new AppError('bad_request');
}

// The moment, the term and the settings every answer needs. `read(name)` reads a sheet once per request.
function context(store, platform, user, table) {
  const sheets = {};
  const read = (name) => {
    if (!(name in sheets)) sheets[name] = store.list(name);
    return sheets[name];
  };
  const nowMs = platform.now();
  const today = localDate(nowMs);
  const time = localTime(nowMs);
  const settingsRows = read('settings');
  const settings = readSettings(settingsRows);
  const extra = readExtra(settingsRows);
  // Only groups and rooms say anything about the term (and read the big sheet of pairs for it).
  const term = table === 'disciplines' ? undefined : termOf({ settings, extra, today, hasPairs: read('pairs').length > 0 });
  const viewer = { id: user.id, roles: Array.isArray(user.roles) ? user.roles : [] };
  return { read, today, time, term, settings, extra, viewer };
}

const head = (table, c) => ({ table, today: c.today, time: c.time, term: c.term, semesterStart: c.settings.semesterStart, semesterEnd: c.settings.semesterEnd });

// disciplines by id, subjects by id, rooms by id as Maps
const mapOf = (rows) => new Map(rows.map((r) => [r.id, r]));

// The discipline name of a subject; a subject without a known discipline keeps its own name.
const subjectNameOf = (subject, disciplines) => {
  if (!subject) return '';
  const d = subject.disciplineId ? disciplines.get(subject.disciplineId) : null;
  return d ? d.name : subject.name;
};

// How many rows of the week template belong to the subjects / the room (key by subject or room id).
function countBy(rows, key) {
  const count = new Map();
  for (const r of rows) count.set(r[key], (count.get(r[key]) || 0) + 1);
  return count;
}

function groupNow(pairs, groupId, c, subjects, disciplines, rooms) {
  const found = nowOf(pairs.filter((p) => p.groupId === groupId), c.today, c.time);
  if (found.state === 'none' || found.state === 'done') return { state: found.state };
  const pair = found.pair;
  const room = rooms.get(pair.roomId);
  const base = { roomName: room ? room.name : '', subjectName: subjectNameOf(subjects.get(pair.subjectId), disciplines) };
  return found.state === 'busy' ? { state: 'busy', until: pairEnd(pair), ...base } : { state: 'next', at: pair.startTime, ...base };
}

function roomNow(pairs, roomId, c, subjects, disciplines, groups) {
  const found = nowOf(pairs.filter((p) => p.roomId === roomId), c.today, c.time);
  if (found.state === 'none') return { state: 'freeDay' };
  if (found.state === 'done') return { state: 'freeRest' };
  if (found.state === 'next') return { state: 'free', until: found.pair.startTime };
  const pair = found.pair;
  const group = groups.get(pair.groupId);
  return { state: 'busy', until: pairEnd(pair), groupName: group ? group.name : '', subjectName: subjectNameOf(subjects.get(pair.subjectId), disciplines) };
}

function groupsSummary(c) {
  const { read } = c;
  const students = read('students');
  const subjectRows = read('subjects');
  const disciplines = mapOf(read('disciplines'));
  const subjects = mapOf(subjectRows);
  const rooms = mapOf(read('rooms'));
  const pairs = read('pairs');
  const template = countBy(read('weekTemplate'), 'subjectId');
  const rows = read('groups').map((g) => {
    const mine = subjectRows.filter((s) => s.groupId === g.id);
    const own = students.filter((s) => s.groupId === g.id);
    return {
      id: g.id,
      students: own.filter((s) => s.active === true).length,
      inactive: own.filter((s) => s.active !== true).length,
      disciplines: [...new Set(mine.map((s) => subjectNameOf(s, disciplines)))].sort(compareNames),
      weekPairs: mine.reduce((sum, s) => sum + (template.get(s.id) || 0), 0),
      now: groupNow(pairs, g.id, c, subjects, disciplines, rooms),
    };
  });
  return { ...head('groups', c), rows };
}

function roomsSummary(c) {
  const { read } = c;
  const subjects = mapOf(read('subjects'));
  const disciplines = mapOf(read('disciplines'));
  const groups = mapOf(read('groups'));
  const pairs = read('pairs');
  const template = read('weekTemplate');
  const rows = read('rooms').map((room) => {
    const mine = template.filter((w) => w.roomId === room.id);
    const items = mine.map((w) => {
      const subject = subjects.get(w.subjectId);
      const group = subject ? groups.get(subject.groupId) : null;
      return { disciplineName: subjectNameOf(subject, disciplines), groupName: group ? group.name : '' };
    });
    return { id: room.id, weekPairs: mine.length, top: topOf(items), now: roomNow(pairs, room.id, c, subjects, disciplines, groups) };
  });
  return { ...head('rooms', c), rows };
}

// One entry for each pair «discipline + teacher» of the subjects.
function disciplinesSummary(c) {
  const { read } = c;
  const staff = mapOf(read('staff'));
  const groups = mapOf(read('groups'));
  const subjects = read('subjects');
  const syllabi = read('syllabi');
  const lines = read('syllabusLines');
  const semester = c.settings.semester;
  const rows = read('disciplines').map((d) => {
    const mine = subjects.filter((s) => s.disciplineId === d.id);
    const byTeacher = new Map();
    for (const s of mine) {
      if (!byTeacher.has(s.teacherId)) byTeacher.set(s.teacherId, []);
      const group = groups.get(s.groupId);
      if (group) byTeacher.get(s.teacherId).push(group.name);
    }
    const teachers = [...byTeacher.entries()].map(([teacherId, names]) => {
      const person = staff.get(teacherId);
      return { teacherId, teacherName: person ? person.fullName : '', groupNames: [...new Set(names)].sort(compareNames) };
    }).sort(byName('teacherName'));
    // one state for the syllabus of the discipline in this half; while the half waits for the choice, one per old own syllabus and «none» for a teacher without one
    const stateOf = (teacherId) => syllabusState(syllabi, { disciplineId: d.id, teacherId, semester }, c.viewer, lines);
    const states = [];
    const own = ownLines(lines, d.id, semester);
    if (own.length > 1) {
      for (const line of own) states.push(stateOf(line.teacherId));
      const owners = new Set(own.map((l) => l.teacherId));
      for (const t of teachers) if (!owners.has(t.teacherId)) states.push({ approved: false, open: null });
    } else {
      const state = stateOf('');
      if (state.approved || state.open !== null || mine.length > 0) states.push(state);
    }
    return { id: d.id, teachers, syllabi: syllabusCounts(states) };
  });
  return { table: 'disciplines', currentSemester: semester, rows };
}

export function dirSummary(store, platform, user, table) {
  checkTable(table);
  const c = context(store, platform, user, table);
  if (table === 'groups') return groupsSummary(c);
  if (table === 'rooms') return roomsSummary(c);
  return disciplinesSummary(c);
}

const syllabusOf = (c, subject) => {
  if (!subject.disciplineId) return { approved: false, open: null };
  const key = { disciplineId: subject.disciplineId, teacherId: subject.teacherId, semester: c.settings.semester };
  return syllabusState(c.read('syllabi'), key, c.viewer, c.read('syllabusLines'));
};

function groupCard(c, group) {
  const { read } = c;
  const students = read('students').filter((s) => s.groupId === group.id);
  const disciplines = mapOf(read('disciplines'));
  const staff = mapOf(read('staff'));
  const subjectRows = read('subjects');
  const subjects = mapOf(subjectRows);
  const rooms = mapOf(read('rooms'));
  const template = countBy(read('weekTemplate'), 'subjectId');
  const mine = subjectRows.filter((s) => s.groupId === group.id);
  const rows = mine.map((s) => {
    const person = staff.get(s.teacherId);
    return {
      subjectId: s.id,
      disciplineId: s.disciplineId,
      disciplineName: subjectNameOf(s, disciplines),
      teacherId: s.teacherId,
      teacherName: person ? person.fullName : '',
      syllabus: syllabusOf(c, s),
      weekPairs: template.get(s.id) || 0,
    };
  }).sort(byName('disciplineName'));
  const ids = new Set(students.map((s) => s.id));
  const repeating = new Set(read('repeats').filter((r) => r.status === 'open' && ids.has(r.studentId)).map((r) => r.studentId));
  const active = students.filter((s) => s.active === true);
  return {
    ...head('groups', c),
    group: { id: group.id, name: group.name, course: group.course },
    counts: {
      students: active.length,
      inactive: students.length - active.length,
      subjects: mine.length,
      weekPairs: rows.reduce((sum, r) => sum + r.weekPairs, 0),
      repeats: repeating.size,
    },
    now: groupNow(read('pairs'), group.id, c, subjects, disciplines, rooms),
    subjects: rows,
    students: active.map((s) => ({ id: s.id, fullName: s.fullName, cardNo: s.cardNo })).sort(byName('fullName')),
  };
}

function roomCard(c, room, from) {
  const { read } = c;
  const subjects = mapOf(read('subjects'));
  const disciplines = mapOf(read('disciplines'));
  const groups = mapOf(read('groups'));
  const staff = mapOf(read('staff'));
  const pairs = read('pairs');
  const monday = from === undefined ? mondayOf(c.today) : mondayOf(from);
  const to = addDays(monday, 6);
  const list = pairs.filter((p) => p.roomId === room.id && p.date >= monday && p.date <= to).map((p) => {
    const subject = subjects.get(p.subjectId);
    const group = groups.get(p.groupId);
    const person = staff.get(p.teacherId);
    return {
      id: p.id,
      date: p.date,
      slot: p.slot,
      startTime: p.startTime,
      endTime: pairEnd(p),
      status: p.status,
      groupId: p.groupId,
      groupName: group ? group.name : '',
      subjectName: subjectNameOf(subject, disciplines),
      teacherName: person ? person.fullName : '',
      substitution: isSubstitution(p, subject),
      moved: p.date !== p.planDate || p.slot !== p.planSlot,
      planDate: p.planDate,
      planSlot: p.planSlot,
    };
  }).sort((a, b) => cmp(a.date, b.date) || (a.slot - b.slot) || compareNames(a.groupName, b.groupName));
  return {
    ...head('rooms', c),
    room: { id: room.id, name: room.name },
    weekPairs: read('weekTemplate').filter((w) => w.roomId === room.id).length,
    now: roomNow(pairs, room.id, c, subjects, disciplines, groups),
    from: monday,
    to,
    bells: c.settings.bells,
    exam: { start: c.extra.examStart, end: c.extra.examEnd },
    holidays: c.settings.holidays.filter((d) => d >= monday && d <= to),
    pairs: list,
  };
}

function disciplineCard(c, discipline) {
  const { read } = c;
  const groups = mapOf(read('groups'));
  const staff = mapOf(read('staff'));
  const template = countBy(read('weekTemplate'), 'subjectId');
  const rows = read('subjects').filter((s) => s.disciplineId === discipline.id).map((s) => {
    const group = groups.get(s.groupId);
    const person = staff.get(s.teacherId);
    return {
      subjectId: s.id,
      groupId: s.groupId,
      groupName: group ? group.name : '',
      teacherId: s.teacherId,
      teacherName: person ? person.fullName : '',
      syllabus: syllabusOf(c, s),
      weekPairs: template.get(s.id) || 0,
    };
  }).sort(byName('groupName'));
  return { table: 'disciplines', currentSemester: c.settings.semester, discipline: { id: discipline.id, name: discipline.name }, rows };
}

export function dirCard(store, platform, user, data) {
  const { table, id, from } = data !== null && typeof data === 'object' ? data : {};
  checkTable(table);
  if (typeof id !== 'string' || id === '') throw new AppError('bad_request');
  if (table === 'rooms' && from !== undefined && !isDate(from)) throw new AppError('bad_request');
  const c = context(store, platform, user, table);
  const row = c.read(table).find((r) => r.id === id);
  if (!row) throw new AppError('not_found');
  if (table === 'groups') return groupCard(c, row);
  if (table === 'rooms') return roomCard(c, row, from);
  return disciplineCard(c, row);
}

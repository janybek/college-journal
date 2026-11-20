import { SCHEMA, STAFF_ROLES, LANGS, DEFAULT_LANG, WEEKDAYS, LESSON_TYPES } from './schema.js';
import { MAX_SLOTS } from './settings.js';
import { templateSlots, busyCodes } from './busy.js';

const MAX_LEN = 200;

const clean = (v) => (v === undefined || v === null ? '' : String(v)).trim().replace(/\s+/g, ' ');
const norm = (v) => clean(v).toLowerCase();
const isEmpty = (v) => v === undefined || v === null || v === '';

function parseRoles(value) {
  const parts = clean(value).split(',').map(s => s.trim()).filter(Boolean);
  return [...new Set(parts)];
}

function coerce(type, value) {
  if (type === 'string') return clean(value);
  if (type === 'int') {
    if (typeof value === 'number') return value;
    const s = clean(value);
    return /^-?\d+$/.test(s) ? Number(s) : value;
  }
  if (value === true || value === 1 || value === 'true' || value === '1') return true;
  if (value === false || value === 0 || value === 'false' || value === '0') return false;
  return value;
}

// Returns only the table's own keys; passwordHash is passed through untouched.
export function normalizeRow(table, input) {
  const columns = SCHEMA[table].columns;
  const out = {};
  for (const { key, type } of columns) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (key === 'passwordHash') out[key] = value;
    else if (key === 'roles') {
      const roles = parseRoles(value);
      const known = STAFF_ROLES.filter(r => roles.includes(r));
      out[key] = [...known, ...roles.filter(r => !STAFF_ROLES.includes(r))].join(',');
    } else out[key] = coerce(type, value);
  }
  const has = (key) => columns.some(c => c.key === key);
  if (has('lang') && isEmpty(out.lang)) out.lang = DEFAULT_LANG;
  if (has('active') && out.active === undefined) out.active = true;
  if (has('mustChangePassword') && out.mustChangePassword === undefined) out.mustChangePassword = true;
  if (has('scheme') && isEmpty(out.scheme)) out.scheme = 'A';
  return out;
}

// Another row (different id) of `list` has the same trimmed, case-insensitive value in `key`.
const taken = (list, key, value, id) =>
  (list || []).some(r => r.id !== id && norm(r[key]) === norm(value));

const exists = (list, id) => (list || []).some(r => r.id === id);

// Which field ('roles' or 'active') would leave the system without an active admin, if any.
function lastAdminField(row, db) {
  const old = (db.staff || []).find(s => s.id === row.id);
  if (!old || !old.active || !parseRoles(old.roles).includes('admin')) return null;
  const otherAdmin = db.staff.some(s => s.id !== row.id && s.active && parseRoles(s.roles).includes('admin'));
  if (otherAdmin) return null;
  if (!parseRoles(row.roles).includes('admin')) return 'roles';
  if (row.active === false) return 'active';
  return null;
}

// Each rule returns an error code (or nothing) for one field; `field()` registers it.
const RULES = {
  groups(row, db, field) {
    field('name', () => {
      if (!clean(row.name)) return 'required';
      if (taken(db.groups, 'name', row.name, row.id)) return 'duplicate';
    });
    field('course', () => {
      if (!Number.isInteger(row.course) || row.course < 1 || row.course > 6) return 'bad_value';
    });
  },
  students(row, db, field) {
    field('fullName', () => { if (!clean(row.fullName)) return 'required'; });
    field('groupId', () => { if (!exists(db.groups, row.groupId)) return 'bad_ref'; });
    field('cardNo', () => {
      if (!clean(row.cardNo)) return 'required';
      if (taken(db.students, 'cardNo', row.cardNo, row.id) || taken(db.staff, 'login', row.cardNo)) return 'duplicate';
    });
    field('lang', () => { if (!LANGS.includes(row.lang)) return 'bad_value'; });
  },
  staff(row, db, field) {
    const lastAdmin = lastAdminField(row, db);
    field('fullName', () => { if (!clean(row.fullName)) return 'required'; });
    field('login', () => {
      const len = clean(row.login).length;
      if (len < 3 || len > 40) return 'bad_value';
      if (taken(db.staff, 'login', row.login, row.id) || taken(db.students, 'cardNo', row.login)) return 'duplicate';
    });
    field('roles', () => {
      const roles = parseRoles(row.roles);
      if (!roles.length || !roles.every(r => STAFF_ROLES.includes(r))) return 'bad_value';
      if (lastAdmin === 'roles') return 'last_admin';
    });
    field('lang', () => { if (!LANGS.includes(row.lang)) return 'bad_value'; });
    field('active', () => { if (lastAdmin === 'active') return 'last_admin'; });
  },
  subjects(row, db, field) {
    field('name', () => {
      if (!clean(row.name)) return 'required';
      const pairTaken = (db.subjects || []).some(s =>
        s.id !== row.id && norm(s.name) === norm(row.name) && s.groupId === row.groupId);
      if (pairTaken) return 'duplicate';
    });
    field('teacherId', () => {
      const teacher = (db.staff || []).find(s => s.id === row.teacherId);
      if (!teacher) return 'bad_ref';
      if (!parseRoles(teacher.roles).includes('teacher')) return 'bad_value';
      // A new teacher must be free at every week-template slot of this subject.
      const old = (db.subjects || []).find(s => s.id === row.id);
      if (old && old.teacherId !== row.teacherId && db.weekTemplate) {
        const slots = templateSlots(db.weekTemplate, db.subjects);
        const busy = db.weekTemplate.some(r => r.subjectId === old.id
          && busyCodes(slots, { id: r.id, day: r.weekday, slot: r.slot, groupId: '', teacherId: row.teacherId, roomId: '' }).includes('teacher_busy'));
        if (busy) return 'teacher_busy';
      }
    });
    field('groupId', () => { if (!exists(db.groups, row.groupId)) return 'bad_ref'; });
  },
  rooms(row, db, field) {
    field('name', () => {
      if (!clean(row.name)) return 'required';
      if (taken(db.rooms, 'name', row.name, row.id)) return 'duplicate';
    });
  },
  weekTemplate(row, db, field) {
    const slotLimit = db.slotCount || MAX_SLOTS;
    const weekdayOk = WEEKDAYS.includes(row.weekday);
    const slotOk = Number.isInteger(row.slot) && row.slot >= 1 && row.slot <= slotLimit;
    const subject = (db.subjects || []).find(s => s.id === row.subjectId);
    const roomOk = isEmpty(row.roomId) || exists(db.rooms, row.roomId);
    let busy = [];
    if (weekdayOk && slotOk) {
      const cand = {
        id: row.id || '', day: row.weekday, slot: row.slot,
        groupId: subject ? subject.groupId : '', teacherId: subject ? subject.teacherId : '', roomId: row.roomId || '',
      };
      busy = busyCodes(templateSlots(db.weekTemplate, db.subjects), cand);
    }
    field('weekday', () => { if (!weekdayOk) return 'bad_value'; });
    field('slot', () => {
      if (!slotOk) return 'bad_value';
      if (busy.includes('group_busy')) return 'group_busy';
    });
    field('subjectId', () => {
      if (!subject) return 'bad_ref';
      if (busy.includes('teacher_busy')) return 'teacher_busy';
    });
    field('roomId', () => {
      if (!roomOk) return 'bad_ref';
      if (busy.includes('room_busy')) return 'room_busy';
    });
  },
  topics(row, db, field) {
    const inRange = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
    field('subjectId', () => { if (!exists(db.subjects, row.subjectId)) return 'bad_ref'; });
    field('unit', () => { if (!inRange(row.unit, 12)) return 'bad_value'; });
    field('order', () => {
      if (!inRange(row.order, 200)) return 'bad_value';
      const dup = (db.topics || []).some(t => t.id !== row.id && t.subjectId === row.subjectId && t.order === row.order);
      if (dup) return 'duplicate';
    });
    field('name', () => { if (!clean(row.name)) return 'required'; });
    field('lessonType', () => { if (!LESSON_TYPES.includes(row.lessonType)) return 'bad_value'; });
  },
};

// Returns [{ field, code }] in schema column order, at most one error per field.
export function validateRow(table, row, db) {
  const rules = RULES[table];
  if (!rules) return [];
  const columns = SCHEMA[table].columns;
  const codes = new Map();
  const field = (key, rule) => {
    const column = columns.find(c => c.key === key);
    const tooLong = column.type === 'string' && clean(row[key]).length > MAX_LEN;
    const code = tooLong ? 'too_long' : rule();
    if (code) codes.set(key, code);
  };
  rules(row, db, field);
  return columns.filter(c => codes.has(c.key)).map(c => ({ field: c.key, code: codes.get(c.key) }));
}

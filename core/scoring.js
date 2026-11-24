// The scoring scheme of the college: one for all subjects, stored in the settings.
export const DEFAULT_SCHEME = Object.freeze({
  attendance: 20, activity: 10, current: 40, self: 20, control: 40,
  minimum: 24, fair: 60, good: 80, excellent: 90, editDays: 3,
});

export const SCHEME_FIELDS = ['attendance', 'activity', 'current', 'self', 'control', 'minimum', 'fair', 'good', 'excellent', 'editDays'];

export const SCHEME_KEYS = {
  attendance: 'scoreAttendance', activity: 'scoreActivity', current: 'scoreCurrent', self: 'scoreSelf',
  control: 'scoreControl', minimum: 'scoreMinimum', fair: 'scoreFair', good: 'scoreGood', excellent: 'scoreExcellent',
  editDays: 'journalEditDays',
};

export const REASON_MAX = 300;

const RANGES = {
  attendance: [1, 100], activity: [0, 100], current: [1, 100], self: [0, 100], control: [0, 100],
  minimum: [0, 100], fair: [1, 100], good: [1, 100], excellent: [1, 100], editDays: [0, 60],
};

// Integer number or a string of digits (spaces at the edges are dropped); otherwise null.
function toInt(raw) {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

export function validateScheme(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const value = {};
  const bad = {};
  for (const field of SCHEME_FIELDS) {
    const n = toInt(source[field]);
    const [lo, hi] = RANGES[field];
    if (n === null || n < lo || n > hi) bad[field] = 'bad_value';
    else value[field] = n;
  }
  const ok = (...fields) => fields.every((f) => !(f in bad));
  if (ok('current', 'self', 'control') && value.current + value.self + value.control !== 100) bad.control = 'sum';
  if (ok('minimum', 'current', 'control') && value.minimum > Math.min(value.current, value.control)) bad.minimum = 'too_big';
  if (ok('fair', 'good') && value.good <= value.fair) bad.good = 'order';
  if (ok('good', 'excellent') && value.excellent <= value.good) bad.excellent = 'order';
  const errors = SCHEME_FIELDS.filter((f) => f in bad).map((field) => ({ field, code: bad[field] }));
  return { value, errors };
}

export function readScheme(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const scheme = {};
  for (const field of SCHEME_FIELDS) {
    const row = list.find((r) => r && r.key === SCHEME_KEYS[field]);
    const n = row ? toInt(row.value) : null;
    scheme[field] = n === null ? DEFAULT_SCHEME[field] : n;
  }
  return validateScheme(scheme).errors.length ? { ...DEFAULT_SCHEME } : scheme;
}

export function schemeToRows(value) {
  return SCHEME_FIELDS.map((field) => ({ key: SCHEME_KEYS[field], value: String(value[field]) }));
}

// Regulation 2.9: the semester / exam split and the admission threshold ("more than" admission points of the semester).
export const DEFAULT_SPLIT = Object.freeze({ semester: 60, exam: 40, admission: 30 });
export const SPLIT_FIELDS = ['semester', 'exam', 'admission'];
export const SPLIT_KEYS = { semester: 'scoreSemester', exam: 'scoreExam', admission: 'scoreAdmission' };

const SPLIT_RANGES = { semester: [1, 99], exam: [1, 99], admission: [0, 99] };

export function validateSplit(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const value = {};
  const bad = {};
  for (const field of SPLIT_FIELDS) {
    const n = toInt(source[field]);
    const [lo, hi] = SPLIT_RANGES[field];
    if (n === null || n < lo || n > hi) bad[field] = 'bad_value';
    else value[field] = n;
  }
  const ok = (...fields) => fields.every((f) => !(f in bad));
  if (ok('semester', 'exam') && value.semester + value.exam !== 100) bad.exam = 'sum';
  if (ok('semester', 'admission') && value.admission >= value.semester) bad.admission = 'too_big';
  const errors = SPLIT_FIELDS.filter((f) => f in bad).map((field) => ({ field, code: bad[field] }));
  return { value, errors };
}

export function readSplit(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const split = {};
  for (const field of SPLIT_FIELDS) {
    const row = list.find((r) => r && r.key === SPLIT_KEYS[field]);
    const n = row ? toInt(row.value) : null;
    split[field] = n === null ? DEFAULT_SPLIT[field] : n;
  }
  return validateSplit(split).errors.length ? { ...DEFAULT_SPLIT } : split;
}

export function splitToRows(value) {
  return SPLIT_FIELDS.map((field) => ({ key: SPLIT_KEYS[field], value: String(value[field]) }));
}

// Moves a saved scheme to regulation 2.9; writes nothing itself, returns what to update and insert.
export function upgradeScheme(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const none = { updates: [], inserts: [] };
  if (list.some((r) => r && r.key === SPLIT_KEYS.exam)) return none;
  const good = list.find((r) => r && r.key === SCHEME_KEYS.good);
  if (!good) return none;
  const inserts = splitToRows(DEFAULT_SPLIT);
  if (typeof good.value !== 'string' || good.value.trim() !== '76') return { updates: [], inserts };
  const scheme = {};
  for (const field of SCHEME_FIELDS) {
    const row = list.find((r) => r && r.key === SCHEME_KEYS[field]);
    const n = row ? toInt(row.value) : null;
    scheme[field] = n === null ? DEFAULT_SCHEME[field] : n;
  }
  scheme.good = 80;
  if (validateScheme(scheme).errors.length) return { updates: [], inserts };
  return { updates: [{ id: good.id, patch: { value: '80' } }], inserts };
}

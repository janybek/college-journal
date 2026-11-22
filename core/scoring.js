// The scoring scheme of the college: one for all subjects, stored in the settings.
export const DEFAULT_SCHEME = Object.freeze({
  attendance: 20, activity: 10, current: 40, self: 20, control: 40,
  minimum: 24, fair: 60, good: 76, excellent: 90, editDays: 3,
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

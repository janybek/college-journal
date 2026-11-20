// One row shape for every store (memory, file, sheets). No Node-only APIs: bundled for Apps Script.
const TRUE_STRINGS = ['true', 'да'];

export function shapeValue(type, v) {
  if (type === 'bool') {
    if (v === true || v === 1) return true;
    return typeof v === 'string' && TRUE_STRINGS.includes(v.trim().toLowerCase());
  }
  if (type === 'int') {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    if (typeof v !== 'string') return null;
    const text = v.trim();
    return /^-?\d+$/.test(text) ? parseInt(text, 10) : null;
  }
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// An object with exactly the keys of def.columns; foreign keys are dropped.
export function shapeRow(def, row) {
  const out = {};
  for (const c of def.columns) out[c.key] = shapeValue(c.type, row ? row[c.key] : undefined);
  return out;
}

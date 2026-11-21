import { AppError } from '../../core/errors.js';
import { IMPORT_SPECS, parseSheet, planImport } from '../../core/import.js';
import { loadDb, issueTempPassword } from './dir.js';
import { relayout } from '../scheduleData.js';

function checkCells(cells) {
  if (!Array.isArray(cells) || cells.some((row) => !Array.isArray(row))) throw new AppError('bad_request');
}

function parseAgainst(table, cells, db) {
  const parsed = parseSheet(table, cells, db, {});
  const badRows = new Set(parsed.errors.map((e) => e.row)).size;
  return { spec: table, table, db, parsed, badRows };
}

// Validates the request and parses the sheet against the current directory data.
function analyse(data, store) {
  const { table, cells } = data;
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(IMPORT_SPECS, table)) throw new AppError('bad_request');
  // A spec with its own storage table is a syllabus: it goes only through syllabus.* (kept until the old specs are removed).
  if (IMPORT_SPECS[table].table !== undefined) throw new AppError('bad_request');
  checkCells(cells);
  const db = loadDb(store, table, table === 'subjects' ? ['weekTemplate'] : []);
  return parseAgainst(table, cells, db);
}

// Every patched field already holds the same value (compared as text: a sheet may give 1 where the patch has '1').
const sameValues = (row, patch) => row !== undefined
  && Object.keys(patch).every((key) => String(row[key] ?? '') === String(patch[key] ?? ''));

function previewOf({ spec, db, parsed, badRows }) {
  const { records, errors, unknownColumns, missingColumns } = parsed;
  const plan = planImport(spec, records, db);
  return {
    total: records.length + badRows,
    valid: records.length,
    newCount: plan.toInsert.length,
    updateCount: plan.toUpdate.length,
    errors,
    unknownColumns,
    missingColumns,
  };
}

// A subjects import that gave a group another teacher: the group follows the syllabus of the new teacher, the lessons are laid again.
function relayoutTeachers(store, db, updated) {
  const before = new Map(db.subjects.map((s) => [s.id, s]));
  const moved = updated.filter((row) => before.get(row.id) !== undefined && before.get(row.id).teacherId !== row.teacherId).map((row) => row.id);
  if (moved.length === 0) return;
  const fresh = new Map(updated.map((row) => [row.id, row]));
  relayout(store, moved, { subjects: db.subjects.map((s) => fresh.get(s.id) ?? s) });
}

function applyOf({ spec, table, db, parsed, badRows }, { store, platform }) {
  const { records, errors, unknownColumns, missingColumns } = parsed;
  const report = { errors, unknownColumns, missingColumns };
  if (missingColumns.length > 0 || errors.some((e) => e.code === 'too_many_rows')) {
    return { inserted: 0, updated: 0, skipped: errors.length, passwords: [], ...report };
  }

  const plan = planImport(spec, records, db);
  const passwords = [];
  let toInsert = plan.toInsert;
  if (table === 'students' || table === 'staff') {
    toInsert = plan.toInsert.map((row) => {
      const { tempPassword, stored } = issueTempPassword(platform);
      passwords.push({ login: table === 'students' ? row.cardNo : row.login, fullName: row.fullName, tempPassword });
      return { ...row, ...stored, active: true };
    });
  }
  // Updates go first and new people last: if a write fails, nobody is left in the sheet with a lost password.
  // A row whose values are already stored is not written again (it still counts as updated).
  const stored = new Map(db[table].map((row) => [row.id, row]));
  const changed = plan.toUpdate.filter(({ id, patch }) => !sameValues(stored.get(id), patch));
  const updated = changed.length > 0 ? store.updateMany(table, changed) : [];
  const created = toInsert.length > 0 ? store.insertMany(table, toInsert) : [];
  if (table === 'subjects') relayoutTeachers(store, db, updated);
  return { inserted: toInsert.length, updated: plan.toUpdate.length, skipped: badRows, passwords, ...report };
}

export const importHandlers = {
  'import.preview': (data, ctx) => previewOf(analyse(data, ctx.store)),
  'import.apply': (data, ctx) => applyOf(analyse(data, ctx.store), ctx),
};

import { AppError } from '../../core/errors.js';
import { IMPORT_SPECS, parseSheet, planImport } from '../../core/import.js';
import { loadDb, issueTempPassword } from './dir.js';
import { relayout } from '../scheduleData.js';

// Validates the request and parses the sheet against the current directory data.
function analyse(data, store) {
  const { table, cells } = data;
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(IMPORT_SPECS, table)) throw new AppError('bad_request');
  if (!Array.isArray(cells) || cells.some((row) => !Array.isArray(row))) throw new AppError('bad_request');
  const db = loadDb(store, table, table === 'topics' ? ['groups', 'pairs'] : []);
  const parsed = parseSheet(table, cells, db);
  const badRows = new Set(parsed.errors.map((e) => e.row)).size;
  return { table, db, parsed, badRows };
}

// Every patched field already holds the same value (compared as text: a sheet may give 1 where the patch has '1').
const sameValues = (row, patch) => row !== undefined
  && Object.keys(patch).every((key) => String(row[key] ?? '') === String(patch[key] ?? ''));

function preview(data, ctx) {
  const { table, db, parsed, badRows } = analyse(data, ctx.store);
  const { records, errors, unknownColumns, missingColumns } = parsed;
  const plan = planImport(table, records, db);
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

// Topics changed: lay them over the pairs again, for the subjects the import touched.
function relayoutImported(store, db, updated, created) {
  const fresh = new Map(updated.map((row) => [row.id, row]));
  const topics = [...db.topics.map((row) => fresh.get(row.id) ?? row), ...created];
  const subjectIds = [...new Set([...updated, ...created].map((row) => row.subjectId))];
  if (subjectIds.length > 0) relayout(store, subjectIds, { topics, pairs: db.pairs });
}

function apply(data, ctx) {
  const { store, platform } = ctx;
  const { table, db, parsed, badRows } = analyse(data, store);
  const { records, errors, unknownColumns, missingColumns } = parsed;
  const report = { errors, unknownColumns, missingColumns };
  if (missingColumns.length > 0 || errors.some((e) => e.code === 'too_many_rows')) {
    return { inserted: 0, updated: 0, skipped: errors.length, passwords: [], ...report };
  }

  const plan = planImport(table, records, db);
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
  if (table === 'topics') relayoutImported(store, db, updated, created);
  return { inserted: toInsert.length, updated: plan.toUpdate.length, skipped: badRows, passwords, ...report };
}

export const importHandlers = {
  'import.preview': preview,
  'import.apply': apply,
};

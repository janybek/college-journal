import { AppError } from '../../core/errors.js';
import { IMPORT_SPECS, parseSheet, planImport } from '../../core/import.js';
import { loadDb, issueTempPassword } from './dir.js';

// Validates the request and parses the sheet against the current directory data.
function analyse(data, store) {
  const { table, cells } = data;
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(IMPORT_SPECS, table)) throw new AppError('bad_request');
  if (!Array.isArray(cells) || cells.some((row) => !Array.isArray(row))) throw new AppError('bad_request');
  const db = loadDb(store);
  const parsed = parseSheet(table, cells, db);
  const badRows = new Set(parsed.errors.map((e) => e.row)).size;
  return { table, db, parsed, badRows };
}

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
  if (toInsert.length > 0) store.insertMany(table, toInsert);
  for (const { id, patch } of plan.toUpdate) store.update(table, id, patch);
  return { inserted: toInsert.length, updated: plan.toUpdate.length, skipped: badRows, passwords, ...report };
}

export const importHandlers = {
  'import.preview': preview,
  'import.apply': apply,
};

// The syllabus page of a subject (#/syllabus/<subjectId>) without the DOM: the rows are those of syllabus.get,
// in the order of the plan, which is the order of the pairs.

// '2026-09-01' -> '01.09'
export function shortDate(date) {
  return date.slice(8, 10) + '.' + date.slice(5, 7);
}

// Rows of one unit that stand together: [{ unit, rows }].
export function unitGroups(rows) {
  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.unit === row.unit) last.rows.push(row);
    else groups.push({ unit: row.unit, rows: [row] });
  }
  return groups;
}

// Topics (not modules) that have a description, in the order of the plan.
export function describedRows(rows) {
  return rows.filter((row) => row.kind !== 'control' && typeof row.description === 'string' && row.description.trim() !== '');
}

// The plan has a column «СРС»: at least one row has a number there (zero is a number too).
export function hasSelfHours(rows) {
  return rows.some((row) => typeof row.selfHours === 'number');
}

// How many pairs of the row are still without a date. Only the current semester has dates at all.
export function undated(row, isCurrent) {
  return isCurrent ? Math.max(0, row.planned - row.pairs.length) : 0;
}

// What the page says about the plan and the schedule of the semester: [{ tone, key, params }].
export function scheduleNotes(view) {
  const { schedule, totals } = view.syllabus;
  if (schedule === null) return [{ tone: 'info', key: 'syllabus.otherSemester' }];
  if (schedule.pairs === 0) return [{ tone: 'info', key: 'syllabus.noSchedule' }];
  const notes = [];
  if (schedule.unplaced > 0) {
    notes.push({ tone: 'warning', key: 'syllabus.unplaced', params: { count: schedule.unplaced, planned: totals.pairs, scheduled: schedule.pairs } });
  }
  if (schedule.withoutTopic > 0) notes.push({ tone: 'info', key: 'syllabus.spare', params: { count: schedule.withoutTopic } });
  return notes.length > 0 ? notes : [{ tone: 'success', key: 'syllabus.fits', params: { pairs: schedule.pairs } }];
}

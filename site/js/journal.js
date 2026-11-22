// The list of journals (#/journal): what each row shows. Pure, no DOM, for tests.

// The rows of journal.list the active role works with. The teacher role: their own subjects and those where they
// taught single pairs (covers); the office roles (deanery, admin, vice-rector): every subject the server sent.
export function listRows(subjects, role) {
  const rows = Array.isArray(subjects) ? subjects : [];
  return role === 'teacher' ? rows.filter((row) => row.own === true || row.covers === true) : rows.slice();
}

// The marks of the column «не заполнено»: the pairs still open for marks, then those past their deadline.
// -> [{ tone, key, params }]; nothing when every held pair is filled in.
export function listBadges(row) {
  const unfilled = Number(row.unfilled) || 0;
  const overdue = Number(row.overdue) || 0;
  const badges = [];
  if (unfilled > overdue) badges.push({ tone: 'warning', key: 'journal.list.unfilled', params: { n: unfilled - overdue } });
  if (overdue > 0) badges.push({ tone: 'danger', key: 'journal.list.overdue', params: { n: overdue } });
  return badges;
}

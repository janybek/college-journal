// The deanery's «Предметы» (#/subjects) without the DOM. `rows` are those of subjects.overview: one row per
// «discipline + teacher», with the groups the teacher has the discipline in and the state of the syllabus.

const filled = (value) => typeof value === 'string' && value !== '';

// Groups that do not have this discipline yet and are not chosen in another row of the add window (`taken`: their ids).
export function freeGroups(groups, rows, disciplineId, taken = []) {
  const busy = new Set(taken);
  for (const row of rows) {
    if (row.disciplineId !== disciplineId) continue;
    for (const group of row.groups) busy.add(group.groupId);
  }
  return groups.filter((group) => !busy.has(group.id));
}

// A new row of the add window: most often the same teacher has the discipline in the next group too.
export function nextRow(items) {
  const last = items[items.length - 1];
  return { groupId: '', teacherId: last ? last.teacherId : '' };
}

// What subjects.add receives: rows left fully empty are dropped. ready: a discipline is chosen, there is a row,
// and every row has its group and its teacher.
export function addRequest(disciplineId, items) {
  const rows = items.filter((item) => filled(item.groupId) || filled(item.teacherId))
    .map((item) => ({ groupId: item.groupId, teacherId: item.teacherId }));
  const ready = filled(disciplineId) && rows.length > 0 && rows.every((item) => filled(item.groupId) && filled(item.teacherId));
  return { ready, data: { disciplineId, items: rows } };
}

// The syllabus of a «discipline + teacher» row for the semester that is on now.
export function syllabusBadge(row) {
  if (row.uploaded) return { tone: 'success', key: 'subjects.syllabus.uploaded', params: { hours: row.plannedHours, pairs: row.plannedPairs } };
  if (row.otherSemester) return { tone: 'neutral', key: 'subjects.syllabus.other' };
  return { tone: 'warning', key: 'subjects.syllabus.none' };
}

// Under a group of the row: the schedule of the semester holds another number of pairs than the plan.
export function pairsNote(row, group) {
  if (!row.uploaded || group.scheduledPairs === row.plannedPairs) return null;
  return { key: 'subjects.pairsDiffer', params: { planned: row.plannedPairs, scheduled: group.scheduledPairs } };
}

// After an add: the rows of this discipline that hold at least one of the subjects just created.
export function addedTeachers(rows, disciplineId, subjectIds) {
  const created = new Set(subjectIds);
  return rows.filter((row) => row.disciplineId === disciplineId && row.groups.some((group) => created.has(group.subjectId)));
}

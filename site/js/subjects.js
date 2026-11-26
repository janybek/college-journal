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

// The syllabus of a «discipline + teacher» row for the half of the year that is on now, as one mark. An open version
// speaks first (it is what someone has to act on): returned, under review, draft. Then the approved one with its hours
// and pairs, one for the other half of the year only, or none.
const OPEN_TONES = { returned: 'warning', review: 'info', draft: 'neutral' };

export function syllabusBadge(row) {
  if (OPEN_TONES[row.open]) return { tone: OPEN_TONES[row.open], key: 'subjects.syllabus.' + row.open };
  if (row.syllabusStatus === 'approved') return { tone: 'success', key: 'subjects.syllabus.approved', params: { hours: row.plannedHours, pairs: row.plannedPairs } };
  if (row.otherSemester) return { tone: 'neutral', key: 'subjects.syllabus.other' };
  return { tone: 'danger', key: 'subjects.syllabus.none' };
}

// Beside the mark of an open version: the approved one that is on the pairs meanwhile («утверждён: 36 ч, 18 пар»).
export function approvedNote(row) {
  if (!OPEN_TONES[row.open] || row.syllabusStatus !== 'approved') return null;
  return { key: 'subjects.syllabus.approvedNote', params: { hours: row.plannedHours, pairs: row.plannedPairs } };
}

// The mark of a subject in the teacher's «Мои предметы»: `syllabus` of teacher.mySubjects, { approved, open }.
export function teacherBadge(syllabus) {
  const open = syllabus ? syllabus.open : null;
  if (OPEN_TONES[open]) return { tone: OPEN_TONES[open], key: 'home.syllabusState.' + open };
  if (syllabus && syllabus.approved === true) return { tone: 'success', key: 'home.syllabusState.approved' };
  return { tone: 'danger', key: 'home.syllabusState.none' };
}

// What the teacher's button does on «Мои предметы»: the one who only teaches the discipline (the syllabus is written
// by the responsible) opens it, the others edit it.
export function teacherAction(syllabus) {
  return syllabus && syllabus.mine === 'teaches' ? 'open' : 'edit';
}

// Under a group of the row: the schedule of the semester holds another number of pairs than the plan. A group with
// no pairs at all has simply not had its schedule made yet: a calm line says so instead of «0 in the schedule».
export function pairsNote(row, group) {
  if (row.syllabusStatus !== 'approved' || group.scheduledPairs === row.plannedPairs) return null;
  if (group.scheduledPairs === 0) return { key: 'subjects.notScheduled', calm: true };
  return { key: 'subjects.pairsDiffer', params: { planned: row.plannedPairs, scheduled: group.scheduledPairs } };
}

// The mistakes of the add window's rows (`rowErrors`: { index: { groupId, teacherId } }) once the row `removed` is
// taken out: the rows below it move up a place, and their mistakes with them.
export function withoutRow(rowErrors, removed) {
  const left = {};
  for (const [key, errors] of Object.entries(rowErrors)) {
    const i = Number(key);
    if (i < removed) left[i] = errors;
    else if (i > removed) left[i - 1] = errors;
  }
  return left;
}

// After an add: the rows of this discipline that hold at least one of the subjects just created.
export function addedTeachers(rows, disciplineId, subjectIds) {
  const created = new Set(subjectIds);
  return rows.filter((row) => row.disciplineId === disciplineId && row.groups.some((group) => created.has(group.subjectId)));
}

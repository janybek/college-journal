// The syllabus page of a subject (#/syllabus/<subjectId>) without the DOM: the rows are those of syllabus.get,
// in the order of the plan, which is the order of the pairs.

// '2026-09-01' -> '01.09'
export function shortDate(date) {
  return date.slice(8, 10) + '.' + date.slice(5, 7);
}

// Rows of one unit that stand together: [{ unit, title, rows }]; the title is the one its rows carry ('' when none).
export function unitGroups(rows) {
  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.unit === row.unit) last.rows.push(row);
    else groups.push({ unit: row.unit, title: '', rows: [row] });
    const group = groups[groups.length - 1];
    if (group.title === '' && typeof row.unitTitle === 'string') group.title = row.unitTitle;
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

// What the page says about the plan and the schedule of the semester: [{ tone, key, params, counts }]. counts names the
// params that are a number of something: the page writes them with tCount(counts[name], n) («18 пар», not «18»).
export function scheduleNotes(view) {
  const { schedule, totals } = view.syllabus;
  if (schedule === null) return [{ tone: 'info', key: 'syllabus.otherSemester' }];
  if (schedule.pairs === 0) return [{ tone: 'info', key: 'syllabus.noSchedule' }];
  const notes = [];
  if (schedule.unplaced > 0) {
    notes.push({ tone: 'warning', key: 'syllabus.unplaced', params: { count: schedule.unplaced, planned: totals.pairs, scheduled: schedule.pairs } });
  }
  if (schedule.withoutTopic > 0) notes.push({ tone: 'info', key: 'syllabus.spare', params: { count: schedule.withoutTopic } });
  return notes.length > 0 ? notes : [{ tone: 'success', key: 'syllabus.fits', params: { pairs: schedule.pairs }, counts: { pairs: 'syllabus.pairsCount' } }];
}

// ---- The check window of an upload (syllabus.preview) ----

// A semester that replaces the uploaded one and both adds and removes rows may hold a renamed topic: a new name
// reads as one row gone and one added.
export function mayHaveRenamed(semester) {
  return semester.replaces && semester.added > 0 && semester.removed > 0;
}

// The window says what happens to a renamed topic when any semester of the file may hold one.
export function renamedHint(semesters) {
  return semesters.some(mayHaveRenamed);
}

// ---- The Excel file of a syllabus (syllabusBook in excel.js) ----

// The names core/syllabusFile.js reads: tests/i18n.test.js checks that the dictionaries repeat them in every language.
const FILE_INFO = ['discipline', 'teacher', 'course', 'semester', 'audience', 'credits', 'totalHours', 'classHours', 'selfHours'];
const FILE_PLAN = ['semester', 'unit', 'unitTitle', 'label', 'name', 'lectureHours', 'practiceHours', 'practiceKind', 'selfHours', 'description'];
const FILE_KINDS = ['seminar', 'lab', 'control'];

const textsOf = (text, prefix, keys) => Object.fromEntries(keys.map((key) => [key, text(prefix + key)]));

// text(key) -> the text of the dictionary. The labels of the file in the language of the screen.
export function fileLabels(text) {
  return {
    sheets: { info: text('syllabus.file.sheet.info'), plan: text('syllabus.file.sheet.plan') },
    info: textsOf(text, 'syllabus.file.info.', FILE_INFO),
    plan: textsOf(text, 'syllabus.file.plan.', FILE_PLAN),
    kinds: textsOf(text, 'syllabus.file.kind.', FILE_KINDS),
  };
}

// The answer of syllabus.get -> what the file holds. No syllabus: the template with the discipline, the teacher and
// the course written in. A syllabus: the one shown, with the semester of the curriculum (planSemester, 1–8) — not the
// semester of the year — so that the downloaded file, uploaded again, stays the same semester.
// other: the answer of syllabus.get for the other semester of the year. When it has a syllabus of the same academic
// year (1 and 2, 3 and 4…), the file holds the whole year: «1-2» in «Сведения», the semester of every row in the plan,
// the autumn rows first — the file a teacher of a two-semester course would upload.
export function fileData(view, other = null) {
  const { subject, syllabus } = view;
  const who = { discipline: subject.name, teacher: subject.teacherName, course: subject.course };
  if (syllabus === null) return { info: who, rows: [] };
  const year = other && other.syllabus ? [view, other].sort((a, b) => a.semester - b.semester).map((v) => v.syllabus) : null;
  if (!year || Math.ceil(year[0].planSemester / 2) !== Math.ceil(year[1].planSemester / 2)) {
    const { planSemester, audience, credits, totalHours, classHours, selfHours, rows } = syllabus;
    return { info: { ...who, semester: planSemester, audience, credits, totalHours, classHours, selfHours }, rows };
  }
  const [autumn, spring] = year;
  return {
    info: {
      ...who, semester: autumn.planSemester + '-' + spring.planSemester, audience: present(autumn.audience) ? autumn.audience : spring.audience,
      ...Object.fromEntries(YEAR_NUMBERS.map((key) => [key, yearNumber(autumn[key], spring[key])])),
    },
    rows: [...autumn.rows.map((row) => ({ ...row, semester: autumn.planSemester })), ...spring.rows.map((row) => ({ ...row, semester: spring.planSemester }))],
  };
}

const present = (value) => value !== null && value !== undefined && value !== '';
const YEAR_NUMBERS = ['credits', 'totalHours', 'classHours', 'selfHours'];
// A number of the year: a file of the whole year gave both halves the same numbers; two files of a semester each — their sum.
function yearNumber(a, b) {
  if (a === b || !present(b)) return a;
  return present(a) ? Number(a) + Number(b) : b;
}

// «Силлабус — Информатика — Teacher One.xlsx»: the parts joined; characters a file name cannot hold are dropped,
// empty parts left out.
export function fileName(parts, extension = '.xlsx') {
  const clean = parts.map((part) => String(part ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim())
    .filter((part) => part !== '');
  return clean.join(' — ').slice(0, 150).trim() + extension;
}

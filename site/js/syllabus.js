// The syllabus page of a subject (#/syllabus/<subjectId>) without the DOM: the rows are those of syllabus.get, one
// lesson each (lessonKind, hours, number of the journal), in the order of the plan, which is the order of the pairs.

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

// Lessons (not modules) that have a description, in the order of the plan.
export function describedRows(rows) {
  return rows.filter((row) => row.lessonKind !== 'control' && typeof row.description === 'string' && row.description.trim() !== '');
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

// ---- The version shown and what may be done with it ----

const OPEN_TONES = { draft: 'neutral', review: 'primary', returned: 'warning' };

// The line of the status of the version shown: { tone, key, params }. view: the answer of syllabus.get.
export function versionLine(view) {
  const { approved, open } = view.state || {};
  if (view.shown === 'open') {
    if (!open) return { tone: 'neutral', key: 'syllabus.state.noOpen', params: {} };
    return { tone: OPEN_TONES[open.status] ?? 'neutral', key: 'syllabus.state.' + open.status, params: { version: open.version } };
  }
  if (!approved) return { tone: 'neutral', key: 'syllabus.state.none', params: {} };
  return approved.decidedAt
    ? { tone: 'success', key: 'syllabus.state.approved', params: { version: approved.version, date: shortDate(approved.decidedAt) } }
    : { tone: 'success', key: 'syllabus.state.approvedUndated', params: { version: approved.version } };
}

// The buttons of the head of the page, in their order: into the form ('fill' while there is no version, 'continue'
// while one is open, 'edit' to start a new one from the approved), 'submit' the open version, the decision of the
// deanery on the version it is looking at ('approve', 'giveBack'), and the way to the other version ('showOpen',
// 'showApproved'). The server gives the rights (view.can); the page only leaves out what is not there.
export function pageActions(view) {
  const can = view.can || {};
  const { approved, open } = view.state || {};
  const out = [];
  if (can.fill) out.push('fill');
  else if (can.edit) out.push(open ? 'continue' : 'edit');
  if (can.submit && open) out.push('submit');
  if (view.shown === 'open' && open) {
    if (can.approve) out.push('approve');
    if (can.giveBack) out.push('giveBack');
  }
  if (view.shown === 'open' ? approved : open) out.push(view.shown === 'open' ? 'showApproved' : 'showOpen');
  return out;
}

// A text written «a point per line» -> the points: the lines without the spaces at their edges, empty ones left out.
export function linesOf(text) {
  if (typeof text !== 'string') return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

// A link of «Программное обеспечение» is a link only when it starts with http:// or https://; anything else
// (javascript:, a bare address, a space in front) is shown as text.
export function safeLink(link) {
  return typeof link === 'string' && /^https?:\/\/\S+$/.test(link) ? link : null;
}

// The note of the last decision on the page («Силлабус утверждён…»): { key, at }, `at` the address key it was made for
// ('subjectId|semester|version'). Another half of the year, version or subject drops it; the address the page goes
// to right after the decision keeps it.
export function keptDone(done, key) {
  return done && done.at === key ? done : null;
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
const FILE_KINDS = ['lecture', 'practice', 'seminar', 'lab', 'control'];

const textsOf = (text, prefix, keys) => Object.fromEntries(keys.map((key) => [key, text(prefix + key)]));

// text(key) -> the text of the dictionary. The labels of the file in the language of the screen: the sheets, the
// lines of «Сведения», the columns of the plan, the words of the kinds and the letters of «№» (Л1, П2…).
export function fileLabels(text) {
  return {
    sheets: { info: text('syllabus.file.sheet.info'), plan: text('syllabus.file.sheet.plan') },
    info: textsOf(text, 'syllabus.file.info.', FILE_INFO),
    plan: textsOf(text, 'syllabus.file.plan.', FILE_PLAN),
    kinds: textsOf(text, 'syllabus.file.kind.', FILE_KINDS),
    letters: textsOf(text, 'lessonType.short.', FILE_KINDS),
  };
}

// The answer of syllabus.form (its document as last saved) -> what «Скачать (Excel)» of the form writes: «Сведения»
// from the title, the plan as one row per lesson in the order of the pairs, each with its unit, the title of the
// unit, the number of the journal, the СРС hours and the description of its row of the plan.
export function draftFileData(form) {
  const { subject, syllabus, doc } = form;
  const title = doc.title || {};
  const units = (doc.plan && doc.plan.units) || [];
  const rowOf = new Map();
  for (const unit of units) {
    for (const kind of ['lecture', 'practice', 'seminar', 'lab', 'control']) for (const row of unit[kind] || []) rowOf.set(row.id, row);
  }
  const info = {
    discipline: subject.name, teacher: subject.teacherName, course: title.course, semester: title.planSemester ?? syllabus.planSemester,
    audience: title.audience, credits: title.credits, totalHours: title.totalHours, classHours: title.classHours, selfHours: title.selfHours,
  };
  const rows = (doc.lessons || []).map((lesson) => {
    const row = rowOf.get(lesson.id) || {};
    const unit = units[lesson.unit - 1] || {};
    return {
      unit: lesson.unit, unitTitle: unit.title ?? '', lessonKind: lesson.lessonKind, number: lesson.number, name: lesson.name, hours: lesson.hours,
      selfHours: row.selfHours ?? null, description: row.description ?? '',
    };
  });
  return { info, rows };
}

// The answer of syllabus.get -> what the file holds. No syllabus: the template with the discipline, the teacher and
// the course written in. A syllabus: the one shown, with the semester of the curriculum (planSemester, 1–8) — not the
// semester of the year — so that the downloaded file, uploaded again, stays the same semester.
// other: the answer of syllabus.get for the other semester of the year. The file holds the whole year («1-2» in
// «Сведения», the semester of every row in the plan, the autumn rows first — the file a teacher of a two-semester
// course would upload) only when the same file, uploaded back, changes nothing: see yearInfo. Otherwise it is the
// semester shown, as one semester's file.
export function fileData(view, other = null) {
  const { subject, syllabus } = view;
  const who = { discipline: subject.name, teacher: subject.teacherName, course: subject.course };
  if (syllabus === null) return { info: who, rows: [] };
  const [autumn, spring] = other && other.syllabus ? [view, other].sort((a, b) => a.semester - b.semester).map((v) => v.syllabus) : [];
  const year = autumn ? yearInfo(autumn, spring) : null;
  if (year === null) {
    const { planSemester, audience, credits, totalHours, classHours, selfHours, rows } = syllabus;
    return { info: { ...who, semester: planSemester, audience, credits, totalHours, classHours, selfHours }, rows };
  }
  return {
    info: { ...who, semester: autumn.planSemester + '-' + spring.planSemester, ...year },
    rows: [...autumn.rows.map((row) => ({ ...row, semester: autumn.planSemester })), ...spring.rows.map((row) => ({ ...row, semester: spring.planSemester }))],
  };
}

const present = (value) => value !== null && value !== undefined && value !== '';
const YEAR_INFO = ['audience', 'credits', 'totalHours', 'classHours', 'selfHours'];
const asText = (value) => (present(value) ? String(value) : '');

// The one «Сведения» of a year file, or null when there can be none. An upload writes the «Сведения» of its file to
// every semester in it and checks its hours against the plan of the whole file. So both semesters must be one academic
// year and store the same specialty, credits and hours (two files of a semester each store their own: no sheet holds
// both), and the classroom hours and the СРС (when the plan gives it) must be those of the plan of the year — else the
// file, uploaded unchanged, would bring a remark its semesters never had.
function yearInfo(autumn, spring) {
  if (Math.ceil(autumn.planSemester / 2) !== Math.ceil(spring.planSemester / 2)) return null;
  if (!YEAR_INFO.every((key) => asText(autumn[key]) === asText(spring[key]))) return null;
  const rows = [...autumn.rows, ...spring.rows];
  const classHours = rows.reduce((n, row) => n + (Number(row.hours) || 0), 0);
  const selfRows = rows.filter((row) => typeof row.selfHours === 'number');
  if (present(autumn.classHours) && Number(autumn.classHours) !== classHours) return null;
  if (present(autumn.selfHours) && selfRows.length > 0 && Number(autumn.selfHours) !== selfRows.reduce((n, row) => n + row.selfHours, 0)) return null;
  return Object.fromEntries(YEAR_INFO.map((key) => [key, autumn[key]]));
}

// «Силлабус — Информатика — Teacher One.xlsx»: the parts joined; characters a file name cannot hold are dropped,
// empty parts left out.
export function fileName(parts, extension = '.xlsx') {
  const clean = parts.map((part) => String(part ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim())
    .filter((part) => part !== '');
  return clean.join(' — ').slice(0, 150).trim() + extension;
}

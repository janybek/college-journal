import { ledgerColumns, admissionCell, examCell, finalCell, isLow, wordCounts, attemptLines, scoreWord } from './ledger.js';

// What the ledger and the exam sheet look like on paper and in an Excel file: the same rows for both. No DOM here and no
// library of its own (XLSX comes from outside), so the tests run it as it is. Every number is the server's; nothing is counted
// again except the number of students per word, as on the screen. A student who left is not printed.
// labels: { t, sheet } — t(key, params) is the translator of the screen, sheet is the name of the sheet of the file.

const BLANK = '';
const SIGN_LINE = '____________';
const FIELDS = ['current', 'self', 'control', 'total'];
const WORDS = ['excellent', 'good', 'fair', 'fail'];
const STATE_KEYS = ['absent', 'incomplete', 'notAdmitted'];

const dayFull = (date) => (typeof date === 'string' && date.length >= 10 ? `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}` : BLANK);
const present = (view) => view.students.filter((s) => !s.left);
const numberOrBlank = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : BLANK);
const planSemesterOf = (subject) => String(subject.planSemester ?? subject.semester ?? BLANK);

// A part of a file name: the signs a file name may not have become «_», nothing empty, not too long.
export function safeFilePart(text, max = 40) {
  // eslint-disable-next-line no-control-regex
  const cleaned = [...String(text ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim()].slice(0, max).join('').trim();
  return cleaned === '' ? '_' : cleaned;
}

export function ledgerFileName(view, prefix) {
  const { subject } = view;
  return `${safeFilePart(prefix)}_${safeFilePart(subject.name)}_${safeFilePart(subject.groupName)}_${view.today}.xlsx`;
}

export function examSheetFileName(view, prefix) {
  const { subject } = view;
  return `${safeFilePart(prefix)}_${safeFilePart(subject.name)}_${safeFilePart(subject.groupName)}_${view.exam.date || view.today}.xlsx`;
}

// The line of the group under the table: how many have each word (the four words always once someone has a result, none on a sheet taken
// to the exam), the other states when there are some.
function countsLine(students, t) {
  const counts = wordCounts(students);
  const resulted = counts.absent + counts.incomplete + WORDS.reduce((sum, word) => sum + counts[word], 0) > 0;
  const parts = resulted ? WORDS.map((word) => `${t('journal.grade.' + word)}: ${counts[word]}`) : [];
  for (const key of STATE_KEYS) if (counts[key] > 0) parts.push(`${t('ledger.print.count.' + key)}: ${counts[key]}`);
  return parts.join(' · ');
}

const signLine = (label, name) => (name ? `${label} ${SIGN_LINE} / ${name}` : `${label} ${SIGN_LINE}`);

// ---- The ledger of a subject ----

// The sheet of the ledger as a structure: the head, the two rows of the titles with their merges, the rows of students with
// a flag for every number under the pass mark, the line of counts and the signatures.
export function ledgerSheet(view, labels) {
  const { t } = labels;
  const { subject, split } = view;
  const ready = view.exam.ready === true;
  const closed = view.final.closed === true;
  const units = ledgerColumns(view).filter((c) => c.type === 'unit');

  const head1 = [t('ledger.print.no'), t('ledger.col.student')];
  const head2 = [BLANK, BLANK];
  const merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }];
  for (const unit of units) {
    head1.push(unit.title ? t('ledger.unit.head', { n: unit.unit, title: unit.title }) : t('ledger.unit.headPlain', { n: unit.unit }), BLANK, BLANK, BLANK);
    merges.push({ s: { r: 0, c: head1.length - 4 }, e: { r: 0, c: head1.length - 1 } });
    for (const field of FIELDS) head2.push(t('journal.col.' + field));
  }
  const sums = [t('ledger.col.semester', { max: split.semester }), t('ledger.col.admission'), t('ledger.col.exam', { max: split.exam }),
    t('ledger.col.final', { max: split.semester + split.exam }), t('ledger.col.word')];
  for (const title of sums) {
    head1.push(title);
    head2.push(BLANK);
    merges.push({ s: { r: 0, c: head1.length - 1 }, e: { r: 1, c: head1.length - 1 } });
  }

  const body = [];
  const low = [];
  present(view).forEach((student, index) => {
    const row = [index + 1, student.fullName || BLANK];
    const flags = [false, false];
    for (const unit of units) {
      const result = student.units.find((u) => u.unit === unit.unit);
      for (const field of FIELDS) {
        row.push(result ? numberOrBlank(result[field]) : BLANK);
        flags.push(result ? isLow(result, field) : false);
      }
    }
    const admission = admissionCell(student, ready, split);
    const exam = examCell(student);
    const last = finalCell(student, { ready, closed });
    row.push(
      numberOrBlank(student.semester),
      admission.key ? t(admission.key, admission.params) : BLANK,
      student.status === 'done' ? numberOrBlank(student.exam) : exam.key ? t(exam.key) : BLANK,
      ready && student.status === 'done' ? numberOrBlank(student.total) : BLANK,
      last.key ? t(last.key) : BLANK);
    flags.push(student.complete === true && student.admitted !== true, admission.tone === 'danger', false, student.status === 'done' && student.word === 'fail', student.status === 'done' && student.word === 'fail');
    body.push(row);
    low.push(flags);
  });

  const facts = [
    [t('ledger.exam.subject'), subject.name],
    [t('ledger.exam.group'), subject.groupName],
    [t('ledger.print.teacher'), subject.teacherName || BLANK],
    [t('ledger.exam.semester'), planSemesterOf(subject)],
    [t('ledger.print.date'), dayFull(view.today)],
  ];
  return {
    college: view.collegeName || BLANK,
    title: t('ledger.print.title'),
    draft: closed ? BLANK : t('ledger.print.draft'),
    facts, head: [head1, head2], merges, body, low,
    counts: ready ? countsLine(view.students, t) : BLANK,
    retakes: null,
    signs: [signLine(t('ledger.print.signTeacher'), subject.teacherName), signLine(t('ledger.print.signDean'), BLANK)],
  };
}

// ---- The exam sheet (regulation, item 27) ----

// The head: the college (when it is named), the discipline, the course, the group, the semester, the date, the examiner, the assistants.
export function examHeadLines(view, labels) {
  const { t } = labels;
  const { subject, exam } = view;
  const lines = [];
  if (view.collegeName) lines.push([t('ledger.print.college'), view.collegeName]);
  lines.push(
    [t('ledger.exam.subject'), subject.name],
    [t('ledger.exam.course'), subject.course === null || subject.course === undefined ? BLANK : String(subject.course)],
    [t('ledger.exam.group'), subject.groupName],
    [t('ledger.exam.semester'), planSemesterOf(subject)],
    [t('ledger.exam.date'), dayFull(exam.date)],
    [t('ledger.exam.examiner'), exam.examiner || subject.teacherName || BLANK],
    [t('ledger.exam.assistants'), exam.assistants || BLANK]);
  return lines;
}

// The same shape as ledgerSheet. The points of the exam and the total are numbers only for those who sat it; for the others
// the words «не допущен», «не явился(ась)», «I» stand in the column of the grade, and before the exam those cells are empty.
export function examSheet(view, labels) {
  const { t } = labels;
  const { subject, split, exam } = view;
  const head = [t('ledger.print.no'), t('ledger.print.fullName'), t('ledger.col.semester', { max: split.semester }), t('ledger.col.exam', { max: split.exam }),
    t('ledger.col.final', { max: split.semester + split.exam }), t('ledger.col.word')];
  const body = [];
  const low = [];
  const retakes = [];
  present(view).forEach((student, index) => {
    const done = student.status === 'done';
    const last = finalCell(student, { ready: true, closed: true });
    body.push([index + 1, student.fullName || BLANK, numberOrBlank(student.semester), done ? numberOrBlank(student.exam) : BLANK, done ? numberOrBlank(student.total) : BLANK, last.key ? t(last.key) : BLANK]);
    const fail = done && student.word === 'fail';
    low.push([false, false, student.complete === true && student.admitted !== true, false, fail, fail]);
    if (student.attempts.length > 1) {
      for (const line of attemptLines(student.attempts)) {
        if (line.label.key === 'ledger.attempt.first') continue;
        retakes.push([student.fullName || BLANK, dayFull(line.date), t(line.label.key, line.label.params),
          line.result.key ? t(line.result.key) : numberOrBlank(Number(line.result.text)), line.commission]);
      }
    }
  });
  const examiner = exam.examiner || subject.teacherName || BLANK;
  return {
    college: BLANK,
    title: t('ledger.exam.sheetTitle'),
    draft: BLANK,
    facts: examHeadLines(view, labels),
    head: [head], merges: [], body, low,
    counts: countsLine(view.students, t),
    retakes: retakes.length > 0 ? { title: t('ledger.print.retakes'), rows: retakes } : null,
    signs: [signLine(t('ledger.print.signExaminer'), examiner), `${t('ledger.print.signAssistants')} ${SIGN_LINE}`, `${t('ledger.print.signDirector')} ${SIGN_LINE}`],
  };
}

// ---- Rows of the sheet of a file ----

// The facts stand in the column of the names and its neighbour, so a narrow column of numbers does not cut them.
function fileRows(sheet) {
  const rows = [];
  if (sheet.college) rows.push([sheet.college]);
  rows.push([sheet.title]);
  if (sheet.draft) rows.push([sheet.draft]);
  for (const [label, value] of sheet.facts) rows.push([BLANK, label, value]);
  rows.push([]);
  const headAt = rows.length;
  rows.push(...sheet.head, ...sheet.body);
  rows.push([]);
  if (sheet.counts) rows.push([sheet.counts]);
  if (sheet.retakes) {
    rows.push([], [sheet.retakes.title], ...sheet.retakes.rows.map((row) => [BLANK, ...row]));
  }
  rows.push([]);
  for (const line of sheet.signs) rows.push([line], []);
  rows.pop();
  return { rows, headAt };
}

export function ledgerRows(view, labels) {
  return fileRows(ledgerSheet(view, labels)).rows;
}

export function examSheetRows(view, labels) {
  return fileRows(examSheet(view, labels)).rows;
}

// A cell of the file. A text is always a text cell: a name that begins with «=» is not a formula.
function cellOf(value) {
  if (typeof value === 'number') return { t: 'n', v: value };
  if (value === BLANK || value === null || value === undefined) return null;
  return { t: 's', v: String(value) };
}

function bookOf(XLSX, sheet, name, widths) {
  const { rows, headAt } = fileRows(sheet);
  const book = XLSX.utils.book_new();
  const out = {};
  let columns = 0;
  rows.forEach((row, r) => row.forEach((value, c) => {
    const cell = cellOf(value);
    columns = Math.max(columns, c + 1);
    if (cell) out[XLSX.utils.encode_cell({ r, c })] = cell;
  }));
  columns = Math.max(columns, widths.length);
  out['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: columns - 1 } });
  out['!cols'] = widths.map((wch) => ({ wch }));
  out['!merges'] = sheet.merges.map((m) => ({ s: { r: m.s.r + headAt, c: m.s.c }, e: { r: m.e.r + headAt, c: m.e.c } }));
  XLSX.utils.book_append_sheet(book, out, name);
  return book;
}

export function ledgerBook(XLSX, view, labels) {
  const units = ledgerColumns(view).filter((c) => c.type === 'unit').length;
  const widths = [5, 32, ...Array(units * FIELDS.length).fill(7), 12, 34, 12, 12, 20];
  return bookOf(XLSX, ledgerSheet(view, labels), labels.sheet, widths);
}

export function examSheetBook(XLSX, view, labels) {
  return bookOf(XLSX, examSheet(view, labels), labels.sheet, [5, 34, 16, 16, 16, 24]);
}

// ---- The sheet of a state exam ----

export function stateExamFileName(view, prefix) {
  const { exam } = view;
  return `${safeFilePart(prefix)}_${safeFilePart(exam.name)}_${safeFilePart(exam.groupName)}_${exam.date}.xlsx`;
}

// The line under the table: the words of the group (once someone has a score), those without a score, the average.
function scoreCountsLine(view, t) {
  const { stats } = view;
  const parts = stats.entered > 0 ? WORDS.map((word) => `${t('journal.grade.' + word)}: ${stats[word]}`) : [];
  if (stats.total > stats.entered) parts.push(`${t('stateExam.missing')}: ${stats.total - stats.entered}`);
  if (stats.average !== null && stats.average !== undefined) parts.push(t('stateExam.average', { n: stats.average }));
  return parts.join(' · ');
}

// The same shape as ledgerSheet: the head, the table of students (those who left only with a score), the counts, the commission.
export function stateExamSheet(view, labels) {
  const { t } = labels;
  const { exam } = view;
  const body = [];
  const low = [];
  for (const student of view.students) {
    const word = scoreWord(student.score, view.scheme);
    body.push([body.length + 1, student.fullName || BLANK, numberOrBlank(student.score), word ? t('journal.grade.' + word) : BLANK]);
    low.push([false, false, word === 'fail', word === 'fail']);
  }
  return {
    college: view.collegeName || BLANK,
    title: t('stateExam.print.title'),
    draft: BLANK,
    facts: [[t('stateExam.print.name'), exam.name], [t('stateExam.print.group'), exam.groupName], [t('stateExam.print.date'), dayFull(exam.date)]],
    head: [[t('ledger.print.no'), t('ledger.print.fullName'), t('stateExam.col.score'), t('stateExam.col.word')]],
    merges: [], body, low,
    counts: scoreCountsLine(view, t),
    retakes: null,
    signs: [signLine(t('stateExam.print.signChair'), BLANK), signLine(t('stateExam.print.signMembers'), BLANK)],
  };
}

export function stateExamRows(view, labels) {
  return fileRows(stateExamSheet(view, labels)).rows;
}

export function stateExamBook(XLSX, view, labels) {
  return bookOf(XLSX, stateExamSheet(view, labels), labels.sheet, [5, 34, 10, 24]);
}

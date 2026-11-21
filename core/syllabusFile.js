import { HOURS_PER_PAIR } from './topics.js';

// Reading the two-sheet syllabus file («Сведения» and «Тематический план»). No storage, no network.

export const MAX_SHEET_ROWS = 300;
export const HOURS_ALLOWED = [0, HOURS_PER_PAIR, 2 * HOURS_PER_PAIR];
export const DESCRIPTION_MAX = 1000;

const TEXT_MAX = 200;
const LABEL_MAX = 20;
const KIND_CONTROL = 'control';

export const SYLLABUS_SHEETS = {
  info: { ru: 'Сведения', ky: 'Маалымат', en: 'Details' },
  plan: { ru: 'Тематический план', ky: 'Тематикалык план', en: 'Thematic plan', aliases: ['Календарно-тематический план'] },
};

export const INFO_ROWS = [
  { key: 'discipline', titles: { ru: 'Дисциплина', ky: 'Дисциплина', en: 'Discipline' }, aliases: ['Предмет', 'Сабак', 'Subject'] },
  { key: 'teacher', titles: { ru: 'Преподаватель', ky: 'Окутуучу', en: 'Teacher' } },
  { key: 'course', titles: { ru: 'Курс', ky: 'Курс', en: 'Year' } },
  { key: 'semester', titles: { ru: 'Семестр', ky: 'Семестр', en: 'Semester' } },
  { key: 'audience', titles: { ru: 'Специальность', ky: 'Адистик', en: 'Specialty' }, aliases: ['Для кого', 'Для кого (специальность)'] },
  { key: 'credits', titles: { ru: 'Кредиты', ky: 'Кредиттер', en: 'Credits' }, aliases: ['Кредитов'] },
  { key: 'totalHours', titles: { ru: 'Всего часов', ky: 'Бардык сааттар', en: 'Total hours' }, aliases: ['Всего'] },
  { key: 'classHours', titles: { ru: 'Аудиторных часов', ky: 'Аудиториялык сааттар', en: 'Classroom hours' }, aliases: ['Аудиторных', 'Аудиторные часы'] },
  { key: 'selfHours', titles: { ru: 'СРС, часов', ky: 'СӨИ, саат', en: 'Self-study hours' }, aliases: ['СРС', 'СРС (часов)'] },
];

export const PLAN_COLUMNS = [
  { key: 'semester', titles: { ru: 'Семестр', ky: 'Семестр', en: 'Semester' }, required: false },
  { key: 'unit', titles: { ru: 'Юнит', ky: 'Юнит', en: 'Unit' }, aliases: ['Раздел', 'Модуль', 'Module'], required: false },
  { key: 'label', titles: { ru: '№', ky: '№', en: 'No.' }, aliases: ['№ темы', 'No', 'N'], required: false },
  { key: 'name', titles: { ru: 'Тема', ky: 'Тема', en: 'Topic' }, aliases: ['Название', 'Название темы', 'Наименование темы'], required: true },
  {
    key: 'lectureHours',
    titles: { ru: 'Лекция, ч (1 пара = 2 ч)', ky: 'Лекция, саат (1 жуп = 2 саат)', en: 'Lecture, h (1 class = 2 h)' },
    aliases: ['Лекция, ч', 'Лекция (ч)', 'Лекции (ч)', 'Лекция', 'Лекции', 'Теория, ч', 'Lecture'],
    required: true,
  },
  {
    key: 'practiceHours',
    titles: { ru: 'Практика, ч (1 пара = 2 ч)', ky: 'Практика, саат (1 жуп = 2 саат)', en: 'Practice, h (1 class = 2 h)' },
    aliases: ['Практика, ч', 'Практика (ч)', 'Практика', 'Практические', 'Practice'],
    required: true,
  },
  { key: 'practiceKind', titles: { ru: 'Вид занятия', ky: 'Сабактын түрү', en: 'Class type' }, required: false },
  { key: 'selfHours', titles: { ru: 'СРС, ч', ky: 'СӨИ, саат', en: 'Self-study, h' }, aliases: ['СРС', 'СРС (ч)'], required: false },
  { key: 'description', titles: { ru: 'Описание', ky: 'Сүрөттөмө', en: 'Description' }, aliases: ['Краткое описание', 'Short description'], required: false },
];

// Cell text and the keys below are compared in this form: lower case, digits, dots and «№» removed, spaces squeezed.
const kindWord = (text) => String(text ?? '').toLowerCase().replace(/[0-9.№]/g, '').replace(/\s+/g, ' ').trim();

const ORDINARY = ['', 'практика', 'практическое', 'практическое занятие', 'пз', 'лекция', 'теория', 'practice', 'lecture'];
const SEMINAR = ['семинар', 'семинарское занятие', 'seminar'];
const LAB = ['лабораторная', 'лабораторное', 'лабораторное занятие', 'lab', 'laboratory'];
const CONTROL = ['модуль', 'рубежный контроль', 'рубежный', 'контроль', 'module', 'control', 'аралык көзөмөл', 'аралык текшерүү'];

export const KIND_WORDS = {};
for (const [kind, words] of [['', ORDINARY], ['seminar', SEMINAR], ['lab', LAB], [KIND_CONTROL, CONTROL]]) {
  for (const word of words) KIND_WORDS[kindWord(word)] = kind;
}

const normTitle = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\s*:$/, '');

function titleIndex(items) {
  const index = new Map();
  for (const item of items) {
    const titles = item.titles ?? item;
    for (const title of [titles.ru, titles.ky, titles.en, ...(item.aliases ?? [])]) {
      const key = normTitle(title);
      if (!index.has(key)) index.set(key, item.key ?? null);
    }
  }
  return index;
}

const INFO_INDEX = titleIndex(INFO_ROWS);
const PLAN_INDEX = titleIndex(PLAN_COLUMNS);
const SHEET_INDEX = { info: titleIndex([SYLLABUS_SHEETS.info]), plan: titleIndex([SYLLABUS_SHEETS.plan]) };

const isEmpty = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

// Whole number from a number or a text of digits; null for anything else (2.5, -2, «два»).
function toInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*\d+\s*$/.test(value)) return parseInt(value, 10);
  return null;
}

const toText = (value) => (isEmpty(value) ? '' : typeof value === 'string' ? value.trim() : String(value));
// Rows up to the last non-empty one: blank rows at the end of a sheet are not counted.
const usedRows = (cells) => {
  let n = cells.length;
  while (n > 0 && !(Array.isArray(cells[n - 1]) && cells[n - 1].some((c) => !isEmpty(c)))) n -= 1;
  return n;
};
const inRange = (n, min, max) => n !== null && n >= min && n <= max;

function parseSemesterCell(value) {
  if (isEmpty(value)) return { ok: true, value: null };
  const n = toInt(value);
  if (inRange(n, 1, 8)) return { ok: true, value: n };
  const pair = typeof value === 'string' ? /^\s*(\d+)\s*(?:-|–|—|,|;|\/|и)\s*(\d+)\s*$/.exec(value) : null;
  if (pair && inRange(+pair[1], 1, 8) && inRange(+pair[2], 1, 8)) return { ok: true, value: null };
  return { ok: false, value: null };
}

function findSheet(sheets, kind) {
  return sheets.find((sheet) => SHEET_INDEX[kind].has(normTitle(sheet.name))) ?? null;
}

function readInfo(sheet, errors, ignored) {
  const info = { discipline: '', teacher: '', semester: null, audience: '', credits: null, totalHours: null, classHours: null, selfHours: null };
  let semesterBad = false;
  let semesterRow = 0;
  let semesterEmpty = true;
  const used = usedRows(sheet.cells);
  if (used > MAX_SHEET_ROWS) {
    errors.push({ sheet: 'info', row: 0, field: '', code: 'too_many_rows' });
    return { info, semesterBad, semesterRow, semesterEmpty };
  }
  const seen = new Set();
  sheet.cells.slice(0, used).forEach((cells, i) => {
    const row = i + 1;
    const line = Array.isArray(cells) ? cells : [];
    if (isEmpty(line[0])) return;
    const key = INFO_INDEX.get(normTitle(line[0]));
    if (!key || seen.has(key)) { ignored.push(toText(line[0])); return; }
    seen.add(key);
    const value = line[1];
    const bad = (field) => errors.push({ sheet: 'info', row, field, code: 'bad_value' });
    if (key === 'course') return;
    if (key === 'semester') {
      semesterRow = row;
      semesterEmpty = isEmpty(value);
      const parsed = parseSemesterCell(value);
      if (parsed.ok) info.semester = parsed.value; else { semesterBad = true; bad(key); }
    } else if (key === 'discipline' || key === 'teacher' || key === 'audience') {
      const text = toText(value);
      if (text.length > TEXT_MAX) errors.push({ sheet: 'info', row, field: key, code: 'too_long' }); else info[key] = text;
    } else if (!isEmpty(value)) {
      const n = toInt(value);
      const [min, max] = key === 'credits' ? [1, 60] : key === 'totalHours' ? [1, 2000] : [0, 2000];
      if (inRange(n, min, max)) info[key] = n; else bad(key);
    }
  });
  return { info, semesterBad, semesterRow, semesterEmpty };
}

// «2», «2 ч», «2ч», «2 ч.», «2,0», «2.0»
function hoursText(text) {
  const m = /^\s*(\d+)(?:[.,]0+)?\s*(?:ч\.?)?\s*$/i.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

function readHours(value) {
  if (isEmpty(value)) return { ok: true, value: 0 };
  const n = typeof value === 'string' ? hoursText(value) : toInt(value);
  return n !== null && HOURS_ALLOWED.includes(n) ? { ok: true, value: n } : { ok: false, value: 0 };
}

function readPlan(sheet, infoSemester, infoSemesterBad, errors, ignored, flags, infoSemesterEmpty) {
  const rows = [];
  const used = usedRows(sheet.cells);
  if (used > MAX_SHEET_ROWS) {
    errors.push({ sheet: 'plan', row: 0, field: '', code: 'too_many_rows' });
    return rows;
  }
  const head = Array.isArray(sheet.cells[0]) ? sheet.cells[0] : [];
  const at = {};
  head.forEach((title, i) => {
    if (isEmpty(title)) return;
    const key = PLAN_INDEX.get(normTitle(title));
    if (!key || key in at) ignored.push(toText(title)); else at[key] = i;
  });
  const missing = PLAN_COLUMNS.filter((c) => c.required && !(c.key in at));
  if (missing.length) {
    for (const c of missing) errors.push({ sheet: 'plan', row: 1, field: c.key, code: 'missing_column' });
    return rows;
  }
  // No semester anywhere: one error on the info sheet instead of one per plan row.
  if (infoSemester === null && infoSemesterEmpty && !infoSemesterBad && !('semester' in at)) { flags.noSemester = true; infoSemesterBad = true; }
  const colIndex = (key) => PLAN_COLUMNS.findIndex((c) => c.key === key);
  const lastUnit = {};
  let lastSemester = 0;
  const rowErrors = [];
  for (let i = 1; i < used; i += 1) {
    const line = Array.isArray(sheet.cells[i]) ? sheet.cells[i] : [];
    const cell = (key) => (key in at ? line[at[key]] : undefined);
    if (PLAN_COLUMNS.every((c) => isEmpty(cell(c.key)))) continue;
    const row = i + 1;
    const found = [];
    const fail = (field, code) => found.push({ sheet: 'plan', row, field, code });

    const word = kindWord(cell('practiceKind'));
    const known = Object.hasOwn(KIND_WORDS, word);
    const wordKind = known ? KIND_WORDS[word] : '';
    const isControl = wordKind === KIND_CONTROL;
    if (!known) fail('practiceKind', 'bad_value');

    let semester = null;
    const semesterValue = cell('semester');
    if (!isEmpty(semesterValue)) {
      const n = toInt(semesterValue);
      if (inRange(n, 1, 8)) semester = n; else fail('semester', 'bad_value');
    } else if (infoSemester !== null) {
      semester = infoSemester;
    } else if (!infoSemesterBad) {
      fail('semester', 'required');
    }
    if (semester !== null) {
      if (semester < lastSemester) fail('semester', 'semester_order'); else lastSemester = semester;
    }

    let unit = null;
    const unitValue = cell('unit');
    if (!isEmpty(unitValue)) {
      const n = toInt(unitValue);
      if (inRange(n, 1, 20)) unit = n; else fail('unit', 'bad_value');
    } else {
      unit = lastUnit[semester] ?? 1;
    }
    if (unit !== null && semester !== null) {
      if (unit < (lastUnit[semester] ?? 0)) fail('unit', 'unit_order'); else lastUnit[semester] = unit;
    }

    const label = toText(cell('label'));
    if (label.length > LABEL_MAX) fail('label', 'too_long');
    const name = toText(cell('name'));
    if (name.length > TEXT_MAX) fail('name', 'too_long');
    else if (!isControl && name === '') fail('name', 'required');

    const lecture = readHours(cell('lectureHours'));
    const practice = readHours(cell('practiceHours'));
    if (!lecture.ok) fail('lectureHours', 'bad_hours');
    else if (isControl && lecture.value > 0) fail('lectureHours', 'bad_value');
    if (!practice.ok || (isControl && practice.value > HOURS_PER_PAIR)) fail('practiceHours', 'bad_hours');
    if (!isControl && lecture.ok && practice.ok && lecture.value + practice.value === 0) fail('lectureHours', 'no_hours');
    if (!isControl && known && wordKind !== '' && practice.ok && practice.value === 0) fail('practiceKind', 'bad_value');

    let selfHours = null;
    if (!isEmpty(cell('selfHours'))) {
      const n = toInt(cell('selfHours'));
      if (inRange(n, 0, 200)) selfHours = n; else fail('selfHours', 'bad_value');
    }
    const description = toText(cell('description'));
    if (description.length > DESCRIPTION_MAX) fail('description', 'too_long');

    found.sort((a, b) => colIndex(a.field) - colIndex(b.field));
    rowErrors.push(...found);
    rows.push({
      kind: isControl ? KIND_CONTROL : 'topic', semester, unit, label, name,
      lectureHours: lecture.value, practiceHours: practice.value, practiceKind: isControl ? '' : wordKind,
      selfHours, description, row,
    });
  }
  errors.push(...rowErrors);

  if (!rows.some((r) => r.kind === 'topic')) errors.push({ sheet: 'plan', row: 0, field: '', code: 'empty' });
  const semesters = [...new Set(rows.map((r) => r.semester).filter((s) => s !== null))];
  if (semesters.length > 2 || (semesters.length === 2 && (semesters[0] % 2 === semesters[1] % 2 || Math.ceil(semesters[0] / 2) !== Math.ceil(semesters[1] / 2)))) {
    errors.push({ sheet: 'plan', row: 0, field: 'semester', code: 'semester_clash' });
  }
  return rows;
}

function planWarnings(info, rows, selfFilled) {
  const warnings = [];
  const empty = ['audience', 'credits', 'totalHours', 'classHours', 'selfHours'].filter((f) => info[f] === '' || info[f] === null);
  if (empty.length) warnings.push({ code: 'info_empty', fields: empty });
  const { totalHours, classHours, selfHours } = info;
  if (totalHours !== null && classHours !== null && selfHours !== null && classHours + selfHours !== totalHours) {
    warnings.push({ code: 'total_mismatch', total: totalHours, classHours, selfHours });
  }
  const planned = rows.reduce((n, r) => n + r.lectureHours + r.practiceHours, 0);
  if (classHours !== null && classHours !== planned) warnings.push({ code: 'class_mismatch', declared: classHours, planned });
  const plannedSelf = rows.reduce((n, r) => n + (r.selfHours ?? 0), 0);
  if (selfHours !== null && selfFilled && selfHours !== plannedSelf) warnings.push({ code: 'self_mismatch', declared: selfHours, planned: plannedSelf });
  const units = new Map();
  for (const r of rows) {
    const key = `${r.semester}:${r.unit}`;
    units.set(key, units.get(key) || r.kind === KIND_CONTROL);
  }
  const without = [...units.values()].filter((has) => !has).length;
  if (without > 0) warnings.push({ code: 'no_control', count: without });
  return warnings;
}

export function parseSyllabus(sheets) {
  const valid = Array.isArray(sheets)
    ? sheets.filter((s) => s && typeof s === 'object' && typeof s.name === 'string' && Array.isArray(s.cells))
    : [];
  const infoSheet = findSheet(valid, 'info');
  const planSheet = findSheet(valid, 'plan');
  const result = { found: { info: infoSheet?.name ?? null, plan: planSheet?.name ?? null }, doc: null, errors: [], warnings: [] };

  const infoErrors = [];
  const planErrors = [];
  const infoIgnored = [];
  const planIgnored = [];
  let info = null;
  let semesterBad = false;
  let semesterRow = 0;
  let semesterEmpty = true;
  const flags = { noSemester: false };
  if (infoSheet) ({ info, semesterBad, semesterRow, semesterEmpty } = readInfo(infoSheet, infoErrors, infoIgnored));
  else infoErrors.push({ sheet: 'info', row: 0, field: '', code: 'missing_sheet' });

  let rows = [];
  let selfFilled = false;
  if (planSheet) {
    rows = readPlan(planSheet, info ? info.semester : null, semesterBad, planErrors, planIgnored, flags, semesterEmpty);
    selfFilled = rows.some((r) => r.selfHours !== null);
  } else {
    planErrors.push({ sheet: 'plan', row: 0, field: '', code: 'missing_sheet' });
  }
  if (flags.noSemester) { infoErrors.push({ sheet: 'info', row: semesterRow, field: 'semester', code: 'required' }); infoErrors.sort((a, b) => a.row - b.row); }
  planErrors.sort((a, b) => a.row - b.row);
  result.errors = [...infoErrors, ...planErrors];

  const extra = valid.filter((s) => s !== infoSheet && s !== planSheet).map((s) => s.name);
  if (extra.length) result.warnings.push({ code: 'ignored_sheets', titles: extra });
  if (infoIgnored.length) result.warnings.push({ code: 'ignored', sheet: 'info', titles: infoIgnored });
  if (planIgnored.length) result.warnings.push({ code: 'ignored', sheet: 'plan', titles: planIgnored });

  if (result.errors.length === 0) {
    result.doc = { info, rows };
    result.warnings.push(...planWarnings(info, rows, selfFilled));
  }
  return result;
}

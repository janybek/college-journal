# Доработка 2 юнита 2: что нашла общая проверка и что исправлено

Копия поручений на исправление (рабочие файлы в `.superpowers/` в git не попадают). Круг 1 — коммит `56069eb`, круг 2 — коммит `8f5ba70`.

# Unit 2, addendum 2 — final fix wave (one agent, all items)

Sources: the final review of addendum 2 (fd11fb2..a6a6554; verdict «ready after fixes», 0 Critical, 3 Important) and the conversion of 13 REAL syllabi of the college into the template (10 converted). Reviewer's probe scripts (read them for exact reproductions): `<временная папка сессии>` — p1.mjs (dean flow, I1), p4.mjs (real-syllabus shapes, round trip), p5.mjs (held pairs, «Итого»), p8.mjs (overwrite I3, orphans), p9.mjs (cell wording I2, M2, M3).

TDD: every fix gets a test that fails first. Keep every guarantee of the addendum (Review Focus 13–21: held pairs, all-or-nothing, rights, row order = pair order, one read per sheet per request with batched writes, live-sheet upgrade by `setup`). Dictionary keys identical in ru/ky/en. No `innerHTML`. Colors from `site/css/app.css` variables.

## Important

### I1. A teacher change does not reach the pairs
`backend/handlers/dir.js:98-99`; text `subjects.edit.saved` (`site/js/i18n/ru.js:504`, + ky, en).
Dean opens «Предметы», clicks a group, picks another teacher, saves. The chip moves and the group's pairs take the new teacher's syllabus, but `pairs.teacherId` stays the old one: «Расписание» shows every future pair with the OLD teacher and the «Замена» badge; the old teacher still sees them in «Моё расписание», the new one sees nothing. `schedule.generate` afterwards fixes it.
Fix: in the same branch, set `teacherId` of that subject's pairs that are planned, not hand-changed (`changed` false), dated today or later — the same rule `planGeneration` applies — in the SAME `updateMany('pairs')` as the relayout (one batch, each sheet still read once). Hand-substituted, held and past pairs keep their teacher. If the new teacher is busy on some of those slots (`busyCodes`), leave those pairs as they are and report their count in the answer (`skippedBusy`), shown in the success text. Update `subjects.edit.saved` (ru/ky/en) to say the future pairs now belong to the new teacher. Tests: after the change `schedule.mine` of the new teacher has the pairs and of the old one has none of the future ones; a hand-substituted pair and a past pair keep their teacher; read/write counts.

### I2. Semester wording of real syllabi is refused
`core/syllabusFile.js:101-108` (`parseSemesterCell`) and `:209-211` (plan column). All real title pages write «1 курс 1 семестр», «3 семестр», «Семестр: 4 (Весенний)», Kyrgyz «1 семестр» / «1-семестр»; today these give `bad_value` with the generic text.
Fix: accept a leading number followed by words: «3 семестр», «3-семестр», «3-й», «3-й семестр», «4 (Весенний)», «4 (Весенний семестр)»; ranges as now («1-2», «1–2», «1 и 2», also «1, 2» and «1,2» when the cell is text). In both the info cell and the plan column. Anything else → `bad_value`, with a dedicated text: «Семестр — число от 1 до 8, как в учебном плане (например 3). Для курса на два семестра — «1-2».» (ru/ky/en). Tests with each accepted and rejected form.

### I3. A file of another curriculum semester silently replaces the stored syllabus
`core/syllabus.js:87`, `:159-176` (`planPart`); check window `site/js/views/syllabusUpload.js:328-344`.
A syllabus is keyed by discipline + teacher + half-year. A file with plan semester 3 replaces the stored syllabus of plan semester 1 (both autumn) for all groups, and the check window says nothing about it.
Fix: in `planPart`, when a stored syllabus exists and its `planSemester` differs from the file's, push a warning (code e.g. `semester_replaces`, params: stored and file semesters and the group names it applies to). Text (ru): «В журнале загружен силлабус {stored} семестра. Этот файл ({file} семестр) заменит его во всех группах: {groups}. Если это другой курс, заведите для него отдельную дисциплину.» + ky/en. Tests in core and the API.

## From the real syllabi

### R1. Template: «Семестр» on «Сведения» must be a text cell
`site/js/excel.js` `syllabusBook` — `INFO_TEXT` covers only discipline, teacher, audience. «1-2» typed into the downloaded template becomes a date in Russian Excel; «1,2» becomes 1.2. Make the semester cell (and course cell) text-formatted. Test with the existing template tests.

### R2. Two-semester syllabus: «Семестр» column in the template and one-file download
The site's template has no «Семестр» column in «Тематический план» (`PLAN_KEYS`) though the parser accepts it; «Скачать (Excel)» (`fileData`) exports only the shown semester, with the YEAR's totals in «Сведения», so an unchanged re-upload shows `class_mismatch`.
Fix: the blank template gets the optional «Семестр» column (last but before «Описание», empty; the help text says: fill it only when the course runs two semesters). «Скачать (Excel)» exports the WHOLE stored syllabus of that discipline + teacher: when both half-years are stored — one file with the «Семестр» column filled and «Сведения» semester «a-b»; when one — as now. Round trip: download → upload unchanged → added 0, changed 0, removed 0, no new warnings — for a one-semester and a two-semester syllabus (tests through the real parser, like the existing round-trip tests).

### R3. Unit titles
6 of 10 real syllabi name their units («Юнит 1. Техническое и программное обеспечение», «Юнит I. Сүйлөө маданияты»); the template has no place and they are lost.
Fix: optional column «Название юнита» in «Тематический план» (next to «Юнит»). Parser: the first non-empty title among a unit's rows is the unit's title; different non-empty titles inside one unit → a warning, first wins. Stored on the topic rows (new column in «Темы», added by `ensureSheets` like other new columns — `setup` on the live sheet must stay safe; schema tests and the sheets-count/columns tests that pin the list must be updated). `syllabus.get` returns the unit title; the syllabus page shows the header «Юнит 1. <название>» (just «Юнит 1» when empty); «Скачать (Excel)» writes it back (on the unit's first row); the blank template has the column; the help text mentions it. Round trip keeps titles. Titles are text only, max length as other names.

## Minor (same wave)

- M1. «Итого» rows (`core/syllabusFile.js:196-262`): a row whose topic cell is «Итого», «Всего», «Итого часов», «Жалпы», «Жыйынтыгы», «Total» (case/space-insensitive, optional trailing colon) is skipped and counted in the `ignored` remark instead of becoming a topic or a `bad_hours` error. Test: two topics 2+2 plus «Итого 4/4» → 4 pairs.
- M2. «Вид занятия» with an unknown word → a field-specific text listing the accepted words («лекция, практика, семинар, лабораторная, модуль») instead of the generic «Такое значение не подходит.» (ru/ky/en). Also accept «лабораторная работа», «лабораторное занятие», «практическое занятие», «семинарское занятие», «контрольная работа» → control («модуль»), «итоговое занятие» → control.
- M3. Hours: also accept «2 часа», «4 часа», «2 час.», «2 саат», «2 h», «2 hours» (still only 2 or 4).
- M4. The help panel «Как заполнить шаблон» (`ru.js:557-562`, ky, en) says: semester is a number 1–8 as in the curriculum; a course of two semesters — «1-2» in «Сведения» and the «Семестр» column in the plan; units may have a title.
- M6. Stand seed (`dev/seed.js:19, :100`): one syllabus «Курс 1, Семестр 1» serves 01-1 (course 1) and 02-1 (course 2), so 02-1's page reads «2 курс, 1 семестр» — make the seed consistent (both groups of that teacher in the same course, or the info course matching).
- M7. Deleting a discipline or a staff member that still has syllabi (`backend/handlers/dir.js:112, :114`) leaves orphan rows in «Силлабусы» and «Темы» — add `syllabi` to both delete blockers (`in_use`).
- M10. «Скачать (Excel)» file name (`site/js/views/syllabusUpload.js:89`): «Силлабус — <дисциплина> — <преподаватель>.xlsx» (characters illegal in file names removed) instead of `syllabus.xlsx`.
- M12. `syllabus.fits` text reads «…в расписании семестра 18.» — make it «…в расписании семестра 18 пар.» with correct plural forms in ru/ky/en.
- M13. `semester_clash` text: also covers «different academic years» (e.g. 2 and 3), not only odd/even.
- T30. Week grid with REAL discipline names («Информационное обеспечение профессиональной деятельности», «Предпринимательство и менеджмент в здравоохранении»): the card must stay readable — wrap at word boundaries, clamp the subject to 3 lines with the full name in the pair window and `title`; switch to the day list below ~1200 px instead of 1100 px if six columns do not fit. Check in the browser with those two names.

## Done means

- `npm test` green with the new tests; `npm run build:gas` builds.
- Browser check with headless CHROME only (throwaway profile, `--disable-sync --disable-extensions`; never Edge): stand via `npm run dev:reset` on port 5273 (never `dev:real`), stopped afterwards. As dean: change a group's teacher → the schedule and both teachers' «Моё расписание» are right; upload a file with «3 семестр» wording, an «Итого» row and a unit title → the page shows «Юнит 1. …»; download → upload unchanged → nothing changes; week grid with a long discipline name at 1280 and 1200 px. 4–6 screenshots in `.superpowers/sdd/plan-unit-2-raspisanie/addendum2-fix-shots/`.
- One commit: `fix: addendum 2 final review — teacher change reaches pairs, real-syllabus wording, unit titles, two-semester files`, own `Co-Authored-By`. Stage only your files; `git status` clean.

---

# Addendum 2 fix wave — round 2 (same implementer, base 56069eb)

From the scoped re-review. Probe scripts with exact reproductions: `<временная папка сессии>` (p2.mjs — N2, p3.mjs — N1 cases DIFFERENT and IDENTICAL, p5.mjs — N4). Run them from `D:\Журнал колледжа`. TDD as before.

## N1 (Important) — year file rewrites the info of both semesters
`site/js/syllabus.js:111-114` (`yearNumber`), call at `:102`. Two halves uploaded from two files → «Скачать (Excel)» → upload unchanged: new remarks (`total_mismatch`, `class_mismatch`, `self_mismatch`) and both semesters get summed/mixed numbers (autumn 2/10/6/4 + spring 3/12/6/6 → 5/22/6/10 stored for both). With identical numbers in both halves — a new `class_mismatch`.
Fix: decide ONCE for the whole «Сведения» sheet, not per field. Build the one-file year download only when it will round-trip cleanly: both halves belong to one academic year AND an unchanged re-upload of the built file gives 0 added / 0 changed / 0 removed, no new warnings and the same stored info for both semesters. If the info of the two halves cannot be expressed by one «Сведения» sheet without changing what is stored (different credits/hours/specialty/course, or numbers that would have to be summed and then mismatch the plan), download only the shown semester, as before the wave. Do not sum numbers of separately uploaded halves unless the result round-trips to exactly what is stored.
Tests (through the real parser and `syllabus.apply` → `syllabus.get`): (a) two halves from two files with different numbers → download → apply unchanged → no new remarks, stored info of BOTH semesters unchanged; (b) same with identical numbers; (c) a syllabus uploaded as one year file still downloads as one year file and round-trips (existing test stays green).

## N2 — a hand-moved pair stays with the old teacher
`core/schedule.js:113` (`pair.changed !== false`). A pair moved by hand to another day/slot, still taught by the subject's old teacher, is skipped at a teacher change: it stays with the old teacher forever (generation does not fix it).
Ruling: a future planned pair of that subject passes to the new teacher when its `teacherId` equals the subject's OLD teacher — whether or not it was hand-changed (moved). A pair whose teacher differs from the old teacher (a real one-off substitution) keeps its teacher. Busy rule unchanged (left as is, counted in `skippedBusy`). Held, past and cancelled pairs unchanged. Keep the text `subjects.edit.saved` true to this (ru/ky/en). Tests for: moved pair passes; substituted pair stays; moved pair into a slot where the new teacher is busy → counted.

## N3 — the subjects import loses `skippedBusy`
`backend/handlers/import.js:56`. Return the count in the import answer and show it in the import result on the site with a text like the one in «Предметы» (ru/ky/en). Test in `tests/importApi.test.js`.

## N4 — totals rows
`core/syllabusFile.js:72-73`. A row is a totals row when the FIRST whole word of the topic cell is «итого», «всего», «жалпы», «жыйынтыгы», «итог» or «total» (case-insensitive; a trailing colon, numbers or more words may follow: «Итого по курсу», «Всего за семестр», «Итого 36», «Итого:»). «Итоговое занятие», «Итоги года» and «Всеобщая история» stay topics. Tests with each.

## Done means
`npm test` green, `npm run build:gas` builds. No browser run needed unless you change a screen beyond a text (N3's line in the import result: one headless-Chrome screenshot into `addendum2-fix-shots/` is enough; stand on 5273 via `npm run dev:reset`, stopped afterwards). One commit: `fix: year syllabus file round-trips, a moved pair follows the new teacher, totals rows, busy count in the import`. Stage only your files by name; `git status` clean. Append a section «Round 2» to `addendum2-fix-report.md` and reply with status, commit id, test totals, deviations.

---

# Round 3 (commit `44f1c45`)

Found by the re-review of round 2: the totals-row word list dropped Kyrgyz topics that begin with «Жалпы» ("general"): «Жалпы маалымат», «Жалпы анатомия». Rule now: a row is a totals row only when «№» and «Вид занятия» are empty and the topic cell either starts with the whole word «итого» / «всего», or is «жалпы», «жыйынтыгы», «итог», «total» alone or followed only by numbers, a colon or dash and hour words. Everything else stays a topic.

Left as notes for later units: after a teacher change, past and held pairs of the former teacher are shown with «Замена»; «2 курс 1 семестр» reads as semester 1; «Итого» in the «№» or «Юнит» column with an empty topic is an error; a year file whose declared hours do not match its plan downloads as the shown semester only; lists are sorted by code units (Ө, Ү, Ң, Ё after Я); at deployment push the site right after `deploy`.

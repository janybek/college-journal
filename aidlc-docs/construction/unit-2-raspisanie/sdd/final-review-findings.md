# Unit 2 final-review fix wave (one agent, all items)

Source: whole-unit final review of unit 2 (0375bde..bce7758). Verdict: ready for owner acceptance after these fixes. Probe scripts the reviewer used (read them for exact reproductions):
- `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\f6c79be9-d6ff-4aec-aac6-18a738671229\scratchpad\probe1.mjs` (blocks A, B, C)
- `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\f6c79be9-d6ff-4aec-aac6-18a738671229\scratchpad\probe2.mjs`
- `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\f6c79be9-d6ff-4aec-aac6-18a738671229\scratchpad\probe4.mjs` (blocks D, E, F)

Fix exactly these. TDD: each fix gets a test that fails first. Keep every existing guarantee (Review Focus 1–6 of `aidlc-docs/construction/unit-2-raspisanie/plan.md`).

## I1. Moved pair with a passed plan date is invisible to generation → two pairs in one place, «Не поместилось: 0»
`core/schedule.js:52-55` (used at ~73 and ~84): `considered` keeps only pairs with `planDate >= from`, and the busy check runs only against those. A hand-moved pair keeps its old `planDate`; once that day is behind today, generation no longer sees it.
Scenario: 31 Aug the dean moves the 1 Sept «Информатика» of 01-1 to Thu 10 Sept pair 3; on 4 Sept adds «Химия» for 01-1 Thu pair 3 to the template and generates → 10 Sept pair 3 holds two planned pairs of 01-1, conflicts 0. Same for teacher or room.
Fix: build the busy list from every non-replaceable (fixed: changed / held / cancelled-is-not-busy as before) pair still ahead — `planDate >= from || date >= from`; keep the `taken` plan-key logic as it is. Test: «место занято перенесённой парой» with `planDate` earlier than `from` → the template pair is not inserted and counts as a conflict.

## I2. Subjects import changes a teacher without the week-template `teacher_busy` check
`backend/handlers/import.js:66-67` writes the update; the check lives only in `backend/handlers/dir.js:68-75` (called ~93); the `subjects` rule in `core/validate.js:110-114` has none.
Scenario: template has 01-1 «Информатика» (t1) and 02-1 «Анатомия» (t2), both Monday pair 1. Directory edit of «Анатомия» to t1 → refused. Re-importing subjects with t1 for «Анатомия» → `updated: 1`; next generation puts t1 on two pairs every Monday.
Fix: move the check into `validateRow('subjects')` when `db.weekTemplate` is present (shared core busy-check from `core/busy.js`, as ruling F19 requires), so `dir.save` and import share it; load `weekTemplate` as an extra for the subjects import (`loadDb`). The row error is `teacherId: teacher_busy`. Remove the now-duplicate handler check in `dir.js` (keep `dir.save` behaviour and its tests green). Test: subjects import row with a clashing teacher → that row gets `teacherId: teacher_busy`, other rows load.

## I3. Pairs between today and a later semester start are never removed
`backend/scheduleData.js:55` with `core/schedule.js:52`: when today is before `semesterStart`, `from = semesterStart`, so existing pairs with an earlier `planDate` are not considered at all.
Scenario: start 1 Sept, schedule created; dean corrects start to 14 Sept and generates → preview «Удалится 1, без изменений 2»; the 1 and 8 Sept pairs stay, before the semester, and cannot be edited (`out_of_semester`).
Fix: when pairs exist and it is not a restart, pass `from = today` (`workingDays` already clamps to the semester start); report `max(today, semesterStart)` as `from` in the answer (that is what the preview shows). Fresh semester / restart keeps `from = semesterStart`. Test: the scenario above → the pre-start planned pairs go to `toRemove`; held/changed pairs before the start are left alone.

## M1. Bell change does not reach manually changed pairs
`core/schedule.js:61-67`: only replaceable pairs get the new `startTime`.
Fix: for planned non-replaceable pairs from `from` on, update `startTime` only, from `bells[slot - 1]` (they go to `toUpdate` with just the time). Test: substitute a pair, move bell 1 08:00 → 08:30, regenerate → the substituted pair shows 08:30 and keeps its teacher and `changed`.

## M2. Restored pair keeps its cancellation note; restore-conflict test missing
`backend/handlers/schedule.js:131`; pinned by `tests/pairsApi.test.js:127`.
Fix: restore with `note: ''`; update that test. Add the test: cancel a pair → move another pair onto its slot → restore → `invalid` with `group_busy`.

## M3. Wrong text when a subject's group cannot be changed
Server answers `groupId: in_use` (`backend/handlers/dir.js:61-65`); `site/js/views/directory.js:411` finds no specific key and shows the generic «…нельзя удалить».
Fix: add `error.subjects.groupId.in_use` to `site/js/i18n/ru.js`, `ky.js`, `en.js` (ru: «Предмет уже стоит в шаблоне недели или в расписании — группу менять нельзя.»; write your best Kyrgyz and English). Make sure the directory form picks it up (check the key lookup order). Key sets stay identical (existing test).

## M4 + M5. A note-only edit freezes the pair; changePair writes all seven fields
`core/schedule.js:140` always sets `changed: true`; `backend/handlers/schedule.js:79-80, 101` writes the whole `next` (7 single-cell writes on Google even for a note).
Fix: `changed = pair.changed || date, slot, teacherId or roomId differ`; `changePair` writes only the fields that differ (plus `changed` if it flips). Tests: note-only edit keeps `changed` false and writes only `note`; a room change sets `changed: true`.

## Done means
- `npm test` passes with the new tests; `npm run build:gas` builds.
- No changes outside these items. One commit: `fix: unit 2 final review — busy checks, semester start, bells, restore note, partial pair writes`, with your own `Co-Authored-By` line.
- `git status` clean afterwards (no line-ending-only modifications).

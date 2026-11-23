# Unit 3 «Журнал и оценки» — final whole-unit review (strict)

Range 80600c0..52e8028 (85 files). Reviewer: opus, read-only. Date 23.11.2026.

Probe folder (run every probe with `node <file>` from the repo root `D:\Журнал колледжа`):
`C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\32ab19ae-c2d8-4f85-a409-34d525cbd009\scratchpad\final-u3\`
(called PROBES below).

Baseline: `npm test` = 707 pass / 0 fail; `npm run build:gas` builds; `git status` clean.

## Strengths

- Rights hold under attack. PROBES\probe-rights.mjs: a student gets `forbidden` on all 9 journal/scoring actions; the prorector cannot write (5 actions); the substitute (teacher3) cannot touch other pairs of the subject, results or the log; a foreign teacher (teacher2) is refused on get/savePair/log; a student of another group, a disabled student, `unit:"1"`, `value:"30"`, `value:41`, `field:"__proto__"`, `status:"constructor"`, activity 7.5 / -1, `noCoat:"yes"`, reason as an array or whitespace are all refused; after the term the teacher can do only absent→excused/madeup (absent→present, excused→present, a changed lab coat, a new mark are `locked`); missPair/reopenPair/scoring.save are refused to teacher1. A snapshot of attendance/unitResults/changeLog/pairs is identical before and after all refusals.
- No leaks: `student.grades` ignores studentId/groupId/subjectId in the data and its JSON contains no other student id or name, no passwordHash/cardNo/markedBy; journal.list/get/log for admin, dean, prorector, teacher1, teacher3 contain no passwordHash/cardNo/login. The substitute's own save answers with a partial journal (`results: {}`, one pair).
- Numbers match the plan by hand: the plan example gives 26 → 29 after «отработано», total 75 «удовл.», 76 «хорошо» with control 31 (PROBES\probe-numbers.mjs). After `scoring.save` {current 50, self 20, control 30} the journal and the student cabinet both show current 47, control capped 30, total 97 — identical numbers in journal.get and student.grades.
- The term boundary is midnight in Bishkek: 23:59 «free», 00:00 and 00:30 «limited»; 07:59 before the 08:00 bell is `too_early` for the deanery too (PROBES\probe-midnight.mjs).
- The real SQLite store keeps the types: noCoat boolean, activity 0 stays 0 (not null), planSemester integer, `late` boolean; re-sending the same marks writes no log row (PROBES\probe-sqlite.mjs).
- All-or-nothing and «one read per table» are real asserts in the tests; the change log is written in the same request/transaction; only backend/journalData.js (and dev/seed.js through its functions) write the three new tables.
- Hard rules: no innerHTML/oklch/external URLs in the new site code; no `Date.now()`/`new Date()` in core/ or backend/ outside the two platform files; every new screen phrase goes through the dictionaries; key parity is tested; stale answers are dropped by tickets; double «Сохранить» is blocked by a synchronous busy flag.

## Issues

### Critical

None.

### Important

**I1. The student does not see a unit control (exam) or SRS score that is already set, until both are set.**
- Where: `site/js/journal.js:232-237` (`unitLine`), used at `site/js/views/grades.js:139-146`.
- What: when `self` or `control` is null the line is `grades.unit.partial { current }`; when `current` is null it is `grades.unit.empty` even if control/self are set. The server sends the numbers (`student.grades` units[].control/self).
- Who sees what: the teacher enters «рубежный 18»; the student sees «Юнит 1: текущий 38 из 40» and the red note «рубежный ниже зачётного минимума 24» — without the number 18. The SRS may come weeks later. The decision row «Студент видит: по каждому предмету баллы юнитов» is broken for the exam score; a reasonable student expects to see the exam mark once it is in the journal. (The plan's example line «пока нет СРС или рубежного — Юнит 2: текущий 31 из 40» caused it, so it is a plan gap, not an agent error.)
- Fix: build the line from the parts that exist — current (if any) · SRS (if any) · рубежный (if any), and the total only when all three exist (e.g. a `grades.unit.part.*` key per part joined with « · », or extend `grades.unit.partial` with optional self/control). Update `tests/siteJournal.test.js` for: control without self; self without control; control+self without current. New ky/ru/en keys → show the owner one screenshot (a student-visible change).
- Probe: PROBES\probe-student-unitline.mjs (prints `control 18 controlLow true -> {"key":"grades.unit.partial","params":{"current":38}}`).

### Minor

**M1. «Half up» rounding fails in float for some fractions.**
- Where: `core/grades.js:32` (`Math.round((earned / possible) * scheme.current)`) and `core/grades.js:58` (`Math.round((attended / marked) * 100)`).
- What: 23 of 40 attended → 57.4999… → **57%** instead of 58%; with a scheme «текущий 50» e.g. 58/200 → 14 instead of 15. Default 40 is not affected in the tested range; the attendance percent is (8 cases up to 200 pairs). Review Focus 6 asks for half up.
- Fix: multiply first, then divide: `Math.round((earned * scheme.current) / possible)`, `Math.round((attended * 100) / marked)` (x.5 is then exact). Same in any site copy if one appears. Add the 23/40 → 58 case to `tests/grades.test.js`.
- Probe: PROBES\probe-rounding.mjs (prints the mismatches; should print 0 and 0 after the fix).

**M2. «5e» (and «-», «5-») in the activity field silently becomes «no activity».** (deferred item d — confirmed)
- Where: `site/js/views/journalPair.js:126-131` (`setActivity`), `site/js/views/journalCell.js:243` (+ inputs at :121, :155).
- What: `<input type=number>` returns `value === ''` for an unparsable entry, so `activityBad` stays false and `activity` becomes null; on a held pair the server then clears the saved activity and logs «7 → —».
- Fix: treat `input.validity.badInput` as bad (`activityBad = input.validity.badInput || …`), or switch these two inputs to `type=text inputmode=numeric` like the unit windows (`parsePoints`). Test the helper if one is extracted.
- Probe: browser only — on the stand type «5e» into «Активность» in the pair window and press «Сохранить»: no error, the cell loses its activity.

**M3. journal.log has no group filter; the change-log screen filters the group in the browser after the limit.** (deferred item a — confirmed)
- Where: `backend/journalData.js:424-476` (`changeLogView`), `site/js/views/journalLog.js:154-160`.
- What: with more rows than the limit the deanery picking a group sees fewer rows (or an empty table with «Показать ещё») although the group has changes.
- Fix: accept `groupId` (string, else bad_request) and filter by the subject's group from the already read `subjects`; for a teacher keep the own-subject rule unchanged; the screen sends `groupId` and drops its local filter. Test: limit 10, 5 rows of 02-1 older than 10 rows of 01-1 → all 5 come.
- Probe: PROBES\probe-log-group.mjs (now prints `rows of 02-1: 0 of 5`).

**M4. A student added to the group after a pair was held is shown «Был» in the pair window but nothing is saved for him.**
- Where: `site/js/journal.js:117-127` (`changedMarks`: `base` comes from `draftMarks`, which gives a student without a mark the default «present», so `!old` is never true on a held pair).
- What: the teacher opens a held pair, sees the new student as «Был», presses «Сохранить» — no mark is sent; the grid cell stays empty and the pair does not count for him.
- Fix: build `base` from the saved marks only (`journal.marks[pairId]`), so an unmarked active student on a held pair is sent; add a siteJournal test.
- Probe: PROBES\probe-new-student.mjs (prints `window shows ... present`, `sent ... 0 rows`).

**M5. Leaving by the browser «Back» closes the marks/cell window without the «unsaved marks» question.**
- Where: `site/js/views/journalPair.js:226` and `site/js/views/journalCell.js:385` (`onHash = () => dialog.close()`).
- What: Escape and «Отмена» ask (canCancel/isDirty), but a hash change (Back, Alt+←) drops 22 typed marks silently. Review Focus 15 names «несохранённые отметки и уход со страницы».
- Fix (small): on hashchange with a dirty draft and not busy, ask (or restore the hash and show the question); or accept and record as a known limitation. Stand check only.

**M6. When the first pair of a subject is marked «не проведена» later, the activity already given on the new first pair stays visible but stops counting.**
- Where: rule `core/grades.js:7-23` (first pair = earliest planned/running/closed), display `site/js/views/journal.js:387`, cabinet `backend/studentGrades.js:80-86`.
- What: 01.09 was not marked (teacher ill), 08.09 was marked with activity 7 (not first then). The deanery marks 01.09 «не проведена» → 08.09 becomes first; the grid still shows «7», the cabinet shows «activity 7 · 20 из 20». The rule itself is the plan's; the inconsistency is in what is shown.
- Fix: either hide/grey the activity of a pair that is `first` (grid cell and cabinet), or ask the owner whether the «first pair» should be the first *held* pair. Probe: PROBES\probe-first-pair.mjs.

**M7. (deferred c) `#/grades/<id>` and `#/journal/<id>` are not URI-decoded.** `site/js/router.js:41-52`. Harmless today: ids are `prefix_` + hex, which `encodeURIComponent` does not change. Fix only if trivial (`decodeURIComponent` in try/catch).

**M8. (deferred e) Change-log rows of a pair removed by a schedule restart show «—» for the pair.** Reachable only for a pair reset/returned today and then removed by `schedule.generate` (restart considers planDate ≥ today, reset works only on pairs that have begun). The screen already prints «—». A real fix needs either a pair date/slot copy in «Журнал изменений» (a base change → owner) or a generator rule. Recommend: leave, record as a known limitation.

## Triage of the deferred items

| Item | Decision |
| --- | --- |
| (a) journal.log server groupId + screen uses it (task 23) | **Confirm — fix now** (M3). |
| (b) dean sees group_course warning in the approve dialog (task 25) | **Confirm — fix now**: approveSyllabus returns `checks.warnings`; the review/approve dialog of `site/js/views/syllabus.js` shows nothing (only submitDialog shows warnings). |
| (c) grades subjectId not decoded | **Correct to: optional.** No effect with current ids (M7); include only as a one-liner with a router test. |
| (d) «5e» empties activity | **Confirm — fix now** (M2), both windows. |
| (e) changeLog rows of removed pairs | **Correct to: leave** (M8) — narrow, the dash is shown; a real fix changes the base. Record under known limitations. |
| Task 1: dynamic import style; no readScheme numeric test | Leave. |
| Task 2: `const col =(` whitespace | Leave (or fix only if the wave touches schema.js). |
| Task 5: redundant `substitute:true` patch; no withoutTopic test | Leave. |
| Task 6: course cell vs «Курс» row caught only at submit; extra branches untested | Leave. |
| Task 7: no settings.save→scoring.save order test | Leave (both handlers touch only their keys; read in code). |
| Task 8: restart guard looks only at status | Leave — verified unreachable: a planned pair never has marks (savePair closes it; missPair refuses marks; reopen deletes marks first). |
| Task 11: spy test lacks «reads happened»; groupName find in loop | Leave. |
| Task 13: optional reason dropped when not required | Leave (the UI never offers it). |
| Task 15: no regression tests for transferred/disabled student in student.grades | **Fix now (tests only)** — student data is the strict area; probe26 checked it once, a test keeps it. |
| Task 19: pairHint to prorector | Already fixed in the block-1 fix round. Other task-19 notes: leave. |
| Task 20: onSaved/reason busy | Already fixed in task 21. |
| Task 22: no tests for the action window | Leave (stand-checked, server rights covered). |
| Task 24: bells panel at 360 px | Leave (pre-existing, not unit 3). |
| Task 26: notfound role=alert; RED not captured; seen only in Kyrgyz | Leave. |

Owner questions still open (not defects; for the coordinator): «Пропуски» = н + ув; a replaced teacher loses the change log of the subject; a transferred student does not see old-group marks. Add one more if I1 is fixed differently: should the student see an exam score before SRS is set (recommended: yes).

## Declined to judge

- Changing «семестр по плану» of an approved syllabus hides the old unit results — listed by the plan as a known limitation (Task 27 step 8).
- Scheme changes apply to finished units — plan known limitation (closing units is unit 6).
- Apps Script reads «Посещаемость» whole — plan known limitation; the fallback is not live.
- The «first pair» rule itself (earliest planned/closed pair) — plan-defined; only its display is reported (M6).
- Visual checks (22×40 grid scroll, both themes, 360 px phone without horizontal scroll) — not re-run in a browser; each block was checked on the stand with screenshots and accepted by the owner.
- Kyrgyz wording and abbreviations — native-speaker review, not code.
- Server accepts «без халата» on an absent student (the UI resets it) — no rule in the plan forbids it; no effect on points.
- QR/code/running pairs, homework, statements, penalties, unit closing — units 4–6.
- design-v1.md sections 6 and 8 still describe the old model — updating them is Task 27 step 4, after the fixes.

## Assessment

**Ready: With fixes.** No critical or rights/data-leak defects; one Important (I1, the student does not see an entered exam/SRS score) plus the confirmed deferred items (a, b, d), M1 (rounding), M4 (new student not saved) and the task-15 regression tests should go into the single fix wave. M5/M6 can go in the wave or be recorded; M7/M8 leave.

---

﻿# Unit 3 — re-review of the final fix wave (52e8028..68aafa1)

Reviewer: opus, read-only. Commits 43cda7b (rounding), bdd9bbf (journal.log groupId + student.grades tests), 68aafa1 (screens C1–C7).

Baseline: `npm test` 711/711 pass; `npm run build:gas` builds; `git status` clean.
Probes (run with `node <file>` from the repo root): `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\32ab19ae-c2d8-4f85-a409-34d525cbd009\scratchpad\final-u3\` (PROBES).

## Verdict: approve

No Important or worse finding remains. One new Minor finding comes from the C5 fix itself (N1, a small follow-up is recommended). There is also one Minor side effect of C4 (N2).

## The original findings

| Finding | Status | Evidence |
| --- | --- | --- |
| I1 student unit line hides control/SRS | **Fixed** | `site/js/journal.js:233-243` builds the line from every part that exists; full line only when all three exist. PROBES\probe-student-unitline.mjs: control 18 without SRS → parts `current 38` + `control 18`. Seven combinations tested in siteJournal (not tested: control only, but the code path is the same). ru/ky/en keys `grades.unit.part.*` exist with the max placeholders; `views/grades.js:146` joins with « · ». |
| M1 rounding | **Fixed** | `core/grades.js:32`, `:58` multiply before dividing. PROBES\probe-rounding.mjs: 0 and 0 mismatches (was 16 and 8). The 23/40 case is in grades.test.js. |
| M2 «5e» | **Fixed** (code-read) | `validity.badInput` goes into `activityBad` in both windows; `isDirty` counts a bad activity. Seen by the implementer on the stand; not re-run in a browser. |
| M3 / (a) log by group | **Fixed** | Server: `backend/journalData.js:456` filters by the group of the row's subject inside `picked`, i.e. **before** `slice(0, limit)`; `groupId` must be a string or `bad_request`; the teacher's own-subject check (`:440-443`) runs before and is unchanged (teacher + groupId without subjectId → `forbidden`; own subject + other group → 0 rows). Screen sends `groupId` only for the whole log; the local filter is gone. PROBES\probe-log-group.mjs: 5 of 5 rows of 02-1, `more:false`. |
| M4 new student not saved | **Fixed** | `changedMarks` builds `base` from `journal.marks[pairId]` only. See C4 below. |
| M5 Back drops unsaved marks | **Fixed, with a new minor problem** | See C5 / N1. |
| (b) group_course for the dean | **Fixed** | See C6. |
| M7 / (c) decode | **Fixed** | `router.js` `idOf()` with try/catch; a broken escape falls to home; tests added. |
| Task-15 regression tests | **Added** | `tests/journalLogGroup.test.js`: transferred student sees only the new group (no old subject id or name, no activity 7); a disabled student's token gets `unauthorized`. |

## The five points you asked about

**(1) C1: every combination.** current / self / control, each present or absent (8 cases): all three → `full` (the total always exists then); none → `empty`; the other 6 → `parts` in the order current, self, control, with only the existing ones. The `parts` key itself is never translated (the view uses the part keys). Correct.

**(2) C4: who is sent.** PROBES\probe-c4-server.mjs. A left student (moved to another group, with a mark), a disabled student with a mark and a disabled student without one are **never** in the draft (`draftMarks` drops `left`, and a disabled student is either `left` or absent from `students`). So nothing the server would refuse is sent; the server accepts the batch, and the change log gets one `status: '' → present` row. Students with a saved mark and no change are not sent. The only student sent without a click is the unmarked active student, as «Был» — this is what the window shows him as. Side effect, see N2.

**(3) C5: the extra history entry.** The entry itself is acceptable: after Back the hash is set again, which replaces the forward entry, and the history just gains one extra step. The real problem is elsewhere: see N1.

**(4) C6: `syllabus.form` in the approve dialog.** It is read-only (`draftForm` has no store writes). The approve button exists only for managers, who are allowed this call, and the page already shows them the same version. The dialog uses only the `group_course` warning, which holds group names; no other data is shown. A failure is swallowed (`catch {}`; `unauthorized` follows the usual sign-out path of `call()`). A late answer after the window closed is dropped (`state !== owner || !owner.approveAsk`). If approve fails, the warning line is kept (`...owner.approveAsk`). Correct.

**(5) B: the groupId filter.** It runs before the limit and keeps the teacher's rule. See M3 above. Nit: `groupId: ''` returns no rows instead of all of them; the site never sends `''`.

## New issues from the fix wave

**N1 (Minor; small follow-up recommended). After «Back → Остаться → Сохранить» the grid keeps showing the old marks.**
- Where: `site/js/views/journalPair.js:226-232`, `site/js/views/journalCell.js:385-391` (onHash restores the hash), together with `site/js/main.js:109-112` and `site/js/views/journal.js:28-30, 293-304`.
- Why: main.js registered its `hashchange` listener first. On Back it renders `#/journal` (the list), and that calls `journal.leave()`, which resets the screen's `state`. Then the dialog puts the hash back, and the journal screen is rendered again with a **new** state and a new `journal.get`. When the person then saves, `onSaved` sees `state !== owner` and does nothing. The grid shows the answer loaded before the save, until the page is reloaded. No data is lost (the server saved it), but the teacher sees their marks missing and may think the save failed. The page behind the window also flashes the list and then the journal again.
- Fix: use the existing leave guard instead of resetting the hash. While the window is dirty, call `holdOnLeave(() => ask-and-resolve)` from `site/js/ui.js:31` and release it on close. main.js then does `history.replaceState` back and asks through `mayLeave()`: no re-render and no extra history entry. A smaller alternative: in the four `onSaved` callbacks of `views/journal.js`, compare `state.subjectId === owner.subjectId`, and write into the current `state` instead of returning.
- Check on the stand: open a pair, change an activity, press Back, choose «Остаться», press «Сохранить». The grid should show the new value without a reload.

**N2 (Minor; owner question). Saving a held pair now also gives «Был» to a student who joined the group later.** PROBES\probe-c4-server.mjs. The teacher opens an old held pair to fix one student and presses «Сохранить». The newcomer, shown as «Был» by default, gets `present` (20 points) for a pair held before he joined, and a log row is written. In the deanery's reason mode, just pressing «Сохранить» with no edit now asks for a reason because of him. This matches what the window shows, so the fix is consistent. The safer variant would show «нет отметки» for an unmarked student on a held pair and not send him until a status is clicked. Owner choice; not blocking.

## Out of scope (code the wave did not touch)

- M6 (activity on a pair that became the first pair is shown but not counted) is unchanged: PROBES\probe-first-pair.mjs gives the same output. It stays deferred or is an owner question, as decided.
- M8 (change-log rows of removed pairs show «—») is unchanged, as decided.
- Nothing new found. Rights and data probes (probe-rights, probe-numbers, probe-midnight, probe-sqlite) give the same results as before the wave.

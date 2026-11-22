# SDD ledger — plan: D:\Журнал колледжа\aidlc-docs\construction\unit-3-zhurnal\plan.md

Spec: aidlc-docs/inception/design-v1.md + owner decision table in aidlc-docs/aidlc-state.md (22.11.2026 rows); plan agreed by the owner (all 8 defaults, block acceptance).
Branch: main (project practice: units are built on main; push only on the owner's request).
Preflight: preflight.md (fable) — 7 important + minor, all fixed in plan by the planner (commit 80600c0). Rulings: course_semester rule not weakened, fix test fixtures; note to a student absent from the list writes status row before ''; tasks 8, 9, 15, 16, 18 split (26 tasks).
Contracts: implementer-contract.md / reviewer-contract.md (GC + Review Focus of this plan) / rereview-contract.md.
Owner stops: after task 19 (block 1), 21 (block 2), 25 (block 3), 26 (block 4).

- Task 1: dispatched journal-logic (sonnet), BASE 80600c0
- Task 1: complete (commits 80600c0..0a4b059, review clean). minor (deferred): tests/dates.test.js:122 dynamic import style; no readScheme test with a numeric value.
- Task 2: dispatched journal-logic (sonnet), BASE 0a4b059
- Task 2: complete (commits 0a4b059..7096aa0, review clean). minor (deferred): core/schema.js 'const col =(' whitespace — pass to the next task touching schema.js.
- Task 3: dispatched journal-logic (sonnet), BASE 7096aa0
- Task 3: review — spec ok, 19/23 mutations caught; Important: self cap untested; fix round 1 (tests only) sent to the implementer.
- Task 3: complete (commits 7096aa0..753aa82, fix round 1 accepted by the coordinator: diff read, grades 11/11). Ruling: tiny test-only round accepted without re-review (project rule for very small rounds).
- Task 4: dispatched journal-logic (sonnet), BASE 753aa82
- Task 4: complete (commits 753aa82..a1fb268, review clean; tiny test round for present/late->madeup after the term accepted by the coordinator).
- Task 5: dispatched journal-logic (sonnet), BASE a1fb268
- Task 5: complete (commits a1fb268..324f970, review clean). minor (deferred): teacherHandover busy branch emits substitute:true for already-true pairs (redundant write); no test for withoutTopic when held pair has no free lesson.
- Task 6: dispatched journal-logic (sonnet), BASE 324f970
- Task 6: complete (commits 324f970..9c9a7f5, review clean). Ruling: implementer's extras accepted (plan-sheet semester column → course_semester; tests/syllabusFile.test.js course 6 → bad_value) — consistent with semesters 1–8. Real files probe: 10/10 parse; «География» Курс 2 Семестр 2 → semester 4 + semester_by_course remark (tell the owner). minor (deferred): cell course vs «Курс» row mismatch caught only at submit; no tests for the two extra branches. Note: the implementer left dev:reset on 5273 (classifier denied stopping it) — coordinator stopped PID 24260.
- Task 7: dispatched journal-server (sonnet), BASE 9c9a7f5
- Task 7: complete (commits 9c9a7f5..b939534, review clean). minor (deferred): no test settings.save→scoring.save→settings.get order; one big test.
- Task 8: dispatched journal-server (sonnet), BASE b939534
- Task 8: review approved (spec ok). Reviewer found an Important pre-existing hole in core/schedule.js planGeneration:55 (replaceable = planned && !changed): a pair kept with the old teacher (new teacher busy → substitute:true, changed:false) is overwritten by the next schedule.generate → double slot, substitute lost. Probe: scratchpad/probe.mjs. Ruling: fix now as task 8a by journal-logic (core zone): replaceable also requires substitute !== true, + test (dir.save busy → schedule.generate {} keeps teacherId and substitute) — cost if wrong: a substituted pair never regenerates (deanery can change it by hand).
  minor (deferred → task 14 reviewer): restart guard looks only at status; a planned pair with attendance would be deleted — unreachable while marks exist only on closed pairs; check after reopenPair/reset in task 14.
- Task 8: complete (commits b939534..bb95de1 incl. 8a fix bb95de1 accepted by the coordinator: one-line diff read, schedule+pairsApi 29/29, 632 total).
- Task 9: dispatched journal-server (sonnet), BASE bb95de1
- Task 9: complete (commits bb95de1..ba2f3cd, review clean).
- Task 10: dispatched journal-server (sonnet), BASE ba2f3cd
- Task 10: complete (commits ba2f3cd..189de5b, review clean; probes scratchpad/probe10.mjs). Ruling: deviations accepted (left/unitResults by subjectId+planSemester; no marks key for unmarked pairs). minor → task 11: test 'former teacher after handover' and 'left student does not change others' results'.
- Task 11: dispatched journal-server (sonnet), BASE 189de5b
- Task 11: complete (commits 189de5b..89a9881, review clean; probes scratchpad/probe11.mjs). minor (deferred): spy test lacks 'reads happened' assert; groupName find in loop.
- Task 12: dispatched journal-server (sonnet), BASE 89a9881
- Task 12: implementer DONE 4ce19e3. Ruling: writeMarks returns {inserted, updated, closed} rows — fine for unit 4. Ruling: allowed students = active group students, plus on a held pair those with a saved mark; others bad_ref — matches the preflight ruling (before ''). Reviewer to verify the 38 (not 40) expectation.
- Task 12: complete (commits 89a9881..4ce19e3, review clean; 34 bypass probes scratchpad/probe12.mjs; 38 not 40 confirmed — plan number was wrong). minor → task 13/14: held_missing test; inserted/updated are row arrays (use .length); noCoat log and running pair untested; too_early/journal_closed i18n keys → screens (task 19).
- Task 13: dispatched journal-server (sonnet), BASE 4ce19e3
- Task 13: complete (commits 4ce19e3..89583e5, review clean; probes scratchpad/probe13.mjs). minor (deferred): optional reason dropped when not required (journalData.js:133); owner question for final: a replaced teacher loses access to the change log of the subject.
- Task 14: dispatched journal-server (sonnet), BASE 89583e5
- Task 14: complete (commits 89583e5..4c59384, review clean; probes scratchpad/p14.mjs; restart after reset loses nothing; held_missing tail of task 12 closed). i18n keys pending for screens: too_early, journal_closed, has_marks. minor (deferred): after restart, changeLog rows refer to removed pairIds → empty date/slot in log view.
- Task 15: dispatched journal-server (sonnet), BASE 4c59384
- Task 15: complete (commits 4c59384..95ee5f5, review clean; probes scratchpad/probe15.mjs, numbers match journal.get). minor (deferred): assert.ok(g1) noise; no regression tests for transferred/disabled student. Owner note for final: a transferred student does not see old-group marks in the cabinet.
- Task 16: dispatched journal-server (sonnet), BASE 95ee5f5
- Task 16: complete (commits 95ee5f5..3a9c2a1, review clean). Ruling: Анатомия has 6 lessons and 17–20 held pairs → 11–14 pairs without topic after approval; 03-1 Информатика has no syllabus — acceptable per task; mention to the owner at block 1; extend Анатомия topics only if the owner asks.
- Server phase 7–16 complete. Pending i18n keys for screens: too_early, journal_closed (task 19), has_marks (task 22).
- Task 17: dispatched journal-screens (opus), BASE 3a9c2a1
- Task 17: implementer DONE eb040e3 (opus, 678 tests, shots in task-17-shots/, stand and Chrome stopped by own PIDs). NOT YET REVIEWED. Noted: teacher menu «Журнал» vs page heading «Журналы» (dictionary-only); extra keys journal.loading, journal.list.*.
- PAUSE 22.11 (owner asked about credits): 5-hour limit 94%, weekly 73%, Fable weekly 85%. Next: review task 17 (BASE 3a9c2a1, HEAD eb040e3), then tasks 18–19 → block 1 stop. Owner to choose savings (see aidlc-state step 5).
- OWNER RULING 22.11 (economy, all 4): new chat for the coordinator; screens 18–26 on sonnet; AI review only for tasks 19, 20, 22, 26 (rights/student data), others accepted by the owner per block; final review of the unit on opus (not fable).
- Task 17: complete (commits 3a9c2a1..eb040e3, no AI review per owner ruling — owner reviews block 1).
- RESUME HERE: Task 18 (sonnet, journal-screens), BASE eb040e3. Then 19 (+review) → block 1 stop: raise journal-dev-reset, log in as teacher1, give the owner the list, notes into aidlc-docs/construction/unit-3-zhurnal/замечания.md.
- Task 18: dispatched journal-screens (sonnet, owner economy ruling overrides plan's opus), BASE 818d4bb
- Task 18: complete (commits 818d4bb..2811993, no AI review per owner ruling; coordinator looked at teacher1-dark-1366 — ok; 682 tests). Ruling: «Пропуски» = absent + excused (unexcused late/madeup not counted) — matches attendanceStats fields; ask the owner at block 1. Owner notes for block 1: state of a pair shown as a coloured dot (text in tooltip/legend); crumb «Журнал › Журналы» for office; cancelled/missed/left-student styles not seen on the stand data; ky abbreviations need a native speaker.
- Task 19: dispatched journal-screens (sonnet), BASE 2811993
- Task 19: implementer DONE_WITH_CONCERNS 73ebe7c (687 tests; stand db edited for a Sunday — dev:reset restores; dean case checked on Informatics overdue pair, not Anatomy 02-1). Review dispatched (sonnet, light, rights probes).
- Task 19: complete (commits 2811993..73ebe7c, review clean; probe scratchpad/probe19.mjs). minor (deferred): number input «5e» silently empties activity; pairHint «Срок прошёл. Обратитесь в деканат» shown to prorector too (teacher only is better); in-window too_early/journal_closed/pair_locked/forbidden not seen live; future pair = header hint instead of an error in the window (accepted).
- BLOCK 1 STOP: owner reviews tasks 17–19 on journal-dev-reset.
- Coordinator: stand journal-dev for block 1 — Informatics 01-1 pair p_51b2eff1 moved 16.11→21.11 (Sat), status planned, its 22 marks and log rows removed in dev/data/db.json (Sunday: teacher1 had nothing to mark). dev:reset restores.

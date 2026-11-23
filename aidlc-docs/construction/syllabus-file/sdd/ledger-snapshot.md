# SDD ledger — plan: aidlc-docs/construction/syllabus-file/plan.md

Spec: `.superpowers/sdd/plan-syllabus-file-brief.md` (owner answers 24.11.2026, all defaults) + decision table in `aidlc-docs/aidlc-state.md`.
Plan: 454d0f7 (planner, opus); preflight (opus) — `preflight.md` here, 4 important + 8 minor, all applied in e6edf1d.
Ruling: preflight by the opus reviewer replaces the skill's own conflict scan — it checked names, tests to break and task consistency against the real code — cost if wrong: a task finds a conflict mid-way, handled by a ruling then.
Ruling: upload limit for the syllabus file = shared FILE_LIMITS (60 files / 200 MiB per person per day) — deanery fills for 40 teachers — cost: none significant.
Ruling: work on `main` as in all previous units (owner's established practice, no worktree) — cost: none.
Models: Л/С/Э and reviewers sonnet; strict review tasks 1–3, task 4 sonnet review on files and the student page; final review opus.

Task 1: dispatched (journal-logic, sonnet), BASE e6edf1d
Task 1: implementer DONE 6c56b8e (904 tests, build:gas ok); strict review dispatched (journal-reviewer, sonnet)
Task 1: complete (commits e6edf1d..6c56b8e, review clean)
minor (deferred): core/schema.js FILE_STATES — extra spaces before the comment after 'syllabus' (cosmetic) → final review.
Note: until task 3 lands, sweepFiles (backend/node/files.js:59-62) treats state 'syllabus' as orphan — tasks 2 and 3 must both land before any deploy (they will).
Task 2: dispatched (journal-server, sonnet), BASE 6c56b8e
Task 2: implementer DONE_WITH_CONCERNS 7bc76ff (917 tests); concerns: allowed edit of syllabusRead test; null instead of undefined for no-token case (brief snippet bug, correct); sweep left to task 3; CRLF warnings. Ruling: concerns accepted as is — all within brief — cost: none. Strict review dispatched.
Task 2: review — spec ✅, 2 Important (tests miss Review Focus 1–2 cases: returned version for student, archived version write/read, other teacher same discipline; weak notEqual refusal check). Code correct per bypass probes. Fix round 1 → resume implementer, findings in task-2-fix-1.md.
Task 2: minor (deferred → task 3 dispatch, same zone): work.submit with a syllabus file id → bad_ref test (one line); dropFile read count on the lists counter.
Task 2: minor (deferred → task 3): files.put before insertMany — on a rolled-back write a file is left on disk without a row; the task 3 sweep must remove such orphans (older than a day).
Task 2: minor (deferred → final review): `covers` lets a substitute teacher read the approved file for any pair ever (same as syllabus.get, syllabusData.js:75) — intended per brief; final review to confirm. Name `.pdf` (only extension) accepted — harmless.
Task 2: fix round 1/5 (2 addressed, 0 open — tests for returned/archived/other-teacher versions, exact refusal codes; commits 7bc76ff..5bf32dc)
Task 2: complete (commits 6c56b8e..5bf32dc, review clean after 1 round; 918 tests)
Task 3: dispatched (journal-server, sonnet), BASE 5bf32dc — carries task 2 minors: work.submit bad_ref test, dropFile lists count, sweep must remove an on-disk orphan without a row (files.put before insertMany).
Task 3: implementer DONE 5b6e012 (922 tests, build:gas ok; task 2 minors done); strict review dispatched
Task 3: complete (commits 5bf32dc..5b6e012, review clean; probe scratchpad/probe.mjs confirmed all sweep cases)
Task 3: minor (deferred → final review): tests/filesBox.test.js:182-202 sweep tests lack: old unlinked syllabus row removed with file, young unlinked kept, old disk file without row removed, pending/attached/traversal rows, young orphan file — behaviour correct per probe, but a regression would be silent; tests/seedWork.test.js:268 hard-to-read filter.
Task 4: dispatched (journal-screens, sonnet), BASE 5b6e012; shots → task-4-shots/
Task 4: implementer DONE_WITH_CONCERNS c1afcf3 (923 tests, build:gas ok, 20 shots). Concerns: student sees «syllabus is updating» once v2 is sent (existing behaviour — owner checks student before sending v2); S1001 default lang ky; file-missing text not triggered in browser; extra CSS rule `.student .syllabus-head__text {flex:1 1 100%}` for full-width button (328×44). Ruling: extra CSS accepted (needed for the 360 px button rule) — cost: none. Coordinator looked at shots 3-attached-dark and 6-student-360-light: OK. Review (sonnet, files + student page) dispatched; shots sent to the owner.
Task 4: complete (commits 5b6e012..c1afcf3, review clean)
Task 4: minor (deferred → final review): hidden file input stays in document.body after leaving the form (syllabusAttach.js:558); failed dropFile has no «Повторить» (629-643); no test for openFile missingKey branch; dayOf (499) — check server sends local `at`.
All 4 tasks complete (923 tests). Shots sent to the owner; waiting for owner acceptance of the block, then final review (opus).
Owner accepted the block (task 4 screens) 24.11. Final review (opus) dispatched over e6edf1d..c1afcf3.
Final review (opus): готово, 0 code fixes; 3 minor + 2 notes — aidlc-docs/construction/syllabus-file/sdd/final-review-findings.md. No fix wave needed.
Ruling: stand keeps the sample PDF only on approved v1 «Информатики» (returned v2 without file), contrary to plan.md:416 — the owner accepted screenshots built on this; code and test agree — cost if wrong: on the stand the teacher's returned copy shows no file (cosmetic, stand only).
Ruling: rollback note rewritten by the final review (old sweep deletes syllabus files at the first start, serve:backup before rollback) — goes into aidlc-state at deploy — cost if wrong: files restored from C:\JournalBackups\files.
Ruling: `.doc` checked only by the common Office header, PDF by `%PDF-` — known limit, same rule as unit 5 — cost: an Excel named .doc is accepted and Word cannot open it.

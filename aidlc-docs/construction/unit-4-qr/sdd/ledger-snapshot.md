# SDD ledger — plan: D:\Журнал колледжа\aidlc-docs\construction\unit-4-qr\plan.md

Spec: aidlc-docs/inception/design-v1.md §6 + owner decision table (23.11 rows: unit 4 answers, journal views).
Branch: main (project practice). Plan written by opus (Fable weekly 85%), commit 442957a; 13 tasks, owner blocks: 1 (tasks 10–11), 2 (task 12).

- Preflight: dispatched journal-reviewer (opus), HEAD 442957a (after journal views 880afac) → preflight.md
- OWNER 23.11: plan questions — all 4 defaults (start only by who leads the pair; nobody marked → nobody «не был»; «Закончить отметку» early — yes; projector shows names). Journal views 880afac — waiting for the owner's acceptance by screenshots.
- OWNER 23.11: journal views 880afac ACCEPTED («Принимаю»). Not deployed yet (next deploy on the owner's request).
- DEPLOYED journal views 23.11: site only, git push defe7ef, Pages success; server stays a4bdbf0.
- Preflight: done (opus) — 6 important (I1 late finish writes press time; I2 lesson.start order; I3 task 3 breaks tests not listed + MARK_SOURCES exists; I4 task 12 poll needs time it doesn't have; I5 change log on a running pair — owner; I6 QR tables missing), 17 minor. Saved by the coordinator to preflight.md (reviewer cannot write files).
- OWNER 23.11 (I5): on a running pair only a change of an existing status goes to the change log (default); deanery edits always logged with a reason.
- Ruling: all 6 important and all 17 minor go into plan.md (M13: add settle to changePair/cancelPair/restorePair, not a limitation — cheap and avoids a stuck running pair) — cost if wrong: slightly longer task 6.
- Plan fix: sent to the planner (opus, same agent) with preflight.md.
- Plan fix: done 1d9ba3f (all I1–I6, M1–M17; deviations accepted: M5 after 23:30 prepareLessonNow returns null; M11 split tasks 6/8; M12 in task 8 (server zone); M17 search first.nextQr). Open: QR readability only by the owner's phone at block 1; I3 line numbers may shift if tests change before task 3.
- Side task (owner 23.11): compact pair window + side menu keeps scroll — journal-screens (sonnet), brief .superpowers/sdd/compact-ui/brief.md; running.
- 23.11 new coordinator chat: compact-ui agent had been cut off (code in the working copy, no shots, no commit; its stand on 5273 PID 3080 stopped by PID). Ruling: resume it with a new journal-screens (sonnet) on the uncommitted diff, not from scratch — cost if wrong: one more round.
- Contracts for unit 4: done (implementer/reviewer/rereview copied from plan-unit-3-zhurnal; Global Constraints and Review Focus of plan-unit-4 put in).
- Correction: the first compact-ui agent was NOT cut off — it was still running after /clear and committed f2d2e50 (719 tests; dean reason mode 1366×768: 12 rows instead of 4; 1366×600: 8 instead of 2; menu keeps scrollTop). The duplicate agent stopped by the coordinator before any commit; its stand on 5273 (PID 30120) stopped by PID. Coordinator checked: git clean, npm test 719/719, shots before/after pair + menu. Lesson: after /clear check ListAgents for running agents before relaunching a task.
- OWNER 23.11: compact-ui f2d2e50 ACCEPTED («Принимаю»). Not deployed (site deploy only on request).
- RESUME HERE: after the owner accepts compact-ui (f2d2e50) — Task 1 (journal-logic, sonnet). Owner stops: block 1 after tasks 10–11, block 2 after 12; task 13 = final review (opus) + deploy only on the owner's request.
- Task 1: BASE 34ea381; dispatched journal-logic (sonnet), brief task-1-brief.md, report task-1-report.md
- Task 1: implementer DONE 5518d86 (723 tests, build:gas ok); dispatching journal-reviewer (sonnet, light review)
- Task 1: review (sonnet) Approved, 0 critical/important. minor (deferred): lessonClock of a closed pair with empty checkinUntil gives checkinLeftMs/checkinEndMs NaN (core/lesson.js:102,115) — pass to the next journal-logic task; no midnight probe for startProblem (code compares localDate).
Task 1: complete (commits 34ea381..5518d86, review clean)
- Task 2: BASE 5518d86; dispatched journal-logic (sonnet) with task-1 minor (NaN checkinLeftMs) attached
- Task 2: implementer DONE bafab81 (727 tests, build:gas ok, task-1 minor fixed in same commit); dispatching journal-reviewer (sonnet, light)
- Task 2: review (sonnet) Approved, 0 critical/important. minor (deferred, no action): matchCode does not type-check pair.id/startedAt (lessonClock already gates).
Task 2: complete (commits 5518d86..bafab81, review clean)
- Task 3: BASE bafab81; dispatched journal-logic (sonnet) with data-model.md (plan section «Модель данных»); strict review planned. Ruling: test line numbers in brief may have shifted — implementer finds the named checks by content — cost if wrong: one extra check edited, reviewer sees it in diff.
- Task 3: implementer DONE eb45e97 (729 tests, build:gas ok); dispatching journal-reviewer (sonnet, STRICT rights probes)
- Task 3: strict review (sonnet) Approved, 0 findings; probes scratchpad/probe3.mjs (roles with spaces/case/objects, checkins via dir/import for all roles) all refused. Note: nested [['teacher']] passes can() — unreachable (roles always from rolesOf).
Task 3: complete (commits bafab81..eb45e97, review clean)
- Task 4: BASE eb45e97; dispatched journal-logic (sonnet)
- Task 4: implementer DONE 5790716 (734 tests, build:gas ok); edge choices: running pair with unreadable startedAt skipped, unreadable checkinUntil → startedAt+5min; dispatching journal-reviewer (sonnet)
- Task 4: review (sonnet) Approved, 0 critical/important; probes scratchpad/p4.mjs. minor (deferred → task 5, journal-logic): tests for the two edge choices (unreadable startedAt skipped, unreadable checkinUntil → startedAt+5min). minor (deferred → task 6 / final review): running pair with unreadable startedAt stays running forever (blocks move/cancel) — server never writes it; consider a manual way out.
Task 4: complete (commits eb45e97..5790716, review clean)
- Task 5: BASE 5790716; dispatched journal-logic (sonnet) + task-4 minor (2 edge tests in tests/lessonSettle.test.js)
- Task 5: implementer DONE_WITH_CONCERNS d732556 (741 tests): no honest RED (code before tests); N4 via common formula ceil(|dark*20-cells*10|/cells)-1; self-decoder round-trips ~40 texts v1–10; no external reference matrix (no QR libs on this PC: qrcode/segno/cv2/pyzbar/zxing absent). Ruling: accept concerns into review, readability = owner's phone at block 1 as planned — cost if wrong: a fix round against Nayuki at block 1. Dispatching journal-reviewer (sonnet).
- Task 5: review (sonnet) Approved, 0 critical/important. minor (deferred → final review): N4 ceil(x)-1 differs from standard floor(x) when x integer (v2/v7 only) — mask choice only, readability unaffected; fix Math.floor(|d*20-cells*10|/cells). Test decoder partly mirrors encoder — standard guarded by external vectors + owner's phone at block 1.
Task 5: complete (commits 5790716..d732556, review clean)
- Task 6: BASE d732556; dispatched journal-server (sonnet) with server-test-helpers.md (plan section); STRICT review planned. Carried: task-4 minor (stuck running pair with unreadable startedAt) as a note only, no new requirement.
- Task 6: implementer DONE 3b072b4 (747 tests, unit 3 tests unchanged, build:gas ok); dispatching journal-reviewer (sonnet, STRICT)
- Task 6: strict review (sonnet) Approved, 0 critical/important; probes scratchpad/probe6.test.js (reads once in 8 actions, pair_locked snapshots equal, no service fields/foreign ids in grades). ⚠ SQLite rollback of settle on refusal verified by reading only — covered in task 8 (SQLite). minor (deferred → task 7, journal-server): pin read counters for schedule.changePair/cancelPair/restorePair in tests. minor (final review): running pair with unreadable startedAt never closes.
Task 6: complete (commits d732556..3b072b4, review clean)
- Task 7: BASE 3b072b4; dispatched journal-server (sonnet) + task-6 minor (read counters for schedule.changePair/cancelPair/restorePair); STRICT review planned
- Task 7: implementer DONE c085339 (754 tests); deviations: exported lastOf; attended counts only active group students; lesson.mine without checkins; case (a) first pair started 08:10 instead of 09:29. Dispatching journal-reviewer (sonnet, STRICT).
- Task 7: strict review (sonnet) Approved; probes scratchpad/probe7.test.js (codes not leaked anywhere, pair key not stored, odd pairIds → not_found, foreign pair → forbidden incl. dean,teacher and subject teacher on substitution). 4 deviations accepted. Gap: brief scenario (a) (first pair started 09:29:00, second at 09:30:00 → first closed 09:30:00 by teacher, window cut) not pinned in tests (test uses 08:10); reviewer's probe shows behaviour correct.
- Ruling: the scenario (a) test and lesson.mine per-table read counters go into task 8 (same journal-server agent type, same test helpers) instead of a fix round — behaviour already proven by the reviewer's probe — cost if wrong: one fix round later if task 8 review finds it missing.
Task 7: complete (commits 3b072b4..c085339, 1 gap carried to task 8)
- Task 8: BASE c085339; dispatched journal-server (sonnet) + carried from task 7: scenario (a) test (09:29:00 start, 09:30:00 second start) and lesson.mine per-table read counters; + SQLite check that a refused request after a due window leaves the base consistent and the next request settles (task-6 ⚠). STRICT review planned.
- Task 8: implementer DONE 348d273 (762 tests; load 25 marks 212 ms on SQLite); no RED run; flaky ~2/10000 'code_expired' check unguarded (brief asked to shift clock on collision). Dispatching journal-reviewer (sonnet, STRICT).
- Task 8: strict review (sonnet) Approved, 0 critical/important; probes scratchpad/probe8.mjs, probe8b.mjs (odd data/device/code/pass → bad_request, staff → forbidden, forged exp → bad_pass, other group → forbidden, same device → device_used; current has no codes/foreign ids); load 221 ms. minor (deferred → task 9, journal-server): guard the code collision flake in tests/checkinApi.test.js:210-214 as the brief says; tighten checkin.pass spy to pairs === 1; add a forged-exp pass test.
Task 8: complete (commits c085339..348d273, review clean)
- Task 9: BASE 348d273; dispatched journal-server (sonnet) + task-8 minors (collision guard, checkin.pass spy === 1, forged-exp pass test)
- Task 9: implementer DONE 3ba2b5a (767 tests; dev:lesson checked, stopped by own PID 28848); task-8 minors done. Dispatching journal-reviewer (sonnet, light).
- Task 9: review (sonnet) Approved, 0 critical/important. minor (deferred → final review): --lesson-now without --reset silently prepares nothing (unreachable via npm run dev:lesson); real-clock stand test is weak but honest.
Task 9: complete (commits 348d273..3ba2b5a, review clean)
- Task 10: BASE ef83210; dispatched journal-screens (sonnet); no AI review (owner block 1 after task 11)
- Task 10: DONE_WITH_CONCERNS 1acc51c (775 tests). Concerns: real fullscreen not testable in headless (emulated: QR 61% of 1080); shell.js edited (lesson view without side menu/top bar) — accepted, needed for projector; home cards at 360px not checked; ky texts to proofread; empty space right of the names. Coordinator looked at 01-home-teacher.png and 04-lesson-checkin-after.png — OK. Ruling: accept into block 1 (owner checks real fullscreen + QR by phone) — cost if wrong: fixes in block 1 round.
Task 10: complete (commits ef83210..1acc51c, owner block 1)
- Task 11: BASE 1acc51c; dispatched journal-screens (sonnet); AI review after (student marks edit)
- Task 11: DONE_WITH_CONCERNS 2d0860b (778 tests); summary editable only in phase lesson (read-only during checkin and after close); leave-question 'Сохранить'/'Не сохранять' not tested on stand; CK recalculation not checked by numbers. Dispatching journal-reviewer (sonnet).
- Task 11: review (sonnet) Approved; 'summary editable only in phase lesson' accepted. minor (deferred → block 1 fixes): unsaved edits linger after the pair auto-closes (reset S.edits when phase leaves lesson); Back during saving reopens the question (harmless).
Task 11: complete (commits 1acc51c..2d0860b, review clean)
- BLOCK 1 STOP: coordinator raises journal-dev-lesson, logs in as teacher1, owner checks list (QR by phone camera). Student screen is task 12 — student check-in in block 1 is done by the coordinator by request (checkin.mark), not by the owner.
- OWNER 23.11: block 1 ACCEPTED («Да, все пока что так как я хотел»). QR read by the owner's phone NOT explicitly confirmed — Ruling: carry the phone QR check to block 2 (student QR link) and task 13 (live site from phone); if it fails, replace site/js/qr.js by a vetted MIT library vendored in site/vendor/ (told the owner) — cost if wrong: one small task.
- Coordinator stand journal-dev-lesson stopped (preview_stop) before task 12.

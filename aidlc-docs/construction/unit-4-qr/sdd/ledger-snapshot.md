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
- compact-ui: waiting for the owner's acceptance by screenshots.
- RESUME HERE: after the owner accepts compact-ui (f2d2e50) — Task 1 (journal-logic, sonnet). Owner stops: block 1 after tasks 10–11, block 2 after 12; task 13 = final review (opus) + deploy only on the owner's request.

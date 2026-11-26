# SDD ledger — plan: aidlc-docs/construction/spravochniki-2/plan.md


План: `aidlc-docs/construction/spravochniki-2/plan.md`. Дизайн: `aidlc-docs/construction/spravochniki-2/design.md`. Страница владельца: `owner-summary.md`.

## 26.11.2026 — дизайн и план

- Дизайн согласован владельцем (`af8f1bb`): все рекомендованные ответы, карточка студента — вариант А, остальные макеты приняты.
- Проверка строителя (sonnet): 7 вопросов, все решены координатором, вопросов к владельцу нет.
- План написан (opus, `82a4e8d`): 8 задач. Сервер 1–5, затем экраны: блок 1 — задача 6, блок 2 — задача 7. Задача 8 — общая проверка (opus) и выкладка только по просьбе. Fable не брали: недельный лимит всех моделей занят на 72 %.
- Сверка плана (opus, journal-reviewer) вернула план: 4 важные находки и 8 мелких (`preflight.md`). Пробные скрипты — `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\ef499152-6672-4033-9ef3-088e42697558\scratchpad\probe\`.
- Ruling: предмет без силлабуса или семестра, но с парами в датах семестра, входит в расчёт: посещаемость по парам, юниты «—». Дизайн поправлен (`9d2e7b5`).
- Ruling: «не заполнено» — только пары в состоянии planned после конца пары; `missed` («не проведена» от деканата) не считается.
- Ruling: «< 2 с» требуется от сервера SQLite. Для Google — каждый лист читается один раз и `build:gas` собирается.
- Находки внесены тем же автором плана (`0a3a551`). `npm test` — 1459/1459. Первый прогон дал 1 падение при изменении только документов, повтор прошёл. minor (deferred): найти нестабильный тест, если упадёт снова.
- Ruling: повторная сверка не нужна. Правки малые, числа пересчитаны пробой проверяющего. Координатор прочитал `owner-summary.md`.
- **Дальше:** согласие владельца на план → памятки (`implementer-contract.md`, `reviewer-contract.md`, `rereview-contract.md`) скопировать из `plan-sillabus-discipliny` и подставить Global Constraints нового плана → задача 1.

## Сборка

- Ruling: сборка в этом чате на `main` — владелец написал «Согласен, сборка» здесь (правило CLAUDE.md: фраза для нового чата — продолжаем здесь); памятки скопированы с Global Constraints нового плана.
- Task 1 dispatched: journal-logic (sonnet), BASE 4a13bae, brief task-1-brief.md, report task-1-report.md.
- Task 1 report: DONE (7ff701f; 1466 tests, build:gas OK); readings: unitGap counts missing entry as not set; subjectState skips semester check when semester null.
- Task 1 review (sonnet, light + rights probe): spec ✅, quality Approved; 2 readings accepted; minor (deferred): debtOf null for unknown status, semesterPoints not imported.
- Task 1: complete (commits 4a13bae..7ff701f, review clean)
- Task 2 dispatched: journal-server (sonnet), BASE 7ff701f, brief task-2-brief.md, report task-2-report.md.
- Task 2 report: DONE (ed6e2fb; 1479 tests, build:gas OK); RED shown after the fact; group subjects sorted by subject.name (dir.card by discipline name).
- Task 2 review (sonnet, strict, probe scratchpad/p/probe.test.js): spec ✅, quality Approved, no findings; sort by subject.name OK (renameSubjects keeps names equal).
- Task 2: complete (commits 7ff701f..ed6e2fb, review clean)
- Task 3 dispatched: journal-server (sonnet), BASE ed6e2fb, brief task-3-brief.md, report task-3-report.md.
- Task 3 report: DONE (7c38679; 1489 tests, build:gas OK); debtOf real signature (row, cards) — cards filtered first; staff branch bad_request until task 4; repeat-only student without traces gets no debt row (brief definition).
- Task 3 review dispatched (sonnet, strict).
- Task 3 review (sonnet, strict, probes scratchpad/p3): spec ✅ quality Approved; Important: student with no traces (no marks, unit results, attempts) loses his past-half debt though ledger.get shows not_admitted (halfResults takes only students with traces).
- Ruling: fix it in task 3 (debtsOf), not accept — spec «Долги» = closed final with fail/not admitted/absent/I, and «тихий пропуск хуже громкой ошибки»; halfResults itself stays unchanged (repeat enrolment uses it) — cost if wrong: one more round. Pre-existing risk for final review: repeat enrolment may not see a traceless student either.
- Task 3: minor (deferred): no test for closed final + unit below fair (risk in list vs card); bypass test lacks dir.people with id/extra keys.
- Task 3 fix round 1 report: DONE (7d57cc2; 1490 tests, build:gas OK); debtsOf adds an empty unit row for a traceless active student of the own group before halfResults; repeatSnapshot untouched. Flaky npm test seen again once (parallel run) — minor (deferred), final review to find it.
- Task 3: fix round 1/5 (1 addressed, 1 new — a student added to the group after a past half closed gets a not_admitted debt; commits 7c38679..7d57cc2)
- Ruling: accept the new case, no round 2 — the card shows exactly what the past-half ledger shows (the ledger also lists every active student of the group as not admitted); without a «joined the group» date in the base the two cases cannot be told apart, and a visible false debt is better than a silently lost real one (project rule «громкая ошибка лучше тихого пропуска»); at the pilot start there are no closed past halves, so no false debts appear — cost if wrong: the deanery sees a debt on a newcomer, fixable later by a join date (base change, owner decision). Tell the owner; note in aidlc-state.
- Task 3: complete (commits ed6e2fb..7d57cc2, 1 parked with ruling)
- Task 4 dispatched: journal-server (sonnet), BASE 7d57cc2, brief task-4-brief.md, report task-4-report.txt.
- Task 4 report: DONE (974cfdb; 1498 tests, build:gas OK); no separate RED run; names from subject.name.
- Task 4 review dispatched (sonnet, strict).
- Task 4 review (sonnet, strict, probes scratchpad/p4): spec ✅ quality Approved, no Critical/Important.
- Task 4: minor (deferred): from 9999-12-31 passes isDate and gives to +010000-01-02 (harmless); add a test that the prorector sees review/returned syllabi (part-1 rule syllabusFlow.js:50 — he sees all but drafts, matches CLAUDE.md; my dispatch wording «не видит на утверждении» was wrong, no change).
- Task 4: complete (commits 7d57cc2..974cfdb, review clean)
- Task 5 dispatched: journal-server (sonnet), BASE 974cfdb, brief task-5-brief.md, report task-5-report.txt.
- Task 5 report: DONE (c63660c; 1502 tests, build:gas OK); brief numbers matched; unfilledPairs subject name not asserted.
- Task 5 review (sonnet, light): spec ✅ quality Approved, no findings.
- Task 5: complete (commits 974cfdb..c63660c, review clean)
- **Server part (tasks 1–5) done:** 1502 tests, build:gas OK, last commit c63660c. Next: new coordinator chat (rule 6б) → task 6 (Э, journal-screens sonnet, owner block 1; stop the coordinator stand on 5273 first; screenshots in task-6-shots/) → stop for owner acceptance.

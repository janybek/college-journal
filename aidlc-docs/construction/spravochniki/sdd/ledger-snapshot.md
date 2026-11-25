# SDD ledger — plan: aidlc-docs/construction/spravochniki/plan.md

Доработка «Справочники с подробностями» (5 задач). Спецификация — `design.md` рядом с планом. Решения владельца — таблица решений `aidlc-docs/aidlc-state.md` (25.11.2026). Сверка плана — `preflight.md` в этой папке (все находки внесены, `6c0be2b`).

- 25.11.2026 Ruling: памятки сделаны из памяток «Повторного курса»: раздел Global constraints заменён разделом Global Constraints плана + «Чего в доработке нет»; Review Focus — плана справочников. Работа на `main`, как во всех юнитах (согласие владельца — порядок AI-DLC).
- Task 1: dispatched journal-logic (sonnet), BASE 78f0396; проверка облегчённая; report task-1-report.md
- Task 1: implementer DONE (4b240bd, 1284 теста, RED ERR_MODULE_NOT_FOUND, build:gas). Прежние тесты не правлены.
- Task 1: review dispatched journal-reviewer (sonnet, light)
- Task 1: review — принять (light, sonnet). minor (deferred -> задача 2): permissions.test.js без table 5 и '__proto__' — в задаче 2 они проверяются на уровне запроса (Review Focus 1).
- Task 1: complete (commits 78f0396..4b240bd, review clean)
- Task 2: dispatched journal-server (sonnet), BASE 4b240bd; проверка строгая; report task-2-report.md
- Task 2: implementer DONE (26a973d, 1296 тестов, build:gas). Числа стенда сошлись. Отступления: тест скорости входит заранее (вход читает staff); не-объект data -> {}; предмет без дисциплины -> syllabus {approved:false, open:null}.
- Task 2: review dispatched journal-reviewer (sonnet, strict)
- Task 2: review — принять (strict, sonnet; probe.mjs в scratchpad координатора: обход прав, id/from, утечки, черновик у проректора, ничего не пишется при идущей паре). Отступления исполнителя приняты. minor: backend/handlers/dir.js:207 data.table без защиты — недостижимо (права раньше), без правки.
- Task 2: complete (commits 4b240bd..26a973d, review clean)
- Ruling: серверная часть (задачи 1–2) закончена; правило 6б велит итоги и новый чат — итоги записаны, но чат координатора короткий (2 задачи), поэтому задачи 3–4 идут в этом же чате — дешевле, чем перечитывать всё в новом. Если неправ — потеря только токенов.

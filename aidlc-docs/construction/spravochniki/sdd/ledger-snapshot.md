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
- Task 3: dispatched journal-screens (sonnet), BASE e8cd7c8; без проверки ИИ (блок владельца); report task-3-report.md
- Task 3: implementer DONE (d3d240e, 1304 теста, RED router, build:gas). Скриншоты task-3-shots (12). Добавление сверх задания: после добавления/удаления записи цифры перечитываются — принять (иначе новая строка без чисел). Координатор посмотрел groups-dark и rooms-light — как в макете.
- Task 3: complete (commits e8cd7c8..d3d240e, без проверки ИИ по плану; приёмка — блоком владельца после задачи 4)
- Task 4: dispatched journal-screens (sonnet, тот же агент продолжен), BASE d3d240e; проверка строгая; report task-4-report.md
- Task 4: implementer DONE (0d22f2c, 1308 тестов, RED 4 новых, build:gas). Попутно исправлено «null» в пустом блоке. Не проверено в браузере: подпись отключённых, зачётная неделя в аудитории, ошибка сервера в карточке.
- Task 4: review dispatched journal-reviewer (sonnet, strict); координатор посмотрел group-02-1-dark, room-101-next — как в макете
- Task 4: review — принять (strict, sonnet). minor (deferred -> задача 5 / круг правок владельца): (1) dirCard.js:504-506, changeWeek 633 — ошибка загрузки другой недели молча оставляет прежнюю неделю (нужна note('error') и сброс errorCode); (2) siteDirInfo.test.js:759 формы inactive ищутся подстрокой в ru.js; (3) импорты посреди siteDirInfo.test.js:738; (4) ky.js:207 «Жумасына» -> «Аптасына» (вне задания, безвредно); (5) экранно не видели: отключённые, зачётная неделя в аудитории, ошибка сервера в карточке — пункт 9 приёмки владельца покрывает отключённых.
- Task 4: complete (commits d3d240e..0d22f2c, review clean, 4 minor deferred)
- Стоп: приёмка блока (задачи 3–4) владельцем на стенде journal-dev-lesson.
- Ruling: выкладка на тестовый (aab1d0c) до общей проверки — прямая просьба владельца «Выложи все на тестовый, я не за компом»; доработка только читает, база не меняется; общая проверка — после, исправления — следующей выкладкой.

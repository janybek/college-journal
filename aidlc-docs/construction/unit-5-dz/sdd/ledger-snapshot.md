# Юнит 5 «ДЗ и СРС» — журнал хода работ

План: `aidlc-docs/construction/unit-5-dz/plan.md`.

- 23.11.2026 Ruling: вопросы до плана — все по умолчанию (таблица решений). План пишет opus (задание `.superpowers/sdd/plan-unit-5-dz-brief.md`) → `c7353e9`, 13 задач, 3 блока.
- 23.11.2026 Ruling: 7 вопросов плана — все по умолчанию (`adc6e6b`).
- 23.11.2026 Ruling: сверка плана (opus, `preflight.md`): I1–I8, M1–M20; вопрос владельцу «писать смену максимума/срока в журнал изменений» — да (`8454bb8`). Находки внесены агентом sonnet (`cdb40a6`); префикс ключей `journal.log.work.*` сверен координатором с `site/js/i18n/ru.js`. Не проверено правщиком: устройство `keyed` (M11) и импорт `currentAttempt` в тест задачи 7 — сверить исполнителям задач 12 и 7.
- Следующее: памятки из `plan-unit-4-qr/` с Global Constraints юнита 5, затем задача 1.

## Сборка
- 23.11.2026 Памятки юнита 5 сделаны из памяток юнита 4 с Global Constraints и Review Focus плана юнита 5.
- Task 1: base 7c45d12, исполнитель journal-logic (sonnet)
- Task 1: implementer agent a23cd3bbc9a112193 (journal-logic, sonnet)
- Task 1: implementer DONE 3be0fab (794 tests). Review (sonnet, strict): 1 Important — cleanFileName splits only on '/', not '\'. Пробы: scratchpad\task1-probes\p2.mjs
- Task 1: Ruling: в тот же круг взято '.'/'..' -> 'file' (та же функция, одна строка) — дешевле, чем отложить; если неверно — одна строка в тесте.
- Task 1: minor (deferred): маркеры макросов в ZIP ищутся с учётом регистра (VBAPROJECT.BIN) — имена частей OPC регистронезависимы; посмотреть в общей проверке.
- Task 1: minor (deferred): U+200B, U+2028 не вычищаются из имени (сверх задания).
- Task 1: note: полиглот '%PDF-<html>' принимается как pdf — защита на сайте (тип Blob из своего списка, Review Focus 8, задачи 6 и 10).
- Task 1: fix round 1/5 (1 addressed, 0 open — backslash split, '.'/'..' -> file; commits 3be0fab..28dde54). Ruling: круг в одну строку принят координатором сам (diff прочитан, npm test 794/794, build:gas, пробы p2.mjs: 'b.pdf','evil.pdf','y.pdf').
Task 1: complete (commits 7c45d12..28dde54, review clean)
- Task 2: base 28dde54, исполнитель journal-logic (sonnet), новый агент
- Task 2: implementer agent a484e867fb8b18c08; к заданию добавлен раздел «Правила расчёта»
- Task 2: implementer DONE_WITH_CONCERNS aa14a59 (804 tests): нет RED-прогона (тесты после кода); self через cap(); locked kind -> только kind/locked
- Task 2: review (sonnet) Approved, 0 Important.
- Task 2: minor (to task 3): core/work.js:86 topicId не строка (массив, число) молча -> '' вместо topicId/bad_ref.
- Task 2: minor (deferred): grades.js:43 cap(sw.value, scheme.self) — нет теста «схему уменьшили при selfWork»; процесс — RED не прогонялся.
Task 2: complete (commits 28dde54..aa14a59, review clean)
- Task 3: base aa14a59
- Task 3: implementer agent a2371ed4203662859 (journal-logic, sonnet); к заданию добавлен раздел «Модель данных»; minor задачи 2 (topicId) передан сюда
- Task 3: implementer DONE_WITH_CONCERNS 4ca88a2 (807 tests). RED-вывод не сохранён (первый прогон падал).
- Task 3: Ruling: правка tests/journalMarksApi.test.js:48 (+ assignmentId: '' в ожидаемой строке changeLog) сверх списка Files принята — новая колонка неизбежно появляется в каждой строке; если неверно — одна строка теста.
- Task 3: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task3-probes\p.mjs
- Task 3: minor (deferred): core/permissions.js:91 can() — вложенный массив [['teacher']] считается ролью teacher (has() приводит к строке); снаружи не подать (роли из строки сотрудника); защита в глубину — typeof role === 'string'.
Task 3: complete (commits aa14a59..4ca88a2, review clean)
- Task 4: base 2f2aa79 (после docs-коммита), исполнитель journal-server (sonnet)
- Task 4: implementer agent a7c2fc4d857f0ca76
- Task 4: implementer DONE 806fe89 (820 tests). Отступления: OPTIONS убран из старого списка 405 в tests/server.test.js; filesDir в tests/serverSetup.js tempConfig; restoreBase -> {before, secret, files}, новый код cannot_restore_files.
- Task 4: Ruling: OPTIONS из старой проверки 405 убран — по пункту 2а задания OPTIONS теперь 204/403, проверка противоречила заданию; если неверно — одна строка теста.
- Task 4: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task4-probes\probe.mjs, opt.mjs
- Task 4: minor (to task 5): files.js:101-127 spaceAlarm убирает файл тревоги, если statfs упал на обоих дисках; files.js:76-86 copyMissing — подпапка вида <hex>.bin даёт EPERM и ok:false у каждой копии (пропускать не-файлы).
- Task 4: minor (deferred): dev/server.js sweepFiles при запуске стенда без try/catch; filesBox.test — дата в тексте тревоги и свежая dropped без теста.
Task 4: complete (commits 2f2aa79..806fe89, review clean)
- Task 5: base 806fe89
- Task 5: implementer agent a14227395c3d2a5d7 (journal-server, sonnet); к заданию добавлены помощники journalSetup и «Права по ролям»; minor задачи 4 (spaceAlarm, copyMissing) — отдельным fix-коммитом
- Task 5: implementer DONE_WITH_CONCERNS ad41115 + 558999a (fix задачи 4), 833 tests. RED не записан.
- Task 5: Ruling: assign, pair.topicId, pair.unit — внутри data.lesson (как остальные ключи и как в плане задачи 9 «при lesson.assign»; тест lessonApi:160 это и проверяет) — верно.
- Task 5: Ruling (to task 9): work.save — «без пары» только если pairId не передан; '' / null — not_found. Сайту в задаче 9: на экране «Задания» pairId не отправлять вовсе.
- Task 5: note: number тем в work.list — буква вида + номер (Л, П, М, С, ЛР), как в словаре сайта; units — из тем нынешнего силлабуса, title из «Юнитов» или ''.
- Task 5: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task5-probes\probe2.mjs (probe1 — ложные CHANGED).
- Task 5: minor (to task 6): lessonData assign = subject.teacherId === user.id без роли teacher — брать subjectRights(...).manage; workApi.test.js:917, :1012 assert.ok(a1 && a2) пустые; нет теста lesson.get assign:false у студента/деканата.
- Task 5: minor (deferred): backend/node/files.js spaceAlarm — new Date().getTime() для даты тревоги (backend/node, не в сборке GAS).
Task 5: complete (commits 806fe89..558999a, review clean)
- Task 6: base 558999a
- Task 6: implementer agent ae0cb0534a2079985 (journal-server, sonnet); minor задачи 5 — отдельным fix-коммитом
- Task 6: implementer DONE a638e36 + 69371a3 (minor задачи 5), 847 tests. Отступления: помощник assignmentPlace в workData.js; заглушка задачи 5 «студенту work.get — not_found» заменена (своей группы ok, чужой not_found) — так и задумано задачей 5; lesson.get только преподавателю — тест проверяет отказ деканату/студенту; попытки студенту — новые сверху.
- Task 6: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task6-probes\probe1.mjs, probe2.mjs
- Task 6: minor (deferred): workFiles.js:215-220 dropFile не проверяет, что студент ещё в группе (убирает только свой pending — безвредно); workFiles.js:181-190 upload к заданию не текущего полугодия (isCurrent) принимается — решить в общей проверке; дубль isStr (workFiles.js:179, workStudent.js:257).
Task 6: complete (commits 558999a..69371a3, review clean)
- Task 7: base 69371a3
- Task 7: к заданию добавлены «Правила расчёта»; напомнить исполнителю: импорт currentAttempt в тест (из ledger сверки)
- Task 7: implementer agent a3377cdaae902f649 (journal-server, sonnet)
- Task 7: implementer DONE 73ad32e (859 tests). Новые проверки в tests/workGradeApi.test.js, старые файлы не тронуты; attemptId не строкой -> invalid attemptId/bad_value; points и status одной записи — одно at.
- Task 7: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task7-probes\p1.test.js
- Task 7: minor (to task 8): workGrade.js:393 смена только комментария переписывает checkedBy/checkedAt без строки журнала; пустые assert.ok(...) в workGradeApi.test.js (~520, 536, 549, 605, 629).
- Task 7: minor (deferred): две строки журнала одной записи с одним at — порядок по id.
Task 7: complete (commits 69371a3..73ad32e, review clean)
- Task 8: base 73ad32e
- Task 8: implementer agent a610043f6e6d25a2c (journal-server, sonnet)
- Task 8: Ruling: смена только комментария у проверенной работы не меняет checkedBy/checkedAt (они — кто и когда поставил оценку) — если неверно, одна строка в workGrade.js.
- Task 8: implementer DONE_WITH_CONCERNS 2dd3bdf + 6eb6ebe (869 tests). ДЗ сдал S1002 (у S1001 fresh 1); 7 строк журнала (возврат S1004 пишет status); demo.test.js обходит папку files/; ещё 2 пустых assert убраны; RED seedWork не записан.
- Task 8: review (sonnet, light) Approved, 0 Important.
- Task 8: minor (deferred): tests/seedWork.test.js:494 «первые 5 студентов» без сортировки по cardNo (seedWork сортирует); demo.js — файл на диске внутри транзакции, при откате остаётся сирота до уборки (допустимо).
Task 8: complete (commits 73ad32e..6eb6ebe, review clean)
- 23.11.2026 Серверная часть (задачи 1–8) готова, 869 тестов. Дальше — блок 1 экранов (задачи 9, 10), новый чат координатора. Для задачи 9: work.save без пары — pairId не передавать вовсе ('' / null — not_found). Для общей проверки — все строки «minor (deferred)» выше.

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
- 23.11.2026 новый чат координатора (после /clear): прежний проверяющий завершён, фоновых агентов нет.
- Task 9: base b70f688
- Task 9: implementer agent a0dc787c3d2c80721 (journal-screens, sonnet); в поручение: work.save без пары — pairId не передавать; headless Chrome, остановка только по PID
- Task 9: implementer DONE_WITH_CONCERNS 6c3fd32 (880 tests). Отступления: меню строки — две кнопки-иконки; openTaskForm сам читает work.get/work.list, параметры + host, onClosed; RED не записан; ky/en и заглушка студента и режим конторы глазами не смотрены; 93 новых ky-ключа на вычитку.
- Task 9: Ruling: проверка ИИ не запускается — в плане «Проверка ИИ — не нужна», правило владельца 22.11 (экраны без прав/данных студентов принимает владелец по блокам); координатор посмотрел скриншоты 08, 09, 11 — вид верный. Если неверно — недостатки всплывут на приёмке блока 1.
Task 9: complete (commits b70f688..6c3fd32, owner block review)
- Task 10: base 6c3fd32
- Task 10: implementer agent a87d4a6241c1c2ce9 (journal-screens, sonnet); после — строгая проверка (баллы, файлы)
- Task 10: implementer DONE_WITH_CONCERNS fcb6a58 (883 tests, RED записан). Ждущий в «Эссе» отсутствует на стенде — проверено на «Презентации»; PDF не открывался (нет на стенде); «Сохранить» в вопросе о несохранённом всегда «Проверено»; двойное окно ухода при смене адреса из консоли (общий holdOnLeave в main.js).
- Task 10: review (sonnet, strict) agent ace7c95f5b9863d3b
- Task 10: review (sonnet, strict) Approved, 0 Important. Пробы: scratchpad\task10-probes\server.js, probe.html (openFile в headless Chrome: разметка в имени, подмена kind, неверный base64, revokeObjectURL).
- Task 10: minor (deferred): task.js:682 settleUnsaved всегда save('checked') — у возвращённой попытки без баллов сервер откажет (ошибка у поля, данные целы); task.js:760 refresh() теряет прокрутку; holdOnLeave в main.js — второе окно ухода при смене адреса из консоли; task.js и openFile без DOM-тестов.
Task 10: complete (commits 6c3fd32..fcb6a58, review clean)
- 23.11.2026 Блок 1 экранов (задачи 9, 10) собран, 883 теста. Стоп: приёмка владельцем на стенде. На стенде в «Эссе» нет ждущих работ — ждущие в «Презентации».
- 23.11.2026 Блок 1 принят владельцем («Принимаю блок 1»), без замечаний.
- Task 11: base (после docs-коммита)
- Task 11: base 459bde4; implementer agent ae23a2691e5b80970 (journal-screens, sonnet); после — строгая проверка (данные студента, загрузка)
- Task 11: implementer DONE_WITH_CONCERNS 9c9d5c7 (892 tests, RED записан). Возвращённое «Эссе» у S1004 (у S1001 проверено 8 из 10); «Сдать» неактивна, пока в списке файл с ошибкой; текст при «Сдать заново» пустой; новый ключ work.mine.retry; срок сданной работы — датой (dueOfWork, dueDateText); набранный текст теряется при уходе.
- Task 11: review (sonnet, strict) agent a3b305812cc7f0aa3
- Task 11: review (sonnet, strict) Needs fixes: Important 1 — очередь загрузки (task.js:1004, sendItem, retryItem) не привязана к сессии/экрану: после выхода файлы A уходят под токеном B; после unauthorized шлёт с token null. Проба: scratchpad\task11-probes\token-swap.mjs.
- Task 11: minor (deferred): task.js:1011-1017 возврат на задание до конца загрузки — файл виден только после перезагрузки; task.js:358 maxlength в UTF-16, сервер в знаках; дубль ожидающего файла при повторе после обрыва (server_down).
- Task 11: Ruling: Minor 2 (removeItem не блокируется при owner.busy) — в тот же круг, одна строка в том же месте (практика проекта: мелочь тому же агенту).
- Task 11: fix round 1 → implementer ae23a2691e5b80970, задание task-11-fix-1.md (FIX_BASE 9c9d5c7)
- Task 11: fix round 1/5 (2 addressed, 0 open — очередь загрузки и сессия, «Убрать» при busy; commits 9c9d5c7..a49abbd). Повторная проверка: ADDRESSED, новых поломок нет. Проба scratchpad\task11-probes\token-swap2.mjs.
Task 11: complete (commits 459bde4..a49abbd, review clean)
- 23.11.2026 Блок 2 (задача 11) собран, 893 теста. Стоп: приёмка владельцем. На стенде возвращённое «Эссе» — у S1004 (у S1001 оно проверено 8 из 10).
- 23.11.2026 Блок 2 принят владельцем («Принимаю блок 2»), без замечаний.
- Task 12: base 9e445ed; implementer agent afcc73259d6e06548 (journal-screens, sonnet); после — строгая проверка (права чтения, «Оценки»)
- Task 12: implementer DONE_WITH_CONCERNS c626c9a (898 tests, RED записан). dean,teacher «сам оценивает свой» на стенде не проверить (у dean нет предметов) — покрыто тестом staffMay; фильтр группы по названию (в work.overview нет groupId); новые overviewRows/overviewGroups/staffMay в work.js; journalLog.js не менялся.
- Task 12: review (sonnet, strict) agent af9100b992170ba7a
- Task 12: review (sonnet, strict) Approved, 0 Important. Проба scratchpad\task12-probes\p1.mjs.
- Task 12: minor (deferred, к общей проверке): journal.js:397 keyed + journalLog.js:190 — название задания вида 'journal.col.self' / 'work.xxx' переводится как ключ словаря (в журнале изменений «СРС» вместо названия); в ветке work брать из keyed только before/after у status; нет теста на такое название.
Task 12: complete (commits 9e445ed..c626c9a, review clean)
- 24.11.2026 Блок 3 (задача 12) собран, 898 тестов. Стоп: приёмка владельцем. dean,teacher «сам оценивает свой» на стенде не показать — у dean нет предметов.
- 24.11.2026 Блок 3 принят владельцем («Принимаю блок 3»). Все задачи 1–12 приняты, 898 тестов. Дальше — общая проверка (задача 13, opus), диапазон 7c45d12..HEAD, все minor (deferred) выше — на разбор. Новый чат координатора.
- 24.11.2026 New coordinator chat. Stand 5273 free. Task 13 step 1: final review (journal-reviewer, opus) over 7c45d12..HEAD (d0ac2ae) with deferred list final-review-deferred.md.
- Task 13 step 1: final review agent a275be883be9650af (journal-reviewer, opus), probes scratchpad\final-u5\.
- Task 13 step 1: final review (opus) — RETURN: 0 critical, 1 important (I1 upload timeout 180 s < server 300 s, shown as server_down), 4 minor (M2 macro markers case, M3 log title as key, M4 new Date in spaceAlarm, M5 dropFile files_unavailable), 2 known limits (mirror keeps dropped uploads; orphans after restore). 898 tests, build:gas ok. Probes scratchpad\final-u5\. Saved by coordinator: final-fix-brief.md (+ copy aidlc-docs/construction/unit-5-dz/sdd/final-review-findings.md).
- Ruling: one fix wave to ONE agent journal-server (sonnet): I1 + M2–M5 (site edits small: api.js timeout 300 s + new code upload_slow with ru/ky/en text, journal.js log title) — cost if wrong: the new error text needs an owner look; ky text to proofreading list. Remaining deferred minors → known limits (step 7).
- Final fix wave: BASE d0ac2ae; dispatched journal-server (sonnet).
- Final fix wave: DONE 247f31e (901 tests, build:gas ok). I1 timeout 300 s + upload_slow (work.js UPLOAD_ERRORS, task.js failItem retry), M2 hasBytesNoCase, M3 logLine work branch, M4 spaceAlarm now, M5 files_unavailable. No separate RED run. Re-review: same reviewer (opus).
- Final fix wave re-review (opus): I1, M2–M5 ADDRESSED, RED confirmed on d0ac2ae (5 new tests fail there), 901 tests, build:gas ok, no new breakage. Outside: OLE marker _VBA_PROJECT still case-sensitive (Office writes upper) → known limit; site 300 s = server 300 s, server may cut first → server_down (harmless). Probe p10-rereview.mjs. Final fix wave closed.
- 24.11.2026 OWNER «Выкладывай»: deployed server 72fb36b (prev 47a5089), tables assignments/submissions/files created, health 200 local+funnel, OPTIONS 204/403; git push e2cf9ee..72fb36b, Pages serves upload_slow. Left: step 6 phone check by the owner.
- 24.11.2026 OWNER phone check on the live site: «Фото загрузилось, всё работает». Unit 5 accepted and deployed. Next: attached syllabus file (rule 4), then unit 6 plan.

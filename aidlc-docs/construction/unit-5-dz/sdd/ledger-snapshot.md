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

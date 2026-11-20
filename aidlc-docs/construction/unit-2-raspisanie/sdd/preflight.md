# Preflight: план юнита 2 «Расписание и темы»

Проверено: `aidlc-docs/construction/unit-2-raspisanie/plan.md` целиком (строки 1–1156), `design-v1.md` §6 и §8, текущий код: `core/schema.js`, `core/permissions.js`, `core/validate.js`, `core/import.js`, `backend/api.js`, `backend/handlers/dir.js`, `backend/handlers/import.js`, `backend/store/*.js`, `backend/gas/main.js`, `site/js/router.js`, `site/js/shell.js` (navFor), `site/js/views/home.js`, `site/js/views/directoryConfig.js`, `site/js/icons.js`, `dev/seed.js`, тесты `api`, `import`, `i18n`, `permissions`, `schema`, `sheetsStore`, `store`, `router`, `ui`, `devServer`, `gasBundle`.
`npm test` сейчас: 127 тестов, все зелёные (совпадает с планом, строка 198).
Ожидания тестов Task 4 (`planGeneration`, строки 533–581) прогнаны на эталонной реализации, написанной строго по правилам 1–7 (строки 507–517): все сходятся. Календарные факты (дни недели, `2026-10-19 + 123 = 2027-02-19`, `+37 = 2026-11-25`, 159 пар стенда, 44 дня в диапазоне 09-01..10-15) проверены скриптом.

## Таблица 1. Пары задач с общим файлом или интерфейсом

| Задачи | Производит → потребляет | Итог |
| --- | --- | --- |
| T1 → T2 | `core/dates.js`: `TZ_OFFSET_MS`, `localDate(ms)` (стр. 118–119) → T2 дополняет файл (стр. 207, 212–220) | OK |
| T1 → T2 | `tests/dates.test.js` создаётся в T1 Step 1 (стр. 191–193), T2 его правит (стр. 205) | Несоответствие: файла нет в списке Files T1 (стр. 112) → F6 |
| T1 → T2 | `tests/sheetsStore.test.js`, `tests/gasBundle.test.js` правятся обеими по очереди | OK; в gasBundle нет проверки числа листов, править нечего; число листов считает только `tests/sheetsStore.test.js:88` (`created.length, 6` → станет 9) → F20 |
| T1 → T5 | `updateMany(table, [{id, patch}]) -> object[]`, `removeMany(table, ids) -> void`, `not_found` без записи (стр. 129–131) → T5 (стр. 628) | OK |
| T1 → T6 | `updateMany`/`removeMany`/`insertMany`, `localDate` → `todayOf` (стр. 731, 737); шпион считает именно эти методы (стр. 786–787) | OK |
| T1 → T4/T5/T7 | `shapeRow`: недостающий bool → `false`, строка → `''` (стр. 123–126, 152–153) → `planGeneration` проверяет `changed === false` (стр. 509), T5 вставляет пару без `changed`/`note` (стр. 712) | OK: форма строки делает сравнение надёжным |
| T2 → T3 | `SCHEMA.weekTemplate/topics` (стр. 244–245), `FIXED_STATUSES`, `LESSON_TYPES`, `WEEKDAYS`, `MAX_SLOTS` → `validateRow` (стр. 342); порядок ошибок = порядок колонок схемы (`core/validate.js`, `validateRow`) совпадает с тестами стр. 412–424 | OK |
| T2 → T4 | форма `readSettings` `{semesterStart, semesterEnd, holidays[], bells[]}`, `DEFAULT_BELLS`, даты → `workingDays`, `planGeneration`, `checkPairChange` (стр. 490) | OK |
| T2 → T5 | `readSettings`, `validateSettings -> {value, errors:[{field, code}]}`, `settingsToRows`, `DEFAULT_BELLS`, `PAIR_MINUTES` → `settings.get/save` (стр. 632–633); `AppError('invalid', {fields})` → `{code:'invalid', fields}` (`backend/api.js:82–84`) совпадает с тестом стр. 676–677 | OK |
| T2 → T5–T7 | матрица прав (стр. 260–268) → тесты 678–680, 692–694, 790–791, 811–814, 873–876 | OK, все ожидания совпадают с матрицей |
| T2 → T8–T12 | строки прав в формате `listPermissions` (`action:table` или голое имя): `settings.get`, `dir.list:weekTemplate`, `dir.list:topics`, `dir.save:weekTemplate`, `dir.save:topics`, `schedule.list`, `schedule.mine`, `schedule.changePair`, `topics.plan` → `resolveRoute`, `navFor` (стр. 953, 1002, 1030, 1077, 1116–1117) | OK |
| T2 → существующие тесты | `listPermissions(['teacher'])` получает `schedule.mine`, `topics.plan` | Несоответствие: `tests/api.test.js:189–192` ждёт `permissions: ['teacher.mySubjects']` и упадёт; файла нет в Files T2 (стр. 205) → F2 |
| T3 → T5 | `validateRow('weekTemplate', row, {weekTemplate, subjects, rooms, slotCount})` (стр. 348) ↔ `loadDb` для `weekTemplate` (стр. 644); `validateRow('topics', row, {topics, subjects})` (стр. 349) ↔ стр. 645 | OK, имя `slotCount` одинаковое |
| T3 → T6 | `layoutTopics(topics, pairs) -> {assign, unplaced, withoutTopic}` (стр. 352–356) → `relayout` (стр. 744), `topics.plan.withoutTopic` (стр. 757); `IMPORT_SPECS.topics.check` читает `db.pairs` (стр. 394) ↔ `loadDb(store, 'topics', ['groups', 'pairs'])` (стр. 761); тест T6 стр. 806 (`held`, `skipped: 1`) совпадает с `apply` в `backend/handlers/import.js` | OK |
| T3 → T10 | `IMPORT_COLUMNS.topics` и `import.col.topics.*` (T3, стр. 340) ↔ `IMPORT_TABLES` += `topics`, `FIELDS.subjectId/lessonType/unit/order` (T10, стр. 1033); тест стр. 1046–1047 | OK; `tests/i18n.test.js:16–19` сравнивает только `{key, required}`, поле `virtual` ему не мешает |
| T3 → существующие тесты | в `IMPORT_SPECS` появляется `topics` | Несоответствие: `tests/import.test.js:131` ждёт ровно пять таблиц, а стр. 481 запрещает править прежние тесты импорта → F1 |
| T4 → T6 | `planGeneration(...) -> {toInsert, toUpdate, toRemove, kept, conflicts}` (стр. 497–498) → `generateSchedule -> {from, to, inserted, updated, removed, kept, conflicts}` (стр. 740–741); тест T6 стр. 767, 778, 783 пересчитан вручную | OK |
| T4 → T7 | `pairLock(pair, today) -> null / 'pair_locked' / 'in_past'`, `checkPairChange(pair, patch, {pairs, staff, rooms, settings, today}) -> {next, errors}` (стр. 499–502) → `changePair/cancelPair/restorePair` (стр. 845–847); тесты 902–911 | OK |
| T4 → T7 | правило занятости при создании пар (стр. 515) против Review Focus 5 (стр. 44) | Пробел: создание пар проверяет только группу, а занятость преподавателя и аудитории после ручного переноса или замены не проверяет → F3 |
| T4 → T11 | `canEditPair` (стр. 1070) повторяет `pairLock === null` | OK как копия (сайт не грузит `core/`), но отменённая пара → F12 |
| T5 → T6 | `loadDb(store, table, extra = [])` (стр. 635) → `loadDb(store, 'topics', ['groups', 'pairs'])` (стр. 761); `dir.js`, `import.js`, `api.js` правятся по очереди | OK по интерфейсу; промежуточное состояние → F16 |
| T5 → T8 | `settings.get -> {settings, defaultBells, pairMinutes}`, `settings.save {settings} -> {settings}`, поля ошибок `semesterStart/semesterEnd/holidays/bells` (стр. 632–633) → экран (стр. 956) | OK |
| T5 → T9 | ошибки шаблона: `group_busy` на поле `slot`, `teacher_busy` на `subjectId`, `room_busy` на `roomId` (стр. 366–368) → окно клетки «предмет, аудитория» (стр. 1003) | Замечание: у поля `slot` в окне нет поля ввода; `group_busy` придётся показывать общим сообщением → F19 |
| T5 → T10 | `dir.remove topics` → `in_use` (стр. 661) → текст «Пара с этой темой уже проведена» (стр. 1031) | OK |
| T6 → T7 | `relayout(store, subjectIds)`, `todayOf`, `loadSettings`, `generateSchedule(store, platform, opts)` (стр. 737–741) → T7 (стр. 826, 855); `schedule.js` регистрируется в `api.js` в T6, T7 добавляет действия в ту же карту | OK |
| T6/T7 ↔ Global Constraints | повторное чтение «Пар» и «Тем» в одном запросе (стр. 744, 751, 761, 832, 845–847) против стр. 24 | Противоречие → F4 |
| T6 → T9 | `schedule.generate {dryRun?, restart?}` → сводка «Добавится / Изменится / Удалится / Без изменений / Не поместилось» = `inserted/updated/removed/kept/conflicts`; ошибки `invalid (semesterStart required)`, `empty_template`, `in_use` (стр. 746–748 ↔ 1004) | OK |
| T6 → T10/T12 | `topics.plan -> {subject:{id, name, groupId, groupName, teacherId, teacherName}, topics:[{..., pair|null}], withoutTopic}` (стр. 755–757) → экраны «Темы» и «План тем» | OK; слабая проверка в тесте → F11 |
| T7 → T11/T12 | `PairView` (стр. 834–837) → карточка (стр. 1078), метки (`pairFlags`), «Перенос с 8 сентября, 1 пара» (`planDate/planSlot`) | OK |
| T7 → T11 | `schedule.list {from, ...}`: `from` обязателен (стр. 843) → экран деканата должен открыться на «этой неделе», кнопка «Эта неделя» (стр. 1072), «Сегодня из ответа сервера» (стр. 1079), часам устройства верить нельзя (стр. 20) | Пробел интерфейса → F5 |
| T7 → T12 | `schedule.mine {from?}` → неделя по умолчанию и `today` (стр. 844) → «Моё расписание», главная студента | OK |
| T7 → T9–T12 (стенд) | сид (стр. 851–855) → проверки в браузере (стр. 1018, 1052, 1104, 1140) | OK: у каждой группы 3 строки шаблона; у «Информатики 02-1» 18 тем на 17 пар → «Не поместилось тем: 1»; S1001 в 01-1, S2001 в 02-1; замена у teacher3 26.11 (четверг); 159 пар |
| T7 ↔ T12 | `cancelPair` (стр. 846) не говорит, что примечание сохраняется; T12 показывает примечание отменённой пары (стр. 1118) | Несоответствие → F8 |
| T8 → T9–T12 | порядок группы `nav.schedule`: `schedule, weekTemplate, topics, settings` (стр. 954) ↔ тесты 979, 1014, 1042, 1099–1100 | OK |
| T8 → T11/T12 | `site/js/dates.js` (`isDate, addDays, weekday, mondayOf, addMinutes, dayParts`) → `weekNav`, подписи дней | OK; частичная сверка с core → F15 |
| T8 → T12 | `site/js/views/home.js`: плитки берут `hintKey` (T8) ↔ блок «Сегодня» у студента и ссылка «Темы» у преподавателя (T12) | OK, правки идут по очереди |
| T8/T9 → T10–T12 | `icons.js`: `settings` (T8) и `grid` (T9) новые; `clipboard`, `calendar` уже есть | OK |
| T11 → T12 | `weekNav`, `pairCard`, `dayList`, `groupByDay` (стр. 1068–1074) → T12 (стр. 1114) | OK |
| T3, T8–T12 | `site/js/i18n/*.js`, `site/js/router.js`, `site/js/shell.js`, `site/js/main.js`, `site/css/screens.css` правят несколько задач | OK: задачи идут строго по одной, конфликтов порядка нет |
| T12 | `tests/i18n.test.js` правится в Step 1 (стр. 1135–1136) | Несоответствие: файла нет в Files T12 (стр. 1112) → F7 |

## Таблица 2. Каждая задача сама с собой

| Задача | Итог |
| --- | --- |
| T1 | Правила (стр. 137–145) и тесты (стр. 149–193) согласованы: дамп `[[3,'не трогать',...],['','','',''],[4,'и эту','g_2','02-1']]` и счётчики `[1, 2]` получаются из `groupsSheet()` (`tests/sheetsStore.test.js:10–17`) при одном `getValues` в `load()`. Не хватает: `tests/dates.test.js` в Files (F6); у `removeMany` не сказано про `withLock` и повторы id (F13). |
| T2 | Тесты совпадают с правилами (стр. 250–256): `readSettings` сортирует нерабочие дни (стр. 299) — это следует из «проходит проверку» по `validateSettings`, лучше сказать прямо. Files не содержит `tests/api.test.js` (F2). Конец пары ровно в 24:00 (F14). |
| T3 | Тесты валидации, раскладки и импорта пересчитаны вручную: ожидания сходятся с правилами. Противоречие со стр. 481 (F1). Ловушки реализации (F18): `parseSheet` разбирает ячейки в порядке колонок (`subjectId` раньше `groupId`) и добавляет ошибки `validateRow` по всем колонкам спецификации, поэтому для строки 6 (стр. 464) нужно подавить `subjectId: bad_ref`. |
| T4 | Все ожидания (стр. 538–616) воспроизведены эталонной реализацией. Пробел по Review Focus 5 (F3). |
| T5 | Тесты согласованы с правилами (стр. 686–716 пересчитаны). Для `subjects` таблица `loadDb` (стр. 642) не включает `weekTemplate` и `pairs`, а особые правила (стр. 649–650) и запрет удаления их требуют; формулировка теста скорости (стр. 718–719) двусмысленна про `staff` (F10). Правило `teacher_busy` для предмета написано в обработчике, а не в `core/` (F19). |
| T6 | Ожидания (стр. 766–814) пересчитаны и сходятся. Двойное чтение «Пар» (F4). Проверка `'passwordHash' in plan.subject` почти ничего не проверяет (F11). Импорт тем по-прежнему пишет `store.update` в цикле (F17). |
| T7 | Ожидания `pairsApi` (стр. 861–911) и сида (стр. 918–924) пересчитаны и сходятся. Ответ `{ pair }` по тестам — это `PairView` (стр. 892, 897), но в тексте не сказано (F9); `cancelPair` и примечание (F8); граница «длиннее 31 дня» (стр. 843) не уточнена (F14). Проверка формата «дата» `@` (стр. 929) пройдёт сразу после T2 (`markTextColumns`), то есть не падает в Step 2 (F20). |
| T8 | Тесты согласованы с текстом. Сверка `site/js/dates.js` с core неполная; `error.bad_request` (стр. 955) не проверяется тестом (стр. 983) (F15). |
| T9 | Тесты согласованы (стр. 1011–1014). `group_busy` без поля ввода (F19). |
| T10 | Тесты согласованы (стр. 1040–1048). Карта файлов (стр. 96–97) не упоминает `site/js/views/directory.js`, а T10 его правит (стр. 1026) — мелочь. |
| T11 | Тесты `pairs.test.js` согласованы с сигнатурами. `schedule.list` без `today` (F5); `canEditPair` и «Вернуть пару» (F12). |
| T12 | Тесты согласованы. `tests/i18n.test.js` не в Files (F7). |
| T13 | Согласовано с Global Constraints (push и выкладка только по просьбе, `deploy -i` по существующему ID). |

## Находки

Важность: высокая — задача не сможет стать зелёной без нарушения своего текста; средняя — поведение расходится с Review Focus или Global Constraints; низкая — уточнение текста или слабый тест; инфо — к сведению исполнителя.

**F1 (высокая), Task 3, стр. 481.** «Прежние тесты импорта пяти справочников остаются зелёными без правок», но `tests/import.test.js:131` — `assert.deepEqual(Object.keys(IMPORT_SPECS).sort(), ['groups', 'rooms', 'staff', 'students', 'subjects'])` — упадёт, как только появится `IMPORT_SPECS.topics`. Решение: в Step 3 разрешить одну правку — добавить `'topics'` в ожидание `tests/import.test.js:131`.

**F2 (высокая), Task 2, стр. 205 (Files) и 260–268.** У учителя появляются права `schedule.mine` и `topics.plan`, а `tests/api.test.js:189–192` (`publicUser`) ждёт `permissions: ['teacher.mySubjects']`. Решение: добавить `tests/api.test.js` в Files T2, ожидание — `['schedule.mine', 'teacher.mySubjects', 'topics.plan']`.

**F3 (средняя), Task 4, стр. 511 и 515, против Review Focus 5 (стр. 44).** При создании пар занятость против незаменяемых пар проверяется только по группе. После ручного переноса или замены «Создать расписание» может поставить преподавателя или аудиторию на две пары сразу. Шаблон (T3) сверяется только с шаблоном, ручные изменения он не видит. Воспроизведение на данных T4: пару p3 вручную перенесли на `2026-09-10`, пара 3, аудитория `r_1`; в шаблон добавили четверг, пара 3, `sb_2` (группа g_2), аудитория `r_1` → `toInsert` содержит g_2 `2026-09-10` пара 3 `r_1`, `conflicts: 0`, и в `r_1` две пары. То же с преподавателем: замена на sf_2, затем строка шаблона предмета sf_2 в это же время. Решение: в правиле 5 (и для `toUpdate`, где меняется `teacherId` или `roomId`) считать конфликтом незаменяемую пару не `cancelled`/`missed` на те же (`date`, `slot`) с тем же `teacherId` или тем же непустым `roomId`; добавить в T4 по одному тесту на преподавателя и на аудиторию.

**F4 (средняя), Tasks 6–7, стр. 744, 751, 761, 832, 845–847, против Global Constraints, стр. 24.** «Обработчик читает каждый лист не больше одного раза за запрос», но `schedule.generate` читает «Пары» для `planGeneration`, а затем `relayout(store)` читает «Пары» и «Темы» ещё раз. `dir.save`/`dir.remove`/`import.apply` для тем читают «Темы» в `loadDb` и снова в `relayout`. `changePair`/`cancelPair`/`restorePair` читают «Пары» для проверки, потом в `relayout`, потом в `pairViews` — вместе со всеми справочниками — для ответа. Решение: дать `relayout(store, subjectIds, rows?)` и `pairViews(store, keep, rows?)` необязательный параметр с уже прочитанными строками (и пересчитывать после записи в памяти) или переписать ограничение: «не в цикле; повторное чтение после пакетной записи допустимо». Второй путь проще, первый быстрее на Google.

**F5 (средняя), Task 7, стр. 843 ↔ Task 11, стр. 1072, 1079; Global, стр. 20.** У `schedule.list` поле `from` обязательно, а экран деканата открывается на текущей неделе и в режиме «День» на сегодня. Часам устройства верить нельзя, а `site/js/dates.js` (T8) не умеет переводить `serverTime` в дату. Первый запрос сделать нечем. Решение (лучше): в T7 сделать `from` у `schedule.list` необязательным — по умолчанию `mondayOf(today)`, как у `schedule.mine`, — и добавить тест. Или в T8 добавить в `site/js/dates.js` `localDate(ms)` и брать `serverTime` из любого ответа.

**F6 (низкая), Task 1, стр. 112.** Step 1 создаёт `tests/dates.test.js` (стр. 191), а в списке Create его нет. Решение: дописать в Files.

**F7 (низкая), Task 12, стр. 1112.** Step 1 правит `tests/i18n.test.js` (стр. 1135–1136), а в списке Files его нет. Решение: дописать.

**F8 (низкая), Task 7, стр. 846.** Не сказано, что `cancelPair` сохраняет примечание, хотя T12 показывает примечание отменённой пары (стр. 1118), а тест стр. 886 передаёт `note`, но его не проверяет. Решение: «записывает `note` (обрезанное по краям), если оно передано», и проверить `.data.pair.note` в тесте.

**F9 (низкая), Task 7, стр. 845–847.** Ответ `{ pair }` по тестам — это `PairView` (`moved`, `planDate`, `teacherName`, `substitution` в стр. 892, 897), но в тексте это не сказано. Решение: написать `{ pair: PairView }`.

**F10 (низкая), Task 5, стр. 642, 649–650, 718–719.** Для `subjects` в `loadDb` нет `weekTemplate` и `pairs`, а особым правилам `dir.save` они нужны. Тест скорости говорит «читает только 'groups' (и 'staff' — проверка ключа входа)», но вход проверяется через `store.get` (`backend/api.js:52`), а шпион считает `list`. Решение: прямо написать `dir.save subjects → loadDb(store, 'subjects', ['weekTemplate', 'pairs'])` и точное ожидание теста: «вызовы `list`: только `groups`».

**F11 (низкая), Task 6, стр. 775.** `'passwordHash' in plan.subject` ничего не проверяет: в строке предмета хэша не бывает, а вложенный объект проверка не увидит. Решение: `assert.equal(JSON.stringify(plan).includes('passwordHash'), false)`, как в T7, стр. 866.

**F12 (низкая), Task 11, стр. 1070 и 1080.** `canEditPair` для отменённой пары даёт `false`, но такая пара должна открывать «Вернуть пару». Правило открытия не задано. Решение: добавить `canRestorePair(pair, today)` (`status === 'cancelled' && date >= today`) с тестом или описать условие словами.

**F13 (низкая), Task 1, стр. 143.** Для `removeMany` не сказано, что он идёт под `withLock`, и не сказано, что делать с повторами id. В `sheetsStore` вызов `removeMany(t, [a, a])` без убирания повторов удалит строку `a` и следующую за ней. Решение: «под `withLock`; повторы id убираются» и одна проверка в `storeContract`.

**F14 (низкая), Task 2, стр. 256 ↔ Task 7, стр. 837 и 843.** Звонок `22:30` проходит проверку (пара кончается ровно в 24:00), а результат `addMinutes('22:30', 90)` не задан: `'24:00'` не проходит `isTime`, а `'00:00'` — это перенос через полночь. Граница «длиннее 31 дня» тоже не уточнена (`daysBetween > 30` или `> 31`?). Решение: «последняя пара кончается не позже 23:59» и «`daysBetween(from, to) > 30` → `bad_request`», по тесту на каждую границу.

**F15 (низкая), Task 8, стр. 963–967 и 983.** Сверка копии с core покрывает только `weekday`, `mondayOf`, `addDays`; `isDate` и `addMinutes` копии с core не сравниваются. В тест текстов ошибок не входит `bad_request`, хотя стр. 955 его требует. Решение: дописать в цикл сверку `isDate` (включая плохие значения из стр. 275) и `addMinutes`, а в список кодов — `'bad_request'`.

**F16 (низкая), Task 5, стр. 626 ↔ Task 6, стр. 761.** После T5 импорт тем вызывает `loadDb(store, 'topics')` без `groups` и `pairs`: до T6 каждая строка получит `groupId: bad_ref`, а проверка `held` не сработает. Тестами это не ловится, T6 чинит. Решение: в T5 сразу вызывать для тем `loadDb(store, 'topics', ['groups', 'pairs'])` или оставить как есть, сознательно.

**F17 (низкая), Task 6, стр. 761.** `import.apply` для тем пишет `store.update` в цикле (`backend/handlers/import.js`, цикл по `plan.toUpdate`). На Google каждый `update` заново читает лист (`backend/store/sheetsStore.js`, `update` → `load`), поэтому повторный импорт со сдвинутой нумерацией (Review Focus 3) на 50 тем — это 50 чтений и записей. Решение: в T6 перевести `apply` на один `updateMany`.

**F18 (инфо), Task 3, стр. 391–392 и 464.** Это не противоречие, но ловушка для исполнителя: `parseSheet` разбирает ячейки по порядку колонок (`subjectId` раньше `groupId`) и добавляет ошибки `validateRow` по каждой колонке спецификации (`core/import.js`, цикл по `validateRow`). Нужно сначала найти группу и подавить `subjectId: bad_ref`, если группы нет (ожидание строки 6). Решение: одной фразой в задании T3.

**F19 (инфо), Tasks 5, 9, 11: повторы логики, которые требует план.** (а) `site/js/dates.js` копирует `core/dates.js` (стр. 947) — оправдано, сверка неполная (F15). (б) `canEditPair` копирует `pairLock` — оправдано. (в) Проверка занятости реализуется трижды: шаблон в `core/validate.js`, пары в `core/schedule.js` и смена преподавателя предмета (`teacher_busy`, стр. 650) в обработчике `backend/handlers/dir.js` — последнее идёт мимо «правила — в `core/`» (стр. 7). Решение для (в): проверять смену преподавателя через `validateRow('weekTemplate', ...)` по строкам шаблона этого предмета с новым преподавателем или вынести общую функцию в `core/`. (г) `group_busy` у шаблона висит на поле `slot`, которого в окне клетки нет (стр. 1003): показывать его общим сообщением окна.

**F20 (инфо), Tasks 2 и 7, стр. 205, 333, 929.** В `tests/gasBundle.test.js` нет проверки числа листов, править там в T2 нечего; число листов считает только `tests/sheetsStore.test.js:88`. Проверка формата `@` у колонки «дата» (T7) пройдёт сразу после T2, так что в Step 2 T7 она не упадёт: это защита от регрессии, а не красный тест. Ещё по порядку задач: после T2 у деканата есть `dir.list:topics` и `dir.list:weekTemplate`, а `site/js/router.js:8` до T8 откроет по набранному вручную адресу `#/dir/topics` экран справочника без настроек. В меню этого пункта нет; закрывается в T8.
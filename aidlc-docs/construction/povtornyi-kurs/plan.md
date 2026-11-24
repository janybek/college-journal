# Доработка «Повторный курс»: план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** деканат записывает студента, не сдавшего предмет, на **повторный курс** (весь предмет или только экзамен) по приказу; преподаватель повтора ставит работы одной цифрой и экзамен и закрывает повтор; студент видит свой повтор и новый итог из 100 с пометкой «повторный курс»; повтор не зависит от переключения семестра и не меняет готовые ведомости.

**Architecture:** «карточка повтора» — строка новой таблицы «Повторный курс» (студент + предмет + семестр по плану) со **снимком прежнего результата** в своих колонках; попытки экзамена повтора — вторая новая таблица. Прежние таблицы не получают ни строк, ни колонок, кроме строк «Журнала изменений» с новым значением `entity: 'repeat'`. Итог повтора считает прежняя формула `subjectResult` (`core/exam.js`): у повтора «весь предмет» вместо баллов за семестр идут работы повтора, у «только экзамен» — прежний семестр из снимка. Снимок собирает сервер в момент записи: для текущего полугодия — те же числа, что показывает ведомость (`ledgerView`), для прошлого — свой расчёт по строкам с тем же «семестром по плану» (пары находятся по теме → силлабус). Права опираются на поле «преподаватель повтора» карточки, а не на нынешний предмет. Печать — прежний приём `printSheet` (`site/js/print.js`).

**Tech Stack:** как в юните 6 — Node 24, ES-модули, `node --test`, встроенный `node:sqlite`, esbuild только для запасной сборки Apps Script, сайт без сборки. Новых зависимостей нет.

**Spec:** `aidlc-docs/construction/povtornyi-kurs/design.md` (решения владельца 1–6 и решения координатора 1–13 обязательны). Общие правила — `CLAUDE.md`; форма и приёмы — `aidlc-docs/construction/unit-6-vedomosti/plan.md`.

**Исходное состояние:** `HEAD 5f09f5d`, 1173 теста (запись `aidlc-state.md` от 25.11.2026). Тестовый сервер — на `b829763` (код `192bcbe`), сайт тестового — `55e4bc3`. Боевой не трогаем.

**Порядок.** Сначала сверка плана (opus) с готовым кодом и «ручная» проба отката (раздел «Откат») — находки правит отдельный агент в этом файле. Затем задачи 1 → 13 строго по одной; после каждой `npm test` зелёное и `npm run build:gas` собирается. Задачи 1–8 (правила, сервер, стенд, проба отката) идут без остановок. Экраны — **два блока с остановкой после каждого**: блок 1 — задачи 9–11 (сотрудники, печать), блок 2 — задача 12 (студент). После блока 2 — одна строгая общая проверка (opus), одна волна исправлений, выкладка на тестовый только по просьбе владельца (задача 13).

**Список задач (13).**

| № | Кто | Задача | Проверка |
| --- | --- | --- | --- |
| 1 | Л | Правила повтора: запись, итог, допуск, закрытие, снимок текстом | строгая (баллы) |
| 2 | Л | Две таблицы, константы, права, помощники тестов | облегчённая |
| 3 | С | Снимок прежнего результата: текущее и прошлое полугодие | строгая (баллы) |
| 4 | С | Карточка: кандидаты, запись, список, чтение, правка, отмена | строгая (права) |
| 5 | С | Работы, экзамен повтора, закрытие, открытие заново | строгая (права, баллы) |
| 6 | С | Где виден повтор: студент, ведомость, «Журнал изменений», запрет удаления | строгая (данные студентов) |
| 7 | С | Стенд с вымышленными повторниками, пробные данные, сборка Apps Script | облегчённая |
| 8 | П | Проба отката на настоящей прежней версии `b829763` | отчёт проверяющего |
| 9 | Э | «Повторный курс» деканата: список, «Записать на повтор», правка, отмена — блок 1 | ИИ: да (данные студентов) |
| 10 | Э | Карточка повтора у преподавателя: работы, экзамен, закрытие; «Мои повторники» — блок 1 | ИИ: да (права, баллы) |
| 11 | Э | «Лист повторного курса» A4, пометка в ведомости, строки «Журнала изменений» — блок 1 | владелец принимает блоком |
| 12 | Э | Студент: карточка на главной, «Повторный курс» в «Оценках» — блок 2 | ИИ: да (данные студента) |
| 13 | — | Общая проверка (opus), одна волна исправлений, выкладка на тестовый по просьбе | — |

## Global Constraints

Действуют все Global Constraints плана юнита 6 (раздел «Действующие правила юнитов 2–5» и правила юнита 6) — памятки копируются из `.superpowers/sdd/plan-unit-6-vedomosti/` в `.superpowers/sdd/plan-povtornyi-kurs/` с этим разделом. Самое важное из них:

- `core/` и `backend/` без зависимостей из npm; обработчики синхронные; `handleRequest` не бросает; ошибки — `AppError(code, { fields })`.
- Время — только `platform.now()`; «сегодня» — `localDate(platform.now())`; даты — строки `'YYYY-MM-DD'`, дата со временем — `'YYYY-MM-DD HH:MM:SS'`.
- Каждая таблица читается не больше одного раза за запрос (`store.list`), запись пачкой; `store.get / update / remove` в цикле запрещены.
- Что попадает в сборку Apps Script, не содержит `node:`, `require(`, `Buffer`, слова `process` (`tests/gasBundle.test.js`).
- Любая фраза — через три словаря с одинаковыми ключами; данные на страницу — только текстом (`textContent`, помощники `site/js/ui.js`); цвета hex или rgb; две темы; печать чёрным по белому; студенческие экраны — 360 px, текст от 16 px, кнопки от 44 px.
- Настоящих людей нет нигде: ни в тестах, ни в отчётах, ни на скриншотах. Стенд — только порт 5273; рабочий сервер, его папки и `dev/data/real.json` агенты не трогают.
- Стенд и браузер агентов: свой `npm run dev:reset`, headless Chrome с временным профилем и `--disable-sync --disable-extensions`; процессы останавливаются только по своему PID.
- Коммиты на английском, только свои файлы по имени, `git status` чистый; `git push` и выкладка — только по прямой просьбе владельца.
- Права проверяются попыткой обойти защиту; отказ — и ничего не записано (снимок таблиц до и после). Данные студентов — поиском по всему JSON ответа. «Журнал изменений» пишется в том же запросе. Всё или ничего.

Новые правила доработки:

- **Готовое не меняется.** Ни один запрос `repeat.*` не пишет в «Закрытые юниты», «Экзамены предметов», «Попытки экзамена», «Итоги юнитов», «Посещаемость», «Заявки». Тесты задач 4 и 5 сравнивают снимок этих таблиц до и после.
- **Таблицы «Повторный курс» и «Попытки экзамена повтора» пишут только** `backend/repeatData.js`, `backend/repeatScores.js` и `dev/seed.js` через их функции. `dir.*` и импорт их не знают.
- **Числа положения 2.9 в коде не пишутся.** Максимум работ — `split.semester`, максимум экзамена — `split.exam`, порог допуска — `split.admission`, пороги слова — `scheme`. На сайте своих формул нет: он показывает числа ответа.
- **Снимок не пересчитывается.** Колонки `prev*` пишутся один раз при записи на повтор и больше не меняются ни одним запросом.
- **Права — по карточке.** «Преподаватель повтора» — это `teacherId` карточки. Нынешний преподаватель предмета, если он не преподаватель повтора, карточку не читает и не пишет.
- **Студент получает только свои карточки**: в ответах нет id карточек и попыток, состава комиссии, чужих ФИО и баллов.
- **Прежние ответы:** новый ключ добавляется только когда он есть (`...(repeat ? { repeat } : {})`), чтобы прежние `deepEqual` остались верными.
- **Проверка задач и модели** — колонка «Проверка» в списке задач; «Логика», «Сервер», «Экраны», проверяющий — sonnet; сверка плана и общая проверка — opus. Отчёт проверяющего — не длиннее 15 строк.

## Review Focus

1. **Чужой повтор.** Преподаватель не этой карточки (в том числе нынешний преподаватель предмета и тот, кого деканат снял с карточки), проректор, студент: `repeat.get`, `repeat.saveWorks`, `repeat.saveAttempt`, `repeat.close`, `repeat.reopen`, `repeat.enrol`, `repeat.save`, `repeat.cancel` — `forbidden`, снимок таблиц тот же. Студент не получает чужую карточку ни в `repeat.mine`, ни в `student.grades` (поиск чужих id и ФИО в JSON). `repeatId`, `subjectId`, `studentId`, `teacherId` — массив, число, объект, строка с пробелами, `'__proto__'` — `not_found`, `bad_request` или `invalid`, не `internal`. Тесты — задачи 4, 5, 6.
2. **Снимок до и после переключения семестра.** Прежний результат одного и того же студента, собранный до переключения и после него, совпадает число в число; после записи, работ, попыток и закрытия повтора прежние таблицы не изменились. Тесты — задачи 3, 4, 7.
3. **Срок и состояние.** После срока баллы не ставит никто, включая администратора (`deadline_passed`); в день срока — можно; продление деканатом снова открывает ввод; закрытая и отменённая карточка не принимает ничего (`repeat_closed`); двойное «Закрыть»; открыть заново, когда уже есть новая карточка, — отказ. Тесты — задачи 4, 5.
4. **Повторник не пропадает.** После переключения семестра, смены преподавателя предмета, перевода студента в другую группу и отключения студента карточка остаётся в `repeat.list`, `repeat.get`, `repeat.mine`; студента, сотрудника и предмет с карточкой удалить нельзя (`in_use`). Тесты — задачи 4, 6.
5. **Порог допуска и числа из настроек.** Работы 30 — не допущен, экзамен не ставится, повтор закрывается «не сдал»; 31 — допущен; итог 59 — «неуд.», 60 — «удовл.»; «только экзамен» берёт прежний семестр из снимка; с настройками 50 / 50 / 25 максимум работ 50 и допуск «больше 25» — без правки кода. Тесты — задачи 1, 5.

## Чего в доработке нет

Архива полугодий и просмотра старых ведомостей; дней повтора в расписании, пар и посещаемости на повторе; проверки оплаты; заданий и файлов для повторников; пересдачи «на повышение»; заявок на исправление баллов повтора (решение координатора 5); файла Excel для листа повтора; ограничения числа повторов; автоматического закрытия по сроку; ИИ.

## Решения плана, которые видят пользователи или которые меняют базу

Строки с пометкой «вопрос N» — вопросы `owner-summary.md`; в плане стоит вариант по умолчанию. После согласия владельца координатор переносит решения в таблицу решений `aidlc-state.md`.

| Вопрос | Решение | Почему |
| --- | --- | --- |
| Новые таблицы | «Повторный курс» (`repeats`) и «Попытки экзамена повтора» (`repeatAttempts`); новое значение `entity` «Журнала изменений» — `repeat`. Колонок в прежние таблицы и строк «Настроек» не добавляется | дизайн, решение 13 |
| Где лежит снимок | В той же строке карточки, колонки `prev*`; попытки прежнего экзамена — одной строкой текста `1\|2026-12-15\|20;2\|2027-01-12\|absent` | одна запись — одна карточка; читается и в Google Таблице |
| Когда можно записать | Итоговая ведомость предмета за это полугодие закрыта, прежний результат — «неуд.», «не допущен», «не явился(ась)» или «I»; нет идущей карточки; последняя закрытая — «не сдал» | решение 1 |
| Пересдачи ещё остались (вопрос 1) | Записать можно (решает приказ); в окне записи строка «остались пересдачи: N». После записи пересдача в прежней ведомости этому студенту не добавляется (`on_repeat`) | иначе у прежнего итога и у снимка появятся разные числа |
| «Только экзамен» не допущенному (вопрос 2) | Журнал не даёт: без допуска итог по положению не считается; не допущенному — только «весь предмет» | решения 2 и 9 |
| Снимок при втором повторе | Из последней закрытой карточки этого предмета и полугодия: её итог, её попытки, её «семестр» (работы или прежний семестр) | решение 8 |
| Кто ставит работы и экзамен (вопрос 3) | Преподаватель повтора; деканат и администратор — тоже. Третью сдачу (комиссией) вносят только деканат и администратор, с составом комиссии | как у экзамена юнита 6; нужен выход, если преподаватель недоступен |
| Записали по ошибке (вопрос 4) | Деканат или администратор **отменяет** запись с причиной, пока нет ни работ, ни попыток экзамена. Карточка остаётся со состоянием «отменён», студенту и преподавателю не показывается, новой записи не мешает | строки не удаляются |
| Исправление баллов повтора (вопрос 5) | Пока повтор идёт: работы и **последнюю** попытку экзамена исправляет тот, кто их ставит, с причиной (первое значение — без причины). После закрытия — только администратор открывает заново с причиной | решение 5: новых заявок нет |
| Дата попытки | Не раньше даты приказа, не позже сегодня и срока, позже прежней попытки повтора; зачётная неделя не ограничивает | решение 7 |
| Закрытие | Кнопка у преподавателя повтора, деканата, администратора. Нельзя, пока не поставлены работы («весь предмет»), у допущенного нет попытки или последняя — «I». «Не сдал», когда сдачи ещё остались, — после подтверждения. После срока деканат и администратор закрывают в любом состоянии («не сдал», если итог не положительный) | решения 4, 9, 11 |
| Открыть заново | Только администратор, с причиной; нельзя, если у студента уже есть более новая карточка этого предмета и полугодия | решение 5 |
| Меню (вопрос 6) | Деканат, администратор, проректор — «Повторный курс» в группе журналов после «Ведомостей». Преподаватель — «Мои повторники» (виден всегда; пусто — «Повторников нет») и блок на главной, когда они есть | дизайн «Кто что делает» |
| Что видит студент (вопрос 7) | Предмет, вид, приказ (номер и дата), срок, преподаватель повтора, работы с пояснением, попытки (дата и результат), итог и слово, прежний итог мелко. Состава комиссии не видит | данные о самом студенте |
| Пометка в ведомости | В ведомости текущего полугодия у студента с карточкой — метка «повтор» и итог повтора рядом с прежним (пока идёт — «предварительно»). Печать и Excel ведомости не меняются | дизайн «Где виден новый итог» |
| «Журнал изменений» | Строки повтора видят деканат, администратор и проректор. Преподавателям они не показываются (и преподавателю предмета — тоже) | преподаватель предмета не должен видеть чужой повтор |
| Запрет удаления | Студента, предмет и сотрудника (преподаватель повтора, записавший, закрывший, вносивший попытку) с карточкой удалить нельзя (`in_use`) | решение 12 |
| Стенд | На `dev:reset` «Анатомия» 02-1 (`teacher2`): итоговая закрыта, шесть не сдавших; четыре карточки в разных состояниях, двое свободны для записи (задача 7) | приёмка без ручной подготовки |

## Модель данных

`core/schema.js`, после `examAttempts`:

```js
export const REPEAT_KINDS = ['full', 'exam'];                          // весь предмет, только экзамен
export const REPEAT_STATUSES = ['open', 'passed', 'failed', 'cancelled']; // идёт, сдал, не сдал, отменён
// LOG_ENTITIES: + 'repeat'
repeats: { sheet: 'Повторный курс', prefix: 'rp', columns: [
  id, studentId 'студент', subjectId 'предмет', planSemester 'семестр по плану' int, kind 'вид',
  orderNo 'приказ №', orderDate 'дата приказа', deadline 'срок', teacherId 'преподаватель повтора',
  prevSemester 'прежний семестр' int, prevAdmitted 'прежний допуск' bool, prevStatus 'прежний результат', prevExam 'прежний экзамен' int,
  prevTotal 'прежний итог' int, prevWord 'прежняя оценка', prevAttempts 'прежние попытки', prevRepeatId 'снимок из повтора',
  works 'работы повтора' int, worksNote 'что сделано', status 'состояние',
  createdBy 'кто записал', createdAt 'когда записан', updatedBy 'кто изменил', updatedAt 'когда изменено', closedBy 'кто закрыл', closedAt 'когда закрыт' ] },
repeatAttempts: { sheet: 'Попытки экзамена повтора', prefix: 'rx', columns: [
  id, repeatId 'повтор', no 'номер попытки' int, date 'дата', outcome 'результат', score 'баллы' int, commission 'комиссия', updatedBy 'кто изменил', updatedAt 'когда изменено' ] },
```

Строки «Журнала изменений»: `{ entity: 'repeat', subjectId, studentId, pairId: '', unit: null, field, before, after, reason, late: false }`; `field`: `enrol` (после — вид), `orderNo`, `orderDate`, `deadline`, `teacher` (было / стало — ФИО текстом), `works`, `try<номер>` (текст `examText`), `status` (`open` → `passed` / `failed` / `cancelled` и обратно).

## Правила расчёта (с числами)

Схема и деление по умолчанию (60 / 40, допуск «больше 30», пороги 60 / 80 / 90). Данные помощника тестов `failed()` (задача 2): a1 — семестр 47, экзамен 35, итог 82 «хорошо»; a2 — семестр 38, экзамен 20, итог 58 «неуд.», одна сдача; a3 — не допущен.

| Случай | Расчёт | Итог |
| --- | --- | --- |
| a2, «весь предмет», работы 45, экзамен 30 | 45 + 30 | 75 «удовл.», сдал |
| a2, «весь предмет», работы 30 | 30 не больше 30 | не допущен, экзамен не ставится, «не сдал» |
| a2, «весь предмет», работы 31, экзамена нет | допущен | закрыть нельзя: `exam_missing` |
| a2, «только экзамен», экзамен 22 | 38 + 22 | 60 «удовл.», сдал |
| a2, «только экзамен», экзамен 21 | 38 + 21 | 59 «неуд.»; сдачи остались — закрыть «не сдал» после подтверждения |
| a3, «только экзамен» | не допущен | запись отклонена: `kind/not_admitted` |
| настройки 50 / 50 / 25, работы 26, экзамен 50 | 26 + 50 | 76 «удовл.» (порог «хорошо» 80) |

Главный итог (решение 10): пока карточка `open` — прежний, итог повтора показан как «предварительно»; `passed` и `failed` — итог повтора.

## Права по ролям

| Действие | admin | dean | prorector | teacher | student |
| --- | --- | --- | --- | --- | --- |
| `repeat.list`, `repeat.get` | все | все | все | только карточки, где он преподаватель повтора (не отменённые) | — |
| `repeat.candidates`, `repeat.enrol`, `repeat.save`, `repeat.cancel` | да | да | — | — | — |
| `repeat.saveWorks`, `repeat.saveAttempt`, `repeat.close` | да | да | — | преподаватель повтора (сдачу комиссией — нет) | — |
| `repeat.reopen` | да | — | — | — | — |
| `repeat.mine` | — | — | — | — | свои |

## Откат

Доработка добавляет две таблицы и одно новое значение `entity`; колонок, строк «Настроек» и переходов данных нет. Прежний выложенный код — `b829763`.

**Проба (задача 8 — целиком; сверка плана — «ручной» вариант; общая проверка повторяет; только во временной папке сессии):**

1. Прежний код: `git archive b829763 | tar -x -C <временная папка>/old` (worktree не создавать).
2. Временная база: `initBase` + `seedDemo` новым кодом (на сверке плана две таблицы создаются руками по разделу «Модель данных»). В ней — карточки во всех четырёх состояниях, попытки повтора (в том числе с комиссией), строки «Журнала изменений» с `entity: 'repeat'`.
3. Прежний код на этой базе: `openBase` → `upgrade()` → уборка файлов → `handleRequest`: `journal.log` (деканат и преподаватель предмета), `ledger.list`, `ledger.get`, `student.grades`, `ledger.addAttempt` студенту с карточкой, `dir.remove` студента, преподавателя повтора и предмета с карточкой, `settings.save` с переключением семестра, `schedule.generate`; затем `backupNow` и `restoreBase` туда-обратно; затем `runDemo` с `wipe` на **копии** базы.
4. Сверить: число строк и содержимое обеих новых таблиц и строк `entity: 'repeat'` не изменились (кроме `wipe` — он новых таблиц не знает); ни один ответ не `internal`.
5. Новый код снова на той же базе: `repeat.list`, `repeat.get`, `repeat.mine`, `repeat.candidates`, `student.grades`, `ledger.get`, `journal.log` — без `internal`, в том числе когда человек, на которого ссылается карточка, удалён прежним кодом (имя — пустая строка), и когда прежний код добавил пересдачу студенту с карточкой (снимок не изменился).

**Что известно заранее (записать в раздел выкладки `aidlc-state.md`):** прежний код новых таблиц не знает и не трогает; повторы на нём не видны, студент видит только прежний итог. Пока он работает: в прежней ведомости можно добавить пересдачу студенту с карточкой; преподаватель предмета увидит в «Журнале изменений» своего предмета строки повтора как «прочее изменение» (поле, было, стало); студента с карточкой прежний код не удалит (у него есть строка «Журнала изменений»), а преподавателя повтора, который ничего не вносил, — удалит; `serve:demo-wipe` на прежнем коде **не запускать**.

## Файлы

```
core/repeat.js              правила повтора                                                       новый
core/schema.js              + 2 таблицы, REPEAT_KINDS, REPEAT_STATUSES, 'repeat' в LOG_ENTITIES
core/permissions.js         + repeat.*
backend/repeatSnapshot.js   прежний результат текущего и прошлого полугодия                       новый
backend/repeatData.js       кандидаты, запись, список, чтение, правка, отмена, карточки студента  новый
backend/repeatScores.js     работы, попытки, закрытие, открытие заново                            новый
backend/handlers/repeat.js  действия repeat.*                                                     новый
backend/api.js  backend/handlers/journal.js  backend/handlers/dir.js
backend/studentGrades.js  backend/ledgerData.js  backend/examData.js  backend/journalData.js
dev/seed.js                 seedRepeat
site/js/repeat.js           помощники без DOM, лист A4                                            новый
site/js/views/repeats.js  repeatEnrol.js  repeat.js                                               новые
site/js/router.js  main.js  shell.js  journal.js  ledger.js  views/home.js  views/grades.js  views/ledger.js  i18n/*.js  css/screens.css
tests/repeat.test.js  repeatSnapshot.test.js  repeatApi.test.js  repeatScoresApi.test.js  repeatSeenApi.test.js  seedRepeat.test.js  siteRepeat.test.js   новые
tests/journalSetup.js  schema.test.js  permissions.test.js  dir.test.js  router.test.js  ui.test.js  i18n.test.js  и прежние тесты со списками таблиц (назвать в отчёте)
```

Кто делает: **Л** — `journal-logic`, **С** — `journal-server`, **Э** — `journal-screens`, **П** — `journal-reviewer`. Общие файлы правит только задача, которая сейчас в работе. Рабочий каталог плана — `.superpowers/sdd/plan-povtornyi-kurs/`, журнал хода — `progress.md` там же, копия — `aidlc-docs/construction/povtornyi-kurs/sdd/ledger-snapshot.md`.

---

### Task 1 (Л): правила повтора

**Files:** Create `core/repeat.js`, `tests/repeat.test.js`. **Проверка — строгая** (числа раздела «Правила расчёта»).

**Interfaces — Consumes:** `subjectResult`, `checkAttempt`, `examText`, `parseExamText` (`core/exam.js`); `isDate`, `addDays` или `daysBetween` (`core/dates.js`); `REPEAT_KINDS` появится в задаче 2 — здесь файл объявляет `const KINDS = ['full', 'exam']` у себя, задача 2 заменит импортом.

**Produces:**

```js
export const REPEAT = Object.freeze({ orderMax: 40, noteMax: 300, deadlineDaysMax: 366 });
export function attemptsText(attempts);     // [{ no, date, outcome, score }] -> '1|2026-12-15|20;2|2027-01-12|absent'; [] -> ''
export function parseAttemptsText(text);    // обратно -> [{ no, date, outcome, score }]; не строка или испорченная часть -> []
export function snapshotOf(result);         // { semester, admitted, status, exam, total, word, attempts } ->
                                            // { prevSemester, prevAdmitted, prevStatus, prevExam, prevTotal, prevWord (null -> ''), prevAttempts (attemptsText) }
export function prevOf(card);               // обратно: колонки prev* -> { semester, admitted, status, exam, total, word ('' -> null), attempts }
export function canRepeat(prev);            // status 'not_admitted' | 'absent' | 'incomplete', или 'done' и word 'fail'
export function suggestKind(prev);          // prev.admitted === true ? null : 'full'   («не допущен» -> весь предмет)
export function enrolProblem({ prev, kind, cards });
// cards — все карточки этого студента, предмета и полугодия -> null | { field, code }, первая из:
// kind не из списка — kind/bad_value; есть 'open' — studentId/has_open; последняя закрытая (по closedAt, затем id) 'passed' — studentId/passed;
// !canRepeat(prev) — studentId/not_failed; kind 'exam' и prev.admitted !== true — kind/not_admitted. 'cancelled' не учитываются.
export function checkOrder(input, { today });
// input: { orderNo, orderDate, deadline } -> { value | null, problems: [{ field, code }] }
// orderNo: не строка — bad_value; после trim пусто — required; длиннее REPEAT.orderMax — too_long
// orderDate: не isDate — bad_value; позже today — in_future
// deadline: не isDate — bad_value; раньше today — in_past; позже today + REPEAT.deadlineDaysMax дней — too_far
export function repeatResult({ card, attempts, scheme, split });
// card: { kind, works, prevSemester, prevAdmitted }; attempts — liveAttempts строк попыток повтора
// 'full': semester = card.works (null, пока не поставлены); admitted = Number.isInteger(works) && works > split.admission
// 'exam': semester = card.prevSemester; admitted = card.prevAdmitted === true && Number.isInteger(prevSemester)
// -> { semester, admitted, status, tries, exam, total, word, next }   (остальное — subjectResult({ semester, admitted, attempts, scheme }))
export function checkWorks(input, { card, split, hasAttempts });
// input: { works, note } -> { value: { works, note } | null, problems }
// card.kind 'exam' — works/not_needed; works — целое 0…split.semester, иначе works/bad_value; hasAttempts и works <= split.admission — works/has_attempts;
// note: не строка — bad_value; после trim пусто — required; длиннее REPEAT.noteMax — too_long
export function checkRepeatAttempt(input, { card, next, last, today, split });
// checkAttempt(input, { next, last, exam: { examStart: '', examEnd: '' }, today, split }), и если у даты ещё нет ошибки:
// раньше card.orderDate — date/before_order; позже card.deadline — date/after_deadline
export function closeState({ card, result });
// -> { blocking: [{ code }], outcome: 'passed' | 'failed', retakesLeft }
// blocking (первое подходящее): 'full' и works не целое — no_works; status 'none' — exam_missing; status 'incomplete' — exam_incomplete
// outcome: 'passed' только при status 'done' и word !== 'fail'; retakesLeft: outcome 'failed', status не 'not_admitted', result.next !== null и blocking пуст
export function isOverdue(card, today);     // card.status === 'open' && today > card.deadline
export function shownCard(cards);           // последняя не отменённая по createdAt, затем id; нет — null
export const isMain = (card) => card.status === 'passed' || card.status === 'failed';
```

- [ ] **Step 1: тесты** (`DEFAULT_SCHEME`, `DEFAULT_SPLIT`):

```js
const A = (no, outcome, score = null, date = '2027-01-15') => ({ no, outcome, score, date });
const full = (works, over = {}) => ({ kind: 'full', works, prevSemester: 38, prevAdmitted: true, orderDate: '2026-12-20', deadline: '2027-02-01', status: 'open', ...over });
const exam = (over = {}) => full(null, { kind: 'exam', ...over });
const res = (card, attempts = [], split = SP) => repeatResult({ card, attempts, scheme: S, split });
const pick = ({ semester, admitted, status, exam: e, total, word }) => ({ semester, admitted, status, exam: e, total, word });
assert.deepEqual(pick(res(full(45), [A(1, 'score', 30)])), { semester: 45, admitted: true, status: 'done', exam: 30, total: 75, word: 'fair' });
assert.deepEqual([res(full(null)).status, res(full(30)).status, res(full(31)).status], ['not_admitted', 'not_admitted', 'none']);
assert.deepEqual(pick(res(exam(), [A(1, 'score', 22)])), { semester: 38, admitted: true, status: 'done', exam: 22, total: 60, word: 'fair' });
assert.equal(res(exam(), [A(1, 'score', 21)]).word, 'fail');                                   // 59
assert.equal(res(exam({ prevAdmitted: false, prevSemester: 25 })).status, 'not_admitted');
assert.equal(res(full(26), [A(1, 'score', 50)], { semester: 50, exam: 50, admission: 25 }).total, 76);
const cs = (card, attempts = []) => closeState({ card, result: res(card, attempts) });
assert.deepEqual(cs(full(null)), { blocking: [{ code: 'no_works' }], outcome: 'failed', retakesLeft: false });
assert.deepEqual(cs(full(30)), { blocking: [], outcome: 'failed', retakesLeft: false });
assert.deepEqual(cs(full(31)), { blocking: [{ code: 'exam_missing' }], outcome: 'failed', retakesLeft: false });
assert.deepEqual(cs(full(45), [A(1, 'incomplete')]), { blocking: [{ code: 'exam_incomplete' }], outcome: 'failed', retakesLeft: false });
assert.deepEqual(cs(full(45), [A(1, 'score', 30)]), { blocking: [], outcome: 'passed', retakesLeft: false });
assert.deepEqual(cs(full(45), [A(1, 'score', 10)]), { blocking: [], outcome: 'failed', retakesLeft: true });
assert.deepEqual(cs(full(45), [A(1, 'score', 10), A(2, 'absent', null, '2027-01-20'), A(3, 'score', 5, '2027-01-25')]), { blocking: [], outcome: 'failed', retakesLeft: false });
const prev = { semester: 38, admitted: true, status: 'done', exam: 20, total: 58, word: 'fail', attempts: [A(1, 'score', 20, '2026-12-15')] };
assert.deepEqual(snapshotOf(prev), { prevSemester: 38, prevAdmitted: true, prevStatus: 'done', prevExam: 20, prevTotal: 58, prevWord: 'fail', prevAttempts: '1|2026-12-15|20' });
assert.deepEqual(prevOf(snapshotOf(prev)), prev);
assert.equal(attemptsText([A(1, 'score', 20, '2026-12-15'), A(2, 'absent', null, '2027-01-12')]), '1|2026-12-15|20;2|2027-01-12|absent');
assert.deepEqual([parseAttemptsText('мусор'), parseAttemptsText(7), parseAttemptsText('')], [[], [], []]);
const ep = (over) => enrolProblem({ prev, kind: 'full', cards: [], ...over });
assert.deepEqual([ep({}), ep({ kind: 'exam' }), ep({ cards: [{ status: 'failed', closedAt: 'x' }] }), ep({ cards: [{ status: 'cancelled' }] })], [null, null, null, null]);
assert.deepEqual(ep({ kind: 'half' }), { field: 'kind', code: 'bad_value' });
assert.deepEqual(ep({ cards: [{ status: 'open' }] }), { field: 'studentId', code: 'has_open' });
assert.deepEqual(ep({ cards: [{ status: 'passed', closedAt: '2027-01-20 10:00:00' }] }), { field: 'studentId', code: 'passed' });
assert.deepEqual(ep({ prev: { ...prev, total: 60, word: 'fair' } }), { field: 'studentId', code: 'not_failed' });
assert.deepEqual(ep({ kind: 'exam', prev: { ...prev, admitted: false, status: 'not_admitted' } }), { field: 'kind', code: 'not_admitted' });
```

Ещё: `checkOrder` при `today: '2026-12-21'` — `{ orderNo: ' 15-с ', orderDate: '2026-12-20', deadline: '2026-12-21' }` даёт `value.orderNo === '15-с'`; `orderNo` `''` → `required`, 41 знак → `too_long`, число → `bad_value`; `orderDate: '2026-12-22'` → `in_future`; `deadline: '2026-12-20'` → `in_past`; `deadline: '2028-01-01'` → `too_far`. `checkWorks` для `full(null)`: `{ works: 45, note: ' Реферат ' }` → `{ works: 45, note: 'Реферат' }`; 61, −1, 3.5, `'45'` → `works/bad_value`; со `split` 50 / 50 / 25 значение 51 → `bad_value`; `note: ''` → `required`; для `exam()` → `works/not_needed`; `hasAttempts` и 30 → `works/has_attempts`. `checkRepeatAttempt` для `full(45)`, `next { no: 1, retake: false, commission: false }`, `today '2027-01-20'`: дата `2026-12-19` → `date/before_order`; при `today '2027-02-05'` дата `2027-02-02` → `date/after_deadline`, дата `2027-02-06` → `date/in_future`; балл 41 → `score/bad_value`; `next.commission` без состава → `commission/required`. `isOverdue`: срок `2027-02-01`, сегодня `2027-02-01` → `false`, `2027-02-02` → `true`, у `passed` → `false`. `suggestKind`, `canRepeat` (все пять статусов), `shownCard` (отменённая не берётся), `isMain`.

- [ ] **Step 2:** `node --test tests/repeat.test.js` падает. **Step 3:** написать. **Step 4:** `npm test` зелёное, `npm run build:gas` собирается.
- [ ] **Step 5:** коммит `feat: rules of the repeat course - enrolment, the new total, admission, closing, the snapshot as text`.

---

### Task 2 (Л): две таблицы, константы, права, помощники тестов

**Files:** Modify `core/schema.js`, `core/permissions.js`, `core/repeat.js` (импорт `REPEAT_KINDS`), `tests/journalSetup.js`, `tests/schema.test.js`, `tests/permissions.test.js` и прежние тесты, которые перечисляют таблицы, `LOG_ENTITIES` или права поимённо (только новые строки; назвать в отчёте). **Проверка — облегчённая.**

**Produces:** раздел «Модель данных» дословно; права раздела «Права по ролям»:

```js
'repeat.list': { admin: true, dean: true, prorector: true, teacher: true },   'repeat.get': то же,
'repeat.candidates', 'repeat.enrol', 'repeat.save', 'repeat.cancel': { admin: true, dean: true },
'repeat.saveWorks', 'repeat.saveAttempt', 'repeat.close': { admin: true, dean: true, teacher: true },
'repeat.reopen': { admin: true },   'repeat.mine': { student: true },
```

Помощники `tests/journalSetup.js` (прежние возвращаемые значения не меняются):

- `snapshot()` дополнительно копирует `repeats`, `repeatAttempts`.
- `failed()` — вызывает `allUnits()`, `examHead()`, `examRow(ids.a1)` (35), `examRow(ids.a2, { score: 20 })`, `closeFinal()`. Получается раздел «Правила расчёта».
- `repeatCard(over)` — пишет карточку прямо в хранилище: `{ studentId: ids.a2, subjectId: sb1, planSemester: 1, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: ids.teacher1, prevSemester: 38, prevAdmitted: true, prevStatus: 'done', prevExam: 20, prevTotal: 58, prevWord: 'fail', prevAttempts: '1|2026-12-15|20', prevRepeatId: '', works: null, worksNote: '', status: 'open', createdBy: ids.dean, createdAt: '2026-12-21 10:00:00', updatedBy: ids.dean, updatedAt: '2026-12-21 10:00:00', closedBy: '', closedAt: '', ...over }` → id.
- `repeatTry(repeatId, over)` — `{ repeatId, no: 1, date: '2027-01-15', outcome: 'score', score: 30, commission: '', updatedBy: ids.teacher1, updatedAt: '2027-01-15 12:00:00', ...over }` → id.
- `switchSemester()` — `s.at('2027-01-11')`, затем настоящий запрос `settings.save` под `dean`: `{ settings: { semesterStart: '2027-01-11', semesterEnd: '2027-05-30', holidays: [], bells: DEFAULT_BELLS, semester: 2 } }`; тест помощника проверяет `ok: true`.

- [ ] **Step 1: тесты:** `tableNames()` содержит `repeats` и `repeatAttempts`, листы «Повторный курс» и «Попытки экзамена повтора», приставки `rp` и `rx` не совпадают ни с одной прежней; `LOG_ENTITIES` содержит `repeat`; `can(['teacher'], 'repeat.enrol')` и `can(['dean'], 'repeat.reopen')`, `can(['prorector'], 'repeat.close')`, `can(['student'], 'repeat.list')` — `false`; `can(['student'], 'repeat.mine')`, `can(['prorector'], 'repeat.get')` — `true`; хранилище в памяти и SQLite создают обе таблицы (`tests/storeContract.js` — как для таблиц юнита 6); после `failed()` `ledger.get` под `dean` даёт a1 82 `good`, a2 58 `fail`, a3 `not_admitted`.
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: tables of the repeat course, its rights and test helpers`.

---

### Task 3 (С): снимок прежнего результата — текущее и прошлое полугодие

**Files:** Create `backend/repeatSnapshot.js`, `tests/repeatSnapshot.test.js`. **Проверка — строгая** (числа; Review Focus 2).

**Interfaces — Consumes:** `LEDGER_TABLES`, `ledgerView`, `examRowsOf` (`backend/ledgerData.js`); `pairKeyOf`, `selfWorkOf`, `lastOf`, `closedOfSubject` (`backend/journalData.js`); `activeClosure`, `closedUnitsOf`, `FINAL_UNIT` (`core/ledger.js`); `studentResults`, `firstPairId` (`core/grades.js`); `subjectResult` (`core/exam.js`); `readScheme`, `readSplit`, `readSettings`, `syllabusFor`.

**Produces:**

```js
export function halvesOf(rows, subject);
// -> [{ planSemester, current }] по возрастанию: полугодия предмета, у которых есть действующее закрытие итоговой (unit 0, reopenedAt '');
// current — planSemester действующего сейчас силлабуса предмета (syllabusFor(subject, rows.syllabi, settings.semester)) равен этому
export function halfResults(rows, platform, subject, planSemester, user);
// rows — таблицы LEDGER_TABLES (читает вызывающий, один раз); user — деканат или администратор, который записывает
// -> { current, students: [{ id, fullName, semester, complete, admitted, attempts, status, tries, exam, total, word, next }] }
```

Расчёт. **Текущее полугодие** — строки `ledgerView(rows, platform, subject.id, user).students`, переложенные по полям: числа те же, что в ведомости, по построению. **Прошлое полугодие** (сигнатура его не определяет):

1. Пары: `rows.pairs` предмета, у которых `pairKeyOf(rows, pair)` даёт этот `planSemester`; юнит пары — из того же ключа; «первая пара» — `firstPairId` этих пар.
2. Юниты: `closedUnitsOf(rows.closures, subject.id, planSemester).units`.
3. Отметки — последняя строка «Посещаемости» на пару и студента (`lastOf(…, 'markedAt')`); строки «Итогов юнитов» — предмета и этого `planSemester`, последняя по `updatedAt`; СРС — `selfWorkOf(rows, subject, planSemester, studentId, platform.now(), scheme.self)`.
4. `studentResults({ pairs, marks, unitRows, units, scheme, split, selfWork })`, попытки — `examRowsOf(rows, subject.id, planSemester)`, итог — `subjectResult` с тем же условием допуска, что в `ledgerView` (`admitted === true && Number.isInteger(semester)`).
5. Студенты: строки «Студентов» из группы предмета и те, у кого в этом полугодии есть отметки, итоги юнитов или попытки (переведённые и отключённые не теряются).

- [ ] **Step 1: тесты** (`s.failed()`; `s.at('2026-12-21')`):

```js
const rows = () => Object.fromEntries(LEDGER_TABLES.map((t) => [t, s.store.list(t)]));
const dean = { id: s.ids.dean, roles: ['dean', 'teacher'] };
const subject = () => s.store.list('subjects').find((x) => x.id === s.sb1);
const byId = (r) => Object.fromEntries(r.students.map((x) => [x.id, x]));
assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: true }]);
const before = byId(halfResults(rows(), s.platform, subject(), 1, dean));
assert.deepEqual([before[s.ids.a1].total, before[s.ids.a1].word, before[s.ids.a2].semester, before[s.ids.a2].exam, before[s.ids.a2].total, before[s.ids.a2].word, before[s.ids.a2].tries], [82, 'good', 38, 20, 58, 'fail', 1]);
assert.deepEqual([before[s.ids.a3].status, before[s.ids.a3].total], ['not_admitted', null]);
s.switchSemester();
assert.deepEqual(halvesOf(rows(), subject()), [{ planSemester: 1, current: false }]);
assert.deepEqual(byId(halfResults(rows(), s.platform, subject(), 1, dean)), before);     // до и после — число в число
```

Ещё: итоговая открыта заново (`reopenedAt` заполнен) → `halvesOf` даёт `[]`; после переключения у предмета утверждён силлабус второго полугодия без закрытий → по-прежнему `[{ planSemester: 1, current: false }]`; студент a2 после переключения переведён в группу 02-1 и отключён (`active: false`) → его строка в `halfResults` та же; у предмета сменён преподаватель после переключения → те же числа; `halfResults` не вызывает `store.list` (чистая функция над `rows`: шпион `s.spy.lists` не меняется); снимок всех таблиц до и после вызова одинаков.

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: the previous result of a subject half, the same before and after the semester switch`.

---

### Task 4 (С): карточка — кандидаты, запись, список, чтение, правка, отмена

**Files:** Create `backend/repeatData.js`, `backend/handlers/repeat.js`, `tests/repeatApi.test.js`. Modify `backend/api.js` (`registerHandlers(repeatHandlers)`). **Проверка — строгая** (права, обход; Review Focus 1–4).

**Interfaces — Consumes:** задачи 1–3; `viewerOf`, `lastOf`; `liveAttempts`; `checkReason` (`core/journal.js`); `readScheme`, `readSplit`, `readExtra`; `localDate`, `localDateTime`; `compareNames`.

**Produces:**

```js
export const REPEAT_TABLES = ['repeats', 'repeatAttempts', 'subjects', 'groups', 'staff', 'students', 'settings'];
export function readRepeatRows(store);                      // каждая таблица один раз
export function mayRead(viewer, card);                      // manager || reader || (teacher && card.teacherId === viewer.id && card.status !== 'cancelled')
export function mayScore(viewer, card);                     // manager || (teacher && card.teacherId === viewer.id)
export function cardView(rows, platform, card, user);       // -> repeat (ниже)
export function repeatList(store, platform, user);          // 'repeat.list' {} -> { today, can: { enrol }, repeats: [row] }
export function repeatGet(store, platform, data, user);     // 'repeat.get' { repeatId } -> { repeat }
export function repeatCandidates(store, platform, data, user);  // 'repeat.candidates' { subjectId? }
export function enrol(store, platform, data, user);         // 'repeat.enrol' { subjectId, planSemester, studentId, kind, orderNo, orderDate, deadline, teacherId } -> { repeat }
export function saveCard(store, platform, data, user);      // 'repeat.save' { repeatId, orderNo, orderDate, deadline, teacherId } -> { repeat }
export function cancelCard(store, platform, data, user);    // 'repeat.cancel' { repeatId, reason } -> { repeat }
```

Формы ответа:

```js
// row (repeat.list): { id, studentName, groupName, subjectId, subjectName, planSemester, kind, orderNo, orderDate, deadline, overdue, teacherName, own,
//                      status, total, word, tries }      groupName — группа предмета; own — card.teacherId === user.id
// repeat (cardView): { id, today, status, kind, overdue, collegeName,
//   student: { id, fullName, groupName, course }, subject: { id, name, planSemester }, teacher: { id, fullName },
//   order: { no, date }, deadline, prev: { semester, admitted, status, exam, total, word, attempts, fromRepeat: prevRepeatId !== '' },
//   works: { value, note }, attempts: [{ id, no, date, outcome, score, commission }],
//   result: { semester, admitted, status, tries, exam, total, word, next }, close: { blocking, outcome, retakesLeft },
//   closedAt, closedByName, split: { semester, exam, admission }, scheme: { fair, good, excellent },
//   can: { edit, cancel, works, attempt, commission, close, force, reopen } }
// can: edit, cancel — manager и 'open' (cancel — ещё и без работ и попыток); works, attempt — mayScore, 'open', не overdue (works — только 'full';
//      attempt — result.next !== null и допущен); commission — manager; close — mayScore и 'open'; force — manager, 'open' и overdue; reopen — admin и 'passed' | 'failed'
// repeat.candidates без subjectId: { subjects: [{ subjectId, name, groupName, teacherName, halves: [planSemester…] }] } — только предметы с закрытой итоговой;
//   читает subjects, groups, staff, closures
// repeat.candidates с subjectId: { subject: { id, name, groupName, teacherId }, teachers: [{ id, fullName }] (действующие с ролью teacher, по ФИО),
//   halves: [{ planSemester, current, students: [{ id, fullName, prev: { semester, admitted, status, exam, total, word, tries, retakesLeft },
//             suggest: 'full' | null, blocked: null | 'has_open' }] }] } — только те, кому повтор возможен или у кого он уже идёт; читает LEDGER_TABLES и две новые
```

Правила:

- Плохой `repeatId` / `subjectId` (не строка, нет такой строки) — `not_found`. Карточка есть, но `mayRead` ложно — `forbidden`.
- `repeat.list`: деканат, администратор, проректор — все карточки (отменённые тоже); преподаватель без роли конторы — только `mayRead`; сортировка: идущие, затем остальные, внутри — срок, ФИО.
- `repeat.enrol`: `subjectId` → `not_found`; `planSemester` не из `halvesOf` — `invalid` `planSemester/final_open`; студента нет в `halfResults` — `studentId/bad_ref`; прежний результат — последняя закрытая `failed` карточка этого студента, предмета и полугодия (её `repeatResult`, `prevRepeatId` — её id), иначе строка `halfResults`; затем `enrolProblem`, `checkOrder`, `teacherId` — действующий сотрудник с ролью `teacher`, иначе `teacherId/bad_ref`. Все ошибки полей — одним `invalid`. Запись: одна строка карточки (`snapshotOf`, `status: 'open'`, `works: null`) и одна строка журнала `field: 'enrol'`, `after: kind`.
- `repeat.save`: карточка не `open` — `repeat_closed`; `checkOrder` и `teacherId` как выше; меняются только `orderNo`, `orderDate`, `deadline`, `teacherId`; по строке журнала на каждое изменившееся поле; без изменений — без записи.
- `repeat.cancel`: не `open` — `repeat_closed`; есть работы или действующая попытка — `invalid` `repeat/has_results`; причина — `checkReason`; `status: 'cancelled'`, `closedBy`, `closedAt`; строка журнала `status`, `open` → `cancelled`, с причиной.

- [ ] **Step 1: тесты** (`s.failed()`; `s.at('2026-12-21')`):

```js
const enrol = (data, token = s.t.dean) => s.call('repeat.enrol', { subjectId: s.sb1, planSemester: 1, studentId: s.ids.a2, kind: 'full', orderNo: '15-с', orderDate: '2026-12-20', deadline: '2027-02-01', teacherId: s.ids.teacher1, ...data }, token);
const OLD = ['closures', 'subjectExams', 'examAttempts', 'unitResults', 'attendance', 'requests'];
const old = () => { const all = s.snapshot(); return Object.fromEntries(OLD.map((t) => [t, all[t]])); };
const was = old();
const r = enrol({});
assert.deepEqual([r.ok, r.data.repeat.status, r.data.repeat.prev.total, r.data.repeat.prev.word, r.data.repeat.prev.semester, r.data.repeat.result.status], [true, 'open', 58, 'fail', 38, 'not_admitted']);
assert.deepEqual(old(), was);                                                               // готовое не тронуто
assert.deepEqual(enrol({}).error.fields, [{ field: 'studentId', code: 'has_open' }]);
assert.deepEqual(enrol({ studentId: s.ids.a1 }).error.fields, [{ field: 'studentId', code: 'not_failed' }]);
assert.deepEqual(enrol({ studentId: s.ids.a3, kind: 'exam' }).error.fields, [{ field: 'kind', code: 'not_admitted' }]);
assert.equal(enrol({ studentId: s.ids.a3 }).data.repeat.prev.status, 'not_admitted');
for (const token of [s.t.teacher1, s.t.prorector, s.t.a1]) { const b = s.snapshot(); assert.equal(enrol({ studentId: s.ids.a3 }, token).error.code, 'forbidden'); assert.deepEqual(s.snapshot(), b); }
```

Ещё: итоговая не закрыта → `planSemester/final_open`; `planSemester: '1'`, 9, массив → `invalid`; `teacherId` студента, отключённого сотрудника, проректора → `teacherId/bad_ref`; строка журнала `{ entity: 'repeat', field: 'enrol', after: 'full', studentId: a2, subjectId: sb1 }`. `repeat.list`: `dean` — 2, `prorector` — 2, `teacher1` — 2 (`own: true`), `teacher2` — 0. `repeat.get`: `teacher2` — `forbidden`; id — `['x']`, `12`, `{}`, `' rp1 '`, `'__proto__'` — `not_found`. `repeat.save` деканом: срок `2027-03-01` и преподаватель `teacher2` → две строки журнала; после этого `teacher1` на `repeat.get` — `forbidden`, `teacher2` — видит; срок вчера → `deadline/in_past`. `repeat.cancel`: без причины — `invalid`; с причиной — `cancelled`, у `teacher2` список пуст, повторная запись a2 проходит; отмена карточки с работами — `repeat/has_results`. **После `s.switchSemester()`:** карточки на месте в `repeat.list`; `repeat.candidates { subjectId: sb1 }` → `halves[0]` — `{ planSemester: 1, current: false }`; запись нового студента после переключения проходит и даёт тот же `prev`, что до переключения (сравнить со строкой, собранной до него). У предмета сменён преподаватель (`subjects.teacherId = teacher3`) → `teacher3` карточку не видит, `teacher1` (преподаватель повтора) видит. Студент a2 переведён в группу 02-1 и отключён (`active: false`) → карточка под `dean` на месте в `repeat.list` и `repeat.get`, ФИО и группа предмета в ней прежние. Второй повтор: карточка a2 закрыта `failed` с работами 45 и попыткой 10 → новая запись даёт `prev.total 55`, `prev.semester 45`, `prev.fromRepeat: true`. `repeat.candidates` без `subjectId` → `[{ subjectId: sb1, halves: [1] }]`. Каждая таблица читается один раз (`s.spy.lists`).

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: the deanery enrols a student in a repeat course, edits and cancels the card; lists by the teacher of the repeat`.

---

### Task 5 (С): работы, экзамен повтора, закрытие, открытие заново

**Files:** Create `backend/repeatScores.js`, `tests/repeatScoresApi.test.js`. Modify `backend/handlers/repeat.js`. **Проверка — строгая** (права, баллы, обход; Review Focus 1, 3, 5).

**Interfaces — Consumes:** `readRepeatRows`, `cardView`, `mayScore` (задача 4); `repeatResult`, `checkWorks`, `checkRepeatAttempt`, `closeState`, `isOverdue` (задача 1); `liveAttempts`, `examText`; `checkReason`.

**Produces:**

```js
export function saveWorks(store, platform, data, user);     // 'repeat.saveWorks' { repeatId, works, note, reason } -> { repeat }
export function saveAttempt(store, platform, data, user);   // 'repeat.saveAttempt' { repeatId, no, date, outcome, score, commission, reason } -> { repeat }
export function closeRepeat(store, platform, data, user);   // 'repeat.close' { repeatId, acceptFail } -> { repeat }
export function reopenRepeat(store, platform, data, user);  // 'repeat.reopen' { repeatId, reason } -> { repeat }
```

Правила (порядок проверок общий: `not_found` → `forbidden` (`mayScore`) → `repeat_closed` (не `open`) → для работ и попыток `deadline_passed` (`isOverdue`)):

- `saveWorks`: `checkWorks`; значение меняется (уже было число) — нужна причина (`checkReason`, ошибка `reason/<код>`); первое значение и смена одного пояснения — без причины. Строка журнала `works`, было / стало числом текстом. Без изменений — без записи.
- `saveAttempt` без `no` — новая попытка: не допущен — `invalid` `repeat/not_admitted`; `result.next === null` — `repeat/not_allowed`; `next.commission` и человек не контора — `forbidden`; `checkRepeatAttempt`; вставка строки, журнал `try<номер>`, было `''`.
- `saveAttempt` с `no` — исправление: `no` должно быть номером **последней** действующей попытки, иначе `no/bad_value`; попытку с комиссией правит только контора; проверка — `checkRepeatAttempt` с `next: { no, retake: no > 1, commission: у попытки есть состав комиссии }` и `last` — попыткой перед ней; причина обязательна; обновляется действующая строка, журнал — было / стало. Прежние попытки не меняются никогда.
- `closeRepeat`: `closeState`; `blocking` непуст — отказ `invalid` `close/<код>`, кроме случая «контора и срок вышел»; `retakesLeft` и `acceptFail !== true` — `acceptFail/required`; запись `status: outcome`, `closedBy`, `closedAt`; журнал `status`, `open` → `passed` / `failed`.
- `reopenRepeat`: не администратор — `forbidden`; карточка `open` или `cancelled` — `not_closed`; есть более новая не отменённая карточка того же студента, предмета и полугодия — `invalid` `repeat/has_newer`; причина; `status: 'open'`, `closedBy: ''`, `closedAt: ''`; журнал `status` с причиной.
- Ответ строится из прочитанных строк с учётом записанного, без второго чтения.

- [ ] **Step 1: тесты** (`s.failed()`; карточка a2 — настоящим `repeat.enrol`; `s.at('2027-01-15')`):

```js
const call = (action, data, token = s.t.teacher1) => s.call(action, { repeatId: id, ...data }, token);
let r = call('repeat.saveWorks', { works: 45, note: 'Реферат и две практические работы' });
assert.deepEqual([r.data.repeat.result.status, r.data.repeat.result.semester], ['none', 45]);
assert.equal(call('repeat.saveWorks', { works: 50, note: 'Реферат' }).error.fields[0].field, 'reason');
call('repeat.saveWorks', { works: 50, note: 'Реферат', reason: 'добавлена третья работа' });
r = call('repeat.saveAttempt', { date: '2027-01-15', outcome: 'score', score: 30 });
assert.deepEqual([r.data.repeat.result.total, r.data.repeat.result.word, r.data.repeat.close.outcome], [80, 'good', 'passed']);
r = call('repeat.close', {});
assert.deepEqual([r.data.repeat.status, r.data.repeat.closedByName !== ''], ['passed', true]);
for (const action of ['repeat.close', 'repeat.saveWorks', 'repeat.saveAttempt']) assert.equal(call(action, { works: 1, note: 'x', date: '2027-01-15', outcome: 'absent', score: null }).error.code, 'repeat_closed');
assert.equal(call('repeat.reopen', { reason: 'ошибка' }, s.t.dean).error.code, 'forbidden');
assert.equal(call('repeat.reopen', { reason: 'закрыт по ошибке' }, s.t.admin).data.repeat.status, 'open');
```

Ещё (каждый случай — на своей карточке или после `repeatCard(over)`): работы 30 → `saveAttempt` — `repeat/not_admitted`, `close` — `failed`; работы 31 без попытки → `close` — `close/exam_missing`; попытка «I» → `close/exam_incomplete`. «Только экзамен»: попытка 22 → итог 60 `fair`, `close` — `passed`; попытка 21 → `close` без `acceptFail` — `acceptFail/required`, с `true` — `failed`. **Срок:** `s.at('2027-02-02')` — `saveWorks` и `saveAttempt` под `teacher1`, `dean`, `admin` → `deadline_passed`, снимок тот же; `s.at('2027-02-01')` — проходят; деканат продлил срок (`repeat.save`) → снова проходят; срок вышел и работ нет: `close` под `teacher1` — `close/no_works`, под `dean` — `failed`. **Комиссия:** после двух неудачных сдач третья под `teacher1` — `forbidden`, под `dean` без состава — `commission/required`, с составом — проходит; четвёртая — `repeat/not_allowed`. **Исправление:** `{ no: 1, score: 31, reason }` при единственной попытке — проходит, в журнале было `30`, стало `31`; `{ no: 1 }` при двух попытках — `no/bad_value`; без причины — `invalid`. **Открыть заново:** при более новой карточке — `repeat/has_newer`; открытую — `not_closed`. **Обход:** `teacher2`; преподаватель предмета, не преподаватель повтора; `teacher1` после того, как деканат заменил его на карточке; `prorector`; студент a2 — на все четыре действия `forbidden`, снимок тот же; `repeatId` — массив, число, объект, строка с пробелами, `'__proto__'` — `not_found`; `works: '45'`, `45.5`, `-1`, 61; `score: 41`; `outcome: 'passed'` — `invalid`, не `internal`. Со `scoreSemester 50`, `scoreExam 50`, `scoreAdmission 25` в «Настройках»: работы 51 — `bad_value`, 25 — не допущен, 26 — допущен. После всей цепочки шесть прежних таблиц (`OLD` задачи 4) не изменились; «Журнал изменений» получил по строке на каждое изменение; каждая таблица читается один раз.

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: the works and the exam of a repeat course, closing it and reopening by the administrator`.

---

### Task 6 (С): где виден повтор — студент, ведомость, «Журнал изменений», запрет удаления

**Files:** Modify `backend/repeatData.js` (`studentRepeats`, `repeatMine`), `backend/handlers/repeat.js` (`repeat.mine`), `backend/studentGrades.js`, `backend/handlers/journal.js` (чтение двух таблиц для `student.grades`), `backend/ledgerData.js`, `backend/examData.js`, `backend/journalData.js` (`changeLogView`), `backend/handlers/dir.js` (`BLOCKERS`), `tests/dir.test.js`. Create `tests/repeatSeenApi.test.js`. Прежние тесты, которые перечисляют таблицы чтения ведомости или «Оценок», — только новые строки (назвать в отчёте). **Проверка — строгая** (данные студентов; Review Focus 1, 4).

**Produces:**

```js
// backend/repeatData.js
export function studentRepeats(rows, platform, studentId);
// не отменённые карточки студента, новые первыми -> [{ subjectId, subjectName, planSemester, kind, orderNo, orderDate, deadline, overdue, status, teacherName,
//   works: { value, note, max }, attempts: [{ no, date, outcome, score }], exam, total, word, preliminary (status 'open'),
//   prev: { semester, status, exam, total, word } }]     — без id карточки и попыток, без комиссии
export function repeatMine(store, platform, user);          // 'repeat.mine' {} -> { today, split, repeats }  (читает REPEAT_TABLES)
export function repeatMark(card, attempts, scheme, split);  // -> { kind, status, total, word, main: isMain(card) } — метка рядом с итогом
// backend/studentGrades.js: ответ student.grades — ключ repeats (studentRepeats), только когда список непуст;
//   subjects[].repeat = repeatMark(shownCard(карточки этого предмета и planSemester записи)) — только когда карточка есть
// backend/ledgerData.js: LEDGER_TABLES + 'repeats', 'repeatAttempts'; строка студента ledgerView — repeat: repeatMark(…) только когда есть карточка
//   этого предмета и полугодия; у такого студента next: null
// backend/examData.js, addAttempt: у студента есть не отменённая карточка этого предмета и полугодия -> invalid [{ field: 'studentId', code: 'on_repeat' }]
// backend/journalData.js, changeLogView: строки entity 'repeat' отдаются только конторе и проректору; форма строки прежняя
// backend/handlers/dir.js, BLOCKERS: students + ['repeats', r.studentId === id]; subjects + ['repeats', r.subjectId === id];
//   staff + ['repeats', teacherId, createdBy, updatedBy или closedBy], ['repeatAttempts', r.updatedBy === id]
```

- [ ] **Step 1: тесты** (`s.failed()`; карточка a2 «весь предмет», работы 45, попытка 30 — настоящими запросами):

```js
const g = () => s.call('student.grades', {}, s.t.a2).data;
assert.deepEqual(g().repeats.map((x) => [x.kind, x.status, x.total, x.word, x.preliminary, x.prev.total, x.prev.word]), [['full', 'open', 75, 'fair', true, 58, 'fail']]);
assert.deepEqual(g().subjects[0].repeat, { kind: 'full', status: 'open', total: 75, word: 'fair', main: false });
s.call('repeat.close', { repeatId: id }, s.t.teacher1);
assert.deepEqual([g().subjects[0].repeat.main, g().subjects[0].repeat.status], [true, 'passed']);
const other = JSON.stringify(s.call('student.grades', {}, s.t.a1).data) + JSON.stringify(s.call('repeat.mine', {}, s.t.a1).data);
for (const bad of [s.ids.a2, 'Өмүров', 'repeats":[{', id]) assert.equal(other.includes(bad), false);
```

Ещё: в ответах студенту a2 нет `commission`, id карточки и id попыток, ФИО a1 и a3; у a1 ключа `repeats` нет, набор ключей его предмета прежний. `repeat.mine` под a2 после `s.switchSemester()`, после перевода a2 в группу 02-1 и после смены преподавателя предмета — карточка на месте. Отменённая карточка студенту не отдаётся. `ledger.get` под `dean` (до переключения): у a2 `repeat` и `next: null`, у a1 набор ключей строки прежний; `ledger.addAttempt` для a2 — `studentId/on_repeat`, снимок тот же; для студента без карточки — как раньше. `journal.log`: `dean` и `prorector` видят строки `entity: 'repeat'`; `teacher1` с `subjectId: sb1` — ни одной (хотя он преподаватель повтора), остальные его строки на месте. `dir.remove`: студент a2, предмет sb1, сотрудник, который только назначен преподавателем повтора, — `in_use`; студент без карточки удаляется как раньше. `student.grades` и `ledger.get` читают каждую таблицу один раз.

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: a student sees the own repeat course; the ledger marks it; its lines in the change log; rows of it block deletions`.

---

### Task 7 (С): стенд с вымышленными повторниками, пробные данные, сборка Apps Script

**Files:** Modify `dev/seed.js` (`seedRepeat`, вызов в конце `fill` после `seedExam`), `tests/devServer.test.js`, `tests/demo.test.js` (только счётчики и новые проверки; назвать в отчёте). Create `tests/seedRepeat.test.js`. **Проверка — облегчённая.**

**Produces:**

```js
export function seedRepeat(store, platform);
// «Анатомия» 02-1 (teacher2). Прежние таблицы пишутся прямо, как в seedExam (семестр стенда ещё идёт, по правилам итоговую не закрыть);
// карточки и их баллы — только функциями задач 4 и 5 под пробными людьми (dean записывает, teacher2 ставит). Числа считаются от readScheme / readSplit.
//   «Итоги юнитов» всех юнитов силлабуса у всех студентов группы; «Закрытые юниты» — все юниты и итоговая (unit 0) teacher2-ом, 12 и 9 дней назад;
//   «Экзамены предметов» — дата 10 дней назад; «Попытки экзамена» № 1 у допущенных.
//   Не сдавшие (по номеру билета): S2005 — «неуд.» после трёх сдач (пересдачи 7 и 5 дней назад, вторая — комиссией «Комиссия Стендовая»);
//   S2006 — «не явился(ась)»; S2007 — не допущен (нет рубежного последнего юнита); S2008 и S2009 — «неуд.» после одной сдачи; S2010 — «I». Остальные сдали.
//   Карточки (запись — часами, сдвинутыми на 4 дня назад; приказ «12-с» той же датой; срок — через 30 дней от сегодня, кроме S2008):
//   S2005 — «весь предмет», идёт, работы round(split.semester × 0.75) с пояснением «Реферат и две практические работы», экзамена нет;
//   S2006 — «только экзамен», идёт, одна попытка 2 дня назад на итог scheme.fair + 2 (предварительно «удовл.»);
//   S2007 — «весь предмет», закрыт «сдал»: работы round(split.semester × 0.8), экзамен на итог scheme.good + 1;
//   S2008 — «весь предмет», преподаватель повтора teacher3, срок — 2 дня назад («срок вышел»), работ нет;
//   S2009 и S2010 — без карточек (владелец записывает сам).
// Условность стенда: будущие пары «Анатомии» 02-1 остаются запланированными в закрытых юнитах — отметить их нельзя (пары и QR смотрим на 01-1).
// Имена — только вымышленные из dev/seed.js. У стенда и у пробных данных (seedDemo) одинаковые числа строк новых таблиц.
```

- [ ] **Step 1: тесты** (`tests/seedRepeat.test.js`, `seed` на памяти): четыре карточки — три `open` (одна `overdue`) и одна `passed`; `repeat.list` под `dean` — 4, под `teacher2` — 3, под `teacher3` — 1, под `teacher1` — 0; `repeat.candidates` «Анатомии» 02-1 под `dean`: одно полугодие `current: true`, S2009 и S2010 — `blocked: null`, S2005, S2006, S2008 — `has_open`, S2007 в списке нет; у S2005 `prev.tries` 3 и `prev.retakesLeft` `false`; `repeat.mine` под `S2007` — одна карточка `passed`, слово `good`; `student.grades` под `S2007` — `repeat.main: true`; под `S2001` ключа `repeats` нет; под `S2006` — `preliminary: true`, слово `fair`. **До и после переключения:** `halfResults` «Анатомии» 02-1 для всех 22 студентов до `settings.save` со вторым семестром и после — `deepEqual` (Review Focus 2); после переключения `repeat.list` под `dean` — по-прежнему 4, `repeat.enrol` S2009 проходит. Те же проверки проходят с `scoreSemester 50`, `scoreExam 50`, `scoreAdmission 25`, записанными до `seed`. Прежние `tests/seedLedger.test.js`, `seedMarks`, `seedWork` — зелёные без правок. `tests/demo.test.js`: `serve:demo-wipe` стирает и две новые таблицы.
- [ ] **Step 2:** падает. **Step 3:** написать.
- [ ] **Step 4:** `npm test`; `npm run dev:reset` поднимается, `repeat.list` под `dean` отвечает четырьмя карточками (остановить по своему PID); `npm run build:gas` собирается, `tests/gasBundle.test.js` зелёный — в сборке есть действия `repeat.*`, запретных слов нет.
- [ ] **Step 5:** коммит `feat: the stand and the demo data have repeat courses in every state`.

---

### Task 8 (П): проба отката на настоящей прежней версии

Исполнитель — `journal-reviewer` (sonnet, строго), код репозитория не правит. Раздел «Откат», шаги 1–5 целиком, прежний код — `b829763`; пробные скрипты — во временной папке сессии, их путь — в отчёте (не длиннее 15 строк: вердикт и находки).

- [ ] **Step 1:** прежний код распакован (`git archive b829763`), временная база собрана новым кодом (`seedDemo` с `seedRepeat`).
- [ ] **Step 2:** шаги 3 и 4 раздела «Откат»: число строк `repeats` и `repeatAttempts` и строки `entity: 'repeat'` до и после совпали; ни одного `internal`.
- [ ] **Step 3:** шаг 5: новый код на базе после прежнего отвечает без `internal`; снимок карточки не изменился после пересдачи, добавленной прежним кодом.
- [ ] **Step 4:** находки — координатору; важные исправляет `journal-server` одной правкой, тот же проверяющий повторяет только упавший шаг. Абзац «Что известно заранее» дополняется тем, что нашлось.

---

## Экраны: два блока с остановкой после каждого

Перед блоком стенд координатора остановлен; агенты поднимают свой `npm run dev:reset`. После последней задачи блока — **стоп**: координатор поднимает `journal-dev-reset`, входит за владельца и даёт список «что посмотреть» (владелец часто с телефона — список и скриншоты в конце ответа); заметки — в `aidlc-docs/construction/povtornyi-kurs/замечания.md`; правки блока — одному агенту.

Общее для экранов: чисел 60, 40, 30, 80, 90 в коде сайта и в текстах словарей нет — они подставляются из `split` и `scheme` ответа. Ключи словаря — приставки `repeat.*`, `repeat.enrol.*`, `repeat.card.*`, `repeat.print.*`, `ledger.repeat.*`, `grades.repeat.*`, `home.repeat.*`, `journal.log.repeat.*`; новые коды — `error.repeat_closed`, `error.deadline_passed` — во всех трёх словарях (`tests/i18n.test.js`). Кнопка, которая шлёт запрос, занята до ответа; ответ, пришедший после ухода со страницы, ничего не рисует (приём «владелец состояния + билет», как в `views/grades.js`); несохранённый ввод и уход — вопрос; ошибка сервера — текстом в окне, окно не закрывается. Вид — как у «Ведомостей» и «Гос. экзаменов»: карточки, таблицы с метками состояний, переменные `site/css/app.css`.

---

### Task 9 (Э): «Повторный курс» деканата — список, «Записать на повтор», правка, отмена — блок 1

Проверка ИИ — **да** (данные студентов, права).

**Files:** Create `site/js/repeat.js`, `site/js/views/repeats.js`, `site/js/views/repeatEnrol.js`, `site/js/views/repeat.js` (карточка: шапка, прежний результат, правка и отмена; ввод баллов — задача 10), `tests/siteRepeat.test.js`. Modify `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `repeat.list`, `repeat.get`, `repeat.candidates`, `repeat.enrol`, `repeat.save`, `repeat.cancel` (задача 4).

**Produces:**

```js
// site/js/router.js: '#/repeats' при праве repeat.list -> { view: 'repeats', params: {} }; '#/repeat/<id>' при праве repeat.get -> { view: 'repeat', params: { repeatId } } (id через idOf)
// site/js/shell.js, navFor: контора — после «Ведомостей» { name: 'repeats', href: '#/repeats', textKey: 'repeat.title', icon: 'sheet', hintKey: 'repeat.hint' };
//   преподаватель — после «Ведомостей» тот же адрес с textKey 'repeat.mine.title'; вид 'repeat' подсвечивает пункт 'repeats'
// site/js/repeat.js (без DOM)
export const REPEAT_STATES = ['all', 'open', 'overdue', 'passed', 'failed', 'cancelled'];
export function stateOf(row);                      // 'overdue' (open и overdue) | row.status
export function stateBadge(row);                   // -> { key: 'repeat.state.<stateOf>', tone }: open primary, overdue warning, passed success, failed danger, cancelled neutral
export function filterOptions(repeats);            // -> { groups: [название…], subjects: [название…] } без повторов, по алфавиту
export function filterRepeats(repeats, { group = '', subject = '', state = 'all', own = false });
export function prevLine(prev, split);             // прежний результат одной строкой -> { key, params }: 'repeat.prev.done' { total, max, semester, exam } |
                                                   // 'repeat.prev.notAdmitted' { semester } | 'repeat.prev.absent' { semester } | 'repeat.prev.incomplete' { semester }
export function totalLine(view);                   // итог повтора -> { key, params, tone, word } | null: status 'done' -> 'repeat.total' или 'repeat.total.preliminary' (карточка open),
                                                   // params { total, max: split.semester + split.exam }, tone и word — по слову; 'not_admitted' -> 'repeat.total.notAdmitted'; иначе null
export function enrolDraft(candidate, subject, today);   // -> { kind: candidate.suggest || 'full', orderNo: '', orderDate: today, deadline: '', teacherId: subject.teacherId }
```

Экраны:

- **«Повторный курс» (`#/repeats`).** Таблица: студент, группа, предмет и семестр по плану, вид, приказ, срок, преподаватель повтора, состояние (метка), итог. Фильтры: группа, предмет, состояние (в том числе «срок вышел»). Сотрудник `dean,teacher` в роли «Преподаватель» видит только `own`. Кнопка «Записать на повтор» — при `can.enrol`. Пусто — «Повторников нет». Строка → `#/repeat/<id>`. Проректор — без кнопок.
- **«Записать на повтор»** (окно, три шага в одном окне): предмет (поиск по названию и группе; список — `repeat.candidates` без параметра) → полугодие, если их несколько, и студент (список — `repeat.candidates` с `subjectId`: ФИО и прежний результат строкой `prevLine`; у занятого — «повтор уже идёт», выбрать нельзя; у кого остались пересдачи — «остались пересдачи: N») → вид (подсказка «не допущен — весь предмет»; «только экзамен» у не допущенного недоступен), номер и дата приказа, срок, преподаватель повтора (по умолчанию преподаватель предмета). Ошибки полей — под полями. После записи открывается карточка.
- **Карточка (`#/repeat/<id>`), часть этой задачи:** шапка — студент, группа, предмет, семестр по плану, вид, приказ, срок, преподаватель повтора, метка состояния; блок «Прежний результат» — семестр, допуск, попытки экзамена (дата и результат), итог и слово; пометка «из прошлого повтора» при `prev.fromRepeat`. При `can.edit` — «Изменить» (окно: приказ, срок, преподаватель); при `can.cancel` — «Отменить запись» (окно с обязательной причиной). «Срок вышел» — жёлтая строка «Срок вышел: баллы не ставятся, пока деканат не продлит срок».

- [ ] **Step 1: тесты** (`tests/siteRepeat.test.js`, `router.test.js`, `ui.test.js`, `i18n.test.js`): `stateOf` и `stateBadge` для пяти состояний; `filterRepeats` — по группе, предмету, `overdue`, `own`; `filterOptions` без повторов; `prevLine` для четырёх статусов (`max` — из `split`, цифр 100 в коде нет); `totalLine` — открытая карточка с итогом 75 → `repeat.total.preliminary`, `{ total: 75, max: 100 }`, тон `warning`; закрытая `passed` 80 → `repeat.total`, тон `primary`; `not_admitted`; нет попыток → `null`; со `split` 50 / 50 — `max: 100`; `enrolDraft` — `suggest: 'full'` и `null`; маршруты `#/repeats`, `#/repeat/rp1`, `#/repeat/%E0%A4%A` (не найден), без права — `home`; `navFor` — новый пункт у конторы и у преподавателя, у студента нет; ключи во всех трёх словарях.
- [ ] **Step 2:** падает. **Step 3:** написать.
- [ ] **Step 4: проверка на стенде** (`npm run dev:reset`, headless Chrome, обе темы, 1366 px): `dean` — список из четырёх карточек, фильтр «срок вышел» оставляет одну; «Записать на повтор» → «Анатомия · 02-1» → S2009, «весь предмет», приказ, срок → карточка открылась, в списке пять; у S2007 в окне записи нет, у S2005 «повтор уже идёт»; «Изменить» срок у карточки S2008 → метка «идёт»; «Отменить запись» только что созданной → «отменён»; `prorector` — список без кнопок; `teacher1` — «Повторников нет»; `<script>` в номере приказа виден текстом. `npm test` зелёное.
- [ ] **Step 5:** скриншоты в `.superpowers/sdd/plan-povtornyi-kurs/task-9-shots/`: список (тёмная и светлая), три шага окна записи, карточка с прежним результатом, окно отмены.
- [ ] **Step 6:** коммит `feat: the deanery screen of repeat courses - the list, enrolling, editing and cancelling`.

---

### Task 10 (Э): карточка повтора у преподавателя — работы, экзамен, закрытие; «Мои повторники» — блок 1

Проверка ИИ — **да** (права, баллы).

**Files:** Modify `site/js/repeat.js`, `site/js/views/repeat.js`, `site/js/views/repeats.js` (заголовок «Мои повторники» у преподавателя), `site/js/views/home.js` (блок преподавателя), `site/js/i18n/*.js`, `site/css/screens.css`, `tests/siteRepeat.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `repeat.get`, `repeat.saveWorks`, `repeat.saveAttempt`, `repeat.close`, `repeat.reopen` (задача 5); `repeat.list` (блок на главной); `attemptLabel`, `examModeOf`, `wordTone` (`site/js/ledger.js`).

**Produces:**

```js
// site/js/repeat.js
export function worksState(view);        // блок работ -> { show: view.kind === 'full', value, note, max: view.split.semester, edit: view.can.works, needReason: Number.isInteger(view.works.value) }
export function admissionLine(view);     // -> { key, params, tone } | null: 'full' с числом работ: допущен -> 'repeat.admission.yes' success;
                                         // иначе 'repeat.admission.low' { need: split.admission } danger; работ нет -> null; 'exam' -> null
export function attemptForm(view);       // что предлагает блок экзамена -> null | { no, retake, commission, canEnter } :
                                         // result.next === null или не допущен -> null; canEnter = can.attempt && (!next.commission || can.commission)
export function fixTarget(view);         // последняя попытка, которую можно исправить -> { no, … } | null (can.attempt; попытку с комиссией — только при can.commission)
export function closeNote(view);         // -> { key, params, tone } | null: закрыт -> 'repeat.closed.<status>' { date, name }; blocking[0] -> 'repeat.block.<code>' warning;
                                         // retakesLeft -> 'repeat.close.retakesLeft' warning; иначе -> 'repeat.close.ready.<outcome>' neutral
export function canClose(view);          // can.close && (blocking.length === 0 || can.force)
export function homeRepeats(repeats);    // блок главной преподавателя -> { open, overdue } по своим (own) карточкам; оба 0 -> блока нет
```

Экраны:

- **«Мои повторники»** — тот же `#/repeats`, у преподавателя без фильтра преподавателя и без кнопки записи. На главной преподавателя — блок «Мои повторники: N (срок вышел: M)» со ссылкой, только когда карточки есть (один запрос `repeat.list`).
- **Карточка, блок «Работы повтора»** (только «весь предмет»): поле числа «из 60» (максимум — `split.semester`) и пояснение «что сделано»; «Сохранить»; при изменении уже стоящего числа — поле причины. Под полем — `admissionLine`: «К экзамену повтора допущен» или «Не допущен: нужно больше 30».
- **Блок «Экзамен повтора»:** у «только экзамен» над ним строка «Семестр (прежний): 38 из 60». Список попыток (дата, какая по счёту, результат, состав комиссии). «Внести результат» / «Пересдача» / «Пересдача комиссией» — окно: дата, баллы «из 40» (`split.exam`), либо «не явился(ась)», либо «I»; у комиссии — состав. Преподавателю без роли конторы вместо третьей сдачи — текст «Сдачу комиссией вносит деканат». «Исправить» у последней попытки — то же окно с причиной.
- **Итог:** `totalLine` — «Итог повтора: 75 из 100 · удовл.» (пока идёт — «предварительно»), рядом мелко прежний итог.
- **Закрытие:** кнопка «Закрыть повтор» при `canClose`; если мешает — текст `closeNote` вместо кнопки («Не поставлены работы», «Нет результата экзамена», «Последняя попытка — I»). Окно: «Закрыть повтор? Результат: сдал / не сдал»; при `retakesLeft` — строка «Сдачи ещё остались» и галочка «Понимаю, закрыть» (запрос с `acceptFail: true`). У закрытого — «Сдал, закрыт 20.01 — ФИО». «Открыть заново» (при `can.reopen`) — окно с обязательной причиной.
- После любого действия карточка перерисовывается из ответа, без второго запроса.

- [ ] **Step 1: тесты:** `worksState` — «весь предмет» без числа (`needReason: false`), с числом (`true`), «только экзамен» (`show: false`), `max` 50 при `split` 50 / 50; `admissionLine` — 31 → `yes`, 30 → `low` с `{ need: 30 }`, без числа → `null`; `attemptForm` — первая сдача, пересдача, комиссия у преподавателя (`canEnter: false`) и у деканата (`true`), `next: null` → `null`; `fixTarget` — последняя из двух, попытка с комиссией у преподавателя → `null`; `closeNote` — пять случаев; `canClose` — блокировка без `force` → `false`, с `force` → `true`; `homeRepeats` — считает только `own`, отменённые и закрытые не входят; ключи `repeat.card.*`, `repeat.block.*`, `repeat.admission.*`, `home.repeat.*` в трёх словарях, в текстах с баллами есть `{max}` или `{need}`, цифр 60, 40, 30 нет.
- [ ] **Step 2:** падает. **Step 3:** написать.
- [ ] **Step 4: проверка на стенде** (`npm run dev:reset`; 1366 px и 900 px, обе темы): `teacher2` — на главной блок «Мои повторники: 3», список из трёх; карточка S2005: изменить работы без причины — ошибка, с причиной — сохранено; «Внести результат» 30 → «Итог повтора … предварительно»; «Закрыть повтор» → «Сдал»; двойное нажатие «Сохранить» и «Закрыть повтор» — один запрос (вкладка сети); карточка S2006: «Закрыть повтор» → «Сдал»; `teacher3` — карточка S2008: поля недоступны, «Срок вышел»; `dean` продлевает срок → у `teacher3` поля доступны; работы 30 → «Не допущен», кнопки экзамена нет, «Закрыть повтор» → «Не сдал»; `teacher1` по адресу чужой карточки — «Нет доступа»; `admin` — «Открыть заново» с причиной; уход с несохранённым числом — вопрос. `npm test` зелёное.
- [ ] **Step 5:** скриншоты в `task-10-shots/`: главная преподавателя с блоком; карточка «весь предмет» с работами и экзаменом; окно попытки; окно закрытия с галочкой; карточка «срок вышел»; закрытая карточка у администратора.
- [ ] **Step 6:** коммит `feat: the teacher of a repeat course enters the works and the exam and closes it; my repeat students on the home screen`.

---

### Task 11 (Э): «Лист повторного курса» A4, пометка в ведомости, строки «Журнала изменений» — блок 1

Проверка ИИ — не нужна (владелец принимает блоком).

**Files:** Modify `site/js/repeat.js`, `site/js/views/repeat.js`, `site/js/ledger.js`, `site/js/views/ledger.js`, `site/js/journal.js` (`logLine`), `site/js/i18n/*.js`, `site/css/screens.css` (раздел `@media print` — только если прежних правил `print-sheet` не хватает), `tests/siteRepeat.test.js`, `tests/siteLedger.test.js`, `tests/siteJournal.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `printSheet(host, sheet, orientation)` (`site/js/print.js`; структура листа — как у `examSheet` в `site/js/ledgerFile.js`); строка студента `ledger.get` с ключом `repeat` (задача 6); строки `journal.log` с `entity: 'repeat'`.

**Produces:**

```js
// site/js/repeat.js
export function repeatSheet(view, labels);
// -> { college, title, draft, facts, head, merges: [], body, low: [], counts: null, retakes: null, signs }
// college — view.collegeName (пусто — строки нет); title — labels.title («Лист повторного курса»); draft — labels.draft, пока карточка open, иначе ''
// facts по порядку: студент, группа, курс, дисциплина, семестр по плану, вид повтора, приказ (№ и дата), срок, преподаватель повтора,
//   прежний результат (семестр, экзамен, итог, слово одной строкой), работы повтора («45 из 60» и пояснение; у «только экзамен» — «Семестр (прежний): 38 из 60»),
//   итог повтора и слово, результат («сдал» / «не сдал»; пока идёт — '')
// head: [[№, дата, результат, комиссия]]; body — попытки экзамена повтора (баллы — числом, «не явился(ась)» и «I» — словами); попыток нет — одна пустая строка
// signs: «Преподаватель ____________ / ФИО преподавателя повтора», «Декан ____________»
// site/js/ledger.js
export function repeatBadge(student);     // строка ведомости -> null | { key: 'ledger.repeat.open' | 'ledger.repeat.passed' | 'ledger.repeat.failed', params: { total }, tone, draft: !student.repeat.main }
// site/js/journal.js, logLine: entity 'repeat' -> 'journal.log.repeat.enrol' { kind } | '.orderNo' | '.orderDate' | '.deadline' | '.teacher' | '.works' | '.try' { no, before, after } | '.status' { before, after }
//   (вид, состояния, «не явился(ась)», «I» — ключами словаря через keyParams; пустое «было» — «—»)
```

Экраны:

- **Печать:** кнопка «Печать листа» на карточке у всех, кто её читает. A4 книжная, один лист; пока повтор идёт — слово «Предварительный»; меню и кнопки не печатаются; букв A–F нет.
- **Ведомость (текущее полугодие):** у студента с карточкой рядом с итогом — метка «повтор» и итог повтора: «повтор: 75 (предварительно)», «повтор: 80 · сдал», «повтор: не сдал»; прежний итог остаётся на месте; кнопки «Пересдача» у такого студента нет. Печать и Excel ведомости не меняются (тест: `ledgerSheet` и `examSheet` на виде с `repeat` дают тот же результат, что без него).
- **«Журнал изменений»:** строки повтора читаются словами: «Записан на повторный курс: весь предмет», «Работы повтора: 45 → 50», «Экзамен повтора, сдача 1: 30», «Повтор закрыт: сдал», «Срок повтора: 01.02.2027 → 01.03.2027».

- [ ] **Step 1: тесты:** `repeatSheet` на виде «весь предмет» с работами 45, попыткой 30, закрытом `passed`: `draft === ''`, в `facts` 13 строк в названном порядке, баллы в `body` — типа `number`, подпись с ФИО преподавателя повтора; открытая карточка без попыток — `draft` непуст, в `body` одна пустая строка; «только экзамен» — строка прежнего семестра вместо работ; без названия колледжа — `college` пуст; ФИО `'=СУММ(A1)'` и `<script>` остаются текстом; `repeatBadge` — четыре случая (нет карточки → `null`); `logLine` — по одному ожиданию на каждое поле, неизвестное поле → `journal.log.other`; ключи `repeat.print.*`, `ledger.repeat.*`, `journal.log.repeat.*` в трёх словарях.
- [ ] **Step 2:** падает. **Step 3:** написать.
- [ ] **Step 4: проверка на стенде** (`npm run dev:reset`): headless Chrome `--print-to-pdf` карточки S2007 под `dean` — PDF книжный, одна страница, без меню и кнопок, шапка, прежний результат, работы, попытка, итог, подписи; карточка S2005 — со словом «Предварительный»; ведомость «Анатомии» 02-1 под `dean` — у четырёх студентов метка «повтор», у S2007 «сдал»; «Журнал изменений» под `dean` — строки повтора словами; под `teacher2` по своему предмету строк повтора нет. PDF — во временную папку. `npm test` зелёное.
- [ ] **Step 5:** скриншоты в `task-11-shots/`: страница PDF закрытого и идущего повтора; ведомость с метками; «Журнал изменений».
- [ ] **Step 6:** коммит `feat: the repeat course sheet prints on A4; the ledger marks repeat students; the change log reads repeat lines`.

**Стоп — блок 1 (после задачи 11).** Что посмотреть владельцу (стенд `journal-dev-reset`): 1) `dean` → меню «Повторный курс»: четыре повторника «Анатомии» 02-1, фильтр «срок вышел»; 2) «Записать на повтор» → «Анатомия · 02-1» → студент с «неуд.» → «весь предмет», приказ, срок; 3) карточка: прежний результат, «Изменить» срок, «Отменить запись»; 4) `teacher2` → главная: «Мои повторники»; карточка первого студента: работы с пояснением, «Внести результат», «Закрыть повтор»; 5) `teacher3` → карточка «срок вышел»: поставить ничего нельзя; `dean` продлевает срок; 6) `dean` → карточка → «Печать листа»; 7) `dean` → «Ведомости» → «Анатомия · 02-1»: метки «повтор»; «Журнал изменений»: строки повтора; 8) `dean` → «Настройки семестра» → переключить на второе полугодие → «Повторный курс»: все повторники на месте, запись ещё одного студента за прошлое полугодие проходит; 9) `prorector` — видит список и карточки, кнопок нет; `teacher1` — «Повторников нет». Заметки — в `замечания.md`, правки — одному агенту, проверка — только блока 1.

---

### Task 12 (Э): студент — карточка на главной, «Повторный курс» в «Оценках» — блок 2

Проверка ИИ — **да** (данные студента).

**Files:** Modify `site/js/repeat.js`, `site/js/views/home.js` (главная студента), `site/js/views/grades.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/siteRepeat.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `repeat.mine` (главная), `student.grades` → `repeats`, `subjects[].repeat` (задача 6); `attemptLines` (`site/js/ledger.js`); `wordTone`.

**Produces:**

```js
// site/js/repeat.js
export function studentCard(item, split);
// карточка студента -> { title: item.subjectName, lines: [{ key, params, tone, word? }] } по порядку:
//   вид ('grades.repeat.kind.full' | '.exam'); приказ { no, date }; срок { date } (overdue — tone 'warning', ключ 'grades.repeat.overdue');
//   преподаватель { name }; работы { value, max: split.semester } и пояснение (только 'full' и когда число стоит; иначе 'grades.repeat.worksNone');
//   у 'exam' — прежний семестр { value: prev.semester, max: split.semester }; попыток нет — 'grades.repeat.examNone';
//   итог: open с итогом — 'grades.repeat.totalPreliminary' { total, max }; passed / failed — 'grades.repeat.total' { total, max } со словом, либо 'grades.repeat.failedNoTotal';
//   последней строкой — прежний итог мелко: 'grades.repeat.prev' { total, max } | 'grades.repeat.prevNone'
export function finalWithRepeat(subject, split);
// «Оценки», итог предмета -> null (нет subject.repeat) | { key: 'grades.repeat.main' | 'grades.repeat.pending', params: { total, max }, tone, word }
//   main — итог повтора главный (repeat.main): показывается вместо прежнего итога с пометкой «повторный курс», прежний — мелко рядом; pending — прежний главный, повтор «идёт»
export function homeRepeat(repeats);     // главная студента -> null (нет идущих) | { count, nearest: { subjectName, deadline, overdue } } по идущим карточкам, ближайший срок первым
```

Экраны (телефон 360 px, обе темы):

- **Главная студента:** карточка «Повторный курс» под объявлениями — только когда есть идущий повтор: предмет, срок («до 01.02.2027» или «срок вышел»), ссылка-кнопка «Подробнее» (`#/grades`). Один запрос `repeat.mine`.
- **«Оценки»:** внизу списка предметов (над гос. экзаменами) — блок «Повторный курс»: по карточке на повтор (`studentCard`), попытки — `attemptLines`. В предмете, у которого есть `repeat`: после закрытия повтора — «Итог: 80 из 100 · хорошо · повторный курс», прежний итог мелко; пока идёт — прежний итог и строка «Повторный курс идёт». Состава комиссии и слова «заявка» нет.

- [ ] **Step 1: тесты:** `studentCard` — «весь предмет» с работами 45 и попыткой 30, открытая: строки в названном порядке, итог `totalPreliminary` `{ total: 75, max: 100 }`, последняя строка `grades.repeat.prev` `{ total: 58, max: 100 }`; закрытая `failed` без итога (не допущен) — `failedNoTotal`; «только экзамен» — строка прежнего семестра; просроченная — `overdue`; `finalWithRepeat` — нет карточки → `null`, `main: true` → `grades.repeat.main` с тоном слова, `main: false` → `pending`; `homeRepeat` — закрытые не считаются, ближайший срок первым; со `split` 50 / 50 максимумы 50 и 100; ключи `grades.repeat.*`, `home.repeat.*` в трёх словарях, цифр 60, 40, 100 в текстах нет.
- [ ] **Step 2:** падает. **Step 3:** написать.
- [ ] **Step 4: проверка на стенде** (`npm run dev:reset`; headless Chrome 360×740, обе темы): `S2005` — на главной карточка «Повторный курс», в «Оценках» блок с работами, без экзамена; `S2006` — «предварительно»; `S2007` — на главной карточки нет (повтор закрыт), в «Оценках» у «Анатомии» «Итог … · повторный курс» и прежний итог мелко; `S2008` — «срок вышел»; `S2001` — блока нет; после переключения семестра под `dean` у `S2005` блок на месте. Страница не прокручивается по горизонтали; в ответах `student.grades` и `repeat.mine` (вкладка сети) нет чужих ФИО и состава комиссии. `npm test` зелёное.
- [ ] **Step 5:** скриншоты в `task-12-shots/` (360 px): главная с карточкой; «Оценки» с блоком идущего повтора; закрытый повтор с новым итогом; «срок вышел».
- [ ] **Step 6:** коммит `feat: a student sees the own repeat course on the home screen and in the grades`.

**Стоп — блок 2 (после задачи 12).** Что посмотреть владельцу (стенд `journal-dev-reset`, узкое окно или телефон): 1) `S2005` → главная: карточка «Повторный курс» со сроком; 2) `S2005` → «Оценки»: блок «Повторный курс» — вид, приказ, срок, работы; 3) `S2007` → «Оценки» → «Анатомия»: новый итог с пометкой «повторный курс», прежний мелко; 4) `S2008` → «срок вышел»; 5) `S2001` — ничего о повторе нет; 6) под `teacher2` поставить `S2005` экзамен и закрыть повтор → у `S2005` итог изменился. Заметки — в `замечания.md`, правки — одному агенту, проверка — только блока 2.

---

### Task 13 (координатор и владелец): общая проверка, выкладка на тестовый

- [ ] **Step 1: общая проверка** — opus, строго, диапазон от коммита плана до `HEAD`, по Review Focus 1–5, с пробными скриптами во временной папке сессии. Обязательные пробы: каждое действие `repeat.*` каждой ролью и без входа, со снимком таблиц; чужой повтор всеми способами Review Focus 1; поиск чужих id, ФИО, баллов и состава комиссии во всех ответах студенту; числа раздела «Правила расчёта» и те же случаи с настройками 50 / 50 / 25; поиск чисел 60, 40, 30, 80, 90 как правил в `core/repeat.js`, `backend/repeat*.js`, `site/js/repeat.js`, `site/js/views/repeat*.js`; снимок до и после переключения семестра на данных стенда **и** после «Создать расписание» нового полугодия и утверждения новой версии силлабуса прошлого полугодия; шесть прежних таблиц не меняются ни одним `repeat.*`; **проба отката из раздела «Откат» целиком на `b829763`**; настоящий сервер Node на временной базе юнита 6 — при запуске дописываются две таблицы, остальное не меняется; прежние тесты без правок, кроме названных в отчётах задач; `npm run build:gas`; все строки `minor (deferred)` журнала хода. Находки — в `.superpowers/sdd/plan-povtornyi-kurs/final-fix-brief.md` (если проверяющий не может писать файлы — сохраняет координатор).
- [ ] **Step 2:** одна волна исправлений **одним** агентом; повторная проверка тем же проверяющим — только этих правок.
- [ ] **Step 3:** короткий показ владельцу того, что изменила волна (если экраны). Новые кыргызские ключи (`repeat.*`, `ledger.repeat.*`, `grades.repeat.*`, `home.repeat.*`, `journal.log.repeat.*`, `error.repeat_closed`, `error.deadline_passed`) — в список на вычитку. Стенд остановить.
- [ ] **Step 4:** решения раздела «Решения плана» (с ответами владельца на вопросы 1–7) — в таблицу решений `aidlc-state.md`; `design.md` — статус «собрано»; `CLAUDE.md`, «Главные правила предметной области» — абзац «Повторный курс»; копия журнала хода — в `aidlc-docs/construction/povtornyi-kurs/sdd/ledger-snapshot.md`.
- [ ] **Step 5 (только по прямой просьбе владельца): выкладка на тестовый.** В папке сервера: `npm run serve:backup` → `npm run serve:stop` → `git -C "D:\Журнал колледжа — сервер" checkout --detach <принятый коммит>` → `npm run serve:start` (сервер сам сделает копию базы и допишет две таблицы) → `npm run serve:status` («работает») → `git push`. Записать выложенный и прежний (`b829763`) коммит в `aidlc-state.md`, раздел «Выкладка», вместе с абзацем «Что известно заранее» из раздела «Откат». **Назад** — тот же порядок на `b829763`; сайт возвращается новым коммитом-откатом (`git revert`), не `push --force`; `serve:demo-wipe` на прежнем коде не запускать. Пробные данные: по желанию владельца `serve:demo-wipe` на новом коде, чтобы на тестовом были пробные повторники. **Боевой не трогаем:** тег образа айтишнику не называется, пока владелец не проверит тестовый и не попросит сам.
- [ ] **Step 6: проверка на тестовом** (пробные люди): владелец под пробным деканатом записывает студента на повтор; под пробным преподавателем ставит работы и экзамен, закрывает; печатает лист; **с телефона** пробным студентом — карточка на главной и новый итог в «Оценках»; переключение семестра на тестовом — по желанию владельца (повторники остаются). Открытие списка или карточки дольше 2 секунд — находка.
- [ ] **Step 7:** обновить `aidlc-state.md`: доработка принята и выложена на тестовый; в «Что перенести» — **известные ограничения**: повторник в старой ведомости не виден после переключения семестра (только в «Повторном курсе»); снимок не пересчитывается — если после записи прежний результат исправили заявкой, в карточке остаётся число на момент записи; студенту с карточкой пересдача в прежней ведомости не добавляется; исправление баллов закрытого повтора — только через «Открыть заново» администратором; дней повтора в расписании, посещаемости и заданий на повторе нет; оплату журнал не проверяет; сам по сроку журнал повтор не закрывает; на запасном Apps Script запись карточки и строки журнала — не одна запись; «Оценки» студента читают на две таблицы больше.

---

## Вопросы плана владельцу

Только то, что меняет видимое владельцу; в плане стоит вариант «по умолчанию». Тексты простыми словами — в `owner-summary.md`.

1. **Пересдачи ещё не исчерпаны, а приказ о повторе есть.** По умолчанию: записать можно, журнал показывает «остались пересдачи: N»; после записи пересдача в старой ведомости этому студенту не добавляется. Вариант Б: записать нельзя, пока не использованы все три сдачи.
2. **«Только экзамен» для не допущенного.** По умолчанию: журнал не даёт, не допущенному — только «весь предмет». Вариант Б: даёт, решает деканат.
3. **Кто ставит работы и экзамен повтора.** По умолчанию: преподаватель повтора, а также деканат и администратор; третью сдачу комиссией — только деканат и администратор. Вариант Б: только преподаватель повтора.
4. **Записали на повтор по ошибке.** По умолчанию: деканат отменяет запись с причиной, пока нет ни работ, ни экзамена; запись остаётся в «Журнале изменений». Вариант Б: отменить нельзя, только закрыть «не сдал».
5. **Ошибка в баллах повтора.** По умолчанию: пока повтор идёт — исправляет тот, кто ставит, с причиной; после закрытия — только администратор открывает заново. Вариант Б: любое исправление — только через администратора.
6. **«Мои повторники» у преподавателя.** По умолчанию: пункт меню виден всегда (пусто — «Повторников нет») и блок на главной, когда они есть. Вариант Б: только блок на главной, пункта меню нет.
7. **Что видит студент.** По умолчанию: вид, номер и дату приказа, срок, преподавателя, работы с пояснением преподавателя, попытки экзамена, итог; состав комиссии не видит. Вариант Б: без номера приказа и без пояснения к работам — только баллы и срок.

# Доработка «Справочники, часть 2»: план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** деканат открывает студента или сотрудника и сразу видит, как у него дела (посещаемость, итоги юнитов, состояние предметов, задания, долги и повтор; что ведёт, нагрузка, что не заполнено, его неделя); в списках «Студенты» и «Сотрудники» — короткие цифры; в карточках группы и дисциплины — успеваемость. База не меняется.

**Architecture:** три новых запроса только для чтения — `dir.people` (цифры списков «Студенты» и «Сотрудники»), `dir.person` (карточка студента или сотрудника) и `dir.progress` (успеваемость для готовых карточек группы и дисциплины). Прежние `dir.list`, `dir.summary`, `dir.card` не меняются ни на байт. Числа берутся **теми же функциями, что журнал**: на каждый предмет текущей половины вызывается `journalView` (итоги юнитов, посещаемость, семестр, допуск), итог закрытой ведомости — `examRowsOf` + `subjectResult` (как `ledgerView`), долги прошлых половин — `halvesOf` + `halfResults`, повтор — `studentRepeats`. Правила без хранилища («под угрозой», долг, «не заполнено», средний) — в `core/progress.js`. Пары не досчитываются (`settleLessons` не вызывается), ничего не пишется, каждая таблица читается один раз. Сайт: новые колонки списков, новый экран `personCard` (`#/dir/students/<id>`, `#/dir/staff/<id>`), дополнения карточек группы и дисциплины, две мелочи.

**Tech Stack:** Node 24, ES-модули, `node --test`, сайт без сборки; новых зависимостей нет.

**Spec:** `aidlc-docs/construction/spravochniki-2/design.md` (согласован владельцем 26.11.2026 вместе с решениями координатора в «Правилах подсчёта»). Макеты — `.superpowers/sdd/spravochniki-2/mockups/`: `students-list.png`, `student-a.png` (карточка студента — вариант А; `student-b*.png` отклонены), `staff-list.png`, `staff-card.png`, `group-card.png`, `discipline-card.png`. Часть 1, которую доработка продолжает, — `aidlc-docs/construction/spravochniki/plan.md`. Общие правила — `CLAUDE.md`.

**Исходное состояние:** `HEAD af8f1bb`, `npm test` — **1459 тестов**, все зелёные (прогон 26.11.2026). Тестовый журнал: сервер `55c01bb`, сайт `506813b`. Боевой не трогаем.

**Порядок.** Сначала сверка плана (opus): имена, поля, ключи словарей, числа тестов и стенда — против готового кода; находки правит отдельный агент в этом файле. Затем задачи 1 → 8 строго по одной; после каждой `npm test` зелёное и `npm run build:gas` собирается. Задачи 1–5 (логика и сервер) — без остановки; после задачи 5 — итоги в `aidlc-state.md` и журнал хода, новый чат координатора (правило 6б). Задача 6 — **блок владельца 1**, остановка и приёмка на стенде по скриншотам. Задача 7 — **блок владельца 2**, остановка. Потом задача 8.

| № | Кто | Задача | Проверка ИИ |
| --- | --- | --- | --- |
| 1 | Л | Правила `core/progress.js`; права трёх запросов | облегчённая |
| 2 | С | `dir.progress`: успеваемость группы и дисциплины; общий счёт по предмету | **строгая** (данные студентов, числа журнала) |
| 3 | С | `dir.people` и `dir.person` студентов; пробы обхода | **строгая** (права, данные студентов) |
| 4 | С | `dir.people` и `dir.person` сотрудников; пробы обхода | **строгая** (права) |
| 5 | С | Данные стенда (под угрозой, долг, повтор); числа и скорость на стенде | облегчённая |
| 6 | Э | Колонки «Студенты» и «Сотрудники», успеваемость в карточках группы и дисциплины, две мелочи — **блок 1, остановка** | облегчённая (выход из окна «Изменить» затрагивает все справочники) |
| 7 | Э | Карточки студента и сотрудника — **блок 2, остановка** | **строгая** (данные студентов, кнопка «Изменить» у проректора и деканата) |
| 8 | — | Общая проверка (opus), одна волна исправлений, выкладка на тестовый только по просьбе владельца | — |

Модели: «Логика», «Сервер», «Экраны», проверяющий задач — sonnet; сверка плана и общая проверка — opus. Отчёт проверяющего — не длиннее 15 строк (вердикт и находки).

## Global Constraints

Памятки для агентов (`implementer-contract.md`, `reviewer-contract.md`, `rereview-contract.md`) копируются из `.superpowers/sdd/plan-sillabus-discipliny/` в `.superpowers/sdd/plan-spravochniki-2/` с этим разделом вместо прежнего раздела «Global constraints». Журнал хода — `.superpowers/sdd/plan-spravochniki-2/progress.md`, копия — `aidlc-docs/construction/spravochniki-2/sdd/ledger-snapshot.md`.

- `core/` и `backend/` без зависимостей из npm; обработчики синхронные; `handleRequest` никогда не бросает; ошибки — `AppError(code, { fields })`.
- Время — только `platform.now()`; «сегодня» — `localDate(platform.now())`, «сейчас» — `localTime(platform.now())` (Бишкек). Сайт часам устройства не доверяет: `today` и `time` берёт из ответа.
- Каждая таблица читается **не больше одного раза за запрос** (`store.list`); `store.get` — только проверка токена в `handleRequest` (не больше одного на запрос). `dir.people`, `dir.person`, `dir.progress` **ничего не пишут** ни в одну таблицу и не вызывают `settleLessons`, `readSettledRows`, `readLedgerRows` (они досчитывают и пишут); строки читаются своим `readSheets` (задача 2).
- **Числа — функциями журнала, новых формул нет.** Итоги юнитов, `semester`, `admitted`, посещаемость — из `journalView` (`backend/journalData.js`); итог закрытой ведомости — `subjectResult` с попытками `examRowsOf` (как `ledgerView`); прошлые половины — `halvesOf` / `halfResults` (`backend/repeatSnapshot.js`); повтор — `studentRepeats` (`backend/repeatData.js`). Новое считается только в `core/progress.js`: «под угрозой», средний, суммы посещаемости, долг, «не заполнено».
- **Пороги не пишутся в коде**: «удовл.» — `scheme.fair` (`readScheme`), допуск — `split.admission` (`readSplit`). Чисел 60, 40, 30 как правил нет ни в `core/`, ни в `backend/`, ни в `site/js/` (только значения по умолчанию в `core/scoring.js`). Цвет посещаемости 70 / 85 — правило экрана (решение координатора), константы в `site/js/dirInfo.js`.
- **Прежние ответы не меняются**: `dir.list`, `dir.summary`, `dir.card` и все остальные — те же байт в байт; новое — только в трёх новых запросах. Прежние тесты не правятся, кроме добавления новых строк (назвать в отчёте).
- Права: `dir.people` и `dir.person` — администратор, деканат, проректор, таблицы `students`, `staff`; `dir.progress` — они же, таблицы `groups`, `disciplines`. Преподавателю и студенту ничего нового. Проректор ничего не меняет: кнопки «Изменить» у него нет нигде; у деканата нет «Изменить» в карточке сотрудника (`dir.save:staff` — только администратор, как сейчас).
- `passwordHash`, `mustChangePassword`, `lang`, `login`, временные пароли в новых ответах не появляются: ответы собираются **по полям**, строки студентов и сотрудников целиком не копируются. Состав комиссии повтора в ответ не попадает (`studentRepeats` его уже не отдаёт).
- Сборка Apps Script чистая: в `core/*`, `backend/*.js`, `backend/handlers/*` нет `node:`, `require(`, `Buffer`, слова `process` (`tests/gasBundle.test.js`); `npm run build:gas` собирается.
- Любая фраза — через три словаря `site/js/i18n/{ru,ky,en}.js` с одинаковыми ключами (кыргызские — на вычитку); слова с числом — `tCount` с формами `one`, `few`, `many`, `other`. Готовые ключи переиспользуются там, где сказано.
- Данные с сервера — на страницу только текстом (`textContent`, помощники `site/js/ui.js`), никогда через `innerHTML`.
- Цвета — hex или rgb (без `oklch()`), из переменных `site/css/app.css`; две темы, каждый экран — в обеих; окно сотрудника 1366 px — без горизонтальной прокрутки страницы (таблица может прокручиваться внутри своей карточки).
- **Лаконично** (решение владельца 26.11.2026): без подзаголовков-пояснений и вводных абзацев, без подписей у полей, когда понятно без них; предупреждение — одно предложение; пустое — «—» или «нет».
- Настоящих людей нет нигде: ни в тестах, ни в отчётах, ни на скриншотах. `dev/data/real.json`, рабочий сервер (порт 5373) и папки `D:\Журнал колледжа — сервер`, `D:\Журнал колледжа — данные`, `C:\JournalBackups` агенты не открывают.
- Стенд — только порт 5273, свой (`npm run dev:reset`); стенд координатора перед экранными задачами остановлен. Браузер — только headless Chrome с временным профилем и `--disable-sync --disable-extensions`, **не Edge**. Процессы останавливаются **только по своему PID**, никогда по имени программы или заголовку окна.
- Коммиты на английском, только свои файлы по имени (не `git add -A`), `git status` после — чистый; строка `Co-Authored-By` — с моделью, которая писала коммит. `git push` и выкладка — только по прямой просьбе владельца.

## Review Focus

Пробы — попыткой обойти защиту; каждая закреплена тестом в задаче, которая владеет кодом.

1. **Чужие роли и таблицы.** `dir.people`, `dir.person`, `dir.progress` студентом (`t.a1`) и преподавателем (`t.teacher1`) — `forbidden`; без токена — `unauthorized`; у `dir.people` / `dir.person` `table` = `'groups'`, `'weekTemplate'`, `'__proto__'`, `['students']`, `5`, нет поля — `forbidden`; у `dir.progress` — `'students'`, `'rooms'`, те же мусорные — `forbidden`. Сотрудник `dean,teacher` и проректор — пускают. Ни одного `internal`. Тесты — задачи 2, 3, 4.
2. **Плохой id и неделя.** `id` массив, число, объект, `null`, `''` — `bad_request`; `'  '`, `' s1 '`, `'__proto__'`, `'constructor'`, неизвестный, id записи другой таблицы (группы в `students`, студента в `staff`), удалённой записи — `not_found`; у карточки сотрудника `from` `'2026-13-01'`, `5`, `''`, `null` — `bad_request` (у студента, группы и дисциплины `from` не читается). Тесты — задачи 2, 3, 4; на экране (задача 7) адрес с неизвестным id — прежний текст `t('error.not_found')` и «К списку».
3. **Ничего не пишется и читается по разу**, в том числе пока идёт пара с закончившимся окном отметки (её досчитал бы журнал): снимок всех таблиц до и после одинаков, `spy.writes` пуст, каждое значение `spy.lists` — 1, `get` — не больше 1 (токен). Тесты — задачи 2, 3, 4; `get` и скорость на стенде — задача 5.
4. **Чужие данные.** В JSON новых ответов нет `passwordHash`, `mustChangePassword`, `lang`, `login`, `tempPassword`, `commission`; в карточке одного студента нет ФИО другого; строки списков — только с перечисленными ключами (без ФИО). Отключённые студенты не входят в цифры группы и дисциплины. Тесты — задачи 2, 3, 4.
5. **Кнопки и сохранение.** Проректор: ни в одной карточке нет «Изменить», `dir.save` любой таблицы — `forbidden`; деканат: в карточке сотрудника нет «Изменить», `dir.save` `staff` — `forbidden`, в карточке студента — есть. Тесты сервера — задачи 3, 4; экран — задача 7 (скриншоты проректором и деканатом).
6. **Те же числа, что журнал.** На одних данных: посещаемость, пропуски, итоги юнитов, средний — как `journal.get` и «Оценки» (`student.grades`); итог закрытой ведомости — как `ledger.get` и `student.grades.final`; «под угрозой» меняется вместе с `scheme.fair` и `split.admission` из «Баллов и журнала». Тесты — задачи 2, 3.
7. **Тихие пропуски.** Студент без предметов текущей половины, предмет без силлабуса, предмет без юнитов, преподаватель без пар и без предметов, сотрудник без роли «преподаватель», отключённый студент, долг прошлой половины с повтором и без — ответ `ok`, пустое — `null`, `[]` или 0, а не ошибка. Тесты — задачи 2, 3, 4.

## Чего в доработке нет

Новых таблиц, колонок и строк «Настроек»; правки из карточки, кроме прежнего окна «Изменить»; прошлых полугодий в карточке студента (кроме строки «Долги»); чего-то нового преподавателю и студенту; печати, Excel, отправки родителям; поиска по новым колонкам (поиск списка — по-прежнему по ФИО и прежним полям); куратора группы и оборудования аудиторий.

## Решения плана, которые видят пользователи

Дизайн решил главное; ниже — то, что он оставил плану. У каждого — вариант по умолчанию; владелец может поправить на приёмке (простыми словами — `owner-summary.md`). Координатор переносит их в таблицу решений `aidlc-state.md` (задача 8).

| № | Решение | Почему |
| --- | --- | --- |
| 1 | **Путь показывается один раз — верхний** «Справочники › Группы»; в карточке (группы, аудитории, дисциплины, студента, сотрудника) слово справочника в нём — ссылка на список. Строка пути внутри карточки убрана; имя записи — заголовок карточки | дизайн: «остаётся верхний» |
| 2 | **«Назад» из окна «Изменить», открытого в карточке**, возвращает в карточку; «Отмена» и «Сохранить» тоже возвращают в карточку, не оставляя лишнего шага в истории (ещё одно «Назад» — в список). Окно «Изменить», открытое из списка, работает как раньше | дизайн, вторая мелочь |
| 3 | **«Не заполнено» — пары:** пары текущего семестра, которые уже закончились (90 минут от начала прошли), а в журнале стоят «не заполнена» или «просрочена» — их не отметили проведёнными. Пары, которые деканат сам отметил «не проведена», не считаются: решение по ним уже принято. Пара считается за тем, кто должен был её вести (с заменой) | дизайн: «прошли, а в журнале не проведены»; вопрос владельцу 1 |
| 4 | **«Не заполнено» — юнит:** все его пары (кроме отменённых) закончились, юнит не закрыт, а у активных студентов нет рубежного или СРС; строка «Анатомия · 03-1 · Юнит 1 — нет рубежного: 20, нет СРС: 20». Если максимум рубежного или СРС в «Баллах и журнале» — 0, этот столбец не требуется. Только предметы, которые сотрудник ведёт сейчас | дизайн, решение владельца 4 |
| 5 | **Состояние предмета словами:** «идёт», «под угрозой», «сдано 82», «неуд.», «не допущен», «не явился(ась)», «I», «нет экзамена» (ведомость закрыта, а сдачи нет — бывает у выбывшего) | дизайн, решение владельца 2 |
| 6 | **Метки в группе и дисциплине:** «под угрозой N», «неуд. N», «не допущ. N», «не явились N», «I N»; нулевые не показываются, все нули — «—». «Не явились» и «I» — отдельными метками, не внутри «неуд.» | решение владельца 6; честнее, чем прятать неявку в «неуд.» |
| 7 | **Предметы текущей половины:** предмет попадает в таблицу студента, если его семестр по плану (по силлабусу в силе или по проведённым парам, как в журнале) — этой половины года. Предмет без силлабуса и без проведённых пар с темами в карточку студента не попадает; в карточках группы и дисциплины его строка остаётся (часть 1) с «—» в новых колонках | дизайн, «Правила подсчёта» |
| 8 | **Средний** — целое число, округление как в журнале. У студента — среднее всех его выставленных итогов юнитов по всем предметам половины; у предмета — среднее его итогов; у группы и дисциплины — всех активных студентов | решение владельца 1 |
| 9 | **Задания:** «сдано» — принято (проверено), «ждёт проверки», «возвращено», «не сдано» — срок прошёл, ничего не сдано. Задания с ещё не наступившим сроком не считаются. Только задания этого семестра (срок не раньше начала семестра), как в «Заданиях» студента. Нет заданий — «нет» | макет `student-a` |
| 10 | **Долги:** по всем предметам, где у студента закрыта итоговая ведомость прошлой половины (в том числе в прежней группе); строка «Информатика · 2 семестр · неуд. · повтор записан» / «повтор не записан». Сданный повтор долг снимает; отменённая карточка не считается | дизайн, решение координатора |
| 11 | **Карточка группы:** плитки — прежние 4 и новые 3 (посещаемость, средний балл, студентов под угрозой), в два ряда; в «Предметах» — «Посещ.», «Средний» и метки; у первых 5 студентов — посещаемость и средний (макет); ФИО студентов и преподавателей — ссылки на их карточки | макет `group-card` |
| 12 | **Карточка дисциплины:** плитки «групп», посещаемость, средний, студентов под угрозой; в «Где идёт» — «Студентов», «Посещ.», «Средний», метки, «Юниты» (Ю1 закрыт, Ю2 идёт); блок «Юниты» — «Юнит 1 · закрыто 2 из 3 · средний 74» | макет `discipline-card` |
| 13 | **Сетка недели преподавателя** — как у аудитории (стрелки, «Эта неделя», выходной и зачётная неделя метками); в клетке «01-1 · Анатомия», ниже «ауд. 204», метки «Замена» / «Перенос»; клетка только с отменённой парой — пустая и мелко «отменена: 01-1 · Анатомия». Плитка «пар в неделю» — по шаблону, сетка — по настоящим парам | дизайн |
| 14 | **Список «Студенты»:** колонка «Статус» — «Не активен» / «под угрозой · 1 предмет» (жёлтая метка) / «Активен»; посещаемость красная ниже 70 %, жёлтая 70–84 %. **Список «Сотрудники»:** «Что ведёт» — названия через запятую, у кого нет — «—»; «Пар в неделю» — у кого нет предметов — «—» | макеты, решение координатора о цвете |
| 15 | Ссылка у непроведённой пары ведёт в журнал предмета (`#/journal/<subjectId>`), у юнита без оценок — в ведомость (`#/ledger/<subjectId>`) | дизайн оставил плану |
| 16 | Пока идёт пара с QR, цифры карточек могут на минуты отставать от журнала: эти запросы пары не досчитывают (как часть 1) | ничего не пишется |
| 17 | **Стенд:** новые вымышленные данные (двое под угрозой в 03-1, долг прошлой весны с повтором и без) — только на стенде (`dev`, `dev:reset`, `dev:lesson`), не в пробных данных тестового журнала (`serve:demo`) | тестовый журнал не меняем без просьбы |

## Скорость

Пилот — 3 группы × 22 студента, ~160 пар; на стенде каждый новый запрос должен отвечать быстрее 1 секунды (тест задачи 5), владелец требует «заметно меньше 2 секунд». Листов на запрос (запасной Google читает каждый лист один раз, как `ledger.get` — 19 листов):

| Запрос | Листов |
| --- | --- |
| `dir.people` студентов | 14 (`PROGRESS_SHEETS`) |
| `dir.person` студента | 18 (+ `subjectExams`, `examAttempts`, `repeats`, `repeatAttempts`) |
| `dir.people` сотрудников | 3 (`staff`, `subjects`, `weekTemplate`) |
| `dir.person` сотрудника | 1 без роли «преподаватель»; 16 с ней |
| `dir.progress` | 16 (+ `subjectExams`, `examAttempts`; у дисциплины + `disciplines` — 17) |

Если на Google карточка студента окажется медленной, блоки не урезаются молча: «Долги» и «Повторный курс» выносятся во второй запрос, который читает 6 листов и вызывается после первого (решение — владельцу, сейчас не делается: сайт ходит на сервер владельца).

## Откат

База не меняется: ни таблиц, ни колонок, ни строк «Настроек»; новые запросы только читают. Тестовый журнал сейчас: сервер `55c01bb`, сайт `506813b`.

- **Прежний сервер, новый сайт** (несколько минут выкладки или откат только сервера). Прежний сервер не знает `dir.people`, `dir.person`, `dir.progress` и не выдаёт их прав в `auth.me`. Два случая:
  - **после входа или перезагрузки страницы:** сайт новых запросов не зовёт — «Студенты» и «Сотрудники» без новых колонок и без строки о недоступности, ФИО не ссылки, адрес карточки человека ведёт на главную; карточки группы и дисциплины — как в части 1, без строки о недоступности; две мелочи (путь, «Назад») работают — они только на сайте; окно «Изменить» студента и сотрудника по адресу `#/dir/<students|staff>/<id>/edit` открывается по прежнему праву `dir.save`;
  - **старая сессия** (права с нового сервера ещё в памяти сайта): `dir.people` отвечает `bad_request` — список обычный с прежней строкой «Подробности сейчас недоступны: показан обычный список.»; карточка человека — текст ошибки, «Повторить» и «К списку»; `dir.progress` — карточка группы или дисциплины как в части 1 и одна строка «Успеваемость сейчас недоступна.».
  Оба случая — требование задач 6 и 7.
- **Новый сервер, прежний сайт:** прежний сайт новых запросов не зовёт и новых прав не знает; всё как раньше.
- **Откат целиком** — обычный порядок из `CLAUDE.md` на сервер `55c01bb` и сайт `506813b` (коммитом-откатом `git revert`, не `push --force`); копия базы для отката не нужна (данные не меняются), `serve:backup` перед выкладкой — как всегда. Общая проверка (задача 8) запускает прежний код `55c01bb` (`git archive` во временную папку сессии) на базе, по которой ходил новый код, и сверяет ответы прежних запросов.

## Файлы

```
core/progress.js              правила: состояние предмета, средний, суммы посещаемости, долг, «не заполнено», роли     новый
core/permissions.js           + dir.people, dir.person, dir.progress
backend/progressData.js       чтение листов, половина предмета, счёт одного предмета журналом                          новый
backend/dirProgress.js        ответ dir.progress (группа, дисциплина)                                                  новый
backend/dirPeople.js          ответы dir.people и dir.person: проверки входа и выбор таблицы                           новый
backend/dirStudents.js        список и карточка студента                                                               новый
backend/dirStaff.js           список и карточка сотрудника                                                             новый
backend/handlers/dir.js       + три действия
dev/seed.js  dev/server.js    seedProgress и параметр { progress } у seed
site/js/dirInfo.js            + помощники без DOM: проценты, тона, метки состояния и счётчиков, возврат из «Изменить»
site/js/views/personCard.js   карточки студента и сотрудника                                                           новый
site/js/views/weekGrid.js     сетка недели (вынесена из карточки аудитории)                                            новый
site/js/views/dirCard.js  directory.js  directoryConfig.js
site/js/router.js  main.js  shell.js  i18n/{ru,ky,en}.js  css/screens.css
tests/progress.test.js  dirProgressApi.test.js  dirStudentsApi.test.js  dirStaffApi.test.js  seedProgress.test.js   новые
tests/permissions.test.js  siteDirInfo.test.js  router.test.js   (только новые проверки)
```

Кто делает: **Л** — `journal-logic`, **С** — `journal-server`, **Э** — `journal-screens`. Общие файлы правит только задача, которая сейчас в работе.

---

### Task 1 (Л): правила и права

**Files:** Create `core/progress.js`, `tests/progress.test.js`. Modify `core/permissions.js`, `tests/permissions.test.js` (только новый `test`). **Проверка — облегчённая.**

**Interfaces — Consumes:** `semesterPoints` (`core/grades.js`); `pairEnd` (`core/dirInfo.js`); `inSemester`, `HOURS_PER_PAIR` (`core/topics.js`).

**Produces** (`core/progress.js`):

```js
export const PERSON_TABLES = ['students', 'staff'];
export const PROGRESS_TABLES = ['groups', 'disciplines'];
export const COUNTED_STATES = ['risk', 'fail', 'notAdmitted', 'absent', 'incomplete'];
export function meanOf(numbers);          // [] -> null; иначе Math.round(сумма / длина)
export function attendanceTotal(list);    // list — [{ marked, attended, absent }] (attendanceStats или их суммы) -> { marked, attended, absent, percent }
                                          // percent = marked > 0 ? Math.round(attended * 100 / marked) : null
export function subjectState(result, final, { scheme, split });
// result — { units: [{ total }], semester } (studentResults); final — null (итоговая не закрыта) или { status, total, word } (subjectResult)
// final !== null: status 'done' -> word === 'fail' ? 'fail' : 'passed'; 'not_admitted' -> 'notAdmitted'; 'absent' -> 'absent'; 'incomplete' -> 'incomplete'; иначе 'noExam'
// final === null: ни одного total !== null -> 'going'; semester <= split.admission или какой-то total < scheme.fair -> 'risk'; иначе 'going'
export function stateCounts(states);      // -> { risk, fail, notAdmitted, absent, incomplete } (прочие состояния не считаются)
export function figuresOf(items);         // items — [{ attendance: { marked, attended, absent }, units: [{ total }], state }]
                                          // -> { attendance: attendanceTotal(...), average: meanOf(все total !== null), risk: число state === 'risk' }
export function debtOf(row, cards);
// row — строка halfResults { status, word, total }; cards — карточки повтора этого студента, предмета и половины (любые состояния)
// null: status 'done' и word !== 'fail'; status 'none'; есть карточка со status 'passed'
// иначе { state: 'fail' | 'notAdmitted' | 'absent' | 'incomplete', total: row.total ?? null,
//         repeat: состояние последней неотменённой карточки (по createdAt, затем id) или null }
export function workCounts(items);        // [{ state, overdue }] (workState) -> { checked, submitted, returned, missing }; missing — state 'none' и overdue
export function pairEnded(pair, today, time);           // pair.date < today || (pair.date === today && pairEnd(pair) <= time)
export function unfilledPair(pair, { today, time, settings });  // status 'planned' && inSemester(pair.date, settings) && pairEnded(...)
export function unitGap({ unit, pairs, closedUnits, students, today, time, scheme });
// pairs — пары предмета { unit, status, date, startTime }; students — [{ left, units: [{ unit, control, self }] }]
// null: closedUnits.includes(unit); у юнита нет пар со status !== 'cancelled'; хоть одна такая не pairEnded
// иначе среди students с left === false: control — у скольких control === null (0, если scheme.control === 0), self — так же по self и scheme.self;
// оба 0 -> null; иначе { unit, control, self }
export function roleList(roles);          // 'dean, teacher' -> ['dean', 'teacher']: trim, без пустых и повторов, порядок как записан; не строка -> []
export function hoursOf(weekPairs);       // weekPairs * HOURS_PER_PAIR
```

Права (`core/permissions.js`, рядом с `dir.card`): `const PEOPLE = ['students', 'staff']`, `const PROGRESS = ['groups', 'disciplines']`; `'dir.people'` и `'dir.person'` — `{ admin: PEOPLE, dean: PEOPLE, prorector: PEOPLE }`, `'dir.progress'` — `{ admin: PROGRESS, dean: PROGRESS, prorector: PROGRESS }`.

- [ ] **Step 1: тесты** (`tests/progress.test.js`), `S = DEFAULT_SCHEME`, `X = DEFAULT_SPLIT` из `core/scoring.js`:

```js
const R = (totals, semester) => ({ units: totals.map((total) => ({ total })), semester });
const opt = { scheme: S, split: X };
assert.equal(subjectState(R([null, null], null), null, opt), 'going');
assert.equal(subjectState(R([84, null], 50), null, opt), 'going');
assert.equal(subjectState(R([84, 57], 42), null, opt), 'risk');                                    // юнит ниже «удовл.»
const low = { scheme: { ...S, fair: 40 }, split: X };
assert.equal(subjectState(R([50], 30), null, low), 'risk');                                         // семестр <= допуска
assert.equal(subjectState(R([52], 31), null, low), 'going');
assert.equal(subjectState(R([50], 25), null, { scheme: { ...S, fair: 40 }, split: { semester: 50, exam: 50, admission: 25 } }), 'risk');
assert.deepEqual(['done/good', 'done/fail', 'not_admitted/', 'absent/', 'incomplete/', 'none/'].map((k) => {
  const [status, word] = k.split('/');
  return subjectState(R([30], 18), { status, word: word || null, total: 82 }, opt);
}), ['passed', 'fail', 'notAdmitted', 'absent', 'incomplete', 'noExam']);                          // закрытая — итог ведомости, «под угрозой» не считается
assert.deepEqual(stateCounts(['risk', 'going', 'fail', 'fail', 'passed', 'notAdmitted', 'absent', 'incomplete', 'noExam']),
  { risk: 1, fail: 2, notAdmitted: 1, absent: 1, incomplete: 1 });
assert.equal(meanOf([]), null);
assert.equal(meanOf([84, 57]), 71);
assert.deepEqual(attendanceTotal([]), { marked: 0, attended: 0, absent: 0, percent: null });
assert.deepEqual(figuresOf([
  { attendance: { marked: 2, attended: 2, absent: 0 }, units: [{ total: 84 }, { total: null }], state: 'going' },
  { attendance: { marked: 4, attended: 1, absent: 2 }, units: [{ total: 57 }], state: 'risk' },
]), { attendance: { marked: 6, attended: 3, absent: 2, percent: 50 }, average: 71, risk: 1 });
assert.deepEqual(figuresOf([]), { attendance: { marked: 0, attended: 0, absent: 0, percent: null }, average: null, risk: 0 });
const C = (status, createdAt, id) => ({ id, status, createdAt });
assert.equal(debtOf({ status: 'done', word: 'good', total: 82 }, []), null);
assert.equal(debtOf({ status: 'none', word: null, total: null }, []), null);
assert.deepEqual(debtOf({ status: 'done', word: 'fail', total: 58 }, []), { state: 'fail', total: 58, repeat: null });
assert.deepEqual(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('failed', '2026-12-21 10:00:00', 'rp1'), C('open', '2027-02-10 10:00:00', 'rp2')]).repeat, 'open');
assert.equal(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('cancelled', '2026-12-21 10:00:00', 'rp1')]).repeat, null);
assert.equal(debtOf({ status: 'done', word: 'fail', total: 58 }, [C('failed', '2026-12-21 10:00:00', 'rp1'), C('passed', '2027-02-10 10:00:00', 'rp2')]), null);
assert.deepEqual(['not_admitted', 'absent', 'incomplete'].map((status) => debtOf({ status, word: null, total: null }, []).state), ['notAdmitted', 'absent', 'incomplete']);
assert.deepEqual(workCounts([{ state: 'checked' }, { state: 'submitted' }, { state: 'returned' }, { state: 'none', overdue: true }, { state: 'none', overdue: false }]),
  { checked: 1, submitted: 1, returned: 1, missing: 1 });
const P = (date, startTime, over = {}) => ({ date, startTime, status: 'planned', ...over });
assert.deepEqual([pairEnded(P('2026-09-15', '08:00'), '2026-09-15', '09:29'), pairEnded(P('2026-09-15', '08:00'), '2026-09-15', '09:30'),
  pairEnded(P('2026-09-15', '08:00'), '2026-09-16', '00:00'), pairEnded(P('2026-09-16', '08:00'), '2026-09-15', '23:59')], [false, true, true, false]);
const sem = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20' };
const un = (p) => unfilledPair(p, { today: '2026-09-30', time: '12:00', settings: sem });
assert.deepEqual(['planned', 'running', 'closed', 'missed', 'cancelled'].map((status) => un(P('2026-09-15', '08:00', { status }))), [true, false, false, false, false]);
assert.equal(un(P('2026-08-25', '08:00')), false);                                                   // вне дат семестра
const pairs = [P('2026-09-01', '08:00', { unit: 1, status: 'closed' }), P('2026-09-08', '08:00', { unit: 1 }), P('2026-09-29', '08:00', { unit: 2 }),
  P('2026-09-22', '08:00', { unit: 3, status: 'cancelled' })];
const st = (left, control, self) => ({ left, units: [{ unit: 1, control, self }] });
const students = [st(false, 30, 16), st(false, null, null), st(true, null, null)];
const gap = (over = {}) => unitGap({ unit: 1, pairs, closedUnits: [], students, today: '2026-09-30', time: '12:00', scheme: S, ...over });
assert.deepEqual(gap(), { unit: 1, control: 1, self: 1 });                                          // выбывший не считается
assert.equal(gap({ closedUnits: [1] }), null);
assert.equal(gap({ today: '2026-09-08', time: '09:00' }), null);                                    // пара юнита ещё не закончилась
assert.equal(gap({ unit: 3 }), null);                                                                // только отменённые пары
assert.equal(gap({ unit: 4 }), null);                                                                // пар нет
assert.equal(gap({ students: [st(false, 30, 16)] }), null);                                         // всё выставлено
assert.deepEqual(gap({ scheme: { ...S, current: 60, self: 0 } }), { unit: 1, control: 1, self: 0 }); // СРС не требуется
assert.deepEqual([roleList('dean, teacher'), roleList(''), roleList('teacher,,teacher'), roleList(undefined)], [['dean', 'teacher'], [], ['teacher'], []]);
assert.equal(hoursOf(7), 14);
```

`tests/permissions.test.js` (новый `test`): `can([admin|dean|prorector], 'dir.people'|'dir.person', 'students'|'staff')` — `true`; `can(['dean'], 'dir.person', 'groups')`, `'weekTemplate'`, `undefined`, `['students']` — `false`; `can([admin|dean|prorector], 'dir.progress', 'groups'|'disciplines')` — `true`; `can(['dean'], 'dir.progress', 'students')`, `'rooms'` — `false`; `can(['teacher'], …)` и `can(['student'], …)` всех трёх — `false`; `listPermissions(['prorector'])` содержит `'dir.person:staff'` и `'dir.progress:disciplines'`. Прежние `deepEqual` списков прав студента и преподавателя не меняются.

- [ ] **Step 2:** `node --test tests/progress.test.js tests/permissions.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: rules of the progress figures - state of a subject, debts, unfilled pairs and units; rights of dir.people, dir.person and dir.progress`.

---

### Task 2 (С): общий счёт предмета и `dir.progress`

**Files:** Create `backend/progressData.js`, `backend/dirProgress.js`, `tests/dirProgressApi.test.js`. Modify `backend/handlers/dir.js` (одно действие). **Проверка — строгая** (Review Focus 1–4, 6, 7).

**Interfaces — Consumes:** задача 1; `JOURNAL_TABLES`, `journalView`, `closedOfSubject` (`backend/journalData.js`); `examRowsOf` (`backend/ledgerData.js`); `subjectResult` (`core/exam.js`); `semesterHalf` (`core/syllabus.js`); `inSemester` (`core/topics.js`); `readSettings`, `readScheme`, `readSplit`; `compareNames`.

**Produces** (`backend/progressData.js`):

```js
export const PROGRESS_SHEETS = JOURNAL_TABLES.filter((name) => name !== 'units');   // 14 листов
export const EXAM_SHEETS = ['subjectExams', 'examAttempts'];
export function readSheets(store, names);
// { [name]: store.list(name) } — каждый лист один раз; units, subjectExams, examAttempts, repeats, repeatAttempts, которых нет в names, -> [].
// Только чтение: никакого settleLessons. (journalView берёт из units лишь заголовки юнитов — они новым ответам не нужны.)
export function halfOf(rows, subject, settings);
// planSemester из closedOfSubject(rows, subject, settings, пары предмета в датах семестра);
// null, если он null или semesterHalf(planSemester) !== settings.semester
export function subjectProgress(rows, platform, subject, user);
// user — администратор, деканат или проректор (journalView отдаёт им весь журнал).
// -> { subjectId, planSemester, units: [номера], closedUnits, finalClosed, pairs /* view.pairs */,
//      students: [{ id, left, units: [{ unit, total, control, self }], semester, attendance: { marked, attended, absent, percent }, state, total }] }
// students — view.students по порядку; числа — view.results[id]; finalClosed — view.closed.final;
// final = finalClosed ? subjectResult({ semester, admitted: admitted === true && Number.isInteger(semester), attempts: examRowsOf(rows, subject.id, planSemester).attempts.get(id) || [], scheme }) : null;
// state = subjectState(результат, final, { scheme, split }); total = final ? final.total : null
```

`backend/dirProgress.js`: `export function dirProgress(store, platform, user, data)`; в `dir.js`: `'dir.progress': (data, ctx, user) => dirProgress(ctx.store, ctx.platform, user, data)`.

Проверки входа (в этом порядке): `data` не объект — как `{}`; `table` не из `PROGRESS_TABLES` — `bad_request`; `id` не строка или `''` — `bad_request`; листы — `readSheets(store, [...PROGRESS_SHEETS, ...EXAM_SHEETS, ...(table === 'disciplines' ? ['disciplines'] : [])])`; запись — `rows[table].find((r) => r.id === id)` (никогда по ключу объекта), нет — `not_found`.

«Активные» — студенты предмета с `left === false` (в группе и `active === true`). Для предмета текущей половины (`halfOf !== null`): `attendance = attendanceTotal(активные.attendance).percent`, `average = meanOf(выставленные total активных)`, `counts = stateCounts(активные.state)`. Не текущей половины: `inHalf: false`, `attendance: null`, `average: null`, `counts` — пять нулей, `units: []`, `subjectProgress` не вызывается.

**Ответы** (ровно эти ключи):

```js
// группа: предметы группы по compareNames(name), затем id (как dir.card); students — активные студенты группы по compareNames(fullName), затем id
{ table: 'groups', id, semester /* settings.semester */,
  totals: { attendance, average, risk },          // attendance, average — по всем предметам половины и всем активным; risk — сколько студентов из students с хоть одним 'risk'
  subjects: [{ subjectId, inHalf, attendance, average, counts: { risk, fail, notAdmitted, absent, incomplete } }],
  students: [{ id, attendance, average }] }       // figuresOf по предметам половины этого студента (студента нет в журнале предмета — предмет пропускается)
// дисциплина: строки — предметы дисциплины по compareNames(имя группы), затем id
{ table: 'disciplines', id, semester,
  totals: { groups /* rows.length */, attendance, average, risk /* сумма counts.risk */ },
  rows: [{ subjectId, groupId, inHalf, students /* активных в группе по таблице students */, attendance, average, counts, units: [{ unit, closed }] }],
  units: [{ unit, groups, closedGroups, average }] }   // по строкам половины: groups — у скольких есть юнит, closedGroups — у скольких закрыт, average — meanOf итогов юнита активных; по unit
```

- [ ] **Step 1: тесты** (`tests/dirProgressApi.test.js`, на `setup()` из `tests/journalSetup.js`):

```js
s.at('2026-09-30'); s.unitNumbers();       // a1: 38+16+30 = 84, a2: 20+12+25 = 57, a3 без итогов; отметки: a1 2 из 2, a2 1 из 2 (не был 1), a3 0 из 2
const g = call('dir.progress', { table: 'groups', id: s.g1 }, t.dean).data;
assert.deepEqual(g.subjects, [{ subjectId: s.sb1, inHalf: true, attendance: 50, average: 71, counts: { risk: 1, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 } }]);
assert.deepEqual(g.totals, { attendance: 50, average: 71, risk: 1 });
assert.deepEqual(byId(g.students, s.a1), { id: s.a1, attendance: 100, average: 84 });
assert.deepEqual(byId(g.students, s.a2), { id: s.a2, attendance: 50, average: 57 });
assert.deepEqual(byId(g.students, s.a3), { id: s.a3, attendance: 0, average: null });
assert.deepEqual(g.students.map((x) => x.id), call('dir.card', { table: 'groups', id: s.g1 }, t.dean).data.students.map((x) => x.id));   // без a4, тот же порядок
const g2 = call('dir.progress', { table: 'groups', id: s.g2 }, t.dean).data;     // sb2 без силлабуса — не текущей половины
assert.deepEqual(g2.subjects, [{ subjectId: s.sb2, inHalf: false, attendance: null, average: null, counts: { risk: 0, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 } }]);
assert.deepEqual([g2.totals, g2.students], [{ attendance: null, average: null, risk: 0 }, [{ id: s.b1, attendance: null, average: null }]]);
const d = call('dir.progress', { table: 'disciplines', id: s.ds1 }, t.dean).data;
assert.deepEqual(d.rows, [{ subjectId: s.sb1, groupId: s.g1, inHalf: true, students: 3, attendance: 50, average: 71,
  counts: { risk: 1, fail: 0, notAdmitted: 0, absent: 0, incomplete: 0 }, units: [{ unit: 1, closed: false }, { unit: 2, closed: false }] }]);
assert.deepEqual(d.units, [{ unit: 1, groups: 1, closedGroups: 0, average: 71 }, { unit: 2, groups: 1, closedGroups: 0, average: null }]);
assert.deepEqual(d.totals, { groups: 1, attendance: 50, average: 71, risk: 1 });
```

`byId` — помощник файла. Ещё в этом файле:
- **Те же числа, что журнал:** `const j = call('journal.get', { subjectId: s.sb1 }, t.dean).data.journal`; по `j.students` с `left === false`: `meanOf` их `results[id].units[].total` (выставленных) === `g.subjects[0].average`; сумма `attended` / `marked` их `results[id].attendance` даёт `g.subjects[0].attendance`.
- **Пороги из настроек:** `call('scoring.save', { scheme: { ...DEFAULT_SCHEME, fair: 50 }, split: DEFAULT_SPLIT }, t.dean)` → `counts.risk` 0; затем `split: { semester: 60, exam: 40, admission: 50 }` (fair снова 60) → 2 (у a1 семестр 50 ≤ 50). Сохранение — до закрытия юнитов.
- **Закрытый юнит и итоговая:** `s.closeUnit(1)` → `d.rows[0].units[0].closed === true`, `d.units[0].closedGroups === 1`. Новый `setup()`, `s.failed()` → `g.subjects[0].counts` `{ risk: 0, fail: 1, notAdmitted: 1, absent: 0, incomplete: 0 }` и то же — по `call('ledger.get', { subjectId: s.sb1 }, t.dean).data.ledger.students` (`status` / `word`).
- **Отключённый не считается:** `store.update('students', s.a2, { active: false })` → `g.totals.risk === 0`, `d.rows[0].students === 2`, a2 нет в `g.students`.
- **Прежние ответы:** `Object.keys(call('dir.card', { table: 'groups', id: s.g1 }, t.dean).data).sort()` — ровно `['counts', 'group', 'now', 'semesterEnd', 'semesterStart', 'students', 'subjects', 'table', 'term', 'time', 'today']`; дисциплины — `['currentSemester', 'discipline', 'rows', 'syllabus', 'table']`.
- **Обход (Review Focus 1, 2):** `t.a1`, `t.teacher1` → `forbidden`; без токена → `unauthorized`; `t.dean` (`dean,teacher`), `t.prorector`, `t.admin` → `ok`; `table` `'students'`, `'rooms'`, `'__proto__'`, `['groups']`, `5`, нет поля → `forbidden`; `id` `[s.g1]`, `5`, `{}`, `null`, `''` → `bad_request`; `'  '`, `' ' + s.g1`, `'__proto__'`, `'constructor'`, `'g_none'`, `s.ds1` в `groups` → `not_found`. Ни одного `internal`.
- **Ничего не пишется (Review Focus 3):** `s.running(s.p0922, '2026-09-22 08:05:00')`, `s.at('2026-09-22', '09:00')` (окно отметки кончилось — журнал досчитал бы); для двух вызовов: снимок `{ ...s.snapshot(), ...` копии `store.list` листов `groups`, `students`, `staff`, `disciplines`, `subjects`, `syllabi`, `syllabusLines`, `topics` `}` до и после одинаков, `s.spy.writes` — `{}`, каждое значение `s.spy.lists` — 1.
- **Чужие данные (Review Focus 4):** в `JSON.stringify` ответов нет `passwordHash`, `mustChangePassword`, `lang`, `login`, `fullName`, `'Яковлев Улан'`.

- [ ] **Step 2:** `node --test tests/dirProgressApi.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: dir.progress - attendance, average and risk of a group and a discipline, read-only, the numbers of the journal`.

---

### Task 3 (С): `dir.people` и `dir.person` студентов

**Files:** Create `backend/dirPeople.js`, `backend/dirStudents.js`, `tests/dirStudentsApi.test.js`. Modify `backend/handlers/dir.js` (два действия). **Проверка — строгая** (Review Focus 1–7).

**Interfaces — Consumes:** задачи 1–2; `halvesOf`, `halfResults` (`backend/repeatSnapshot.js`); `studentRepeats` (`backend/repeatData.js`); `currentAttempt`, `workState` (`core/work.js`); `isCurrent` (`backend/workData.js`); `localDate`; `compareNames`.

**Produces:**

```js
// backend/dirPeople.js
export function dirPeople(store, platform, user, table);
export function dirPerson(store, platform, user, data);
// проверки: table не из PERSON_TABLES — bad_request; у dirPerson: data не объект — как {}; id не строка или '' — bad_request;
// у staff: from !== undefined && !isDate(from) — bad_request (до чтения листов); запись — rows.find((r) => r.id === id), нет — not_found.
// 'students' -> studentsList / studentCard (backend/dirStudents.js); 'staff' — в этой задаче bad_request, ветку добавляет задача 4.
// backend/handlers/dir.js:
'dir.people': (data, ctx, user) => dirPeople(ctx.store, ctx.platform, user, data.table),
'dir.person': (data, ctx, user) => dirPerson(ctx.store, ctx.platform, user, data),
// backend/dirStudents.js
export function studentsList(store, platform, user);           // читает PROGRESS_SHEETS
export function studentCard(store, platform, user, id);        // читает PROGRESS_SHEETS, EXAM_SHEETS, 'repeats', 'repeatAttempts'
```

Счёт: предметы студента — `rows.subjects` с `groupId === student.groupId` и `halfOf !== null`, по `compareNames(name)`, затем id; на предмет — один `subjectProgress` (в списке — один на предмет для всех студентов). Строка студента в предмете — `students.find((x) => x.id === id)`; студента там нет (отключён и без отметок) — пустая: `units` с `total: null` по `progress.units`, `attendance` нулями, `state: 'going'`, `total: null`.

**Ответы:**

```js
// dir.people, students — строки в порядке листа students, все (и отключённые), ровно эти ключи, без ФИО
{ table: 'students', semester, rows: [{ id, attendance /* percent | null */, average, risk }] }   // figuresOf по его предметам
// dir.person, students
{ table: 'students', today, semester,
  student: { id, fullName, cardNo, groupId, groupName, active: active === true },
  totals: { attendance /* percent */, absent, average, risk, repeats /* repeats.length */, debts /* debts.length */ },
  subjects: [{ subjectId, name, teacherName, planSemester, attendance: { percent, absent, marked }, units: [{ unit, total }], average /* meanOf итогов */, state, total }],
  works: [{ subjectId, name, checked, submitted, returned, missing }],
  debts: [{ subjectId, name, groupName, planSemester, state, total, repeat }],
  repeats: studentRepeats(rows, platform, id) }
// works — по предметам группы студента (любой половины) с заданиями isCurrent(a, settings): попытка — currentAttempt(сдачи студента), workCounts(workState(...));
//   предмет, где все четыре числа 0, не выводится; по name
// debts — по ВСЕМ предметам: halvesOf(rows, subject) с current === false -> строка студента в halfResults(rows, platform, subject, planSemester, user).students
//   -> debtOf(строка, карточки rows.repeats этого студента, предмета и половины); null — пропуск; по name, затем planSemester
```

- [ ] **Step 1: тесты** (`tests/dirStudentsApi.test.js`, на `setup()`):

```js
s.at('2026-09-30'); s.unitNumbers();
const list = call('dir.people', { table: 'students' }, t.dean).data;
assert.deepEqual(list.rows.map((r) => r.id), store.list('students').map((x) => x.id));
assert.deepEqual([byId(list.rows, s.a1), byId(list.rows, s.a2), byId(list.rows, s.a3), byId(list.rows, s.a4), byId(list.rows, s.b1)], [
  { id: s.a1, attendance: 100, average: 84, risk: 0 }, { id: s.a2, attendance: 50, average: 57, risk: 1 }, { id: s.a3, attendance: 0, average: null, risk: 0 },
  { id: s.a4, attendance: null, average: null, risk: 0 }, { id: s.b1, attendance: null, average: null, risk: 0 }]);
const c = call('dir.person', { table: 'students', id: s.a2 }, t.dean).data;
assert.deepEqual(c.student, { id: s.a2, fullName: 'Өмүров Канат', cardNo: 'A2', groupId: s.g1, groupName: '01-1', active: true });
assert.deepEqual(c.totals, { attendance: 50, absent: 1, average: 57, risk: 1, repeats: 0, debts: 0 });
assert.deepEqual(c.subjects, [{ subjectId: s.sb1, name: 'Информатика', teacherName: 'Иванова Нургуль', planSemester: 1,
  attendance: { percent: 50, absent: 1, marked: 2 }, units: [{ unit: 1, total: 57 }, { unit: 2, total: null }], average: 57, state: 'risk', total: null }]);
assert.deepEqual([c.works, c.debts, c.repeats], [[], [], []]);
```

Ещё в этом файле:
- **Те же числа, что журнал и «Оценки» (Review Focus 6):** для a1, a2, a3 — `units[].total`, `attendance.percent`, `attendance.absent`, `average` строки sb1 равны `journal.get` (`results[id].units[].total`, `results[id].attendance.percent` / `.absent`, `results[id].preliminary`); для a2 — то же по `call('student.grades', {}, t.a2).data.subjects` (предмет sb1). Новый `setup()`, `s.failed()`: состояние sb1 — a1 `'passed'` и `total` 82, a2 `'fail'` и 58, a3 `'notAdmitted'` и `null`; равны `ledger.get` (`students[].status`, `word`, `total`) и `student.grades` a1 и a2 (`final.status`, `final.total`).
- **Долги прошлой половины:** новый `setup()`, `s.failed()`, `s.switchSemester()` → у a2 `subjects: []`, `debts: [{ subjectId: s.sb1, name: 'Информатика', groupName: '01-1', planSemester: 1, state: 'fail', total: 58, repeat: null }]`, `totals.debts: 1`; у a3 — `state: 'notAdmitted'`, `total: null`; у a1 — `debts: []`. `s.repeatCard()` (a2, `open`) → `repeat: 'open'`, `totals.repeats: 1`, `repeats[0]` с `subjectName: 'Информатика'`, `status: 'open'`, `kind: 'full'`, `orderNo: '15-с'`; `s.repeatCard({ status: 'passed' })` → у a2 `debts: []`.
- **Задания:** `s.task()` (СРС юнита 2, срок 20.09) и `s.attempt(id, 'a2')` (ждёт проверки); `s.task({ title: 'СРС Б', dueAt: '2026-09-25 23:59:00' })` без сдачи; `s.task({ title: 'СРС В', dueAt: '2026-10-05 23:59:00' })` без сдачи → у a2 `works: [{ subjectId: s.sb1, name: 'Информатика', checked: 0, submitted: 1, returned: 0, missing: 1 }]`.
- **Тихие пропуски (Review Focus 7):** b1 — `subjects: []`, `totals: { attendance: null, absent: 0, average: null, risk: 0, repeats: 0, debts: 0 }`; a4 — `student.active: false`, ответ `ok`; темы силлабуса удалены (`store.removeMany('topics', темы s.syllabusId)`) → у a1 строка sb1 есть, `units: []`, `average: null`, `state: 'going'`.
- **Обход (Review Focus 1, 2, 5):** оба действия: `t.a1`, `t.teacher1` → `forbidden`; без токена → `unauthorized`; `t.dean`, `t.prorector`, `t.admin` → `ok`; `table` `'groups'`, `'weekTemplate'`, `'__proto__'`, `['students']`, `5`, нет поля → `forbidden`; `dir.person` с `id` `[s.a1]`, `5`, `{}`, `null`, `''` → `bad_request`; `'  '`, `' ' + s.a1`, `'__proto__'`, `'constructor'`, `'st_none'`, `s.g1` → `not_found`; `from: 'junk'` у студента — `ok`. Удалённый: новый студент без следов `dir.save` → `dir.remove` деканатом → `not_found`. `dir.save` студента проректором → `forbidden`, деканатом — `ok` (прежнее). Ни одного `internal`.
- **Чужие данные (Review Focus 4):** в JSON списка нет `passwordHash`, `mustChangePassword`, `lang`, `fullName`, `cardNo`; каждая строка — ровно `['attendance', 'average', 'id', 'risk']`; в карточке a2 нет `passwordHash`, `mustChangePassword`, `lang`, `login`, `tempPassword`, `commission` и ФИО a1, a3, a4.
- **Ничего не пишется (Review Focus 3):** как в задаче 2, для `dir.people` и `dir.person` (a2), с запущенной парой `p0922` и концом окна.
- **Прежние ответы:** `call('dir.list', { table: 'students' }, t.dean).data.rows` — `deepEqual` со строками листа без `passwordHash` (как раньше).

- [ ] **Step 2:** `node --test tests/dirStudentsApi.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: dir.people and dir.person of students - attendance, unit totals, state, works, debts and repeats, read-only`.

---

### Task 4 (С): `dir.people` и `dir.person` сотрудников

**Files:** Create `backend/dirStaff.js`, `tests/dirStaffApi.test.js`. Modify `backend/dirPeople.js` (ветка `staff`). **Проверка — строгая** (Review Focus 1–5, 7).

**Interfaces — Consumes:** задачи 1–3; `pairEnd`, `syllabusState` (`core/dirInfo.js`); `mainLine` (`core/disciplineSyllabus.js`); `isSubstitution` (`core/schedule.js`); `readSettings`, `readExtra`; `localDate`, `localTime`, `mondayOf`, `addDays`.

**Produces** (`backend/dirStaff.js`):

```js
export function staffList(store, platform, user);              // читает staff, subjects, weekTemplate
export function staffCard(store, platform, user, id, from);
// сначала staff; нет роли 'teacher' (roleList) -> ответ без чтения других листов;
// иначе ещё subjects, groups, rooms, weekTemplate, pairs, settings, syllabi, syllabusLines, students, topics, attendance, unitResults, assignments, submissions, closures
```

**Ответы:**

```js
// dir.people, staff — строки в порядке листа staff, ровно эти ключи
{ table: 'staff', rows: [{ id, subjects: [/* имена его предметов без повторов, compareNames */], weekPairs /* строки шаблона его предметов */ }] }
// dir.person, staff
{ table: 'staff', today, time, semester,
  person: { id, fullName, roles: roleList(roles), active: active === true },
  teacher: null | {
    weekPairs, hours: hoursOf(weekPairs), subjects /* rows.length */, unfilled /* unfilledPairs.length + unfilledUnits.length */,
    rows: [{ subjectId, disciplineId, name, groupId, groupName, weekPairs, syllabus: { approved, open }, responsible }],
    // все предметы с teacherId === id, по name, затем groupName; syllabus — как syllabusOf части 1 (syllabusState по disciplineId, teacherId, settings.semester; без дисциплины — { approved: false, open: null });
    // responsible — mainLine(syllabusLines, disciplineId)?.responsibleId === id
    unfilledPairs: [{ pairId, subjectId, date, slot, startTime, groupName, subjectName }],
    // пары с pair.teacherId === id (тот, кто ведёт на самом деле) и unfilledPair; новые сверху: date, затем slot по убыванию
    unfilledUnits: [{ subjectId, name, groupName, unit, control, self }],
    // предметы с teacherId === id и halfOf !== null: unitGap по каждому юниту subjectProgress (pairs, closedUnits, students); по name, groupName, unit
    from, to /* from + 6 */, bells, exam: { start, end }, holidays /* даты недели */,
    pairs: [{ id, date, slot, startTime, endTime, status, groupId, groupName, subjectId, subjectName, roomName, substitution, moved, planDate, planSlot }] } }
    // пары недели с pair.teacherId === id, включая отменённые; по date, slot; поля — как у карточки аудитории части 1 (endTime = pairEnd, substitution = isSubstitution(pair, subject), moved = date !== planDate || slot !== planSlot)
```

`from`: `undefined` — `mondayOf(today)`, иначе `mondayOf(from)`; проверка `isDate` — в `dirPerson` (задача 3). У сотрудника без роли «преподаватель» `teacher: null`, даже если на нём числятся предметы.

- [ ] **Step 1: тесты** (`tests/dirStaffApi.test.js`, на `setup()`; в шаблоне setup — по одной строке у sb1 и sb2):

```js
const list = call('dir.people', { table: 'staff' }, t.dean).data;
assert.deepEqual(list.rows.map((r) => r.id), store.list('staff').map((x) => x.id));
assert.deepEqual(byId(list.rows, ids.teacher1), { id: ids.teacher1, subjects: ['Информатика'], weekPairs: 1 });
assert.deepEqual(byId(list.rows, ids.teacher3), { id: ids.teacher3, subjects: [], weekPairs: 0 });
s.at('2026-09-30');
const c = call('dir.person', { table: 'staff', id: ids.teacher1 }, t.dean).data;
assert.deepEqual(c.person, { id: ids.teacher1, fullName: 'Иванова Нургуль', roles: ['teacher'], active: true });
const responsible = mainLine(store.list('syllabusLines'), s.ds1)?.responsibleId === ids.teacher1;
assert.deepEqual(c.teacher.rows, [{ subjectId: s.sb1, disciplineId: s.ds1, name: 'Информатика', groupId: s.g1, groupName: '01-1', weekPairs: 1,
  syllabus: { approved: true, open: null }, responsible }]);
assert.deepEqual(c.teacher.unfilledPairs.map((p) => p.date), ['2026-09-29', '2026-09-22']);   // 15.09 — замена teacher3, не его
assert.deepEqual(c.teacher.unfilledUnits, [{ subjectId: s.sb1, name: 'Информатика', groupName: '01-1', unit: 1, control: 3, self: 3 },
  { subjectId: s.sb1, name: 'Информатика', groupName: '01-1', unit: 2, control: 3, self: 3 }]);
assert.deepEqual([c.teacher.weekPairs, c.teacher.hours, c.teacher.subjects, c.teacher.unfilled], [1, 2, 1, 4]);
```

Ещё в этом файле:
- `s.unitNumbers()` (тоже 30.09) → юнит 1 `{ control: 1, self: 1 }`; `s.closeUnit(1)` → юнита 1 нет; `s.at('2026-09-22')` → только юнит 1 (пара 29.09 юнита 2 впереди), `unfilledPairs` — только `'2026-09-22'`.
- teacher3: `unfilledPairs` — одна пара `s.p0915`; `rows: []`, `weekPairs: 0`; неделя `{ from: '2026-09-16' }` → `from: '2026-09-14'`, `to: '2026-09-20'`, одна пара `p0915` с `substitution: true`, `groupName: '01-1'`, `subjectName: 'Информатика'`; у teacher1 в эту неделю `pairs: []`.
- Отменённая пара: `store.update('pairs', s.p0922, { status: 'cancelled' })` → у teacher1 неделя `'2026-09-21'` содержит её со `status: 'cancelled'`, в `unfilledPairs` её нет. Пара, отмеченная деканатом «не проведена» (`status: 'missed'`), в `unfilledPairs` тоже не попадает.
- **Без роли «преподаватель»:** проректор и администратор → `teacher: null`, `roles: ['prorector']` / `['admin']`; у проректора `s.spy.lists` — только `staff` (и ничего не пишется). Деканат (`dean,teacher`) → `roles: ['dean', 'teacher']`, `teacher` с `weekPairs: 0`, `rows: []`, `unfilledPairs: []`, `unfilledUnits: []`.
- **Обход (Review Focus 1, 2, 5):** как в задаче 3, для `table: 'staff'`; `id` студента (`s.a1`) в `staff` → `not_found`; `from` `'2026-13-01'`, `5`, `''`, `null` → `bad_request`. `dir.save` сотрудника (`{ table: 'staff', row: { id: ids.teacher1, fullName: 'x', login: 'teacher1', roles: 'teacher' } }`) деканатом и проректором → `forbidden`, администратором — `ok`. Ни одного `internal`.
- **Чужие данные (Review Focus 4):** в JSON обоих ответов нет `passwordHash`, `mustChangePassword`, `lang`, `login`, `tempPassword` и ФИО студентов (`'Асанов Айдар'`, `'Өмүров Канат'`); строки списка — ровно `['id', 'subjects', 'weekPairs']`.
- **Ничего не пишется (Review Focus 3):** как в задаче 2, для `dir.people` и `dir.person` teacher1.
- **Прежние ответы:** `dir.list` `staff` деканатом — строки листа без `passwordHash`.

- [ ] **Step 2:** `node --test tests/dirStaffApi.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: dir.people and dir.person of staff - what a teacher leads, pairs and hours a week, unfilled pairs and units, the week`.

---

### Task 5 (С): данные стенда, числа и скорость

**Files:** Modify `dev/seed.js`, `dev/server.js` (строка вызова сида). Create `tests/seedProgress.test.js`. **Проверка — облегчённая.**

**Interfaces — Consumes:** задачи 2–4; `saveUnitResults` (`backend/journalData.js`); `enrol` (`backend/repeatData.js`) — как `seedRepeat`; `readSettings`, `addDays`.

**Produces** (`dev/seed.js`):

```js
export function seedProgress(store, platform);
// seed(store, platform, files = null, { repeats = true, progress = false } = {}) — при progress после seedRepeat вызывает seedProgress (через fill);
// seedDemo его не вызывает. dev/server.js: вымышленный стенд сеется как seed(store, platform, files, { progress: true }) (seedAdmin режима real — как раньше).
```

Что пишет `seedProgress` (всё вымышленное; предмет — «Информатика» группы 03-1, `teacher3`; студенты — по номеру билета):
1. **Текущая половина, под угрозой:** `saveUnitResults` от `teacher3`, юнит 1: `control` — S3001: 6, S3002: 8; `self` — S3001: 3, S3002: 4 (итог не выше 40 + 3 + 6 < «удовл.»). Остальные 20 — без оценок (юнит 1 остаётся «не заполнен» у `teacher3`).
2. **Прошлая половина — семестр по плану 2** (весна прошлого года), прямо в листы, как `seedExam` (`insertMany`), даты — за 60–70 дней до `semesterStart`: «Итоги юнитов» юнита 1 (`currentManual`, `self`, `control`) — S3001: 30, 15, 25 (70, допущен); S3002: 10, 5, 10 (25, не допущен); S3003: 35, 18, 35 (88); «Закрытые юниты» — юнит 1 и итоговая (0); шапка «Экзамены предметов»; «Попытки экзамена» №1 — S3001: 5 (итог 47, «неуд.»), S3003: 30 (итог 83).
3. **Повтор:** `enrol` деканатом S3001, `planSemester: 2`, `kind: 'full'`, `orderNo: '14-с'`, `orderDate` — сегодня, `deadline` — сегодня + 30, `teacherId` — `teacher3`. У S3002 карточки нет.

- [ ] **Step 1: тесты** (`tests/seedProgress.test.js`): стенд как в `tests/seedRepeat.test.js` (`TODAY = '2026-11-18'`, 12:00, среда), `seed(store, platform, null, { progress: true })`; свой шпион на все методы хранилища: `lists[table]` и счётчик `get`. Помощник `timed(action, data, who)`: обнулить счётчики, вызвать, `performance.now()` — меньше 1000 мс, `ok`, каждое `lists[...]` — 1, `get` ≤ 1, записей нет. Числа:
  - `dir.people` студентов: S3001 и S3002 — `risk: 1`, S1001 — `risk: 0`.
  - `dir.person` S3001: строка «Информатика» `state: 'risk'`; `debts: [{ name: 'Информатика', groupName: '03-1', planSemester: 2, state: 'fail', total: 47, repeat: 'open', subjectId }]`; `totals.repeats: 1`. S3002: `debts` — одна, `state: 'notAdmitted'`, `total: null`, `repeat: null`. S3003: `debts: []`.
  - `dir.progress` 03-1: «Информатика» `counts.risk: 2`, `totals.risk: 2`. 02-1: «Информатика» `counts: { risk: 0, fail: 3, notAdmitted: 3, absent: 1, incomplete: 1 }`; «Анатомия» и «Биология» — `inHalf: false`.
  - `dir.progress` дисциплины «Информатика»: `units` — `[{ unit: 1, groups: 3, closedGroups: 2, … }, { unit: 2, groups: 3, closedGroups: 1, … }]`.
  - `dir.people` сотрудников: teacher1 — `subjects: ['Информатика', 'Латинский язык']`, `weekPairs: 2`; teacher2 — `['Анатомия', 'Физиология', 'Химия']`, 7; teacher3 — `['Биология', 'Информатика', 'Физиология']`, 2; dean, prorector, admin — `[]`, 0.
  - `dir.person` teacher2: `unfilledPairs` — три пары «Анатомии»: 18.11 02-1, 18.11 01-1, 12.11 02-1 (в этом порядке); `unfilledUnits` — `[{ name: 'Физиология', groupName: '01-1', unit: 1, control: 22, self: 22, subjectId }]`. teacher3: `unfilledPairs: []`; `unfilledUnits` — «Информатика» 03-1 юнит 1 `control: 20, self: 20` и «Физиология» 03-1 юнит 1 `22, 22`. prorector — `teacher: null`.
  - `seed(store, platform)` без `progress`: в «Итогах юнитов» нет строк `planSemester: 2`, карточек повтора — 4 (как раньше).
  Если число стенда не сходится — остановиться и написать в отчёте (числа сняты пробой координатора на `seed()` 18.11 12:00; сверка плана проверяет их заранее).
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` (прежние `seed*.test.js`, `demo.test.js`, `devServer.test.js`, `dirInfoApi.test.js` — без правок), `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: the stand gets students at risk and a debt of a past half with and without a repeat course`.
- [ ] **Step 6 (координатор):** итоги задач 1–5 — в `aidlc-state.md` и журнал хода; новый чат координатора (правило 6б).

---

### Task 6 (Э): списки, успеваемость в карточках группы и дисциплины, две мелочи — блок владельца 1

**Files:** Modify `site/js/dirInfo.js`, `site/js/views/directoryConfig.js`, `site/js/views/directory.js`, `site/js/views/dirCard.js`, `site/js/router.js`, `site/js/shell.js`, `site/js/i18n/{ru,ky,en}.js`, `site/css/screens.css`, `tests/siteDirInfo.test.js`, `tests/router.test.js` (только новые проверки). **Проверка ИИ — облегчённая.**

**Interfaces — Consumes:** ответы `dir.people` и `dir.progress` задач 2–4.

**Produces** (`site/js/dirInfo.js`, без DOM):

```js
export const PERSON_TABLES = ['students', 'staff'];
export const ATTENDANCE_LOW = 70;
export const ATTENDANCE_MID = 85;
export function percentText(percent);       // null -> '—'; 87 -> '87 %'
export function attendanceTone(percent);    // null -> null; < ATTENDANCE_LOW -> 'danger'; < ATTENDANCE_MID -> 'warning'; иначе null
export function stateLabel(state, total);   // -> { key: 'dir.state.' + state, params: state === 'passed' ? { total } : {}, tone }
                                            // going 'neutral', risk 'warning', passed 'success', fail 'danger', notAdmitted 'danger', absent 'danger', incomplete 'warning', noExam 'neutral'
export function countBadges(counts);        // [{ key: 'dir.count.' + k, count, tone }] по COUNTED_STATES (risk 'warning', fail 'danger', notAdmitted 'danger', absent 'danger', incomplete 'warning'), только count > 0
export function markEditFromCard(href);     // запомнить адрес карточки, из которой открыто «Изменить»
export function takeEditFromCard();         // вернуть запомненный адрес и забыть его; ничего нет -> null
```

Экраны:

- **`directoryConfig.js`:** `students` — `card: true, cardAction: 'dir.person', info: 'dir.people', extra: ['attendance', 'average']`; `staff` — `card: true, cardAction: 'dir.person', info: 'dir.people', extra: ['subjects', 'weekPairs']`. У прежних трёх справочников `cardAction` и `info` не пишутся (по умолчанию `'dir.card'` и `'dir.summary'`).
- **`directory.js`:** запрос цифр — `config.info ?? 'dir.summary'` (право `can(info, table)`), ссылка на карточку — `can(config.cardAction ?? 'dir.card', table)`; ошибка цифр, как раньше, не ломает список (`dir.info.unavailable`). Ячейки: «Посещаемость» — `percentText` с цветом `attendanceTone` (классы `dir-pct--danger`, `dir-pct--warning`); «Средний балл» — число или «—»; «Что ведёт» — имена через запятую или «—»; «Пар в неделю» у сотрудника без предметов — «—». Статус студента: активен и `risk > 0` — жёлтая метка `tCount('dir.riskSubjects', risk)` вместо «Активен» (метка временного пароля остаётся). Строки, для которых цифр нет, — «—». ФИО — ссылка `cardHref(table, id)` (адрес карточки человека появляется в задаче 7, до неё ссылка ведёт на главную). Поиск — как раньше, по прежним колонкам.
- **Мелочь 1 — путь один раз:** в `dirCard.js` убрать строку пути (`crumbs()` и её стили `card-crumbs`); в `shell.js` у экранов `dirCard` и `personCard` слово справочника в верхнем пути — ссылка `#/dir/<table>`, если есть `dir.list:<table>`.
- **Мелочь 2 — «Назад» в карточку:** кнопка «Изменить» карточки делает `markEditFromCard(cardHref(table, id))` и `location.hash = cardHref(table, id) + '/edit'` (новый шаг истории вместо `location.replace`). `directory.js`, открывая окно по `params.editId`, ставит `dialog.pushed = takeEditFromCard() === cardHref(table, id)`; выход из такого окна (Отмена, Esc, после успешного сохранения) — `history.back()`, если `pushed`, иначе прежний `location.replace(d.back)`. Окна, открытые из списка, не меняются.
- **Адреса правки** (`router.js`): `#/dir/<groups|rooms|disciplines|students|staff>/<id>/edit` — право `dir.save:<table>`, ответ `{ view: 'directory', params: { table, editId } }`.
- **Карточка группы** (`dirCard.js`): если `can('dir.progress:groups')` — `dir.progress` параллельно с `dir.card`; ошибка — карточка части 1 и `note('info', t('dir.progress.unavailable'))`. Плитки (решение плана 11): прежние 4 + «посещаемость» (`percentText`, цвет), «средний балл», `tCount('dir.card.riskStudents', risk)`. «Предметы»: + «Посещ.», «Средний», метки `countBadges` (пусто — «—»); преподаватель — ссылка `#/dir/staff/<id>` (если `dir.person:staff`). «Студенты»: у первых 5 — посещаемость и средний (по `students` ответа `dir.progress`); ФИО — ссылка `#/dir/students/<id>` (если `dir.person:students`).
- **Карточка дисциплины:** если `can('dir.progress:disciplines')` — так же. Плитки: `tCount('dir.card.groupsCount', groups)`, посещаемость, средний, студентов под угрозой. «Где идёт»: + «Студентов», «Посещ.», «Средний», метки, «Юниты» (`Ю1 закрыт` / `Ю2 идёт` через `dir.card.unitShort` + `dir.card.unitClosed` / `dir.card.unitOpen`). Блок «Юниты»: юнит, `t('dir.card.closedOf', { closed, groups })`, средний; юнитов нет — блок не показывается.
- На 1366 px — без прокрутки страницы вбок; таблицы прокручиваются внутри своих карточек.

Словари (ru; ky и en — свои переводы тех же ключей): `dir.col.attendance` «Посещаемость», `dir.col.average` «Средний балл», `dir.col.subjects` «Что ведёт», `dir.riskSubjects` (формы: «под угрозой · {count} предмет», «… предмета», «… предметов», «… предмета»), `dir.state.going` «идёт», `dir.state.risk` «под угрозой», `dir.state.passed` «сдано {total}», `dir.state.fail` «неуд.», `dir.state.notAdmitted` «не допущен», `dir.state.absent` «не явился(ась)», `dir.state.incomplete` «I», `dir.state.noExam` «нет экзамена», `dir.count.risk` «под угрозой {count}», `dir.count.fail` «неуд. {count}», `dir.count.notAdmitted` «не допущ. {count}», `dir.count.absent` «не явились {count}», `dir.count.incomplete` «I {count}», `dir.card.attendance` «посещаемость», `dir.card.average` «средний балл», `dir.card.riskStudents` (формы: «студент под угрозой», «студента под угрозой», «студентов под угрозой», «студента под угрозой»), `dir.card.groupsCount` («группа», «группы», «групп», «группы»), `dir.card.col.attendance` «Посещ.», `dir.card.col.average` «Средний», `dir.card.col.counts` «Успеваемость», `dir.card.col.students` «Студентов», `dir.card.col.units` «Юниты», `dir.card.col.unit` «Юнит», `dir.card.col.closedGroups` «Закрыто групп», `dir.card.unitsTitle` «Юниты», `dir.card.unitN` «Юнит {n}», `dir.card.unitShort` «Ю{n}», `dir.card.unitClosed` «закрыт», `dir.card.unitOpen` «идёт», `dir.card.closedOf` «{closed} из {groups}», `dir.progress.unavailable` «Успеваемость сейчас недоступна.». Ключи `dir.card.crumbs` и прочие прежние остаются (если ключ больше нигде не нужен — оставить, не удалять).

- [ ] **Step 1: тесты.** `tests/siteDirInfo.test.js`: `percentText(null) === '—'`, `percentText(87) === '87 %'`; `attendanceTone` — `null`, 69, 70, 84, 85 → `null`, `'danger'`, `'warning'`, `'warning'`, `null`; `stateLabel('passed', 82)` → `{ key: 'dir.state.passed', params: { total: 82 }, tone: 'success' }`, `stateLabel('risk', null)` → `{ key: 'dir.state.risk', params: {}, tone: 'warning' }`; `countBadges({ risk: 1, fail: 0, notAdmitted: 2, absent: 0, incomplete: 1 })` → три метки по порядку; все нули → `[]`; `markEditFromCard('#/dir/groups/g1')`, `takeEditFromCard()` → `'#/dir/groups/g1'`, второй `takeEditFromCard()` → `null`; в `ru.js` у `dir.riskSubjects`, `dir.card.riskStudents`, `dir.card.groupsCount` есть формы `one`, `few`, `many`, `other`. `tests/router.test.js`: `#/dir/students/s1/edit` с `dir.save:students` — `{ view: 'directory', params: { table: 'students', editId: 's1' } }`, `#/dir/staff/s1/edit` с `dir.save:staff` — так же, без права — главная; прежняя проверка `#/dir/staff/s1/edit` без `dir.save:staff` → главная остаётся зелёной.
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5: стенд.** `npm run dev:reset` (сид с `progress`). Скриншоты headless Chrome 1366×768, обе темы, в `.superpowers/sdd/plan-spravochniki-2/task-6-shots/`: «Студенты» 03-1 и 02-1, «Сотрудники» — деканатом; карточки групп 02-1 и 03-1, карточка «Информатики» — деканатом и проректором (без «Изменить»); верхний путь в карточке; «Изменить» в карточке группы → окно → «Назад» браузера → снова карточка (скриншот до и после); то же с «Отмена». Остановить свой стенд по своему PID.
- [ ] **Step 6:** коммит `feat: students and staff lists show progress and load; group and discipline cards show progress; the path shows once; back from the edit window returns to the card`.
- [ ] **Step 7 (координатор): приёмка блока 1.** Координатор смотрит 1–2 скриншота, поднимает `journal-dev-reset`, входит как `dean` и даёт владельцу список «что посмотреть» из `owner-summary.md` (раздел 3, блок 1). Замечания — круг исправлений тому же агенту.

---

### Task 7 (Э): карточки студента и сотрудника — блок владельца 2

**Files:** Create `site/js/views/personCard.js`, `site/js/views/weekGrid.js`. Modify `site/js/views/dirCard.js` (сетка аудитории — через `weekGrid`), `site/js/router.js`, `site/js/main.js` (`VIEWS.personCard`), `site/js/shell.js` (`currentName`: `personCard` → `params.table`), `site/js/i18n/{ru,ky,en}.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/siteDirInfo.test.js`. **Проверка ИИ — строгая** (данные студентов, кнопки проректора и деканата).

**Interfaces — Consumes:** ответы `dir.person` задач 3–4; помощники задачи 6; `cardHref`, `fullDate`, `gridRows` (`site/js/dirInfo.js`); `gridDays`, `cellPairs`, `pairFlags`, `examDayLabel` (`site/js/pairs.js`); `weekNav`, `dayMonth`, `flagBadge` (`site/js/views/pairParts.js`); готовые ключи `repeat.kind.*`, `repeat.state.*`, `grades.repeat.order`, `grades.repeat.deadline`, `grades.repeat.works`, `role.*`, `dir.card.journal`, `dir.card.toList`, `dir.card.week`, `dir.card.free`, `dir.card.holiday`, `dir.card.cancelledPair`.

**Produces:**

```js
// site/js/views/weekGrid.js — сетка недели карточки аудитории, вынесенная без изменений вида
export function weekGrid({ data, cell });   // data — { from, today, bells, exam, holidays, pairs }; cell(pairsOfCell, isToday) -> td
// site/js/views/personCard.js — экран #/dir/<students|staff>/<id>; render(root, params), leave(); гонка ответов — ticket, как dirCard
```

Адрес (`router.js`): `#/dir/<students|staff>/<id>` с правом `dir.person:<table>` → `{ view: 'personCard', params: { table, id } }` (id — через `idOf`); `#/dir/students/group/<id>` — как раньше (проверяется раньше карточки).

Экран:

- **Шапка:** заголовок — ФИО; студент — метка «активен» (`success`) / «отключён» (`neutral`) и строка `t('dir.person.lead', { group, cardNo })`, где группа — ссылка на `#/dir/groups/<groupId>` (если `dir.card:groups`); сотрудник — метки ролей `t('role.<role>')`. Кнопки справа: студент — «Журнал группы» (`journal.list`, `#/journal/group/<groupId>`), «Изменить» (только `dir.save:students`); сотрудник — «Изменить» (только `dir.save:staff`: у деканата и проректора её нет). «Изменить» — как в задаче 6 (`markEditFromCard` и новый шаг истории).
- **Студент:** плитки — посещаемость (`percentText`, цвет), средний балл, `tCount('dir.person.risk', risk)`, `tCount('dir.person.repeats', repeats)`. Таблица «Предметы»: дисциплина, преподаватель, `t('dir.person.attendanceCell', { percent, absent })` с цветом, итоги юнитов (`Ю1 82  Ю2 —`), средний, `stateLabel` меткой; предметов нет — «Предметов этого полугодия нет». Блок «Задания»: дисциплина, сдано, ждёт проверки, возвращено, не сдано; пусто — «нет». Строка «Долги» (только если есть): по долгу `t('dir.person.debt', { subject, semester, state })` и «повтор записан» / «повтор не записан». Блок «Повторный курс»: по карточке — предмет, `t('dir.person.repeatSemester', { n: planSemester })`, `grades.repeat.order`, `repeat.kind.<kind>`, `repeat.state.<status>` (или `repeat.state.overdue`, если `overdue`), `grades.repeat.works`, итог или «—», `grades.repeat.deadline`; карточек нет — «нет».
- **Сотрудник:** у `teacher === null` — только шапка. Иначе плитки — `tCount('dir.person.weekPairs', …)`, `tCount('dir.person.hours', …)`, `tCount('dir.card.subjects', …)`, `tCount('dir.person.unfilled', …)` (не 0 — жёлтым). «Что ведёт»: дисциплина (ссылка на карточку дисциплины, если `dir.card:disciplines`), группа, пар в нед., `syllabusBadges` и мелко «ответственный»; пусто — «—». «Не заполнено» (если `unfilled > 0`): подзаголовок «Пары» — `ДД.ММ · 01-1 · Анатомия` ссылкой на `#/journal/<subjectId>` и метка «не заполнена»; «Юниты» — `Анатомия · 03-1 · Юнит 1` ссылкой на `#/ledger/<subjectId>` и «нет рубежного: N», «нет СРС: N» (нулевые не показываются). «Неделя» — `weekNav` (`from` уходит в `dir.person`) и `weekGrid`; клетка — `01-1 · Анатомия`, мелко `ауд. 204` (нет аудитории — без строки), метки `flagBadge`; только отменённые — «свободна» и `dir.card.cancelledPair`.
- **Ошибки:** `not_found` — `emptyState` с `t('error.not_found')` и «К списку» (`#/dir/<table>`); другая — текст, «Повторить» и «К списку» (сюда попадает прежний сервер, раздел «Откат»).
- Карточка аудитории после выноса сетки выглядит как раньше (скриншот той же недели до и после).

Словари (ru): `dir.person.active` «активен», `dir.person.inactive` «отключён», `dir.person.lead` «Группа {group} · № билета {cardNo}», `dir.person.attendance` «посещаемость», `dir.person.average` «средний балл», `dir.person.risk` (формы «предмет под угрозой», «предмета под угрозой», «предметов под угрозой», «предмета под угрозой»), `dir.person.repeats` («повторный курс» во всех формах), `dir.person.subjects` «Предметы», `dir.person.noSubjects` «Предметов этого полугодия нет», `dir.person.col.discipline` «Дисциплина», `dir.person.col.teacher` «Преподаватель», `dir.person.col.attendance` «Посещаемость (пропуски)», `dir.person.col.units` «Итоги юнитов», `dir.person.col.average` «Средний», `dir.person.col.state` «Состояние», `dir.person.attendanceCell` «{percent} ({absent})», `dir.person.works` «Задания», `dir.person.col.checked` «Сдано», `dir.person.col.submitted` «Ждёт проверки», `dir.person.col.returned` «Возвращено», `dir.person.col.missing` «Не сдано», `dir.person.debts` «Долги», `dir.person.debt` «{subject} · {semester} семестр · {state}», `dir.person.repeatSet` «повтор записан», `dir.person.repeatNone` «повтор не записан», `dir.person.repeatsTitle` «Повторный курс», `dir.person.repeatSemester` «{n} семестр», `dir.person.none` «нет», `dir.person.weekPairs` («пара в неделю», «пары в неделю», «пар в неделю», «пары в неделю»), `dir.person.hours` («час в неделю», «часа в неделю», «часов в неделю», «часа в неделю»), `dir.person.unfilled` («не заполнено» во всех формах), `dir.person.leads` «Что ведёт», `dir.person.col.group` «Группа», `dir.person.col.weekPairs` «Пар в нед.», `dir.person.col.syllabus` «Силлабус», `dir.person.responsible` «ответственный», `dir.person.unfilledTitle` «Не заполнено», `dir.person.unfilledPairs` «Пары», `dir.person.unfilledUnits` «Юниты», `dir.person.pairUnfilled` «не заполнена», `dir.person.noControl` «нет рубежного: {count}», `dir.person.noSelf` «нет СРС: {count}», `dir.person.room` «ауд. {room}».

- [ ] **Step 1: тесты.** `tests/router.test.js`: `#/dir/students/s1` с `dir.person:students` → `{ view: 'personCard', params: { table: 'students', id: 's1' } }`; `#/dir/staff/s%201` с `dir.person:staff` → `id: 's 1'`; без права — главная; `#/dir/students/%E0%A4%A` — главная; `#/dir/students/group/g1` — прежний ответ; прежняя проверка `#/dir/students/x` (права `dir.card:groups`, `dir.list:students`) → главная остаётся зелёной. `tests/siteDirInfo.test.js`: у `dir.person.risk`, `dir.person.weekPairs`, `dir.person.hours` есть формы `one`, `few`, `many`, `other`.
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5: стенд.** `npm run dev:reset`. Скриншоты 1366×768, обе темы, в `.superpowers/sdd/plan-spravochniki-2/task-7-shots/`: студенты S3001 (под угрозой, долг с повтором), S3002 (долг без повтора), S2001 («неуд.», повтор идёт), S1001 (задания) — деканатом; S3001 проректором (без «Изменить»); teacher2 (непроведённые пары, юнит «Физиологии») деканатом — без «Изменить»; teacher3, следующая неделя (замена в четверг) — администратором, с «Изменить»; карточка проректора (только роли); адрес с неизвестным id; карточка аудитории 101 — следующая неделя (сетка как раньше). Остановить свой стенд по своему PID.
- [ ] **Step 6:** коммит `feat: cards of a student and of a staff member`.
- [ ] **Step 7 (координатор): приёмка блока 2** — как в задаче 6 (`owner-summary.md`, раздел 3, блок 2).

---

### Task 8 (координатор и владелец): общая проверка, выкладка на тестовый

- [ ] **Step 1: общая проверка** — opus, строго, диапазон от коммита плана до `HEAD`, по Review Focus 1–7, пробными скриптами во временной папке сессии: три действия каждой ролью и без входа, каждой таблицей и плохими `table` / `id` / `from`; снимок всех таблиц до и после и счёт `list` / `get` на данных стенда; поиск `passwordHash`, `mustChangePassword`, `lang`, `login`, `commission` и ФИО других студентов во всех ответах; числа карточек против `journal.get`, `ledger.get`, `student.grades` на стенде (все студенты 02-1 и 03-1); «под угрозой» с другими числами «Баллов и журнала»; прежние `dir.list`, `dir.summary`, `dir.card` — те же, что на `af8f1bb` (ответы прежнего и нового кода на одной базе стенда); прежний код `55c01bb` (`git archive` во временную папку) на той же базе — прежние запросы отвечают как раньше, новые — `bad_request`, в `auth.me` нет прав `dir.people:*`, `dir.person:*`, `dir.progress:*`; новый сайт на нём — оба случая раздела «Откат»; «Назад» из «Изменить» во всех пяти справочниках (из карточки и из списка); прежние тесты без правок, кроме названных в отчётах; `npm run build:gas`; строки `minor (deferred)` журнала хода. Находки — в `.superpowers/sdd/plan-spravochniki-2/final-fix-brief.md` (если проверяющий не может писать файлы — сохраняет координатор).
- [ ] **Step 2:** одна волна исправлений **одним** агентом; повторная проверка тем же проверяющим — только этих правок.
- [ ] **Step 3:** новые кыргызские ключи (`dir.col.attendance`, `dir.col.average`, `dir.col.subjects`, `dir.riskSubjects`, `dir.state.*`, `dir.count.*`, новые `dir.card.*`, `dir.progress.*`, `dir.person.*`) — в список на вычитку. Стенд остановить.
- [ ] **Step 4:** решения 1–17 раздела «Решения плана» (с поправками владельца) — в таблицу решений `aidlc-state.md`; `design.md` — статус «собрано»; `CLAUDE.md` — строка о карточках студента и сотрудника и запросах `dir.people` / `dir.person` / `dir.progress`; копия журнала хода — `aidlc-docs/construction/spravochniki-2/sdd/ledger-snapshot.md`.
- [ ] **Step 5 (только по прямой просьбе владельца): выкладка на тестовый.** В папке сервера: `npm run serve:backup` → `npm run serve:stop` → `git -C "D:\Журнал колледжа — сервер" checkout --detach <принятый коммит>` → `npm run serve:start` → `npm run serve:status` («работает») → `git push`. Выложенный и прежние (сервер `55c01bb`, сайт `506813b`) коммиты — в `aidlc-state.md`, раздел «Выкладка», с абзацем из раздела «Откат». **Назад** — тот же порядок на `55c01bb`, сайт — коммитом-откатом. **Боевой не трогаем:** тег образа айтишнику не называется, пока владелец не проверит тестовый и не попросит сам.
- [ ] **Step 6: проверка на тестовом** (пробные люди; данных стенда задачи 5 там нет): владелец открывает «Студенты» и «Сотрудники», карточку студента и преподавателя, карточки группы и дисциплины; «Назад» из «Изменить». Список или карточка дольше 2 секунд — находка.
- [ ] **Step 7:** `aidlc-state.md`: доработка принята и выложена на тестовый; известные ограничения — пара с QR досчитывается журналом, карточки её не досчитывают (цифры могут отставать на минуты); «пар в неделю» — по шаблону; долги — только по закрытым итоговым прошлых половин; поиск списка — только по прежним колонкам.

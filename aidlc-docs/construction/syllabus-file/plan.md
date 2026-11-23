# Файл силлабуса (правило 4): план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** к версии силлабуса можно прикрепить один файл — полный силлабус колледжа в PDF или Word до 10 МБ; прикрепляют, заменяют и убирают преподаватель в своём черновике (или возвращённой версии) и деканат с администратором; скачивают все, кто сейчас видит эту версию, студенты — только у утверждённой; для отправки на утверждение обязательны только титул и тематический план («Цель курса» — предупреждение).

**Architecture:** тот же ящик файлов юнита 5 (`ctx.files`, таблица «Файлы», уборка на Node), второго не строим. Файл силлабуса — строка «Файлов» с новым состоянием `syllabus` (без задания и сдачи); версия ссылается на неё новой колонкой `syllabi.fileId`. «Изменить» у утверждённой версии копирует ссылку, поэтому черновик и утверждённая версия указывают на один и тот же файл, пока черновик его не заменит. Запросы адресуют файл **только номером версии** (`syllabusId`), а не номером файла: так номер файла задания не подставить в силлабус и наоборот. Диск чистит только уборка: строка `syllabus`, на которую не ссылается ни одна версия, удаляется через сутки, как незакреплённые загрузки юнита 5.

**Tech Stack:** как в юните 5 — Node 24, ES-модули, `node --test`, `node:sqlite`, esbuild только для запасной сборки Apps Script, сайт без сборки. Новых зависимостей нет.

**Spec:** ответы владельца 24.11.2026 (все по умолчанию) — таблица решений `aidlc-docs/aidlc-state.md`, строка 24.11.2026 «Следующая работа — файл силлабуса (правило 4)»; правило 4 от 22.11.2026; поток силлабуса — `aidlc-docs/construction/unit-2-raspisanie/design-syllabus-form.md`; ящик файлов — план юнита 5 `aidlc-docs/construction/unit-5-dz/plan.md` (задачи 1, 4, 6) и его известные ограничения в `aidlc-state.md`.

**Исходное состояние:** `HEAD bda6d52`, **901 тест** (`npm test` 24.11.2026, все зелёные), `npm run build:gas` собирается. Юниты 1–5 приняты и выложены (сервер и сайт `72fb36b`).

**Порядок.** Сначала сверка плана (opus) с готовым кодом — находки правит отдельный агент в этом файле. Затем задачи 1 → 4 строго по одной; после каждой `npm test` зелёное и `npm run build:gas` собирается. Задачи 1–3 (правила, сервер, уборка и стенд) идут без остановок. Задача 4 — экраны, **один блок приёмки владельцем по скриншотам**. Затем задача 5: одна строгая общая проверка (opus), одна волна исправлений, повторная проверка, выкладка по просьбе владельца. Рабочий каталог — `.superpowers/sdd/plan-syllabus-file/` (памятки `implementer-contract.md`, `reviewer-contract.md`, `rereview-contract.md` копируются из каталога юнита 5, Global Constraints — из этого плана); журнал хода — `progress.md` там же, копия — `aidlc-docs/construction/syllabus-file/sdd/ledger-snapshot.md`.

## Global Constraints

Из юнита 5 (без изменений):

- `core/` и `backend/` без зависимостей из npm. Новые зависимости не добавляются.
- Сайт: без сборки, без фреймворков, ничего не загружает с чужих адресов (ни CDN, ни внешних шрифтов).
- Все обработчики сервера синхронные. `handleRequest` никогда не бросает исключение и всегда возвращает объект ответа. Ошибки — `AppError(code, { fields })` из `core/errors.js`.
- Запрос сайта: `POST`, `Content-Type: text/plain;charset=utf-8`, тело — JSON `{action, token, data}`. Исключение — загрузка файла через `upload()` из `site/js/api.js` (`XMLHttpRequest` с ходом загрузки; рабочий сервер отвечает на `OPTIONS` с юнита 5).
- `passwordHash` никогда не попадает в ответ сервера. Ответы собираются по полям; строки таблиц в ответ целиком не копируются (в ответах нет `stored`, `ownerId`).
- Время берётся только из `platform.now()`; `Date.now()` и `new Date()` без аргумента в `core/` и `backend/` запрещены. «Сегодня» — по Бишкеку (`todayOf`, `localDate`, `localDateTime`).
- В базе — английские коды (`syllabus`, `pdf`), на экране они переводятся словарём.
- Обработчик читает каждую таблицу не больше одного раза за запрос (`store.list`) и пишет пачкой (`insertMany`, `updateMany`, `removeMany`). `store.get`, `store.update`, `store.remove` в цикле запрещены.
- Что попадает в сборку Apps Script (`backend/api.js`, `backend/handlers/*`, `backend/*.js` кроме `backend/node/` и `backend/store/sqliteStore.js`, `core/*`), не импортирует ничего из `backend/node/`; в нём нет `node:`, `require(`, `Buffer` и слова `process` даже в комментариях (`tests/gasBundle.test.js`).
- Роли: `admin`, `dean`, `prorector`, `teacher`, `student`; у сотрудника роли строкой через запятую (`dean,teacher`).
- Любая фраза на экране — через ключ словаря; наборы ключей в `ky`, `ru`, `en` одинаковые (`tests/i18n.test.js`).
- Данные с сервера, от пользователя и из файлов попадают на страницу только как текст (`textContent`, помощники `site/js/ui.js`), никогда через `innerHTML`. Это относится и к **имени файла**.
- Цвета — hex или rgb, без `oklch()`. Цвета и размеры — переменные `site/css/app.css`. Код и картинки платного шаблона не копируются. Две темы, тёмная по умолчанию; каждый экран проверяется в обеих.
- Студенческие экраны — для телефона шириной 360 px: текст не мельче 16 px, кнопки не ниже 44 px, без горизонтальной прокрутки.
- Настоящих данных студентов и сотрудников в репозитории нет: ни в коде, ни в тестах, ни в отчётах, ни на скриншотах.
- Локальный стенд — только порт 5273. Рабочий сервер (5373), папки `D:\Журнал колледжа — сервер`, `D:\Журнал колледжа — данные`, `C:\JournalBackups`, файлы `serve.local.json`, `dev/data/real.json`, папка `dev/data/real-files/` агенты не открывают, не запускают и не правят.
- Сообщения коммитов на английском; в конце строка `Co-Authored-By` с моделью, которая на самом деле писала коммит. Агент коммитит **только свои файлы по имени** (не `git add -A`) и оставляет `git status` чистым. `git push` и обновление рабочего сервера — только по прямой просьбе владельца.
- **Права проверяются попыткой обойти защиту.** Отказ — и ничего не записано: тест сравнивает снимок «Силлабусов», «Файлов» и имён в ящике файлов до и после.
- **Данные студентов — строго.** Студент получает файл только той версии, которую ему показывает `syllabus.get`; ответ проверяется поиском по всему JSON.
- Стенд и браузер агентов: стенд координатора на 5273 перед экранной задачей остановлен, агент поднимает свой (`npm run dev:reset`). Браузер — только headless Chrome с временным профилем и ключами `--disable-sync --disable-extensions`; не Edge. Процессы агент останавливает **только по своему номеру (PID)** — те, что запустил сам; никогда по имени программы или заголовку окна. Браузер и учётные записи владельца не трогаются. Пароль стенда в отчётах и скриншотах не пишется.

Из юнита 5, про файлы:

- **Файл — не в базе и не в репозитории.** Лежит в ящике (`<dataDir>\files\`, на стенде `dev/data/files/`) под именем `<32 hex>.bin` (`platform.randomHex(16)`); путь строится только из имени, прошедшего `isStoredName`. Имя, которое дал человек, — только текст в «Файлах» после `cleanFileName`.
- **Файлы ходят только через `/api`**, base64 в JSON; сайт собирает `Blob` с типом из своего списка по `kind` (`mimeOf`), PDF открывается в новой вкладке, Word скачивается.
- **Вид файла — по содержимому** (`sniffKind`): расширение должно совпасть с видом по первым байтам, Word с макросами (`vbaProject.bin`, `_VBA_PROJECT`) не принимается. **Для силлабуса принимаются только `pdf`, `docx`, `doc`.**
- **Предел — 10 МиБ** (`FILE_LIMITS.maxBytes` = 10 485 760 байт), имя — до 120 знаков.
- **Диск чистит только уборка** (`sweepFiles`, Node). Ни один запрос не удаляет файл с диска.
- **Запасной Apps Script:** ящика нет — `syllabus.attachFile`, `syllabus.dropFile`, `syllabus.file` отвечают `files_unavailable`; остальной силлабус (в том числе необязательная «Цель курса») работает. `npm run build:gas` собирается; живьём на Apps Script не проверяется.

Новые правила этой работы:

- **Таблицу «Файлы» пишут:** прежние модули юнита 5 (только строки заданий) и `backend/syllabusFiles.js` (только строки `state: 'syllabus'`), удаляет строки только `sweepFiles`. Колонку `syllabi.fileId` пишут только `backend/syllabusFiles.js` и копия версии (`draftVersion`); утверждение, возврат, отправка, сохранение вкладок и «Заполнить из файла» её не трогают.
- **Прежние тесты** остаются зелёными без правок, кроме прямо названных в задачах строк (ожидание «цель обязательна», списки колонок, состояний, прав, добавленных колонок, число файлов стенда). Каждая такая правка — в отчёте.
- **Проверка задач:** задачи 1, 2, 3 — проверка ИИ **строгая** (права, данные студентов, файлы); задача 4 — проверка ИИ (sonnet) с пробами только на файлы и студенческую страницу, остальное владелец принимает по скриншотам. Общая проверка — одна, в конце, строгая, opus, с пробными скриптами против настоящего кода.
- **Модели.** «Логика», «Сервер», «Экраны», проверяющий — sonnet; сверка плана и общая проверка — opus. Модель указывается явно в каждом поручении.

## Review Focus

1. **Чужой и закрытый силлабус.** `teacher2` прикрепляет или убирает файл у черновика `teacher1` — `forbidden`; `teacher1` у своей версии «на утверждении» и у утверждённой — `syllabus_locked` (деканат у версии «на утверждении» — тоже `syllabus_locked`); у архивной — `forbidden`; проректор и студент — `forbidden` (их нет в таблице прав). Ничего не записано: снимок «Силлабусов», «Файлов» и имён ящика. Тесты — задача 2.
2. **Студент и чужой файл.** Студент просит файл черновика, возвращённой версии, версии «на утверждении», утверждённой версии чужой дисциплины или чужого преподавателя, утверждённой версии, скрытой на время утверждения новой (`hidden`), — `not_found`; `syllabusId` массивом, числом, с пробелами — `bad_request`; лишнее поле `fileId` в запросе ничего не меняет. Тесты — задача 2.
3. **Номер файла не переносится.** Номер строки файла силлабуса в `work.file` (преподаватель, деканат, студент), `work.dropFile`, `work.submit` — `not_found` / `bad_ref`; лишнее поле `fileId` в `syllabus.attachFile` не прикрепляет чужую строку, а создаёт новую; версия, у которой `fileId` вручную указывает на файл задания, — `syllabus.file` отвечает `file_missing`. Тесты — задача 2.
4. **Подложный файл.** `.exe`, `.xlsx`, `.pptx`, `.jpg` по имени — `bad_type`; программа, HTML, Excel под именем `.pdf`/`.docx`; ZIP без `word/document.xml`; `.docx` с `vbaProject.bin`; `.doc` с `_VBA_PROJECT` — `bad_file`; 10 МиБ + 2 байта — `too_big`; пустой — `empty`; base64 с переводом строки — `bad_request`; имя с путём и символом смены направления — чистое имя. Тесты — задача 2.
5. **Жизнь файла вместе с версиями.** «Изменить» у утверждённой — черновик указывает на тот же файл; замена и удаление в черновике не трогают утверждённую; «Утвердить» оставляет файл новой утверждённой, прежняя утверждённая становится архивной со своим файлом; «Вернуть» и «Заполнить из файла» (Excel) ссылку не меняют; уборка никогда не удаляет строку и файл, на которые ссылается хоть одна версия (в том числе архивная), и удаляет через сутки ни на что не указывающие. Тесты — задачи 1, 2, 3.
6. **«Цель курса» необязательна.** Пустая цель — предупреждение `goals/empty`, версия отправляется; без титула или без плана — по-прежнему ошибки; вкладки 4–8 только предупреждают (ошибка `selfWork/bad_unit` остаётся: это неверный номер юнита, а не пустая вкладка). Тесты — задача 1.
7. **Одно чтение каждой таблицы.** `syllabus.attachFile`, `syllabus.dropFile`, `syllabus.file` читают каждую таблицу один раз и пишут одной пачкой на таблицу; `syllabus.get` и `syllabus.form` читают «Файлы» **только** когда у показанной версии есть `fileId` (прежние проверки числа чтений остаются верными без правок). Тесты — задача 2.
8. **Экраны.** Имя файла — только текст; тип `Blob` — из своего списка; двойное нажатие «Прикрепить» не шлёт две загрузки; уход с формы во время загрузки ничего не рисует; студент на 360 px видит «Скачать силлабус (PDF)» высотой не ниже 44 px и без горизонтальной прокрутки. Тесты — задача 4 (чистые помощники), остальное — проверка на стенде.

Проверяющий задач 1–3 отдельно убеждается: каждая проверка «ничего не записано», «в ответе нет чужого», «каждая таблица один раз» написана настоящим `assert` по данным, а не комментарием.

## Чего здесь нет

- Нескольких файлов у одной версии, файлов у тем и юнитов, просмотра Word внутри сайта (скачивается), распознавания текста файла и разбора его в титул (ИИ — в самую последнюю очередь, правило 11).
- Отметки «есть файл» в списке «Силлабусы на утверждении» и в «Предметах»: деканат видит файл, открыв версию.
- Просмотра архивных версий (и их файлов) — его нет и сейчас.
- Удаления файлов утверждённых и архивных версий: хранятся, пока на них ссылается версия.

## Решения плана, которые видят пользователи или которые меняют базу

| Вопрос | Решение | Почему |
| --- | --- | --- |
| Сколько файлов | Один на версию: PDF, `.docx` или `.doc`, до 10 МБ. Не обязателен | ответ владельца 1, 4 |
| Кто прикрепляет, заменяет, убирает | Тот, кто может править версию сейчас (`rightsOn(...).edit`): преподаватель версии в черновике или возвращённой, деканат и администратор; не «на утверждении», не утверждённую. Проректор — нет | ответ 2 |
| Кто скачивает | Кто видит эту версию сегодня: деканат, администратор и проректор (проректор — открытую версию только «на утверждении» и «возвращено», как сейчас), преподаватель версии, заменяющий на паре этого предмета (только утверждённую); студент — только утверждённую, если у его нынешней группы есть предмет этой дисциплины у этого преподавателя и новая версия не «на утверждении» | ответ 3; совпадает с тем, кому `syllabus.get` показывает версию |
| Что обязательно для отправки | Титул и тематический план. «Цель курса» — предупреждение, как вкладки 4–8 | ответ 5 |
| «Изменить» у утверждённой | Черновик указывает на тот же файл; замена в черновике — новый файл, утверждённая остаётся со своим; ни один файл, на который ссылается версия, не удаляется | ответ 6 |
| «Утвердить», «Вернуть», «Заполнить из файла» | Ссылку на файл не меняют; прежняя утверждённая становится архивной вместе со своим файлом | ответ 6 и правило «никогда не удалять файл, на который ссылаются» |
| Заменённый или убранный файл | Через сутки уборка удаляет строку и файл, если ни одна версия на него не ссылается | как незакреплённые загрузки юнита 5 |
| Предел загрузок | Не больше **20** файлов силлабуса в сутки (по Бишкеку) на одного сотрудника — `upload_limit` | место на диске; учебной работе не мешает |
| Где на экранах | Форма: блок «Файл силлабуса» **вверху вкладки «Титул»** (первая вкладка — её видят сразу); страница силлабуса (там же деканат утверждает): кнопка «Файл силлабуса (PDF/Word)» под заголовком; студент — «Скачать силлабус (PDF)» / «(Word)» во всю ширину телефона | проще для владельца: одно место в форме, одно на странице |
| Новая колонка и состояние | `syllabi.fileId` (последняя колонка «файл силлабуса»), состояние «Файлов» `syllabus`. Ничего не удаляется; хранилища дописывают колонку сами при запуске | — |
| Стенд | На `dev:reset` у утверждённого силлабуса «Информатики» (`teacher1`, 1-е полугодие) прикреплён маленький PDF-образец | приёмка по скриншотам без ручной подготовки |

## Модель данных

```js
// core/schema.js
export const FILE_STATES = ['pending', 'attached', 'dropped', 'syllabus'];   // + файл силлабуса
// SCHEMA.syllabi.columns: + col('fileId', 'файл силлабуса') — последней, после manualOrder
```

- `syllabi.fileId` — `''` (файла нет) или id строки «Файлов» с `state: 'syllabus'`. У старых строк — `''`.
- Строка файла силлабуса: `{ assignmentId: '', submissionId: '', ownerId: <id сотрудника, который прикрепил>, state: 'syllabus', name, kind: 'pdf' | 'docx' | 'doc', size, stored, at: 'YYYY-MM-DD HH:MM:SS' }`. Колонка `ownerId` подписана «студент» — подпись не меняем (смена заголовка листа Google ломает сверку шапки); смысл записан здесь.
- Файл в ответах: `{ name, kind, size, at }` (без `id`, `stored`, `ownerId`); `syllabus.file` — `{ name, kind, size, data }`.

## Файлы

```
core/syllabusFlow.js     checkSubmit: «Цель курса» — предупреждение
core/schema.js           syllabi.fileId, FILE_STATES + 'syllabus'
core/files.js            SYLLABUS_FILE_KINDS, SYLLABUS_UPLOADS_PER_DAY
core/permissions.js      syllabus.attachFile, syllabus.dropFile, syllabus.file
core/syllabusDoc.js      draftVersion копирует fileId
backend/syllabusFiles.js            прикрепить, убрать, скачать                                   новый
backend/syllabusDraft.js            fileMetaOf; syllabus.form: + syllabus.file
backend/syllabusData.js             syllabus.get: + syllabus.id, syllabus.file
backend/handlers/syllabus.js        регистрация
backend/node/files.js               sweepFiles: строки силлабуса
dev/seed.js                         PDF-образец у силлабуса стенда
site/js/syllabusForm.js             помощники файла силлабуса без DOM
site/js/views/syllabusAttach.js     блок «Файл силлабуса» в форме                                 новый
site/js/views/syllabusFormTabs.js  syllabusForm.js  syllabus.js  fileView.js  i18n/*.js  css/screens.css
tests/syllabusAttachApi.test.js                                                                    новый
```

Кто делает: **Л** — «Логика» (`journal-logic`), **С** — «Сервер» (`journal-server`), **Э** — «Экраны» (`journal-screens`); после задачи — «Проверяющий» (`journal-reviewer`). Файл чужой зоны агент трогает, только если он прямо назван в его задаче.

---

### Task 1 (Л): «Цель курса» необязательна, колонка файла, права, копия ссылки в черновик

**Files:** Modify `core/syllabusFlow.js`, `core/schema.js`, `core/files.js`, `core/permissions.js`, `core/syllabusDoc.js`; tests `tests/syllabusFlow.test.js`, `tests/syllabusFlowApi.test.js`, `tests/schema.test.js`, `tests/permissions.test.js`, `tests/api.test.js`, `tests/sqliteStore.test.js`, `tests/syllabusDoc.test.js`, `tests/files.test.js`. В прежних тестах правятся только: ожидание ошибок и предупреждений пустого документа (`syllabusFlow.test.js`, тест «checkSubmit: an empty document and a full one»), список ошибок отправки с пробелами (`syllabusFlowApi.test.js`, тест «submit with gaps…»: убрать `['goals', 'goal']`), список колонок `syllabi` (`schema.test.js`, тест «syllabus version fields…»: + `'fileId'` в конце) и `FILE_STATES` (+ `'syllabus'`), списки прав ролей в `permissions.test.js` и `api.test.js` (три новых имени на своих местах по алфавиту), список добавленных колонок в `sqliteStore.test.js` (тест «ensureTables on a unit 4 base…»: + `'syllabi.fileId'` в том порядке, в каком его сообщает хранилище). **Проверка — строгая** (права).

**Produces:**

```js
// core/files.js
export const SYLLABUS_FILE_KINDS = ['pdf', 'docx', 'doc'];
export const SYLLABUS_UPLOADS_PER_DAY = 20;
// core/permissions.js, ROLE_ACTIONS
'syllabus.attachFile': { admin: true, dean: true, teacher: true },
'syllabus.dropFile': { admin: true, dean: true, teacher: true },
'syllabus.file': { admin: true, dean: true, prorector: true, teacher: true, student: true },
// core/syllabusDoc.js — draftVersion: row.fileId = approved ? (approved.fileId || '') : ''
// core/syllabusFlow.js — checkSubmit: вместо ошибки goals/goal/required —
//   warnings.push({ section: 'goals', code: 'empty' }) первым из предупреждений (до literature)
// core/schema.js — раздел «Модель данных»
```

- [ ] **Step 1: тесты.**

```js
// tests/syllabusFlow.test.js — новое ожидание пустого документа
assert.deepEqual(checkSubmit(emptyDoc).errors, [...['department', 'academicYear', 'course', 'planSemester', 'credits'].map((field) => ({ section: 'title', field, code: 'required' })),
  { section: 'plan', code: 'empty' }]);
assert.deepEqual(checkSubmit(emptyDoc).warnings, ['goals', 'literature', 'software', 'policies', 'units'].map((section) => ({ section, code: 'empty' })));
const noGoal = structuredClone(fullDoc);
noGoal.goals.goal = '   ';
assert.deepEqual(checkSubmit(noGoal), { errors: [], warnings: [{ section: 'goals', code: 'empty' }] });
// вкладки 4–8 пустые — только предупреждения
const bare = { ...structuredClone(fullDoc), selfWork: { items: [] }, literature: { main: [], extra: [] }, software: { items: [] },
  policies: { grading: [], behavior: [], ethics: [], sanctionBehavior: '', sanctionEthics: '' }, units: { units: [] } };
assert.deepEqual(checkSubmit(bare).errors, []);
// tests/syllabusFlowApi.test.js — новый тест: версия с титулом и планом, цель '' (save 'goals' с goal: '') ->
//   syllabus.submit -> submitted true, checks.warnings содержит { section: 'goals', code: 'empty' }
// tests/syllabusDoc.test.js
assert.equal(draftVersion({ ...args, approved: { ...version, status: 'approved', fileId: 'fl_9' }, planSemester: 5, course: 3 }).fileId, 'fl_9');
assert.equal(draftVersion({ ...args, approved: { ...version, status: 'approved' }, planSemester: 5, course: 3 }).fileId, '');   // старая строка без колонки
assert.equal(draftVersion({ ...args, approved: null, number: 1, planSemester: 3, course: 2 }).fileId, '');
// tests/schema.test.js
assert.equal(SCHEMA.syllabi.columns.at(-1).key, 'fileId');
assert.deepEqual(FILE_STATES, ['pending', 'attached', 'dropped', 'syllabus']);
// tests/files.test.js
assert.deepEqual([SYLLABUS_FILE_KINDS, SYLLABUS_FILE_KINDS.every((k) => FILE_KINDS.includes(k)), SYLLABUS_UPLOADS_PER_DAY], [['pdf', 'docx', 'doc'], true, 20]);
// tests/permissions.test.js
for (const action of ['syllabus.attachFile', 'syllabus.dropFile']) assert.deepEqual(['admin', 'dean', 'prorector', 'teacher', 'student'].map((r) => can([r], action)), [true, true, false, true, false], action);
assert.deepEqual(['admin', 'dean', 'prorector', 'teacher', 'student'].map((r) => can([r], 'syllabus.file')), [true, true, true, true, true]);
// tests/sqliteStore.test.js — новый тест: база без syllabi.fileId открывается, колонка добавлена, у старой строки fileId === ''
```

- [ ] **Step 2:** `npm test` — новые проверки падают. **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` собирается.
- [ ] **Step 5:** коммит `feat: the syllabus goal is optional; a syllabus version links one file`.

---

### Task 2 (С): прикрепить, убрать и скачать файл силлабуса

**Files:** Create `backend/syllabusFiles.js`, `tests/syllabusAttachApi.test.js`. Modify `backend/handlers/syllabus.js` (три действия), `backend/syllabusDraft.js` (`fileMetaOf`, `draftForm`), `backend/syllabusData.js` (`shownVersion`), `tests/syllabusSetup.js` (`setup({ makeStore, files })`: `files` по умолчанию `undefined` — без ящика, как раньше; кладётся в `ctx.files` и возвращается). Прежние тесты не правятся (если упадёт проверка, сравнивающая весь объект `syllabus` ответа `syllabus.get` или `syllabus.form` целиком, — дописать в ожидание `id`/`file` и указать в отчёте). **Проверка — строгая** (права, данные студентов, файлы).

**Interfaces — Consumes:** `SYLLABUS_FILE_KINDS`, `SYLLABUS_UPLOADS_PER_DAY` (задача 1), `FILE_LIMITS`, `cleanFileName`, `kindByName`, `base64Bytes`, `sniffKind`, `isStoredName` (`core/files.js`); `rightsOn`, `versionsOf` (`core/syllabusFlow.js`); `plainId` (`core/syllabusSections.js`); `viewerOf`, `versionOf` (`backend/syllabusDraft.js`); `todayOf` (`backend/scheduleData.js`); `localDate`, `localDateTime` (`core/dates.js`); `ctx.files` (ящик юнита 5: `put`, `read`, `decode`, `encode`); в тестах `createMemoryFiles` (`tests/fakes/memoryFiles.js`), `SAMPLE`, `FAKE`, `b64` (`tests/fakes/sampleFiles.js`).

**Produces:**

```js
// backend/syllabusFiles.js
export function attachSyllabusFile(store, platform, files, data, user);   // 'syllabus.attachFile' { syllabusId, name, data } -> { file: { name, kind, size, at } }
export function dropSyllabusFile(store, platform, files, data, user);     // 'syllabus.dropFile' { syllabusId } -> { file: null }
export function readSyllabusFile(store, platform, files, data, user);     // 'syllabus.file' { syllabusId } -> { file: { name, kind, size, data } }
// backend/syllabusDraft.js
export function fileMetaOf(store, version);   // version.fileId пуст -> null без чтения; иначе одна store.list('files'):
                                              // строка с этим id и state 'syllabus' -> { name, kind, size, at }, иначе null
// syllabus.form: syllabus.file = fileMetaOf(...) — последним ключом объекта syllabus
// syllabus.get:  syllabus = { id: version.id, ...прежние поля, file: fileMetaOf(...) } (у shownVersion) — id первым, file последним
```

Правила `attachSyllabusFile` — порядок, первая сработавшая отвечает, до записи на диск ничего не пишется:

1. `files` нет — `files_unavailable`.
2. `plainId(data.syllabusId)` — `null` → `bad_request`; версии нет → `not_found` (`versionOf`).
3. `rights = rightsOn(version, viewerOf(user, version, subjects))`: `!rights.see` → `forbidden`; `!rights.edit` → `syllabus_locked`.
4. `name = cleanFileName(data.name)`, `kind = kindByName(name)`; `kind` не из `SYLLABUS_FILE_KINDS` → `invalid` `[{ field: 'name', code: 'bad_type' }]`.
5. `base64Bytes(data.data)`: `null` → `bad_request`; `0` → `invalid` `data/empty`; больше `FILE_LIMITS.maxBytes` → `invalid` `data/too_big`.
6. Строки «Файлов» `ownerId === user.id`, `state === 'syllabus'`, дата `at` — сегодня по Бишкеку: уже `SYLLABUS_UPLOADS_PER_DAY` → `upload_limit`.
7. `bytes = files.decode(data.data)`; `sniffKind(bytes, kind)` — `null` → `invalid` `data/bad_file`.
8. `stored = platform.randomHex(16) + '.bin'`; `files.put(stored, bytes)`; одна `insertMany('files')` (строка раздела «Модель данных», `size: bytes.length`, `at: localDateTime(now)`); одна `updateMany('syllabi')` `{ fileId: <новый id>, updated: todayOf(platform), editedBy: user.id }`. Поле `data.fileId`, если есть, не читается.

`dropSyllabusFile`: шаги 1–3; у версии `fileId` пуст — ответ `{ file: null }` без записи; иначе одна `updateMany('syllabi')` `{ fileId: '', updated, editedBy }`. Строку «Файлов» и диск не трогает.

`readSyllabusFile`:

1. `files` нет — `files_unavailable`; `plainId` — `bad_request`; версии нет — `not_found`.
2. **Студент** (`user.kind === 'student'`) может, только если: `version.status === 'approved'`; среди `subjects` есть предмет с `disciplineId`, `teacherId` версии и `groupId === user.row.groupId` (непустой); `versionsOf(syllabi, ключ версии).open` — не в статусе `review`. Иначе `not_found`.
3. **Сотрудник:** открытая версия (`draft`, `review`, `returned`) — `rightsOn(...).see`; утверждённая — роль `admin`/`dean`/`prorector`, или `viewerOf(...).teaches && version.teacherId === user.id` с ролью `teacher`, или (только тогда читается `pairs`) он ведёт пару (`pair.teacherId === user.id`) предмета этой дисциплины этого преподавателя; архивная — нет. Иначе `forbidden`.
4. `fileId` пуст — `not_found`. Строки нет, `state !== 'syllabus'`, `kind` не из `SYLLABUS_FILE_KINDS` или `!isStoredName(stored)` — `file_missing`; `files.read(stored) === null` — `file_missing`.
5. Ответ `{ file: { name, kind, size, data: files.encode(bytes) } }`. Ничего не пишет.

Каждая таблица — один раз за запрос; `pairs` — только в случае 3 «заменяющий».

- [ ] **Step 1: тесты** (`tests/syllabusAttachApi.test.js`; `setup({ files: createMemoryFiles() })`, «сейчас» — 2026-08-31 12:00 по Бишкеку).

```js
const id = draft(sb1, 1, teacher1);
const attach = (data, token = teacher1) => call('syllabus.attachFile', { syllabusId: id, name: 'Силлабус.pdf', data: b64(SAMPLE.pdf), ...data }, token);
const state = () => JSON.stringify([store.list('syllabi'), store.list('files'), files.names()]);
const before = state();
assert.equal(attach({}, teacher2).error.code, 'forbidden');
for (const token of [prorector, s1, undefined]) assert.notEqual(attach({}, token).ok, true);
for (const bad of [[id], 7, ` ${id} `, null]) assert.equal(attach({ syllabusId: bad }).error.code, 'bad_request');
assert.equal(attach({ syllabusId: 'sy_missing' }).error.code, 'not_found');
for (const [name, bytes, code] of [['a.xlsx', SAMPLE.xlsx, 'bad_type'], ['a.pptx', SAMPLE.pptx, 'bad_type'], ['a.jpg', SAMPLE.jpg, 'bad_type'], ['a.exe', FAKE.exe, 'bad_type'],
  ['a.pdf', FAKE.exe, 'bad_file'], ['a.pdf', FAKE.html, 'bad_file'], ['a.pdf', SAMPLE.docx, 'bad_file'], ['a.docx', SAMPLE.xlsx, 'bad_file'],
  ['a.docx', FAKE.zip, 'bad_file'], ['a.docx', FAKE.docm, 'bad_file'], ['a.doc', FAKE.docMacro, 'bad_file']]) {
  assert.equal(attach({ name, data: b64(bytes) }).error.fields[0].code, code, name);
}
assert.equal(attach({ data: 'QUJD\n' }).error.code, 'bad_request');
assert.deepEqual(attach({ data: '' }).error.fields, [{ field: 'data', code: 'empty' }]);
assert.deepEqual(attach({ data: 'A'.repeat(13981016) }).error.fields, [{ field: 'data', code: 'too_big' }]);
assert.equal(state(), before);
const file = attach({ name: '..\\..\\x/Силлабус\u202E.pdf', fileId: 'fl_any' }).data.file;
assert.deepEqual(file, { name: 'Силлабус.pdf', kind: 'pdf', size: SAMPLE.pdf.length, at: '2026-08-31 12:00:00' });
const version = store.get('syllabi', id);
const row = store.get('files', version.fileId);
assert.deepEqual([row.state, row.assignmentId, row.submissionId, row.ownerId, version.editedBy, version.updated, files.names()],
  ['syllabus', '', '', staff.teacher1, staff.teacher1, '2026-08-31', [row.stored]]);
assert.deepEqual(call('syllabus.form', { syllabusId: id }, teacher1).data.syllabus.file, file);
```

Дальше — настоящими `assert` (каждый отказ — со снимком `state()` до и после):

- **Читать файл:** `teacher1` и `dean` — ответ, `Object.keys(file)` ровно `['name', 'kind', 'size', 'data']`, байты (`Buffer.from(data, 'base64')`) равны `SAMPLE.pdf`; `prorector` у черновика — `forbidden`; `s1` и `s2` у черновика — `not_found`; `teacher2` — `forbidden`.
- **Замена и удаление в черновике:** второй `attach` (`SAMPLE.docx`, `a.docx`) — новый `fileId`, прежняя строка осталась (`syllabus`), в ящике два имени; `syllabus.dropFile` — `{ file: null }`, `fileId` `''`, строки и ящик не изменились; второй `dropFile` — `{ file: null }` и ни одной записи (шпион `writes` пуст); `syllabus.file` без файла — `not_found`.
- **Статусы:** после `syllabus.submit` (версия заполнена `fill`; цель может быть пустой) `attach` и `dropFile` у `teacher1` и у `dean` — `syllabus_locked`; проректор читает файл версии «на утверждении». `syllabus.return` — `fileId` тот же, `teacher1` снова может заменить. `syllabus.approve` — `fileId` тот же; `attach` к утверждённой — `syllabus_locked`.
- **Кто читает утверждённую:** `dean`, `prorector`, `teacher1`, `s1` (группа 01-1, `sb1`), `s2` (02-1, `sb3` — та же дисциплина и тот же преподаватель) — да; `teacher2` — `forbidden`, после `schedule.changePair` (пара `sb1` 2026-09-08 → `teacher2`) — да. Файл утверждённой «Анатомии» `teacher2` (`sb2`, группа 02-1): `s2` — да, `s1` — `not_found`.
- **«Изменить»:** `draft(sb1, 1, teacher1)` после утверждения — у нового черновика `fileId` равен `fileId` утверждённой; `attach` в черновике меняет только черновик; `dropFile` в черновике — у утверждённой `fileId` прежний, `s1` скачивает прежние байты. После отправки черновика (`review`) `s1` — `not_found` (утверждённая скрыта, как в `syllabus.get`), `dean` читает обе. Утверждение черновика: прежняя утверждённая — `archived` со своим `fileId`, `syllabus.file` у архивной для `dean` — `forbidden`, новая утверждённая отдаёт свой файл.
- **«Заполнить из файла»:** у черновика с файлом `send('syllabus.apply', sb1, A, teacher1)` — `fileId` не изменился; у ключа только с утверждённой версией (с файлом) `syllabus.apply` создаёт черновик с тем же `fileId`.
- **Номер не переносится:** id строки файла силлабуса в `work.file` у `teacher1`, `dean`, `s1` — `not_found`; в `work.dropFile` у `s1` — `not_found`. Версия, у которой `fileId` вручную (через `store.update`) указывает на строку с `state: 'attached'`, — `syllabus.file` → `file_missing`; на несуществующую строку — `file_missing`; строка есть, а в ящике файла нет — `file_missing`.
- **Предел:** 20 строк `{ state: 'syllabus', ownerId: staff.teacher1, at: '2026-08-31 09:00:00', … }` прямо в хранилище — `attach` → `upload_limit`, ничего не записано; у `dean` в тот же день — можно.
- **Без ящика** (`setup()`): `attach`, `dropFile`, `syllabus.file` — `files_unavailable`; `syllabus.form` и `syllabus.get` работают, `file: null`.
- **Страница:** `syllabus.get { subjectId: sb1 }` у `s1` — `syllabus.id` — id утверждённой версии, `syllabus.file` — `{ name, kind, size, at }`; JSON ответов `syllabus.get`, `syllabus.form`, `syllabus.attachFile` не содержит `stored` строки и строки `"ownerId"`.
- **Чтения и записи:** `attach` — `lists` ровно `{ syllabi: 1, subjects: 1, files: 1 }`, `writes` ровно `{ 'insertMany:files': 1, 'updateMany:syllabi': 1 }`; `syllabus.file` у `s1` — `{ syllabi: 1, subjects: 1, files: 1 }`, без записей; у заменяющего `teacher2` — плюс `pairs: 1`; `syllabus.form` и `syllabus.get` версии с файлом — в прежних наборах плюс `files: 1`, без файла — прежние наборы без `files`.

- [ ] **Step 2:** `npm test` — падает. **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` собирается.
- [ ] **Step 5:** коммит `feat: attach, replace, remove and download the file of a syllabus version`.

---

### Task 3 (С): уборка не трогает файлы версий; PDF-образец на стенде

**Files:** Modify `backend/node/files.js` (`sweepFiles`), `dev/seed.js`, `tests/filesBox.test.js` (новые проверки), `tests/seedWork.test.js` (только тест «seedWork: one PNG picture on the disk…»: строки «Файлов» и имена ящика считать без строк `state: 'syllabus'`; другие прежние ожидания числа файлов стенда, если упадут, — так же, с перечнем в отчёте). **Проверка — строгая** (файлы удаляются с диска).

**Interfaces — Consumes:** `sweepFiles` (как есть), таблица `syllabi.fileId`, состояние `syllabus` (задача 1); `publishSyllabusDoc` уже утверждает силлабусы стенда.

**Produces:**

```js
// backend/node/files.js — sweepFiles({ store, dir, nowMs, keepMs, graceMs }) -> { rows, files }  (подпись прежняя)
// читает 'files' и 'syllabi' по одному разу; used = Set непустых syllabi.fileId;
// мёртвые строки: (pending | dropped) или (syllabus и id не в used), и nowMs - at > keepMs — одна removeMany;
// живые имена на диске: строки не мёртвые в состоянии pending, attached или syllabus
// dev/seed.js
export function seedSyllabusFile(store, platform, files);   // files нет -> ничего; иначе маленький настоящий PDF (одна страница, латинский текст
// «Syllabus sample», < 2000 байт, sniffKind(...,'pdf') === 'pdf') кладётся в ящик и прикрепляется к утверждённой версии «Информатика» teacher1, 1-е полугодие:
// строка «Файлов» { state: 'syllabus', ownerId: <id деканата стенда>, name: 'Силлабус — Информатика.pdf', kind: 'pdf', … } и syllabi.fileId — пачками.
// Вызывается из seed() после fill(); seedDemo — без изменений.
```

- [ ] **Step 1: тесты.**

```js
// tests/filesBox.test.js — уборка (временная папка, mtime через fs.utimesSync, как в прежних тестах); syllabi: v1 approved fileId A, v0 archived fileId B
// строки: A (syllabus, 25 ч, у v1), B (syllabus, 25 ч, у архивной v0), C (syllabus, 25 ч, ни у кого), D (syllabus, 1 ч, ни у кого); файлы на диске у всех — 2 ч
// -> { rows: 1, files: 1 }; строки A, B, D остались, C удалена; на диске остались A, B, D, файл C удалён
// второй проход — { rows: 0, files: 0 }; шпион хранилища: list 'files' и 'syllabi' — по одному разу
// tests/seedWork.test.js — seed с ящиком: ровно одна строка state 'syllabus', kind 'pdf'; на неё ссылается утверждённая версия «Информатика» teacher1;
//   sniffKind(files.read(row.stored), 'pdf') === 'pdf'; без ящика — строк 'syllabus' нет, у всех версий fileId ''; seedDemo — строк 'syllabus' нет
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` собирается (в сборку `backend/node/` и `dev/` не входят).
- [ ] **Step 5:** коммит `feat: the sweep keeps every file a syllabus version links; the stand has a sample syllabus file`.

---

### Task 4 (Э): экраны — блок «Файл силлабуса» в форме, кнопка на странице, студент на телефоне — блок приёмки

**Files:** Create `site/js/views/syllabusAttach.js`. Modify `site/js/syllabusForm.js` (помощники), `site/js/views/syllabusFormTabs.js` (`titleTab`), `site/js/views/syllabusForm.js` (`context`, `leave`), `site/js/views/syllabus.js` (строка файла под заголовком), `site/js/views/fileView.js` (параметр `request`), `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/syllabusForm.test.js` (только новые проверки). Скриншоты — `.superpowers/sdd/plan-syllabus-file/task-4-shots/`. **Проверка ИИ — да** (sonnet): имя файла только текстом, тип `Blob` из своего списка, студент видит кнопку только у утверждённой версии; остальное владелец принимает по скриншотам.

**Interfaces — Consumes:** ответы задачи 2 (`syllabus.form` → `syllabus.file`, `can.edit`; `syllabus.get` → `syllabus.id`, `syllabus.file`; действия `syllabus.attachFile`, `syllabus.dropFile`, `syllabus.file`); `upload`, `call`, `RETRYABLE` (`site/js/api.js`); `readAsBase64` (`site/js/photo.js`); `kindOfName`, `uploadErrorCode`, `sizeText`, `mayStillSend` (`site/js/work.js`); `modal`, `showModal`, `note`, `errorKey` (`site/js/ui.js`).

**Produces:**

```js
// site/js/syllabusForm.js (без DOM)
export const SYLLABUS_FILE_KINDS = ['pdf', 'docx', 'doc'];
export function syllabusFileProblem({ name, size });  // -> null | 'sform.file.error.bad_type' | 'sform.file.error.too_big' | 'sform.file.error.empty' (вид по kindOfName; предел 10485760)
export function syllabusFileErrorKey(error);          // uploadErrorCode(error): bad_type, bad_file, too_big, empty, upload_limit, files_unavailable, syllabus_locked
                                                      //   -> 'sform.file.error.<код>'; upload_slow -> 'work.upload.error.upload_slow'; иначе null (экран берёт errorKey)
export function fileDownloadKey(kind);                // pdf -> 'syllabus.file.download.pdf'; docx, doc -> 'syllabus.file.download.word'; иначе null
// site/js/views/fileView.js
export function openFile({ fileId, name, kind, host = document.body, request = () => call('work.file', { fileId }) });   // прежние вызовы не меняются
// site/js/views/syllabusAttach.js
export function fileBlock({ syllabusId, file, canEdit, onChange });   // -> Element: блок «Файл силлабуса»; onChange(file | null) после успеха
export function leaveAttach();                                         // уход с формы: ответ загрузки, пришедший позже, ничего не рисует
```

Что на экранах:

1. **Форма, вкладка «Титул», первым блоком** (`section.sform-file`, id `sf-file`): заголовок «Файл силлабуса», подсказка; нет файла — «Файл не прикреплён»; есть — кнопка-имя файла (открывает `openFile` с `request: () => call('syllabus.file', { syllabusId })`), строка «PDF · 1,2 МБ · загружен 24.11.2026». При `can.edit` — «Прикрепить файл» (нет файла) или «Заменить» и «Убрать» (есть). Выбор: скрытый `input type=file`, `accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"`; `syllabusFileProblem` до чтения; затем `readAsBase64` → `upload('syllabus.attachFile', …, { onProgress })` с `<progress>` и «Загрузка… N%»; пока идёт загрузка, кнопки блока выключены (вторая загрузка не начинается). Ошибка — текст под блоком (`syllabusFileErrorKey` или `errorKey`), при `RETRYABLE`/`upload_slow` — «Повторить» без повторного выбора. «Убрать» — окно подтверждения, затем `call('syllabus.dropFile')`. Успех — `onChange` обновляет `state.form.syllabus.file`, короткая заметка «Файл прикреплён» / «Файл убран». Блок не участвует в «несохранённых изменениях» вкладки «Титул». Только чтение (проректор, версия «на утверждении», утверждённая) — имя файла и открытие, без кнопок правки.
2. **Страница силлабуса** (`#/syllabus/…`, в том числе `/draft`, где деканат утверждает): если у показанной версии есть `syllabus.file` — под заголовком кнопка id `syllabus-file` с ключом `fileDownloadKey(kind)` и размером; нажатие — `openFile({ name, kind, request: () => call('syllabus.file', { syllabusId: view.syllabus.id }) })`. Для студента кнопка во всю ширину на экране до 600 px, высота не ниже 44 px, текст 16 px.
3. **Отправка на утверждение:** пустая «Цель курса» попадает в окно «Не заполнено (необязательно)» вместе с вкладками 4–8 — уже делает прежний `submitDialog` по предупреждению `goals/empty`; проверить на стенде, кода не нужно.

Словарь (ключи одинаковые в трёх словарях; русский текст — дословно; `ky` и `en` пишет агент, `ky` потом уходит на вычитку):

| Ключ | ru |
| --- | --- |
| `sform.file.title` | Файл силлабуса |
| `sform.file.hint` | Полный силлабус колледжа: PDF или Word, до 10 МБ. Необязательно. |
| `sform.file.none` | Файл не прикреплён |
| `sform.file.meta` | {kind} · {size} · загружен {date} |
| `sform.file.attach` | Прикрепить файл |
| `sform.file.replace` | Заменить |
| `sform.file.remove` | Убрать |
| `sform.file.removeAsk` | Убрать файл из этой версии? У утверждённой версии её файл останется. |
| `sform.file.uploading` | Загрузка… {n}% |
| `sform.file.retry` | Повторить |
| `sform.file.done` | Файл прикреплён |
| `sform.file.removed` | Файл убран |
| `sform.file.error.bad_type` | Подходит только PDF или Word (.pdf, .docx, .doc) |
| `sform.file.error.bad_file` | Файл повреждён, не того вида или с макросами. Сохраните его заново как PDF |
| `sform.file.error.too_big` | Файл больше 10 МБ. Сохраните его как PDF поменьше |
| `sform.file.error.empty` | Файл пустой |
| `sform.file.error.upload_limit` | На сегодня загружено слишком много файлов, попробуйте завтра |
| `sform.file.error.files_unavailable` | На этом сервере файлы не принимаются |
| `sform.file.error.syllabus_locked` | Версия на утверждении или утверждена: файл менять нельзя |
| `syllabus.file.download.pdf` | Скачать силлабус (PDF) |
| `syllabus.file.download.word` | Скачать силлабус (Word) |

- [ ] **Step 1: тесты** (`tests/syllabusForm.test.js`).

```js
assert.deepEqual([{ name: 'Силлабус.PDF', size: 10 }, { name: 'a.docx', size: 10485760 }, { name: 'a.doc', size: 1 }].map(syllabusFileProblem), [null, null, null]);
assert.deepEqual([{ name: 'a.xlsx', size: 1 }, { name: 'a.jpg', size: 1 }, { name: 'a', size: 1 }, { name: 'a.pdf', size: 10485761 }, { name: 'a.pdf', size: 0 }].map(syllabusFileProblem),
  ['sform.file.error.bad_type', 'sform.file.error.bad_type', 'sform.file.error.bad_type', 'sform.file.error.too_big', 'sform.file.error.empty']);
assert.deepEqual([{ code: 'invalid', fields: [{ field: 'data', code: 'bad_file' }] }, { code: 'syllabus_locked' }, { code: 'too_big' }, { code: 'upload_slow' }, { code: 'network' }, { code: 'forbidden' }]
  .map(syllabusFileErrorKey), ['sform.file.error.bad_file', 'sform.file.error.syllabus_locked', 'sform.file.error.too_big', 'work.upload.error.upload_slow', null, null]);
assert.deepEqual(['pdf', 'docx', 'doc', 'xlsx', undefined].map(fileDownloadKey),
  ['syllabus.file.download.pdf', 'syllabus.file.download.word', 'syllabus.file.download.word', null, null]);
```

- [ ] **Step 2:** падает. **Step 3:** написать экраны и словари. **Step 4:** `npm test` зелёное (в том числе `tests/i18n.test.js`); `npm run build:gas` собирается.
- [ ] **Step 5: стенд и скриншоты** (свой `npm run dev:reset`, headless Chrome, остановка только своих PID), в `task-4-shots/`: (1) `teacher1`, новый черновик, «Титул» без файла; (2) ход загрузки; (3) файл прикреплён — имя, размер, «Заменить», «Убрать» — тёмная и светлая темы; (4) ошибка `.xlsx`; (5) `dean`, страница версии «на утверждении» — кнопка «Файл силлабуса»; (6) `S1001`, 360 px — «Скачать силлабус (PDF)» и открытое окно файла — обе темы; (7) отправка с пустой целью — окно «необязательно» с «Цель курса». На каждом экране нет горизонтальной прокрутки (проверка `document.documentElement.scrollWidth <= innerWidth` в отчёте).
- [ ] **Step 6:** коммит `feat: the syllabus file on the form, on the syllabus page and on the student's phone`.

**Блок приёмки (владелец).** Координатор сам смотрит 1–2 скриншота, затем поднимает `journal-dev-reset`, входит за владельца и даёт список «что посмотреть»: (1) `teacher1` прикрепляет PDF на «Титуле», заменяет на Word, убирает; (2) отправляет без «Цели курса»; (3) `dean` открывает версию на утверждении, скачивает файл, утверждает; (4) студент `S1001` во второй вкладке на `127.0.0.1:5273` видит «Скачать силлабус (PDF)» и открывает его; (5) `teacher1` нажимает «Изменить», меняет файл в черновике — у студента прежний файл. Заметки — `aidlc-docs/construction/syllabus-file/замечания.md`; правки — тому же агенту, проверка — только правок.

---

### Task 5 (координатор и владелец): общая проверка, выкладка

- [ ] Общая проверка (opus, строгая): `git diff bda6d52..HEAD`, пробные скрипты против настоящего кода по разделу Review Focus; находки — в `.superpowers/sdd/plan-syllabus-file/final-review-findings.md` (координатор сохраняет сам), копия — `aidlc-docs/construction/syllabus-file/sdd/final-review-findings.md`.
- [ ] Одна волна исправлений одним агентом, повторная проверка тем же проверяющим (только правок); `npm test`, `npm run build:gas`.
- [ ] Решения плана — в таблицу решений `aidlc-state.md`; новые ключи `ky` — в список на вычитку; известное ограничение: «на Apps Script файла силлабуса нет; Word скачивается, не показывается».
- [ ] Выкладка — **только по просьбе владельца**, порядок из `CLAUDE.md` («Обновление сервера»): сервер (колонка `syllabi.fileId` добавится при запуске сама), затем `git push` сайта; выложенный коммит — в `aidlc-state.md`. Проверка с телефона: студент скачивает PDF утверждённого силлабуса.

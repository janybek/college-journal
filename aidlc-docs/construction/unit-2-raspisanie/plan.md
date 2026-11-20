# Юнит 2 «Расписание и темы»: план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** деканат задаёт даты семестра, звонки, недельный шаблон и темы; журнал сам создаёт пары на семестр и раскладывает по ним темы; замена, перенос и отмена пары пересчитывают темы; преподаватель и студент видят своё расписание с темами.

**Architecture:** правила (даты, проверка настроек, создание пар, раскладка тем, проверка изменения пары) — чистые функции в `core/`. Сервер в `backend/` читает нужные листы по одному разу, считает через `core/` и пишет пачкой. Три новых листа: «Шаблон недели», «Темы», «Пары»; настройки семестра лежат в уже существующем листе «Настройки». Шаблон и темы идут через готовые действия `dir.*` и `import.*`, расписание — через новые `settings.*`, `schedule.*`, `topics.plan`. Сайт получает шесть новых экранов.

**Tech Stack:** как в юните 1 — Node 24, ES-модули, `node --test`, esbuild только для сборки под Apps Script, SheetJS 0.20.3 из `site/vendor/`, Google Apps Script V8, clasp. Новых зависимостей нет.

**Spec:** `aidlc-docs/inception/design-v1.md` (разделы 3, 6 «Расписание и темы», 8, 9, 12), `aidlc-docs/inception/ТЗ.md` (разделы 4, 6, 11, 12), таблица решений в `aidlc-docs/aidlc-state.md` (запись 21.11.2026: подгрупп нет, расписание одинаковое каждую неделю, занятия понедельник–пятница, темы вводит деканат).

## Global Constraints

- `core/` и `backend/` без зависимостей из npm. Dev-зависимости проекта: `esbuild`, `xlsx`, `@fontsource-variable/inter`. Новые не добавляются.
- Сайт: без сборки, без фреймворков, ничего не загружает с чужих адресов. Шрифт Inter лежит в `site/vendor/fonts/`.
- Все обработчики сервера синхронные. `handleRequest` никогда не бросает исключение и всегда возвращает объект ответа.
- Запрос сайта: `POST`, `Content-Type: text/plain;charset=utf-8`, тело — JSON `{action, token, data}`. Своих заголовков нет.
- `passwordHash` никогда не попадает в ответ сервера. Ответы о расписании собираются по полям; строки сотрудников и студентов в ответ целиком не копируются.
- Время берётся только из `platform.now()`. `Date.now()` в `core/` и `backend/` запрещён. «Сегодня» — это `localDate(platform.now())` по времени Бишкека (UTC+6 круглый год). Сайт часам устройства не доверяет: «сегодня» он берёт из поля `today` ответа сервера.
- Дата везде — строка `'YYYY-MM-DD'`, время — строка `'HH:MM'`: в хранилище, в запросах, на сайте. Объектов `Date` в строках хранилища нет.
- В таблице хранятся английские коды (`planned`, `lecture`), на экране они переводятся словарём.
- Заголовки листов — русские названия из схемы; код находит колонки по названию, а не по номеру.
- Скорость на Google: обработчик читает каждый лист не больше одного раза за запрос и пишет пачкой (`insertMany`, `updateMany`, `removeMany`). `store.get`, `store.update`, `store.remove` в цикле по парам запрещены.
- Роли: `admin`, `dean`, `prorector`, `teacher`, `student`. У сотрудника роли хранятся строкой через запятую.
- Любая фраза на экране идёт через ключ словаря. Наборы ключей в `ky`, `ru`, `en` одинаковые. Язык по умолчанию — `ky`. Названия дней и месяцев тоже из словаря, без `Intl`: на старых телефонах кыргызского там нет.
- Данные с сервера, от пользователя и из файлов попадают на страницу только как текст (`textContent`, помощники из `site/js/ui.js`), никогда через `innerHTML`.
- Цвета — hex или rgb, без `oklch()`. Новые экраны берут цвета и размеры из переменных `site/css/app.css`. Код и картинки платного шаблона не копируются.
- Две темы, тёмная по умолчанию; каждый экран проверяется в обеих.
- Студенческие экраны — для телефона шириной 360 px: без бокового меню, текст не мельче 16 px, кнопки и ссылки-кнопки не ниже 44 px.
- Настоящих данных студентов и сотрудников в репозитории нет. Данные стенда вымышленные. `dev/data/` и `build/` — в `.gitignore`.
- Локальный стенд — только порт 5273.
- Хэширование паролей (`HASH_ROUNDS = 100`, `TEMP_HASH_ROUNDS = 20`) в этом юните не меняется.
- Сообщения коммитов на английском; в конце строка `Co-Authored-By` с той моделью, которая на самом деле писала коммит.
- `git push` и выкладка в Google — только по прямой просьбе владельца. Адрес опубликованного Apps Script не меняется: обновляется существующая публикация.
- У пары вся группа целиком (подгрупп нет). Расписание одинаковое каждую неделю. В шаблоне дни с понедельника по пятницу.

## Review Focus

1. **Отмена или перенос пары посреди семестра.** Ожидание: темы следующих непроведённых пар предмета сдвигаются, у проведённой пары (статус `running` или `closed`) тема остаётся прежней, более ранние пары не затронуты. Тесты — задачи 3 и 7.
2. **«Создать расписание» нажато второй раз** — после правки шаблона, после сбоя на середине или двумя людьми. Ожидание: дублей нет, ручные изменения (замена, перенос, отмена) и проведённые пары целы, прошедшие даты не тронуты, случайный дубль убирается следующим запуском. Тесты — задачи 4 и 6.
3. **Повторный импорт тем со сдвинутой нумерацией, когда часть пар уже проведена.** Ожидание: тему проведённой пары импорт не переписывает (ошибка в этой строке файла), остальные строки загружаются, темы непроведённых пар пересчитываются. Тесты — задачи 3 и 6.
4. **Полночь и часовой пояс.** Запрос в 00:30 по Бишкеку (18:30 UTC предыдущего дня) считает «сегодня» по Бишкеку. Дата пары, которую администратор поправил руками в таблице (ячейка стала датой Google), читается тем же днём, а не предыдущим. Тесты — задачи 1, 2 и 7.
5. **Двое в одном месте.** Группа, преподаватель или аудитория не оказываются на двух парах сразу — ни в шаблоне, ни после переноса или замены. Отменённая пара место не занимает. Тесты — задачи 3, 4 и 7.
6. **Чужое расписание.** Студент видит только пары своей группы, преподаватель — только свои (включая пары, где он заменяет), преподаватель не может менять пары и смотреть план чужого предмета, проректор только смотрит. Тесты — задачи 6 и 7.

Дополнение от 21.11.2026 (задачи 14–20):

7. **Повторная загрузка силлабуса со сдвинутой нумерацией, когда часть пар проведена.** Ожидание: тему проведённой пары файл не переписывает (ошибка `held` в этой строке), остальные строки загружаются, темы непроведённых пар пересчитываются. Тесты — задачи 16 и 18.
8. **Чужой предмет.** Преподаватель не может загрузить силлабус, добавить, изменить или удалить тему предмета, который ведёт не он, — ни с экрана, ни прямым запросом с чужим `subjectId` или id чужой темы. Проректор только смотрит. Тесты — задача 18.
9. **Смена семестра.** После переключения «1 → 2» темы второго семестра встают только на непроведённые пары в датах семестра; проведённые пары не меняются; у непроведённой пары вне дат семестра снимается только тема текущего семестра (одна тема не стоит на двух парах — например, после сдвига начала семестра), тема другого семестра на ней остаётся; сохранение настроек со страницы, которая про семестр не знает (поле не прислано), семестр не сбрасывает. Тесты — задачи 16 и 17.
10. **Старые строки тем без семестра.** Они считаются семестром 1 везде: в раскладке, в проверке повтора №, в импорте (строка обновляется, а не появляется второй раз), на экране. Тесты — задачи 16 и 17.
11. **Один и тот же № в двух семестрах** — не повтор; повтор внутри семестра — ошибка в строке. Файл на год, где нумерация тем и модулей в каждом семестре начинается с 1, загружается целиком. Тесты — задачи 16 и 18.
12. **Время звонка не из списка** (сохранено раньше или пришло не с экрана). Ожидание: экран его показывает и не теряет при сохранении других полей; из списка нельзя выбрать время, при котором пара закончится после 23:59. Тесты — задача 14.

Проверяющий задач 14, 17, 18 и 20 отдельно убеждается: каждая проверка, которую задача описывает словами (скорость, слова типа пары, «прежние проверки остаются»), написана настоящим `assert` в тесте, а не оставлена комментарием.

## Чего в юните 2 нет

- Кнопки «Начать пару», таймера, QR и отметки: это юнит 3. Статусы `running`, `closed`, `missed` в юните 2 только объявлены и учитываются в правилах; выставлять их начнёт юнит 3. Там же решается, когда прошедшая неначатая пара становится «не проведена» и отдаёт свою тему следующей.
- Колонок «фактический старт» и «секрет QR» в листе «Пары» и колонки «материал» в листе «Темы»: их добавит тот юнит, которому они нужны (`ensureSheets` дописывает колонки сам).
- Экрана деканата «Сейчас идёт» (версия 2), подгрупп, недель «числитель / знаменатель», субботы в шаблоне.
- Записи замен и переносов в «Журнал изменений» (юнит 6) — пока остаётся только примечание у пары. Объявлений и уведомлений о переносе.
- ~~Правки тем преподавателем: он только видит.~~ Отменено дополнением от 21.11.2026 (задачи 16–20): преподаватель сам загружает и правит силлабус своего предмета. Копирования тем из одной группы в другую кнопкой по-прежнему нет.
- Печати и выгрузки расписания в Excel.
- Кеша и ограничения попыток входа (юнит 3).

## Решения плана, которые видит пользователь или которые меняют базу

Координатор показывает их владельцу вместе с `owner-summary.md` и после согласия переносит в таблицу решений `aidlc-state.md`.

| Решение | Значение по умолчанию |
| --- | --- |
| Три новых листа: «Шаблон недели», «Темы», «Пары»; настройки семестра — четыре строки в листе «Настройки» | колонки — в задаче 2 |
| Звонки — настройка, пара 90 минут | 08:00, 09:40, 11:20, 13:30, 15:10, 16:50 |
| Статусы пары | запланирована, идёт, закрыта, не проведена, отменена |
| Аудитория в шаблоне и у пары не обязательна | — |
| Группа, преподаватель и аудитория не могут быть на двух парах сразу (общих лекций потока нет) | ошибка при сохранении |
| Перенос — на любой день семестра с понедельника по субботу, кроме нерабочих и прошедших | суббота разрешена |
| Пары прошедших дней менять нельзя | — |
| Менять расписание могут администратор и деканат; проректор и преподаватель смотрят | — |
| Тема привязана к предмету конкретной группы; в файле импорта тем есть столбец «Группа» | — |
| Импорт не меняет тему уже проведённой пары; вручную деканат может исправить в ней опечатку | — |
| «Создать расписание» при повторном запуске обновляет только будущие пары, не тронутые вручную | — |
| «Начать заново» (удалить все пары и создать снова) доступно, пока ни одна пара не проводилась | — |
| Тем меньше, чем пар — последние пары «без темы»; тем больше — экран «Темы» показывает, какие не поместились | — |
| **Дополнение от 21.11.2026 (задачи 14–20).** Координатор показывает эти строки владельцу вместе с `owner-summary-2.md` | |
| Время звонка выбирается из списка: каждые 5 минут с 07:00 до 22:25 (186 значений). Правило сервера прежнее: пара 90 минут, конец не позже 23:59 | время не из списка, сохранённое раньше, стоит в списке первой строкой «08:02 — вне списка» и не теряется, пока его не заменят |
| В «Расписании» в режиме «По группе» название дня с понедельника по пятницу — ссылка на «Шаблон недели» этой группы; столбец этого дня там подсвечен | у субботы и воскресенья (их нет в шаблоне) и в режиме «По преподавателю» (там нет одной группы) ссылки нет |
| Новая настройка «Сейчас идёт: 1 семестр / 2 семестр» на экране «Настройки семестра»; в листе «Настройки» — строка `semester` | 1 |
| Когда меняется номер семестра или его даты, журнал сразу перекладывает темы: на непроведённые пары в датах семестра встают темы выбранного семестра. Проведённые пары не меняются. Одна тема — одна пара: если на непроведённой паре вне дат семестра стоит тема выбранного семестра (например, начало семестра сдвинули позже), тема с неё снимается и встаёт на пару в датах; тема другого семестра на такой паре остаётся | — |
| Новая колонка «семестр» в листе «Темы» (1 или 2). Строки без семестра считаются семестром 1 | колонку допишет повторный запуск `setup` |
| № темы уникален в пределах предмета и семестра: в каждом семестре темы и модули нумеруются с 1. Семестр уже сохранённой темы не меняется (тему удаляют и добавляют заново) | № 1–200, модуль 1–12 |
| Силлабус преподавателя — файл Excel со столбцами «Семестр», «Модуль», «№», «Тема», «Тип». Предмет и группа берутся со страницы предмета, в файле их нет | один файл на год |
| Повторная загрузка силлабуса: тема с тем же семестром и № обновляется, новая добавляется; тем, которых нет в файле, журнал не удаляет | лишнюю тему удаляют на экране |
| В файле деканата (импорт тем сразу по многим предметам) появляется обязательный столбец «Семестр»; файл без него не принимается | — |
| Темы предмета правят и силлабус загружают: преподаватель этого предмета, деканат и администратор. Проректор смотрит. Экран «Темы» со всеми предметами — по-прежнему только у деканата, администратора и проректора | — |
| Тему проведённой пары загрузка файла не меняет (ошибка в строке). Вручную её может поправить тот, кто правит темы предмета (раньше — только деканат); удалить её нельзя | — |
| На экранах и в файлах пишем «Модуль» вместо «Юнит»; столбец «Юнит» в файле тоже принимается | — |
| У преподавателя кнопка и страница предмета называются «Силлабус». У деканата экран «Темы» остаётся: темы по семестрам и кнопка «Загрузить силлабус (Excel)» для выбранного предмета; ссылка на общий импорт с этого экрана убрана (он остаётся в «Импорте из Excel») | — |

## Файлы

```
core/dates.js            даты и время строками, часовой пояс Бишкека                      новый
core/settings.js         настройки семестра: чтение, проверка, звонки                      новый
core/topics.js           раскладка тем по парам                                             новый
core/schedule.js         рабочие дни, создание пар семестра, проверка изменения пары       новый
core/busy.js             проверка «двое в одном месте» для шаблона и пар (одна на весь проект)   новый
core/schema.js           + weekTemplate, topics, pairs, статусы пары, типы пар
core/validate.js         + правила строк шаблона и тем
core/import.js           + импорт тем
core/permissions.js      + права юнита 2
backend/store/rowShape.js       одинаковая форма строки для всех хранилищ                 новый
backend/store/memoryStore.js  fileStore.js  sheetsStore.js     форма строк, updateMany, removeMany
backend/scheduleData.js         настройки, «сегодня», пересчёт тем, создание пар, вид пары новый
backend/handlers/settings.js    settings.get, settings.save                                 новый
backend/handlers/schedule.js    schedule.*, topics.plan                                     новый
backend/handlers/dir.js  import.js    backend/api.js    backend/gas/main.js
dev/seed.js
site/js/dates.js  site/js/pairs.js                    помощники без DOM                     новые
site/js/views/settings.js  weekTemplate.js  topics.js  schedule.js  pairParts.js  mySchedule.js  plan.js   новые
site/js/router.js  main.js  shell.js  icons.js  views/home.js  views/directoryConfig.js  i18n/*.js  css/screens.css
tests/storeContract.js  dates.test.js  settings.test.js  busy.test.js  topics.test.js  schedule.test.js
tests/settingsApi.test.js  dirSchedule.test.js  scheduleApi.test.js  pairsApi.test.js  siteDates.test.js  pairs.test.js
```

Кто делает: **Л** — агент «Логика», **С** — «Сервер», **Э** — «Экраны». После каждой задачи — агент «Проверяющий». Задачи идут строго по одной, в порядке номеров: общие файлы (`core/schema.js`, `backend/handlers/dir.js`, `site/js/router.js`, `shell.js`, словари) правит только та задача, которая сейчас в работе. Файл чужой зоны агент трогает, только если он прямо назван в его задаче.

Общие данные для тестов сервера (задачи 5–7) — тот же приём, что в `tests/dir.test.js`: `createMemoryStore`, часы `now` меняются из теста, сотрудники `admin`, `dean` (роли `dean,teacher`), `prorector`, `teacher1`, `teacher2` с паролем `secret12`, `call(action, data, token)`.

---

### Task 1 (С): одинаковая форма строк, пакетная запись, часовой пояс таблицы

Закрывает отложенные замечания юнита 1 (журнал хода работ, задача 2: строки 64, 65, 67, 74; общая проверка: M-4).

**Files:** Create `backend/store/rowShape.js`, `tests/storeContract.js`, `core/dates.js`, `tests/dates.test.js`. Modify `backend/store/memoryStore.js`, `backend/store/fileStore.js`, `backend/store/sheetsStore.js`, `backend/gas/main.js`, `tests/fakes/fakeSpreadsheet.js`, `tests/fakes/fakeGas.js`, `tests/store.test.js`, `tests/sheetsStore.test.js`, `tests/gasBundle.test.js`.

**Interfaces — Produces:**

```js
// core/dates.js (в этой задаче только это; остальное добавит Task 2)
export const TZ_OFFSET_MS = 6 * 3600000;   // Asia/Bishkek: UTC+6, перехода на летнее время нет
export function localDate(ms);              // -> 'YYYY-MM-DD' по времени Бишкека

// backend/store/rowShape.js
export function shapeValue(type, v);
// 'string': undefined/null -> '', иначе String(v).trim()
// 'int':    целое число или строка из цифр -> число, всё остальное -> null
// 'bool':   true для true, 1, 'true', 'TRUE', 'да' (без учёта регистра и пробелов), иначе false
export function shapeRow(def, row);         // объект ровно с ключами def.columns, лишние ключи отброшены

// Store — у всех трёх хранилищ к прежним методам добавляются:
//   updateMany(table, items: [{ id, patch }]): object[]   // строки после изменения, в порядке items
//   removeMany(table, ids: string[]): void
// Если хотя бы одного id нет — AppError('not_found'), и не записано ничего. Пустой список — не ошибка.

// tests/storeContract.js
export function storeContract(name, makeStore);   // общий набор проверок; makeStore() -> пустое хранилище по SCHEMA
```

Правила:

- Всё, что хранилище возвращает (`list`, `get`, `insert`, `insertMany`, `update`, `updateMany`), проходит через `shapeRow`. В памяти и в файле строки и хранятся в этой форме. Старый файл стенда с неполными строками читается без ошибок.
- Ключ, который есть в `patch` со значением `undefined` или `null`, очищает поле (`''`, `null`, `false`) — одинаково во всех трёх хранилищах.
- `sheetsStore`: чтение и запись значений идут через `shapeValue`; колонка `id` ищется по `key === 'id'`, а не как первая в схеме. Ячейка-дата в строковой колонке читается как `localDate(v.getTime())`.
- `sheetsStore.updateMany`: одно чтение листа и по одной записи `setValues` на каждую изменённую колонку схемы — диапазон от первой до последней изменённой строки этой колонки; строки внутри диапазона, которых изменение не касается, получают свои же прежние значения ячеек. Чужие колонки не трогаются. Всё под `withLock`.
- `sheetsStore.removeMany`: всё под `withLock`; повторы id в списке сначала убираются (иначе `[a, a]` удалил бы строку `a` и следующую за ней); одно чтение, удаление снизу вверх; подряд идущие строки удаляются одним вызовом `sheet.deleteRows(position, howMany)`. В памяти и в файле повторы id тоже не ошибка.
- `fakeSpreadsheet`: у листа появляются `deleteRows(position, howMany)` и счётчики вызовов `ss.calls(name) -> { getValues, setValues, appendRow, deleteRow, deleteRows }`. Строка вида `2026-09-01`, записанная в колонку без текстового формата, превращается в дату «полночь в Бишкеке» (`new Date('2026-09-01T00:00:00+06:00')`), как делает таблица с часовым поясом Бишкека.
- `setup()` при каждом запуске вызывает `spreadsheet.setSpreadsheetTimeZone('Asia/Bishkek')` и `spreadsheet.setSpreadsheetLocale('ru_RU')`. В `fakeGas` у таблицы появляются эти методы и `getSpreadsheetTimeZone()`, `getSpreadsheetLocale()` (по умолчанию `'Etc/GMT'` и `'en_US'`).

- [ ] **Step 1: тесты.** Перенести `storeContract` из `tests/store.test.js` в `tests/storeContract.js`, дополнить и запускать для трёх хранилищ: память, файл, таблица (`ensureSheets(SCHEMA, ss)` на пустой `createFakeSpreadsheet()`).

```js
// добавить в storeContract
const st = s.insert('students', { fullName: ' Асанов А ', cardNo: 1002, groupId: 'g_1', junk: 'x' });
assert.deepEqual(st, { id: st.id, fullName: 'Асанов А', groupId: 'g_1', cardNo: '1002', passwordHash: '',
  lang: '', mustChangePassword: false, active: false });
assert.deepEqual(s.get('students', st.id), st);
assert.deepEqual(s.update('students', st.id, { active: 'да', lang: undefined, nope: 1 }), { ...st, active: true });
assert.equal(s.insert('groups', { name: '01-1', course: '2' }).course, 2);
assert.equal(s.insert('groups', { name: '01-2', course: 'два' }).course, null);

const [a, b, c] = s.insertMany('rooms', [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
assert.deepEqual(s.updateMany('rooms', [{ id: c.id, patch: { name: 'C2' } }, { id: a.id, patch: { name: 'A2' } }]).map(r => r.name), ['C2', 'A2']);
assert.throws(() => s.updateMany('rooms', [{ id: b.id, patch: { name: 'B2' } }, { id: 'r_nope', patch: {} }]), e => e.code === 'not_found');
assert.equal(s.get('rooms', b.id).name, 'B');                    // ничего не записано
assert.throws(() => s.removeMany('rooms', [b.id, 'r_nope']), e => e.code === 'not_found');
assert.equal(s.list('rooms').length, 3);
s.removeMany('rooms', [a.id, a.id, c.id]);                       // повтор id не удаляет лишнюю строку
assert.deepEqual(s.list('rooms').map(r => r.name), ['B']);
assert.deepEqual(s.updateMany('rooms', []), []);
s.removeMany('rooms', []);
// файл: второй createFileStore по тому же пути видит результат updateMany и removeMany
```

```js
// tests/sheetsStore.test.js
// updateMany: чужая колонка цела, одна запись на колонку
const ss = groupsSheet();
const s = createSheetsStore(SCHEMA, platform, ss);
s.updateMany('groups', [{ id: 'g_1', patch: { course: 3 } }, { id: 'g_2', patch: { course: 4, name: '02-1' } }]);
assert.deepEqual(ss.dump('Группы'), [['курс', 'моя заметка', 'id', 'название'], [3, 'не трогать', 'g_1', '01-1'], ['', '', '', ''], [4, 'и эту', 'g_2', '02-1']]);
assert.deepEqual([ss.calls('Группы').getValues, ss.calls('Группы').setValues], [1, 2]);

// 300 строк: изменить колонку у всех — 1 чтение и 1 запись; удалить строки 1–100 и 201-ю — 2 вызова deleteRows, 0 вызовов deleteRow
// Review Focus 4: полночь 1 сентября в Бишкеке — это 18:00 UTC 31 августа
const dated = createFakeSpreadsheet({ 'Группы': [['id', 'название', 'курс'], ['g_1', new Date('2026-08-31T18:00:00Z'), 1]] });
assert.equal(createSheetsStore(SCHEMA, platform, dated).list('groups')[0].name, '2026-09-01');
// прежний тест «a Date in a string column reads as YYYY-MM-DD» заменить этим

// tests/gasBundle.test.js — после setup()
assert.equal(spreadsheet.getSpreadsheetTimeZone(), 'Asia/Bishkek');
assert.equal(spreadsheet.getSpreadsheetLocale(), 'ru_RU');

// tests/dates.test.js (новый файл, Task 2 его дополнит)
assert.equal(localDate(Date.UTC(2026, 10, 20, 18, 0)), '2026-11-21');    // 00:00 в Бишкеке
assert.equal(localDate(Date.UTC(2026, 10, 20, 17, 59)), '2026-11-20');
```

- [ ] **Step 2:** `npm test` — новые проверки падают.
- [ ] **Step 3:** написать `rowShape.js`, `core/dates.js`, переделать три хранилища, фальшивую таблицу, `setup()`. Прежние тесты, которые сравнивали строки старой формы, поправить под новую и перечислить в отчёте.
- [ ] **Step 4:** `npm test` — всё зелёное (было 127 тестов, ни один не удалён без замены).
- [ ] **Step 5:** коммит `refactor: same row shape in every store, batch writes, sheet time zone`.

---

### Task 2 (Л): даты, новые таблицы, настройки семестра, права

**Files:** Modify `core/dates.js`, `core/schema.js`, `core/permissions.js`, `tests/dates.test.js`, `tests/schema.test.js`, `tests/permissions.test.js`, `tests/api.test.js` (только ожидание прав учителя в тесте `publicUser`), `tests/sheetsStore.test.js` (только ожидаемое число листов). Create `core/settings.js`, `tests/settings.test.js`.

**Interfaces — Consumes:** `TZ_OFFSET_MS`, `localDate` (Task 1).

**Produces:**

```js
// core/dates.js
export function isDate(text);            // строка 'YYYY-MM-DD' и такой день есть в календаре
export function addDays(date, n);        // ('2026-12-31', 1) -> '2027-01-01'
export function daysBetween(a, b);       // b минус a, в днях
export function weekday(date);           // 1 = понедельник … 7 = воскресенье
export function mondayOf(date);          // понедельник той же недели
export function isTime(text);            // 'HH:MM' от 00:00 до 23:59
export function minutesOf(time);         // '09:40' -> 580
export function addMinutes(time, n);     // ('08:00', 90) -> '09:30'

// core/schema.js
export const PAIR_STATUSES = ['planned', 'running', 'closed', 'missed', 'cancelled'];
export const FIXED_STATUSES = ['running', 'closed'];        // пара проведена: её тема больше не меняется
export const LESSON_TYPES = ['lecture', 'practice', 'control'];
export const WEEKDAYS = [1, 2, 3, 4, 5];

// core/settings.js
export const PAIR_MINUTES = 90;
export const MAX_SLOTS = 8;
export const MAX_HOLIDAYS = 60;
export const MAX_SEMESTER_DAYS = 200;
export const DEFAULT_BELLS = ['08:00', '09:40', '11:20', '13:30', '15:10', '16:50'];
export const SETTING_KEYS = ['semesterStart', 'semesterEnd', 'holidays', 'bells'];
export function readSettings(rows);       // строки листа «Настройки» -> { semesterStart, semesterEnd, holidays: string[], bells: string[] }
export function validateSettings(input);  // -> { value, errors: [{ field, code }] }
export function settingsToRows(value);    // -> [{ key, value }] в порядке SETTING_KEYS; списки — через запятую
```

Новые таблицы (ключ / заголовок в листе / тип, если не `string`); в `tableNames()` они идут после `settings` в этом порядке:

| table | sheet | prefix | columns |
| --- | --- | --- | --- |
| weekTemplate | Шаблон недели | wt | id/id, weekday/день недели (int), slot/№ пары (int), subjectId/предмет, roomId/аудитория |
| topics | Темы | tp | id/id, subjectId/предмет, unit/юнит (int), order/№ по порядку (int), name/название, lessonType/тип пары |
| pairs | Пары | p | id/id, date/дата, slot/№ пары (int), startTime/время начала, groupId/группа, subjectId/предмет, teacherId/преподаватель, roomId/аудитория, topicId/тема, status/статус, planDate/дата по плану, planSlot/№ пары по плану (int), changed/изменена вручную (bool), note/примечание |

Смысл колонок пары: `date`, `slot`, `startTime` — когда пара идёт на самом деле; `planDate`, `planSlot` — место по шаблону, оно не меняется при переносе; `changed` — пару трогали вручную (замена, перенос, отмена), повторное создание расписания её не переписывает. Группа и преподаватель в шаблоне не хранятся: они берутся из предмета.

Правила `readSettings`: нет строки с ключом или значение не проходит проверку — берётся `''` для дат, `[]` для нерабочих дней, `DEFAULT_BELLS` для звонков. Списки хранятся через запятую.

Правила `validateSettings` (не больше одной ошибки на поле, порядок — `SETTING_KEYS`; `value` — приведённые значения):

- `semesterStart`, `semesterEnd`: пусто → `required`; не `isDate` → `bad_value`; конец раньше начала → `semesterEnd: bad_value`; между ними больше `MAX_SEMESTER_DAYS` дней → `semesterEnd: too_long`.
- `holidays`: массив строк, каждая `isDate`, иначе `bad_value`; повторы убираются, список сортируется; больше `MAX_HOLIDAYS` → `too_long`. Даты вне семестра допустимы.
- `bells`: массив от 1 до `MAX_SLOTS` строк `isTime`; каждый следующий звонок не раньше предыдущего плюс `PAIR_MINUTES`; последняя пара заканчивается не позже 23:59: `minutesOf(последний звонок) + PAIR_MINUTES <= minutesOf('23:59')` (то есть последний звонок не позже `'22:29'`; `addMinutes` никогда не переходит через полночь). Любое нарушение → `bad_value`.

Права (добавить к матрице юнита 1):

| Действие | Кто |
| --- | --- |
| `dir.list` для `weekTemplate`, `topics` | admin, dean, prorector |
| `dir.save`, `dir.remove` для `weekTemplate`, `topics` | admin, dean |
| `import.preview`, `import.apply` для `topics` | admin, dean |
| `settings.get`, `schedule.list` | admin, dean, prorector |
| `settings.save`, `schedule.generate`, `schedule.changePair`, `schedule.cancelPair`, `schedule.restorePair` | admin, dean |
| `topics.plan` | admin, dean, prorector, teacher |
| `schedule.mine` | teacher, student |

- [ ] **Step 1: тесты.**

```js
// tests/dates.test.js
assert.equal(isDate('2026-02-28'), true);
for (const bad of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) assert.equal(isDate(bad), false);
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(addDays('2026-03-01', -1), '2026-02-28');
assert.equal(daysBetween('2026-09-01', '2026-09-11'), 10);
assert.deepEqual(['2026-11-16', '2026-11-21', '2026-09-06'].map(weekday), [1, 6, 7]);
assert.equal(mondayOf('2026-11-21'), '2026-11-16');
assert.equal(mondayOf('2026-11-16'), '2026-11-16');
assert.equal(isTime('08:00'), true);
for (const bad of ['8:00', '24:00', '08:60', '0800', '']) assert.equal(isTime(bad), false);
assert.equal(minutesOf('09:40'), 580);
assert.equal(addMinutes('08:00', 90), '09:30');

// tests/schema.test.js
assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'subjects', 'rooms', 'translations', 'settings', 'weekTemplate', 'topics', 'pairs']);
assert.equal(SCHEMA.pairs.sheet, 'Пары');
assert.deepEqual(SCHEMA.pairs.columns.map(c => c.title), ['id', 'дата', '№ пары', 'время начала', 'группа', 'предмет', 'преподаватель',
  'аудитория', 'тема', 'статус', 'дата по плану', '№ пары по плану', 'изменена вручную', 'примечание']);
assert.deepEqual(SCHEMA.topics.columns.map(c => c.title), ['id', 'предмет', 'юнит', '№ по порядку', 'название', 'тип пары']);
assert.deepEqual(SCHEMA.weekTemplate.columns.map(c => c.title), ['id', 'день недели', '№ пары', 'предмет', 'аудитория']);

// tests/settings.test.js
assert.deepEqual(readSettings([]), { semesterStart: '', semesterEnd: '', holidays: [], bells: DEFAULT_BELLS });
assert.deepEqual(readSettings([{ key: 'semesterStart', value: '2026-09-01' }, { key: 'holidays', value: '2026-11-07,2026-09-07' },
  { key: 'bells', value: 'мусор' }, { key: 'чужой', value: '1' }]),
  { semesterStart: '2026-09-01', semesterEnd: '', holidays: ['2026-09-07', '2026-11-07'], bells: DEFAULT_BELLS });
const ok = validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: ['2026-11-07', '2026-09-07', '2026-11-07'], bells: ['08:00', '09:30'] });
assert.deepEqual(ok.errors, []);
assert.deepEqual(ok.value.holidays, ['2026-09-07', '2026-11-07']);
assert.deepEqual(settingsToRows(ok.value), [{ key: 'semesterStart', value: '2026-09-01' }, { key: 'semesterEnd', value: '2026-12-25' },
  { key: 'holidays', value: '2026-09-07,2026-11-07' }, { key: 'bells', value: '08:00,09:30' }]);
assert.deepEqual(validateSettings({}).errors, [{ field: 'semesterStart', code: 'required' }, { field: 'semesterEnd', code: 'required' },
  { field: 'holidays', code: 'bad_value' }, { field: 'bells', code: 'bad_value' }]);
const errorsOf = (patch) => validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: DEFAULT_BELLS, ...patch }).errors;
assert.deepEqual(errorsOf({ semesterEnd: '2026-08-31' }), [{ field: 'semesterEnd', code: 'bad_value' }]);
assert.deepEqual(errorsOf({ semesterEnd: '2027-06-01' }), [{ field: 'semesterEnd', code: 'too_long' }]);
assert.deepEqual(errorsOf({ holidays: ['7 ноября'] }), [{ field: 'holidays', code: 'bad_value' }]);
assert.deepEqual(errorsOf({ bells: ['08:00', '09:29'] }), [{ field: 'bells', code: 'bad_value' }]);     // пары накладываются
assert.deepEqual(errorsOf({ bells: ['23:00'] }), [{ field: 'bells', code: 'bad_value' }]);              // конец после полуночи
assert.deepEqual(errorsOf({ bells: ['22:29'] }), []);                                                   // граница: конец ровно в 23:59
assert.deepEqual(errorsOf({ bells: ['22:30'] }), [{ field: 'bells', code: 'bad_value' }]);              // конец в 24:00 — уже нельзя
assert.deepEqual(errorsOf({ bells: [] }), [{ field: 'bells', code: 'bad_value' }]);
// 9 звонков -> bad_value; 61 нерабочий день -> too_long

// tests/permissions.test.js
assert.equal(can(['dean'], 'dir.save', 'topics'), true);
assert.equal(can(['prorector'], 'dir.save', 'weekTemplate'), false);
assert.equal(can(['prorector'], 'dir.list', 'weekTemplate'), true);
assert.equal(can(['teacher'], 'dir.list', 'topics'), false);
assert.equal(can(['dean'], 'import.apply', 'topics'), true);
assert.equal(can(['prorector'], 'schedule.list'), true);
assert.equal(can(['prorector'], 'schedule.changePair'), false);
assert.equal(can(['teacher'], 'schedule.changePair'), false);
assert.equal(can(['teacher'], 'topics.plan'), true);
assert.equal(can(['student'], 'schedule.mine'), true);
assert.equal(can(['student'], 'schedule.list'), false);
assert.equal(can(['dean'], 'schedule.mine'), false);
assert.deepEqual(listPermissions(['student']), ['schedule.mine']);          // прежнее ожидание [] заменить
assert.ok(listPermissions(['dean']).includes('settings.save'));

// tests/api.test.js, тест 'publicUser': у учителя появились права юнита 2 (прежнее ожидание ['teacher.mySubjects'] заменить)
//   permissions: ['schedule.mine', 'teacher.mySubjects', 'topics.plan']
```

- [ ] **Step 2:** падает. **Step 3:** написать; в `tests/sheetsStore.test.js:88` (тест «ensureSheets: creates sheets…») поправить `assert.equal(made.created.length, 6)` на `9`: в схеме было 7 таблиц, стало 10, лист «Группы» в этом тесте уже есть. Больше листы нигде не считаются: в `tests/gasBundle.test.js` проверки числа листов нет, этот файл в задаче не трогается. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: schedule tables, date helpers, semester settings rules, permissions`.

---

### Task 3 (Л): правила шаблона и тем, раскладка тем, импорт тем

**Files:** Modify `core/validate.js`, `core/import.js`, `tests/validate.test.js`, `tests/import.test.js`. Create `core/busy.js`, `tests/busy.test.js`, `core/topics.js`, `tests/topics.test.js`. В чужой зоне, только названное: `site/js/views/directoryConfig.js` — добавить `IMPORT_COLUMNS.topics` (шесть обязательных колонок в порядке таблицы ниже); `site/js/i18n/ru.js`, `ky.js`, `en.js` — шесть ключей `import.col.topics.<key>` со значениями заголовков из таблицы ниже. Без этого два теста в `tests/i18n.test.js`, которые сверяют сайт с `IMPORT_SPECS`, упадут. В список `IMPORT_TABLES` тема не добавляется: экран импорта получит её в Task 10.

**Interfaces — Consumes:** `SCHEMA`, `FIXED_STATUSES`, `LESSON_TYPES`, `WEEKDAYS` (Task 2), `MAX_SLOTS` (Task 2).

**Produces:**

```js
// core/busy.js — единственная проверка «двое в одном месте» во всём проекте:
// шаблон (validateRow здесь, смена преподавателя предмета в Task 5) и пары (planGeneration и checkPairChange в Task 4, сервер в Task 7).
// Slot = { id, day, slot, groupId, teacherId, roomId }; day — день недели 1–5 (шаблон) или дата 'YYYY-MM-DD' (пара).
export function templateSlots(template, subjects);
// строки шаблона -> Slot[] в том же порядке: day = weekday, roomId из строки; groupId и teacherId — из предмета строки (предмета нет -> '')
export function pairSlots(pairs);
// пары -> Slot[] в том же порядке: day = date; пары со статусом 'cancelled' и 'missed' не входят (место не занимают)
export function busyCodes(slots, cand);
// cand: Slot -> подмножество ['group_busy', 'teacher_busy', 'room_busy'] в этом порядке.
// Код есть, если в slots есть запись с тем же day (строгое ===), тем же slot, id !== cand.id
// и тем же НЕПУСТЫМ groupId / teacherId / roomId соответственно. Пустые значения ни с чем не совпадают.

// core/validate.js — validateRow понимает две новые таблицы
validateRow('weekTemplate', row, db);   // db = { weekTemplate, subjects, rooms, slotCount }
validateRow('topics', row, db);         // db = { topics, subjects }

// core/topics.js
export function layoutTopics(topics, pairs);
// topics и pairs — строки ОДНОГО предмета.
// -> { assign: [{ id, topicId }], unplaced: string[], withoutTopic: number }
//    assign — только пары, у которых тема меняется; unplaced — id тем, которым не хватило пары (по порядку);
//    withoutTopic — запланированные пары, которым не хватило темы

// core/import.js
IMPORT_SPECS.topics;                    // см. ниже
// у колонки спецификации может быть virtual: true; у спецификации — check(existing, candidate, db) -> { field, code } | null
```

Правила строки шаблона (ошибки — в порядке колонок схемы):

- `weekday` — целое из `WEEKDAYS`, иначе `bad_value`.
- `slot` — целое от 1 до `db.slotCount` (если его нет — до `MAX_SLOTS`), иначе `bad_value`; у той же группы уже есть строка на этот день и номер пары → `group_busy`.
- `subjectId` — есть в `db.subjects`, иначе `bad_ref`; на этот день и номер пары уже стоит предмет того же преподавателя → `teacher_busy`.
- `roomId` — пусто можно; не пусто и нет в `db.rooms` → `bad_ref`; аудитория уже занята на этот день и номер пары → `room_busy`.
- Строка сама с собой (тот же `id`) не конфликтует.
- Занятость (`group_busy`, `teacher_busy`, `room_busy`) считается только через `core/busy.js`: `busyCodes(templateSlots(db.weekTemplate, db.subjects), cand)`, где `cand = { id: row.id || '', day: row.weekday, slot: row.slot, groupId, teacherId, roomId: row.roomId }`, а `groupId` и `teacherId` — из предмета `row.subjectId`. Коды ставятся на поля: `group_busy` → `slot`, `teacher_busy` → `subjectId`, `room_busy` → `roomId`. Если `weekday` или `slot` неверны, занятость не проверяется; поле, у которого уже есть `bad_value` или `bad_ref`, второй ошибки не получает. Своей проверки занятости в `validate.js` нет.

Правила темы: `subjectId` есть (`bad_ref`); `unit` — целое 1–12 (`bad_value`); `order` — целое 1–200 (`bad_value`), в этом предмете такого номера ещё нет (`duplicate`); `name` обязателен, не длиннее 200; `lessonType` из `LESSON_TYPES` (`bad_value`).

Раскладка `layoutTopics`:

1. Темы сортируются по `order`, пары — по `date`, `slot`, `id`.
2. Пара со статусом из `FIXED_STATUSES` свою тему сохраняет; её тема считается использованной.
3. Запланированные пары (`planned`) по очереди получают неиспользованные темы; когда темы кончились — пустую строку.
4. Отменённые и непроведённые пары (`cancelled`, `missed`) получают пустую строку.

Импорт тем: `uniqueBy: ['order', 'subjectId']`; колонки (ru / ky / en; все обязательные):

| key | Заголовки | Другие принимаемые заголовки |
| --- | --- | --- |
| subjectId | Предмет / Сабак / Subject | — |
| groupId (virtual) | Группа / Топ / Group | Тайпа |
| unit | Юнит / Юнит / Unit | Модуль |
| order | № / № / No. | № по порядку, № темы, No, N |
| name | Тема / Тема / Topic | Название |
| lessonType | Тип / Түрү / Type | Тип пары |

- Служебная колонка (`virtual`) проверяется как обычная, но в `records` не попадает.
- `subjectId` ищется по названию предмета внутри группы из той же строки. Группа не найдена → ошибка только у `groupId` (`bad_ref`); группа есть, а предмета с таким названием в ней нет → `subjectId: bad_ref`.
- Ловушка порядка: `parseSheet` разбирает ячейки в порядке колонок спецификации (`subjectId` раньше `groupId`) и потом добавляет ошибки `validateRow` по каждой колонке. Поэтому для строки сначала найти группу (по ячейке «Группа»), и если группы нет — ошибку `subjectId: bad_ref` этой строки подавить (и при разборе ячейки, и из `validateRow`): у строки 6 в тесте ниже ровно одна ошибка — `groupId: bad_ref`.
- `lessonType` в файле: `лекция`, `lecture` → `lecture`; `практика`, `практическое`, `practice` → `practice`; `рубежный`, `рубежный контроль`, `экзамен`, `аралык текшерүү`, `control`, `exam` → `control`; другое слово → `bad_value`.
- `check` для тем: строка совпала с существующей темой, эта тема стоит на паре со статусом из `FIXED_STATUSES` (`db.pairs`), и название, тип или юнит в файле другие → `{ field: 'name', code: 'held' }`.
- Рабочая копия базы в `parseSheet` строится по всем ключам `db`, а не по пяти зашитым таблицам.

- [ ] **Step 1: тесты.**

```js
// tests/busy.test.js
const subjects = [{ id: 'sb_1', groupId: 'g_1', teacherId: 'sf_1' }, { id: 'sb_2', groupId: 'g_2', teacherId: 'sf_2' }];
assert.deepEqual(templateSlots([{ id: 'wt_1', weekday: 1, slot: 2, subjectId: 'sb_1', roomId: 'r_1' }, { id: 'wt_2', weekday: 3, slot: 1, subjectId: 'sb_x', roomId: '' }], subjects),
  [{ id: 'wt_1', day: 1, slot: 2, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }, { id: 'wt_2', day: 3, slot: 1, groupId: '', teacherId: '', roomId: '' }]);
const pairs = [{ id: 'p1', date: '2026-09-08', slot: 1, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1', status: 'planned' },
  { id: 'p2', date: '2026-09-08', slot: 2, groupId: 'g_1', teacherId: 'sf_1', roomId: '', status: 'cancelled' },
  { id: 'p3', date: '2026-09-08', slot: 3, groupId: 'g_2', teacherId: 'sf_2', roomId: '', status: 'missed' }];
const slots = pairSlots(pairs);
assert.deepEqual(slots, [{ id: 'p1', day: '2026-09-08', slot: 1, groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }]);
const at = (extra) => busyCodes(slots, { id: '', day: '2026-09-08', slot: 1, groupId: 'g_2', teacherId: 'sf_2', roomId: '', ...extra });
assert.deepEqual(at({}), []);
assert.deepEqual(at({ groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }), ['group_busy', 'teacher_busy', 'room_busy']);
assert.deepEqual(at({ teacherId: 'sf_1' }), ['teacher_busy']);
assert.deepEqual(at({ roomId: 'r_1' }), ['room_busy']);
assert.deepEqual(at({ id: 'p1', groupId: 'g_1', teacherId: 'sf_1', roomId: 'r_1' }), []);       // сама с собой
assert.deepEqual(at({ slot: 2, groupId: 'g_1', teacherId: 'sf_1' }), []);                        // отменённая место не занимает
assert.deepEqual(at({ day: '2026-09-09', groupId: 'g_1' }), []);                                  // другой день
assert.deepEqual(busyCodes([{ id: 'x', day: 1, slot: 1, groupId: '', teacherId: '', roomId: '' }],
  { id: '', day: 1, slot: 1, groupId: '', teacherId: '', roomId: '' }), []);                     // пустые значения не совпадают
```

```js
// tests/validate.test.js
const db = {
  subjects: [{ id: 'sb_1', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1' }, { id: 'sb_2', name: 'Анатомия', teacherId: 'sf_2', groupId: 'g_1' },
    { id: 'sb_3', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_2' }, { id: 'sb_4', name: 'Анатомия', teacherId: 'sf_2', groupId: 'g_2' }],
  rooms: [{ id: 'r_1', name: '204' }, { id: 'r_2', name: '101' }],
  weekTemplate: [{ id: 'wt_1', weekday: 1, slot: 1, subjectId: 'sb_1', roomId: 'r_1' }],
  slotCount: 6,
};
const wt = (row) => validateRow('weekTemplate', row, db);
assert.deepEqual(wt({ weekday: 1, slot: 2, subjectId: 'sb_2', roomId: 'r_1' }), []);
assert.deepEqual(wt({ weekday: 2, slot: 1, subjectId: 'sb_1', roomId: '' }), []);                    // без аудитории
assert.deepEqual(wt({ id: 'wt_1', weekday: 1, slot: 1, subjectId: 'sb_1', roomId: 'r_1' }), []);     // сама с собой
assert.deepEqual(wt({ weekday: 6, slot: 7, subjectId: 'sb_x', roomId: 'r_x' }), [{ field: 'weekday', code: 'bad_value' },
  { field: 'slot', code: 'bad_value' }, { field: 'subjectId', code: 'bad_ref' }, { field: 'roomId', code: 'bad_ref' }]);
// Review Focus 5
assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_2', roomId: 'r_2' }), [{ field: 'slot', code: 'group_busy' }]);
assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_3', roomId: 'r_2' }), [{ field: 'subjectId', code: 'teacher_busy' }]);
assert.deepEqual(wt({ weekday: 1, slot: 1, subjectId: 'sb_4', roomId: 'r_1' }), [{ field: 'roomId', code: 'room_busy' }]);

const tdb = { subjects: db.subjects, topics: [{ id: 'tp_1', subjectId: 'sb_1', unit: 1, order: 1, name: 'Введение', lessonType: 'lecture' }] };
assert.deepEqual(validateRow('topics', { subjectId: 'sb_1', unit: 1, order: 2, name: 'Введение', lessonType: 'practice' }, tdb), []);   // то же название — можно
assert.deepEqual(validateRow('topics', { subjectId: 'sb_3', unit: 1, order: 1, name: 'В', lessonType: 'lecture' }, tdb), []);           // другой предмет
assert.deepEqual(validateRow('topics', { subjectId: 'sb_x', unit: 0, order: 201, name: '', lessonType: 'семинар' }, tdb),
  [{ field: 'subjectId', code: 'bad_ref' }, { field: 'unit', code: 'bad_value' }, { field: 'order', code: 'bad_value' },
    { field: 'name', code: 'required' }, { field: 'lessonType', code: 'bad_value' }]);
assert.deepEqual(validateRow('topics', { subjectId: 'sb_1', unit: 1, order: 1, name: 'Дубль', lessonType: 'lecture' }, tdb), [{ field: 'order', code: 'duplicate' }]);
```

```js
// tests/topics.test.js — Review Focus 1
const topics = [1, 2, 3, 4].map(n => ({ id: 't' + n, subjectId: 'sb_1', unit: 1, order: n, name: 'Т' + n, lessonType: 'lecture' }));
const pair = (id, date, status = 'planned', topicId = '', slot = 1) => ({ id, subjectId: 'sb_1', date, slot, status, topicId });

assert.deepEqual(layoutTopics(topics, [pair('p2', '2026-09-08'), pair('p1', '2026-09-01'), pair('p3', '2026-09-15')]),
  { assign: [{ id: 'p1', topicId: 't1' }, { id: 'p2', topicId: 't2' }, { id: 'p3', topicId: 't3' }], unplaced: ['t4'], withoutTopic: 0 });

// отмена: тема уходит следующим парам, проведённая пара держит свою
const afterCancel = [pair('p1', '2026-09-01', 'closed', 't1'), pair('p2', '2026-09-08', 'cancelled', 't2'), pair('p3', '2026-09-15', 'planned', 't3'),
  pair('p4', '2026-09-22', 'planned', 't4'), pair('p5', '2026-09-29')];
assert.deepEqual(layoutTopics(topics, afterCancel),
  { assign: [{ id: 'p2', topicId: '' }, { id: 'p3', topicId: 't2' }, { id: 'p4', topicId: 't3' }, { id: 'p5', topicId: 't4' }], unplaced: [], withoutTopic: 0 });

// проведённая пара вне очереди: t3 второй раз не выдаётся, последней паре темы не хватило
assert.deepEqual(layoutTopics(topics, [pair('p1', '2026-09-01', 'running', 't3'), pair('p2', '2026-09-08'), pair('p3', '2026-09-15'), pair('p4', '2026-09-22'), pair('p5', '2026-09-29')]),
  { assign: [{ id: 'p2', topicId: 't1' }, { id: 'p3', topicId: 't2' }, { id: 'p4', topicId: 't4' }], unplaced: [], withoutTopic: 1 });

// уже разложено -> assign пуст; 'missed' ведёт себя как 'cancelled'; две пары в один день идут по slot; тем нет -> withoutTopic = числу planned-пар
```

```js
// tests/import.test.js — Review Focus 3
const db = {
  groups: [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '02-1', course: 2 }],
  subjects: [{ id: 'sb_1', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }, { id: 'sb_2', name: 'Информатика', teacherId: 'sf_1', groupId: 'g_2', scheme: 'A' }],
  topics: [{ id: 'tp_1', subjectId: 'sb_1', unit: 1, order: 1, name: 'Старое имя', lessonType: 'lecture' },
    { id: 'tp_2', subjectId: 'sb_1', unit: 1, order: 2, name: 'Проведённая', lessonType: 'practice' }],
  pairs: [{ id: 'p_1', subjectId: 'sb_1', topicId: 'tp_2', status: 'closed' }],
};
const r = parseSheet('topics', [
  ['Предмет', 'Группа', 'Юнит', '№ темы', 'Тема', 'Тип'],
  ['информатика', '01-1', 1, 1, 'Цифровой пост медсестры', 'Лекция'],     // 2: тема tp_1 получит новое название
  ['Информатика', '01-1', 1, 2, 'Другое имя', 'практика'],                 // 3: пара с этой темой проведена
  ['Информатика', '01-1', 1, 3, 'Защита данных', 'практика'],              // 4: новая
  ['Информатика', '01-1', 1, 3, 'Повтор номера', 'лекция'],                // 5
  ['Информатика', '09-9', 1, 1, 'Нет группы', 'лекция'],                   // 6
  ['Химия', '01-1', 1, 1, 'Нет предмета', 'лекция'],                       // 7
  ['Информатика', '02-1', 2, 1, 'Модуль 2 — экзамен', 'экзамен'],          // 8: новая, предмет другой группы
  ['Информатика', '02-1', 0, 2, 'Юнит 0', 'семинар'],                      // 9
], db);
assert.deepEqual(r.errors, [{ row: 3, field: 'name', code: 'held' }, { row: 5, field: 'order', code: 'duplicate' },
  { row: 6, field: 'groupId', code: 'bad_ref' }, { row: 7, field: 'subjectId', code: 'bad_ref' },
  { row: 9, field: 'unit', code: 'bad_value' }, { row: 9, field: 'lessonType', code: 'bad_value' }]);
assert.deepEqual(r.records.map(x => [x.row, x.subjectId, x.lessonType]), [[2, 'sb_1', 'lecture'], [4, 'sb_1', 'practice'], [8, 'sb_2', 'control']]);
assert.equal('groupId' in r.records[0], false);
const plan = planImport('topics', r.records, db);
assert.deepEqual(plan.toInsert.map(t => [t.subjectId, t.unit, t.order, t.name]), [['sb_1', 1, 3, 'Защита данных'], ['sb_2', 2, 1, 'Модуль 2 — экзамен']]);
assert.deepEqual(plan.toUpdate, [{ id: 'tp_1', patch: { unit: 1, name: 'Цифровой пост медсестры', lessonType: 'lecture' } }]);
// та же строка 3 с названием «Проведённая» и типом «практика» -> ошибки нет (ничего не меняется)
// файл без столбца «Группа» -> missingColumns: ['groupId']
```

- [ ] **Step 2:** падает. **Step 3:** написать. Прежние тесты импорта пяти справочников остаются зелёными; разрешена ровно одна правка в них: в `tests/import.test.js:131` (тест «duplicate header and specs») ожидание ключей `IMPORT_SPECS` становится `['groups', 'rooms', 'staff', 'students', 'subjects', 'topics']`. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: week template and topic rules, topic layout, topics import`.

---

### Task 4 (Л): создание пар семестра и проверка изменения пары

**Files:** Create `core/schedule.js`, `tests/schedule.test.js`.

**Interfaces — Consumes:** `core/dates.js`, `PAIR_MINUTES`, настройки в форме `readSettings` (Task 2); `pairSlots(pairs)` и `busyCodes(slots, cand)` из `core/busy.js` (Task 3): `pairSlots` превращает пары в `Slot = { id, day: date, slot, groupId, teacherId, roomId }` без пар `cancelled` и `missed`; `busyCodes` возвращает подмножество `['group_busy', 'teacher_busy', 'room_busy']` — есть запись с тем же `day` и `slot`, другим `id` и тем же непустым `groupId` / `teacherId` / `roomId`. Вся занятость в этой задаче считается только через них; своей проверки занятости в `core/schedule.js` нет.

**Produces:**

```js
export function workingDays(settings, from = settings.semesterStart);
// даты с понедельника по пятницу от from до semesterEnd включительно, без holidays; from раньше начала семестра -> с начала
export function planGeneration({ template, subjects, settings, pairs, from, restart = false });
// -> { toInsert: object[], toUpdate: [{ id, patch }], toRemove: string[], kept: number, conflicts: number }
export function pairLock(pair, today);          // -> null | 'pair_locked' | 'in_past'
export function checkPairChange(pair, patch, ctx);
// patch: { teacherId?, date?, slot?, roomId?, note? }; ctx = { pairs, staff, rooms, settings, today }
// -> { next: { date, slot, startTime, teacherId, roomId, note, changed: true }, errors: [{ field, code }] }
```

`planGeneration`:

1. Нужные пары: для каждого рабочего дня от `from` и каждой строки шаблона с этим днём недели, чей предмет есть в `subjects`, — пара с ключом (`groupId`, дата, `slot`). Поля: `date`, `slot`, `startTime = settings.bells[slot - 1]`, `groupId` и `teacherId` из предмета, `subjectId`, `roomId` из шаблона, `topicId: ''`, `status: 'planned'`, `planDate = date`, `planSlot = slot`, `changed: false`, `note: ''`. Строка шаблона с номером пары больше числа звонков пропускается: `conflicts` растёт на каждый такой день.
2. Существующие пары с `planDate` раньше `from` не рассматриваются вообще.
3. Заменяемая пара — `status === 'planned'` и `changed === false`. Её ключ — (`groupId`, `planDate`, `planSlot`).
   - ключ есть среди нужных и `subjectId`, `teacherId`, `roomId`, `startTime` совпадают → `kept`;
   - ключ есть, что-то отличается → в `toUpdate` только отличающиеся поля (при смене `subjectId` ещё `topicId: ''`); но если меняется `teacherId` или `roomId` и пара с новыми значениями занята (правило 5, `cand.id` = id этой пары) — пара в `toUpdate` не попадает и остаётся как есть, `kept` не растёт, `conflicts` растёт на 1;
   - ключа нет → в `toRemove`;
   - вторая заменяемая пара с тем же ключом → в `toRemove`.
4. Незаменяемая пара (тронута вручную или статус не `planned`) остаётся как есть (`kept`), её ключ считается занятым.
5. Нужные пары без существующей → в `toInsert`. Занятость проверяется против незаменяемых пар (рассматриваемых по правилу 2): `busyCodes(pairSlots(незаменяемые), { id: '', day: date, slot, groupId, teacherId, roomId })` не пуст — то есть на эти `date` и `slot` уже стоит незаменяемая пара не `cancelled` и не `missed` той же группы, того же преподавателя или в той же непустой аудитории (общих лекций потока нет) — пара не создаётся, `conflicts` растёт. Заменяемые пары и другие нужные пары в эту проверку не входят: их согласованность держит шаблон (Task 3).
6. `restart: true` → `toRemove` — все пары, `toInsert` — все нужные, остальное пусто.
7. `toInsert` и `toUpdate` отсортированы по дате, номеру пары, `groupId`.

`pairLock`: статус не `planned` → `'pair_locked'`; `pair.date < today` → `'in_past'`; иначе `null`.

`checkPairChange` — поля, которых нет в `patch`, берутся из пары; ошибки в порядке `date`, `slot`, `teacherId`, `roomId`, `note`, не больше одной на поле:

- `date`: не `isDate` → `bad_value`; раньше `today` → `in_past`; вне семестра → `out_of_semester`; воскресенье или нерабочий день → `day_off`. Суббота разрешена.
- `slot`: не целое от 1 до числа звонков → `bad_value`; у группы на эти дату и номер уже есть другая пара → `group_busy`.
- `teacherId`: нет в `staff` → `bad_ref`; не активен или нет роли `teacher` → `bad_value`; у него на эти дату и номер другая пара → `teacher_busy`.
- `roomId`: пусто можно; нет в `rooms` → `bad_ref`; занята на эти дату и номер → `room_busy`.
- `note`: обрезается по краям; длиннее 200 → `too_long`.
- Занятость считается по парам со статусом не `cancelled` и не `missed`, сама пара не в счёт: `busyCodes(pairSlots(ctx.pairs), { id: pair.id, day: next.date, slot: next.slot, groupId: pair.groupId, teacherId: next.teacherId, roomId: next.roomId })`; `group_busy` → поле `slot`, `teacher_busy` → `teacherId`, `room_busy` → `roomId`. Если дата или номер пары неверны, занятость не проверяется; поле, у которого уже есть ошибка, второй не получает.

- [ ] **Step 1: тесты.** 1 сентября 2026 — вторник; 7 сентября — понедельник.

```js
const S = { semesterStart: '2026-09-01', semesterEnd: '2026-09-11', holidays: ['2026-09-07'], bells: DEFAULT_BELLS };
const subjects = [{ id: 'sb_1', groupId: 'g_1', teacherId: 'sf_1' }, { id: 'sb_2', groupId: 'g_2', teacherId: 'sf_2' }, { id: 'sb_3', groupId: 'g_1', teacherId: 'sf_2' }];
const T = [{ id: 'wt_1', weekday: 2, slot: 1, subjectId: 'sb_1', roomId: 'r_1' },
  { id: 'wt_2', weekday: 1, slot: 2, subjectId: 'sb_1', roomId: 'r_1' },        // единственный понедельник семестра — нерабочий
  { id: 'wt_3', weekday: 5, slot: 1, subjectId: 'sb_2', roomId: '' }];
assert.deepEqual(workingDays(S), ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
assert.deepEqual(workingDays(S, '2026-09-05'), ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);

const first = planGeneration({ template: T, subjects, settings: S, pairs: [], from: '2026-09-01' });
assert.deepEqual(first.toInsert.map(p => [p.date, p.slot, p.groupId, p.subjectId]),
  [['2026-09-01', 1, 'g_1', 'sb_1'], ['2026-09-04', 1, 'g_2', 'sb_2'], ['2026-09-08', 1, 'g_1', 'sb_1'], ['2026-09-11', 1, 'g_2', 'sb_2']]);
assert.deepEqual(first.toInsert[0], { date: '2026-09-01', slot: 1, startTime: '08:00', groupId: 'g_1', subjectId: 'sb_1', teacherId: 'sf_1',
  roomId: 'r_1', topicId: '', status: 'planned', planDate: '2026-09-01', planSlot: 1, changed: false, note: '' });
const E = first.toInsert.map((p, i) => ({ ...p, id: 'p' + (i + 1) }));

// Review Focus 2: второй запуск ничего не делает
assert.deepEqual(planGeneration({ template: T, subjects, settings: S, pairs: E, from: '2026-09-01' }),
  { toInsert: [], toUpdate: [], toRemove: [], kept: 4, conflicts: 0 });

// шаблон и преподаватель изменились, пара p3 перенесена вручную
const T2 = T.map(r => (r.id === 'wt_1' ? { ...r, roomId: 'r_2' } : r));
const subjects2 = subjects.map(s => (s.id === 'sb_2' ? { ...s, teacherId: 'sf_3' } : s));
const E2 = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-09', slot: 2, startTime: '09:40', changed: true } : p));
assert.deepEqual(planGeneration({ template: T2, subjects: subjects2, settings: S, pairs: E2, from: '2026-09-01' }),
  { toInsert: [], toUpdate: [{ id: 'p1', patch: { roomId: 'r_2' } }, { id: 'p2', patch: { teacherId: 'sf_3' } }, { id: 'p4', patch: { teacherId: 'sf_3' } }],
    toRemove: [], kept: 1, conflicts: 0 });
// прошедшие даты не трогаются
assert.deepEqual(planGeneration({ template: T2, subjects: subjects2, settings: S, pairs: E2, from: '2026-09-05' }),
  { toInsert: [], toUpdate: [{ id: 'p4', patch: { teacherId: 'sf_3' } }], toRemove: [], kept: 1, conflicts: 0 });
// строку шаблона убрали: обычная пара удаляется, отменённая вручную остаётся
const E3 = E.map(p => (p.id === 'p4' ? { ...p, status: 'cancelled', changed: true } : p));
assert.deepEqual(planGeneration({ template: T.slice(0, 2), subjects, settings: S, pairs: E3, from: '2026-09-01' }),
  { toInsert: [], toUpdate: [], toRemove: ['p2'], kept: 3, conflicts: 0 });
// проведённая пара не переписывается
const E4 = E.map(p => (p.id === 'p1' ? { ...p, status: 'closed' } : p));
assert.deepEqual(planGeneration({ template: T2, subjects, settings: S, pairs: E4, from: '2026-09-01' }).toUpdate, [{ id: 'p3', patch: { roomId: 'r_2' } }]);
// место занято перенесённой парой
const T5 = [...T, { id: 'wt_4', weekday: 4, slot: 3, subjectId: 'sb_3', roomId: '' }];
const E5 = E.map(p => (p.id === 'p3' ? { ...p, date: '2026-09-10', slot: 3, startTime: '11:20', changed: true } : p));
const busy = planGeneration({ template: T5, subjects, settings: S, pairs: E5, from: '2026-09-01' });
assert.deepEqual([busy.toInsert.map(p => [p.date, p.slot, p.subjectId]), busy.conflicts], [[['2026-09-03', 3, 'sb_3']], 1]);
// Review Focus 5, аудитория: другая группа в той же аудитории, где стоит перенесённая пара p3 (2026-09-10, пара 3, r_1)
const TR = [...T, { id: 'wt_5', weekday: 4, slot: 3, subjectId: 'sb_2', roomId: 'r_1' }];
const roomBusy = planGeneration({ template: TR, subjects, settings: S, pairs: E5, from: '2026-09-01' });
assert.deepEqual([roomBusy.toInsert.map(p => [p.date, p.slot, p.subjectId]), roomBusy.conflicts], [[['2026-09-03', 3, 'sb_2']], 1]);
// Review Focus 5, преподаватель: на пару p1 (2026-09-01, пара 1) вручную поставили замену sf_2; строка шаблона предмета sf_2 в это же время
const E7 = E.map(p => (p.id === 'p1' ? { ...p, teacherId: 'sf_2', changed: true } : p));
const TT = [...T, { id: 'wt_6', weekday: 2, slot: 1, subjectId: 'sb_2', roomId: '' }];
const teacherBusy = planGeneration({ template: TT, subjects, settings: S, pairs: E7, from: '2026-09-01' });
assert.deepEqual([teacherBusy.toInsert.map(p => [p.date, p.slot, p.subjectId]), teacherBusy.conflicts], [[['2026-09-08', 1, 'sb_2']], 1]);
// то же для toUpdate: p2 вручную перенесли на 2026-09-08, пара 1, в r_2; шаблон отдаёт r_2 строке wt_1 -> p3 (2026-09-08, пара 1) не меняется
const E8 = E.map(p => (p.id === 'p2' ? { ...p, date: '2026-09-08', slot: 1, roomId: 'r_2', changed: true } : p));
assert.deepEqual(planGeneration({ template: T2, subjects, settings: S, pairs: E8, from: '2026-09-01' }),
  { toInsert: [], toUpdate: [{ id: 'p1', patch: { roomId: 'r_2' } }], toRemove: [], kept: 2, conflicts: 1 });
// случайный дубль убирается
assert.deepEqual(planGeneration({ template: T, subjects, settings: S, pairs: [...E, { ...E[0], id: 'p5' }], from: '2026-09-01' }).toRemove, ['p5']);
// номер пары больше числа звонков
assert.deepEqual(planGeneration({ template: [{ id: 'wt_9', weekday: 2, slot: 7, subjectId: 'sb_1', roomId: '' }], subjects, settings: S, pairs: [], from: '2026-09-01' }),
  { toInsert: [], toUpdate: [], toRemove: [], kept: 0, conflicts: 2 });
// начать заново
const again = planGeneration({ template: T, subjects, settings: S, pairs: E2, from: '2026-09-01', restart: true });
assert.deepEqual([again.toRemove, again.toInsert.length, again.toUpdate, again.kept], [['p1', 'p2', 'p3', 'p4'], 4, [], 0]);
```

```js
// checkPairChange — Review Focus 5
const staff = [{ id: 'sf_1', roles: 'teacher', active: true }, { id: 'sf_2', roles: 'dean,teacher', active: true },
  { id: 'sf_3', roles: 'dean', active: true }, { id: 'sf_4', roles: 'teacher', active: false }];
const rooms = [{ id: 'r_1' }, { id: 'r_2' }];
const p6 = { id: 'p6', groupId: 'g_1', subjectId: 'sb_3', date: '2026-09-09', slot: 2, teacherId: 'sf_2', roomId: 'r_2', status: 'planned' };
const p7 = { id: 'p7', groupId: 'g_2', subjectId: 'sb_2', date: '2026-09-09', slot: 3, teacherId: 'sf_2', roomId: 'r_1', status: 'planned' };
const ctx = { pairs: [...E, p6, p7], staff, rooms, settings: S, today: '2026-09-02' };
const p3 = E[2];                                                              // g_1, 2026-09-08, пара 1, sf_1, r_1
const errors = (patch, c = ctx) => checkPairChange(p3, patch, c).errors;

assert.deepEqual(checkPairChange(p3, {}, ctx), { errors: [],
  next: { date: '2026-09-08', slot: 1, startTime: '08:00', teacherId: 'sf_1', roomId: 'r_1', note: '', changed: true } });
assert.deepEqual(checkPairChange(p3, { date: '2026-09-09', slot: 3, roomId: '', note: ' Конференция ' }, ctx).next,
  { date: '2026-09-09', slot: 3, startTime: '11:20', teacherId: 'sf_1', roomId: '', note: 'Конференция', changed: true });
assert.deepEqual(errors({ date: '2026-09-09', slot: 2 }), [{ field: 'slot', code: 'group_busy' }]);
assert.deepEqual(errors({ date: '2026-09-09', slot: 3 }), [{ field: 'roomId', code: 'room_busy' }]);
assert.deepEqual(errors({ date: '2026-09-09', slot: 3, roomId: 'r_2', teacherId: 'sf_2' }), [{ field: 'teacherId', code: 'teacher_busy' }]);
assert.deepEqual(errors({ date: '2026-09-09', slot: 2 }, { ...ctx, pairs: [...E, { ...p6, status: 'cancelled' }, p7] }), []);   // отменённая место не занимает
assert.deepEqual(errors({ date: '2026-09-05' }), []);                                             // суббота
assert.deepEqual(errors({ date: '2026-09-06' }), [{ field: 'date', code: 'day_off' }]);           // воскресенье
assert.deepEqual(errors({ date: '2026-09-07' }), [{ field: 'date', code: 'day_off' }]);           // нерабочий день
assert.deepEqual(errors({ date: '2026-09-12' }), [{ field: 'date', code: 'out_of_semester' }]);
assert.deepEqual(errors({ date: '2026-09-01' }), [{ field: 'date', code: 'in_past' }]);
assert.deepEqual(errors({ date: 'завтра', slot: 7 }), [{ field: 'date', code: 'bad_value' }, { field: 'slot', code: 'bad_value' }]);
assert.deepEqual(errors({ teacherId: 'sf_x' }), [{ field: 'teacherId', code: 'bad_ref' }]);
assert.deepEqual(errors({ teacherId: 'sf_3' }), [{ field: 'teacherId', code: 'bad_value' }]);     // нет роли преподавателя
assert.deepEqual(errors({ teacherId: 'sf_4' }), [{ field: 'teacherId', code: 'bad_value' }]);     // не активен
assert.deepEqual(errors({ roomId: 'r_x', note: 'x'.repeat(201) }), [{ field: 'roomId', code: 'bad_ref' }, { field: 'note', code: 'too_long' }]);

assert.equal(pairLock(p3, '2026-09-08'), null);
assert.equal(pairLock(p3, '2026-09-09'), 'in_past');
assert.equal(pairLock({ ...p3, status: 'closed' }, '2026-09-02'), 'pair_locked');
```

- [ ] **Step 2:** падает. **Step 3:** написать `core/schedule.js`. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: semester generation plan and pair change rules`.

---

### Task 5 (С): настройки семестра, шаблон и темы через справочники, запрет удаления

**Files:** Create `backend/handlers/settings.js`, `tests/settingsApi.test.js`, `tests/dirSchedule.test.js`. Modify `backend/handlers/dir.js`, `backend/handlers/import.js` (только вызов `loadDb`: `loadDb(store, table)`, а для `topics` сразу `loadDb(store, 'topics', ['groups', 'pairs'])` — импорту тем нужны группы для столбца «Группа» и пары для проверки `held`), `backend/api.js` (регистрация).

**Interfaces — Consumes:** `readSettings`, `validateSettings`, `settingsToRows`, `DEFAULT_BELLS`, `PAIR_MINUTES` (Task 2); `validateRow` для `weekTemplate` и `topics` (Task 3); `templateSlots(template, subjects)` и `busyCodes(slots, cand)` из `core/busy.js` (Task 3): `templateSlots` даёт `Slot = { id, day: weekday, slot, groupId, teacherId, roomId }` (группа и преподаватель — из предмета строки), `busyCodes` — подмножество `['group_busy', 'teacher_busy', 'room_busy']` (есть запись с тем же `day` и `slot`, другим `id` и тем же непустым значением); `FIXED_STATUSES` (Task 2); `updateMany`, `removeMany` (Task 1).

**Produces:**

- `settings.get {}` → `{ settings, defaultBells, pairMinutes }`; `settings` — результат `readSettings`.
- `settings.save { settings }` → `{ settings }`. Ошибки проверки → `AppError('invalid', { fields })`. Запись: строка с таким ключом обновляется, если значение другое, иначе не трогается; ключа нет — добавляется. Повторное сохранение строк не плодит.
- `dir.list`, `dir.save`, `dir.remove` принимают таблицы `weekTemplate` и `topics`.
- `export function loadDb(store, table, extra = [])` — читает только листы, нужные таблице:

| table | листы |
| --- | --- |
| groups | groups |
| students | groups, students, staff |
| staff | staff, students |
| subjects | subjects, staff, groups |
| rooms | rooms |
| weekTemplate | weekTemplate, subjects, rooms + `slotCount` (число звонков из настроек) |
| topics | topics, subjects |

`extra` — дополнительные листы, каждый читается один раз и кладётся в результат под своим именем. Кто какие `extra` передаёт:

- `dir.save` для `subjects` — всегда `loadDb(store, 'subjects', ['weekTemplate', 'pairs'])`: особым правилам ниже нужны строки шаблона и пары;
- импорт тем (`backend/handlers/import.js`) — `loadDb(store, 'topics', ['groups', 'pairs'])`;
- остальные вызовы — без `extra`.

Особые правила `dir.save`:

- `subjects`: у существующего предмета меняют `groupId`, а на предмет ссылается строка шаблона или пара → `invalid`, `[{ field: 'groupId', code: 'in_use' }]`. Эта проверка идёт раньше `validateRow`.
- `subjects`: у существующего предмета меняют `teacherId`, а у нового преподавателя в шаблоне уже есть пара в тот же день и с тем же номером, что у этого предмета → `invalid`, `[{ field: 'teacherId', code: 'teacher_busy' }]`. Проверка — только через `core/busy.js`, своей в обработчике нет: `slots = templateSlots(db.weekTemplate, db.subjects)`; для каждой строки шаблона `r` этого предмета `busyCodes(slots, { id: r.id, day: r.weekday, slot: r.slot, groupId: '', teacherId: <новый преподаватель>, roomId: '' })` содержит `'teacher_busy'` → ошибка. В остальных случаях смена преподавателя разрешена; будущие пары получат его при следующем «Создать расписание».
- `topics`: у существующей темы меняют `subjectId` → `invalid`, `[{ field: 'subjectId', code: 'bad_value' }]`.

`dir.remove` — `in_use`, если на строку ссылаются (читаются только нужные листы):

| Удаляют | Мешает |
| --- | --- |
| группу | студент, предмет, пара |
| сотрудника | предмет, пара (он в ней преподаватель) |
| предмет | тема, строка шаблона, пара |
| аудиторию | строка шаблона, пара |
| тему | пара со статусом из `FIXED_STATUSES` |
| строку шаблона | ничего |

- [ ] **Step 1: тесты.**

```js
// tests/settingsApi.test.js
assert.deepEqual(call('settings.get', {}, prorector).data,
  { settings: { semesterStart: '', semesterEnd: '', holidays: [], bells: DEFAULT_BELLS }, defaultBells: DEFAULT_BELLS, pairMinutes: 90 });
const input = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: ['2026-11-07', '2026-09-07', '2026-11-07'], bells: ['08:00', '09:40'] };
assert.deepEqual(call('settings.save', { settings: input }, dean).data.settings.holidays, ['2026-09-07', '2026-11-07']);
assert.equal(store.list('settings').length, 4);
call('settings.save', { settings: { ...input, bells: ['08:00', '09:40', '11:20'] } }, dean);
assert.equal(store.list('settings').length, 4);                                       // обновление, не новые строки
assert.deepEqual(call('settings.get', {}, dean).data.settings.bells, ['08:00', '09:40', '11:20']);
assert.deepEqual(call('settings.save', { settings: { ...input, semesterEnd: '2026-08-01', bells: ['08:00', '09:00'] } }, dean).error,
  { code: 'invalid', fields: [{ field: 'semesterEnd', code: 'bad_value' }, { field: 'bells', code: 'bad_value' }] });
assert.deepEqual(call('settings.save', { settings: input }, prorector).error, { code: 'forbidden' });
assert.deepEqual(call('settings.get', {}, teacher1).error, { code: 'forbidden' });
assert.equal(call('settings.save', {}, dean).error.code, 'invalid');                  // нет данных — не исключение
```

```js
// tests/dirSchedule.test.js — подготовка: группы g1, g2; предметы sb1 «Информатика» (g1, teacher1), sb2 «Анатомия» (g1, teacher2),
// sb3 «Химия» (g2, teacher1); аудитории r1, r2, r3; настройки сохранены с двумя звонками
const wt = call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 1, subjectId: sb1, roomId: r1 } }, dean).data.row;
assert.deepEqual(wt, { id: wt.id, weekday: 1, slot: 1, subjectId: sb1, roomId: r1 });
assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 1, subjectId: sb2, roomId: r2 } }, dean).error,
  { code: 'invalid', fields: [{ field: 'slot', code: 'group_busy' }] });
assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 1, slot: 3, subjectId: sb2, roomId: r2 } }, dean).error,
  { code: 'invalid', fields: [{ field: 'slot', code: 'bad_value' }] });               // звонков только два
assert.deepEqual(call('dir.save', { table: 'weekTemplate', row: { weekday: 2, slot: 1, subjectId: sb2, roomId: '' } }, prorector).error, { code: 'forbidden' });
assert.equal(call('dir.list', { table: 'weekTemplate' }, prorector).data.rows.length, 1);
assert.deepEqual(call('dir.list', { table: 'topics' }, teacher1).error, { code: 'forbidden' });

const tp = call('dir.save', { table: 'topics', row: { subjectId: sb1, unit: 1, order: 1, name: 'Введение', lessonType: 'lecture' } }, dean).data.row;
assert.deepEqual(call('dir.save', { table: 'topics', row: { subjectId: sb1, unit: 1, order: 1, name: 'Дубль', lessonType: 'lecture' } }, dean).error,
  { code: 'invalid', fields: [{ field: 'order', code: 'duplicate' }] });
assert.deepEqual(call('dir.save', { table: 'topics', row: { id: tp.id, subjectId: sb3 } }, dean).error,
  { code: 'invalid', fields: [{ field: 'subjectId', code: 'bad_value' }] });
assert.equal(call('dir.save', { table: 'topics', row: { id: tp.id, name: 'Введение в IT' } }, dean).data.row.name, 'Введение в IT');

// запрет удаления
assert.deepEqual(call('dir.remove', { table: 'subjects', id: sb1 }, dean).error, { code: 'in_use' });      // тема и строка шаблона
assert.deepEqual(call('dir.remove', { table: 'rooms', id: r1 }, dean).error, { code: 'in_use' });          // строка шаблона
assert.deepEqual(call('dir.save', { table: 'subjects', row: { id: sb1, groupId: g2 } }, dean).error,
  { code: 'invalid', fields: [{ field: 'groupId', code: 'in_use' }] });
assert.equal(call('dir.save', { table: 'subjects', row: { id: sb1, teacherId: teacher2Id } }, dean).ok, true);
// Review Focus 5: строка шаблона «sb3, понедельник, пара 1, r2» сохраняется (у sb3 преподаватель teacher1, у sb1 теперь teacher2);
//   затем отдать sb3 преподавателю teacher2 -> { code: 'invalid', fields: [{ field: 'teacherId', code: 'teacher_busy' }] }
// группа g3 без студентов и предметов, сотрудник teacher3 без предметов, аудитория r3, тема tp9 — и пара, которая на них ссылается:
store.insert('pairs', { date: '2026-09-01', slot: 1, startTime: '08:00', groupId: g3, subjectId: sb3, teacherId: teacher3Id, roomId: r3, topicId: tp9, status: 'closed', planDate: '2026-09-01', planSlot: 1 });
for (const [table, id] of [['groups', g3], ['staff', teacher3Id], ['rooms', r3], ['topics', tp9], ['subjects', sb3]])
  assert.deepEqual(call('dir.remove', { table, id }, admin).error, { code: 'in_use' }, table);
// та же тема на паре со статусом 'planned' удаляется; строка шаблона удаляется всегда
assert.equal(call('dir.remove', { table: 'weekTemplate', id: wt.id }, dean).ok, true);

// скорость: обёртка-шпион над хранилищем записывает таблицу каждого вызова list в массив reads (обнуляется перед каждым запросом).
// Ключ входа проверяется через store.get, а не list, поэтому 'staff' в reads не попадает.
// dir.save { table: 'groups', row: { name: '09-9', course: 3 } }   -> assert.deepEqual(reads, ['groups'])
// dir.save { table: 'subjects', row: { id: sb2, name: 'Анатомия' } } -> assert.deepEqual([...reads].sort(), ['groups', 'pairs', 'staff', 'subjects', 'weekTemplate'])
// dir.remove { table: 'rooms', id: r2 }                            -> reads не содержит 'students', и ни одна таблица не встречается дважды
```

- [ ] **Step 2:** падает. **Step 3:** написать. Прежние тесты `tests/dir.test.js` и `tests/importApi.test.js` остаются зелёными. Пересчёт тем после изменения тем и импорта появится в Task 6; здесь импорт тем уже получает группы и пары (`loadDb(store, 'topics', ['groups', 'pairs'])`), чтобы между задачами не было сломанного импорта. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: semester settings API, week template and topics directories, delete protection`.

---

### Task 6 (С): создание расписания и пересчёт тем

**Files:** Create `backend/scheduleData.js`, `backend/handlers/schedule.js`, `tests/scheduleApi.test.js`. Modify `backend/handlers/dir.js`, `backend/handlers/import.js`, `backend/api.js`, `tests/importApi.test.js`.

**Interfaces — Consumes:** `planGeneration` (Task 4), `layoutTopics` (Task 3), `readSettings` (Task 2), `localDate` (Task 1), `loadDb` (Task 5), `updateMany`, `removeMany`, `insertMany`.

**Produces:**

```js
// backend/scheduleData.js — без объектов Node и Apps Script
export function todayOf(platform);                         // localDate(platform.now())
export function loadSettings(store);                       // readSettings(store.list('settings'))
export function relayout(store, subjectIds = null, rows = {});
// пересчитывает темы предметов (null — всех).
// rows = { topics?, pairs? } — строки, которые этот запрос уже прочитал, в состоянии ПОСЛЕ своей записи; переданный лист не читается.
// -> { changed, topics, pairs }: changed — число пар, у которых сменилась тема; topics и pairs — все строки после пересчёта
//    (у пар уже новый topicId), чтобы вызывающий не читал эти листы ещё раз.
export function generateSchedule(store, platform, { dryRun = false, restart = false } = {});
// -> { from, to, inserted, updated, removed, kept, conflicts }
```

- `relayout`: «Темы» и «Пары» берутся из `rows`, а чего там нет — читается одним `list`; `layoutTopics` по каждому предмету; одна запись `updateMany`. Нечего менять — записи нет.
- Правило одного чтения (Global Constraints): за запрос каждый лист читается не больше одного раза. Обработчик передаёт в `relayout` всё, что уже прочитал, приведя в памяти к состоянию после своей записи: удалённые строки убраны, к изменённым применён `patch`, новые добавлены в том виде, в каком их вернул `insertMany` / `insert` (с `id`).
- `generateSchedule`:
  - нет дат семестра → `AppError('invalid', { fields: [{ field: 'semesterStart', code: 'required' }] })`;
  - шаблон пуст → `AppError('empty_template')`;
  - `restart` и есть пара со статусом не `planned` и не `cancelled` → `AppError('in_use')`;
  - `from`: пар ещё нет или `restart` → начало семестра; иначе более поздняя из дат «сегодня» и «начало семестра»; `to` — конец семестра;
  - `dryRun` → только числа, записи нет;
  - иначе по одному вызову `removeMany`, `updateMany`, `insertMany` (пустые не делаются), затем `relayout(store, null, { pairs })`, где `pairs` — прочитанные пары после этой записи в памяти. «Темы» читает сам `relayout`.
- Действия: `schedule.generate { dryRun?, restart? }` → результат `generateSchedule`; `topics.plan { subjectId }` →

```js
{ subject: { id, name, groupId, groupName, teacherId, teacherName },
  topics: [{ id, unit, order, name, lessonType, pair: { id, date, slot, startTime, status } | null }],   // по order; pair — пара, на которой стоит тема
  withoutTopic: number }                                                                                 // запланированные пары предмета без темы
```

  Предмета нет → `not_found`. Вошедший действует только как преподаватель (нет ролей `admin`, `dean`, `prorector`) и предмет не его → `forbidden`.
- Пересчёт после изменения тем: `dir.save` и `dir.remove` для `topics` вызывают `relayout(store, [subjectId], rows)`, где `rows` — уже прочитанные в запросе «Темы» (из `loadDb`) и/или «Пары» (проверка `in_use` при удалении) после записи; `import.apply` для `topics` после записи вызывает `relayout(store, <затронутые предметы>, { topics, pairs: db.pairs })`, где `topics` — `db.topics` после записи. База для импорта тем уже собирается как `loadDb(store, 'topics', ['groups', 'pairs'])` (с Task 5).
- Запись импорта: `apply` в `backend/handlers/import.js` пишет обновления одним `store.updateMany(table, items)` — только строки, у которых `sameValues` ложно; пустой список не пишется — вместо `store.update` в цикле. Код `apply` общий, поэтому так пишут все таблицы импорта; порядок прежний (сначала обновления, потом `insertMany`), прежние тесты импорта остаются зелёными.

- [ ] **Step 1: тесты.** Настройки `S` и шаблон `T` — как в Task 4, записаны в хранилище; группы `01-1` (g1) и `02-1` (g2); предметы `sb1` «Информатика» (g1, teacher1), `sb2` «Анатомия» (g2, teacher2); у `sb1` три темы с номерами 1–3 (`topic1`…`topic3`). Часы: 31 августа 2026, 12:00 по Бишкеку (`Date.UTC(2026, 7, 31, 6)`).

```js
const dry = call('schedule.generate', { dryRun: true }, dean).data;
assert.deepEqual(dry, { from: '2026-09-01', to: '2026-09-11', inserted: 4, updated: 0, removed: 0, kept: 0, conflicts: 0 });
assert.equal(store.list('pairs').length, 0);
assert.deepEqual(call('schedule.generate', {}, dean).data, dry);
const mine = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
assert.deepEqual(mine().map(p => [p.date, p.topicId]), [['2026-09-01', topic1], ['2026-09-08', topic2]]);
const plan = call('topics.plan', { subjectId: sb1 }, dean).data;
assert.deepEqual(plan.topics.map(t => [t.order, t.pair && t.pair.date]), [[1, '2026-09-01'], [2, '2026-09-08'], [3, null]]);
assert.equal(plan.withoutTopic, 0);
assert.equal(JSON.stringify(plan).includes('passwordHash'), false);

// Review Focus 2
assert.deepEqual(call('schedule.generate', {}, dean).data, { ...dry, inserted: 0, kept: 4 });
assert.equal(store.list('pairs').length, 4);
now = Date.UTC(2026, 8, 3, 6);                                                  // 3 сентября
// у строки шаблона wt_1 сменили аудиторию
const later = call('schedule.generate', {}, dean).data;
assert.deepEqual(later, { from: '2026-09-03', to: '2026-09-11', inserted: 0, updated: 1, removed: 0, kept: 2, conflicts: 0 });
assert.equal(mine()[0].roomId, r1);                                             // пара 1 сентября не тронута

// скорость: настоящий запуск делает не больше одного insertMany, двух updateMany и одного removeMany,
// и ни одного insert, update, remove (обёртка-шпион над хранилищем); list каждой таблицы — не больше одного раза за запрос.
// Тот же шпион: dir.save и dir.remove для topics и import.apply для topics читают каждую таблицу не больше одного раза;
// import.apply для topics делает ни одного update и не больше одного updateMany('topics').

// ошибки
assert.deepEqual(call('schedule.generate', {}, teacher1).error, { code: 'forbidden' });
assert.deepEqual(call('schedule.generate', {}, prorector).error, { code: 'forbidden' });
// нет настроек -> { code: 'invalid', fields: [{ field: 'semesterStart', code: 'required' }] }; шаблон пуст -> { code: 'empty_template' }
// restart при паре со статусом 'closed' -> { code: 'in_use' }; restart без проведённых пар -> removed 4, inserted 4

// темы пересчитываются
call('dir.remove', { table: 'topics', id: topic1 }, dean);
assert.deepEqual(mine().map(p => p.topicId), [topic2, topic3]);
// импорт одной темы для sb2 (у него тем не было) -> пара 4 сентября получила эту тему

// Review Focus 3: пара 1 сентября проведена, на ней тема № 2
store.update('pairs', mine()[0].id, { status: 'closed' });
const cells = [['Предмет', 'Группа', 'Юнит', '№', 'Тема', 'Тип'],
  ['Информатика', '01-1', 1, 2, 'Другое название', 'лекция'],
  ['Информатика', '01-1', 1, 4, 'Новая тема', 'практика']];
const imported = call('import.apply', { table: 'topics', cells }, dean).data;
assert.deepEqual([imported.inserted, imported.updated, imported.skipped, imported.errors], [1, 0, 1, [{ row: 2, field: 'name', code: 'held' }]]);
assert.deepEqual(call('topics.plan', { subjectId: sb1 }, dean).data.topics.map(t => [t.order, t.name === 'Другое название', t.pair && t.pair.date]),
  [[2, false, '2026-09-01'], [3, false, '2026-09-08'], [4, false, null]]);

// Review Focus 6
assert.equal(call('topics.plan', { subjectId: sb1 }, teacher1).ok, true);
assert.deepEqual(call('topics.plan', { subjectId: sb2 }, teacher1).error, { code: 'forbidden' });
assert.equal(call('topics.plan', { subjectId: sb2 }, dean).ok, true);           // у dean роли dean,teacher
assert.deepEqual(call('topics.plan', { subjectId: 'sb_nope' }, dean).error, { code: 'not_found' });
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: schedule generation API and topic re-layout`.

---

### Task 7 (С): расписание для экранов, замена, перенос и отмена, данные стенда

**Files:** Modify `backend/scheduleData.js`, `backend/handlers/schedule.js`, `dev/seed.js`, `tests/devServer.test.js`, `tests/gasBundle.test.js`. Create `tests/pairsApi.test.js`.

**Interfaces — Consumes:** `checkPairChange`, `pairLock` (Task 4), `relayout(store, subjectIds, rows) -> { changed, topics, pairs }` (Task 6: `rows = { topics?, pairs? }` — уже прочитанные строки после записи, переданный лист не читается; в ответе — все строки после пересчёта), `todayOf`, `loadSettings`, `generateSchedule` (Task 6), `mondayOf`, `addDays`, `addMinutes`, `isDate`, `daysBetween` (Task 2), `PAIR_MINUTES`. Занятость («двое в одном месте») сервер сам не считает: только через `checkPairChange` (он внутри использует `pairSlots` и `busyCodes` из `core/busy.js`, Task 3/4).

**Produces:**

```js
// backend/scheduleData.js
export function pairViews(store, keep, rows = {});
// keep(pair) -> boolean; -> PairView[] по дате, номеру пары, названию группы.
// rows = { pairs?, topics?, groups?, subjects?, staff?, rooms? } — уже прочитанные в этом запросе строки (после записи и пересчёта тем);
// переданный лист не читается, остальные читаются одним list каждый.
// PairView — собирается по полям:
// { id, date, slot, startTime, endTime, status, groupId, groupName, subjectId, subjectName, teacherId, teacherName,
//   roomId, roomName, topic: { id, unit, order, name, lessonType } | null,
//   substitution: boolean, moved: boolean, planDate, planSlot, note }
// endTime = addMinutes(startTime, PAIR_MINUTES); через полночь не переходит: звонки проверены так, что конец пары не позже 23:59 (Task 2).
// substitution — преподаватель пары не тот, что у предмета; moved — date или slot отличаются от плановых.
// Названия несуществующих записей — пустая строка. Каждый лист читается один раз.
```

Действия (ответ `{ pair }` у трёх действий изменения — это `{ pair: PairView }`, тот же вид, что в списках):

- Правило одного чтения: за запрос каждый лист читается не больше одного раза. Действия изменения читают «Пары», сотрудников, аудитории и настройки для `checkPairChange`, после записи передают пары (с применённым изменением) в `relayout(store, [subjectId], { pairs })`, а результат `relayout` и уже прочитанные `staff`, `rooms` — в `pairViews(store, p => p.id === id, { pairs, topics, staff, rooms })`. Если `relayout` не вызывается, в `pairViews` идут пары после записи, `staff`, `rooms`.
- `schedule.list { from?, to?, groupId?, teacherId? }` → `{ today, from, to, pairs }`. `from` необязателен: по умолчанию `mondayOf(today)`, где `today = todayOf(platform)` (сайт часам устройства не верит, поэтому первый запрос экрана идёт без `from`); переданный `from` к понедельнику не приводится. `to` по умолчанию `from + 6`. Даты не `isDate`, `to` раньше `from` или `daysBetween(from, to) > 30` (больше 31 дня включительно) → `bad_request`. Фильтры необязательные; без них — все группы.
- `schedule.mine { from? }` → `{ today, from, to, pairs }`. `from` приводится к понедельнику своей недели (по умолчанию — неделя «сегодня»), `to = from + 6`. Студент получает пары своей группы; сотрудник — пары, где он преподаватель. Неверная дата → `bad_request`.
- `schedule.changePair { id, teacherId?, date?, slot?, roomId?, note? }` → `{ pair: PairView }`. Пары нет → `not_found`; `pairLock` → `AppError` с этим кодом; ошибки `checkPairChange` → `invalid` с полями; запись одним `update`; если изменились дата или номер пары — `relayout(store, [subjectId], { pairs })`.
- `schedule.cancelPair { id, note? }` → `{ pair: PairView }`. Тот же `pairLock`; примечание длиннее 200 → `invalid`, `note: too_long`; ставит `status: 'cancelled'`, `topicId: ''`, `changed: true` и, если `note` передано, записывает его обрезанным по краям (не передано — прежнее примечание остаётся); затем `relayout(store, [subjectId], { pairs })`.
- `schedule.restorePair { id }` → `{ pair: PairView }`. Статус не `cancelled` → `pair_locked`; дата раньше «сегодня» → `in_past`; занятость проверяется `checkPairChange(pair, {}, ctx)`; ставит `status: 'planned'`; затем `relayout(store, [subjectId], { pairs })`.

Данные стенда (вымышленные; `seed` по-прежнему ничего не делает, если сотрудники уже есть):

- К прежнему: предмет «Анатомия» у `teacher2` в каждой из трёх групп (всего 6 предметов).
- Настройки: начало семестра — понедельник за 4 недели до недели «сегодня»; конец — пятница 18-й недели (`начало + 123`); нерабочий день — среда следующей недели (`начало + 37`); звонки по умолчанию.
- Шаблон (g — номер группы 0, 1, 2): «Информатика» — понедельник, пара `g + 1`, аудитория `204`; «Анатомия» — среда и четверг, пара `g + 1`, аудитория `101`. Всего 9 строк.
- Темы: у каждой «Информатики» 18 тем из раздела 12 ТЗ: темы 1–5 и 7 — лекция и практика, тема 8 — практика, темы 9 и 10 — по две практики, тема 11 «Модуль 2 — экзамен» — одна пара типа `control`; юнит 1 — темы 1–5, юнит 2 — темы 7–11; номера по порядку 1–18. У «Анатомии» тем нет.
- Пары: `generateSchedule(store, platform)`; затем прямо в хранилище: пара «Анатомии» группы `01-1` в четверг следующей недели — преподаватель `teacher3`, `changed: true`, примечание «Замена»; пара «Информатики» группы `02-1` в понедельник следующей недели — `status: 'cancelled'`, `changed: true`; затем `relayout(store)`.

- [ ] **Step 1: тесты.** Подготовка: семестр с 1 по 25 сентября 2026, нерабочий день 7 сентября, звонки по умолчанию; группы `01-1` (g1), `02-1` (g2); предметы `sb1` «Информатика» (g1, teacher1) с четырьмя темами № 1–4 и `sb2` «Анатомия» (g2, teacher2) без тем; шаблон: `sb1` — вторник, пара 1, аудитория r1; `sb2` — пятница, пара 1, аудитория r2; студенты `S1` (g1) и `S2` (g2); преподаватель `teacher3` без предметов. Расписание создано 31 августа: у `sb1` пары 1, 8, 15 и 22 сентября (`pair1`, `pair8`, `pair15`, `pair22`) с темами № 1–4, у `sb2` — 4, 11, 18 и 25 сентября. В помощнике тестов ФИО сотрудника равно его логину.

```js
// tests/pairsApi.test.js
now = Date.UTC(2026, 8, 1, 18, 30);                                             // Review Focus 4: 00:30 2 сентября в Бишкеке
const week = call('schedule.mine', { from: '2026-09-10' }, student1).data;
assert.deepEqual([week.today, week.from, week.to], ['2026-09-02', '2026-09-07', '2026-09-13']);
assert.deepEqual(week.pairs.map(p => [p.date, p.subjectName, p.teacherName, p.roomName, p.topic.order, p.startTime, p.endTime]),
  [['2026-09-08', 'Информатика', 'teacher1', r1Name, 2, '08:00', '09:30']]);
assert.equal(JSON.stringify(week).includes('passwordHash'), false);
assert.deepEqual([call('schedule.mine', {}, student1).data.from, call('schedule.mine', {}, student1).data.to], ['2026-08-31', '2026-09-06']);
assert.deepEqual(call('schedule.mine', { from: 'мусор' }, student1).error, { code: 'bad_request' });

// Review Focus 6
assert.deepEqual(call('schedule.mine', { from: '2026-09-07' }, student2).data.pairs.map(p => [p.date, p.groupId]), [['2026-09-11', g2]]);
assert.deepEqual(call('schedule.mine', { from: '2026-09-07' }, teacher1).data.pairs.map(p => p.date), ['2026-09-08']);
assert.deepEqual(call('schedule.list', { from: '2026-09-07' }, student1).error, { code: 'forbidden' });
assert.deepEqual(call('schedule.list', { from: '2026-09-07' }, teacher1).error, { code: 'forbidden' });
assert.deepEqual(call('schedule.changePair', { id: pair8, slot: 2 }, teacher1).error, { code: 'forbidden' });
assert.deepEqual(call('schedule.cancelPair', { id: pair8 }, prorector).error, { code: 'forbidden' });
assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11' }, prorector).data.pairs.length, 4);
assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11', groupId: g1 }, dean).data.pairs.length, 2);
assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-09-11', teacherId: teacher2Id }, dean).data.pairs.length, 2);
assert.deepEqual(call('schedule.list', { from: '2026-09-01', to: '2026-10-15' }, dean).error, { code: 'bad_request' });
assert.equal(call('schedule.list', { from: '2026-09-01', to: '2026-10-01' }, dean).ok, true);                         // граница: daysBetween = 30
assert.deepEqual(call('schedule.list', { from: '2026-09-01', to: '2026-10-02' }, dean).error, { code: 'bad_request' });  // daysBetween = 31
const firstWeek = call('schedule.list', {}, dean).data;                         // без from: неделя «сегодня» по серверу
assert.deepEqual([firstWeek.today, firstWeek.from, firstWeek.to], ['2026-09-02', '2026-08-31', '2026-09-06']);

// Review Focus 1: пара 1 сентября проведена; отмена пары 8 сентября сдвигает темы следующих пар
store.update('pairs', pair1, { status: 'closed' });
const topicsByDate = () => Object.fromEntries(call('schedule.list', { from: '2026-09-01', to: '2026-09-25', groupId: g1 }, dean).data.pairs
  .map(p => [p.date, p.topic ? p.topic.order : null]));
const cancelled = call('schedule.cancelPair', { id: pair8, note: '  Преподаватель на конференции ' }, dean).data.pair;
assert.deepEqual([cancelled.status, cancelled.note, cancelled.topic], ['cancelled', 'Преподаватель на конференции', null]);
assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': null, '2026-09-15': 2, '2026-09-22': 3 });
assert.equal(call('schedule.restorePair', { id: pair8 }, dean).data.pair.status, 'planned');
assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': 2, '2026-09-15': 3, '2026-09-22': 4 });
// перенос: пара 22 сентября встаёт между 8-м и 15-м и получает тему по порядку дат
const moved = call('schedule.changePair', { id: pair22, date: '2026-09-10', slot: 2 }, dean).data.pair;
assert.deepEqual([moved.date, moved.startTime, moved.moved, moved.planDate, moved.planSlot], ['2026-09-10', '09:40', true, '2026-09-22', 1]);
assert.deepEqual(topicsByDate(), { '2026-09-01': 1, '2026-09-08': 2, '2026-09-10': 3, '2026-09-15': 4 });

// замена: пару видит заменяющий, а не прежний преподаватель
const sub = call('schedule.changePair', { id: pair15, teacherId: teacher3Id, note: 'Болезнь' }, dean).data.pair;
assert.deepEqual([sub.teacherName, sub.substitution, sub.moved, sub.note], ['teacher3', true, false, 'Болезнь']);
assert.deepEqual(call('schedule.mine', { from: '2026-09-14' }, teacher3).data.pairs.map(p => p.date), ['2026-09-15']);
assert.equal(call('schedule.mine', { from: '2026-09-14' }, teacher1).data.pairs.length, 0);

// Review Focus 5 и запреты
assert.deepEqual(call('schedule.changePair', { id: pair15, date: '2026-09-06' }, dean).error, { code: 'invalid', fields: [{ field: 'date', code: 'day_off' }] });
assert.deepEqual(call('schedule.changePair', { id: pair15, date: '2026-09-10', slot: 2 }, dean).error,
  { code: 'invalid', fields: [{ field: 'slot', code: 'group_busy' }, { field: 'roomId', code: 'room_busy' }] });         // там уже стоит перенесённая пара в той же аудитории
assert.deepEqual(call('schedule.changePair', { id: pair1, slot: 2 }, dean).error, { code: 'pair_locked' });               // проведена
assert.deepEqual(call('schedule.restorePair', { id: pair15 }, dean).error, { code: 'pair_locked' });                      // не отменена
assert.deepEqual(call('schedule.cancelPair', { id: 'p_nope' }, dean).error, { code: 'not_found' });
assert.deepEqual(call('schedule.cancelPair', { id: pair15, note: 'x'.repeat(201) }, dean).error, { code: 'invalid', fields: [{ field: 'note', code: 'too_long' }] });
now = Date.UTC(2026, 8, 9, 6);                                                   // 9 сентября
assert.deepEqual(call('schedule.cancelPair', { id: pair8 }, dean).error, { code: 'in_past' });
assert.deepEqual(call('schedule.changePair', { id: pair8, slot: 2 }, dean).error, { code: 'in_past' });

// скорость (обёртка-шпион над хранилищем, как в Task 6): changePair с переносом, cancelPair и restorePair
// вызывают list каждой таблицы не больше одного раза за запрос и ни одного update/remove в цикле (одна пара — один update, пересчёт тем — один updateMany)
```

```js
// tests/devServer.test.js — заменить ожидания теста о данных стенда; часы: 21 ноября 2026, 12:00 по Бишкеку
const platform = createNodePlatform({ now: () => Date.UTC(2026, 10, 21, 6) });
seed(store, platform);
assert.deepEqual(readSettings(store.list('settings')),
  { semesterStart: '2026-10-19', semesterEnd: '2027-02-19', holidays: ['2026-11-25'], bells: DEFAULT_BELLS });
assert.deepEqual([store.list('subjects').length, store.list('weekTemplate').length, store.list('topics').length, store.list('pairs').length], [6, 9, 54, 159]);
const pairs = store.list('pairs');
assert.equal(pairs.filter(p => p.status === 'cancelled').length, 1);
assert.deepEqual(pairs.filter(p => p.note === 'Замена').map(p => p.date), ['2026-11-26']);
// «Информатика» группы 01-1: 18 пар, у всех разные темы; группы 02-1: 17 запланированных пар с темами, одна тема без пары
// прежние проверки (66 студентов, 3 группы, 3 аудитории, 6 сотрудников, S1002) остаются

// tests/gasBundle.test.js — после setup()
for (const name of ['Шаблон недели', 'Темы', 'Пары']) assert.ok(spreadsheet.getSheetByName(name), name);
// колонка «дата» листа «Пары» имеет текстовый формат '@': дата не превращается в дату Google
// (защита от регрессии: формат ставит уже существующий markTextColumns, как только в схеме есть «Пары» (Task 2), поэтому на Step 2 эта проверка уже зелёная — это ожидаемо)
```

- [ ] **Step 2:** падает (кроме проверки формата `'@'` в `tests/gasBundle.test.js`: она зелёная с Task 2, красной не ждать). **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` проходит.
- [ ] **Step 5:** `npm run dev:reset`, запрос `schedule.mine` под `teacher1` и под `S1001` возвращает пары текущей недели.
- [ ] **Step 6:** коммит `feat: schedule views, substitutions, moves and cancellations, dev seed with a schedule`.

---

### Task 8 (Э): экран «Настройки семестра»

**Files:** Create `site/js/dates.js`, `site/js/views/settings.js`, `tests/siteDates.test.js`. Modify `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/icons.js`, `site/js/views/home.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `settings.get`, `settings.save`; `call`, `t`, помощники `site/js/ui.js`.

**Produces:**

```js
// site/js/dates.js — без DOM и без Intl; публикуется только site/, сайт не может загрузить core/, поэтому это копия нужных функций core/dates.js;
// совпадение с core держит сверка в tests/siteDates.test.js
export function isDate(text); export function addDays(date, n); export function weekday(date); export function mondayOf(date);
export function addMinutes(time, n);
export function dayParts(date);            // '2026-11-21' -> { day: 21, month: 11, weekday: 6 }
```

- `resolveRoute`: `#/settings` → `{ view: 'settings', params: {} }`, если есть право `settings.get`. `#/dir/<table>` открывает справочник только для таблиц из `DIR_TABLES` (`#/dir/topics` и `#/dir/weekTemplate` ведут на главную).
- `navFor`: у ролей деканата между главной и справочниками появляется группа `nav.schedule` («Расписание»). Пункты добавляются задачами 8–11; итоговый порядок: `schedule`, `weekTemplate`, `topics`, `settings`. В этой задаче — пункт `{ name: 'settings', href: '#/settings', textKey: 'settings.title', icon: 'settings', hintKey: 'settings.hint' }`. Плитка на главной берёт подсказку из `hintKey`.
- Словари: названия дней и месяцев — `date.weekday.1`…`7`, `date.weekdayShort.1`…`7`, `date.month.1`…`12` (в русском — в родительном падеже: «21 ноября»), `date.dayMonth` (`'{day} {month}'`). Тексты всех новых кодов ошибок: `error.group_busy`, `error.teacher_busy`, `error.room_busy`, `error.in_past`, `error.pair_locked`, `error.empty_template`, `error.held`, `error.out_of_semester`, `error.day_off`, `error.bad_request`.
- Экран (`#/settings`): «Начало семестра» и «Конец семестра» (поля даты); «Нерабочие дни» — список дат с кнопкой удаления у каждой, поле даты и «Добавить»; «Звонки» — строки «1 пара · 08:00–09:30» с полем времени начала (конец считается сам, плюс 90 минут из `pairMinutes`), «Добавить пару» (до 8), «Убрать последнюю», «Вернуть стандартные» (`defaultBells`); «Сохранить». Ошибки `fields` — у своих блоков, понятным текстом (например: «Пары накладываются: между началами должно быть не меньше 90 минут»). После сохранения — сообщение и подсказка: «Чтобы изменения попали в расписание, нажмите „Создать расписание“ на экране „Шаблон недели“». Без права `settings.save` (проректор) поля только для чтения, кнопок нет.

- [ ] **Step 1: тесты.**

```js
// tests/siteDates.test.js — те же значения, что в tests/dates.test.js, и сверка с core
import * as site from '../site/js/dates.js'; import * as core from '../core/dates.js';
for (const d of ['2026-01-01', '2026-02-28', '2026-11-21', '2026-12-31', '2028-02-29']) {
  assert.equal(site.weekday(d), core.weekday(d)); assert.equal(site.mondayOf(d), core.mondayOf(d)); assert.equal(site.addDays(d, 1), core.addDays(d, 1));
  assert.equal(site.addDays(d, -1), core.addDays(d, -1)); assert.equal(site.isDate(d), core.isDate(d));
}
for (const v of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', '', null, 20260101]) assert.equal(site.isDate(v), core.isDate(v), String(v));   // те же плохие значения, что в tests/dates.test.js
for (const [time, n] of [['08:00', 90], ['09:40', 90], ['22:29', 90], ['00:00', 0], ['11:20', 130]]) assert.equal(site.addMinutes(time, n), core.addMinutes(time, n), time);
assert.deepEqual(site.dayParts('2026-11-21'), { day: 21, month: 11, weekday: 6 });
assert.equal(site.addMinutes('08:00', 90), '09:30');

// tests/router.test.js
const office = { mustChangePassword: false, permissions: ['settings.get', 'dir.list:groups', 'dir.list:topics', 'dir.list:weekTemplate'] };
assert.equal(resolveRoute('#/settings', office).view, 'settings');
assert.equal(resolveRoute('#/settings', { mustChangePassword: false, permissions: [] }).view, 'home');
assert.equal(resolveRoute('#/dir/topics', office).view, 'home');
assert.equal(resolveRoute('#/dir/weekTemplate', office).view, 'home');
assert.equal(resolveRoute('#/dir/groups', office).view, 'directory');

// tests/ui.test.js
assert.deepEqual(outline(navFor([...DEAN, 'settings.get'], 'dean')),
  [[null, ['home']], ['nav.schedule', ['settings']], ['home.directories', ['groups', 'students', 'staff', 'subjects', 'rooms']], ['nav.data', ['import']]]);
assert.deepEqual(outline(navFor(DEAN, 'dean')).map(([title]) => title), [null, 'home.directories', 'nav.data']);     // без прав группы нет

// tests/i18n.test.js
for (const code of ['group_busy', 'teacher_busy', 'room_busy', 'in_past', 'pair_locked', 'empty_template', 'held', 'out_of_semester', 'day_off', 'bad_request'])
  assert.ok(ru['error.' + code], code);
for (let n = 1; n <= 7; n++) assert.ok(ru['date.weekday.' + n] && ru['date.weekdayShort.' + n]);
for (let n = 1; n <= 12; n++) assert.ok(ru['date.month.' + n]);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** на `npm run dev:reset`, под `dean`: даты и нерабочий день стенда видны; добавить и убрать нерабочий день; поставить вторую пару на 09:00 — ошибка у звонков, ничего не сохранено; «Вернуть стандартные»; сохранить и перезагрузить — значения на месте. Под `prorector` — только чтение. Под `teacher1` пункта меню нет, адрес `#/settings` ведёт на главную. Три языка, обе темы, консоль без ошибок.
- [ ] **Step 6:** скриншоты экрана (тёмная и светлая тема, ширина 1280) — в `.superpowers/sdd/plan/task-8-shots/`.
- [ ] **Step 7:** коммит `feat: semester settings screen`.

---

### Task 9 (Э): экран «Шаблон недели» и создание расписания

**Files:** Create `site/js/views/weekTemplate.js`. Modify `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/icons.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`.

**Interfaces — Consumes:** `dir.list` (`groups`, `subjects`, `rooms`, `staff`, `weekTemplate`), `dir.save` и `dir.remove` для `weekTemplate`, `settings.get`, `schedule.generate`; `site/js/dates.js` (Task 8).

- `resolveRoute`: `#/template` → `weekTemplate`, если есть `dir.list:weekTemplate`. Пункт меню `{ name: 'weekTemplate', href: '#/template', textKey: 'template.title', icon: 'grid', hintKey: 'template.hint' }` перед `settings`.
- Экран: выбор группы; сетка «дни недели (пн–пт) × пары» — у каждой строки номер пары и время из звонков. В занятой клетке — предмет, преподаватель, аудитория; в пустой — кнопка «+». Нажатие открывает окно: предмет (только предметы выбранной группы; если их нет — подсказка завести предметы в справочнике), аудитория (с вариантом «без аудитории»), «Сохранить», у существующей строки — «Удалить». Ошибки `teacher_busy` (поле `subjectId` — у выбора предмета) и `room_busy` (поле `roomId` — у выбора аудитории) — у своих полей, своим текстом: «У этого преподавателя в это время пара в другой группе», «Аудитория в это время занята». `group_busy` сервер ставит на поле `slot`, а поля ввода для него в окне нет (день и номер пары задаёт клетка): эта ошибка показывается общим сообщением окна над кнопками — «У группы в это время уже есть пара».
- Блок «Расписание на семестр» под сеткой: даты семестра из настроек (если не заданы — сообщение со ссылкой на `#/settings`, кнопки нет). «Создать расписание» → `schedule.generate { dryRun: true }` → окно со сводкой «Добавится / Изменится / Удалится / Без изменений / Не поместилось» и периодом `from`–`to` → «Создать» → настоящий запрос → сообщение об успехе со ссылкой на `#/schedule`. Кнопка на время запроса занята, повторное нажатие не отправляет второй запрос. «Начать заново» → окно-предупреждение (все пары семестра удалятся вместе с заменами, переносами и отменами) → `{ restart: true }`; ответ `in_use` → «Пары уже проводились — начать заново нельзя». `empty_template` → «В шаблоне нет ни одной пары».
- Без права `dir.save:weekTemplate` (проректор) клетки не нажимаются, блока создания нет.

- [ ] **Step 1: тесты.**

```js
// tests/router.test.js
assert.equal(resolveRoute('#/template', office).view, 'weekTemplate');
assert.equal(resolveRoute('#/template', { mustChangePassword: false, permissions: ['settings.get'] }).view, 'home');
// tests/ui.test.js
assert.deepEqual(outline(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate'], 'dean'))[1], ['nav.schedule', ['weekTemplate', 'settings']]);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** под `dean`: у группы `01-1` три пары стенда; добавить «Анатомию» в понедельник третьей парой; попытка поставить группе `02-1` «Информатику» в понедельник первой парой — ошибка «преподаватель занят»; удалить добавленную строку; «Создать расписание» дважды подряд — второй раз сводка «Добавится 0»; «Начать заново» на свежем стенде проходит. Под `prorector` — только просмотр. Ширина 900 px и меньше: сетка прокручивается внутри своей рамки, страница — нет. Обе темы, три языка, консоль без ошибок.
- [ ] **Step 6:** скриншоты (сетка, окно клетки с ошибкой, сводка перед созданием; обе темы) — в `.superpowers/sdd/plan/task-9-shots/`.
- [ ] **Step 7:** коммит `feat: week template screen and schedule generation`.

---

### Task 10 (Э): экран «Темы» и импорт тем

**Files:** Create `site/js/views/topics.js`. Modify `site/js/views/directoryConfig.js`, `site/js/views/directory.js` (только тексты `in_use`), `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `dir.list` (`subjects`, `groups`, `staff`), `topics.plan`, `dir.save` и `dir.remove` для `topics`, `import.preview` и `import.apply` для `topics`; `IMPORT_SPECS.topics` (Task 3) — для сверки в тесте.

- `resolveRoute`: `#/topics` → `topics`, если есть `dir.list:topics`. Пункт меню `{ name: 'topics', href: '#/topics', textKey: 'topics.title', icon: 'clipboard', hintKey: 'topics.hint' }` между `weekTemplate` и `settings`.
- Экран: выбор предмета («Информатика — 01-1», по алфавиту); под ним преподаватель предмета. Таблица из `topics.plan`: №, юнит, тема, тип (метка: лекция / практика / рубежный), дата и номер пары, на которой тема стоит, или метка «без пары». Над таблицей предупреждения: «Не поместилось тем: N — в расписании не хватает пар» и «Пар без темы: N». «Добавить тему» (номер по умолчанию — следующий свободный), изменение и удаление в строке; окно с полями: №, юнит, тема, тип. Ошибки у полей; `in_use` при удалении — «Пара с этой темой уже проведена». Ссылка «Загрузить темы из Excel» ведёт на `#/import`.
- Без права `dir.save:topics` (проректор) — только таблица.
- Импорт: `IMPORT_COLUMNS.topics` и заголовки `import.col.topics.*` уже добавлены в Task 3. Здесь в `directoryConfig.js` `IMPORT_TABLES` получает `'topics'` последним, а `FIELDS` — `subjectId`, `lessonType` (текст) и `unit`, `order` (число): по ним шаблон Excel решает, какие столбцы текстовые. Словари: `dir.topics`, `import.colHint.topics.*` (для «Тип»: «лекция, практика или рубежный»; для «№»: «Номер темы по порядку. Одна строка — одна пара: лекция и практика по одной теме — две строки»), `import.matchBy.topics` («Тема с тем же номером у того же предмета обновится, а не появится второй раз»), `import.error.name.held` («Пара с этой темой уже проведена — импорт её не меняет»), `import.error.subjectId.bad_ref` («В этой группе нет такого предмета»). Подсказка о порядке загрузки (`import.order`) дополняется: темы — после предметов.
- Тексты «используется» обновляются и добавляются: `dir.inUse.groups`, `dir.inUse.staff` (теперь упоминают пары), `dir.inUse.subjects`, `dir.inUse.rooms`.

- [ ] **Step 1: тесты.**

```js
// tests/router.test.js
assert.equal(resolveRoute('#/topics', office).view, 'topics');
// tests/ui.test.js
assert.deepEqual(outline(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate', 'dir.list:topics'], 'dean'))[1], ['nav.schedule', ['weekTemplate', 'topics', 'settings']]);
// tests/i18n.test.js
for (const table of ['groups', 'staff', 'subjects', 'rooms']) assert.ok(ru['dir.inUse.' + table], table);
assert.equal(IMPORT_TABLES[IMPORT_TABLES.length - 1], 'topics');
for (const { key } of IMPORT_COLUMNS.topics) assert.ok(FIELDS[key], key);
assert.deepEqual(IMPORT_COLUMNS.topics.filter(({ key }) => FIELDS[key].kind === 'number').map(({ key }) => key), ['unit', 'order']);
for (const key of ['dir.topics', 'import.matchBy.topics', 'import.error.name.held', 'import.error.subjectId.bad_ref']) assert.ok(ru[key], key);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** под `dean`: у «Информатики — 01-1» 18 тем с датами; у «Информатики — 02-1» предупреждение «Не поместилось тем: 1»; у «Анатомии» — «Пар без темы». Добавить тему № 19 — она «без пары»; удалить тему № 1 — даты остальных сдвинулись на пару раньше. Скачать шаблон тем, вписать три строки для «Анатомии» группы `01-1` (одна — с несуществующей группой), импортировать: 2 новых, 1 ошибка с номером строки; на экране «Темы» у «Анатомии» две темы с датами. Тот же файл второй раз — 0 новых. Удалить аудиторию `204` в справочнике — сообщение «используется» с новым текстом. Обе темы, три языка, консоль без ошибок.
- [ ] **Step 6:** скриншоты (экран тем с предупреждением, окно темы, шаг проверки импорта тем; обе темы) — в `.superpowers/sdd/plan/task-10-shots/`.
- [ ] **Step 7:** коммит `feat: topics screen and topics import`.

---

### Task 11 (Э): экран деканата «Расписание»: замена, перенос, отмена

**Files:** Create `site/js/pairs.js`, `site/js/views/pairParts.js`, `site/js/views/schedule.js`, `tests/pairs.test.js`. Modify `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`.

**Interfaces — Consumes:** `schedule.list`, `schedule.changePair`, `schedule.cancelPair`, `schedule.restorePair`, `settings.get`, `dir.list` (`groups`, `staff`, `rooms`); `PairView` (Task 7); `site/js/dates.js`.

**Produces:**

```js
// site/js/pairs.js — без DOM
export function groupByDay(pairs, from, days = 7);   // -> [{ date, pairs }] на каждый день подряд, пары по slot
export function pairFlags(pair);                      // -> подмножество ['cancelled', 'substitution', 'moved'] в этом порядке
export function canEditPair(pair, today);             // status === 'planned' && pair.date >= today — копия условия pairLock(pair, today) === null из core/schedule.js
export function canRestorePair(pair, today);          // status === 'cancelled' && pair.date >= today — когда показывать «Вернуть пару»
// сайт публикуется только из site/ и core/ загрузить не может; совпадение canEditPair с pairLock держит сверка в tests/pairs.test.js
// site/js/views/pairParts.js — общие части трёх экранов расписания (этот, Task 12)
export function weekNav({ from, onChange });          // «‹ неделя ›», «Эта неделя»; подпись «16–22 ноября»
export function pairCard(pair, { show, onOpen });     // show: какие из ['group', 'teacher'] показывать; onOpen — карточка становится кнопкой
export function dayList(days, today, cardOptions);    // дни подряд, «сегодня» выделен, пустой день — «Пар нет»
```

- `resolveRoute`: `#/schedule` → `schedule`, если есть `schedule.list`. Пункт меню `{ name: 'schedule', href: '#/schedule', textKey: 'schedule.title', icon: 'calendar', hintKey: 'schedule.hint' }` первым в группе.
- Карточка пары: время «08:00–09:30», предмет, группа или преподаватель, аудитория, тема («Тема 3. Защита данных» и метка типа) или «Без темы», метки «Замена», «Перенос» (с подписью «с 8 сентября, 1 пара»), «Отменена»; примечание, если есть. Отменённая пара приглушена.
- Экран: переключатель «По группе / По преподавателю / День». В первых двух режимах — выбор группы или преподавателя и неделя: дни с понедельника по субботу колонками на широком экране и списком на узком; воскресенье показывается, только если в нём есть пара. В режиме «День» — поле даты, кнопки «‹ ›» и «Сегодня», таблица всех пар дня по всем группам: пара и время, группа, предмет, преподаватель, аудитория, тема, статус. «Сегодня» берётся из ответа сервера: `from` у `schedule.list` необязателен (Task 7), поэтому первый запрос экрана и кнопка «Эта неделя» идут без `from` — сервер отвечает неделей «сегодня» (`from` = понедельник, `to` = воскресенье) и полем `today`; дальше неделя листается от полученного `from` через `addDays`, а режим «День» и кнопка «Сегодня» берут дату из последнего `today`. Часы устройства не используются.
- С правом `schedule.changePair` пара, для которой `canEditPair`, открывает окно «Изменить пару»: преподаватель (активные сотрудники с ролью преподавателя), дата, номер пары (со временем из звонков), аудитория, примечание; «Сохранить»; «Отменить пару» — с подтверждением и примечанием. Отменённая пара, для которой `canRestorePair`, открывает окно с кнопкой «Вернуть пару» (отменённая пара прошедшего дня не открывается). Ошибки `fields` — у полей своими текстами (`day_off`: «В этот день занятий нет», `out_of_semester`, `in_past`, `group_busy`, `teacher_busy`, `room_busy`). `pair_locked` и `in_past` на всю пару — сообщением в окне. После успеха неделя перечитывается.
- Проректор видит то же без окна изменения.

- [ ] **Step 1: тесты.**

```js
// tests/pairs.test.js
const p = (id, date, slot, extra = {}) => ({ id, date, slot, status: 'planned', substitution: false, moved: false, ...extra });
assert.deepEqual(groupByDay([p('b', '2026-09-08', 2), p('a', '2026-09-08', 1), p('c', '2026-09-10', 1)], '2026-09-07', 4).map(d => [d.date, d.pairs.map(x => x.id)]),
  [['2026-09-07', []], ['2026-09-08', ['a', 'b']], ['2026-09-09', []], ['2026-09-10', ['c']]]);
assert.deepEqual(pairFlags(p('a', '2026-09-08', 1, { status: 'cancelled', substitution: true, moved: true })), ['cancelled', 'substitution', 'moved']);
assert.deepEqual(pairFlags(p('a', '2026-09-08', 1)), []);
assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-08'), true);
assert.equal(canEditPair(p('a', '2026-09-08', 1), '2026-09-09'), false);
assert.equal(canEditPair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01'), false);
assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-08'), true);
assert.equal(canRestorePair(p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-09'), false);   // прошедший день
assert.equal(canRestorePair(p('a', '2026-09-08', 1), '2026-09-01'), false);                             // не отменена
// сверка копии с core: import { pairLock } from '../core/schedule.js'
for (const [pair, today] of [[p('a', '2026-09-08', 1), '2026-09-08'], [p('a', '2026-09-08', 1), '2026-09-09'],
  [p('a', '2026-09-08', 1, { status: 'closed' }), '2026-09-01'], [p('a', '2026-09-08', 1, { status: 'cancelled' }), '2026-09-01']])
  assert.equal(canEditPair(pair, today), pairLock(pair, today) === null);
// tests/router.test.js
assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'schedule');
assert.equal(resolveRoute('#/schedule', { mustChangePassword: false, permissions: ['schedule.mine'] }).view, 'home');
// tests/ui.test.js
assert.deepEqual(outline(navFor([...DEAN, 'settings.get', 'dir.list:weekTemplate', 'dir.list:topics', 'schedule.list'], 'dean'))[1],
  ['nav.schedule', ['schedule', 'weekTemplate', 'topics', 'settings']]);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** под `dean`: неделя группы `01-1` с темами; следующая неделя — метка «Замена» у «Анатомии» в четверг и пустая среда (нерабочий день); у группы `02-1` в понедельник следующей недели — «Отменена». Заменить преподавателя у будущей пары; перенести пару на субботу — метка «Перенос»; перенести на время, где у группы уже есть пара, — ошибка у поля; отменить пару и открыть «Темы» — темы сдвинулись; вернуть пару. Пара прошлой недели не открывается. Режим «День» на сегодня — пары всех групп. Под `prorector` окна изменения нет. Ширина 900 px: колонки дней становятся списком. Обе темы, три языка, консоль без ошибок.
- [ ] **Step 6:** скриншоты (неделя группы, режим «День», окно «Изменить пару» с ошибкой; обе темы) — в `.superpowers/sdd/plan/task-11-shots/`.
- [ ] **Step 7:** коммит `feat: deanery schedule screen with substitutions, moves and cancellations`.

---

### Task 12 (Э): расписание преподавателя и студента

**Files:** Create `site/js/views/mySchedule.js`, `site/js/views/plan.js`. Modify `site/js/views/home.js`, `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `schedule.mine`, `topics.plan`, `teacher.mySubjects`; `weekNav`, `pairCard`, `dayList` (Task 11); `groupByDay` (Task 11).

- `resolveRoute`: `#/my` → `mySchedule`, если есть `schedule.mine`; `#/plan/<subjectId>` → `{ view: 'plan', params: { subjectId } }`, если есть `topics.plan`.
- `navFor` для роли преподавателя: к «Моим предметам» добавляется `{ name: 'mySchedule', href: '#/my', textKey: 'my.title', icon: 'calendar' }`, если есть `schedule.mine`.
- **Моё расписание** (`#/my`, преподаватель и студент): неделя, по умолчанию текущая; дни списком, «сегодня» выделен и при открытии прокручен в видимую область; у пары — время, предмет, аудитория, тема и тип, метки; преподаватель видит группу, студент — преподавателя. День без пар — «Пар нет». Отменённая пара остаётся в списке с меткой «Отменена» и примечанием.
- **Студент, главная:** вместо заглушки «Сегодня» — блок с парами сегодняшнего дня (те же карточки) или «Сегодня пар нет», и кнопка «Расписание на неделю» → `#/my`. Остальные три заглушки остаются. Ключ `home.todaySoon` удаляется из всех трёх словарей.
- **План тем** (`#/plan/<subjectId>`, только просмотр): предмет и группа, таблица тем с датами, как на экране «Темы», без кнопок. У преподавателя в списке «Мои предметы» у каждого предмета появляется ссылка «Темы» на этот экран. Ответ `forbidden` или `not_found` — понятное сообщение и ссылка на главную.
- Студенческие экраны: ширина 360 px без горизонтальной прокрутки, текст не мельче 16 px (включая метки и примечания), кнопки навигации по неделям и «Расписание на неделю» не ниже 44 px.

- [ ] **Step 1: тесты.**

```js
// tests/router.test.js
const student = { mustChangePassword: false, permissions: ['schedule.mine'] };
assert.equal(resolveRoute('#/my', student).view, 'mySchedule');
assert.equal(resolveRoute('#/my', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'home');
assert.deepEqual(resolveRoute('#/plan/sb_12ab34cd', { mustChangePassword: false, permissions: ['topics.plan'] }), { view: 'plan', params: { subjectId: 'sb_12ab34cd' } });
assert.equal(resolveRoute('#/plan/sb_12ab34cd', student).view, 'home');
// tests/ui.test.js
assert.deepEqual(outline(navFor([...DEAN, 'schedule.mine'], 'teacher')), [['nav.teaching', ['home', 'mySchedule']]]);
assert.deepEqual(outline(navFor(DEAN, 'teacher')), [['nav.teaching', ['home']]]);
// tests/i18n.test.js
assert.equal('home.todaySoon' in ru, false);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере.** Под `teacher1`: «Моё расписание» — три «Информатики» в понедельник с темами и группами; следующая неделя; «Мои предметы» → «Темы» открывает план; адрес плана чужого предмета («Анатомия») — сообщение «нет прав». Под `teacher3`: на следующей неделе в четверг пара с меткой «Замена». Под `S1001` на ширине 360 px: главная показывает пары сегодняшнего дня (в выходной — «Сегодня пар нет»), «Расписание на неделю» — неделя с темами и преподавателями, на следующей неделе среда пустая; под `S2001` в понедельник следующей недели пара с меткой «Отменена». Размеры: текст не мельче 16 px, кнопки не ниже 44 px (проверить в инструментах разработчика). Обе темы, три языка, консоль без ошибок.
- [ ] **Step 6:** скриншоты (преподаватель — неделя, 1280; студент — главная и неделя, 360; обе темы) — в `.superpowers/sdd/plan/task-12-shots/`.
- [ ] **Step 7:** коммит `feat: teacher and student schedule screens`.

---

## Дополнение от 21.11.2026: три замечания владельца при приёмке

Задачи 1–12 сделаны и не переписываются (`HEAD 3ed1727`, 234 теста). При приёмке владелец дал три изменения (таблица решений в `aidlc-docs/aidlc-state.md`, строки от 21.11.2026):

1. Время звонка выбирается из списка, а не вписывается.
2. В «Расписании» нажатие на день недели открывает «Шаблон недели» этой группы.
3. Темы — это силлабус преподавателя: он сам загружает его файлом Excel на год, у каждой темы указан семестр (1 или 2), модули в каждом семестре нумеруются заново. Деканат видит все силлабусы и может загрузить или поправить за преподавателя. Прежнее правило «темы вводит деканат, преподаватель только видит» отменено.

**Порядок.** Задачи идут так: 14 → 15 → 16 → 17 → 18 → 19 → 20, затем задача 13 «приёмка и выкладка». Номер 13 у неё сохранён (на него ссылаются `aidlc-state.md` и журнал хода работ), в файле она стоит последней. Задачи по-прежнему идут строго по одной; общие файлы (`site/js/router.js`, `shell.js`, словари, `core/import.js`, `backend/handlers/dir.js`) правит только та задача, которая сейчас в работе.

**Что из прежнего текста больше не действует:** строка «Правки тем преподавателем: он только видит» в разделе «Чего в юните 2 нет»; слова «темы вводит деканат» в строке **Spec**; в описании задач 10 и 12 — «только просмотр» у плана тем преподавателя и ссылка «Загрузить темы из Excel» на экране «Темы». Остальные Global Constraints и Review Focus 1–6 действуют полностью.

**Правила дополнения (к Global Constraints):**

- Ключ темы — предмет + семестр + №. Семестр — число 1 или 2. Строка темы без семестра (создана до дополнения) везде считается семестром 1; для этого есть одна функция `semesterOf` в `core/topics.js`, своих сравнений `semester === 1` в коде нет. Значение по умолчанию в `keyDefaults` спецификаций импорта тем и в `normalizeRow('topics', …)` берётся оттуда же (вызов `semesterOf` или константа, экспортированная рядом с ней в `core/topics.js`) — это разрешено и повтором правила не считается.
- Раскладка тем работает только с темами текущего семестра (настройка `semester`) и только с парами в датах семестра. Одно исключение — правило «одна тема — одна пара»: у непроведённой пары вне дат семестра, на которой стоит тема текущего семестра, тема снимается (`topicId: ''`); тема другого семестра на такой паре остаётся. Пару со статусом из `FIXED_STATUSES` не меняет ничто.
- Обработчик, который уже прочитал лист «Настройки», передаёт настройки в `relayout`, а не даёт прочитать лист второй раз.
- Словарь: на экранах и в шаблонах файлов — «Модуль» (ky «Модуль», en «Module»), не «Юнит». Заголовок колонки листа («юнит») и ключ `unit` в коде не меняются.
- Скриншоты задач «Экраны» — в `.superpowers/sdd/plan-unit-2-raspisanie/task-<N>-shots/`.

**Файлы дополнения:**

```
site/js/bells.js            список времени звонков (без DOM)                              новый
site/js/syllabus.js         темы семестра, номер новой темы, предупреждения (без DOM)     новый
core/schema.js              + колонка semester в topics, SEMESTERS
core/settings.js            + настройка semester
core/topics.js              + semesterOf, inSemester, semesterScope (с полем clear)
core/validate.js            + семестр темы, повтор № внутри семестра
core/import.js              + столбец «Семестр», спецификация syllabus, поля fixed
core/permissions.js         + преподаватель: dir.save/dir.remove для topics, syllabus.*
backend/users.js            + canEditSubjectTopics
backend/scheduleData.js  handlers/settings.js  handlers/schedule.js  handlers/dir.js  handlers/import.js
dev/seed.js
site/js/pairs.js  router.js  shell.js
site/js/views/settings.js  schedule.js  pairParts.js  weekTemplate.js  topics.js  plan.js  home.js  import.js  directoryConfig.js
site/js/i18n/*.js  site/css/screens.css
tests/bells.test.js  syllabus.test.js  syllabusApi.test.js                                 новые
```

---

### Task 14 (Э): время звонка выбирается из списка

**Files:** Create `site/js/bells.js`, `tests/bells.test.js`. Modify `site/js/views/settings.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/i18n.test.js`.

**Interfaces — Consumes:** экран «Настройки семестра» (Task 8), `isTime`, `minutesOf`, `addMinutes` из `site/js/dates.js`. Сервер не меняется: `validateSettings` по-прежнему принимает любое время `'HH:MM'`, при котором пары не накладываются и последняя кончается не позже 23:59.

**Produces:**

```js
// site/js/bells.js — без DOM
export const BELL_FIRST = '07:00';
export const BELL_LAST = '22:25';      // 22:25 + 90 минут = 23:55: любое значение списка проходит правило «конец не позже 23:59»
export const BELL_STEP = 5;            // минут
export function bellTimes();                       // ['07:00', '07:05', …, '22:25'] — 186 строк
export function bellOptions(current);              // -> [{ value, offList }]: все bellTimes() с offList: false;
                                                   //    если current — время 'HH:MM' не из списка, оно стоит первым с offList: true
export function nextBell(last, pairMinutes, gap);  // первое время списка не раньше last + pairMinutes + gap; такого нет или last не время -> ''
```

Экран:

- В блоке «Звонки» у каждой пары вместо поля `type="time"` — список `<select class="field__input bell__input">` с теми же `id` (`settings-bell-<i>`) и подписью. Пункты — `bellOptions(значение)`: текст пункта — само время, у пункта вне списка — `settings.bellOffList` («08:02 — вне списка»). У пустого значения первым стоит пункт `settings.bellChoose` («Выберите время») со значением `''`.
- Вписать время с клавиатуры негде. Конец пары, перерывы, лента дня и проверка перед сохранением (`checkBells`: «укажите время», «пары накладываются», «последняя должна закончиться до полуночи») работают как раньше, обновление — на месте, без перерисовки.
- «Добавить пару» ставит `nextBell(последний звонок, pairMinutes, NEW_BREAK)`; если подходящего времени в списке нет — пустое значение, и сохранение просит выбрать время.
- Без права `settings.save` (проректор) списки выключены (`disabled`).
- Подсказка блока `settings.bellsHint`: «Пара длится {minutes} минут: выберите начало из списка, конец посчитается сам.»
- Время не из списка, пришедшее с сервера, не меняется, пока человек сам не выберет другое: сохранение остальных полей его сохраняет.

- [ ] **Step 1: тесты.**

```js
// tests/bells.test.js
import { isTime, minutesOf } from '../core/dates.js';
import { DEFAULT_BELLS, PAIR_MINUTES, validateSettings } from '../core/settings.js';
const times = bellTimes();
assert.equal(times.length, 186);
assert.deepEqual([times[0], times[1], times[185]], [BELL_FIRST, '07:05', BELL_LAST]);
for (const time of times) assert.ok(isTime(time) && minutesOf(time) % BELL_STEP === 0 && minutesOf(time) + PAIR_MINUTES <= 23 * 60 + 59, time);
for (const time of DEFAULT_BELLS) assert.ok(times.includes(time), time);
assert.equal(times.includes('02:00'), false);                                  // замечание владельца: 02:00 вместо 14:00 выбрать нельзя
assert.deepEqual(validateSettings({ semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: [BELL_LAST] }).errors, []);
assert.deepEqual(bellOptions('08:00'), times.map((value) => ({ value, offList: false })));
assert.deepEqual(bellOptions(''), bellOptions('08:00'));
assert.equal(bellOptions('мусор').length, 186);
// Review Focus 12
assert.deepEqual(bellOptions('08:02').slice(0, 2), [{ value: '08:02', offList: true }, { value: '07:00', offList: false }]);
assert.equal(bellOptions('08:02').length, 187);
assert.deepEqual(bellOptions('06:30')[0], { value: '06:30', offList: true });  // раньше начала списка
assert.deepEqual(bellOptions('22:29')[0], { value: '22:29', offList: true });  // позже конца списка
assert.equal(nextBell('16:50', 90, 10), '18:30');
assert.equal(nextBell('08:02', 90, 10), '09:45');                              // 09:42 в списке нет — ближайшее следующее
assert.equal(nextBell('20:45', 90, 10), '22:25');
assert.equal(nextBell('20:50', 90, 10), '');
assert.equal(nextBell('', 90, 10), '');

// tests/i18n.test.js
for (const key of ['settings.bellChoose', 'settings.bellOffList']) assert.ok(ru[key], key);
```

- [ ] **Step 2:** `npm test` — новые проверки падают. **Step 3:** написать `site/js/bells.js`, переделать блок звонков, добавить ключи в три словаря. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** на `npm run dev:reset`, под `dean`: у каждой пары список от 07:00 до 22:25 через 5 минут, поля для ввода времени нет; вторую пару поставить на 09:00 — пометка «накладывается» сразу, при сохранении ошибка у звонков, ничего не сохранено; «Вернуть стандартные»; «Добавить пару» после 16:50 даёт 18:30; сохранить и перезагрузить — значения на месте. Время не из списка: при остановленном стенде поправить в `dev/data/db.json` строку `bells` на `08:02,09:40` — первая пара показывает «08:02 — вне списка», сохранение другого поля время не меняет, после выбора 08:05 и сохранения пункта «вне списка» больше нет. Под `prorector` списки выключены. Три языка, обе темы, консоль без ошибок.
- [ ] **Step 6:** скриншоты (блок звонков с раскрытым списком; время вне списка; обе темы, ширина 1280) — в `task-14-shots/`.
- [ ] **Step 7:** коммит `feat: bell times are picked from a list`.

---

### Task 15 (Э): день недели в «Расписании» открывает «Шаблон недели» группы

**Files:** Modify `site/js/pairs.js`, `site/js/router.js`, `site/js/views/pairParts.js`, `site/js/views/schedule.js`, `site/js/views/weekTemplate.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/pairs.test.js`, `tests/router.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `dayList(days, today, cardOptions)` (Task 11), экран «Шаблон недели» (Task 9), `dayParts` из `site/js/dates.js`.

**Produces:**

```js
// site/js/pairs.js
export function templateHref(groupId, date);
// '#/template/<groupId>/<день недели 1–5>' для даты с понедельника по пятницу; null для субботы, воскресенья и пустого groupId

// site/js/views/pairParts.js — у dayList новая необязательная настройка
dayList(days, today, { show, onOpen, canOpen, dayHref });   // dayHref(date) -> адрес или null: название дня становится ссылкой
```

- `resolveRoute` (нужно право `dir.list:weekTemplate`, как раньше): `#/template` → `{ view: 'weekTemplate', params: {} }`; `#/template/<groupId>` → `params: { groupId }`; `#/template/<groupId>/<n>`, где `n` от 1 до 5, → `params: { groupId, weekday: n }` (число). Другой хвост адреса ведёт на главную.
- «Расписание»: в режиме «По группе» при праве `dir.list:weekTemplate` экран передаёт `dayHref: (date) => templateHref(state.groupId, date)`. В режиме «По преподавателю» и в режиме «День» ссылки нет. Заголовок дня со ссылкой: `<h2 class="day__title"><a class="day__link" href="…">` с прежним содержимым; подсказка и подпись для экранного диктора — `schedule.toTemplate` («Шаблон недели: {weekday}»). Тексты `schedule.lead` и `schedule.leadEdit` дополняются фразой «Нажмите на день недели, чтобы открыть шаблон недели этой группы.»
- «Шаблон недели»: `render(root, params = {})`. В состоянии экрана — `route` (последние применённые параметры адреса) и `targetDay`. Параметры применяются один раз, когда адрес изменился: `groupId` из адреса становится выбранной группой (если такой группы нет — остаётся первая, как сейчас), `weekday` — днём, чей столбец помечен классом `is-target` (id заголовка `template-day-<n>`) и один раз прокручен в видимую область сетки. Повторная перерисовка с тем же адресом выбор не трогает: группа, выбранная потом в списке, остаётся. `chooseGroup` снимает пометку дня.
- Проректор по ссылке попадает в тот же шаблон только для чтения.

- [ ] **Step 1: тесты.** 16 ноября 2026 — понедельник.

```js
// tests/pairs.test.js
assert.equal(templateHref('g_12ab34cd', '2026-11-16'), '#/template/g_12ab34cd/1');
assert.equal(templateHref('g_12ab34cd', '2026-11-20'), '#/template/g_12ab34cd/5');
assert.equal(templateHref('g_12ab34cd', '2026-11-21'), null);       // суббота: в шаблоне её нет
assert.equal(templateHref('g_12ab34cd', '2026-11-22'), null);
assert.equal(templateHref('', '2026-11-16'), null);

// tests/router.test.js — отдельный блок test(): в файле уже есть другие const office, и Task 20 добавит свой блок
test('resolveRoute: the week template of a group and its weekday', () => {
  const office = { mustChangePassword: false, permissions: ['dir.list:weekTemplate'] };
  assert.deepEqual(resolveRoute('#/template', office), { view: 'weekTemplate', params: {} });
  assert.deepEqual(resolveRoute('#/template/g_12ab34cd', office), { view: 'weekTemplate', params: { groupId: 'g_12ab34cd' } });
  assert.deepEqual(resolveRoute('#/template/g_12ab34cd/3', office), { view: 'weekTemplate', params: { groupId: 'g_12ab34cd', weekday: 3 } });
  assert.equal(resolveRoute('#/template/g_12ab34cd/6', office).view, 'home');
  assert.equal(resolveRoute('#/template/g_12ab34cd/3/x', office).view, 'home');
  assert.equal(resolveRoute('#/template/g_12ab34cd/3', { mustChangePassword: false, permissions: ['schedule.list'] }).view, 'home');
});

// tests/i18n.test.js
assert.ok(ru['schedule.toTemplate']);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** под `dean`: «Расписание» → «По группе», группа `02-1` → нажать «Среда» — открылся «Шаблон недели» группы `02-1`, столбец среды подсвечен; выбрать в шаблоне группу `01-1` и переключить язык — группа `01-1` осталась, подсветки нет. Кнопка «Назад» возвращает в расписание. У субботы ссылки нет. В режиме «По преподавателю» названия дней — обычный текст. Под `prorector` ссылка открывает шаблон только для чтения. «Моё расписание» преподавателя и студента — без ссылок. Ширина 900 px и 360 px (студент): ничего не съехало. Обе темы, три языка, консоль без ошибок.
- [ ] **Step 6:** скриншоты (расписание группы с наведённой ссылкой дня; шаблон с подсвеченным столбцом; обе темы) — в `task-15-shots/`.
- [ ] **Step 7:** коммит `feat: a weekday in the schedule opens the week template of the group`.

---

### Task 16 (Л): семестр в настройках и темах, файл силлабуса

**Files:** Modify `core/schema.js`, `core/settings.js`, `core/topics.js`, `core/validate.js`, `core/import.js`, `tests/schema.test.js`, `tests/settings.test.js`, `tests/topics.test.js`, `tests/validate.test.js`, `tests/import.test.js`. В чужой зоне, только названное:

- `site/js/views/directoryConfig.js`: `IMPORT_COLUMNS.topics` получает `col('semester', true)` после `groupId`; новый `IMPORT_COLUMNS.syllabus` — пять обязательных колонок `semester`, `unit`, `order`, `name`, `lessonType`; `FIELDS.semester = { kind: 'number', required: true, min: 1, max: 2 }`. В `IMPORT_TABLES` ничего не добавляется.
- `site/js/i18n/ru.js`, `ky.js`, `en.js` — ключи из таблицы ниже.
- `tests/i18n.test.js`: в тесте про импорт тем числовые колонки теперь `['semester', 'unit', 'order']`; в тесте про слова типа пары строка файла становится `['Анатомия', '01-1', 1, 1, i + 1, 'Тема', word]`.
- `tests/scheduleApi.test.js`: `HEAD = ['Предмет', 'Группа', 'Семестр', 'Юнит', '№', 'Тема', 'Тип']`, в каждой строке файла после группы добавляется ячейка семестра `1`. Ожидания тестов не меняются.
- `tests/settingsApi.test.js` и `tests/devServer.test.js`: в ожиданиях, которые сравнивают настройки целиком, появляется `semester: 1`.

**Interfaces — Consumes:** `FIXED_STATUSES`, `layoutTopics` (Task 3), `parseSheet`, `planImport` (юнит 1 и Task 3).

**Produces:**

```js
// core/schema.js
export const SEMESTERS = [1, 2];
// topics: в конец колонок добавляется col('semester', 'семестр', 'int')

// core/settings.js
export const SETTING_KEYS = ['semesterStart', 'semesterEnd', 'holidays', 'bells', 'semester'];
readSettings(rows);       // + semester: 2, если в строке стоит '2'; во всех остальных случаях 1
validateSettings(input);  // + semester, см. правила
settingsToRows(value);    // строки только для ключей, которые есть в value, в порядке SETTING_KEYS; value всегда строка

// core/topics.js
export function semesterOf(topic);                    // 2, если topic.semester === 2; иначе 1 (строки без семестра — семестр 1)
export function inSemester(date, settings);           // дата от semesterStart до semesterEnd включительно; если хотя бы одной даты нет — true
export function semesterScope(topics, pairs, settings);
// topics и pairs — строки ОДНОГО предмета; -> { topics, pairs, clear }; topics и pairs — для layoutTopics:
//   topics — те, у кого semesterOf(t) === settings.semester;
//   pairs  — пары со статусом из FIXED_STATUSES (любой даты: их темы считаются занятыми) и пары, у которых inSemester(p.date, settings);
//   clear  — id пар, у которых статус НЕ из FIXED_STATUSES, !inSemester(p.date, settings) и topicId — id одной из тем `topics`
//            (тема текущего семестра). Вызывающий ставит им topicId: '' — правило «одна тема — одна пара»: иначе та же тема
//            встала бы ещё и на пару в датах (например, начало семестра сдвинули позже, а ранняя пара держит тему 1).
//            Пара вне дат с темой другого семестра в clear не попадает.
// Порядок строк сохраняется (в clear — в порядке pairs). layoutTopics не меняется.
// Как вызывать: const s = semesterScope(…); layoutTopics(s.topics, s.pairs) — объект не разворачивается в аргументы.

// core/import.js
IMPORT_SPECS.topics;      // + столбец «Семестр», новый ключ
IMPORT_SPECS.syllabus;    // файл преподавателя: таблица хранения — topics
export function parseSheet(table, cells, db, fixed = {});
// fixed — поля, одинаковые для всех строк файла (силлабус: { subjectId }): входят в ключ, в проверку строки и в records.
// У спецификации может быть table — таблица хранения, если она не совпадает с именем спецификации:
// parseSheet и planImport берут строки из db[spec.table ?? table] и проверяют их правилами этой таблицы.
```

Правила:

- `validateSettings`: поле `semester` не прислано (`undefined`) — ошибки нет, ключа `semester` в `value` нет (сервер оставит сохранённое значение). Прислано — должно быть `1` или `2` (число или строка `'1'`, `'2'`), в `value` — число; иначе `{ field: 'semester', code: 'bad_value' }`, последней в списке ошибок.
- Тема (`validateRow('topics')`, к прежним правилам): `semester` пуст — допустимо (строка считается семестром 1); не пуст и не из `SEMESTERS` → `bad_value`. `order` — `duplicate`, если у этого предмета в том же семестре (`semesterOf`) такой № уже есть; при неверном `semester` повтор не проверяется. `normalizeRow('topics', …)` ставит `semester: 1`, если `semester` — `undefined`, `null` или `''` (пустая ячейка: `coerce('int', '')` возвращает `''`). Единицу берёт из `core/topics.js` (`semesterOf` или константа рядом с ней — см. «Правила дополнения»), своего `1` не пишет. Пустая ячейка «Семестр» в файле по-прежнему даёт `required`: эта проверка идёт по сырой ячейке до `normalizeRow`.
- Столбцы файлов (ru / ky / en; все обязательные):

| key | Заголовки | Другие принимаемые заголовки |
| --- | --- | --- |
| semester | Семестр / Семестр / Semester | — |
| unit | Модуль / Модуль / Module | Юнит, Unit |
| order | № / № / No. | № по порядку, № темы, No, N |
| name | Тема / Тема / Topic | Название |
| lessonType | Тип / Түрү / Type | Тип пары |

- `IMPORT_SPECS.topics` (файл деканата): колонки `subjectId`, `groupId` (служебная), `semester`, `unit`, `order`, `name`, `lessonType`; `uniqueBy: ['order', 'semester', 'subjectId']`.
- `IMPORT_SPECS.syllabus` (файл преподавателя): `table: 'topics'`; колонки `semester`, `unit`, `order`, `name`, `lessonType`; тот же `uniqueBy`; `subjectId` приходит через `fixed`.
- У обеих спецификаций одна и та же проверка `check` (прежняя: тема стоит на паре со статусом из `FIXED_STATUSES`, а название, тип или модуль в файле другие → `{ field: 'name', code: 'held' }`) и `keyDefaults: { semester: 1 }` (единица — из `core/topics.js`, как у `normalizeRow`; это не повтор правила `semesterOf`): при поиске существующей строки пустое значение ключа у строки базы заменяется значением из `keyDefaults` (старая тема без семестра находится по семестру 1 и обновляется, а не появляется второй раз).
- Значение ячейки «Семестр» в файле — `1` или `2`; другое → `semester: bad_value` (из правил темы), пустая ячейка → `required`.
- Ключи словарей (ru / ky / en): `import.col.topics.semester` и `import.col.syllabus.semester` — Семестр / Семестр / Semester; `import.col.topics.unit` (меняется) и `import.col.syllabus.unit` — Модуль / Модуль / Module; `import.col.syllabus.order` — № / № / No.; `import.col.syllabus.name` — Тема / Тема / Topic; `import.col.syllabus.lessonType` — Тип / Түрү / Type. Чтобы экран импорта деканата сразу объяснял новый столбец: `import.colHint.topics.semester` («1 или 2. В каждом семестре № тем начинаются с 1.»), `import.colHint.topics.unit` («Число от 1 до 12. В каждом семестре модули считаются с 1.»), `import.matchBy.topics` («Тема с тем же семестром и номером у того же предмета обновится, а не появится второй раз.»), `import.error.semester.bad_value` («Семестр — 1 или 2.»).

- [ ] **Step 1: тесты.**

```js
// tests/schema.test.js
assert.deepEqual(SCHEMA.topics.columns.map(c => c.title), ['id', 'предмет', 'юнит', '№ по порядку', 'название', 'тип пары', 'семестр']);
assert.deepEqual(SEMESTERS, [1, 2]);

// tests/settings.test.js — в тесте 'readSettings: defaults and bad values' ОБА прежних ожидания получают semester: 1:
assert.deepEqual(readSettings([]), { semesterStart: '', semesterEnd: '', holidays: [], bells: DEFAULT_BELLS, semester: 1 });
assert.deepEqual(readSettings([{ key: 'semesterStart', value: '2026-09-01' }, { key: 'holidays', value: '2026-11-07,2026-09-07' },
  { key: 'bells', value: 'мусор' }, { key: 'чужой', value: '1' }]),
{ semesterStart: '2026-09-01', semesterEnd: '', holidays: ['2026-09-07', '2026-11-07'], bells: DEFAULT_BELLS, semester: 1 });
// новые проверки:
assert.equal(readSettings([{ key: 'semester', value: '2' }]).semester, 2);
for (const bad of ['3', 'два', '', '0']) assert.equal(readSettings([{ key: 'semester', value: bad }]).semester, 1, bad);
const base = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', holidays: [], bells: ['08:00', '09:40'] };
assert.equal(validateSettings({ ...base, semester: 2 }).value.semester, 2);
assert.equal(validateSettings({ ...base, semester: '1' }).value.semester, 1);
assert.deepEqual(settingsToRows(validateSettings({ ...base, semester: 2 }).value).at(-1), { key: 'semester', value: '2' });
// Review Focus 9: поле не прислано — ошибки нет и строки «semester» нет
assert.deepEqual(validateSettings(base).errors, []);
assert.equal('semester' in validateSettings(base).value, false);
assert.equal(settingsToRows(validateSettings(base).value).length, 4);
for (const bad of [3, 0, '1 семестр', null, true]) assert.deepEqual(validateSettings({ ...base, semester: bad }).errors, [{ field: 'semester', code: 'bad_value' }], String(bad));
// прежнее ожидание validateSettings({}).errors (четыре ошибки) не меняется
```

```js
// tests/topics.test.js
assert.deepEqual([{ semester: 2 }, { semester: 1 }, { semester: null }, {}, { semester: 3 }].map(semesterOf), [2, 1, 1, 1, 1]);
const S1 = { semesterStart: '2026-09-01', semesterEnd: '2026-12-25', semester: 1 };
const S2 = { semesterStart: '2027-02-01', semesterEnd: '2027-06-18', semester: 2 };
assert.deepEqual(['2026-08-31', '2026-09-01', '2026-12-25', '2026-12-26'].map(d => inSemester(d, S1)), [false, true, true, false]);
assert.equal(inSemester('2030-01-01', { semesterStart: '', semesterEnd: '' }), true);
const T = (id, semester, order) => ({ id, subjectId: 'sb_1', ...(semester ? { semester } : {}), unit: 1, order, name: id, lessonType: 'lecture' });
const year = [T('a1', 1, 1), T('a2', 1, 2), T('old', null, 3), T('b1', 2, 1), T('b2', 2, 2)];     // 'old' — строка без семестра
const P = (id, date, status = 'planned', topicId = '') => ({ id, subjectId: 'sb_1', date, slot: 1, status, topicId });
const pairs = [P('h1', '2026-09-01', 'closed', 'a1'), P('o1', '2026-12-22', 'planned', 'a2'), P('n1', '2027-02-02'), P('n2', '2027-02-09'), P('n3', '2027-02-16')];
// Review Focus 9: второй семестр — свои темы, свои пары; проведённая пара остаётся в выборке только как «занятая тема»
const second = semesterScope(year, pairs, S2);
assert.deepEqual([second.topics.map(t => t.id), second.pairs.map(p => p.id)], [['b1', 'b2'], ['h1', 'n1', 'n2', 'n3']]);
assert.deepEqual(second.clear, []);          // o1 вне дат держит тему семестра 1 — её не снимают
assert.deepEqual(layoutTopics(second.topics, second.pairs),
  { assign: [{ id: 'n1', topicId: 'b1' }, { id: 'n2', topicId: 'b2' }], unplaced: [], withoutTopic: 1 });
// Review Focus 10: первый семестр — строка без семестра входит в него
const first = semesterScope(year, pairs, S1);
assert.deepEqual([first.topics.map(t => t.id), first.pairs.map(p => p.id)], [['a1', 'a2', 'old'], ['h1', 'o1']]);
assert.deepEqual(layoutTopics(first.topics, first.pairs), { assign: [], unplaced: ['old'], withoutTopic: 0 });
assert.deepEqual(first.clear, []);           // n1–n3 вне дат, но без темы
// проведённая пара вне дат семестра держит тему текущего семестра: второй раз тема не выдаётся, с проведённой пары тема не снимается
const held = semesterScope(year, [P('h9', '2026-08-20', 'closed', 'b1'), P('n1', '2027-02-02')], S2);
assert.deepEqual(held.clear, []);
assert.deepEqual(layoutTopics(held.topics, held.pairs).assign, [{ id: 'n1', topicId: 'b2' }]);
// одна тема — одна пара: начало семестра сдвинули на 4 сентября, непроведённая пара 1 сентября держит тему a1
const moved = semesterScope(year, [P('h0', '2026-08-25', 'closed', 'old'), P('e1', '2026-09-01', 'planned', 'a1'),
  P('e2', '2026-09-08', 'planned', 'a2'), P('e3', '2026-08-31', 'planned', 'b1')], { ...S1, semesterStart: '2026-09-04' });
assert.deepEqual([moved.pairs.map(p => p.id), moved.clear], [['h0', 'e2'], ['e1']]);   // e3 держит тему семестра 2 — остаётся
assert.deepEqual(layoutTopics(moved.topics, moved.pairs).assign, [{ id: 'e2', topicId: 'a1' }]);
// семестр переключили на 2 до смены дат, темы 2 встали на осенние пары; потом даты сменили — осенняя пара отдаёт тему
const switched = semesterScope(year, [P('s1', '2026-10-19', 'planned', 'b1'), P('n1', '2027-02-02')], S2);
assert.deepEqual([switched.pairs.map(p => p.id), switched.clear], [['n1'], ['s1']]);
assert.deepEqual(layoutTopics(switched.topics, switched.pairs).assign, [{ id: 'n1', topicId: 'b1' }]);
// дат семестра нет — все пары
assert.equal(semesterScope(year, pairs, { semesterStart: '', semesterEnd: '', semester: 1 }).pairs.length, 5);
```

```js
// tests/validate.test.js
assert.equal(normalizeRow('topics', { subjectId: 'sb_1', unit: 1, order: 1, name: 'Т', lessonType: 'lecture' }).semester, 1);
assert.equal(normalizeRow('topics', { subjectId: 'sb_1', semester: '2', unit: 1, order: 1, name: 'Т', lessonType: 'lecture' }).semester, 2);
for (const empty of ['', null, undefined])                                                           // пустая ячейка тоже семестр 1
  assert.equal(normalizeRow('topics', { subjectId: 'sb_1', semester: empty, unit: 1, order: 1, name: 'Т', lessonType: 'lecture' }).semester, 1, String(empty));
const sdb = { subjects: wdb.subjects, topics: [{ id: 'tp_1', subjectId: 'sb_1', semester: 1, unit: 1, order: 1, name: 'Введение', lessonType: 'lecture' },
  { id: 'tp_old', subjectId: 'sb_1', unit: 1, order: 5, name: 'Старая строка', lessonType: 'lecture' }] };
const topic = (patch) => validateRow('topics', { subjectId: 'sb_1', semester: 1, unit: 1, order: 9, name: 'Т', lessonType: 'lecture', ...patch }, sdb);
assert.deepEqual(topic({}), []);
// Review Focus 11
assert.deepEqual(topic({ semester: 2, order: 1 }), []);                                              // тот же № в другом семестре
assert.deepEqual(topic({ order: 1 }), [{ field: 'order', code: 'duplicate' }]);
// Review Focus 10
assert.deepEqual(topic({ order: 5 }), [{ field: 'order', code: 'duplicate' }]);                      // строка без семестра — семестр 1
assert.deepEqual(topic({ semester: 2, order: 5 }), []);
assert.deepEqual(topic({ semester: 3 }), [{ field: 'semester', code: 'bad_value' }]);
assert.deepEqual(topic({ semester: 0, order: 1 }), [{ field: 'semester', code: 'bad_value' }]);     // при неверном семестре повтор не проверяется
// прежние проверки теста «topics rules» (строки без semester) остаются зелёными без правок
```

```js
// tests/import.test.js — topicsDb(): у tp_1 и tp_2 появляется semester: 1; добавляются
//   { id: 'tp_3', subjectId: 'sb_1', unit: 1, order: 7, name: 'Старая строка', lessonType: 'lecture' }            — без семестра
//   { id: 'tp_9', subjectId: 'sb_2', semester: 1, unit: 1, order: 9, name: 'Тема другой группы', lessonType: 'lecture' }
// Тест «topics import»: заголовок ['Предмет', 'Группа', 'Семестр', 'Юнит', '№ темы', 'Тема', 'Тип'] («Юнит» теперь принимается как старое название),
// в прежние строки 2–9 после группы добавляется ячейка семестра 1, после них — пять новых строк:
  ['Информатика', '01-1', 2, 1, 1, 'Первая тема второго семестра', 'лекция'],   // 10: новая — № 1 есть только в семестре 1
  ['Информатика', '01-1', 2, 1, 1, 'Повтор во втором', 'лекция'],               // 11
  ['Информатика', '01-1', 3, 1, 4, 'Третий семестр', 'лекция'],                 // 12
  ['Информатика', '01-1', '', 1, 5, 'Без семестра', 'лекция'],                  // 13
  ['Информатика', '01-1', 1, 1, 7, 'Старая строка, новое имя', 'лекция'],       // 14: обновит tp_3
assert.deepEqual(r.errors, [{ row: 3, field: 'name', code: 'held' }, { row: 5, field: 'order', code: 'duplicate' },
  { row: 6, field: 'groupId', code: 'bad_ref' }, { row: 7, field: 'subjectId', code: 'bad_ref' },
  { row: 9, field: 'unit', code: 'bad_value' }, { row: 9, field: 'lessonType', code: 'bad_value' },
  { row: 11, field: 'order', code: 'duplicate' }, { row: 12, field: 'semester', code: 'bad_value' }, { row: 13, field: 'semester', code: 'required' }]);
assert.deepEqual(r.records.map(x => [x.row, x.subjectId, x.lessonType]),
  [[2, 'sb_1', 'lecture'], [4, 'sb_1', 'practice'], [8, 'sb_2', 'control'], [10, 'sb_1', 'lecture'], [14, 'sb_1', 'lecture']]);
const plan = planImport('topics', r.records, db);
assert.deepEqual(plan.toInsert.map(t => [t.subjectId, t.semester, t.unit, t.order, t.name]),
  [['sb_1', 1, 1, 3, 'Защита данных'], ['sb_2', 1, 2, 1, 'Модуль 2 — экзамен'], ['sb_1', 2, 1, 1, 'Первая тема второго семестра']]);
assert.deepEqual(plan.toUpdate, [{ id: 'tp_1', patch: { unit: 1, name: 'Цифровой пост медсестры', lessonType: 'lecture' } },
  { id: 'tp_3', patch: { unit: 1, name: 'Старая строка, новое имя', lessonType: 'lecture' } }]);
// во втором тесте тем: заголовки с «Семестр» / 'Semester', 'Module'; файл без столбца «Группа» -> missingColumns: ['groupId'];
// файл без столбца «Семестр» -> missingColumns: ['semester']
// в тесте «duplicate header and specs»: ключи IMPORT_SPECS — ['groups', 'rooms', 'staff', 'students', 'subjects', 'syllabus', 'topics']

// файл преподавателя — Review Focus 7 и 11
const s = parseSheet('syllabus', [
  ['Семестр', 'Модуль', '№', 'Тема', 'Тип'],
  [1, 1, 1, 'Цифровой пост медсестры', 'лекция'],      // 2: обновит tp_1
  [1, 1, 2, 'Другое имя', 'практика'],                  // 3: пара с этой темой проведена
  [1, 2, 3, 'Новая в первом', 'практика'],              // 4: новая
  [2, 1, 1, 'Первая во втором', 'лекция'],              // 5: новая, № снова с 1
  [2, 2, 2, 'Экзамен', 'экзамен'],                      // 6: новая
  [2, 2, 2, 'Повтор', 'лекция'],                        // 7
  [0, 1, 3, 'Нулевой семестр', 'лекция'],               // 8: только ошибка семестра, хотя № 3 уже занят строкой 4
  ['', '', '', '', ''],                                  // 9: пустая строка пропускается
  [2, 13, 201, '', 'семинар'],                           // 10
  [1, 1, 9, 'Девятая', 'лекция'],                        // 11: новая — № 9 занят только у предмета другой группы (tp_9)
], db, { subjectId: 'sb_1' });
assert.deepEqual(s.errors, [{ row: 3, field: 'name', code: 'held' }, { row: 7, field: 'order', code: 'duplicate' },
  { row: 8, field: 'semester', code: 'bad_value' }, { row: 10, field: 'unit', code: 'bad_value' }, { row: 10, field: 'order', code: 'bad_value' },
  { row: 10, field: 'name', code: 'required' }, { row: 10, field: 'lessonType', code: 'bad_value' }]);
assert.deepEqual(s.records.map(x => [x.row, x.subjectId, x.lessonType]),
  [[2, 'sb_1', 'lecture'], [4, 'sb_1', 'practice'], [5, 'sb_1', 'lecture'], [6, 'sb_1', 'control'], [11, 'sb_1', 'lecture']]);
const sp = planImport('syllabus', s.records, db);
assert.deepEqual(sp.toInsert.map(t => [t.subjectId, t.semester, t.unit, t.order, t.name]),
  [['sb_1', 1, 2, 3, 'Новая в первом'], ['sb_1', 2, 1, 1, 'Первая во втором'], ['sb_1', 2, 2, 2, 'Экзамен'], ['sb_1', 1, 1, 9, 'Девятая']]);
assert.deepEqual(sp.toUpdate, [{ id: 'tp_1', patch: { unit: 1, name: 'Цифровой пост медсестры', lessonType: 'lecture' } }]);
// лишний столбец «Предмет» в файле преподавателя -> unknownColumns: ['Предмет'], строки загружаются в предмет из fixed;
// файл без столбца «Семестр» -> missingColumns: ['semester']; заголовки 'Semester', 'Unit', 'No.', 'Topic', 'Type' принимаются
```

```js
// tests/i18n.test.js — к двум названным правкам: у каждой колонки силлабуса есть поле, числовые колонки шаблона — семестр, модуль и №
for (const { key } of IMPORT_COLUMNS.syllabus) assert.ok(FIELDS[key], key);
assert.deepEqual(IMPORT_COLUMNS.syllabus.filter(({ key }) => FIELDS[key].kind === 'number').map(({ key }) => key), ['semester', 'unit', 'order']);
assert.equal(IMPORT_TABLES.includes('syllabus'), false);                        // силлабус загружается со страницы предмета, не из общего импорта
for (const key of ['import.colHint.topics.semester', 'import.error.semester.bad_value']) assert.ok(ru[key], key);
// прежние тесты «заголовки словарей равны IMPORT_SPECS» и «сайт перечисляет те же колонки» проверяют новые ключи сами
```

- [ ] **Step 2:** падает. **Step 3:** написать; поправить названные файлы чужой зоны. Прежние тесты импорта пяти справочников зелёные без правок. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: semester of a topic, semester setting, syllabus file`.

---

### Task 17 (С): раскладка по текущему семестру, настройка семестра на сервере, данные стенда

**Files:** Modify `backend/scheduleData.js`, `backend/handlers/settings.js`, `backend/handlers/schedule.js`, `dev/seed.js`, `tests/scheduleApi.test.js`, `tests/settingsApi.test.js`, `tests/pairsApi.test.js`, `tests/devServer.test.js`, `tests/sheetsStore.test.js`.

**Interfaces — Consumes:** `semesterOf`, `inSemester`, `semesterScope` (Task 16: `semesterScope(topics, pairs, settings) -> { topics, pairs, clear }`; `topics` и `pairs` — для `layoutTopics`, `clear` — id непроведённых пар вне дат семестра, с которых надо снять тему текущего семестра), `readSettings` с полем `semester`, `validateSettings` (не присланный `semester` в `value` не попадает), `settingsToRows` (Task 16).

**Produces:**

```js
// backend/scheduleData.js
export function relayout(store, subjectIds = null, rows = {});
// rows = { topics?, pairs?, settings? }; settings — объект в форме readSettings. Нет в rows — читается loadSettings(store), один раз.
// По каждому предмету (объект semesterScope в аргументы не разворачивается):
//   const s = semesterScope(темы предмета, пары предмета, settings);
//   for (const id of s.clear) assigned.set(id, '');                      // одна тема — одна пара
//   const { assign } = layoutTopics(s.topics, s.pairs);                  // пары из clear в s.pairs не входят
//   for (const { id, topicId } of assign) assigned.set(id, topicId);
// Дальше как сейчас: одно updateMany('pairs') на все предметы, если assigned не пуст. Ответ прежний: { changed, topics, pairs }.
```

- `generateSchedule`, `schedule.changePair` и `schedule.restorePair` уже читают настройки и передают их в `relayout` (`rows.settings`). Остальные вызовы (`dir.save` и `dir.remove` тем, импорт тем, `schedule.cancelPair`, `seed`) настроек не читали — их читает сам `relayout`.
- `settings.get` → в `settings` есть `semester`.
- `settings.save { settings }` → `{ settings }` со всеми пятью полями. Поле `semester` не прислано — остаётся сохранённое (строка `semester` не пишется и не создаётся). Если после сохранения изменился `semester`, `semesterStart` или `semesterEnd` — `relayout(store, null, { settings: <новые настройки> })`; если не изменились — «Темы» и «Пары» не читаются.
- `topics.plan { subjectId }` → к прежнему ответу: `semester` (текущий, из настроек) и `semester` у каждой темы (`semesterOf`); ключи темы в ответе по порядку — `id`, `semester`, `unit`, `order`, `name`, `lessonType`, `pair`; темы идут по семестру, затем по `order`; `withoutTopic` — запланированные пары предмета без темы, у которых `inSemester(date, settings)`. `pair` у темы — как раньше, пара, на которой тема стоит (у темы другого семестра это может быть давно проведённая пара). Если тему держат несколько пар (данные, записанные до этой задачи), `pair` — пара со статусом из `FIXED_STATUSES` или с `inSemester(date, settings)`; среди равных — первая по дате и номеру пары. Сейчас `new Map(...)` молча берёт последнюю — так больше нельзя.
- Данные стенда: у прежних 18 тем каждой «Информатики» `semester: 1`; добавляются 6 тем семестра 2 (№ 1–6): модуль 1 — «Электронные таблицы: учёт лекарств и расчёт доз» (лекция, практика), «Презентация для пациента: памятка и санбюллетень» (практика); модуль 2 — «Электронная очередь и запись на приём» (лекция, практика), «Модуль 2 — экзамен» (`control`). В настройках стенда `semester: 1`.

- [ ] **Step 1: тесты.**

```js
// tests/scheduleApi.test.js — новый тест; setup() прежний: у sb1 три темы без семестра (topic1…topic3), пары sb1 — 1 и 8 сентября
const b1 = store.insert('topics', { subjectId: sb1, semester: 2, unit: 1, order: 1, name: 'Второй семестр 1', lessonType: 'lecture' }).id;
const b2 = store.insert('topics', { subjectId: sb1, semester: 2, unit: 1, order: 2, name: 'Второй семестр 2', lessonType: 'lecture' }).id;
call('schedule.generate', {}, dean);
const mine = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
const planOf = () => call('topics.plan', { subjectId: sb1 }, dean).data;
const rows = (plan) => plan.topics.map(t => [t.semester, t.order, t.pair && t.pair.date]);
// Review Focus 10: темы без семестра разложены как семестр 1, темы семестра 2 ждут
assert.deepEqual(mine().map(p => p.topicId), [topic1, topic2]);
assert.equal(planOf().semester, 1);
assert.deepEqual(rows(planOf()), [[1, 1, '2026-09-01'], [1, 2, '2026-09-08'], [1, 3, null], [2, 1, null], [2, 2, null]]);

// Review Focus 9: пара 1 сентября проведена; деканат переключает семестр
store.update('pairs', mine()[0].id, { status: 'closed' });
assert.equal(call('settings.save', { settings: { ...S, semester: 2 } }, dean).data.settings.semester, 2);
assert.deepEqual(mine().map(p => p.topicId), [topic1, b1]);
assert.deepEqual([planOf().semester, planOf().withoutTopic], [2, 0]);
assert.deepEqual(rows(planOf()), [[1, 1, '2026-09-01'], [1, 2, null], [1, 3, null], [2, 1, '2026-09-08'], [2, 2, null]]);
assert.equal(call('settings.save', { settings: S }, dean).data.settings.semester, 2);       // поле не прислано — семестр прежний
assert.deepEqual(mine().map(p => p.topicId), [topic1, b1]);
call('settings.save', { settings: { ...S, semester: 1 } }, dean);
assert.deepEqual(mine().map(p => p.topicId), [topic1, topic2]);

// второй семестр с новыми датами: пары первого семестра не трогаются (в шаблоне у sb1 вторник, пара 1, и понедельник, пара 2)
state.now = Date.UTC(2026, 8, 12, 6);                                                         // 12 сентября
const dean12 = call('auth.login', { login: 'dean', password: 'secret12' }).data.token;        // ключ сотрудника живёт 7 дней: войти заново
assert.equal(call('settings.save', { settings: { semesterStart: '2026-09-14', semesterEnd: '2026-09-25', holidays: [], bells: DEFAULT_BELLS, semester: 2 } }, dean12).ok, true);
assert.equal(call('schedule.generate', {}, dean12).data.inserted, 6);
assert.deepEqual(mine().map(p => [p.date, p.topicId]), [['2026-09-01', topic1], ['2026-09-08', topic2],
  ['2026-09-14', b1], ['2026-09-15', b2], ['2026-09-21', ''], ['2026-09-22', '']]);
assert.equal(call('topics.plan', { subjectId: sb1 }, dean12).data.withoutTopic, 2);

```

```js
// tests/scheduleApi.test.js, тест 'generate: dry run, real run, repeat, later start, topics laid over pairs' (строка 76):
assert.deepEqual(Object.keys(plan.topics[0]), ['id', 'semester', 'unit', 'order', 'name', 'lessonType', 'pair']);

// тест 'generate: pairs between today and a later semester start are removed, held ones stay' — в деструктуризацию setup()
// добавить topics; сразу после settings.save с semesterStart '2026-09-04' (одна тема — одна пара, Review Focus 9):
const sb1Pairs = () => store.list('pairs').filter(p => p.subjectId === sb1).sort((a, b) => a.date.localeCompare(b.date));
assert.deepEqual(sb1Pairs().map(p => [p.date, p.topicId]), [['2026-09-01', ''], ['2026-09-08', topics[0]]]);
const shown = () => call('topics.plan', { subjectId: sb1 }, dean).data.topics.map(t => [t.order, t.pair && t.pair.date]);
assert.deepEqual(shown(), [[1, '2026-09-08'], [2, null], [3, null]]);
const onPairs = store.list('pairs').map(p => p.topicId).filter(Boolean);
assert.equal(new Set(onPairs).size, onPairs.length);                                    // ни одна тема не стоит на двух парах
// две пары с одной темой (данные до этой задачи): topics.plan показывает пару в датах семестра
store.update('pairs', sb1Pairs()[0].id, { topicId: topics[0] });
assert.deepEqual(shown(), [[1, '2026-09-08'], [2, null], [3, null]]);
store.update('pairs', sb1Pairs()[0].id, { topicId: '' });
// дальше тест идёт как раньше (preview, closed, removed)

// тест 'relayout: nothing to change writes nothing and uses the rows it is given' (импорт readSettings из core/settings.js):
const result = relayout(store, null, { topics: store.list('topics'), pairs: store.list('pairs'), settings: readSettings(store.list('settings')) });
// ожидания прежние: changed 0, pairs.length 4, calls {}

// скорость — настоящие проверки, не комментарий. spyOn дополнительно ведёт writes: у insertMany, updateMany и removeMany
// счёт по листам с ключом `${name}:${args[0]}` (например 'updateMany:pairs'); reset() очищает и writes; setup() возвращает writes.
test('semester switch and topic writes read each sheet at most once', () => {
  const { store, call, calls, reads, writes, reset, dean, sb1, topics: [, topic2] } = setup();
  call('schedule.generate', {}, dean);
  const check = (label, response) => {
    assert.equal(response.ok, true, label);
    for (const [table, n] of Object.entries(reads)) assert.ok(n <= 1, `${label}: ${table} read ${n} times`);
    assert.ok((calls.update || 0) <= 1, label + ': update');
    assert.ok((writes['updateMany:pairs'] || 0) <= 1, label + ': updateMany pairs');
    reset();
  };
  reset();
  check('switch', call('settings.save', { settings: { ...S, semester: 2 } }, dean));
  const same = call('settings.save', { settings: { ...S, semester: 2 } }, dean);          // семестр и даты прежние
  assert.deepEqual([same.ok, reads.topics || 0, reads.pairs || 0], [true, 0, 0]);
  reset();
  check('generate', call('schedule.generate', {}, dean));
  const moved = store.list('pairs').find(p => p.subjectId === sb1 && p.date === '2026-09-08').id;
  check('move', call('schedule.changePair', { id: moved, date: '2026-09-10', slot: 2 }, dean));
  check('restore', call('schedule.restorePair', { id: moved }, dean));
  check('cancel', call('schedule.cancelPair', { id: moved }, dean));
  check('topic save', call('dir.save', { table: 'topics', row: { subjectId: sb1, semester: 2, unit: 1, order: 9, name: 'Ещё', lessonType: 'lecture' } }, dean));
  check('topic remove', call('dir.remove', { table: 'topics', id: topic2 }, dean));
  check('import', call('import.apply', { table: 'topics', cells: [HEAD, ['Информатика', '01-1', 2, 1, 2, 'Переименована', 'лекция']] }, dean));
});
```

```js
// tests/settingsApi.test.js
assert.equal(call('settings.get', {}, prorector).data.settings.semester, 1);
assert.equal(call('settings.save', { settings: { ...input, semester: 2 } }, dean).data.settings.semester, 2);
assert.equal(store.list('settings').length, 5);
assert.equal(call('settings.save', { settings: input }, dean).data.settings.semester, 2);
assert.equal(call('settings.get', {}, dean).data.settings.semester, 2);
assert.deepEqual(call('settings.save', { settings: { ...input, semester: 3 } }, dean).error, { code: 'invalid', fields: [{ field: 'semester', code: 'bad_value' }] });
// прежние проверки «строк в „Настройках“ четыре» (сохранение без поля semester) остаются

// tests/sheetsStore.test.js — Review Focus 10: лист «Темы», созданный до дополнения
const old = createFakeSpreadsheet({ 'Темы': [['id', 'предмет', 'юнит', '№ по порядку', 'название', 'тип пары'], ['tp_1', 'sb_1', 1, 1, 'Введение', 'lecture']] });
assert.ok(ensureSheets(SCHEMA, old).addedColumns.includes('Темы.семестр'));
const legacy = createSheetsStore(SCHEMA, platform, old).list('topics')[0];
assert.deepEqual([legacy.semester, semesterOf(legacy)], [null, 1]);
// (ensureSheets и чтение уже умеют это с Task 1: проверка закрепляет поведение и может быть зелёной сразу)

// tests/devServer.test.js
assert.deepEqual([store.list('subjects').length, store.list('weekTemplate').length, store.list('topics').length, store.list('pairs').length], [6, 9, 72, 159]);
assert.equal(store.list('topics').filter(t => t.semester === 2).length, 18);
const second = new Set(store.list('topics').filter(t => t.semester === 2).map(t => t.id));
assert.equal(pairs.some(p => second.has(p.topicId)), false);                                  // темы семестра 2 на пары не встали
assert.equal(readSettings(store.list('settings')).semester, 1);
// прежние проверки «Информатики» (18 пар с разными темами у 01-1, 17 у 02-1) остаются
```

- [ ] **Step 2:** падает (кроме проверки в `tests/sheetsStore.test.js`). **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` проходит.
- [ ] **Step 5:** `npm run dev:reset`; запрос `topics.plan` под `dean` для «Информатики» группы `01-1` возвращает 24 темы: 18 семестра 1 с датами и 6 семестра 2 без пар. Экран деканата «Темы» до задачи 19 показывает темы обоих семестров одной таблицей (вкладки семестров появятся в задаче 19) — это ожидаемо, не ошибка.
- [ ] **Step 6:** коммит `feat: topics are laid out by the current semester`.

Проверяющий: проверки скорости, «одна тема — одна пара» и ключи темы в `topics.plan` написаны настоящими `assert`, а не комментариями.

---

### Task 18 (С): преподаватель правит темы своих предметов и загружает силлабус

**Files:** Modify `backend/users.js`, `backend/handlers/dir.js`, `backend/handlers/import.js`, `backend/handlers/schedule.js`. Create `tests/syllabusApi.test.js`. В чужой зоне, только названное: `core/permissions.js`, `tests/permissions.test.js`, `tests/api.test.js` (ожидание прав преподавателя в тесте `publicUser`). Права меняются в этой же задаче, что и проверка «свой предмет»: между задачами не должно быть состояния, в котором преподаватель может править чужие темы.

**Interfaces — Consumes:** `parseSheet('syllabus', cells, db, { subjectId })`, `planImport('syllabus', records, db)`, `IMPORT_SPECS.syllabus` (Task 16); `relayout` (Task 17); `loadDb(store, 'topics', ['pairs'])` (Task 5); `semesterOf` (Task 16).

**Produces:**

```js
// backend/users.js
export function canEditSubjectTopics(user, subject);   // у пользователя есть роль admin или dean, либо subject.teacherId === user.id
```

Права (к матрице):

| Действие | Кто |
| --- | --- |
| `dir.save`, `dir.remove` для `topics` | admin, dean, teacher (преподаватель — только свои предметы) |
| `syllabus.preview`, `syllabus.apply` | admin, dean, teacher (преподаватель — только свои предметы) |
| `dir.list` для `topics`, `import.*` для `topics` | без изменений: преподавателю нельзя |

Действия:

- `dir.save` для `topics`: предмет темы (у существующей темы — её прежний предмет, у новой — `row.subjectId`) найден и `canEditSubjectTopics` ложно → `forbidden`; проверка идёт раньше `validateRow`. Предмета нет — как раньше, `subjectId: bad_ref`. У существующей темы меняют семестр → `invalid`, `[{ field: 'semester', code: 'bad_value' }]`. Сравнивается уже нормализованная строка — та, что `save` собирает через `normalizeRow(table, { ...old, ...input })`: `row.semester !== semesterOf(old)`. Пустой `semester` в запросе (`''`, `null`) `normalizeRow` превращает в 1 (Task 16), поэтому у темы семестра 1 это не смена, а у темы семестра 2 — смена.
- `dir.remove` для `topics`: предмет темы читается из «Предметов» (лист — один раз); `canEditSubjectTopics` ложно → `forbidden`. Прежний запрет `in_use` для темы проведённой пары остаётся.
- `topics.plan`: в ответе `canEdit` — у вошедшего есть право `dir.save` для `topics` и `canEditSubjectTopics(user, subject)`. Кто видит план — без изменений (деканат, администратор, проректор — любой предмет; преподаватель — свой).
- `syllabus.preview { subjectId, cells }` → ответ той же формы, что у `import.preview`; `syllabus.apply { subjectId, cells }` → той же формы, что у `import.apply` (`passwords: []`). `subjectId` не строка или `cells` не массив массивов → `bad_request`; предмета нет → `not_found`; `canEditSubjectTopics` ложно → `forbidden`. База — `loadDb(store, 'topics', ['pairs'])`; запись и пересчёт — тем же кодом, что у импорта тем: одно `updateMany` только изменившихся строк, одно `insertMany`, затем `relayout` для этого предмета. Обработчики лежат в `backend/handlers/import.js` и регистрируются вместе с `importHandlers`.
- `import.preview` и `import.apply`: `analyse` отвечает `bad_request` на спецификацию, у которой есть поле `table` (сейчас это `syllabus`), — до `loadDb` (у `loadDb` нет такого листа в `DB_SHEETS`, он бы упал). Файл силлабуса идёт только через `syllabus.*`. Через `handleRequest` такой запрос сейчас останавливает и матрица прав (в `import.*` таблицы `syllabus` нет); проверка в `analyse` — вторая защита, на случай если матрица изменится.

- [ ] **Step 1: тесты.** `tests/syllabusApi.test.js`: подготовка — как `setup()` в `tests/scheduleApi.test.js` (сотрудники `dean` с ролями `dean,teacher`, `prorector`, `teacher1`, `teacher2`; `sb1` «Информатика» у `teacher1`, `sb2` «Анатомия» у `teacher2`; настройки `S`, шаблон, шпион над хранилищем с `calls`, `reads`, `reset`), но без тем; подготовка возвращает ещё `store` (само хранилище, не шпион) и `platform`; расписание создано 31 августа: пары `sb1` — 1 и 8 сентября.

```js
const HEAD = ['Семестр', 'Модуль', '№', 'Тема', 'Тип'];
const year = [HEAD, [1, 1, 1, 'Введение', 'лекция'], [1, 1, 2, 'Практикум', 'практика'], [1, 2, 3, 'Рубежный', 'рубежный'],
  [2, 1, 1, 'Таблицы', 'лекция'], [2, 2, 2, 'Экзамен', 'экзамен']];
const send = (action, subjectId, cells, token) => call(action, { subjectId, cells }, token);

// преподаватель загружает силлабус своего предмета на год — Review Focus 11
const pre = send('syllabus.preview', sb1, year, teacher1).data;
assert.deepEqual([pre.total, pre.valid, pre.newCount, pre.updateCount, pre.errors], [5, 5, 5, 0, []]);
assert.equal(store.list('topics').length, 0);
const first = send('syllabus.apply', sb1, year, teacher1).data;
assert.deepEqual([first.inserted, first.updated, first.skipped, first.passwords, first.errors], [5, 0, 0, [], []]);
assert.deepEqual(store.list('topics').map(t => [t.subjectId, t.semester]), [[sb1, 1], [sb1, 1], [sb1, 1], [sb1, 2], [sb1, 2]]);
const plan = call('topics.plan', { subjectId: sb1 }, teacher1).data;
assert.deepEqual([plan.semester, plan.canEdit], [1, true]);
assert.deepEqual(plan.topics.map(t => [t.semester, t.order, t.pair && t.pair.date]),
  [[1, 1, '2026-09-01'], [1, 2, '2026-09-08'], [1, 3, null], [2, 1, null], [2, 2, null]]);
const again = send('syllabus.apply', sb1, year, teacher1).data;
assert.deepEqual([again.inserted, again.updated, store.list('topics').length], [0, 5, 5]);

// Review Focus 8: чужой предмет и роли
assert.deepEqual(send('syllabus.preview', sb2, year, teacher1).error, { code: 'forbidden' });
assert.deepEqual(send('syllabus.apply', sb2, year, teacher1).error, { code: 'forbidden' });
assert.equal(store.list('topics').some(t => t.subjectId === sb2), false);
assert.deepEqual(send('syllabus.apply', sb1, year, prorector).error, { code: 'forbidden' });
assert.equal(send('syllabus.apply', sb2, year, dean).data.inserted, 5);                      // деканат — за преподавателя
assert.deepEqual(send('syllabus.apply', 'sb_nope', year, dean).error, { code: 'not_found' });
assert.deepEqual(send('syllabus.apply', sb1, 'x', teacher1).error, { code: 'bad_request' });
const noColumn = send('syllabus.apply', sb1, [['Модуль', '№', 'Тема', 'Тип'], [1, 1, 'Т', 'лекция']], teacher1).data;
assert.deepEqual([noColumn.inserted, noColumn.missingColumns], [0, ['semester']]);

// Review Focus 7: пара 1 сентября проведена, в новом файле нумерация сдвинута
store.update('pairs', store.list('pairs').find(p => p.subjectId === sb1 && p.date === '2026-09-01').id, { status: 'closed' });
const shifted = [HEAD, [1, 1, 1, 'Новое введение', 'лекция'], [1, 1, 2, 'Введение', 'лекция'], [1, 1, 3, 'Практикум', 'практика']];
const res = send('syllabus.apply', sb1, shifted, teacher1).data;
assert.deepEqual([res.inserted, res.updated, res.skipped, res.errors], [0, 2, 1, [{ row: 2, field: 'name', code: 'held' }]]);
assert.deepEqual(call('topics.plan', { subjectId: sb1 }, teacher1).data.topics.slice(0, 3).map(t => [t.order, t.name, t.pair && t.pair.date]),
  [[1, 'Введение', '2026-09-01'], [2, 'Введение', '2026-09-08'], [3, 'Практикум', null]]);

// правка тем вручную — Review Focus 8 и 11
const save = (row, token) => call('dir.save', { table: 'topics', row }, token);
const own = save({ subjectId: sb1, semester: 2, unit: 1, order: 3, name: 'Своя тема', lessonType: 'lecture' }, teacher1).data.row;
assert.equal(own.semester, 2);
assert.deepEqual(save({ subjectId: sb2, semester: 1, unit: 1, order: 9, name: 'Чужая', lessonType: 'lecture' }, teacher1).error, { code: 'forbidden' });
const foreign = store.insert('topics', { subjectId: sb2, semester: 1, unit: 1, order: 8, name: 'Тема коллеги', lessonType: 'lecture' });
assert.deepEqual(save({ id: foreign.id, name: 'Не моя' }, teacher1).error, { code: 'forbidden' });
assert.deepEqual(call('dir.remove', { table: 'topics', id: foreign.id }, teacher1).error, { code: 'forbidden' });
assert.equal(store.get('topics', foreign.id).name, 'Тема коллеги');
assert.equal(call('dir.remove', { table: 'topics', id: own.id }, teacher1).ok, true);
assert.equal(save({ id: foreign.id, name: 'Правка деканата' }, dean).ok, true);
assert.deepEqual(save({ id: foreign.id, semester: 2 }, dean).error, { code: 'invalid', fields: [{ field: 'semester', code: 'bad_value' }] });
assert.equal(save({ id: foreign.id, semester: '' }, dean).ok, true);                         // пусто после normalizeRow = 1 — семестр тот же
assert.equal(save({ subjectId: sb2, semester: 2, unit: 1, order: 8, name: 'Тот же номер, другой семестр', lessonType: 'lecture' }, dean).ok, true);
assert.deepEqual(call('dir.list', { table: 'topics' }, teacher1).error, { code: 'forbidden' });
assert.deepEqual(call('dir.save', { table: 'rooms', row: { name: '999' } }, teacher1).error, { code: 'forbidden' });
assert.deepEqual([call('topics.plan', { subjectId: sb2 }, prorector).data.canEdit, call('topics.plan', { subjectId: sb2 }, dean).data.canEdit], [false, true]);

// спецификация с полем table через общий импорт — bad_request в analyse (обработчик напрямую: через handleRequest раньше остановят права)
// import { importHandlers } from '../backend/handlers/import.js'; store и platform — из подготовки
assert.throws(() => importHandlers['import.preview']({ table: 'syllabus', cells: [HEAD] }, { store, platform, log: () => {} }), { code: 'bad_request' });

// скорость — настоящие проверки (calls, reads, reset — из шпиона подготовки)
reset();
assert.equal(send('syllabus.apply', sb1, year, dean).ok, true);
for (const [table, n] of Object.entries(reads)) assert.ok(n <= 1, `${table} read ${n} times`);
assert.equal((calls.update || 0) + (calls.remove || 0) + (calls.removeMany || 0), 0);
assert.ok((calls.insertMany || 0) <= 1);
assert.ok((calls.updateMany || 0) <= 2);                                                     // темы и пары
```

```js
// tests/permissions.test.js
assert.equal(can(['teacher'], 'dir.save', 'topics'), true);
assert.equal(can(['teacher'], 'dir.remove', 'topics'), true);
assert.equal(can(['teacher'], 'dir.save', 'weekTemplate'), false);
assert.equal(can(['teacher'], 'dir.list', 'topics'), false);
assert.equal(can(['teacher'], 'import.apply', 'topics'), false);
assert.equal(can(['teacher'], 'syllabus.apply'), true);
assert.equal(can(['dean'], 'syllabus.preview'), true);
assert.equal(can(['prorector'], 'syllabus.apply'), false);
assert.equal(can(['prorector'], 'dir.save', 'topics'), false);
assert.equal(can(['student'], 'syllabus.apply'), false);
assert.deepEqual(listPermissions(['teacher']),
  ['dir.remove:topics', 'dir.save:topics', 'schedule.mine', 'syllabus.apply', 'syllabus.preview', 'teacher.mySubjects', 'topics.plan']);
// tests/api.test.js, тест 'publicUser': permissions преподавателя — тот же список из семи строк
```

- [ ] **Step 2:** падает. **Step 3:** написать. Прежние тесты `tests/dirSchedule.test.js`, `tests/scheduleApi.test.js`, `tests/importApi.test.js` зелёные. **Step 4:** `npm test` зелёное; `npm run build:gas` проходит.
- [ ] **Step 5:** коммит `feat: teachers edit the topics of their own subjects and upload a syllabus`.

Проверяющий: скорость `syllabus.apply` и `bad_request` для `import.*` со спецификацией `syllabus` проверены настоящими `assert`, а не комментариями.

---

### Task 19 (Э): темы по семестрам, правка преподавателем, переключатель семестра

**Files:** Create `site/js/syllabus.js`, `tests/syllabus.test.js`. Modify `site/js/views/topics.js`, `site/js/views/plan.js`, `site/js/views/settings.js`, `site/js/views/home.js` (только подпись кнопки у предмета), `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `topics.plan` → `{ subject, semester, canEdit, topics: [{ id, semester, unit, order, name, lessonType, pair }], withoutTopic }` (Task 17, 18); `dir.save` и `dir.remove` для `topics` (в строке темы есть `semester`; чужой предмет → `forbidden`); `settings.get` и `settings.save` с полем `semester` (Task 17).

**Produces:**

```js
// site/js/syllabus.js — без DOM
export function semesterTopics(plan, semester);   // темы плана этого семестра по order
export function nextTopic(topics);                // -> { order, unit } для новой темы: наибольший № + 1 и модуль последней темы; тем нет -> { order: 1, unit: 1 }
export function planWarnings(plan, semester);     // -> { notPlaced, withoutTopic }: для plan.semester — темы семестра без пары и plan.withoutTopic; для другого семестра — нули

// site/js/views/topics.js
export function render(root, params = {});        // экран деканата «Темы» (#/topics)
export function renderSubject(root, subjectId);   // страница одного предмета (#/plan/<subjectId>): та же таблица и окна, без выбора предмета
export function leave();
// site/js/views/plan.js становится обёрткой: leave — тот же, render(root, { subjectId }) вызывает renderSubject
```

Экран тем (оба вида):

- Над таблицей — переключатель «1 семестр / 2 семестр» (`topics.semesterN`), у текущего семестра метка `topics.semesterNow` («идёт сейчас»). При открытии предмета выбрана вкладка текущего семестра (`plan.semester`). Таблица и счётчик тем — `semesterTopics(plan, вкладка)`; модули и № в каждой вкладке свои.
- Предупреждения «Не поместилось тем» и «Пар без темы» — из `planWarnings`, то есть только на вкладке текущего семестра. На вкладке другого семестра — `note('info', t('topics.otherSemester'))`; у темы без пары там вместо метки «без пары» приглушённый текст `topics.notNow`, строка не помечается как непоместившаяся. Если у темы другого семестра есть пара (она была проведена) — её дата показывается.
- Кнопки «Добавить тему», «Изменить», «Удалить» показываются по `plan.canEdit`, а не по правам из входа: право преподавателя зависит от предмета, это знает только сервер. Новая тема получает семестр открытой вкладки, № и модуль — из `nextTopic`. В окне темы семестр виден строкой над заголовком («Информатика — 01-1 · 2 семестр») и не меняется; в запрос уходит `semester`. Ответ `forbidden` при сохранении или удалении — сообщением в окне.
- Слово «Юнит» на экране заменяется на «Модуль»: колонка таблицы, поле окна, текст ошибки.
- Страница одного предмета (`renderSubject`): заголовок `plan.title` («Силлабус»), в панели — название предмета и группа, как сейчас; ответы `forbidden` и `not_found` — прежние сообщения со ссылкой на главную; при `canEdit === false` — `note('info', t('plan.readOnly'))`. На главной преподавателя кнопка у предмета называется `home.syllabus` («Силлабус»).
- Экран деканата «Темы»: всё прежнее (выбор предмета, преподаватель предмета) плюс вкладки семестров. Проректор видит таблицы без кнопок.

Экран «Настройки семестра»: в блоке «Семестр» под датами — переключатель «Сейчас идёт: 1 семестр / 2 семестр» (`settings.semesterNo`, пункты — `topics.semesterN`) с подсказкой `settings.semesterNoHint`. Значение входит в «несохранённые изменения» и уходит в `settings.save`. Если сохранение сменило семестр — к сообщению об успехе добавляется `settings.savedSemester`. Проректор видит значение без переключения.

Словари (ru; ky и en — по смыслу): `topics.semesterTabs` «Семестр»; `topics.semesterN` «{n} семестр»; `topics.semesterNow` «идёт сейчас»; `topics.otherSemester` «Темы этого семестра встанут на пары, когда деканат переключит семестр в „Настройках семестра“.»; `topics.notNow` «не в этом семестре»; `plan.readOnly` «Темы этого предмета меняют его преподаватель и деканат, здесь они только для просмотра.»; `home.syllabus` «Силлабус»; `settings.semesterNo` «Сейчас идёт»; `settings.semesterNoHint` «От этого зависит, темы какого семестра встают на пары. Переключайте вместе с датами нового семестра.»; `settings.savedSemester` «Семестр переключён: на непроведённые пары встали темы {n} семестра.»; `settings.error.semester.bad_value` «Выберите семестр: 1 или 2.». Меняются: `topics.field.unit` «Модуль»; `topics.field.unitHint` «Число от 1 до 12. В каждом семестре модули считаются с 1.»; `error.unit.bad_value` «Модуль — целое число от 1 до 12.»; `error.topics.order.duplicate` «Тема с таким номером в этом семестре уже есть.»; `topics.lead` «Силлабусы предметов: темы по семестрам. Журнал ставит темы текущего семестра на пары предмета по датам: одна тема — одна пара.»; `topics.hint` «Силлабусы предметов и даты пар»; `plan.title` «Силлабус»; `plan.lead` «Темы вашего предмета по семестрам. Журнал ставит темы текущего семестра на пары по датам: одна тема — одна пара.»

- [ ] **Step 1: тесты.**

```js
// tests/syllabus.test.js
const topic = (semester, order, unit, pair = null) => ({ id: `t${semester}_${order}`, semester, order, unit, name: 'Т', lessonType: 'lecture', pair });
const plan = { semester: 1, withoutTopic: 2,
  topics: [topic(1, 1, 1, { date: '2026-09-01' }), topic(1, 2, 2), topic(2, 1, 1), topic(2, 2, 1), topic(2, 5, 2)] };
assert.deepEqual(semesterTopics(plan, 1).map(t => t.id), ['t1_1', 't1_2']);
assert.deepEqual(semesterTopics(plan, 2).map(t => t.order), [1, 2, 5]);
assert.deepEqual(nextTopic(semesterTopics(plan, 2)), { order: 6, unit: 2 });
assert.deepEqual(nextTopic([]), { order: 1, unit: 1 });
assert.deepEqual(planWarnings(plan, 1), { notPlaced: 1, withoutTopic: 2 });
assert.deepEqual(planWarnings(plan, 2), { notPlaced: 0, withoutTopic: 0 });     // не текущий семестр: предупреждений нет

// tests/i18n.test.js
for (const key of ['topics.semesterN', 'topics.semesterNow', 'topics.otherSemester', 'topics.notNow', 'plan.readOnly', 'home.syllabus',
  'settings.semesterNo', 'settings.savedSemester', 'settings.error.semester.bad_value']) assert.ok(ru[key], key);
for (const dict of [ru, ky, en]) assert.doesNotMatch(dict['topics.field.unit'], /Юнит|Unit/);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** на `npm run dev:reset`. Под `teacher1`: «Мои предметы» → «Силлабус» у «Информатики» группы `01-1`: вкладка «1 семестр» (идёт сейчас) — 18 тем с датами, модули 1 и 2; вкладка «2 семестр» — 6 тем, «не в этом семестре», предупреждений нет. Добавить тему во втором семестре — № 7, модуль 2; изменить её название; удалить. Адрес силлабуса чужого предмета («Анатомия») — сообщение «нет прав». Под `dean`: «Темы» — те же вкладки у любого предмета, правка работает; в «Настройках семестра» переключить на «2 семестр» и сохранить — сообщение о переключении; на «Темах» у «Информатики» текущим стал второй семестр, его 6 тем встали на пары (на стенде проведённых пар ещё нет — их начнёт отмечать юнит 3, — поэтому с первой пары семестра), у остальных пар «без темы»; вернуть «1 семестр». Под `prorector`: вкладки есть, кнопок нет, переключатель семестра не нажимается. Обе темы, три языка, ширина 900 px, консоль без ошибок.
- [ ] **Step 6:** скриншоты (силлабус преподавателя — обе вкладки; окно темы; «Темы» деканата; блок «Семестр» в настройках; обе темы) — в `task-19-shots/`.
- [ ] **Step 7:** коммит `feat: topics by semester, teachers edit their syllabus, semester switch`.

---

### Task 20 (Э): загрузка силлабуса из Excel со страницы предмета

**Files:** Modify `site/js/views/import.js`, `site/js/views/topics.js` (кнопка и применение адреса), `site/js/router.js`, `site/js/shell.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `syllabus.preview { subjectId, cells }` и `syllabus.apply { subjectId, cells }` — ответы той же формы, что у импорта (Task 18); `topics.plan` → `subject`, `canEdit`; `IMPORT_COLUMNS.syllabus`, `FIELDS.semester`, ключи `import.col.syllabus.*` (Task 16); экран импорта (юнит 1, Task 10); `render(root, params)` и `renderSubject` экрана тем (Task 19).

- `resolveRoute`: `#/syllabus/<subjectId>` → `{ view: 'import', params: { subjectId } }`, если есть право `syllabus.apply`; `#/topics/<subjectId>` → `{ view: 'topics', params: { subjectId } }`, если есть `dir.list:topics` (экран «Темы» с уже выбранным предметом; параметр применяется один раз при смене адреса, как у «Шаблона недели» в Task 15). `#/import` по-прежнему требует право `import.apply:<таблица>`: преподавателю общий импорт не открывается.
- Экран тем: при `plan.canEdit` в шапке — кнопка-ссылка `syllabus.upload` («Загрузить силлабус (Excel)») на `#/syllabus/<id предмета>`. Прежняя ссылка «Загрузить темы из Excel» (на общий импорт) убирается вместе с ключом `topics.import`.
- Экран импорта в режиме силлабуса (`render(root, params = {})`, в адресе есть `subjectId`):
  - заголовок `syllabus.title`, текст `syllabus.lead`; шаг 1 — «Предмет» (`syllabus.step.subject`): название предмета, группа и преподаватель из `topics.plan`, подсказка `syllabus.subjectHint`; выбора справочника нет;
  - шаги 2–5 — прежние, для колонок `IMPORT_COLUMNS.syllabus`: вид первой строки файла, подсказки `import.colHint.syllabus.*`, правило `import.matchBy.syllabus`, шаблон `template-syllabus.xlsx` (лист называется `syllabus.sheet`; текстовые колонки — «Тема» и «Тип», числовые — «Семестр», «Модуль», «№»), проверка — `syllabus.preview`, импорт — `syllabus.apply`; ошибки показываются с номером строки и названием столбца, как в импорте справочников;
  - `topics.plan` ответил `forbidden` или `not_found`, либо `canEdit === false` — сообщение `syllabus.forbidden` или `plan.notFound` и ссылка на главную, шагов нет;
  - после импорта — итог и ссылка `syllabus.back` («К темам предмета»): на `#/topics/<id>`, если есть право `dir.list:topics`, иначе на `#/plan/<id>`;
  - переход между `#/import` и `#/syllabus/<id>` или между двумя предметами начинает экран заново (выбранный файл не переносится).
- `shell.js`: для режима силлабуса в меню подсвечен пункт «Темы» (у деканата), в «хлебных крошках» — страница `syllabus.title` в группе `nav.schedule` (есть `dir.list:topics`) или `home.mySubjects`.
- Словари (ru; ky и en — по смыслу; слова типа пары в подсказке — те же, что читает импорт): `syllabus.title` «Загрузка силлабуса»; `syllabus.lead` «Силлабус предмета из Excel: темы на весь год, у каждой указан семестр. Новые темы добавятся, темы с тем же семестром и номером обновятся.»; `syllabus.step.subject` «Предмет»; `syllabus.subjectHint` «Файл загружается только в этот предмет этой группы. Для другой группы откройте её предмет и загрузите файл там — тот же файл подойдёт.»; `syllabus.sheet` «Силлабус»; `syllabus.upload` «Загрузить силлабус (Excel)»; `syllabus.back` «К темам предмета»; `syllabus.forbidden` «Силлабус этого предмета загружают его преподаватель и деканат.»; `import.matchBy.syllabus` «Тема с тем же семестром и номером обновится, а не появится второй раз. Тем, которых нет в файле, журнал не удаляет: лишнюю удалите на странице предмета.»; `import.colHint.syllabus.semester` «1 или 2.»; `import.colHint.syllabus.unit` «Номер модуля в семестре, от 1 до 12. В каждом семестре модули считаются с 1.»; `import.colHint.syllabus.order` «Номер темы по порядку в семестре, в каждом семестре с 1. Одна строка — одна пара: лекция и практика по одной теме — две строки.»; `import.colHint.syllabus.lessonType` «лекция, практика или рубежный» (en — ровно «lecture, practice or control», как у тем: тест сравнивает слова с кодами типов); `import.error.order.duplicate` «Такой № в этом семестре уже есть — выше в файле или в журнале.»

- [ ] **Step 1: тесты.**

```js
// tests/router.test.js — отдельный блок test(): в файле уже есть другие const office (и блок Task 15)
test('resolveRoute: the syllabus upload and the topics screen with a subject', () => {
  const teacher = { mustChangePassword: false, permissions: ['dir.save:topics', 'syllabus.apply', 'syllabus.preview', 'topics.plan'] };
  const dean = { mustChangePassword: false, permissions: ['dir.list:topics', 'import.apply:topics', 'import.preview:topics', 'syllabus.apply'] };
  assert.deepEqual(resolveRoute('#/syllabus/sb_12ab34cd', teacher), { view: 'import', params: { subjectId: 'sb_12ab34cd' } });
  assert.equal(resolveRoute('#/syllabus/sb_12ab34cd', { mustChangePassword: false, permissions: ['topics.plan'] }).view, 'home');
  assert.equal(resolveRoute('#/syllabus', teacher).view, 'home');
  assert.equal(resolveRoute('#/import', teacher).view, 'home');                                // общий импорт преподавателю не открывается
  assert.deepEqual(resolveRoute('#/import', dean), { view: 'import', params: {} });
  const office = { mustChangePassword: false, permissions: ['dir.list:topics'] };
  assert.deepEqual(resolveRoute('#/topics', office), { view: 'topics', params: {} });
  assert.deepEqual(resolveRoute('#/topics/sb_12ab34cd', office), { view: 'topics', params: { subjectId: 'sb_12ab34cd' } });
  assert.equal(resolveRoute('#/topics/sb_12ab34cd', teacher).view, 'home');
});

// tests/i18n.test.js
for (const key of ['syllabus.title', 'syllabus.upload', 'syllabus.back', 'syllabus.forbidden', 'syllabus.sheet', 'import.matchBy.syllabus',
  'import.error.order.duplicate']) assert.ok(ru[key], key);
for (const key of ['semester', 'unit', 'order', 'lessonType']) assert.ok(ru['import.colHint.syllabus.' + key], key);
for (const dict of [ru, ky, en]) assert.equal('topics.import' in dict, false);

// новый тест рядом с прежним 'the lesson types the import hint names are words the importer reads…' (настоящая проверка, не комментарий)
test('the lesson types the syllabus hint names are words the syllabus file reads', () => {
  const db = { groups: [{ id: 'g1', name: '01-1' }], subjects: [{ id: 'sb1', name: 'Анатомия', groupId: 'g1' }], topics: [], pairs: [] };
  const words = (dict) => dict['import.colHint.syllabus.lessonType'].replace(/\.$/, '').split(/,\s*|\s+(?:или|or|же)\s+/);
  for (const [lang, dict] of Object.entries({ ru, ky, en })) {
    const cells = [IMPORT_SPECS.syllabus.columns.map((col) => col.titles.ru),
      ...words(dict).map((word, i) => [1, 1, i + 1, 'Тема', word])];               // Семестр, Модуль, №, Тема, Тип
    const { records, errors } = parseSheet('syllabus', cells, db, { subjectId: 'sb1' });
    assert.deepEqual(errors, [], lang);
    assert.deepEqual(records.map((r) => r.lessonType), LESSON_TYPES, lang);
  }
  assert.deepEqual(words(en), LESSON_TYPES);                                       // en: «lecture, practice or control»
});
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** на `npm run dev:reset`. Под `teacher1`: «Силлабус» у «Информатики» `01-1` → «Загрузить силлабус (Excel)»; скачать шаблон — пять столбцов, «Тема» и «Тип» текстовые; вписать три строки: `2 | 2 | 7 | Итоговое занятие | практика`, `2 | 1 | 1 | Электронные таблицы: новая редакция | лекция`, `3 | 1 | 1 | Третий семестр | лекция`; проверка — 1 новая, 1 обновится, 1 ошибка с номером строки и столбцом «Семестр»; импорт; «К темам предмета» — во втором семестре 7 тем, первая с новым названием. Тот же файл второй раз — 0 новых. Адрес `#/syllabus/<id «Анатомии»>` — сообщение, что силлабус загружают преподаватель предмета и деканат; `#/import` ведёт на главную. Под `dean`: «Темы» → «Анатомия — 01-1» → «Загрузить силлабус (Excel)» → файл на год (семестр 1 — три строки, семестр 2 — две) → «К темам предмета»: открыт тот же предмет, темы первого семестра встали на пары, во втором — «не в этом семестре». «Импорт из Excel» → «Темы»: в шаблоне есть столбец «Семестр». Под `prorector` кнопки загрузки нет. Обе темы, три языка, ширина 900 px, консоль без ошибок.
- [ ] **Step 6:** скриншоты (шаги загрузки силлабуса с ошибкой в строке; итог; кнопка на странице предмета; обе темы) — в `task-20-shots/`.
- [ ] **Step 7:** коммит `feat: syllabus upload from the subject page`.

Проверяющий: проверка слов типа пары для `parseSheet('syllabus', …)` написана настоящим тестом с `assert`, а не комментарием.

---

### Task 13 (координатор и владелец): приёмка и выкладка

Делается после общей проверки юнита самой сильной моделью и исправления её замечаний.

Дополнение от 21.11.2026: задача идёт после задач 14–20. Перед показом владельцу — общая проверка диапазона дополнения (`3ed1727..HEAD`) самой сильной моделью по Review Focus 7–12 и исправление её замечаний. Вопросы к владельцу и то, что он увидит, — в `owner-summary-2.md`.

- [ ] **Step 1:** показать владельцу на стенде (`npm run dev:reset`, `http://localhost:5273`) шесть экранов по скриншотам задач 8–12 и вживую; получить приёмку. Кыргызские тексты новых экранов добавить в список на вычитку. Дополнение: показать ещё три изменения по скриншотам задач 14, 15, 19 и 20 — список времени звонков; день недели → шаблон группы; силлабус преподавателя (вкладки семестров, загрузка файла, правка) и переключатель семестра.
- [ ] **Step 2:** согласованные решения из раздела «Решения плана» и ответы владельца на вопросы из `owner-summary.md` записать в таблицу решений `aidlc-docs/aidlc-state.md`. Дополнение: то же для строк дополнения и вопросов из `owner-summary-2.md`; в `aidlc-docs/inception/design-v1.md` (раздел 6 «Расписание и темы» и раздел 8) дописать: темы — силлабус преподавателя по семестрам, колонка «семестр» в листе «Темы», строка `semester` в «Настройках».
- [ ] **Step 3 (только по прямой просьбе владельца):** `npm run build:gas`; `npx -y @google/clasp@latest push --force`; `npx -y @google/clasp@latest deploy -i <ID публикации из aidlc-state.md> -d "unit 2: schedule and topics"` — адрес сервера прежний.
- [ ] **Step 4:** владелец в редакторе Apps Script ещё раз запускает `setup`: появляются листы «Шаблон недели», «Темы», «Пары», таблице ставятся часовой пояс Бишкека и русский язык. Временный пароль администратора при этом не меняется. Дополнение: лист «Темы» создаётся сразу с колонкой «семестр»; строка `semester` в «Настройках» появится при первом сохранении настроек с переключателем семестра.
- [ ] **Step 5 (только по прямой просьбе владельца):** `git push` — сайт обновится на GitHub Pages.
- [ ] **Step 6: проверка на живом сайте** на вымышленных данных: сохранить настройки семестра; три строки шаблона; «Создать расписание» — замерить время (ожидание: до 15 секунд на семестр трёх групп); импорт трёх тем; замена и отмена пары; расписание студента с телефона. В таблице: дата в листе «Пары» осталась текстом `2026-…`, а не превратилась в дату. Дополнение: под вымышленным преподавателем загрузить силлабус своего предмета на год (по две темы в каждом семестре) — темы первого семестра встали на пары; чужой предмет не открывается; время звонка выбирается из списка; день недели в «Расписании» открывает шаблон группы.
- [ ] **Step 7:** обновить `aidlc-docs/aidlc-state.md`: юнит 2 принят и выложен; в «Что перенести в следующие юниты» записать для юнита 3: статусы `running`, `closed`, `missed` выставляет он; прошедшая неначатая пара должна стать `missed` и отдать тему следующей (`relayout`); колонки «фактический старт» и «секрет QR» добавляются в схему `pairs`. Дополнение — записать для юнитов 4–6: модуль теперь определяется тройкой «предмет + семестр + номер модуля» (ведомость, рубежный контроль, закрытие юнита); на экранах слово «Модуль», а не «Юнит».

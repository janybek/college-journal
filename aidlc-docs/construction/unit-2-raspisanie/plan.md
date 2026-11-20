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

## Чего в юните 2 нет

- Кнопки «Начать пару», таймера, QR и отметки: это юнит 3. Статусы `running`, `closed`, `missed` в юните 2 только объявлены и учитываются в правилах; выставлять их начнёт юнит 3. Там же решается, когда прошедшая неначатая пара становится «не проведена» и отдаёт свою тему следующей.
- Колонок «фактический старт» и «секрет QR» в листе «Пары» и колонки «материал» в листе «Темы»: их добавит тот юнит, которому они нужны (`ensureSheets` дописывает колонки сам).
- Экрана деканата «Сейчас идёт» (версия 2), подгрупп, недель «числитель / знаменатель», субботы в шаблоне.
- Записи замен и переносов в «Журнал изменений» (юнит 6) — пока остаётся только примечание у пары. Объявлений и уведомлений о переносе.
- Правки тем преподавателем: он только видит. Копирования тем из одной группы в другую кнопкой.
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

## Файлы

```
core/dates.js            даты и время строками, часовой пояс Бишкека                      новый
core/settings.js         настройки семестра: чтение, проверка, звонки                      новый
core/topics.js           раскладка тем по парам                                             новый
core/schedule.js         рабочие дни, создание пар семестра, проверка изменения пары       новый
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
tests/storeContract.js  dates.test.js  settings.test.js  topics.test.js  schedule.test.js
tests/settingsApi.test.js  dirSchedule.test.js  scheduleApi.test.js  pairsApi.test.js  siteDates.test.js  pairs.test.js
```

Кто делает: **Л** — агент «Логика», **С** — «Сервер», **Э** — «Экраны». После каждой задачи — агент «Проверяющий». Задачи идут строго по одной, в порядке номеров: общие файлы (`core/schema.js`, `backend/handlers/dir.js`, `site/js/router.js`, `shell.js`, словари) правит только та задача, которая сейчас в работе. Файл чужой зоны агент трогает, только если он прямо назван в его задаче.

Общие данные для тестов сервера (задачи 5–7) — тот же приём, что в `tests/dir.test.js`: `createMemoryStore`, часы `now` меняются из теста, сотрудники `admin`, `dean` (роли `dean,teacher`), `prorector`, `teacher1`, `teacher2` с паролем `secret12`, `call(action, data, token)`.

---

### Task 1 (С): одинаковая форма строк, пакетная запись, часовой пояс таблицы

Закрывает отложенные замечания юнита 1 (журнал хода работ, задача 2: строки 64, 65, 67, 74; общая проверка: M-4).

**Files:** Create `backend/store/rowShape.js`, `tests/storeContract.js`, `core/dates.js`. Modify `backend/store/memoryStore.js`, `backend/store/fileStore.js`, `backend/store/sheetsStore.js`, `backend/gas/main.js`, `tests/fakes/fakeSpreadsheet.js`, `tests/fakes/fakeGas.js`, `tests/store.test.js`, `tests/sheetsStore.test.js`, `tests/gasBundle.test.js`.

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
- `sheetsStore.removeMany`: одно чтение, удаление снизу вверх; подряд идущие строки удаляются одним вызовом `sheet.deleteRows(position, howMany)`.
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
s.removeMany('rooms', [a.id, c.id]);
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

**Files:** Modify `core/dates.js`, `core/schema.js`, `core/permissions.js`, `tests/dates.test.js`, `tests/schema.test.js`, `tests/permissions.test.js`, `tests/sheetsStore.test.js` и `tests/gasBundle.test.js` (только ожидаемое число листов). Create `core/settings.js`, `tests/settings.test.js`.

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
- `bells`: массив от 1 до `MAX_SLOTS` строк `isTime`; каждый следующий звонок не раньше предыдущего плюс `PAIR_MINUTES`; последняя пара заканчивается не позже 24:00. Любое нарушение → `bad_value`.

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
```

- [ ] **Step 2:** падает. **Step 3:** написать; в `tests/sheetsStore.test.js` и `tests/gasBundle.test.js` поправить ожидания, которые считают листы (в схеме было 7 таблиц, стало 10). **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: schedule tables, date helpers, semester settings rules, permissions`.

---

### Task 3 (Л): правила шаблона и тем, раскладка тем, импорт тем

**Files:** Modify `core/validate.js`, `core/import.js`, `tests/validate.test.js`, `tests/import.test.js`. Create `core/topics.js`, `tests/topics.test.js`. В чужой зоне, только названное: `site/js/views/directoryConfig.js` — добавить `IMPORT_COLUMNS.topics` (шесть обязательных колонок в порядке таблицы ниже); `site/js/i18n/ru.js`, `ky.js`, `en.js` — шесть ключей `import.col.topics.<key>` со значениями заголовков из таблицы ниже. Без этого два теста в `tests/i18n.test.js`, которые сверяют сайт с `IMPORT_SPECS`, упадут. В список `IMPORT_TABLES` тема не добавляется: экран импорта получит её в Task 10.

**Interfaces — Consumes:** `SCHEMA`, `FIXED_STATUSES`, `LESSON_TYPES`, `WEEKDAYS` (Task 2), `MAX_SLOTS` (Task 2).

**Produces:**

```js
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
- `lessonType` в файле: `лекция`, `lecture` → `lecture`; `практика`, `практическое`, `practice` → `practice`; `рубежный`, `рубежный контроль`, `экзамен`, `аралык текшерүү`, `control`, `exam` → `control`; другое слово → `bad_value`.
- `check` для тем: строка совпала с существующей темой, эта тема стоит на паре со статусом из `FIXED_STATUSES` (`db.pairs`), и название, тип или юнит в файле другие → `{ field: 'name', code: 'held' }`.
- Рабочая копия базы в `parseSheet` строится по всем ключам `db`, а не по пяти зашитым таблицам.

- [ ] **Step 1: тесты.**

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

- [ ] **Step 2:** падает. **Step 3:** написать. Прежние тесты импорта пяти справочников остаются зелёными без правок. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: week template and topic rules, topic layout, topics import`.

---

### Task 4 (Л): создание пар семестра и проверка изменения пары

**Files:** Create `core/schedule.js`, `tests/schedule.test.js`.

**Interfaces — Consumes:** `core/dates.js`, `PAIR_MINUTES`, настройки в форме `readSettings` (Task 2).

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
   - ключ есть, что-то отличается → в `toUpdate` только отличающиеся поля (при смене `subjectId` ещё `topicId: ''`);
   - ключа нет → в `toRemove`;
   - вторая заменяемая пара с тем же ключом → в `toRemove`.
4. Незаменяемая пара (тронута вручную или статус не `planned`) остаётся как есть (`kept`), её ключ считается занятым.
5. Нужные пары без существующей → в `toInsert`. Если на эти (`groupId`, `date`, `slot`) уже стоит незаменяемая пара со статусом не `cancelled` и не `missed` — пара не создаётся, `conflicts` растёт.
6. `restart: true` → `toRemove` — все пары, `toInsert` — все нужные, остальное пусто.
7. `toInsert` и `toUpdate` отсортированы по дате, номеру пары, `groupId`.

`pairLock`: статус не `planned` → `'pair_locked'`; `pair.date < today` → `'in_past'`; иначе `null`.

`checkPairChange` — поля, которых нет в `patch`, берутся из пары; ошибки в порядке `date`, `slot`, `teacherId`, `roomId`, `note`, не больше одной на поле:

- `date`: не `isDate` → `bad_value`; раньше `today` → `in_past`; вне семестра → `out_of_semester`; воскресенье или нерабочий день → `day_off`. Суббота разрешена.
- `slot`: не целое от 1 до числа звонков → `bad_value`; у группы на эти дату и номер уже есть другая пара → `group_busy`.
- `teacherId`: нет в `staff` → `bad_ref`; не активен или нет роли `teacher` → `bad_value`; у него на эти дату и номер другая пара → `teacher_busy`.
- `roomId`: пусто можно; нет в `rooms` → `bad_ref`; занята на эти дату и номер → `room_busy`.
- `note`: обрезается по краям; длиннее 200 → `too_long`.
- Занятость считается по парам со статусом не `cancelled` и не `missed`, сама пара не в счёт. Если дата или номер пары неверны, занятость не проверяется.

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

**Files:** Create `backend/handlers/settings.js`, `tests/settingsApi.test.js`, `tests/dirSchedule.test.js`. Modify `backend/handlers/dir.js`, `backend/handlers/import.js` (только вызов `loadDb`), `backend/api.js` (регистрация).

**Interfaces — Consumes:** `readSettings`, `validateSettings`, `settingsToRows`, `DEFAULT_BELLS`, `PAIR_MINUTES` (Task 2); `validateRow` для `weekTemplate` и `topics` (Task 3); `FIXED_STATUSES` (Task 2); `updateMany`, `removeMany` (Task 1).

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

Особые правила `dir.save`:

- `subjects`: у существующего предмета меняют `groupId`, а на предмет ссылается строка шаблона или пара → `invalid`, `[{ field: 'groupId', code: 'in_use' }]`. Эта проверка идёт раньше `validateRow`.
- `subjects`: у существующего предмета меняют `teacherId`, а у нового преподавателя в шаблоне уже есть пара в тот же день и с тем же номером, что у этого предмета → `invalid`, `[{ field: 'teacherId', code: 'teacher_busy' }]`. В остальных случаях смена преподавателя разрешена; будущие пары получат его при следующем «Создать расписание».
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

// скорость: обёртка над хранилищем считает вызовы list по таблицам
// dir.save для groups читает только 'groups' (и 'staff' — проверка ключа входа); dir.remove для rooms не читает 'students'
```

- [ ] **Step 2:** падает. **Step 3:** написать. Прежние тесты `tests/dir.test.js` и `tests/importApi.test.js` остаются зелёными. **Step 4:** `npm test` зелёное.
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
export function relayout(store, subjectIds = null);        // пересчитывает темы предметов (null — всех); -> число изменённых пар
export function generateSchedule(store, platform, { dryRun = false, restart = false } = {});
// -> { from, to, inserted, updated, removed, kept, conflicts }
```

- `relayout`: одно чтение «Тем», одно чтение «Пар», `layoutTopics` по каждому предмету, одна запись `updateMany`. Нечего менять — записи нет.
- `generateSchedule`:
  - нет дат семестра → `AppError('invalid', { fields: [{ field: 'semesterStart', code: 'required' }] })`;
  - шаблон пуст → `AppError('empty_template')`;
  - `restart` и есть пара со статусом не `planned` и не `cancelled` → `AppError('in_use')`;
  - `from`: пар ещё нет или `restart` → начало семестра; иначе более поздняя из дат «сегодня» и «начало семестра»; `to` — конец семестра;
  - `dryRun` → только числа, записи нет;
  - иначе по одному вызову `removeMany`, `updateMany`, `insertMany` (пустые не делаются), затем `relayout(store)`.
- Действия: `schedule.generate { dryRun?, restart? }` → результат `generateSchedule`; `topics.plan { subjectId }` →

```js
{ subject: { id, name, groupId, groupName, teacherId, teacherName },
  topics: [{ id, unit, order, name, lessonType, pair: { id, date, slot, startTime, status } | null }],   // по order; pair — пара, на которой стоит тема
  withoutTopic: number }                                                                                 // запланированные пары предмета без темы
```

  Предмета нет → `not_found`. Вошедший действует только как преподаватель (нет ролей `admin`, `dean`, `prorector`) и предмет не его → `forbidden`.
- Пересчёт после изменения тем: `dir.save` и `dir.remove` для `topics` вызывают `relayout(store, [subjectId])`; `import.apply` для `topics` после записи вызывает `relayout` по затронутым предметам. Для импорта тем база собирается как `loadDb(store, 'topics', ['groups', 'pairs'])`.

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
assert.equal('passwordHash' in plan.subject, false);

// Review Focus 2
assert.deepEqual(call('schedule.generate', {}, dean).data, { ...dry, inserted: 0, kept: 4 });
assert.equal(store.list('pairs').length, 4);
now = Date.UTC(2026, 8, 3, 6);                                                  // 3 сентября
// у строки шаблона wt_1 сменили аудиторию
const later = call('schedule.generate', {}, dean).data;
assert.deepEqual(later, { from: '2026-09-03', to: '2026-09-11', inserted: 0, updated: 1, removed: 0, kept: 2, conflicts: 0 });
assert.equal(mine()[0].roomId, r1);                                             // пара 1 сентября не тронута

// скорость: настоящий запуск делает не больше одного insertMany, двух updateMany и одного removeMany,
// и ни одного insert, update, remove (обёртка-шпион над хранилищем)

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

**Interfaces — Consumes:** `checkPairChange`, `pairLock` (Task 4), `relayout`, `todayOf`, `loadSettings`, `generateSchedule` (Task 6), `mondayOf`, `addDays`, `addMinutes`, `isDate`, `daysBetween` (Task 2), `PAIR_MINUTES`.

**Produces:**

```js
// backend/scheduleData.js
export function pairViews(store, keep);     // keep(pair) -> boolean; -> PairView[] по дате, номеру пары, названию группы
// PairView — собирается по полям:
// { id, date, slot, startTime, endTime, status, groupId, groupName, subjectId, subjectName, teacherId, teacherName,
//   roomId, roomName, topic: { id, unit, order, name, lessonType } | null,
//   substitution: boolean, moved: boolean, planDate, planSlot, note }
// endTime = startTime + PAIR_MINUTES; substitution — преподаватель пары не тот, что у предмета; moved — date или slot отличаются от плановых.
// Названия несуществующих записей — пустая строка. Каждый лист читается один раз.
```

Действия:

- `schedule.list { from, to?, groupId?, teacherId? }` → `{ today, from, to, pairs }`. `to` по умолчанию `from + 6`. Даты не `isDate`, `to` раньше `from` или диапазон длиннее 31 дня → `bad_request`. Фильтры необязательные; без них — все группы.
- `schedule.mine { from? }` → `{ today, from, to, pairs }`. `from` приводится к понедельнику своей недели (по умолчанию — неделя «сегодня»), `to = from + 6`. Студент получает пары своей группы; сотрудник — пары, где он преподаватель. Неверная дата → `bad_request`.
- `schedule.changePair { id, teacherId?, date?, slot?, roomId?, note? }` → `{ pair }`. Пары нет → `not_found`; `pairLock` → `AppError` с этим кодом; ошибки `checkPairChange` → `invalid` с полями; запись одним `update`; если изменились дата или номер пары — `relayout(store, [subjectId])`.
- `schedule.cancelPair { id, note? }` → `{ pair }`. Тот же `pairLock`; примечание длиннее 200 → `invalid`, `note: too_long`; ставит `status: 'cancelled'`, `topicId: ''`, `changed: true`; затем `relayout`.
- `schedule.restorePair { id }` → `{ pair }`. Статус не `cancelled` → `pair_locked`; дата раньше «сегодня» → `in_past`; занятость проверяется `checkPairChange(pair, {}, ctx)`; ставит `status: 'planned'`; затем `relayout`.

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

// Review Focus 1: пара 1 сентября проведена; отмена пары 8 сентября сдвигает темы следующих пар
store.update('pairs', pair1, { status: 'closed' });
const topicsByDate = () => Object.fromEntries(call('schedule.list', { from: '2026-09-01', to: '2026-09-25', groupId: g1 }, dean).data.pairs
  .map(p => [p.date, p.topic ? p.topic.order : null]));
assert.equal(call('schedule.cancelPair', { id: pair8, note: 'Преподаватель на конференции' }, dean).data.pair.status, 'cancelled');
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
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test` зелёное; `npm run build:gas` проходит.
- [ ] **Step 5:** `npm run dev:reset`, запрос `schedule.mine` под `teacher1` и под `S1001` возвращает пары текущей недели.
- [ ] **Step 6:** коммит `feat: schedule views, substitutions, moves and cancellations, dev seed with a schedule`.

---

### Task 8 (Э): экран «Настройки семестра»

**Files:** Create `site/js/dates.js`, `site/js/views/settings.js`, `tests/siteDates.test.js`. Modify `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/icons.js`, `site/js/views/home.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`, `tests/i18n.test.js`.

**Interfaces — Consumes:** `settings.get`, `settings.save`; `call`, `t`, помощники `site/js/ui.js`.

**Produces:**

```js
// site/js/dates.js — без DOM и без Intl; сайт не может загрузить core/, поэтому это копия нужных функций core/dates.js
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
}
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
for (const code of ['group_busy', 'teacher_busy', 'room_busy', 'in_past', 'pair_locked', 'empty_template', 'held', 'out_of_semester', 'day_off'])
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
- Экран: выбор группы; сетка «дни недели (пн–пт) × пары» — у каждой строки номер пары и время из звонков. В занятой клетке — предмет, преподаватель, аудитория; в пустой — кнопка «+». Нажатие открывает окно: предмет (только предметы выбранной группы; если их нет — подсказка завести предметы в справочнике), аудитория (с вариантом «без аудитории»), «Сохранить», у существующей строки — «Удалить». Ошибки `group_busy`, `teacher_busy`, `room_busy` — у своих полей, своим текстом: «У этого преподавателя в это время пара в другой группе», «Аудитория в это время занята».
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
export function canEditPair(pair, today);             // status === 'planned' && pair.date >= today
// site/js/views/pairParts.js — общие части трёх экранов расписания (этот, Task 12)
export function weekNav({ from, onChange });          // «‹ неделя ›», «Эта неделя»; подпись «16–22 ноября»
export function pairCard(pair, { show, onOpen });     // show: какие из ['group', 'teacher'] показывать; onOpen — карточка становится кнопкой
export function dayList(days, today, cardOptions);    // дни подряд, «сегодня» выделен, пустой день — «Пар нет»
```

- `resolveRoute`: `#/schedule` → `schedule`, если есть `schedule.list`. Пункт меню `{ name: 'schedule', href: '#/schedule', textKey: 'schedule.title', icon: 'calendar', hintKey: 'schedule.hint' }` первым в группе.
- Карточка пары: время «08:00–09:30», предмет, группа или преподаватель, аудитория, тема («Тема 3. Защита данных» и метка типа) или «Без темы», метки «Замена», «Перенос» (с подписью «с 8 сентября, 1 пара»), «Отменена»; примечание, если есть. Отменённая пара приглушена.
- Экран: переключатель «По группе / По преподавателю / День». В первых двух режимах — выбор группы или преподавателя и неделя: дни с понедельника по субботу колонками на широком экране и списком на узком; воскресенье показывается, только если в нём есть пара. В режиме «День» — поле даты, кнопки «‹ ›» и «Сегодня», таблица всех пар дня по всем группам: пара и время, группа, предмет, преподаватель, аудитория, тема, статус. «Сегодня» берётся из ответа сервера.
- С правом `schedule.changePair` пара, для которой `canEditPair`, открывает окно «Изменить пару»: преподаватель (активные сотрудники с ролью преподавателя), дата, номер пары (со временем из звонков), аудитория, примечание; «Сохранить»; «Отменить пару» — с подтверждением и примечанием. У отменённой пары — «Вернуть пару». Ошибки `fields` — у полей своими текстами (`day_off`: «В этот день занятий нет», `out_of_semester`, `in_past`, `group_busy`, `teacher_busy`, `room_busy`). `pair_locked` и `in_past` на всю пару — сообщением в окне. После успеха неделя перечитывается.
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

**Files:** Create `site/js/views/mySchedule.js`, `site/js/views/plan.js`. Modify `site/js/views/home.js`, `site/js/router.js`, `site/js/main.js`, `site/js/shell.js`, `site/js/i18n/*.js`, `site/css/screens.css`, `tests/router.test.js`, `tests/ui.test.js`.

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

### Task 13 (координатор и владелец): приёмка и выкладка

Делается после общей проверки юнита самой сильной моделью и исправления её замечаний.

- [ ] **Step 1:** показать владельцу на стенде (`npm run dev:reset`, `http://localhost:5273`) шесть экранов по скриншотам задач 8–12 и вживую; получить приёмку. Кыргызские тексты новых экранов добавить в список на вычитку.
- [ ] **Step 2:** согласованные решения из раздела «Решения плана» и ответы владельца на вопросы из `owner-summary.md` записать в таблицу решений `aidlc-docs/aidlc-state.md`.
- [ ] **Step 3 (только по прямой просьбе владельца):** `npm run build:gas`; `npx -y @google/clasp@latest push --force`; `npx -y @google/clasp@latest deploy -i <ID публикации из aidlc-state.md> -d "unit 2: schedule and topics"` — адрес сервера прежний.
- [ ] **Step 4:** владелец в редакторе Apps Script ещё раз запускает `setup`: появляются листы «Шаблон недели», «Темы», «Пары», таблице ставятся часовой пояс Бишкека и русский язык. Временный пароль администратора при этом не меняется.
- [ ] **Step 5 (только по прямой просьбе владельца):** `git push` — сайт обновится на GitHub Pages.
- [ ] **Step 6: проверка на живом сайте** на вымышленных данных: сохранить настройки семестра; три строки шаблона; «Создать расписание» — замерить время (ожидание: до 15 секунд на семестр трёх групп); импорт трёх тем; замена и отмена пары; расписание студента с телефона. В таблице: дата в листе «Пары» осталась текстом `2026-…`, а не превратилась в дату.
- [ ] **Step 7:** обновить `aidlc-docs/aidlc-state.md`: юнит 2 принят и выложен; в «Что перенести в следующие юниты» записать для юнита 3: статусы `running`, `closed`, `missed` выставляет он; прошедшая неначатая пара должна стать `missed` и отдать тему следующей (`relayout`); колонки «фактический старт» и «секрет QR» добавляются в схему `pairs`.

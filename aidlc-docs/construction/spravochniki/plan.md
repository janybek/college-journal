# Доработка «Справочники с подробностями»: план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в справочниках «Группы», «Аудитории», «Дисциплины» появляются колонки с короткими цифрами (вид А) и карточка записи по нажатию на название (вид Б); всё — из того, что журнал уже знает, база не меняется.

**Architecture:** два новых запроса только для чтения — `dir.summary` (цифры для колонок списка, по одной строке на запись) и `dir.card` (одна запись подробно). Правила без хранилища («сейчас», «пар в неделю», «чаще всего», состояние силлабуса) лежат в `core/dirInfo.js`; сборка ответов — `backend/dirInfo.js`, каждая таблица читается один раз, ничего не пишется (досчёта пар `settleLessons` в этих запросах нет). Сайт: список справочника дополнительно спрашивает `dir.summary` и дорисовывает колонки; карточка — новый экран `dirCard` по адресу `#/dir/<table>/<id>`. «Расписание», «Журналы» и «Студенты» получают адреса «сразу на группе», прежние адреса работают как раньше.

**Tech Stack:** Node 24, ES-модули, `node --test`, сайт без сборки; новых зависимостей нет.

**Spec:** `aidlc-docs/construction/spravochniki/design.md` (согласован владельцем 25.11.2026 вместе с шестью решениями координатора). Макеты — `.superpowers/sdd/directory-info/mockups/a-columns.png`, `b-group.png`, `b-room.png`. Общие правила — `CLAUDE.md`.

**Исходное состояние:** `HEAD 41d110a`, `npm test` — 1278 тестов, все зелёные (прогон 25.11.2026). Тестовый журнал (сервер и сайт) — на `87d5267`. Боевой не трогаем.

**Порядок.** Сначала сверка плана (opus): имена, поля, числа тестов и стенда — против готового кода; находки правит отдельный агент в этом файле. Затем задачи 1 → 5 строго по одной; после каждой `npm test` зелёное и `npm run build:gas` собирается. Задачи 1–2 — без остановки. Задачи 3–4 — **один блок владельца**: после задачи 4 остановка, приёмка на стенде по скриншотам. Потом задача 5.

| № | Кто | Задача | Проверка ИИ |
| --- | --- | --- | --- |
| 1 | Л | Правила «сейчас», «пар в неделю», «чаще всего», силлабусы; права двух запросов | облегчённая |
| 2 | С | Запросы `dir.summary` и `dir.card`, пробы обхода, скорость на данных стенда | **строгая** (права, данные студентов) |
| 3 | Э | Колонки в трёх списках, адреса карточек, «Расписание» / «Журналы» / «Студенты» сразу на группе — блок | нет (владелец принимает блоком) |
| 4 | Э | Карточки группы, аудитории (сетка недели), дисциплины — блок, остановка | **строгая** (данные студентов, кнопка проректора) |
| 5 | — | Общая проверка (opus), одна волна исправлений, выкладка на тестовый только по просьбе владельца | — |

Модели: «Логика», «Сервер», «Экраны», проверяющий задач — sonnet; сверка плана и общая проверка — opus. Отчёт проверяющего — не длиннее 15 строк.

## Global Constraints

Памятки для агентов (`implementer-contract.md`, `reviewer-contract.md`, `rereview-contract.md`) копируются из `.superpowers/sdd/plan-povtornyi-kurs/` в `.superpowers/sdd/plan-spravochniki/` с этим разделом вместо прежнего раздела «Global constraints». Журнал хода — `.superpowers/sdd/plan-spravochniki/progress.md`, копия — `aidlc-docs/construction/spravochniki/sdd/ledger-snapshot.md`.

- `core/` и `backend/` без зависимостей из npm; обработчики синхронные; `handleRequest` никогда не бросает; ошибки — `AppError(code, { fields })`.
- Время — только `platform.now()`; «сегодня» — `localDate(platform.now())`, «сейчас» — `localTime(platform.now())` (Бишкек). Сайт часам устройства не доверяет: и «сегодня», и «сейчас» берёт из ответа сервера.
- Каждая таблица читается не больше одного раза за запрос (`store.list`). Запросы `dir.summary` и `dir.card` **ничего не пишут** — ни в одну таблицу, и `settleLessons` не вызывают.
- **Прежние ответы не меняются**: `dir.list`, `schedule.list`, `subjects.overview` и остальные — те же байт в байт; новые сведения — только в новых запросах. Прежние тесты не правятся, кроме добавления строк про новые права, если тест перечисляет права поимённо (назвать в отчёте).
- Права: `dir.summary` и `dir.card` — администратор, деканат, проректор, таблицы `groups`, `rooms`, `disciplines` (как `dir.list`). Проректор ничего не меняет: кнопки «Изменить» у него нет, `dir.save` для него — `forbidden`, как сейчас.
- `passwordHash`, `mustChangePassword`, `lang` студентов и сотрудников в новые ответы не попадают: ответы собираются по полям, строки целиком не копируются. Неактивные студенты в карточке — только числом.
- Сборка Apps Script чистая: в `core/*`, `backend/*.js`, `backend/handlers/*` нет `node:`, `require(`, `Buffer`, слова `process` (`tests/gasBundle.test.js`); `npm run build:gas` собирается.
- Любая фраза — через три словаря `site/js/i18n/{ru,ky,en}.js` с одинаковыми ключами (кыргызские — на вычитку); слова с числом — `tCount` с четырьмя формами.
- Данные с сервера — на страницу только текстом (`textContent`, помощники `site/js/ui.js`), никогда через `innerHTML`.
- Цвета — hex или rgb (без `oklch()`), из переменных `site/css/app.css`; две темы, каждый экран проверяется в обеих; ширина окна сотрудника 1366 px — без горизонтальной прокрутки страницы (таблица может прокручиваться внутри своей карточки).
- Настоящих людей нет нигде: ни в тестах, ни в отчётах, ни на скриншотах. `dev/data/real.json`, рабочий сервер (порт 5373) и папки `D:\Журнал колледжа — сервер`, `D:\Журнал колледжа — данные`, `C:\JournalBackups` агенты не открывают.
- Стенд — только порт 5273, свой (`npm run dev:reset` или `npm run dev:lesson`); стенд координатора перед экранными задачами остановлен. Браузер — только headless Chrome с временным профилем и `--disable-sync --disable-extensions`, не Edge. Процессы останавливаются **только по своему PID**, никогда по имени программы или заголовку окна.
- Коммиты на английском, только свои файлы по имени (не `git add -A`), `git status` после — чистый; строка `Co-Authored-By` — с моделью, которая писала коммит. `git push` и выкладка — только по прямой просьбе владельца.

## Review Focus

1. **Обход прав.** `dir.summary` и `dir.card` студентом и преподавателем (без роли деканата) — `forbidden`; без входа — `unauthorized`; `table` = `'students'`, `'staff'`, `'weekTemplate'`, `'topics'`, `['groups']`, `5`, `'__proto__'`, нет поля — `forbidden` (права по таблице, как у `dir.list`), не `internal`. Сотрудник `dean,teacher` — пускают. Тест — задача 2.
2. **Плохой id и неделя.** `id` массив, число, объект, `null`, `''` — `bad_request`; `'  '`, `' g1 '`, `'__proto__'`, `'constructor'`, неизвестный, id записи другой таблицы (аудитории в `groups`), удалённой записи — `not_found`; `from` `'2026-13-01'`, `5`, `''` — `bad_request`; `from` среда — неделя с понедельника. Ни одного `internal`. Тест — задача 2; на экране — задачи 3 и 4 (адрес с неизвестным id → «Записи нет» и «К списку»).
3. **Ничего не пишется и читается по разу**, в том числе когда пара идёт прямо сейчас (`dir.summary` и `dir.card` не досчитывают пары, в отличие от `schedule.list`): снимок всех таблиц до и после одинаков, `spy.writes` пуст, каждая таблица в `spy.lists` — ровно 1. Тест — задача 2.
4. **«Сейчас» на настоящих парах.** Отменённая пара не занимает аудиторию; замена — с новым преподавателем; пара, перенесённая на субботу, — в субботу; ровно в минуту начала — «на паре», ровно в минуту конца — уже нет; до семестра, после, в зачётную неделю, без расписания — пометка над таблицей; пара «сейчас» стенда (`dev:lesson`) с временем не по звонку — по своему времени. Тесты — задачи 1 и 2.
5. **Чужие данные и черновики.** В ответах нет `passwordHash` и полей входа (поиск по JSON); отключённого студента нет в списке карточки; проректор не видит черновики силлабусов (`draft`) — ни в числах списка, ни в карточках (как в «Предметах»), но видит «на утверждении» и «возвращён». Тесты — задачи 1 и 2; кнопка «Изменить» у проректора — задача 4.

## Чего в доработке нет

Новых полей и таблиц (оборудование, места, вид аудитории, ответственный — отдельная будущая доработка); правки из карточки, кроме прежнего окна «Изменить»; карточек студентов и сотрудников; режима «по аудитории» на экране «Расписание»; чего-то нового студенту и преподавателю; поиска по новым колонкам (поиск списка — по-прежнему по названию).

## Решения плана, которые видят пользователи

Дизайн решил главное; ниже — то, что он оставил плану. У каждого — вариант по умолчанию; владелец может поправить на приёмке (тексты простыми словами — `owner-summary.md`). Координатор переносит их в таблицу решений `aidlc-state.md` (задача 5).

| № | Решение | Почему |
| --- | --- | --- |
| 1 | **«Сейчас» у группы:** «на паре до 09:30 · ауд. 204» / «следующая в 13:30» / «пары закончились» / «пар нет». **У аудитории:** «занята до 09:30 · 01-1» / «свободна до 13:30» / «свободна до конца дня» / «свободна весь день» | макет А; «пары закончились» и «свободна до конца дня» отличают вечер от пустого дня |
| 2 | Пара занимает 90 минут от **своего** времени начала (как на экране «Расписание»), отменённая — не занимает; пара, закрытая преподавателем раньше, считается до конца 90 минут | просто и предсказуемо; сервер не досчитывает пары в этих запросах |
| 3 | Семестр не идёт — над таблицей спокойная строка: «Семестр начнётся 01.09.2026» / «Семестр закончился 20.12.2026» / «Зачётная неделя: обычных пар нет» / «Расписание ещё не составлено»; колонка «Сейчас» при этом остаётся (обычно «пар нет») | одна строка вместо «—» в каждой строке |
| 4 | «Пар в неделю» — число строк шаблона недели (каждая пара один раз), в том числе пары без аудитории | решение координатора 2 |
| 5 | «Чаще всего» у аудитории — дисциплина с наибольшим числом пар шаблона в этой аудитории и группы, у которых она там идёт; при равенстве — по алфавиту; пар нет — «пар нет» | макет А |
| 6 | Силлабусы в списке «Дисциплины» — счётчики по парам «дисциплина + преподаватель» на текущую половину года: «утверждён · N», «на утверждении · N», «возвращён · N», «черновик · N», «без силлабуса · N» (нулевые не показываются; совсем ничего — «нет»). У проректора черновики не видны (как в «Предметах») | те же состояния, что на экране «Предметы» |
| 7 | В карточке группы «на повторном курсе» — студенты группы (по их нынешней группе) с карточкой повтора в состоянии «идёт»; сдавшие, не сдавшие и отменённые не считаются | «на повторном курсе» значит «сейчас» |
| 8 | В карточке группы — первые 5 активных студентов по алфавиту (ФИО и № билета) и ссылка «Все N студентов» в справочник «Студенты», уже отобранный по группе | макет Б |
| 9 | Сетка аудитории — строки по звонкам из «Настроек семестра» (и номер пары, если у пары он больше числа звонков), столбцы пн–пт, суббота — только если в эту неделю есть пара в субботу. Пустая клетка — «свободна». Отменённая пара — клетка «свободна» и под ней мелко «отменена: 02-1 · Информатика»; замена и перенос — метками «Замена», «Перенос» | решение координатора 2; свободное видно сразу |
| 10 | «Изменить» в карточке открывает **прежнее** окно правки поверх списка справочника; после «Сохранить» или «Отмена» снова карточка (уже с новым названием); «Назад» браузера из карточки ведёт в список | прежнее окно без копии кода |
| 11 | Название в списке — ссылка на карточку; значки «изменить» и «удалить» в строке остаются как были | макет А |
| 12 | Новые адреса: `#/dir/groups/<id>`, `#/dir/rooms/<id>`, `#/dir/disciplines/<id>`; `#/schedule/group/<groupId>`, `#/journal/group/<groupId>`, `#/dir/students/group/<groupId>` | решение координатора 5; прежние адреса — как раньше |
| 13 | Подсказки под заголовками списков: «Группы» — «Названия, курсы и что у группы есть», «Аудитории» — «Кто и когда в аудитории», «Дисциплины» — «Где идёт и какой силлабус» | макет А |

## Откат

База не меняется: ни таблиц, ни колонок, ни строк «Настроек»; новые запросы только читают. Прежний выложенный код тестового журнала — `87d5267`.

- **Прежний сервер, новый сайт** (несколько минут при выкладке или откате, либо откат только сервера): `dir.summary` и `dir.card` прежний сервер не знает — отвечает `bad_request`. Список справочника тогда показывается как раньше (без новых колонок) с одной спокойной строкой «Подробности сейчас недоступны»; карточка — «Не удалось открыть карточку» и «К списку». Это требование задачи 3 и 4, а не случайность.
- **Новый сервер, прежний сайт:** прежний сайт новых запросов не зовёт; всё как раньше.
- **Откат целиком** — обычный порядок из `CLAUDE.md` на `87d5267`; копия базы не нужна для отката (данные не меняются), но `serve:backup` перед выкладкой делается как всегда. Общая проверка (задача 5) запускает прежний код `87d5267` (`git archive` во временную папку сессии) на базе, по которой ходил новый код, и сверяет, что ответы прежних запросов не изменились.

## Файлы

```
core/dirInfo.js              правила: «сейчас», семестр, пар в неделю, чаще всего, состояние и счёт силлабусов   новый
core/permissions.js          + dir.summary, dir.card
backend/dirInfo.js           ответы dir.summary и dir.card                                                     новый
backend/handlers/dir.js      + два действия
site/js/dirInfo.js           помощники без DOM: тексты «сейчас», метки силлабусов, строки сетки, адреса        новый
site/js/views/dirCard.js     карточки группы, аудитории, дисциплины                                           новый
site/js/views/directory.js  directoryConfig.js  journalList.js  schedule.js
site/js/router.js  main.js  shell.js  i18n/{ru,ky,en}.js  css/screens.css
tests/dirInfo.test.js  dirInfoApi.test.js  siteDirInfo.test.js                                              новые
tests/permissions.test.js  router.test.js   (только новые проверки)
```

Кто делает: **Л** — `journal-logic`, **С** — `journal-server`, **Э** — `journal-screens`. Общие файлы правит только задача, которая сейчас в работе.

---

### Task 1 (Л): правила и права

**Files:** Create `core/dirInfo.js`, `tests/dirInfo.test.js`. Modify `core/permissions.js`, `tests/permissions.test.js` (только новые проверки). **Проверка — облегчённая.**

**Interfaces — Consumes:** `minutesOf`, `addMinutes`, `isTime`, `isDate` (`core/dates.js`); `PAIR_MINUTES` (`core/settings.js`); `versionsOf`, `rightsOn` (`core/syllabusFlow.js`); `compareNames` (`core/names.js`).

**Produces:**

```js
export const CARD_TABLES = ['groups', 'rooms', 'disciplines'];
export function pairEnd(pair);                     // addMinutes(pair.startTime, PAIR_MINUTES)
export function nowOf(pairs, today, time);
// pairs — пары одной группы или одной аудитории (любые даты). Берутся пары с date === today, status !== 'cancelled', isTime(startTime);
// порядок: startTime, затем slot, затем id.
// -> { state: 'busy', pair } — startTime <= time < pairEnd (первая такая)
//  | { state: 'next', pair } — нет идущей, есть с startTime > time (самая ранняя)
//  | { state: 'done' }       — сегодня пары были, но все уже кончились
//  | { state: 'none' }       — сегодня пар нет
export function termOf({ settings, extra, today, hasPairs });
// settings — readSettings, extra — readExtra. Первое подходящее: нет semesterStart или semesterEnd — 'none'; today < semesterStart — 'before';
// today > semesterEnd — 'after'; !hasPairs — 'none'; extra.examStart <= today <= extra.examEnd (оба не пустые) — 'exam'; иначе 'on'
export function topOf(items);
// items — [{ disciplineName, groupName }], по одной на строку шаблона недели в аудитории -> null, если пусто;
// иначе { disciplineName, groupNames }: дисциплина с наибольшим числом строк (равенство — compareNames по названию),
// groupNames — её группы без повторов, compareNames
export function syllabusState(syllabi, { disciplineId, teacherId, semester }, viewer);
// viewer — { id, roles }. versionsOf -> { approved: approved !== null, open: open && rightsOn(open, { ...viewer, teaches: false }).see ? open.status : null }
export function syllabusCounts(states);
// states — [{ approved, open }] -> { approved, review, returned, draft, none }: approved — approved === true; review / returned / draft — по open;
// none — !approved && open === null. Одно состояние может попасть и в approved, и в review/returned/draft.
```

Права (`core/permissions.js`, рядом с `dir.list`): `'dir.summary'` и `'dir.card'` — `{ admin: CARD, dean: CARD, prorector: CARD }`, где `CARD = ['groups', 'rooms', 'disciplines']` (своя константа в `permissions.js`, как `LIST_TABLES`).

- [ ] **Step 1: тесты** (`tests/dirInfo.test.js`):

```js
const P = (id, date, startTime, over = {}) => ({ id, date, slot: 1, startTime, status: 'planned', ...over });
const day = [P('a', '2026-09-15', '08:00'), P('b', '2026-09-15', '09:40'), P('c', '2026-09-15', '11:20', { status: 'cancelled' }), P('d', '2026-09-16', '08:00')];
const st = (time, pairs = day) => { const r = nowOf(pairs, '2026-09-15', time); return r.pair ? [r.state, r.pair.id] : [r.state]; };
assert.deepEqual([st('07:59'), st('08:00'), st('09:29'), st('09:30'), st('09:40'), st('11:10'), st('11:30')],
  [['next', 'a'], ['busy', 'a'], ['busy', 'a'], ['next', 'b'], ['busy', 'b'], ['done'], ['done']]);   // 11:20 отменена — не идёт
assert.deepEqual(st('12:00', [P('c', '2026-09-15', '11:20', { status: 'cancelled' })]), ['none']);
assert.deepEqual(st('12:00', []), ['none']);
assert.deepEqual(st('10:00', [P('x', '2026-09-15', '09:55')]), ['busy', 'x']);                           // время не по звонку (стенд dev:lesson)
assert.deepEqual(st('10:00', [P('y', '2026-09-15', '')]), ['none']);                                    // испорченное время пропускается
assert.equal(pairEnd(P('a', '2026-09-15', '11:20')), '12:50');
const S = { semesterStart: '2026-09-01', semesterEnd: '2026-12-20' };
const X = { examStart: '2026-12-14', examEnd: '2026-12-20' };
const term = (today, over = {}) => termOf({ settings: S, extra: X, today, hasPairs: true, ...over });
assert.deepEqual([term('2026-08-31'), term('2026-09-01'), term('2026-12-13'), term('2026-12-14'), term('2026-12-20'), term('2026-12-21')],
  ['before', 'on', 'on', 'exam', 'exam', 'after']);
assert.equal(term('2026-10-01', { hasPairs: false }), 'none');
assert.equal(term('2026-10-01', { settings: { semesterStart: '', semesterEnd: '' } }), 'none');
assert.equal(term('2026-12-15', { extra: { examStart: '', examEnd: '' } }), 'on');
assert.equal(topOf([]), null);
assert.deepEqual(topOf([{ disciplineName: 'Информатика', groupName: '02-1' }, { disciplineName: 'Анатомия', groupName: '01-1' },
  { disciplineName: 'Информатика', groupName: '01-1' }, { disciplineName: 'Информатика', groupName: '02-1' }]), { disciplineName: 'Информатика', groupNames: ['01-1', '02-1'] });
assert.deepEqual(topOf([{ disciplineName: 'Информатика', groupName: '01-1' }, { disciplineName: 'Анатомия', groupName: '02-1' }]), { disciplineName: 'Анатомия', groupNames: ['02-1'] });
const Y = (status, version, over = {}) => ({ id: 'y' + version, disciplineId: 'd', teacherId: 't', semester: 1, status, version, ...over });
const key = { disciplineId: 'd', teacherId: 't', semester: 1 };
const dean = { id: 'u', roles: ['dean'] };
const pro = { id: 'p', roles: ['prorector'] };
assert.deepEqual(syllabusState([Y('approved', 1), Y('returned', 2)], key, dean), { approved: true, open: 'returned' });
assert.deepEqual(syllabusState([Y('draft', 1)], key, dean), { approved: false, open: 'draft' });
assert.deepEqual(syllabusState([Y('draft', 1)], key, pro), { approved: false, open: null });
assert.deepEqual(syllabusState([Y('review', 1)], key, pro), { approved: false, open: 'review' });
assert.deepEqual(syllabusState([Y('approved', 1, { semester: 2 })], key, dean), { approved: false, open: null });
assert.deepEqual(syllabusCounts([{ approved: true, open: 'returned' }, { approved: false, open: 'draft' }, { approved: false, open: null }, { approved: false, open: 'review' }]),
  { approved: 1, review: 1, returned: 1, draft: 1, none: 1 });
assert.deepEqual(syllabusCounts([]), { approved: 0, review: 0, returned: 0, draft: 0, none: 0 });
```

`tests/permissions.test.js` (новый `test`): для `dir.summary` и `dir.card` — `can(['admin'|'dean'|'prorector'], action, 'groups'|'rooms'|'disciplines')` — `true`; `can(['dean'], action, 'students')`, `'staff'`, `'weekTemplate'`, `undefined`, `['groups']` — `false`; `can(['teacher'], action, 'groups')`, `can(['student'], action, 'groups')` — `false`; `listPermissions(['prorector'])` содержит `'dir.card:rooms'`. Прежние `deepEqual` списков прав преподавателя и студента не меняются (новых прав у них нет).

- [ ] **Step 2:** `node --test tests/dirInfo.test.js tests/permissions.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: rules of the directory details - now, the term, pairs a week, the busiest discipline, syllabus states; rights of dir.summary and dir.card`.

---

### Task 2 (С): запросы `dir.summary` и `dir.card`

**Files:** Create `backend/dirInfo.js`, `tests/dirInfoApi.test.js`. Modify `backend/handlers/dir.js` (два действия в `dirHandlers`). **Проверка — строгая** (права, данные студентов; Review Focus 1–5).

**Interfaces — Consumes:** задача 1 целиком; `readSettings`, `readExtra` (`core/settings.js`); `localDate`, `localTime`, `isDate`, `mondayOf`, `addDays` (`core/dates.js`); `isSubstitution` (`core/schedule.js`); `compareNames`.

**Produces:**

```js
// backend/dirInfo.js. user — пользователь запроса ({ id, roles }). Каждая таблица — один store.list; ничего не пишется.
export function dirSummary(store, platform, user, table);
export function dirCard(store, platform, user, { table, id, from });
// backend/handlers/dir.js:
'dir.summary': (data, ctx, user) => dirSummary(ctx.store, ctx.platform, user, data.table),
'dir.card': (data, ctx, user) => dirCard(ctx.store, ctx.platform, user, data),
```

Проверки входа (в обеих функциях, в этом порядке): `table` не из `CARD_TABLES` — `bad_request` (до обработчика это уже отсекают права, проверка на всякий случай); в `dir.card`: `id` не строка или `''` — `bad_request`; запись ищется `rows.find((r) => r.id === id)` (никогда по ключу объекта), нет — `not_found`; `from`: `undefined` — `mondayOf(today)`, не `isDate` — `bad_request`, иначе `mondayOf(from)`; у групп и дисциплин `from` не читается.

Общие поля: `today = localDate(now)`, `time = localTime(now)`; `term = termOf({ settings, extra, today, hasPairs: pairs.length > 0 })`; `semesterStart`, `semesterEnd` — из `readSettings`. «Пар в неделю» — число строк «Шаблона недели», чей предмет (`subjectId`) у этой группы / чья `roomId` — эта аудитория / чей предмет — этот предмет. Названия дисциплины — `disciplines` по `disciplineId`, нет — `subject.name`. Все списки имён — `compareNames`.

**Ответы** (ровно эти ключи; строки собираются по полям):

```js
// dir.summary, groups — таблицы: groups, students, subjects, disciplines, weekTemplate, pairs, settings, rooms
{ table: 'groups', today, time, term, semesterStart, semesterEnd,
  rows: [{ id, students /* активных */, inactive, disciplines: ['Анатомия', 'Информатика'], weekPairs,
           now: { state: 'busy', until, roomName, subjectName } | { state: 'next', at, roomName, subjectName } | { state: 'done' } | { state: 'none' } }] }
// dir.summary, rooms — rooms, weekTemplate, subjects, disciplines, groups, pairs, settings
{ table: 'rooms', today, time, term, semesterStart, semesterEnd,
  rows: [{ id, weekPairs, top: { disciplineName, groupNames } | null,
           now: { state: 'busy', until, groupName, subjectName } | { state: 'free', until } | { state: 'freeRest' } | { state: 'freeDay' } }] }
// nowOf -> аудитория: busy -> busy; next -> free (until = pair.startTime); done -> freeRest; none -> freeDay
// dir.summary, disciplines — disciplines, subjects, staff, groups, syllabi, settings
{ table: 'disciplines', currentSemester,
  rows: [{ id, teachers: [{ teacherId, teacherName, groupNames }], syllabi: { approved, review, returned, draft, none } }] }
// teachers — по преподавателям предметов этой дисциплины (compareNames по ФИО); syllabi — syllabusCounts по syllabusState каждого «дисциплина + преподаватель»

// dir.card, groups — groups, students, subjects, disciplines, staff, syllabi, weekTemplate, pairs, settings, rooms, repeats
{ table: 'groups', today, time, term, semesterStart, semesterEnd,
  group: { id, name, course },
  counts: { students, inactive, subjects, weekPairs, repeats },
  now: /* как в списке групп */,
  subjects: [{ subjectId, disciplineId, disciplineName, teacherId, teacherName, syllabus: { approved, open }, weekPairs }],   // по disciplineName
  students: [{ id, fullName, cardNo }] }                                                                                      // только активные, по fullName
// repeats — число разных активных и неактивных студентов этой группы (students.groupId) с карточкой «Повторного курса» в состоянии 'open'
// dir.card, rooms — rooms, weekTemplate, pairs, settings, groups, subjects, staff
{ table: 'rooms', today, time, term, semesterStart, semesterEnd,
  room: { id, name }, weekPairs, now: /* как в списке аудиторий */,
  from, to /* from + 6 */, bells /* settings.bells */, exam: { start: extra.examStart, end: extra.examEnd }, holidays /* даты недели из settings.holidays */,
  pairs: [{ id, date, slot, startTime, endTime, status, groupId, groupName, subjectName, teacherName, substitution, moved, planDate, planSlot }] }
// pairs — этой аудитории с from по to, включая отменённые; по date, slot, groupName. substitution — isSubstitution(pair, subject); moved — date !== planDate || slot !== planSlot
// dir.card, disciplines — disciplines, subjects, groups, staff, syllabi, weekTemplate, settings
{ table: 'disciplines', currentSemester, discipline: { id, name },
  rows: [{ subjectId, groupId, groupName, teacherId, teacherName, syllabus: { approved, open }, weekPairs }] }               // по groupName
```

- [ ] **Step 1: тесты** (`tests/dirInfoApi.test.js`, на `setup()` из `tests/journalSetup.js`). Помощник файла `rooms(s)`: вставить аудитории `А-204` (rA), `Б-101` (rB), `В-305` (rC); строке шаблона `sb1` поставить `roomId: rA`, строке `sb2` — `rB`, добавить строку `{ weekday: 4, slot: 2, subjectId: sb1, roomId: rA }`; всем парам `sb1` — `roomId: rA`, `sb2` — `rB` (`store.updateMany`). Сдвиг пары на субботу: пара `sb2` от `2026-09-18` → `{ date: '2026-09-19', slot: 2, startTime: '09:40' }`.

```js
s.at('2026-09-15', '08:30');                                    // вторник, идёт p0915 (замена teacher3)
const g = call('dir.summary', { table: 'groups' }, t.dean).data;
assert.deepEqual([g.today, g.time, g.term], ['2026-09-15', '08:30', 'on']);
assert.deepEqual(byId(g.rows, g1), { id: g1, students: 3, inactive: 1, disciplines: ['Информатика'], weekPairs: 2,
  now: { state: 'busy', until: '09:30', roomName: 'А-204', subjectName: 'Информатика' } });
assert.deepEqual(byId(g.rows, g2).now, { state: 'none' });
const r = call('dir.summary', { table: 'rooms' }, t.dean).data;
assert.deepEqual(byId(r.rows, rA), { id: rA, weekPairs: 2, top: { disciplineName: 'Информатика', groupNames: ['01-1'] }, now: { state: 'busy', until: '09:30', groupName: '01-1', subjectName: 'Информатика' } });
assert.deepEqual(byId(r.rows, rC), { id: rC, weekPairs: 0, top: null, now: { state: 'freeDay' } });
```

`byId(rows, id)` — помощник файла (`rows.find((r) => r.id === id)`). Ещё в этом файле:
- `s.at('2026-09-15', '07:30')` → группа `{ state: 'next', at: '08:00', roomName: 'А-204', subjectName: 'Информатика' }`, rA `{ state: 'free', until: '08:00' }`; `'09:30'` → группа `done`, rA `freeRest`; `'2026-09-16'` → группа `none`, rA `freeDay`.
- Отменённая: `store.update('pairs', p0922, { status: 'cancelled' })`, `s.at('2026-09-22', '08:30')` → группа `none`, rA `freeDay`; в `dir.card` rA за неделю `2026-09-21` пара `p0922` есть со `status: 'cancelled'`.
- Суббота: `s.at('2026-09-19', '10:00')` → g2 `{ state: 'busy', until: '11:10', roomName: 'Б-101', subjectName: 'Анатомия' }`; `dir.card` rB `{ from: '2026-09-16' }` → `from: '2026-09-14'`, `to: '2026-09-20'`, пара на `2026-09-19` с `moved: true`, `planDate: '2026-09-18'`.
- Семестр: `s.at('2026-08-31')` → `term: 'before'`; `s.at('2026-12-21')` → `'after'`; строки «Настроек» `extraToRows({ examStart: '2026-12-14', examEnd: '2026-12-20', collegeName: '' })` и `s.at('2026-12-15')` → `'exam'`; все пары удалены (`store.removeMany`) → `'none'`, у всех групп `now: { state: 'none' }`.
- Дисциплины: `dir.summary` деканату → ds1 `{ id: ds1, teachers: [{ teacherId: ids.teacher1, teacherName: 'Иванова Нургуль', groupNames: ['01-1'] }], syllabi: { approved: 1, review: 0, returned: 0, draft: 0, none: 0 } }`; вставить силлабус `{ disciplineId: ds2, teacherId: ids.teacher2, semester: 1, planSemester: 1, status: 'draft', version: 1 }` → ds2 у деканата `draft: 1, none: 0`, у проректора `draft: 0, none: 1`; `dir.card` ds2 проректору — `syllabus: { approved: false, open: null }`.
- Карточка группы g1 (`s.at('2026-09-15', '08:30')`): `counts` `{ students: 3, inactive: 1, subjects: 1, weekPairs: 2, repeats: 0 }`; `s.repeatCard()` (a2, `open`) → `repeats: 1`; вторая карточка того же студента `{ status: 'passed' }` и карточка a1 `{ status: 'cancelled' }` → по-прежнему 1. `students` — три активных, без a4, каждый ровно с ключами `['id', 'fullName', 'cardNo']`, порядок — `compareNames` по ФИО; `subjects` — `[{ subjectId: sb1, disciplineId: ds1, disciplineName: 'Информатика', teacherId: ids.teacher1, teacherName: 'Иванова Нургуль', syllabus: { approved: true, open: null }, weekPairs: 2 }]`. В JSON ответа нет `passwordHash`, `mustChangePassword`, `lang` и ФИО a4 (`'Яковлев Улан'`).
- Карточка аудитории rA с `from: '2026-09-16'`: `bells` — `DEFAULT_BELLS`, `exam: { start: '', end: '' }`, `holidays: []`, одна пара `p0915` с `substitution: true`, `teacherName: 'Сидорова Алина'`, ключи пары — ровно перечисленные в «Ответах».
- Карточка дисциплины ds1: `rows` — `[{ subjectId: sb1, groupId: g1, groupName: '01-1', teacherId: ids.teacher1, teacherName: 'Иванова Нургуль', syllabus: { approved: true, open: null }, weekPairs: 2 }]`.
- **Обход (Review Focus 1, 2):** для обоих действий и всех трёх таблиц — `t.a1` (студент), `t.teacher1` → `forbidden`; без токена → `unauthorized`; `t.dean` (у него `dean,teacher`) и `t.prorector` → `ok`; `table` из списка Review Focus 1 → `forbidden`; `dir.card` с `id` из Review Focus 2 → `bad_request` / `not_found` как там сказано; `from` `'2026-13-01'`, `5`, `''` → `bad_request`. Ни один ответ не `internal`. Удалённая запись: `dir.remove` аудитории rC деканатом → `dir.card` rC → `not_found`.
- **Ничего не пишется и читается по разу (Review Focus 3):** `s.running(p0915, '2026-09-15 08:05:00')`, `s.at('2026-09-15', '08:30')`; для каждого из шести вызовов: `before = s.snapshot()`, `s.spy.reset()`, вызов, затем `deepEqual(s.snapshot(), before)`, `deepEqual(s.spy.writes, {})`, каждое значение `s.spy.lists` равно 1.
- **Прежние ответы:** `call('dir.list', { table }, t.dean).data` для трёх таблиц — `deepEqual` с `{ rows: store.list(table) }` (как и раньше, без новых ключей); `call('dir.save', { table: 'groups', row: { id: g1, name: 'x', course: 1 } }, t.prorector).error.code === 'forbidden'`.
- **Скорость на данных стенда:** стенд как в `tests/seedRepeat.test.js` (`seed(store, platform)`, `TODAY = '2026-11-18'`, 12:00 — среда). Шесть вызовов деканатом, каждый короче 1000 мс (`performance.now()`), `spy.lists` — по 1. Числа стенда: группа 02-1 — `students: 22, inactive: 0, weekPairs: 3, disciplines: ['Анатомия', 'Информатика']`, в карточке `counts.repeats: 3` (четыре карточки сида: три `open`, одна `passed`); аудитория `101` — `weekPairs: 6`, `top: { disciplineName: 'Анатомия', groupNames: ['01-1', '02-1', '03-1'] }`, `now: { state: 'busy', until: '12:50', groupName: '03-1', subjectName: 'Анатомия' }`; `204` — `weekPairs: 3`, `now: { state: 'freeDay' }`; `305` — `weekPairs: 0`, `top: null`; «Информатика» деканату — `syllabi: { approved: 1, review: 0, returned: 1, draft: 1, none: 0 }`, проректору — `{ approved: 1, review: 0, returned: 1, draft: 0, none: 1 }`; «Анатомия» — `{ approved: 0, review: 1, returned: 0, draft: 0, none: 0 }`. Если число стенда не сходится — остановиться и написать в отчёте (сверка плана проверяет их заранее).

- [ ] **Step 2:** `node --test tests/dirInfoApi.test.js` падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5:** коммит `feat: dir.summary and dir.card - what the journal knows about a group, a room and a discipline, read-only`.

---

### Task 3 (Э): колонки списков, адреса, «сразу на группе» — блок владельца

**Files:** Create `site/js/dirInfo.js`, `tests/siteDirInfo.test.js`. Modify `site/js/views/directory.js`, `site/js/views/directoryConfig.js`, `site/js/views/journalList.js`, `site/js/views/schedule.js`, `site/js/router.js`, `site/js/shell.js`, `site/js/i18n/{ru,ky,en}.js`, `site/css/screens.css`, `tests/router.test.js` (только новые проверки). **Проверка ИИ — нет** (владелец принимает блоком).

**Interfaces — Consumes:** ответы `dir.summary` задачи 2.

**Produces** (`site/js/dirInfo.js`, без DOM):

```js
export const CARD_TABLES = ['groups', 'rooms', 'disciplines'];
export const cardHref = (table, id) => '#/dir/' + table + '/' + encodeURIComponent(id);
export function infoById(summary);          // null -> null; иначе Map(id -> строка rows)
export function groupNowLabel(now);         // -> { key, params, tone }
// busy: roomName ? 'dir.now.busy' { until, room } : 'dir.now.busyNoRoom' { until }, 'success'; next: roomName ? 'dir.now.next' { at, room } : 'dir.now.nextNoRoom' { at }, 'info';
// done: 'dir.now.done', 'neutral'; none: 'dir.now.none', 'neutral'
export function roomNowLabel(now);          // busy: 'dir.room.busy' { until, group }, 'warning'; free: 'dir.room.free' { until }, 'success';
                                            // freeRest: 'dir.room.freeRest', 'success'; freeDay: 'dir.room.freeDay', 'success'
export function syllabusCountBadges(c);     // [{ key, count, tone }]: approved 'success', review 'info', returned 'warning', draft 'neutral', none 'danger' — только > 0;
                                            // все пять нулевые -> [{ key: 'dir.syllabi.nothing', count: 0, tone: 'neutral' }]
export function termNote(summary);          // term 'on' -> null; 'before' -> { key: 'dir.term.before', params: { date: semesterStart } }; 'after' -> 'dir.term.after' { date: semesterEnd };
                                            // 'exam' -> { key: 'dir.term.exam' }; 'none' -> { key: 'dir.term.none' }
```

Адреса (`site/js/router.js`; прежние адреса дают прежние `params`, `tests/router.test.js` это уже проверяет):

| Адрес | Право | Ответ |
| --- | --- | --- |
| `#/dir/<groups\|rooms\|disciplines>/<id>/edit` | `dir.save:<table>` | `{ view: 'directory', params: { table, editId: id } }` |
| `#/dir/students/group/<groupId>` | `dir.list:students` | `{ view: 'directory', params: { table: 'students', groupId } }` |
| `#/schedule/group/<groupId>` | `schedule.list` | `{ view: 'schedule', params: { groupId } }` |
| `#/journal/group/<groupId>` | `journal.list` | `{ view: 'journalList', params: { groupId } }` |

id и groupId — через `idOf` (испорченная `%`-последовательность → адрес не найден, главная).

Экраны:

- **Список справочника** (`directory.js`): у `groups`, `rooms`, `disciplines` в `DIRECTORIES` — `card: true` и `extra` (`groups: ['students', 'disciplines', 'weekPairs', 'now']`, `rooms: ['weekPairs', 'top', 'now']`, `disciplines: ['teachers', 'syllabi']`). Загрузка: `dir.list` и (если `can('dir.summary', table)`) `dir.summary` параллельно; **ошибка одного `dir.summary` не ломает список**: колонки `extra` не рисуются, над таблицей `note('info', t('dir.info.unavailable'))` (раздел «Откат»). Ячейки: «Студентов» — число и, если `inactive > 0`, мелко «(N откл.)»; «Предметы» — названия через запятую или приглушённое «нет»; «Пар в неделю» — число (`num`); «Сейчас» — `badge` с точкой по `groupNowLabel` / `roomNowLabel`; «Чаще всего» — «01-1, 02-1 · Информатика» или приглушённое «пар нет»; «Группы и преподаватели» — по строке на преподавателя «01-1, 02-1 — ФИО» (вторая и дальше — приглушённо, как в макете) или «нигде не идёт»; «Силлабусы» — метки `syllabusCountBadges`. Заголовок колонки «Сейчас» — `t('dir.col.now', { time })`. `termNote` — над таблицей `note('info', …)`. Название записи в строке — ссылка `cardHref(table, id)` (если `can('dir.card', table)`; адрес карточки появляется в задаче 4, до неё ссылка ведёт на главную), значки правки и удаления остаются. Поиск — как раньше, только по прежним колонкам. На 1366 px таблица без горизонтальной прокрутки страницы (длинные «Предметы» и «Группы и преподаватели» переносятся).
- **`params.editId`** (`directory.js`): когда строки загружены, один раз на это значение: запись есть — открыть прежнее окно правки с `d.back = cardHref(table, id)`; нет — `location.replace('#/dir/' + table)`. Каждый выход из такого окна (Отмена, Esc, после успешного сохранения) — `location.replace(d.back)`.
- **`params.groupId`** (`directory.js` у `students`, `journalList.js`, `schedule.js`): применяется один раз на значение адреса (`state.askedGroup`): «Студенты» — `state.groupFilter = groupId`; «Журналы» — выбранная группа; «Расписание» — режим «группа», эта группа, неделя «сегодня» (поверх сохранённого вида `kept`; неизвестная группа — как раньше, первая). Смена группы на экране адрес не меняет; прежние адреса без группы ведут себя как раньше.
- `shell.js` `currentName`: `dirCard` → `params.table`.

Словари (ru; ky и en — свои переводы тех же ключей; kyrgyz — на вычитку): `dir.col.students` «Студентов», `dir.col.disciplines` «Предметы», `dir.col.weekPairs` «Пар в неделю», `dir.col.now` «Сейчас, {time}», `dir.col.top` «Чаще всего», `dir.col.teachers` «Группы и преподаватели», `dir.col.syllabi` «Силлабусы», `dir.inactiveShort` «({count} откл.)», `dir.none` «нет», `dir.noPairs` «пар нет», `dir.nowhere` «нигде не идёт», `dir.now.busy` «на паре до {until} · ауд. {room}», `dir.now.busyNoRoom` «на паре до {until}», `dir.now.next` «следующая в {at} · ауд. {room}», `dir.now.nextNoRoom` «следующая в {at}», `dir.now.done` «пары закончились», `dir.now.none` «пар нет», `dir.room.busy` «занята до {until} · {group}», `dir.room.free` «свободна до {until}», `dir.room.freeRest` «свободна до конца дня», `dir.room.freeDay` «свободна весь день», `dir.syllabi.approved` «утверждён · {count}», `dir.syllabi.review` «на утверждении · {count}», `dir.syllabi.returned` «возвращён · {count}», `dir.syllabi.draft` «черновик · {count}», `dir.syllabi.none` «без силлабуса · {count}», `dir.syllabi.nothing` «нет», `dir.term.before` «Семестр начнётся {date}.», `dir.term.after` «Семестр закончился {date}.», `dir.term.exam` «Зачётная неделя: обычных пар нет.», `dir.term.none` «Расписание ещё не составлено.», `dir.info.unavailable` «Подробности сейчас недоступны: показан обычный список.». Новые тексты подсказок — решение плана 13 (`dir.groups.hint`, `dir.rooms.hint`, `dir.disciplines.hint`). Дата `{date}` — тем же помощником, которым экран «Настройки семестра» показывает даты.

- [ ] **Step 1: тесты.** `tests/siteDirInfo.test.js`: все ветки `groupNowLabel`, `roomNowLabel`, `termNote`; `syllabusCountBadges({ approved: 1, review: 0, returned: 1, draft: 0, none: 2 })` → `[{ key: 'dir.syllabi.approved', count: 1, tone: 'success' }, { key: 'dir.syllabi.returned', count: 1, tone: 'warning' }, { key: 'dir.syllabi.none', count: 2, tone: 'danger' }]`; все нули → `[{ key: 'dir.syllabi.nothing', count: 0, tone: 'neutral' }]`; `cardHref('groups', 'g 1')` → `'#/dir/groups/g%201'`; `infoById(null) === null`. `tests/router.test.js`: четыре строки таблицы адресов с правом и без права (без права — главная), `%E0%A4%A` вместо id — главная, `#/dir/students` и `#/schedule` и `#/journal` — прежние `params` (`{ table: 'students' }`, `{}`, `{}`), `#/dir/staff/group/x` — главная.
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5: стенд.** `npm run dev:lesson` (своя пара «Информатики» 01-1 идёт сейчас). Скриншоты headless Chrome 1366×768 в `.superpowers/sdd/plan-spravochniki/task-3-shots/`: три списка деканатом в тёмной и светлой теме; «Расписание группы» и «Журналы» по адресам с группой 02-1; «Студенты» по адресу с группой; список групп проректором (без значков правки). Остановить свой стенд по своему PID.
- [ ] **Step 6:** коммит `feat: directory lists show students, subjects, pairs a week, now, the busiest discipline and syllabi; schedule, journals and students open on a group`.

---

### Task 4 (Э): карточки — блок владельца, остановка

**Files:** Create `site/js/views/dirCard.js`. Modify `site/js/dirInfo.js` (помощники сетки), `site/js/router.js` (адрес карточки), `site/js/main.js` (`VIEWS.dirCard`), `site/js/i18n/{ru,ky,en}.js`, `site/css/screens.css`, `tests/siteDirInfo.test.js`, `tests/router.test.js`. **Проверка ИИ — строгая** (список студентов, кнопка проректора).

**Interfaces — Consumes:** ответы `dir.card` задачи 2; `cardHref`, `groupNowLabel`, `roomNowLabel`, `termNote` задачи 3; `weekNav`, `dayMonth`, `flagBadge` (`site/js/views/pairParts.js`); `pairFlags` (`site/js/pairs.js`).

**Produces** (`site/js/dirInfo.js`):

```js
export function syllabusBadges(syllabus);    // [{ key, tone }]: approved -> 'home.syllabusState.approved' 'success'; open -> 'home.syllabusState.<open>'
                                             // (review 'info', returned 'warning', draft 'neutral'); ни того ни другого -> [{ key: 'home.syllabusState.none', tone: 'danger' }]
export function gridRows(bells, pairs);      // [{ slot, time }]: slot 1…bells.length со временем звонка, и номера пар больше этого (время — startTime первой такой пары)
export function gridDates(pairs, from);      // пн–пт всегда, суббота и воскресенье — только если в этот день есть пара
export function cellOf(pairs, date, slot);   // { live: [неотменённые], cancelled: [отменённые] } этой клетки
export const FIRST_STUDENTS = 5;
```

Экран `dirCard` (`#/dir/<table>/<id>`; `render(root, params)`, `leave()`, состояние как у прочих экранов, гонка ответов — `ticket`):

- Шапка: хлебные крошки «Справочники › Группы › 02-1» (ссылка на `#/dir/<table>`), заголовок `dir.card.<table>.title` с названием, подзаголовок. Кнопки справа — только при праве: группа — «Расписание группы» (`schedule.list`, `#/schedule/group/<id>`), «Журнал группы» (`journal.list`, `#/journal/group/<id>`); дисциплина — «Предметы» (`subjects.overview`, `#/subjects`); у всех трёх — «Изменить» (только `dir.save:<table>`; у проректора её нет), по нажатию `location.replace(cardHref(table, id) + '/edit')`.
- **Группа:** четыре плитки с числами — студентов (и мелко «N отключено», если есть), предметов, пар в неделю, на повторном курсе (`tCount`); строка «сейчас» (`groupNowLabel`) и `termNote`; таблица «Предметы» — дисциплина, преподаватель, `syllabusBadges`, пар в неделю; блок «Студенты» — первые `FIRST_STUDENTS` (ФИО и № билета) и ссылка «Все N студентов» на `#/dir/students/group/<id>` (если `dir.list:students`); активных нет — «Студентов нет».
- **Аудитория:** подзаголовок «N пар в неделю · сейчас …» (`roomNowLabel`); `termNote`; блок «Неделя» с `weekNav` (стрелки и «Эта неделя», `from` уходит в `dir.card`, `null` — неделя сегодня) и таблицей-сеткой: строки `gridRows`, столбцы `gridDates` с днём и датой, сегодня отмечено, день зачётной недели и выходной (`holidays`) — метками; клетка с парой — группа, дисциплина, преподаватель и метки `flagBadge` (замена, перенос); пустая — приглушённое «свободна»; отменённая — «свободна» и под ней мелко «отменена: 02-1 · Информатика». Таблица прокручивается внутри своей карточки, страница на 1366 px — нет.
- **Дисциплина:** таблица «Где идёт» — группа, преподаватель, `syllabusBadges` и ссылка «Силлабус» на `#/syllabus/<subjectId>` (если `syllabus.get`), пар в неделю; пусто — «Дисциплина пока нигде не идёт».
- Ошибки: `not_found` — `emptyState` с `t('error.not_found')` и ссылкой «К списку»; другая ошибка — её текст, «Повторить» и «К списку» (сюда же попадает прежний сервер, раздел «Откат»).

Словари (ru): `dir.card.groups.title` «Группа {name}», `dir.card.rooms.title` «Аудитория {name}», `dir.card.disciplines.title` «{name}», `dir.card.course` «{course} курс», `dir.card.crumbs` «Справочники», `dir.card.schedule` «Расписание группы», `dir.card.journal` «Журнал группы», `dir.card.subjectsLink` «Предметы», `dir.card.toList` «К списку», плитки с числом — `dir.card.students`, `dir.card.subjects`, `dir.card.weekPairs`, `dir.card.repeats` (по четыре формы: «студент / студента / студентов», «предмет …», «пара в неделю …», «на повторном курсе»), `dir.card.inactive` «{count} отключено», `dir.card.subjectsTitle` «Предметы», `dir.card.studentsTitle` «Студенты», `dir.card.allStudents` (формы: «Все {count} студента ›» …), `dir.card.noStudents` «Студентов нет», `dir.card.week` «Неделя», `dir.card.free` «свободна», `dir.card.cancelledPair` «отменена: {group} · {subject}», `dir.card.holiday` «выходной», `dir.card.where` «Где идёт», `dir.card.nowhere` «Дисциплина пока нигде не идёт», `dir.card.syllabusLink` «Силлабус», `dir.card.roomLead` «{pairs} · сейчас {now}», колонки — `dir.card.col.discipline`, `.teacher`, `.syllabus`, `.weekPairs`, `.group`.

- [ ] **Step 1: тесты.** `tests/siteDirInfo.test.js`: `syllabusBadges({ approved: true, open: 'returned' })` → две метки по порядку; `{ approved: false, open: null }` → `none`; `gridRows(['08:00', '09:40'], [{ slot: 3, startTime: '11:20' }, { slot: 1, startTime: '08:00' }])` → `[{ slot: 1, time: '08:00' }, { slot: 2, time: '09:40' }, { slot: 3, time: '11:20' }]`; `gridDates` с парой в субботу — 6 дат, без — 5; `cellOf` делит отменённые. `tests/router.test.js`: `#/dir/groups/g1` деканату — `{ view: 'dirCard', params: { table: 'groups', id: 'g1' } }`, без права `dir.card:groups` — главная, `#/dir/students/x` — главная.
- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** `npm test`, `npm run build:gas`.
- [ ] **Step 5: стенд.** `npm run dev:lesson`. Скриншоты 1366×768 обеих тем в `.superpowers/sdd/plan-spravochniki/task-4-shots/`: карточка группы 02-1 (повтор 3) деканатом и проректором (без «Изменить»); карточка 01-1 («на паре» сейчас); аудитория 204 — эта неделя (пара «сейчас») и следующая (отменённая пара 02-1 в понедельник); аудитория 101 — следующая неделя (замена в четверг, выходной в среду); аудитория 305; дисциплина «Информатика»; адрес с неизвестным id; «Изменить» → окно → «Отмена» → снова карточка. Остановить свой стенд по своему PID.
- [ ] **Step 6:** коммит `feat: cards of a group, a room and a discipline - numbers, subjects, students, the week of a room`.
- [ ] **Step 7 (координатор): приёмка блока.** Координатор смотрит 1–2 скриншота, поднимает `journal-dev-lesson`, входит как `dean` и даёт владельцу список «что посмотреть» из `owner-summary.md` (раздел 3). Замечания владельца — круг исправлений тому же агенту.

---

### Task 5 (координатор и владелец): общая проверка, выкладка на тестовый

- [ ] **Step 1: общая проверка** — opus, строго, диапазон от коммита плана до `HEAD`, по Review Focus 1–5, пробными скриптами во временной папке сессии: оба действия каждой ролью и без входа, каждой таблицей и плохими `table` / `id` / `from`; снимок всех таблиц до и после каждого вызова и счёт `list` на данных стенда; поиск `passwordHash`, `mustChangePassword` и ФИО неактивных во всех ответах; «сейчас» в минуту начала и конца пары, в субботу, в зачётную неделю, до и после семестра; черновики у проректора; `dir.list` и прочие прежние ответы — те же, что на `41d110a` (сравнить ответы прежнего и нового кода на одной базе стенда); прежний код `87d5267` (`git archive` во временную папку) на той же базе — прежние запросы отвечают как раньше, новые — `bad_request`, новый сайт в этом случае показывает обычный список (раздел «Откат»); прежние тесты без правок, кроме названных в отчётах задач; `npm run build:gas`; строки `minor (deferred)` журнала хода. Находки — в `.superpowers/sdd/plan-spravochniki/final-fix-brief.md` (если проверяющий не может писать файлы — сохраняет координатор).
- [ ] **Step 2:** одна волна исправлений **одним** агентом; повторная проверка тем же проверяющим — только этих правок.
- [ ] **Step 3:** новые кыргызские ключи (`dir.col.*`, `dir.now.*`, `dir.room.*`, `dir.syllabi.*`, `dir.term.*`, `dir.info.*`, `dir.card.*`, `dir.inactiveShort`, `dir.none`, `dir.noPairs`, `dir.nowhere`, новые `dir.*.hint`) — в список на вычитку. Стенд остановить.
- [ ] **Step 4:** решения 1–13 раздела «Решения плана» (с поправками владельца) — в таблицу решений `aidlc-state.md`; `design.md` — статус «собрано»; `CLAUDE.md` — строка о карточках справочников и адресах «сразу на группе»; копия журнала хода — `aidlc-docs/construction/spravochniki/sdd/ledger-snapshot.md`.
- [ ] **Step 5 (только по прямой просьбе владельца): выкладка на тестовый.** В папке сервера: `npm run serve:backup` → `npm run serve:stop` → `git -C "D:\Журнал колледжа — сервер" checkout --detach <принятый коммит>` → `npm run serve:start` → `npm run serve:status` («работает») → `git push`. Выложенный и прежний (`87d5267`) коммиты — в `aidlc-state.md`, раздел «Выкладка», с абзацем из раздела «Откат». **Назад** — тот же порядок на `87d5267`, сайт — коммитом-откатом (`git revert`), не `push --force`. **Боевой не трогаем:** тег образа айтишнику не называется, пока владелец не проверит тестовый и не попросит сам.
- [ ] **Step 6: проверка на тестовом** (пробные люди): владелец открывает три справочника и по карточке каждого вида; «Расписание группы» и «Журнал группы» из карточки; «Назад» браузера. Список или карточка дольше 2 секунд — находка.
- [ ] **Step 7:** `aidlc-state.md`: доработка принята и выложена на тестовый; известные ограничения — «сейчас» считается по расписанию (пара, закрытая раньше, держит аудиторию до конца 90 минут); «пар в неделю» — по шаблону, а не по настоящей неделе; поиск списка — только по названию; сведений об оборудовании и местах аудитории нет (будущая доработка).

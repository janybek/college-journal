# Задача 5, шаг 2 — одна волна исправлений после общей проверки «Справочников с подробностями»

Общая проверка (opus, `78f0396..0d22f2c`): **готово после исправлений**; Critical и Important нет; `npm test` 1308/1308, `build:gas` собирается.
Пробные скрипты проверяющего: `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\8a245745-6e8c-451a-aa33-971a507d5c8e\scratchpad\` (`lib.mjs`, `p1-rights.mjs`, `p2-now.mjs`, `p3-old-new.mjs`, `p4-empty.mjs`; прежний код — `old\`). Запуск: `node <скрипт>` из этой папки.

## Исправить (все три)

1. **`site/js/views/dirCard.js:186-188` и `:57-59`** (журнал хода, задача 4, minor 1). Листаю неделю аудитории, `dir.card` отвечает ошибкой → `errorCode` записан, данные прежние, на экране старая неделя без сообщения. Исправить: при `data !== null && errorCode` показать над сеткой `note('error', t(errorKey(code)))` (как в прочих экранах); сбрасывать `errorCode` при следующем `changeWeek` и при успешном ответе.
2. **`site/js/views/directory.js:96-100` (`applyAddress`).** Карточка → «Изменить» (адрес `…/edit`) → «Назад» браузера → список справочника, но окно правки остаётся открытым (`state.dialog.back` не сброшен); «Отмена» или «Сохранить» уводят в карточку вместо списка. Исправить: когда в адресе нет `editId`, а у открытого окна есть `back`, закрывать окно (`state.dialog = null`, перерисовать).
3. **`backend/dirInfo.js:29` (`context`).** `dir.summary` и `dir.card` для `disciplines` читают таблицу `pairs` (видно шпионом в `p1-rights.mjs`), хотя план для дисциплин её не перечисляет и `term` в их ответах нет. На запасном Google это лишнее чтение самого большого листа. Исправить: читать `pairs` и считать `term` только для `groups` и `rooms`. Тест в `tests/dirInfoApi.test.js`: у обоих действий для `disciplines` в `spy.lists` нет `pairs` (ответы прежние).

## Оставить (вердикт проверки)

Задача 1 — 5 и `'__proto__'` в `permissions.test.js` (покрыто задачей 2); задача 2 — `data.table` в `dir.js` (недостижимо); задача 4 — minor 2, 3, 4, 5.

## Правила

Памятка — `.superpowers/sdd/plan-spravochniki/implementer-contract.md`. Прежние ответы не меняются (кроме того, что `pairs` не читается для дисциплин). Одним коммитом: `fix: the room week shows a load error, the edit window closes on browser back, disciplines do not read pairs`. Для пунктов 1–2 — проверка на своём стенде (`npm run dev:lesson`, headless Chrome, только свой PID) и 1–2 скриншота в `.superpowers/sdd/plan-spravochniki/fix-shots/`.

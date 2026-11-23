# Сверка плана «Файл силлабуса» (opus, 24.11.2026) — plan.md на 454d0f7

Вердикт: **готов после правок** (4 важных, 8 мелких). Пробы проверяющего: `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\f4332125-be0e-4763-b4df-7c08ea268183\scratchpad\` (`repo` — выгрузка HEAD с правками задачи 1, `t1.txt` — прогон: 901 тест, 8 упали; `probes\goal-warning-text.mjs` — запуск `node <проба> "D:/Журнал колледжа"`).

## Важные

1. **Задача 1 ломает `tests/gasBundle.test.js:189`** («setup creates all 26 sheets, adds sixteen columns to an old syllabus sheet…»): `rows[0].length` 27 → 28 (строка 207), в названии sixteen → seventeen. Добавить файл в Files задачи 1 и в перечень разрешённых правок прежних тестов. Остальные 7 упавших план называет верно.
2. **Задача 3 делает `tests/devServer.test.js:440-450` нестабильным** («a fresh fictional stand has the assignments … one picture in its box»): сравнивает `saved.list('files').map(f => f.stored)` (порядок вставки) с `fs.readdirSync(srv.filesDir)` (алфавит hex-имён); со вторым файлом совпадает в ~50 % прогонов. Добавить файл в Files задачи 3: сравнивать отсортированные списки, 2 строки (`attached` png и `syllabus` pdf), поправить название теста.
3. **У предупреждения «цель пуста» нет текста.** `checkLine` (`site/js/syllabusForm.js:267-272`) строит ключ `sform.checks.goals.empty` — его нет, `views/syllabusForm.js:271` и `views/syllabus.js:331` берут `sform.checks.other` («В этом разделе есть ошибка.»). Окно `submitDialog` пишет `sform.submit.empty` с названиями вкладок («Не заполнено: Цель и результаты, … Отправить всё равно?»), а не «Цель курса». Правка: в словарь задачи 4 `sform.checks.goals.empty` (ru «Не заполнена цель курса (необязательно).» + ky, en); в Files задачи 4 `tests/i18n.test.js` — `'goals.empty'` в `CHECK_KEYS` (строка 225); п. 3 «Что на экранах» и скриншот (7) — «окно "Не заполнено: Цель и результаты, …"»; owner-summary §6.5 так же.
4. **Откат сервера на 72fb36b стирает файлы силлабусов.** Старая уборка живыми считает только `pending|attached` (`backend/node/files.js:62`), файлы строк `syllabus` на диске удалит как сирот (через час; уборка при запуске и после копии — `backend/node/server.js:182-205`). Зеркало `C:\JournalBackups\files` пишется до уборки (`backup.js:78`) и ничего не удаляет. В задачу 5: «Назад на коммит до этой работы: старая уборка удалит из `files` файлы силлабусов (строки останутся); их копии — в `C:\JournalBackups\files`; при возврате вперёд — `serve:restore` последней копии или ручное копирование недостающих `.bin` из зеркала. Без нужды не откатывать».

## Мелкие

5. Задача 1, `tests/sqliteStore.test.js:194-205` («ensureTables on a unit 4 base…»): там `syllabi` создаётся целиком, `added` остаётся `['changeLog.assignmentId']`, тест зелёный без правки — убрать из перечня правок, оставить только новый тест (`added` = `[['syllabi','fileId']]`).
6. `FILE_STATES` проверяется в «unit 5 tables: assignments, submissions, files, the work log column and the constants» (`tests/schema.test.js:99`), а не в «syllabus version fields…» — назвать его в задаче 1.
7. Тексты задачи 4: `{kind}` в `sform.file.meta` — из словаря (`sform.file.kind.pdf` «PDF», `sform.file.kind.word` «Word»); студенту при `file_missing` `openFile` покажет `error.file_missing` «…загрузите его снова» — нужен свой ключ (например `syllabus.file.missing` «Файл силлабуса не найден. Сообщите в деканат.»), передаваемый в `openFile`.
8. Стенд: v2 «Информатики» (1-е полугодие, возвращённая) создаётся `startDraft` в `seedSyllabi` (`dev/seed.js:168`) до `seedSyllabusFile` — у неё нет файла. `seedSyllabusFile` ставит тот же `fileId` и открытой копии этого ключа; тест seed это проверяет. В шаге 5 задачи 4: «без файла» — через «Изменить» у 2-го полугодия; для «на утверждении» — прикрепить к возвращённой v2 и отправить («Анатомия» уже на утверждении).
9. `readSyllabusFile` (задача 2, п. 3): заменяющий — «ведёт пару **и с ролью `teacher`**» (как `covers` в `backend/syllabusData.js:75-77`).
10. Исходное состояние: HEAD 454d0f7 (коммит плана), 901 тест — верно.
11. `sform.file.error.bad_type` = «Подходит только PDF или Word (.pdf, .docx, .doc). Шаблон Excel загружается кнопкой «Заполнить из файла».»
12. Предел 20 загрузок в сутки: деканат, заполняющий за 40 преподавателей, упрётся. Предложение: те же `FILE_LIMITS.perDayCount` (60) и `perDayBytes` (200 МиБ) на человека, без нового числа; поправить решения плана и owner-summary.

## Оценка выборов планировщика
- `ownerId` «студент» с id сотрудника — приемлемо (id сотрудников `sf…`, студентов `st…`, `core/schema.js:34,42`; проверка удаления студента `backend/handlers/dir.js:120` и фильтры `workStudent`/`workFiles` строки силлабуса не задевают). Одна строка комментария в `core/schema.js` о двойном смысле.
- Блок вверху «Титула» — хороший (см. п. 11).

## Сверено и верно
Имена и сигнатуры `core/files.js`, `backend/syllabusDraft.js`, `core/syllabusFlow.js`, `ROLE_ACTIONS`, тестовые помощники, сайт (`upload`, `call`, `openFile` с новым параметром и др.); ящик юнита 5 переиспользован, номер файла между заданием и силлабусом не переносится; «Заполнить из файла», «Утвердить», «Вернуть» не трогают `fileId`; права скачивания = кому видна версия; прежние подсчёты чтений не меняются (`fileId` у старых строк `''`); тело до 20 МБ пропускает 10 МиБ в base64; уборка по плану верна; зоны, модели, строгость проверок — по правилам.

## Решение координатора
Ruling: предел загрузок файла силлабуса — вариант проверяющего (60 файлов и 200 МиБ в сутки на человека, общие `FILE_LIMITS`), владельцу сообщено; все 12 находок внести в `plan.md` и `owner-summary.md` одним агентом.

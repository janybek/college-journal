# Юнит 1 «Основа»: план сборки

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** рабочая основа журнала: база создаётся одной кнопкой, вход по ролям, три языка, справочники и импорт из Excel, всё проверяется на локальном стенде и выкладывается в Google и на GitHub Pages.

**Architecture:** правила лежат в `core/` (чистый JavaScript), сервер в `backend/` обрабатывает запросы через прослойку «хранилище» с тремя реализациями (память, файл, Google Таблица), сайт в `site/` без сборки. Один и тот же код сервера работает на локальном стенде (`dev/`) и в Apps Script, куда он попадает одним файлом через esbuild.

**Tech Stack:** Node 24, ES-модули, `node --test`, esbuild (только для сборки под Apps Script), SheetJS 0.20.3 (файл в `site/vendor/`), Google Apps Script V8, clasp, GitHub Pages.

**Spec:** `aidlc-docs/inception/design-v1.md` (разделы 3, 5, 8, 9, 11) и `aidlc-docs/inception/ТЗ.md`.

## Global Constraints

- `core/` и `backend/` без зависимостей из npm. Dev-зависимостей проекта две: `esbuild` и `xlsx` (SheetJS; нужен только как источник одного файла для `site/vendor/`).
- Сайт: без сборки, без фреймворков, без внешних ссылок (CDN, шрифты). Системные шрифты.
- Все обработчики сервера синхронные. `handleRequest` никогда не бросает исключение и всегда возвращает объект ответа.
- Запрос сайта: `POST`, `Content-Type: text/plain;charset=utf-8`, тело — JSON `{action, token, data}`. Своих заголовков нет.
- `passwordHash` никогда не попадает в ответ сервера.
- Время берётся только из `platform.now()`. `Date.now()` в `core/` и `backend/` запрещён.
- Заголовки листов — русские названия из схемы; код находит колонки по названию, а не по номеру.
- Роли: `admin`, `dean`, `prorector`, `teacher`, `student`. У сотрудника роли хранятся строкой через запятую.
- Любая фраза на экране идёт через ключ словаря. Наборы ключей в `ky`, `ru`, `en` одинаковые. Язык по умолчанию — `ky`.
- Настоящих данных студентов в репозитории нет. `dev/data/` и `build/` — в `.gitignore`.
- Часовой пояс Apps Script: `Asia/Bishkek`.
- Сообщения коммитов на английском, в конце строка `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Excel «как у людей»:** пробелы и другой регистр в заголовках, пустые строки в конце, номер билета числом (`1002`, а не `"1002"`). Ожидание: строки читаются, ошибка в одной строке не срывает остальные. Тест — задача 6.
2. **Тот же файл импортирован дважды.** Ожидание: дублей нет, пароли уже существующим людям не перевыдаются. Тест — задача 7.
3. **Мусор вместо запроса:** не JSON, неизвестное действие, нет ключа входа. Ожидание: обычный ответ с кодом ошибки, не исключение. Тест — задача 4.
4. **Ключ входа жив, а человека отключили или сбросили ему пароль.** Ожидание: следующий запрос отклонён. Тест — задача 4.
5. **Администратор правил таблицу руками:** переставил колонки, добавил свою, оставил пустую строку посередине. Ожидание: данные читаются по названиям колонок, чужая колонка не затирается. Тест — задача 2.

## Чего в юните 1 нет

Ограничения числа попыток входа (появится в юните 3 вместе с кешем), листов расписания, пар, оценок и всех экранов, кроме входа, главной и справочников.

## Файлы

```
package.json  .gitignore  .claude/launch.json
core/errors.js          AppError
core/schema.js          таблицы юнита 1
core/validate.js        нормализация и проверка строк
core/auth.js            хэш пароля, ключ входа
core/permissions.js     кто что может
core/import.js          разбор листа Excel
backend/platform/nodePlatform.js   gasPlatform.js
backend/store/memoryStore.js  fileStore.js  sheetsStore.js
backend/api.js
backend/handlers/auth.js  dir.js  import.js
backend/gas/main.js  appsscript.json
scripts/build-gas.js  scripts/vendor.js
dev/server.js  dev/seed.js
site/index.html  site/config.js  site/css/app.css  site/vendor/xlsx.full.min.js
site/js/main.js  api.js  session.js  router.js  i18n.js
site/js/i18n/ru.js  ky.js  en.js
site/js/views/login.js  changePassword.js  home.js  directory.js  import.js
tests/*.test.js  tests/fakes/fakeSpreadsheet.js  tests/fakes/fakeGas.js
```

Кто делает: **Л** — агент «Логика», **С** — «Сервер», **Э** — «Экраны». После каждой задачи — агент «Проверяющий».

---

### Task 1 (Л): каркас, схема, проверка строк

**Files:** Create `package.json`, `.gitignore`, `core/errors.js`, `core/schema.js`, `core/validate.js`, `backend/platform/nodePlatform.js`. Test: `tests/schema.test.js`, `tests/validate.test.js`, `tests/nodePlatform.test.js`.

**Interfaces — Produces:**

```js
// core/errors.js
export class AppError extends Error { constructor(code, extra = {}) }   // .code, .fields (массив или undefined)

// core/schema.js
export const STAFF_ROLES = ['admin', 'dean', 'prorector', 'teacher'];
export const LANGS = ['ky', 'ru', 'en'];
export const DEFAULT_LANG = 'ky';
export const SCHEMA;            // { [table]: { sheet, prefix, columns: [{ key, title, type }] } }, type: 'string' | 'int' | 'bool'
export function tableNames();   // порядок как в таблице ниже

// core/validate.js
export function normalizeRow(table, input);   // обрезает и схлопывает пробелы, приводит типы, ставит значения по умолчанию; passwordHash не трогает
export function validateRow(table, row, db);  // -> [{ field, code }]; db = { groups, students, staff, subjects, rooms }; row.id есть при изменении

// backend/platform/nodePlatform.js
export function createNodePlatform({ now, secret } = {});
// -> { now(): number, randomHex(bytes): string, sha256Hex(text): string, hmacSha256Hex(key, text): string, secret(): string }
// secret по умолчанию: process.env.JOURNAL_SECRET || 'dev-secret'
```

Схема (ключ / заголовок в листе / тип, если не `string`):

| table | sheet | prefix | columns |
| --- | --- | --- | --- |
| groups | Группы | g | id/id, name/название, course/курс (int) |
| students | Студенты | st | id/id, fullName/ФИО, groupId/группа, cardNo/№ студ. билета, passwordHash/хэш пароля, lang/язык, mustChangePassword/сменить пароль (bool), active/активен (bool) |
| staff | Сотрудники | sf | id/id, fullName/ФИО, login/логин, passwordHash/хэш пароля, roles/роли, lang/язык, mustChangePassword/сменить пароль (bool), active/активен (bool) |
| subjects | Предметы | sb | id/id, name/название, teacherId/преподаватель, groupId/группа, scheme/схема оценивания |
| rooms | Аудитории | r | id/id, name/название |
| translations | Переводы | tr | id/id, key/ключ, ky/кыргызский, ru/русский, en/английский |
| settings | Настройки | cfg | id/id, key/ключ, value/значение |

Правила `validateRow` (коды: `required`, `too_long` при длине > 200, `bad_value`, `duplicate`, `bad_ref`, `last_admin`). Сравнение на уникальность — без учёта регистра и крайних пробелов.

- groups: `name` обязателен и уникален; `course` целое 1–6.
- students: `fullName`, `cardNo` обязательны; `cardNo` уникален среди студентов и не совпадает ни с одним `staff.login`; `groupId` существует; `lang` из `LANGS`.
- staff: `fullName` обязателен; `login` 3–40 символов, уникален среди сотрудников и не совпадает ни с одним `students.cardNo`; `roles` — непустое подмножество `STAFF_ROLES`; нельзя отключить (`active=false`) или лишить роли `admin` последнего активного администратора (`last_admin`, поле `roles` или `active`).
- subjects: `name` обязателен; `teacherId` существует (`bad_ref`) и имеет роль `teacher` (`bad_value`); `groupId` существует; пара (`name`, `groupId`) уникальна; `scheme` по умолчанию `'A'`.
- rooms: `name` обязателен и уникален.

Значения по умолчанию в `normalizeRow`: `lang = 'ky'`, `active = true`, `mustChangePassword = true`, `scheme = 'A'`. `roles` приводится к виду без пробелов в порядке `STAFF_ROLES`: `'teacher, dean'` → `'dean,teacher'`.

Ошибки `validateRow` идут в порядке колонок схемы.

- [ ] **Step 1: каркас.** `git init -b main`. `package.json`: `"type": "module"`, скрипты `"test": "node --test tests/"`, `"dev": "node dev/server.js"`, `"dev:reset": "node dev/server.js --reset"`, `"build:gas": "node scripts/build-gas.js"`. `.gitignore`: `node_modules/`, `build/`, `dev/data/`, `.clasp.json`, `.clasprc.json`.
- [ ] **Step 2: тесты, которые падают.**

```js
// tests/schema.test.js
assert.deepEqual(tableNames(), ['groups', 'students', 'staff', 'subjects', 'rooms', 'translations', 'settings']);
assert.equal(SCHEMA.students.sheet, 'Студенты');
assert.deepEqual(SCHEMA.students.columns.map(c => c.title),
  ['id', 'ФИО', 'группа', '№ студ. билета', 'хэш пароля', 'язык', 'сменить пароль', 'активен']);

// tests/validate.test.js
const db = {
  groups: [{ id: 'g_1', name: '01-1', course: 1 }],
  students: [{ id: 'st_1', fullName: 'А', cardNo: 'S1001', groupId: 'g_1', lang: 'ky', active: true }],
  staff: [{ id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'admin', lang: 'ru', active: true }],
  subjects: [], rooms: [],
};
assert.deepEqual(normalizeRow('students', { fullName: '  Асанов   Азамат ', cardNo: 1002, groupId: 'g_1' }),
  { fullName: 'Асанов Азамат', cardNo: '1002', groupId: 'g_1', lang: 'ky', mustChangePassword: true, active: true });
assert.deepEqual(validateRow('groups', { name: ' 01-1 ', course: 1 }, db), [{ field: 'name', code: 'duplicate' }]);
assert.deepEqual(validateRow('groups', { name: '02-1', course: 9 }, db), [{ field: 'course', code: 'bad_value' }]);
assert.deepEqual(validateRow('students', { fullName: '', cardNo: 'ADMIN', groupId: 'g_x', lang: 'ky' }, db),
  [{ field: 'fullName', code: 'required' }, { field: 'groupId', code: 'bad_ref' }, { field: 'cardNo', code: 'duplicate' }]);
assert.deepEqual(validateRow('staff', { id: 'sf_1', fullName: 'Б', login: 'admin', roles: 'teacher', lang: 'ru', active: true }, db),
  [{ field: 'roles', code: 'last_admin' }]);
assert.deepEqual(validateRow('subjects', { name: 'Информатика', teacherId: 'sf_1', groupId: 'g_1', scheme: 'A' }, db),
  [{ field: 'teacherId', code: 'bad_value' }]);
assert.deepEqual(validateRow('students', { id: 'st_1', fullName: 'А', cardNo: 's1001', groupId: 'g_1', lang: 'ky' }, db), []); // сам с собой не дубль

// tests/nodePlatform.test.js
const p = createNodePlatform({ now: () => 5, secret: 's' });
assert.equal(p.now(), 5);
assert.equal(p.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
assert.match(p.randomHex(4), /^[0-9a-f]{8}$/);
assert.equal(p.hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'),
  'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
```

- [ ] **Step 3:** `npm test` — падает: модулей нет.
- [ ] **Step 4:** написать `core/errors.js`, `core/schema.js`, `core/validate.js`, `backend/platform/nodePlatform.js`.
- [ ] **Step 5:** `npm test` — всё зелёное.
- [ ] **Step 6:** коммит `chore: project skeleton, schema and row validation`.

---

### Task 2 (С): хранилище

**Files:** Create `backend/store/memoryStore.js`, `fileStore.js`, `sheetsStore.js`, `tests/fakes/fakeSpreadsheet.js`. Test: `tests/store.test.js`, `tests/sheetsStore.test.js`.

**Interfaces — Consumes:** `SCHEMA`, `AppError`, `createNodePlatform` (Task 1).

**Produces:**

```js
// Все три возвращают один и тот же Store:
// { list(table): object[], get(table, id): object | null, insert(table, row): object,
//   insertMany(table, rows): object[], update(table, id, patch): object, remove(table, id): void }
export function createMemoryStore(schema, platform, data = {});
export function createFileStore(schema, platform, filePath);      // JSON-файл, пишется после каждого изменения
export function createSheetsStore(schema, platform, spreadsheet, withLock = fn => fn());
export function ensureSheets(schema, spreadsheet);                // -> { created: string[], addedColumns: string[] }, можно запускать повторно

// tests/fakes/fakeSpreadsheet.js
export function createFakeSpreadsheet(sheets = {});   // sheets: { [name]: any[][] }; методы: getSheetByName, insertSheet,
// у листа: getName, getLastRow, getLastColumn, getRange(r, c, nr, nc).getValues()/.setValues(v), appendRow(arr), deleteRow(n); .dump(name) -> any[][]
```

Правила: `id` = `prefix + '_' + platform.randomHex(4)`, при совпадении генерируется заново. `list` и `get` отдают копии. `update` и `remove` несуществующего `id` бросают `AppError('not_found')`. Неизвестная таблица — `AppError('bad_request')`.

`sheetsStore`: первая строка листа — заголовки, колонка ищется по названию. Строка с пустым `id` пропускается. Чтение: `string` — `String(v).trim()`, число `1002` даёт `'1002'`; `bool` — истина для `true`, `'TRUE'`, `'true'`, `'да'`, `1`; `int` — целое или `null`. Запись меняет только колонки схемы. Все записи идут внутри `withLock`.

- [ ] **Step 1: тесты.** Общий набор для памяти и файла (функция `storeContract(name, makeStore)`):

```js
const s = makeStore();
const g = s.insert('groups', { name: '01-1', course: 1 });
assert.match(g.id, /^g_[0-9a-f]{8}$/);
assert.deepEqual(s.get('groups', g.id), g);
s.list('groups')[0].name = 'x';
assert.equal(s.get('groups', g.id).name, '01-1');                        // копии
assert.equal(s.update('groups', g.id, { course: 2 }).course, 2);
s.remove('groups', g.id);
assert.equal(s.get('groups', g.id), null);
assert.throws(() => s.update('groups', 'g_nope', {}), e => e.code === 'not_found');
assert.throws(() => s.list('nope'), e => e.code === 'bad_request');
// файл: второй createFileStore по тому же пути видит записанное первым
```

```js
// tests/sheetsStore.test.js — Review Focus 5
const ss = createFakeSpreadsheet({ 'Группы': [
  ['курс', 'моя заметка', 'id', 'название'],      // колонки переставлены, одна чужая
  [1, 'не трогать', 'g_1', '01-1'],
  ['', '', '', ''],                                // пустая строка
  [2, 'и эту', 'g_2', 1002],                       // название числом
] });
const s = createSheetsStore(SCHEMA, platform, ss);
assert.deepEqual(s.list('groups'), [{ id: 'g_1', name: '01-1', course: 1 }, { id: 'g_2', name: '1002', course: 2 }]);
s.update('groups', 'g_2', { name: '02-1' });
assert.deepEqual(ss.dump('Группы')[3], [2, 'и эту', 'g_2', '02-1']);   // чужая колонка цела
s.remove('groups', 'g_1');
assert.equal(s.get('groups', 'g_1'), null);
const made = ensureSheets(SCHEMA, createFakeSpreadsheet({ 'Группы': [['id', 'название']] }));
assert.deepEqual(made.addedColumns, ['Группы.курс']);
assert.equal(made.created.length, 6);
```

- [ ] **Step 2:** `npm test` — падает.
- [ ] **Step 3:** написать три хранилища и фальшивую таблицу. `fileStore` — обёртка над `memoryStore` с записью файла.
- [ ] **Step 4:** `npm test` — зелёное.
- [ ] **Step 5:** коммит `feat: storage layer (memory, file, sheets)`.

---

### Task 3 (Л): пароли, ключ входа, права

**Files:** Create `core/auth.js`, `core/permissions.js`. Test: `tests/auth.test.js`, `tests/permissions.test.js`.

**Interfaces — Consumes:** платформа из Task 1.

**Produces:**

```js
// core/auth.js
export const HASH_ROUNDS = 500;
export const MIN_PASSWORD = 6;
export const TOKEN_TTL_MS = { staff: 7 * 86400000, student: 30 * 86400000 };
export function hashPassword(platform, password, salt, rounds = HASH_ROUNDS);  // -> 'v1$<rounds>$<salt>$<hash>'; salt по умолчанию platform.randomHex(8)
export function verifyPassword(platform, password, stored);                    // -> boolean; мусор в stored -> false
export function passwordVersion(stored);                                       // -> последние 8 символов stored
export function passwordProblem(password, login);                              // -> null | 'too_short' | 'same_as_login' | 'too_simple'
export function generateTempPassword(platform);                                // 8 символов из 'abcdefghjkmnpqrstuvwxyz23456789'
export function issueToken(platform, { uid, kind, pv });                       // kind: 'staff' | 'student'
export function readToken(platform, token);                                    // -> { uid, kind, pv, exp } | null

// core/permissions.js
export function can(roles, action, table);     // roles: string[]
export function listPermissions(roles);        // -> ['dir.list:groups', 'dir.save:groups', 'teacher.mySubjects', ...] по алфавиту
```

Алгоритмы (одинаковы в Node и Apps Script, поэтому заданы точно):

- Хэш: `h = sha256Hex(salt + ':' + password)`, затем `rounds - 1` раз `h = sha256Hex(h + ':' + salt)`.
- Ключ: `body = encodeURIComponent(JSON.stringify({ uid, kind, pv, exp }))`, `exp = now + TOKEN_TTL_MS[kind]`; ключ = `body + '.' + hmacSha256Hex(platform.secret(), body)`. Подпись сравнивается по всей длине без раннего выхода.
- `too_simple`: пароль из списка `123456, 1234567, 12345678, 123456789, 111111, 000000, qwerty, password, parol, пароль` или из одного повторяющегося символа.

Права (`public` — без ключа, `any` — любой вошедший):

| Действие | Кто |
| --- | --- |
| `auth.login`, `i18n.overrides` | public |
| `auth.me`, `auth.changePassword`, `user.setLang` | any |
| `dir.list` (groups, students, staff, subjects, rooms) | admin, dean, prorector |
| `dir.save`, `dir.remove`, `import.preview`, `import.apply` | admin — все пять таблиц; dean — groups, students, subjects, rooms |
| `dir.resetPassword` | admin — students, staff; dean — students |
| `teacher.mySubjects` | teacher |

- [ ] **Step 1: тесты.**

```js
const p = createNodePlatform({ now: () => 1000, secret: 's' });
const h = hashPassword(p, 'secret12', 'aabbccdd11223344');
assert.match(h, /^v1\$500\$aabbccdd11223344\$[0-9a-f]{64}$/);
assert.equal(hashPassword(p, 'secret12', 'aabbccdd11223344'), h);        // повторяемо
assert.equal(hashPassword(p, 'a', 'ab', 1), 'v1$1$ab$' + p.sha256Hex('ab:a'));
assert.equal(verifyPassword(p, 'secret12', h), true);
assert.equal(verifyPassword(p, 'Secret12', h), false);
assert.equal(verifyPassword(p, 'x', 'мусор'), false);
assert.equal(passwordProblem('12345', 'u'), 'too_short');
assert.equal(passwordProblem('S1001x'.slice(0, 6), 's1001x'), 'same_as_login');
assert.equal(passwordProblem('aaaaaaa', 'u'), 'too_simple');
assert.equal(passwordProblem('kитеп-42', 'u'), null);
assert.match(generateTempPassword(p), /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/);

const t = issueToken(p, { uid: 'st_1', kind: 'student', pv: 'abcd1234' });
assert.deepEqual(readToken(p, t), { uid: 'st_1', kind: 'student', pv: 'abcd1234', exp: 1000 + 30 * 86400000 });
assert.equal(readToken(p, t.slice(0, -1) + (t.endsWith('0') ? '1' : '0')), null);   // подпись испорчена
assert.equal(readToken(createNodePlatform({ now: () => 1000 + 31 * 86400000, secret: 's' }), t), null);  // истёк
assert.equal(readToken(createNodePlatform({ now: () => 1000, secret: 'other' }), t), null);
for (const bad of ['', 'abc', '.', null, undefined, 42]) assert.equal(readToken(p, bad), null);

assert.equal(can(['dean'], 'dir.save', 'students'), true);
assert.equal(can(['dean'], 'dir.save', 'staff'), false);
assert.equal(can(['dean'], 'dir.resetPassword', 'staff'), false);
assert.equal(can(['prorector'], 'dir.list', 'staff'), true);
assert.equal(can(['prorector'], 'dir.save', 'groups'), false);
assert.equal(can(['teacher'], 'dir.list', 'students'), false);
assert.equal(can(['dean', 'teacher'], 'teacher.mySubjects'), true);
assert.equal(can(['student'], 'auth.me'), true);
assert.equal(can([], 'auth.login'), true);
assert.equal(can(['admin'], 'нет.такого'), false);
assert.deepEqual(listPermissions(['student']), []);
assert.ok(listPermissions(['dean']).includes('import.apply:students'));
```

- [ ] **Step 2:** `npm test` — падает. **Step 3:** написать оба файла. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: password hashing, session tokens, permissions`.

---

### Task 4 (С): запросы и вход

**Files:** Create `backend/api.js`, `backend/handlers/auth.js`. Test: `tests/api.test.js`.

**Interfaces — Consumes:** Store (Task 2); `hashPassword`, `verifyPassword`, `passwordVersion`, `passwordProblem`, `issueToken`, `readToken`, `can`, `listPermissions` (Task 3); `LANGS`, `AppError`.

**Produces:**

```js
// backend/api.js
export function handleRequest(raw, ctx);
// raw: строка JSON или объект { action, token, data }; ctx = { store, platform, log? }
// -> { ok: true, data, serverTime } | { ok: false, error: { code, fields? }, serverTime }
export function registerHandlers(map);      // { 'действие': (data, ctx, user) => data }
export function publicUser(row, kind);
// -> { id, kind, fullName, roles: string[], lang, mustChangePassword, groupId, permissions: string[] }
//    у студента roles = ['student'], у сотрудника groupId = null
```

Порядок проверок в `handleRequest` и коды ошибок: не JSON или нет строки `action` → `bad_request`; действия нет в правах → `bad_request`; действие не `public`, а ключ не читается → `unauthorized`; человека нет, он отключён или `pv` в ключе не равен `passwordVersion(row.passwordHash)` → `unauthorized`; `can` говорит «нет» → `forbidden`; у человека `mustChangePassword` и действие не из `auth.me`, `auth.changePassword`, `user.setLang` → `must_change_password`; обработчик бросил `AppError` → его `code` и `fields`; любое другое исключение → `internal` и вызов `ctx.log(err)`, если он есть. Действие есть в правах, но обработчик не зарегистрирован → `bad_request`. Для действий с таблицей (`dir.*`, `import.*`) в `can` передаётся `data.table`.

Действия:

- `auth.login { login, password }` → `{ token, user }`. Логин обрезается; сначала ищется `staff.login`, потом `students.cardNo`, оба без учёта регистра. Не найден, отключён или пароль неверный → всегда `bad_credentials`.
- `auth.me {}` → `{ user }`.
- `auth.changePassword { oldPassword, newPassword }` → `{ token, user }`. Старый неверный → `bad_credentials`; `passwordProblem` → `AppError('invalid', { fields: [{ field: 'newPassword', code }] })`. Ставит новый хэш и `mustChangePassword = false`.
- `user.setLang { lang }` → `{ user }`; язык не из `LANGS` → `invalid`.

- [ ] **Step 1: тесты.** Подготовка: `memoryStore` с одним админом (`login: 'admin'`, пароль `secret12`, `mustChangePassword: false`), одним студентом (`cardNo: 'S1001'`, `mustChangePassword: true`), часы `now` меняются из теста.

```js
const call = (action, data, token) => handleRequest(JSON.stringify({ action, data, token }), ctx);
// Review Focus 3
assert.deepEqual(handleRequest('не json', ctx).error, { code: 'bad_request' });
assert.deepEqual(call('нет.такого').error, { code: 'bad_request' });
assert.deepEqual(call('auth.me').error, { code: 'unauthorized' });
assert.deepEqual(call('auth.me', {}, 'мусор').error, { code: 'unauthorized' });
assert.equal(typeof call('auth.me').serverTime, 'number');

assert.deepEqual(call('auth.login', { login: 'admin', password: 'wrong' }).error, { code: 'bad_credentials' });
assert.deepEqual(call('auth.login', { login: 'nobody', password: 'x' }).error, { code: 'bad_credentials' });
const a = call('auth.login', { login: '  ADMIN ', password: 'secret12' }).data;
assert.equal(a.user.kind, 'staff');
assert.deepEqual(a.user.roles, ['admin']);
assert.equal('passwordHash' in a.user, false);
assert.ok(a.user.permissions.includes('dir.save:staff'));

const st = call('auth.login', { login: 's1001', password: STUDENT_TEMP }).data;
assert.deepEqual(st.user.roles, ['student']);
assert.deepEqual(call('teacher.mySubjects', {}, st.token).error, { code: 'forbidden' });
assert.deepEqual(call('user.setLang', { lang: 'xx' }, st.token).error.code, 'invalid');
assert.deepEqual(call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: '123' }, st.token).error,
  { code: 'invalid', fields: [{ field: 'newPassword', code: 'too_short' }] });
const changed = call('auth.changePassword', { oldPassword: STUDENT_TEMP, newPassword: 'kitep-42' }, st.token).data;
assert.equal(changed.user.mustChangePassword, false);
assert.deepEqual(call('auth.me', {}, st.token).error, { code: 'unauthorized' });      // старый ключ умер — Review Focus 4
assert.equal(call('auth.me', {}, changed.token).ok, true);

store.update('staff', adminId, { active: false });
assert.deepEqual(call('auth.me', {}, a.token).error, { code: 'unauthorized' });        // отключили — Review Focus 4

// must_change_password: сотрудник с ролью dean и mustChangePassword: true вызывает dir.list -> { code: 'must_change_password' }
// internal: зарегистрировать обработчик, бросающий Error, для действия из прав -> { code: 'internal' }, ctx.log вызван один раз
```

- [ ] **Step 2:** падает. **Step 3:** написать `api.js` и `handlers/auth.js`. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: request handling and login`.

---

### Task 5 (С): справочники

**Files:** Create `backend/handlers/dir.js`. Modify `backend/api.js` (регистрация). Test: `tests/dir.test.js`.

**Interfaces — Consumes:** `normalizeRow`, `validateRow` (Task 1), `generateTempPassword`, `hashPassword` (Task 3), `registerHandlers` (Task 4).

**Produces** (действия, таблицы — groups, students, staff, subjects, rooms):

- `dir.list { table }` → `{ rows }` без `passwordHash`.
- `dir.save { table, row }` → `{ row, tempPassword? }`. Без `row.id` — создание, с ним — изменение. Строка собирается как `normalizeRow(table, { ...старая, ...row })`; `passwordHash`, пришедший от сайта, отбрасывается. Ошибки `validateRow` → `AppError('invalid', { fields })`. Новому студенту и сотруднику выдаётся временный пароль, он возвращается один раз в `tempPassword`.
- `dir.remove { table, id }` → `{}`. `in_use`: группа, на которую ссылается студент или предмет; сотрудник, на которого ссылается предмет. `forbidden`: удалить самого себя. `last_admin` (через `invalid`, поле `roles`): удалить последнего активного администратора.
- `dir.resetPassword { table, id }` → `{ tempPassword }`; `table` — `students` или `staff`. Ставит `mustChangePassword = true`.
- `teacher.mySubjects {}` → `{ subjects: [{ id, name, groupId, groupName, studentCount }] }` — предметы, где `teacherId` равен вошедшему; `studentCount` считает только активных.
- `i18n.overrides {}` → `{ rows: [{ key, ky, ru, en }] }`.

- [ ] **Step 1: тесты** (подготовка: админ, декан с ролями `dean,teacher`, преподаватель, группа `01-1`).

```js
const made = call('dir.save', { table: 'students', row: { fullName: 'Асанов Азамат', cardNo: 'S2001', groupId } }, dean).data;
assert.match(made.tempPassword, /^[a-z2-9]{8}$/);
assert.equal('passwordHash' in made.row, false);
assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).data.user.mustChangePassword, true);
assert.deepEqual(call('dir.save', { table: 'students', row: { fullName: 'Б', cardNo: 's2001', groupId } }, dean).error,
  { code: 'invalid', fields: [{ field: 'cardNo', code: 'duplicate' }] });
const edited = call('dir.save', { table: 'students', row: { id: made.row.id, fullName: 'Асанов А.', passwordHash: 'взлом' } }, dean).data;
assert.equal(edited.tempPassword, undefined);
assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).ok, true);     // хэш не подменили
assert.deepEqual(call('dir.save', { table: 'staff', row: { fullName: 'В', login: 'vvv', roles: 'teacher' } }, dean).error, { code: 'forbidden' });
assert.deepEqual(call('dir.remove', { table: 'groups', id: groupId }, dean).error, { code: 'in_use' });
assert.deepEqual(call('dir.remove', { table: 'staff', id: adminId }, admin).error, { code: 'forbidden' });   // сам себя
const reset = call('dir.resetPassword', { table: 'students', id: made.row.id }, dean).data;
assert.equal(call('auth.login', { login: 'S2001', password: made.tempPassword }).ok, false);
assert.equal(call('auth.login', { login: 'S2001', password: reset.tempPassword }).ok, true);
assert.deepEqual(call('dir.resetPassword', { table: 'staff', id: teacherId }, dean).error, { code: 'forbidden' });
assert.equal(call('dir.list', { table: 'staff' }, dean).data.rows.every(r => !('passwordHash' in r)), true);
// teacher.mySubjects: создать предмет на преподавателя -> у него 1 предмет с groupName '01-1' и studentCount 1; у декана-преподавателя 0
// i18n.overrides без ключа входа возвращает строки листа «Переводы»
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: directories API`.

---

### Task 6 (Л): разбор листа Excel

**Files:** Create `core/import.js`. Test: `tests/import.test.js`.

**Interfaces — Consumes:** `normalizeRow`, `validateRow`, `STAFF_ROLES`.

**Produces:**

```js
export const MAX_IMPORT_ROWS = 2000;
export const IMPORT_SPECS;   // { [table]: { uniqueBy: string[], columns: [{ key, titles: { ru, ky, en }, required }] } }
export function parseSheet(table, cells, db);
// cells: any[][], первая строка — заголовки. -> { records, errors: [{ row, field, code }], unknownColumns, missingColumns }
// row — номер строки как в Excel (заголовок = 1). records[i].row хранит тот же номер.
export function planImport(table, records, db);   // -> { toInsert: object[], toUpdate: [{ id, patch }] }
```

Колонки (ru / ky / en; * — обязательная):

| table | uniqueBy | columns |
| --- | --- | --- |
| groups | name | name*: Название / Аталышы / Name; course*: Курс / Курс / Year |
| rooms | name | name*: Название / Аталышы / Name |
| students | cardNo | fullName*: ФИО / Аты-жөнү / Full name; cardNo*: № студ. билета / Студенттик билеттин № / Student ID; groupId*: Группа / Тайпа / Group; lang: Язык / Тил / Language |
| staff | login | fullName*: ФИО / Аты-жөнү / Full name; login*: Логин / Логин / Login; roles*: Роли / Ролдор / Roles; lang: Язык / Тил / Language |
| subjects | name, groupId | name*: Название / Аталышы / Name; teacherId*: Преподаватель / Окутуучу / Teacher; groupId*: Группа / Тайпа / Group |

Правила:

- Заголовки сравниваются без учёта регистра и лишних пробелов, на любом из трёх языков. Нет обязательной колонки → она в `missingColumns`, `records` пуст.
- Ячейка-число становится строкой без дробной части. Полностью пустые строки пропускаются без ошибки.
- Ссылки: `groupId` — по названию группы; `teacherId` — по логину, а если не нашёлся, по ФИО (если с таким ФИО двое — `bad_ref`). Не найдено → `bad_ref`.
- `roles` в файле — слова через запятую на любом языке: `админ/admin`, `деканат/dean`, `проректор/prorector`, `преподаватель/окутуучу/teacher`. Неизвестное слово → `bad_value`.
- `lang` в файле: `ky/кыргызский/кыргызча`, `ru/русский/орусча`, `en/английский/англисче`; пусто → по умолчанию.
- Каждая строка проходит `validateRow` против `db`, дополненной уже принятыми строками файла, поэтому повтор внутри файла даёт `duplicate` на второй строке. Строка, совпавшая по `uniqueBy` с существующей записью, — это изменение, а не дубль.
- Строк больше `MAX_IMPORT_ROWS` → одна ошибка `{ row: 0, field: '', code: 'too_many_rows' }`, `records` пуст.
- В записи из `records` есть только те поля, чьи колонки есть в файле и не пусты в этой строке, плюс `row`. Значения по умолчанию подставляются только при создании.
- `planImport`: новые строки проходят `normalizeRow`; в `patch` изменения попадают только поля из записи, кроме `row` и полей из `uniqueBy`, поэтому импорт без колонки «Язык» не сбрасывает язык, выбранный человеком. `passwordHash`, `mustChangePassword`, `active` импорт не меняет никогда.

- [ ] **Step 1: тесты.**

```js
const db = { groups: [{ id: 'g_1', name: '01-1', course: 1 }], students: [{ id: 'st_1', fullName: 'Старый', cardNo: '1001', groupId: 'g_1', lang: 'ky', active: true }], staff: [], subjects: [], rooms: [] };
// Review Focus 1
const r = parseSheet('students', [
  ['  фио ', 'Группа', '№ СТУД.  БИЛЕТА', 'лишняя'],
  ['Асанов Азамат', ' 01-1 ', 1002, 'x'],
  ['', '', '', ''],
  ['Бекова Бегимай', '09-9', 1003, ''],
  ['Новое Имя', '01-1', 1001, ''],
  ['Дубль', '01-1', '1002', ''],
  [null, null, null, null],
], db);
assert.deepEqual(r.unknownColumns, ['лишняя']);
assert.deepEqual(r.missingColumns, []);
assert.deepEqual(r.errors, [{ row: 4, field: 'groupId', code: 'bad_ref' }, { row: 6, field: 'cardNo', code: 'duplicate' }]);
assert.deepEqual(r.records.map(x => [x.row, x.cardNo, x.groupId]), [[2, '1002', 'g_1'], [5, '1001', 'g_1']]);
const plan = planImport('students', r.records, db);
assert.equal(plan.toInsert.length, 1);
assert.equal(plan.toInsert[0].lang, 'ky');                                               // по умолчанию только у новых
assert.deepEqual(plan.toUpdate, [{ id: 'st_1', patch: { fullName: 'Новое Имя', groupId: 'g_1' } }]);   // язык не тронут

assert.deepEqual(parseSheet('students', [['ФИО'], ['А']], db).missingColumns, ['cardNo', 'groupId']);
assert.deepEqual(parseSheet('students', [['Аты-жөнү', 'Тайпа', 'Student ID'], ['А', '01-1', 7]], db).errors, []);
assert.deepEqual(parseSheet('staff', [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'Преподаватель, деканат'], ['Б', 'bbb', 'директор']], db).errors,
  [{ row: 3, field: 'roles', code: 'bad_value' }]);
assert.equal(parseSheet('staff', [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'Преподаватель, деканат']], db).records[0].roles, 'dean,teacher');
// too_many_rows: 2001 строка данных -> errors[0].code === 'too_many_rows'
```

- [ ] **Step 2:** падает. **Step 3:** написать `core/import.js`. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: spreadsheet import parsing`.

---

### Task 7 (С): импорт на сервере

**Files:** Create `backend/handlers/import.js`. Modify `backend/api.js` (регистрация). Test: `tests/importApi.test.js`.

**Interfaces — Consumes:** `parseSheet`, `planImport` (Task 6), `generateTempPassword`, `hashPassword` (Task 3), `registerHandlers` (Task 4).

**Produces:**

- `import.preview { table, cells }` → `{ total, valid, newCount, updateCount, errors, unknownColumns, missingColumns }`. В базу ничего не пишет. `total` — число непустых строк данных.
- `import.apply { table, cells }` → `{ inserted, updated, skipped, passwords }`. Записывает верные строки, неверные пропускает (`skipped = errors.length`). `passwords` — `[{ login, fullName, tempPassword }]` только для новых студентов (`login` = `cardNo`) и новых сотрудников.

- [ ] **Step 1: тесты.**

```js
const cells = [['ФИО', 'Группа', '№ студ. билета'], ['Асанов Азамат', '01-1', 2001], ['Бекова Бегимай', '01-1', 2002], ['Кривой', '99-9', 2003]];
const pre = call('import.preview', { table: 'students', cells }, dean).data;
assert.deepEqual([pre.total, pre.valid, pre.newCount, pre.updateCount], [3, 2, 2, 0]);
assert.equal(store.list('students').length, 0);                                   // предпросмотр не пишет
const first = call('import.apply', { table: 'students', cells }, dean).data;
assert.deepEqual([first.inserted, first.updated, first.skipped, first.passwords.length], [2, 0, 1, 2]);
assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);
// Review Focus 2
const second = call('import.apply', { table: 'students', cells }, dean).data;
assert.deepEqual([second.inserted, second.updated, second.passwords.length], [0, 2, 0]);
assert.equal(store.list('students').length, 2);
assert.equal(call('auth.login', { login: '2001', password: first.passwords[0].tempPassword }).ok, true);   // пароль не перевыдан
assert.deepEqual(call('import.apply', { table: 'staff', cells: [['ФИО', 'Логин', 'Роли'], ['А', 'aaa', 'admin']] }, dean).error, { code: 'forbidden' });
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: import API`.

---

### Task 8 (С): локальный стенд

**Files:** Create `dev/server.js`, `dev/seed.js`, `.claude/launch.json`. Test: `tests/devServer.test.js`.

**Interfaces — Consumes:** `createFileStore`, `createNodePlatform`, `handleRequest`, все обработчики.

**Produces:**

```js
// dev/server.js
export function startDevServer({ port = 5173, dataFile = 'dev/data/db.json', siteDir = 'site' } = {});   // -> { url, close() }
// запуск как программы: node dev/server.js [--reset]  (--reset удаляет dataFile перед стартом)
// dev/seed.js
export const DEV_PASSWORD;                      // один пароль для всех людей стенда, записан в этом файле
export function seed(store, platform);          // ничего не делает, если в staff уже есть строки
```

`POST /api` → `handleRequest(тело, ctx)`, ответ `application/json`. Остальное — файлы из `siteDir`; `/` отдаёт `index.html`; путь за пределы `siteDir` → 404. Порт 0 в тесте даёт свободный порт.

Данные стенда (вымышленные): группы `01-1` (курс 1), `02-1` (курс 2), `03-1` (курс 3), по 22 студента с номерами `S1001…`, `S2001…`, `S3001…`; сотрудники `admin` (admin), `dean` (dean, teacher), `prorector` (prorector), `teacher1`, `teacher2`, `teacher3` (teacher); аудитории `101`, `204`, `305`; предмет «Информатика» у `teacher1` во всех трёх группах. У всех `mustChangePassword = false`, кроме студента `S1002`.

`.claude/launch.json`: конфигурация `journal-dev`, `runtimeExecutable: "node"`, `runtimeArgs: ["dev/server.js"]`, `port: 5173`.

- [ ] **Step 1: тесты.**

```js
const srv = startDevServer({ port: 0, dataFile: tmpFile, siteDir: tmpSite });   // в tmpSite лежит index.html с текстом 'HELLO'
const post = body => fetch(srv.url + '/api', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body }).then(r => r.json());
assert.equal((await post(JSON.stringify({ action: 'auth.login', data: { login: 'admin', password: DEV_PASSWORD } }))).ok, true);
assert.equal((await post('мусор')).error.code, 'bad_request');
assert.match(await (await fetch(srv.url + '/')).text(), /HELLO/);
assert.equal((await fetch(srv.url + '/..%2Fpackage.json')).status, 404);
assert.equal(seededStore.list('students').length, 66);
assert.equal(seededStore.list('subjects').length, 3);
```

- [ ] **Step 2:** падает. **Step 3:** написать. **Step 4:** зелёное.
- [ ] **Step 5:** коммит `feat: local dev server with seed data`.

---

### Task 9 (Э): сайт — вход, язык, главная

**Files:** Create `site/index.html`, `site/config.js`, `site/css/app.css`, `site/js/main.js`, `api.js`, `session.js`, `router.js`, `i18n.js`, `site/js/i18n/ru.js`, `ky.js`, `en.js`, `site/js/views/login.js`, `changePassword.js`, `home.js`. Test: `tests/i18n.test.js`, `tests/router.test.js`.

**Interfaces — Consumes:** действия `auth.*`, `user.setLang`, `teacher.mySubjects`, `i18n.overrides`; `user.permissions`.

**Produces:**

```js
// site/config.js
export const API_URL;       // '/api' на localhost и 127.0.0.1, иначе адрес Apps Script (заполняется в Task 12)
// site/js/i18n.js
export function translate(dicts, lang, key, params);   // dicts: { ky, ru, en }; нет ключа в lang -> ru -> сам key; '{name}' подставляется из params
export function t(key, params); export function getLang(); export function setLang(lang); export function applyOverrides(rows);
// site/js/api.js
export class ApiError extends Error {}                  // .code, .fields
export async function call(action, data);               // -> data; бросает ApiError; сеть упала -> code 'network'; 'unauthorized' -> очистить сессию и на вход
// site/js/session.js
export function getToken(); export function getUser(); export function setSession({ token, user }); export function clearSession();
// site/js/router.js
export function resolveRoute(hash, user);               // -> { view, params } ; чистая функция
// каждый экран: export function render(root, params)
```

Правила `resolveRoute`: нет пользователя → `login`; `mustChangePassword` → `changePassword` при любом адресе; `#/dir/<table>` → `directory`, только если в `permissions` есть `dir.list:<table>`, иначе `home`; `#/import` → `import`, только если есть хоть одно `import.apply:*`; всё остальное → `home`.

Экраны:

- **Вход:** логин, пароль, кнопка, переключатель KG | RU | EN. Ошибка `bad_credentials` — одной строкой под формой.
- **Смена пароля:** старый, новый, повтор. Ошибки `too_short`, `same_as_login`, `too_simple` — у поля.
- **Главная:** имя, выход, переключатель языка. Сотрудник с несколькими ролями видит переключатель роли; он меняет только меню. Меню строится из `permissions`. Преподаватель видит «Мои предметы» (`teacher.mySubjects`). Студент видит имя, группу и заглушки будущих разделов.
- Язык: до входа — из `localStorage`, иначе `ky`. После входа — `user.lang`; переключение вызывает `user.setLang`. Правки из листа «Переводы» подгружаются при старте и не задерживают показ страницы.

Вид: студенческие экраны рассчитаны на телефон шириной 360 px, кнопки не ниже 44 px, текст не мельче 16 px; экраны сотрудников — на ноутбук. Цвета и шрифты выбирает агент по навыку `frontend-design`; светлая тема.

- [ ] **Step 1: тесты.**

```js
import { translate } from '../site/js/i18n.js';
import ru from '../site/js/i18n/ru.js'; import ky from '../site/js/i18n/ky.js'; import en from '../site/js/i18n/en.js';
assert.deepEqual(Object.keys(ky).sort(), Object.keys(ru).sort());
assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
assert.equal(translate({ ky: {}, ru: { a: 'Привет, {name}' }, en: {} }, 'ky', 'a', { name: 'Айгерим' }), 'Привет, Айгерим');
assert.equal(translate({ ky: {}, ru: {}, en: {} }, 'ky', 'нет.ключа'), 'нет.ключа');
for (const code of ['bad_credentials', 'unauthorized', 'forbidden', 'invalid', 'in_use', 'internal', 'network', 'must_change_password',
  'required', 'too_long', 'bad_value', 'duplicate', 'bad_ref', 'last_admin', 'too_short', 'same_as_login', 'too_simple', 'too_many_rows'])
  assert.ok(ru['error.' + code], code);

import { resolveRoute } from '../site/js/router.js';
const dean = { mustChangePassword: false, permissions: ['dir.list:groups', 'import.apply:groups'] };
assert.equal(resolveRoute('#/dir/groups', null).view, 'login');
assert.equal(resolveRoute('#/dir/groups', { ...dean, mustChangePassword: true }).view, 'changePassword');
assert.deepEqual(resolveRoute('#/dir/groups', dean), { view: 'directory', params: { table: 'groups' } });
assert.equal(resolveRoute('#/dir/staff', dean).view, 'home');
assert.equal(resolveRoute('#/import', dean).view, 'import');
assert.equal(resolveRoute('#/import', { mustChangePassword: false, permissions: [] }).view, 'home');
assert.equal(resolveRoute('#/что-то', dean).view, 'home');
```

Модули `i18n.js` и `router.js` не обращаются к `document` и `localStorage` при загрузке, иначе тест в Node не запустится. Словари — `export default { 'ключ': 'фраза', ... }`.

- [ ] **Step 2:** падает. **Step 3:** написать сайт. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** на `npm run dev`: вход `admin`, `dean`, `teacher1`, `S1001` с паролем стенда; `S1002` попадает на смену пароля и после смены — на главную; переключение языка меняет все надписи и сохраняется после перезагрузки; на ширине 360 px нет горизонтальной прокрутки; консоль браузера без ошибок.
- [ ] **Step 6:** коммит `feat: site shell with login, languages and home`.

---

### Task 10 (Э): сайт — справочники и импорт

**Files:** Create `site/js/views/directory.js`, `site/js/views/import.js`, `scripts/vendor.js`, `site/vendor/xlsx.full.min.js`. Modify `site/js/i18n/*.js`, `site/css/app.css`, `site/index.html`. Test: дополнить `tests/i18n.test.js`.

**Interfaces — Consumes:** `dir.*`, `import.*`; `call`, `t`, `getUser` (Task 9); глобальный `XLSX` из `site/vendor/xlsx.full.min.js`.

- **Справочник** (`#/dir/<table>`): таблица строк, поиск по тексту, «Добавить», изменение и удаление в строке. Кнопки показываются только при наличии `dir.save:<table>`. У студентов — фильтр по группе; у студентов и сотрудников — переключатель «активен» и «Сбросить пароль». Ссылки показываются названиями (группа, преподаватель), а не ID. Временный пароль показывается один раз в окне с кнопкой «Скопировать». Ошибки `fields` — у своих полей, `in_use` — сообщением.
- **Импорт** (`#/import`): выбор справочника (только те, где есть `import.apply:<table>`) → «Скачать шаблон» (файл `.xlsx` с заголовками на текущем языке) → выбор файла → первый лист читается через `XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })` → `import.preview` → сводка «новых / изменится / с ошибками» и таблица ошибок с номером строки → «Импортировать N строк» → `import.apply` → итог. Если вернулись `passwords` — таблица «логин, ФИО, пароль» с кнопками «Скачать Excel» и «Печать»; предупреждение, что пароли больше не покажутся.
- Заголовки шаблона берутся из ключей словаря `import.col.<table>.<key>`; их значения должны совпадать с `titles` из `IMPORT_SPECS`.

- [ ] **Step 1:** `npm i -D https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; `scripts/vendor.js` копирует `node_modules/xlsx/dist/xlsx.full.min.js` в `site/vendor/`; запустить его.
- [ ] **Step 2: тест, который падает** — в `tests/i18n.test.js`:

```js
import { IMPORT_SPECS } from '../core/import.js';
for (const [table, spec] of Object.entries(IMPORT_SPECS)) for (const col of spec.columns)
  for (const [lang, dict] of Object.entries({ ru, ky, en }))
    assert.equal(dict[`import.col.${table}.${col.key}`], col.titles[lang], `${lang} ${table}.${col.key}`);
```

- [ ] **Step 3:** написать оба экрана и ключи словаря. **Step 4:** `npm test` зелёное.
- [ ] **Step 5: проверка в браузере** под `dean`: добавить группу, студента (показан временный пароль, им можно войти), изменить, сбросить пароль; удалить группу со студентами — сообщение «используется»; скачать шаблон студентов, вписать 3 строки (одна с несуществующей группой), импортировать: 2 новых, 1 ошибка с номером строки; тот же файл второй раз — 0 новых, 2 изменится, паролей нет. Под `prorector` кнопок изменения нет. Под `teacher1` раздела справочников нет.
- [ ] **Step 6:** коммит `feat: directories and Excel import screens`.

---

### Task 11 (С): Apps Script

**Files:** Create `backend/platform/gasPlatform.js`, `backend/gas/main.js`, `backend/gas/appsscript.json`, `scripts/build-gas.js`, `tests/fakes/fakeGas.js`. Modify `package.json` (dev-зависимость `esbuild`). Test: `tests/gasBundle.test.js`.

**Interfaces — Consumes:** `createSheetsStore`, `ensureSheets`, `handleRequest`, все обработчики, `hashPassword`, `generateTempPassword`.

**Produces:**

```js
// backend/platform/gasPlatform.js
export function createGasPlatform();     // тот же интерфейс, что createNodePlatform; secret() читает свойство скрипта SECRET
// backend/gas/main.js
export function doPost(e);               // e.postData.contents -> handleRequest -> ContentService-ответ JSON
export function doGet();                 // -> { ok: true, data: 'journal' }
export function setup();                 // -> { spreadsheetUrl, adminLogin, adminTempPassword }
// tests/fakes/fakeGas.js
export function createFakeGas();         // -> { globals: { Utilities, PropertiesService, SpreadsheetApp, ContentService, LockService, Logger }, logs: string[] }
```

- `setup()` можно запускать повторно. Нет свойства `SPREADSHEET_ID` → `SpreadsheetApp.create('Журнал колледжа — база')` и запись ID. `ensureSheets`. Нет `SECRET` → `randomHex(32)`. Лист «Сотрудники» пуст → сотрудник `admin` с ролью `admin`, временным паролем и `mustChangePassword = true`. Результат пишется в `Logger.log`; `adminTempPassword` — только если админ создан этим запуском, иначе `null`.
- `gasPlatform`: `Utilities.computeDigest(SHA_256, text, UTF_8)` возвращает байты со знаком (−128…127) — их нужно перевести в hex. `Utilities.computeHmacSha256Signature(value, key)` — сначала значение, потом ключ. `randomHex` строится из `Utilities.getUuid()`.
- `fakeGas` повторяет обе эти особенности: байты со знаком и порядок аргументов. `SpreadsheetApp.create` и `openById` отдают таблицу из `fakeSpreadsheet`.
- Запись в таблицу идёт под `LockService.getScriptLock()` с ожиданием 10 секунд.
- `scripts/build-gas.js`: esbuild, вход `backend/gas/main.js`, `bundle: true`, `format: 'iife'`, `globalName: 'App'`, `target: 'es2019'`, выход `build/gas/Code.js`; в конец дописываются `function doPost(e) { return App.doPost(e); }`, `function doGet(e) { return App.doGet(e); }`, `function setup() { return App.setup(); }`; `appsscript.json` копируется рядом.
- `appsscript.json`: `timeZone: "Asia/Bishkek"`, `runtimeVersion: "V8"`, `exceptionLogging: "STACKDRIVER"`, `webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" }`.

- [ ] **Step 1: тест.** Собрать, выполнить `build/gas/Code.js` в `node:vm` с глобалами из `fakeGas`:

```js
const first = sandbox.setup();
assert.equal(first.adminLogin, 'admin');
assert.match(first.adminTempPassword, /^[a-z2-9]{8}$/);
assert.equal(sandbox.setup().adminTempPassword, null);                          // повторный запуск ничего не ломает
const post = body => JSON.parse(sandbox.doPost({ postData: { contents: body } }).getContent());
const login = post(JSON.stringify({ action: 'auth.login', data: { login: 'admin', password: first.adminTempPassword } }));
assert.equal(login.ok, true);
assert.equal(login.data.user.mustChangePassword, true);
assert.equal(post('мусор').error.code, 'bad_request');
// хэш из fakeGas-платформы равен хэшу из createNodePlatform для тех же пароля и соли
```

- [ ] **Step 2:** падает. **Step 3:** `npm i -D esbuild`, написать. **Step 4:** `npm test` зелёное.
- [ ] **Step 5:** коммит `feat: Apps Script adapter and bundle`.

---

### Task 12 (координатор и владелец): первая выкладка

Делается после приёмки юнита на стенде. Нужны ответы владельца на вопросы 3 и 4 из раздела 13 дизайна. Команды `clasp` ниже сверить с `npx @google/clasp --help`: в версии 3 часть команд переименована. ID скрипта из `.clasp.json` записать в `aidlc-docs/aidlc-state.md`, потому что сам файл в git не попадает.

**Files:** Create `.github/workflows/pages.yml` (выкладывает папку `site/` через `actions/upload-pages-artifact` и `actions/deploy-pages`). Modify `site/config.js`.

- [ ] **Step 1:** владелец включает Apps Script API на `script.google.com/home/usersettings` и входит в Google по команде `npx @google/clasp login` (сам, в браузере).
- [ ] **Step 2:** `npm run build:gas`; `npx @google/clasp create --type standalone --title "Журнал колледжа" --rootDir build/gas`; `npx @google/clasp push`.
- [ ] **Step 3:** владелец в редакторе Apps Script запускает `setup`, подтверждает доступы, читает в журнале выполнения адрес таблицы и временный пароль администратора.
- [ ] **Step 4:** `npx @google/clasp deploy` — первая публикация; её ID записывается в `aidlc-docs/aidlc-state.md`. Дальше всегда `npx @google/clasp deploy -i <ID>`, чтобы адрес не менялся.
- [ ] **Step 5:** адрес веб-приложения — в `site/config.js`; коммит.
- [ ] **Step 6:** владелец создаёт открытый репозиторий на GitHub; `git remote add`, `git push`; в настройках Pages источник — GitHub Actions.
- [ ] **Step 7: проверка на живом сайте:** вход админом, смена пароля, создание группы, импорт трёх вымышленных студентов, вход студентом с телефона. Замерить время входа: больше 2 секунд — уменьшить `HASH_ROUNDS` (формат хэша хранит число повторов, старые пароли продолжат работать).
- [ ] **Step 8:** обновить `aidlc-docs/aidlc-state.md`: юнит 1 выложен.

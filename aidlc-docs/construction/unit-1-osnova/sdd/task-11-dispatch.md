# Task 11 — what the controller required on top of the plan's brief

The implementer of Task 11 (commits 85a0723 and b23494f) was given these requirements in addition to `plan.md` Task 11. The reviewer of Task 11 must be given them too.

## Apps Script adapter

- `backend/platform/gasPlatform.js` and `backend/gas/main.js` are the only files allowed to touch Apps Script globals (`Utilities`, `PropertiesService`, `SpreadsheetApp`, `ContentService`, `LockService`, `Logger`); they use them as globals. `now()` may use `Date.now()` there.
- Bytes → hex: `Utilities.computeDigest` and `computeHmacSha256Signature` return signed bytes; convert with `(b & 0xff).toString(16).padStart(2, '0')`. `Utilities.Charset.UTF_8` is passed to both. Argument order of `computeHmacSha256Signature` is `(value, key)`.
- `randomHex(bytes)` is built from `Utilities.getUuid()` values hashed with SHA-256.
- Script properties: `SPREADSHEET_ID`, `SECRET`. `secret()` throws if `SECRET` is missing.
- `doPost(e)`: missing `SPREADSHEET_ID` or `SECRET` → `{ ok: false, error: { code: 'not_configured' }, serverTime }`. Otherwise `SpreadsheetApp.openById`, store with a `withLock` using `LockService.getScriptLock()`, `waitLock(10000)`, release in `finally`; `handleRequest(e.postData.contents, ctx)` with `log` → `console.error`; response via `ContentService.createTextOutput(JSON).setMimeType(ContentService.MimeType.JSON)`. Missing `e.postData` → empty body → `bad_request`. `doPost` never throws: any unexpected error → `{ ok: false, error: { code: 'internal' } }`.
- `doGet()` → `{ ok: true, data: 'journal' }` as JSON text output.
- `setup()`: idempotent; admin row through `normalizeRow('staff', …)` with `fullName: 'Администратор'`, `login: 'admin'`, `roles: 'admin'`, `lang: 'ru'`, `mustChangePassword: true`, `active: true`; returns and `Logger.log`s `{ spreadsheetUrl, adminLogin, adminTempPassword }` (`null` password when the admin already existed); the default first sheet of a newly created spreadsheet is removed if it is empty and not one of ours.
- Build (`scripts/build-gas.js`, exported `buildGas()`, run by `npm run build:gas`): esbuild `bundle: true`, `format: 'iife'`, `globalName: 'App'`, `target: 'es2019'`, `platform: 'neutral'`, entry `backend/gas/main.js`, output `build/gas/Code.js` + three top-level wrapper functions + copied `appsscript.json`. The bundle contains no `require(`, no `node:` import, no `process`.
- `tests/fakes/fakeGas.js`: `Utilities` returning SIGNED byte arrays, `PropertiesService`, `SpreadsheetApp.create/openById` with a default first sheet and `deleteSheet`, `ContentService`, `LockService` recording calls, `Logger.log` → `logs`.
- `tests/gasBundle.test.js`: the brief's assertions plus: bundle-text assertions; `doPost` before `setup()` → `not_configured`; Cyrillic password login after `auth.changePassword`; fake-GAS hashes equal Node hashes (also Cyrillic); balanced locks; `doPost({})` → `bad_request`; default sheet gone after `setup()`; second `setup()` changes nothing.
- No deployment, no `clasp`, no `.clasp.json` in this task.

## Port change (separate commit 85a0723)

The dev stand moved from port 5173 to 5273 (`dev/server.js` default and direct run, `.claude/launch.json`, `CLAUDE.md`, `.claude/agents/journal-screens.md`, tests), because `localhost:5173` on the owner's machine belongs to another project whose service worker hijacks the journal's pages.

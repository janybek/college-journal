# Unit 5 — final review fix wave (one agent)

Final review (opus) over 7c45d12..d0ac2ae: **0 Critical, 1 Important, 4 Minor** (+2 known limits, not fixed). 898/898 tests, build:gas ok.
Probe scripts (run `node <script>.mjs` from that folder; they load the real code from `D:/Журнал колледжа`):
`C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\183794dd-c345-4be3-a16e-109a17690b33\scratchpad\final-u5\`

## Fix in this wave

### I1 (Important). The site cuts a file upload after 3 minutes and says «server unavailable»
- Where: `site/js/api.js:62` (`UPLOAD_TIMEOUT_MS = 180000`), `:77` (`xhr.timeout`), `:84` (`ontimeout = fail` → `server_down`).
- Why wrong: plan line ~222 says the upload needs no client timeout; the known limit (Task 13 Step 7) is the Node server's own 5-minute `requestTimeout`. A 10 MiB file is a 13.98 MB body; on an uplink slower than ~0.62 Mbit/s it cannot arrive in 3 minutes, the student sees «Сервер журнала сейчас недоступен…», and «Повторить» hits the same wall every time.
- Fix (coordinator ruling): `UPLOAD_TIMEOUT_MS = 300000` (not shorter than the server's limit); `ontimeout` rejects with a new error code `upload_slow` (not `server_down`). New dictionary key in all three dictionaries `site/js/i18n/ru.js`, `ky.js`, `en.js` with the same name, near the other `work.upload.error.*` keys — follow how the upload screen maps error codes to `work.upload.error.<code>`; if it maps by that prefix, the key is `work.upload.error.upload_slow`. Texts:
  - ru: «Связь слишком медленная — файл не успел загрузиться. Попробуйте ещё раз при лучшей связи (например, через Wi-Fi).»
  - en: "The connection is too slow — the file did not finish uploading. Try again with a better connection (for example, Wi-Fi)."
  - ky: «Байланыш өтө жай — файл жүктөлүп бүтө алган жок. Байланыш жакшыраак болгондо (мисалы, Wi-Fi аркылуу) кайра аракет кылыңыз.»
  - «Повторить» must still work after this error (same as after `server_down`).
- Test: update `tests/siteApi.test.js:82` (timeout → `upload_slow`; onerror/onabort stay `server_down`); assert the timeout value is ≥ 300000.

### M2. Office macro markers are matched case-sensitively
- Where: `core/files.js:93,103` (`ZIP_MACROS`, `hasBytes`).
- Effect: `.docx` with part `word/VBAPROJECT.BIN` and `.xlsx` with `xl/MacroSheets/` are accepted (200, written to disk). OPC part names are case-insensitive.
- Repro: `p4-server.mjs`, lines «docx VBAPROJECT.BIN upper» and «xlsx MacroSheets mixed case».
- Fix: match the ZIP macro markers case-insensitively (compare ASCII lower-cased bytes). Tests in the core files test: `word/VBAPROJECT.BIN` and `xl/MacroSheets/` (mixed case) → refused like the lower-case ones.

### M3. An assignment title that looks like a dictionary key is translated in the change log
- Where: `site/js/journal.js:172` (`keyed`) and the `work` branch at line ~200 (also `journalLog.js:190` if it shares the logic).
- Effect: a title `work.state.checked` or `journal.col.self` is shown as its translation («проверено», «СРС») instead of the text.
- Repro: `p9-logline-title.mjs`.
- Fix: in the `work` branch translate only `before`/`after` of the `status` field; the assignment title always as text. Test with such a title.

### M4. `spaceAlarm` takes the date from `new Date()`
- Where: `backend/node/files.js:128`.
- Fix: give `spaceAlarm` a `now = clock` parameter as in `backup.js`; no behaviour change. Test optional.

### M5. `work.dropFile` without a files box answers `not_found` instead of `files_unavailable`
- Where: `backend/workFiles.js:45`.
- Fix: first line `if (!files) throw new AppError('files_unavailable')` (Global Constraints). Test: handler without a files box → `files_unavailable`.

## Do NOT fix (known limits → aidlc-state)
- Backup mirror keeps never-submitted/dropped uploads forever (up to 200 MiB/day per student); the low-space alarm catches it.
- After `serve:restore` from an older copy, files uploaded after the last daily copy become orphans and the sweep removes them an hour later.
- All other deferred minors: leave (table in the review report; T11 maxlength — closed, server also counts UTF-16).

## Rules
- Commit only your files by name (no `git add -A`), `git status` clean afterwards; `npm test` and `npm run build:gas` green.
- Do not start the stand on 5273 unless needed; never touch 5173/5373, `dev/data/real.json`, `D:\Журнал колледжа — сервер`, `D:\Журнал колледжа — данные`, `C:\JournalBackups`. Stop processes only by your own PID, never by program name or window title. Browser only headless Chrome with a temp profile and `--disable-sync --disable-extensions`, never Edge.
- Report: commit(s), test count, what changed per item, anything you could not do.

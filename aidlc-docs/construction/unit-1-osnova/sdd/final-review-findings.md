# Final-review fix wave — unit 1 (one agent, all three findings)

Source: the whole-unit final review (8cf0b22..ca0a6d1). Verdict: ready for owner acceptance after these three fixes. Fix exactly these; do not refactor anything else.

## I-1. Excel auto-conversion reaches the database unnoticed

Where: `site/js/views/import.js` (reading ~362-377, template writing ~455-496), `core/import.js:51-54` (any number becomes text).

Problem: the downloadable templates have General-format cells. In real Excel `01-1` typed into such a cell becomes a date, `0012` becomes 12. The site reads with `raw: true`, so a date arrives as a serial number. Reproduced: a cell `{t:'n', v:46023, z:'d-mmm'}` read back with the site's options gives `[["Название","Курс"],[46023,1]]`; `import.apply` inserts a group named `46023` with no error. In the students file the same cell gives «Такой группы нет» on every row; a card number `0012` is stored as `12` and the student cannot sign in with the number on the card.

Fix:
1. Templates: make every text column text-formatted for a few hundred rows — empty cells `{t:'s', v:'', z:'@'}` (SheetJS CE keeps `z:'@'` on a round trip). Trailing blank rows are already dropped when reading (`import.js` ~375), so the empty cells must not create phantom rows — verify.
2. Reading: detect date cells (e.g. `cellDates: true`, or `cellNF` + `XLSX.SSF.is_date`) and stop with a clear file error naming the row (and column if easy), instead of sending the serial number. New phrase in all three dictionaries `site/js/i18n/ru.js`, `ky.js`, `en.js` with identical keys (Kyrgyz will be proofread by a native speaker later — write your best Kyrgyz).
3. A test for whatever logic can run in Node (e.g. a pure helper that finds date cells / builds the template cells), if the code allows it without a browser.

## I-2. Forced password change accepts the same password

Where: `backend/handlers/auth.js:33-42`; `site/js/views/changePassword.js:32-37`.

Problem: design §5 — the student must change the first password. Now `auth.changePassword { oldPassword: temp, newPassword: temp }` returns `ok: true, mustChangePassword: false`, and the password on the dean's printed list stays valid.

Fix: reject `newPassword === oldPassword` with a field error on `newPassword`, new code `same_as_old`; show it on the change-password screen (dictionary key in ru/ky/en). Also reject a non-string `newPassword` with the existing validation error shape (ledger Task 4 minor, rides along). Tests in `tests/` for both.

## I-3. Import write order and no-op updates

Where: `backend/handlers/import.js:42-51`, `site/js/views/import.js:419-420`.

Problems:
- Temporary passwords are generated and new people inserted (line ~50) before the updates run one by one (line ~51). If any update fails, the answer is `internal`, the new people already exist and their passwords are lost.
- Every existing row is rewritten even when nothing changed: re-importing the same 66 students = 72 full-sheet reads, 132 single-cell writes, 66 lock acquisitions for zero changes.
- The site shows the "some rows may already be in, reset their passwords" explanation only for `network`, not for `internal`.

Fix:
1. Skip `store.update` when the patch equals the stored values; keep the counts (`inserted`/`updated`/...) exactly as they are defined now (the plan's Task 10 expects identical rows to count as «Изменится» — do not change what the preview/result shows).
2. Run the updates first and `insertMany` last.
3. On the site, treat `internal` during apply like `network` (the `applyLost` message).
4. Tests: a failing update leaves no inserted people; re-import of identical rows performs no `update` calls.

## Done means

- `npm test` passes, with the new tests.
- Dictionaries keep identical key sets (an existing test checks this).
- Browser check on the stand (`npm run dev`, http://localhost:5273, port 5273 only): the change-password screen shows the new error; the downloaded groups template opens; importing a file with a date cell shows the new error. Save 2-3 screenshots to `.superpowers/sdd/plan/final-fix-shots/`.
- One commit: `fix: final review — Excel dates, same password, import order`, with your own `Co-Authored-By` line.

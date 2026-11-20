# SDD ledger — plan: aidlc-docs/construction/unit-1-osnova/plan.md

Spec: aidlc-docs/inception/design-v1.md. Repo: D:\Журнал колледжа, branch main.
Contracts handed to subagents: implementer-contract.md, reviewer-contract.md (this folder).
Agent types: journal-logic (Л), journal-server (С), journal-screens (Э); fall back to general-purpose + "read .claude/agents/<name>.md" if the type is not registered. Task reviews: general-purpose with reviewer-contract.md.
Models: implementers sonnet; task reviewers sonnet; final review most capable.

## Rulings before start

- Ruling: work directly on `main`, no worktree — greenfield repo created today, owner approved a plan whose Task 1 commits to main — if wrong: history is local only, can be rebranched.
- Ruling: controller ran `git init`, wrote `.gitignore` (+ `.superpowers/`, `.claude/settings.local.json`) and committed docs as 8cf0b22 so every task has a BASE — Task 1 step 1 skips git init — no cost.
- Ruling: handler registration — `backend/api.js` imports each handler map (`authHandlers`, `dirHandlers`, `importHandlers`) and merges them at load; `registerHandlers` stays exported for tests. Avoids a circular import between api.js and handlers — if wrong: one-file refactor.
- Ruling: `listPermissions(roles)` lists only role-gated permissions (not `public`/`any` actions), so a student gets `[]` — follows Task 3 test.
- Ruling: `passwordProblem` compares password with login case-insensitively — follows Task 3 test.
- Ruling: import `patch` excludes `row` and `uniqueBy` fields — plan text fixed to match Task 6 test.
- Ruling: site shows `error.internal` text for any error code without its own key (`not_found`, `bad_request`).

## Pre-flight scan

| Tasks | Produces vs consumes | Finding |
| --- | --- | --- |
| 1 → 2 | SCHEMA shape, AppError, node platform | agree |
| 1 → 5, 6 | normalizeRow / validateRow(table,row,db) | agree; handlers merge existing row before normalize |
| 2 → 11 | createSheetsStore(schema, platform, ss, withLock), fakeSpreadsheet reused by fakeGas | agree |
| 3 → 4 | hash/token/pv, can, listPermissions | agree after rulings above |
| 4 → 5, 7 | registerHandlers, publicUser, error codes | circular-import risk → ruling above |
| 6 → 7 | parseSheet / planImport | patch vs uniqueBy conflict → plan fixed |
| 6 → 10 | IMPORT_SPECS.titles vs dictionary keys | agree (test in Task 10) |
| 8 → 9, 10 | /api on localhost, DEV_PASSWORD | agree |
| 9 → 10 | call, t, getUser, resolveRoute | agree |

| Task | Own text consistent? |
| --- | --- |
| 1 | yes (error order fixed to schema column order before start) |
| 2 | yes |
| 3 | yes with rulings (case-insensitive login compare, listPermissions scope) |
| 4 | yes; teacher.mySubjects handler absent until Task 5 but `forbidden` check precedes lookup |
| 5 | yes |
| 6 | yes after plan fix |
| 7 | yes |
| 8 | yes |
| 9 | yes; unknown error codes → ruling above |
| 10 | yes |
| 11 | yes |
| 12 | owner-gated, not dispatched |

## Progress
- Task 1: dispatched (BASE bc865fe, general-purpose/sonnet as journal-logic; custom agent types not registered in this session)
- Task 1: implementer DONE_WITH_CONCERNS, commit c405b11, 17/17 tests. Concerns are observations, not correctness:
  - Ruling: `npm test` = `node --test "tests/**/*.test.js"` (Node 24 rejects a bare directory) — plan text was wrong — none.
  - Ruling: platform files are the one place real time enters; `new Date().getTime()` there stands — rule targets core/ and handlers.
  - Ruling: commit trailer names the model that actually wrote the commit (each agent follows its own attribution reminder); contract updated, no amend.
  - Implementer's edge-case calls (accepted unless review objects): empty/unknown groupId → bad_ref; login length outside 3–40 → bad_value; duplicate (name, groupId) in subjects reported on `name`; last_admin on `roles` if role removed else `active`; too_long wins for a field; translations/settings have no rules.
- Task 1: complete (commits bc865fe..c405b11, review clean)
- Task 1: minor (deferred): nodePlatform default clock spelled `new Date().getTime()` — document as the single allowed clock source
- Task 1: minor (deferred): nodePlatform `secret ?? env` accepts '' as a secret
- Task 1: minor (deferred): validate.js bool coercion leaves junk ('' / 'нет') raw, no bad_value for active/mustChangePassword
- Task 1: minor (deferred): `lang` not case-normalised ('RU' → bad_value)
- Task 1: minor (deferred): untested rules — rooms dup/required, subjects pair dup + teacherId bad_ref, staff login length / clash with cardNo / empty roles, AppError, staff defaults
- Task 2: dispatched (BASE c405b11, general-purpose/sonnet as journal-server)
- Task 2: implementer DONE, commit a298da4, 34/34 tests.
  - Ruling: real Sheets turns "0012" into 12 on write → carry into Task 11: `ensureSheets` must set plain-text number format ('@') on every `string` column (whole column), and fakeSpreadsheet must model it — leading zeros in card numbers break login otherwise.
- Task 2: review — spec ✅, quality Needs fixes. Important: (I1) insert writes past the sheet grid with setValues (real Sheets throws; fake grows silently); (I2) string cells written raw — Sheets auto-converts '01-1'/'0012' to date/number, round trip breaks. Entering fix loop.
- Task 2: minor (deferred): memory/file store keep unknown keys and `undefined` for missing columns while sheets store returns null/'' — stores can disagree
- Task 2: minor (deferred): sheetsStore id column assumed `columns[0]` instead of key === 'id'
- Task 2: minor (deferred): sheetsStore.update does one setValues per changed column (slow, non-atomic)
- Task 2: minor (deferred): writeValue('bool','да') writes false
- Task 2: minor (deferred): insert into a sheet with no header / missing schema column fails silently
- Task 2: minor (deferred): fileStore writes in place, corrupt JSON throws raw SyntaxError
- Task 2: minor (deferred): missing tests — sheets insertMany duplicate in batch, caller id on sheets, empty bool, update null, missing header column
- Task 2: fix round 1/5 dispatched and returned DONE, commit 2233cac (38/38 tests); scoped re-review dispatched (FIX_BASE a298da4)
- Task 2: fix round 1/5 (2 addressed, 0 open; commits a298da4..2233cac)
- Task 2: complete (commits c405b11..2233cac, review clean)
- Task 2: minor (deferred): readValue Date→YYYY-MM-DD uses UTC; Sheets dates are midnight in the sheet's zone (Asia/Bishkek is ahead of UTC → one day early). Only a fallback for hand-edited cells.
- Task 2: minor (deferred): insertColumnsAfter branch of ensureSheets has no test
- Ruling superseded: text format for string columns is now done in Task 2, nothing to carry into Task 11 for it.
- Task 3: dispatched (BASE 2233cac, general-purpose/sonnet as journal-logic)
- Task 3: implementer DONE, commit dfb8a17, 51/51 tests. Additions beyond brief: verifyPassword rejects stored rounds > 100000; issueToken throws on unknown kind. Review dispatched.
- Task 3: complete (commits 2233cac..dfb8a17, review clean)
- Task 3: minor (deferred): MAX_STORED_ROUNDS=100000 untested and too high for Apps Script — lower (e.g. HASH_ROUNDS*10) + test
- Task 3: minor (deferred): passwordVersion(undefined) → 'ndefined'; return '' for non-strings
- Task 3: minor (deferred): passwordProblem check order not pinned by tests; null login case
- Task 3: minor (deferred): readToken's blanket catch hides a missing secret — API/setup should check the secret exists
- Task 4: dispatched (BASE dfb8a17, general-purpose/sonnet as journal-server)
- Task 4: implementer DONE, commit d3bf400, 60/60 tests. Notes: added backend/users.js (publicUser + helpers); handlers get user = {id, kind, roles, row} or null; active means row.active === true; setLang invalid returns fields [{field:lang, code:invalid}]. Review dispatched.
- Task 4: ⚠️ items resolved by controller: sheetsStore.update returns the full row incl. id (sheetsStore.js:126); bool columns read as real booleans (sheetsStore.js:13-15). Not gaps.
- Task 4: complete (commits dfb8a17..d3bf400, review clean)
- Task 4: minor (deferred): api.test.js 'internal' test overwrites real dir.list/dir.save in the module-global registry (order-dependent)
- Task 4: minor (deferred): auth.changePassword accepts non-string newPassword (object → "[object Object]")
- Task 4: minor (deferred): unknown login returns without hashing — timing allows login enumeration
- Task 4: minor (deferred): disabled staff row shadows a student with the same login (uniqueness enforced by validate.js on save)
- Task 4: minor (deferred): ctx.platform.now() outside try in handleRequest; registerHandlers accepts non-functions; no test for forbidden-before-must_change precedence
- Task 5: dispatched (BASE d3bf400, general-purpose/sonnet as journal-server)
- Task 5: implementer DONE_WITH_CONCERNS (observations), commit 219d383, 69/69 tests. Changed tests/api.test.js:127 missing-handler example to import.preview — will break again in Task 7 → carry: Task 7 must make that test independent of which handlers exist. dir.remove last_admin branch is unreachable via API (kept as guard, untested). Review dispatched.
- Task 5: ⚠️ items resolved by controller: last_admin via active/role is tested in Task 1 (validate.test.js); dean has import.preview:students per Task 3 matrix. Not gaps.
- Task 5: complete (commits d3bf400..219d383, review clean)
- Task 5: minor (deferred): dir handler guards unreachable via handleRequest are untested (tableOf bad_request, LOGIN_TABLES); update with caller-set mustChangePassword/active untested; dir.list hash check covers staff only
- Task 5: minor (deferred): dir.remove last_admin branch is dead defensive code, untested
- Task 5: Ruling: in_use covers only groups←students/subjects and staff←subjects in unit 1 (plan-mandated) — later units add their own reference checks when their tables appear (pairs, grades, attendance); note carried to aidlc-state for unit 2.
- Task 5: minor (deferred): dir.js:97 passes id/passwordHash undefined into normalizeRow for tables without those columns
- Task 6: dispatched (BASE 219d383, general-purpose/sonnet as journal-logic)
- Task 6: implementer DONE, commit 5ed382b, 79/79 tests. Calls: second file row hitting the same existing row is also `duplicate`; rows with content only in unknown columns are skipped as empty; patch values are normalised (course int). Review dispatched.
- Task 6: ⚠️ items resolved by controller: normalizeRow keeps `id` (schema key) and validateRow treats it as update (Task 1 dispatch + passing students test); validateRow reads only the five tables; subjects duplicate is reported on `name` (Task 1 call). Not gaps.
- Task 6: complete (commits 219d383..5ed382b, review clean)
- Task 6: minor (deferred): ROLE_WORDS/LANG_WORDS lookups see inherited props (`constructor` in roles is dropped silently; in lang becomes a function value) — use Object.create(null)/hasOwn
- Task 6: minor (deferred): test "same existing row twice" actually tests a new row; the update-twice=duplicate behaviour (beyond brief) is untested
- Task 6: minor (deferred): MAX_IMPORT_ROWS counts physical rows incl. blank trailing ones; no boundary test at 2000
- Task 6: minor (deferred): unknownColumns spelling has inner whitespace collapsed; unknown table throws TypeError in parseSheet; working copy hard-codes five tables
- Task 6: minor (deferred): coverage gaps — non-integer numeric cell, unknown-columns-only row, subjects in-file duplicate, planImport insert defaults
- Task 7: dispatched (BASE 5ed382b, general-purpose/sonnet as journal-server)
- Task 7: implementer DONE, commit fe4764c, 82/82 tests. Added withHandlers(map, fn) test seam in api.js (fixes Task 4 deferred minor about registry overwrite); dir.js exports loadDb + issueTempPassword. Review dispatched.
- Task 7: ⚠️ items resolved by controller: parseSheet rejects in-file duplicate keys (Task 6 test, row 6) so planImport never sees them; patch is built only from import-spec columns, which never include passwordHash; no role can reach a table without an import spec, so that bad_request branch is defensive. Not gaps.
- Task 7: complete (commits 5ed382b..fe4764c, review clean)
- Task 7: minor (deferred): bad_request for table without spec untested (unreachable via roles); staff branch of import.apply untested; loose assertion `errors.length >= 2`; preview runs planImport even with missingColumns
- Task 7: minor (deferred): passwords are issued before writes — if a later store.update throws, inserted people exist but their one-time passwords are lost (recover via resetPassword)
- Ruling (carry to Task 12): hashing one temp password per imported person at HASH_ROUNDS=500 may be slow on Apps Script — measure a 66-student import on the live deployment; if it is slow, hash temp passwords with fewer rounds (format stores rounds; temp passwords are random and must be changed at first login).
- Task 8: dispatched (BASE fe4764c, general-purpose/sonnet as journal-server)
- Task 8: implementer DONE, commit efb7d04, 87/87 tests.
  - Ruling: startDevServer is async (returns a Promise of {url, close}) — the real port is known only after listen; the plan snippet omitted await — none.
  Review dispatched.
- Task 8: review — spec ❌. Important: (1) 413 path destroys the socket before responding (client sees ECONNRESET); (2) traversal tests vacuous (targets do not exist); (3) no tests for 405, HEAD, no-store, dir without index, relative path resolution. Reviewer verified by hand that traversal protection itself is correct on Windows. ⚠️ resolved: fileStore creates the parent dir (Task 2 dispatch requirement; tests pass with a missing data/ folder).
- Task 8: Ruling: dev-server-only HTTP error codes `payload_too_large` (413) and `method_not_allowed` (405); body limit becomes a startDevServer option `maxBodyBytes` so the test stays small.
- Task 8: minor (deferred): seed failure midway leaves a half-filled data file (recover with --reset)
- Task 8: fix round 1 dispatched (FIX_BASE efb7d04)
- Task 8: fix round 1/5 (3 addressed, 0 open; commits efb7d04..354b6f6)
- Task 8: complete (commits fe4764c..354b6f6, review clean)
- Ruling (Task 9): the student home must show the group name but students cannot call dir.list → the user object gains `groupName` (string for students, null for staff); Task 9 implementer makes this small change in backend/users.js + handlers with assertions in tests/api.test.js — cross-zone but sequential, no conflict.
- Ruling (Task 9): model opus for the Screens implementer (visual design judgment); localStorage keys journal.token / journal.user / journal.lang / journal.role; all server data rendered via textContent (names come from imported files → XSS risk).
- Task 9: dispatched (BASE 354b6f6, general-purpose/opus as journal-screens)
- Task 9: implementer DONE_WITH_CONCERNS (observations), commit 62625cb, 98/98 tests; browser checks of Step 5 done by the implementer. Added site/js/ui.js (shared DOM helpers); publicUser(row, kind, store) third arg for groupName.
  - Ruling: language picked explicitly on the sign-in screen wins over the account language and is saved to the account after sign-in; the account language applies only when nothing was picked on this device — brief said "after login use user.lang", which surprises a student who just chose RU — to be implemented in Task 10 (same agent zone) unless the review opens a fix round.
- Custom agent types journal-* became available mid-session; using them from here (reviewer still gets reviewer-contract.md for method and output).
- Task 9: review — spec ❌ (error.unauthorized never shown), Important: (I1) camelCase dictionary keys vs "lower-case" in dispatch; (I2) publicUser throws for a student when store is omitted.
  - Ruling: I1 dismissed — the dispatch's own example key was `home.mySubjects`; camelCase segments are allowed, keys stay — costs nothing if wrong (rename is mechanical).
  - ⚠️ resolved: i18n.overrides row shape {key, ky, ru, en} matches (Task 5); Step 5 browser checks re-done by controller on the stand (login KG/RU, dean home, role switch seen working).
- Task 9: minor (deferred): session.js reads memory mirror only when getItem throws — sign-in loops when setItem throws (quota / private mode)
- Task 9: minor (deferred): no tests for api.js network/unauthorized paths, session.js, ui.errorKey; override test asserts only the ky empty cell
- Task 9: minor (deferred): refreshUser may revert a language switched while auth.me is in flight; no fetch timeout in api.js (button stays busy forever)
- Task 9: fix round 1 dispatched (FIX_BASE 62625cb): publicUser guard, unauthorized message on login, device language choice wins (controller ruling)
- Finding (controller, live demo): localhost:5173 is owned by the owner's other project «Прораб» (Vite + a registered service worker), which hijacks the journal's pages in any browser that opened Прораб; preview_start by name also launched Прораб's server. Ruling: the journal's dev port moves to 5273 (dev/server.js default + direct run, .claude/launch.json, CLAUDE.md, agent files, tests) — carry into Task 11 dispatch (server agent).
- Task 9: fix round 1 returned DONE, commit 562716d (99/99 tests); scoped re-review dispatched (FIX_BASE 62625cb)
- Task 9: fix round 1/5 (3 addressed, 0 open; commits 62625cb..562716d)
- Task 9: complete (commits 354b6f6..562716d, review clean)
- Task 9: minor (deferred): chooseLang no longer returns early when the clicked language equals the current one (one extra user.setLang at most)
- Task 10: dispatched (BASE 562716d, journal-screens/opus)
- OWNER CHANGE (mid-run): the owner wants the site to look like the "Nexus UI" admin template (demo.templatemonster.com/demo/570799.html → nexus-ui-template-phi.vercel.app). Supersedes the green/gold look accepted earlier.
  Reference measured by controller: dark theme default — background oklch(16% .02 260), card oklch(21% .025 260), sidebar oklch(19% .025 260), muted oklch(26% .025 260), border white/8%, input border white/12%, foreground oklch(96% .01 240), muted text oklch(68% .02 260), primary oklch(0.62 0.2 255), success oklch(70% .18 150), warning oklch(82% .18 85), destructive oklch(70% .2 22), radius 0.75rem (controls 10px). Light theme — background oklch(99% .005 240), card white, sidebar oklch(98% .005 240), muted oklch(96% .01 240), border oklch(92% .01 240), foreground oklch(18% .02 260), muted text oklch(52% .02 260), same primary. Font Inter Variable; body 14px in tables, h1 30px/700, th 12px/600 muted, td padding 12px 8px. Layout: left sidebar with grouped nav + user block at the bottom, top bar with search and theme toggle, pill status badges, avatar circles with initials, centred login card with a blue glow behind it.
  - Ruling: Task 10 (running) finishes in the current style — its value is behaviour; then a new Task 10b "restyle to the reference" (journal-screens/opus) reworks tokens, shell layout and components for all screens; own CSS only, no template code or assets; Inter is self-hosted (OFL) with font-display: swap; both themes with a toggle, dark by default (pending owner's answer); the future projector/QR view stays light. Student phone screens keep ≥16px text and 44px targets regardless of the reference's 14px.
- Owner answered: both themes, dark default. Task 10b brief written to task-10b-brief.md (not in plan.md numbering; dispatch after Task 10 passes review). Contracts updated: self-hosted fonts allowed, still nothing from another origin.
- Task 10: implementer DONE_WITH_CONCERNS, commit 1dff1ec, 102/102 tests; Step 5 browser checks done by implementer (clipboard success path, real file save and printing not checkable in the pane). Extras: reset password asks for confirmation; CSV read as UTF-8 or Windows-1251 with raw:true; fake .xlsx reported unreadable; directoryConfig.js split.
  - Ruling (plan defect, mine): Kyrgyz title of the group column — site says «Топ», core/import.js says «Тайпа»; «Топ» is the word used for a student group. Fix after Task 10 review: ky title becomes «Топ», «Тайпа» stays accepted as an alias (IMPORT_SPECS column gets optional `aliases`), dictionaries and tests follow. Kyrgyz texts need the owner's/native proofreading — raise at acceptance.
- Task 10: ⚠️ resolved: Step 5 browser scenarios were run by the implementer (report); print/clipboard-success/real download could not be exercised in the pane — carried to the final acceptance checklist for the owner's own browser.
- Task 10: complete (commits 562716d..1dff1ec, review clean)
- Task 10: minor (→ folded into Task 10b dispatch): XLSX loader not reset when script loads but window.XLSX is undefined; import.js imports officeNav/permissions from directory.js (move to shared module); print rules rely on :has()
- Task 10: minor (deferred): unrequested extras (index tabs, per-column hints, import.matchBy.*) — harmless
- Task 10b: dispatched (BASE = docs commit after 1dff1ec, journal-screens/opus) — restyle to the reference + «Топ» title with «Тайпа» alias in core/import.js (explicitly allowed cross-zone change)
- Task 10b: implementer DONE_WITH_CONCERNS (deviations for contrast: buttons #006de2 instead of reference #0c84fa; darker status colours in light theme; table layout with avatar+secondary line, status column, icon actions; directory tabs replaced by sidebar; CSS split app.css + screens.css), commit c76e4a9, 108/108 tests. Review dispatched.
- Task 10b: ⚠️ resolved by controller: screenshots 01 and 08 viewed — layout matches the reference, Kyrgyz ө/ү/ң render in Inter on the login screen; remaining browser claims are the implementer's (22 screenshots in task-10b-shots/). Print, clipboard success and real downloads stay on the owner's acceptance checklist.
- Task 10b: complete (commits b074b49..c76e4a9, review clean)
- Task 10b: minor (deferred): status text is part of a row's searchable text («активен» matches «Не активен» too)
- Task 10b: minor (deferred): sidebar rebuild drops focus from a nav link after a language/theme click; input :focus relies on border + soft ring (check light theme)
- Task 10b: minor (deferred): directory listing lost its (unreachable) load-error line — needed if a later task reloads while keeping rows
- Task 11: dispatched (BASE c76e4a9, journal-server/sonnet) + dev port move to 5273
- Owner accepted the restyled look (after seeing 6 screenshots). TODO for controller after Task 11 lands (agent is editing these files now): update .claude/agents/*.md — fonts rule (self-hosted allowed) and the Co-Authored-By line (each agent uses its own attribution); commit aidlc-state.md.
- Task 11: implementer DONE_WITH_CONCERNS, commits 85a0723 (port 5273) + b23494f (Apps Script adapter and bundle), 117/117 tests. Concerns: no real RED run (implementation written before the test; mutation check instead — removing `& 0xff` fails 3 of 9 tests); charset argument of computeHmacSha256Signature and nested-lock behaviour cannot be verified without real Google; fakeSpreadsheet gained getSheets/deleteSheet.
- Task 11: REVIEW NOT YET DISPATCHED — owner asked to save state and restart the session on another model. Review package is ready: review-c76e4a9..b23494f.diff (BASE c76e4a9, HEAD b23494f). NEXT STEP for the resuming controller: dispatch journal-reviewer with reviewer-contract.md, task-11-brief.md, task-11-report.md and that package; controller's extra requirements for Task 11 are listed in aidlc-docs/construction/unit-1-osnova/sdd/task-11-dispatch.md.
- Session resumed (20.11.2026, new chat on Opus 5.5): controller dispatching Task 11 review (journal-reviewer/sonnet), package review-c76e4a9..b23494f.diff
- Ruling: state step 3 (agent files: fonts rule + own Co-Authored-By) already landed in ca0a6d1 — verified by grep — skip it; costs nothing if wrong (one-line edits).
- Task 11: review — spec ✅, quality Approved, 0 Critical/Important.
  - ⚠️ resolved: real Apps Script behaviour (HMAC charset arg, lock semantics, console.error routing, default sheet name in the owner's locale) cannot be checked without Google — carried to Task 12 (deployment): run setup() and a login on the live script and look at the sheets.
  - ⚠️ resolved: no RED run (implementation before test); mutation check (removing & 0xff fails 3/9) accepted as substitute — Ruling: accept — tests exercise the real bundle — costs a weaker guarantee on one test file.
- Task 11: complete (commits c76e4a9..b23494f, review clean)
- Task 11: minor (deferred): gasBundle.test.js lock-on-failure test never asserts the failing call took the lock (waits grew)
- Task 11: minor (deferred): default sheet recognised only as Лист1/Sheet1 — other locales keep an empty stray sheet
- Task 11: minor (deferred): setup() writes SECRET and admin row without the script lock (double admin on two simultaneous runs)
- Task 11: minor (deferred): login = 500 computeDigest calls on real GAS, maybe 0.5–2 s (plan-mandated rounds) — measure at Task 12
- Task 11: minor (deferred): fakeGas.js two separate node:crypto imports
- Final review: dispatched (8cf0b22..ca0a6d1, package review-8cf0b22..ca0a6d1.final.filtered.diff excluding site/vendor, package-lock, ledger-snapshot). Ruling: final reviewer on fable (listed first = most capable model) — CLAUDE.md asks for the strongest model — if unavailable, fall back to opus; costs only time.
- Final review: returned (fable) — Yes after fixes; Critical 0, Important 3 (I-1 Excel dates/leading zeros reach the DB, I-2 forced change accepts the same password, I-3 import inserts before updates + rewrites unchanged rows + internal not shown as applyLost), Minor 6. npm test 117/117. Reviewer could not write its report file (its own rules); controller saved the findings to final-fix-brief.md.
  - Deferred minors triage: all leave except Task 7 line 115 (folded into I-3). Task 4 non-string newPassword rides along with I-2.
  - Carry forward (not fixed now): M-1 two background requests per page load (cache overrides, no auth.me each load) → unit 3; M-2 staff can reset/deactivate themselves → later; M-3 teacher role removable while assigned to subjects → later; M-4 setup() does not set spreadsheet time zone/locale → unit 2 with readValue UTC item; M-5 check on live Sheets that names starting with = or + stay text → Task 12; M-6 huge !ref range may freeze the tab → later. Unit 2 first task: memory-store row shapes by schema + contract tests against sheets store (Task 2 line 64).
  - Owner question raised by reviewer: no sign-in attempt limit until unit 3 while the script URL is public after Task 12 — owner decides whether real student lists go in before unit 3.
  - Ruling: one fix wave to journal-screens/opus, allowed to touch backend/handlers/auth.js, backend/handlers/import.js and tests besides site/ — skill wants ONE fixer with the full list, I-1/I-3 are mostly site, opus can do the small backend parts; no other agent is active — costs nothing if wrong.
  - Ruling: new error texts (date cell in Excel, same password) are bug fixes within design §5/§7, shown to the owner at acceptance rather than asked first — costs a wording change if the owner dislikes them.
- Final fix wave: dispatched (FIX_BASE ca0a6d1, journal-screens/opus), brief final-fix-brief.md
- Final fix wave: implementer DONE_WITH_CONCERNS, commit 2e97f68, 125/125 tests (8 new). Concerns: a date cell anywhere on the first sheet stops the file (even in an ignored column, e.g. birth date) — message names row/column and says to delete it; old files where Excel already turned 0012 into 12 cannot be detected; new site/js/excel.js (pure helpers testable in Node); import.apply.lost first sentence reworded (was "connection dropped", wrong for internal); non-string newPassword → field code invalid. Checked on the stand and in real Excel 16 (new template keeps 01-1 and 0012 as text).
  - Ruling: keep the strict date check for acceptance — safer than silently importing a serial number; site does not know all header aliases — show the owner; costs one small change if the owner keeps birth-date columns in their files.
- Final fix wave: scoped re-review dispatched (journal-reviewer/sonnet, FIX_BASE ca0a6d1..2e97f68)
- Final fix wave: re-review — I-1, I-2, I-3 ADDRESSED; no new Critical/Important. Controller viewed the 3 screenshots (same-password error, date-cell error, filled template passes).
  - minor (deferred): site/js/excel.js findDateCell scans every cell of !ref — huge declared range may hang the tab (same family as M-6)
- Final review: complete (8cf0b22..2e97f68). Unit 1 ready for owner acceptance on the stand.
- OWNER ACCEPTED unit 1 on the stand (20.11.2026). Next: Task 12 deployment with the owner.
- Task 12: clasp login as the owner-confirmed college account; Apps Script project created and pushed (scriptId in aidlc-state.md).
- Task 12: deployment @1 created (id in aidlc-state.md); live: GET ok, bad action → bad_request, wrong password → bad_credentials (setup ran). Timing: empty ≈2.2 s, login 3.3–4.9 s. site/config.js gets the URL; .github/workflows/pages.yml publishes site/.
- Task 12: owner chose to hide the author email: history rewritten (filter-branch, trees identical) to janybek@users.noreply.github.com; local user.email set; old→new ids in aidlc-docs/commit-map.md. Account email removed from aidlc-state.md.
- Task 12: site live on GitHub Pages; fetch from the Pages origin to the web app works (i18n.overrides ok, ~2 s). Left: owner's live check (step 7) + hash-rounds decision.

# Unit 6 — final review fix wave (one agent)

Final review (opus, strict) over d70166d..72b857e: **0 Critical, 2 Important, 3 Minor** + 4 small screen items below. 1164/1164 tests (9 runs, flaky test not found), build:gas ok.
Probe scripts (run `node <script>.mjs` from that folder; they load the real code from `D:/Журнал колледжа`; helper `lib.mjs`):
`C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\8bf64c20-4db0-4819-b011-aba6488089a4\scratchpad\final-u6\`

Plan: `aidlc-docs/construction/unit-6-vedomosti/plan.md` (Global Constraints, Review Focus 2 and 6, «Кто что может менять»). Contract: `implementer-contract.md` in this folder.

## Fix in this wave

### I1 (Important). A new syllabus version takes the protection off a closed unit
- Where: `core/syllabusFlow.js:76-100` (`checkHeld` compares neither the unit nor `planSemester`), `backend/syllabusFlow.js:25-34` (`examine` does not read «Закрытые юниты»), same file `approveSyllabus` 51-75.
- Why wrong: Global Constraints — a closed unit is not changed by anyone directly, every write path answers `unit_closed`; Review Focus 2.
- Effect: (A) a version that moves the topic of a held pair from unit 1 to unit 2 passes; after approval the pair leaves closed unit 1 — numbers of the closed unit change (a2: ТК 20 → 0, total 57 → 37) and the marks of that pair are editable directly again. (B) a version with another `planSemester` (1 → 3) loses all closures: the final is open, the exam disappears from the ledger and from the student.
- Repro: `probe-closed.mjs`, blocks (A), (A2), (B).
- Fix (coordinator ruling):
  1. `examine` reads the closures. For every held pair (`FIXED_STATUSES`) of a subject whose unit is closed now (closure in force, not reopened), the copy of its topic in the new version must have the same unit; otherwise error `{ section: 'plan', code: 'held_closed', name, date }`.
  2. A change of `planSemester` is refused while subjects of this version (this teacher + discipline, all their groups) have closures in force or exam attempts in the previous `planSemester`: error `{ section: 'title', code: 'semester_closed' }` (use the section the title fields already use in `checkSubmit` if it is named differently).
  3. The refusal acts on «Отправить» (submit) AND on «Утвердить» (approve, including the dean approving for the teacher) — whatever paths call `examine`/`checkHeld` today; check both.
  4. After the admin reopens the unit (closure no longer in force), the same version passes.
- Dictionary texts (all three dictionaries, same key names; follow how `held_kind`/`held_missing` are mapped — both `syllabus.error.<code>` and `sform.checks.<section>.<code>` families, whichever the site actually uses for these codes):
  - `held_closed`
    - ru: «Тема «{name}» уже проведена ({date}) в закрытом юните — переносить её в другой юнит нельзя. Верните прежний юнит.»
    - en: "The topic “{name}” was already held ({date}) in a closed unit — it cannot move to another unit. Put it back in its unit."
    - ky: «"{name}" темасы жабылган юнитте өтүлгөн ({date}) — аны башка юнитке которууга болбойт. Мурунку юнитке кайтарыңыз.»
  - `semester_closed`
    - ru: «Семестр менять нельзя: в группах по этой дисциплине уже закрыты юниты или есть результаты экзамена. Верните прежний семестр.»
    - en: "The semester cannot be changed: units are already closed or exam results exist in the groups of this discipline. Put back the previous semester."
    - ky: «Семестрди өзгөртүүгө болбойт: бул дисциплина боюнча топтордо юниттер жабылган же экзамендин жыйынтыктары бар. Мурунку семестрди кайтарыңыз.»
- Tests (in the syllabus flow API test file): approving such a v2 → refused (`approved: false` / the error code), pairs, topics and syllabuses unchanged by snapshot; same for a `planSemester` change; after the admin reopens the unit the approval passes; submit is refused the same way.

### I2 (Important). After the teacher changes to one without an approved syllabus, closures and the exam disappear and the student sees «Не допущен»
- Where: `backend/ledgerData.js:46-48, 78-88` (`planSemester` from the new teacher's syllabus; none → `null`); `backend/studentGrades.js:72-73, 108, 118` (`closedOfSubject` finds the final by pairs, `finalOf` looks up attempts by `planSemester` = `null`).
- Why wrong: Review Focus 6, table «Кто что может менять» (deferred minor of task 13 (б)).
- Effect: units and the final shown open in the ledger, no exam; the student gets `final.status: 'not_admitted'` though passed with 82 «хорошо». The pair itself stays protected.
- Repro: `probe-closed.mjs`, block (C).
- Fix (coordinator ruling — the first option, no new refusal for users): when there is no syllabus in force, take `planSemester` from the subject's held pairs and closures (as `closedOfSubject` already finds them) — in `journalView`, `ledgerView` and `studentGrades` alike; one shared helper, not three copies.
- Test: change the teacher after `closeFinal` → `ledger.get` still shows everything closed and exam 35; `student.grades` gives `final.status: 'done'` and total 82.

### M1. «025» in a request
- Where: `backend/requestData.js:126-128, 143` — «стало» stored and compared as raw text. «25 → 025» is accepted, goes through two approvals and writes an empty log line (25 → 25).
- Repro: `probe-requests.mjs`, last check.
- Fix: store and compare the normalized text (`pointsText`, `markText`, `examText`) against «было». Tests: «025» with «было» 25 → `after: same` refusal; «031» stored as «31».

### M2. A pair of a closed unit can be returned from «не проведена»
- Where: `backend/journalData.js:620` — `reopenPair` checks the closed unit only for status `closed`. Dean returns a `missed` pair of a closed unit to `planned`: a past planned pair appears in a closed unit and cannot be marked.
- Repro: `probe-closed.mjs`, block (D).
- Fix: `unit_closed` for any pair of a closed unit in `reopenPair`, and the same in `missPair`. Tests for both.

### M3. Two `.check` rules fight
- Where: `site/css/screens.css:7260` (layout of the unit 5 assignment screen) overrides `site/css/app.css:890` — the shared checkbox from `ui.js:161`. Wider than 768 px every checkbox (also in the close-unit windows) becomes a grid with a 16 rem first column.
- Fix: rename the layout class in `site/js/views/task.js:115` and in `screens.css` to `.task-check`. Check no other user of that layout rule.

### Small screen items (deferred minors, ruled «fix in this wave»)
- S1 (task 21): the request button on the assignment screen is shown by matching the full name with `assignment.teacherName`. Add a flag `can.request` to `work.get` when the unit is closed (`backend/workData.js` ~278, as `ledger.get` does) and use it in `site/js/views/task.js:352-354`. Test on `work.get`: subject teacher → true, dean/other teacher → false/absent.
- S2 (task 24): `site/js/views/ledger.js:419` — «07» against 7 counts as a change and asks for a reason; compare as numbers (same in the state exam screen if it has the same check).
- S3 (task 25): `site/js/views/announcements.js:130` — after «Убрать», when the «new» button is absent, focus goes nowhere; focus the list heading (`announce-heading`, `tabindex="-1"`).
- S4 (task 26): a failed `announce.list` on the student home is shown as «Объявлений нет»; show the usual error text instead (the shared error helper the other blocks use).

## Not fixed (known limits — coordinator records them in aidlc-state.md «Выкладка»)
- After saving «Баллы и журнал» on the old code (`caf33d8`) the threshold stays 76.
- The old code edits closed units directly again.
- The old `dir.remove` deletes a student who has only a state exam result; the result row stays without a person.
- `lesson.mine` with `unit_closed` has no hint on the home screen (the text `error.unit_closed` shows on pressing).
- A dropped student with a score: the score cannot be corrected from the screen.

## Flaky test
Not found (9 runs). Suspects outside unit 6: `tests/server.test.js:67,79` (fixed 100/500 ms pauses), `tests/supervisor.test.js` (process restart wait), `tests/checkinLoad.test.js:82` (< 5000 ms). Do not change them in this wave.

## Outcome (25.11.2026)
- Fix wave: `0df6112` (one agent, journal-server/sonnet): I1, I2, M1–M3, S1–S4. Re-review (same opus reviewer): all ADDRESSED, RED of 8 new tests confirmed on 72b857e, all earlier probes repeated clean; probe blocks A/A2/B of `probe-closed.mjs` write the past-approval state directly and stay FAIL by design — the real API refuses (`probe-closed-api.mjs` 11/11).
- N1 (new, minor): `ledger.list` without a syllabus after a teacher change showed the final as open → fixed `192bcbe` (closures from the closures table, pairs not read), accepted by the coordinator (diff, 1172 tests, build:gas, `probe-wave.mjs` 5/5).
- New known limit: with exam rows in the previous half, a wrong `planSemester` in the syllabus cannot be corrected even after reopening the units.
- Side effect (improvement): without a syllabus and without closures the journal shows the unit results of the previous half from the held pairs; saving results still answers `no_syllabus`.

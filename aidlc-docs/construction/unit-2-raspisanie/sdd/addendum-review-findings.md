# Unit 2 addendum fix wave (one agent)

Source: final review of the addendum (b28e929..9f7826d). Verdict: ready for the owner's re-check after C1. Probe scripts: `C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\f6c79be9-d6ff-4aec-aac6-18a738671229\scratchpad\probe1.mjs` (C1 reproduction).

## C1 (Critical). A teacher can add a topic to another teacher's subject
`backend/handlers/dir.js:76-81`: the ownership check looks the subject up by the raw `input.subjectId` (line ~77); the row is cleaned only afterwards by `normalizeRow` (~81), which trims strings and turns `['sb_x']` into `'sb_x'`. A non-canonical id finds no subject, so the check is skipped as "unknown subject, leave it to validateRow"; after cleaning the id is valid and the row is inserted.
Reproduced through `handleRequest`, teacher1 against teacher2's subject `sb2`: `subjectId: 'sb2'` → forbidden (correct); `['sb2']` → topic created in sb2; `' sb2 '` → topic created in sb2. `relayout` then shifts the colleague's topics.
Fix: do the check after `normalizeRow`, on the value that is validated and stored, still before `validateRow`:
```js
const row = normalizeRow(...);
if (table === 'topics') {
  const subject = db.subjects.find((r) => r.id === (old ? old.subjectId : row.subjectId));
  if ((subject || old) && !canEditSubjectTopics(user, subject)) throw new AppError('forbidden');
}
```
Tests next to `tests/syllabusApi.test.js:106`: `subjectId: ['sb2']` and `' sb2 '` from teacher1 → `forbidden`, and no topic of sb2 is created. Keep: new topic with a truly unknown subject → `bad_ref`; orphan topics → admin/dean only.

## M2. Dean: Back from «Загрузка силлабуса» lands on the first subject
`site/js/views/topics.js:363` (`chooseSubject` does not put the subject into the address) and `site/js/views/import.js:131-149` (no link back to the subject until the import finishes). Scenario: «Темы» → pick the 30th subject → «Загрузить силлабус (Excel)» → Back → first subject.
Fix: put the chosen subject into the address on `chooseSubject` (`#/topics/<id>`, the route already exists) so browser Back returns to it, AND show a «К темам предмета» link in step 1 of the syllabus upload (`subjectHref` exists at `import.js:334`). Reuse existing dictionary keys where possible; any new key in ru/ky/en.

## Done means
- `npm test` passes with the new tests; `npm run build:gas` builds.
- Browser check of M2 on the stand (`npm run dev:reset`, port 5273 only, stop it after): dean picks a later subject → upload → Back → same subject; the step-1 link works.
- One commit: `fix: topic ownership checked on the cleaned subject id, way back from the syllabus upload`, your own `Co-Authored-By`. Stage only your files; `git status` clean.

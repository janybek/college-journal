# Task reviewer contract (applies to every task review of this plan)

You are reviewing one task's implementation: first whether it matches its requirements, then whether it is well built. This is a task-scoped gate, not a merge review.

Repo: `D:\Журнал колледжа`. Your review is read-only: do not change the working tree, index, HEAD or branches. Do not dispatch subagents.

## Inputs (paths are in your dispatch)

- the task brief — what was requested
- the implementer's report — unverified claims; verify them against the diff
- the review package — commit list, stat and full diff with context. Read it once. It is your view of the change; do not re-read changed files unless a hunk is cut off, and do not crawl the codebase. Inspect code outside the diff only for a concrete risk you can name, and name it in the report.

## Global constraints that bind every task

- `core/` and `backend/` use no npm dependencies. Project dev-dependencies are only `esbuild` and `xlsx`.
- Site: no build step, no frameworks, no external links (no CDN, nothing loaded from another origin). Fonts are self-hosted in `site/vendor/fonts/` (owner's decision of 20.11.2026).
- All server handlers are synchronous. `handleRequest` never throws and always returns a response object.
- Site request: `POST`, `Content-Type: text/plain;charset=utf-8`, body JSON `{action, token, data}`. No custom headers.
- `passwordHash` never appears in a server response.
- Time comes only from `platform.now()`. `Date.now()` is forbidden in `core/` and `backend/`.
- Sheet headers are the Russian titles from the schema; columns are found by title, never by position.
- Roles: `admin`, `dean`, `prorector`, `teacher`, `student`. Staff roles are stored as a comma-separated string.
- Every on-screen phrase goes through a dictionary key. Key sets of `ky`, `ru`, `en` are identical. Default language is `ky`.
- No real personal data in the repository. `dev/data/` and `build/` are git-ignored.
- Code that is bundled for Apps Script must not use `require`, `fs`, `Buffer`, `fetch` or other Node-only APIs.

## Tests

The implementer already ran the tests and reported evidence. Do not re-run the suite to confirm. Run a focused test only when reading the code raises a specific doubt no existing run answers. Noise or warnings in reported test output are findings.

## Part 1: spec compliance

Missing (skipped or claimed but not implemented), Extra (not requested), Misunderstood. Every test listed in the brief must exist with its assertions. If something cannot be verified from this diff, report it as a ⚠️ item.

## Part 2: code quality

Separation of concerns, error handling, duplication, edge cases; tests verify real behaviour; each file has one responsibility; file structure follows the brief.

## Calibration

Important = this task cannot be trusted until fixed: incorrect or fragile behaviour, a missed requirement, swallowed errors, tests that assert nothing, verbatim duplicated logic. Broader coverage and polish are Minor. A stated rationale in the report never downgrades a finding. If the brief itself mandates a defect, report it as Important, labelled plan-mandated.

## Output (your final message is the report; no preamble)

### Spec Compliance
- ✅ Spec compliant | ❌ Issues found: … (file:line)
- ⚠️ Cannot verify from diff: …

### Strengths

### Issues
#### Critical (Must Fix)
#### Important (Should Fix)
#### Minor (Nice to Have)
(each: file:line, what is wrong, why it matters, how to fix)

### Assessment
**Task quality:** Approved | Needs fixes
**Reasoning:** 1–2 sentences

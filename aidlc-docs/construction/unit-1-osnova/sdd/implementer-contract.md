# Implementer contract (applies to every task of this plan)

Work from: `D:\Журнал колледжа` (git repo, branch `main`, already initialised — do not run `git init`).

## Your job

1. Read your task brief. It is your requirements; use its names, signatures, values and test assertions verbatim.
2. TDD: write the tests from the brief first, run them and see them fail, then implement, then see them pass.
3. While iterating run the focused test file (`node --test tests/<file>`); run the full suite (`npm test`) once before committing.
4. Commit once, with the message given in the brief, ending with the `Co-Authored-By` line your own session's attribution reminder gives you (it names the model you actually are; ignore any other model name in project files).
   `npm test` runs `node --test "tests/**/*.test.js"`.
5. Self-review your own diff, then write the report file and reply.

Ask before you start if anything in the brief is unclear or contradictory. Do not guess silently.

## Global constraints (binding on every task)

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
- ES modules everywhere (`"type": "module"`), Node 24, tests with `node --test`.
- Code comments and identifiers in English; user-facing strings only in dictionaries.

## You do not dispatch subagents

Do all of this task's work yourself. Never spawn a helper or a reviewer. Review is the controller's job and is already scheduled.

## Scope discipline

- Follow the file list in the brief. Do not create files it does not name, except test helpers under `tests/`.
- Build only what the brief asks (YAGNI). Do not restructure code outside your task.
- If a file grows well beyond the brief's intent, or the brief contradicts itself or the existing code, stop and report it.

## When stuck

It is fine to stop. Report `BLOCKED` or `NEEDS_CONTEXT` with what you tried and what you need. Bad work is worse than no work.

## Self-review before reporting

Completeness (everything in the brief, every listed test), quality (clear names, no dead code), discipline (nothing extra), testing (tests check behaviour, output has no warnings or noise).

## After review findings

If the review finds issues you will be resumed with them. Fix, re-run the covering tests, append a fix report to the same report file (what changed, command, output), reply with the same short status.

## Report

Write the full report to the report file named in your dispatch:

- what you implemented
- TDD evidence: RED (command, failing output, why expected) and GREEN (command, passing output)
- files changed
- deviations from the brief and why
- self-review findings, concerns

Then reply with ONLY (under 15 lines):

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- commits (short SHA + subject)
- one-line test summary (e.g. "14/14 passing, output pristine")
- concerns, if any
- the report file path

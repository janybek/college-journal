# Unit 4 — final review fix wave (one agent)

Final review (opus) over 34ea381..9d2c7f0: 0 Important, **1 Critical**, 5 Minor. Probe scripts (run `node <script>.mjs` from that folder; they load the real code from `D:/Журнал колледжа`):
`C:\Users\user\AppData\Local\Temp\claude\78ab27254edccb9a\ba77d0cb-cf3b-4029-b4a4-1176d60797e7\scratchpad\final-u4\` (`common.mjs` — helpers).

## Fix in this wave

### C1 (Critical). Two running pairs of one group: «Я на паре» leads the student to the earlier pair, check-in impossible by code or QR
- Where: `backend/checkinData.js:22-24` — `checkinCurrent` takes the group's pair in phase `checkin` or `lesson` sorted by `slot`; pair 1 (window closed, phase `lesson`) wins although pair 2 has its window open now.
- Effect: `#/here` shows «Отметка закрыта»; a code is sent with pair 1's id → `window_closed`; the QR pass is not used (`takePass(pair.id)` looks for pair 1's id, `site/js/views/checkin.js:65-67`); no card on home (`home.js:98`). At the end of pair 2's window the whole group gets «не был».
- When: a pair closes itself 90 min after the actual start; start allowed until bell + 90 min. E.g. pair 08:00 started at 08:15 and not finished runs until 09:45; pair 09:40 of another teacher starts on time — its whole window is closed for the group.
- Repro: `node p2-overlap.mjs` (scenarios A: start 08:05, second pair 09:32; B: start 09:29, second pair 09:40).
- Fix: in `checkinCurrent` take a pair in phase `checkin` first (several — the latest `startedAt`), else a pair in phase `lesson` with the latest `startedAt`. Test in `tests/checkinApi.test.js`: two running pairs of one group, the second's window open → `checkin.current` returns the second; `checkin.mark` with its id and its code → `ok`; also the reverse (only pair 1 in `checkin`) still works. The site needs no change.

### M1. In fullscreen the QR on the live site is under 60 % of the screen height (Review Focus 12)
- Where: `site/js/views/lesson.js:638-639`: `cell = floor(innerHeight*0.62/(size+8))`.
- The live link (73 chars) gives version 5 (37 modules): square with quiet zone = 56.3 % at 720, 58.6 % at 768, 58.3 % at 1080, 59.4 % at 1440. The stand measured 61 % only because its address is shorter.
- Repro: `node p6-qr-size.mjs`.
- Fix: so that the square (with the 4-module quiet zone) is ≥ 60 % of the height in fullscreen for versions 1–6 at 720/768/1080/1440 — e.g. share ≈ 0.66 with a cap by width, or round the cell up with a ceiling ≈ 0.7 of the height. Whole pixels per module stay. Add a pure helper + test if simple (e.g. `qrCell(innerHeight, innerWidth, size)`).

### M2. While the QR is exchanged for a pass the page is blank
- Where: `site/js/main.js:191-192`: `await takeQrLink()` before the first render; the request has no time limit.
- This exact path is what the owner checks on the live site from a phone on mobile internet: a slow network gives a white screen without «Загрузка…».
- Fix: render first (the address is already `#/here`, loading is shown), then exchange the key for the pass and re-render; or give `checkin.pass` a time limit. A late failure goes to the note shown on `#/here` (as now).

### Optional (cheap, same wave)
- `maxlength 4` on the code field cuts a pasted code with spaces before `cleanCode` — remove `maxlength`, `cleanCode` already keeps the first 4 digits.

## Leave (record as known limits, not in this wave)
M3 non-4-digit code counts as a wrong attempt; M4 a pair after 22:30 drops out of «Пары сегодня»/«Я на паре» after midnight; M5 `lesson.start` may write «Пары» in two batches; matchCode type check; running pair with unreadable `startedAt` never closes; `--lesson-now` without `--reset`; Back during saving; shared `here.pending`; `checkin.pass` sent with the token; QR pass on a shared tab. N4 formula stays as is (it is the reference formula).

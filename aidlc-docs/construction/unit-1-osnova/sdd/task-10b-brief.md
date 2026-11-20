# Task 10b (Э): restyle every screen to the owner's reference

The owner chose a reference look after seeing the first screens: the "Nexus UI" admin dashboard template
(`https://nexus-ui-template-phi.vercel.app/` — open `/`, then use its own links to reach `/login`, `/users`, `/orders`;
direct deep links return 404). The earlier green/gold look is cancelled. Owner's decision: **both themes with a toggle, dark is the default.**

This task changes how the site looks, not what it does. Routes, API calls, dictionaries' existing keys and all behaviour stay as they are; every existing test must stay green.

## Hard rules

- **Our own code only.** Do not copy the template's CSS, markup, JavaScript, images, logo, name or texts. Reproduce the look (palette, type, spacing, shapes, layout patterns) with our own CSS and markup. The product keeps its own name from the dictionary; draw a simple brand mark of our own (inline SVG).
- No build step, no frameworks, no CDN, no external URL of any kind. Everything the page loads is same-origin.
- Colours are written as hex/rgb(a) values, **not** `oklch()`: students use old Android phones whose browsers do not support it. Convert the reference values below precisely (you may use the browser to convert).
- Rendering safety stays: server/user data only through `textContent` / the `ui.js` helpers, never `innerHTML`.
- Student screens keep body text ≥ 16 px and tap targets ≥ 44 px even though the reference uses 14 px; no horizontal page scroll at 360 px.

## Reference measurements (taken from the live demo)

Dark theme (default): background `oklch(16% .02 260)`, card `oklch(21% .025 260)`, sidebar `oklch(19% .025 260)`, muted `oklch(26% .025 260)`, secondary `oklch(28% .03 260)`, accent/hover `oklch(32% .04 255)`, border `white / 8%`, input border `white / 12%`, input background `white / 3.6%`, text `oklch(96% .01 240)`, muted text `oklch(68% .02 260)`, primary `oklch(62% .2 255)` with near-white text, success `oklch(70% .18 150)`, warning `oklch(82% .18 85)`, destructive `oklch(70% .2 22)`.

Light theme: background `oklch(99% .005 240)`, card `#fff`, sidebar `oklch(98% .005 240)`, muted `oklch(96% .01 240)`, accent `oklch(95% .02 255)`, border `oklch(92% .01 240)`, text `oklch(18% .02 260)`, muted text `oklch(52% .02 260)`, same primary.

Shape and type: radius 12 px for cards and dialogs, 10 px for inputs and buttons, pills for badges. Font Inter (variable). Page title 30 px / 700 with tight letter-spacing; table header 12 px / 600 in muted colour; table cells 14 px, padding 12 px 8 px, thin row separators, subtle row hover; controls 14 px / 500 on staff screens.

Layout patterns: fixed left sidebar (about 260 px) with a brand block on top, navigation grouped under small muted group titles, the active item on a slightly lighter pill, and a user block at the bottom (avatar circle with initials, name, secondary line); a slim top bar with a sidebar toggle, search and a theme toggle; content in bordered cards; status shown as small coloured pill badges with a dot; people shown with an initials avatar next to name + secondary line; the login page is a centred card on the dark background with a soft blue glow behind it and the brand above the card.

## What to build

1. **Tokens and themes.** `site/css/app.css` defines all tokens as CSS custom properties for `:root[data-theme="dark"]` and `:root[data-theme="light"]`. Remove the green/gold tokens and any style that nothing uses afterwards. Theme is applied before first paint by a tiny inline script in `site/index.html` `<head>` (reads `localStorage['journal.theme']`, falls back to `dark`), so there is no flash. `<meta name="color-scheme">` and `<meta name="theme-color">` follow the theme. A theme toggle (sun/moon icon button with an accessible label from the dictionary) sits in the top bar and on the login screen; `journal.theme` is written only on a click. Put the pure decision in a small tested function (e.g. `pickTheme(stored)` → `'dark' | 'light'`).
2. **Font.** Self-host Inter Variable: `npm i -D @fontsource-variable/inter`, copy the woff2 files for the `latin`, `cyrillic` and `cyrillic-ext` subsets (Kyrgyz ң, ө, ү live in `cyrillic-ext`) into `site/vendor/fonts/` with the font's OFL licence text, extend `scripts/vendor.js` to do the copying, and declare `@font-face` rules with the matching `unicode-range`s and `font-display: swap`. Fallback stack: system UI fonts. Verify in the browser that Kyrgyz text really renders in Inter (not the fallback).
3. **Icons.** A small set of inline SVG icons in one module (e.g. `site/js/icons.js`, built with `createElementNS`, never `innerHTML`). You may redraw them yourself or take paths from Lucide (ISC licence) — if you take any, add `site/vendor/ICONS-LICENSE.txt` with the licence. No icon fonts.
4. **Staff shell (laptop).** Sidebar: brand mark + product name; navigation built from `permissions`, grouped — directories (groups, students, staff, subjects, rooms), data (import), and for the teacher role "my subjects"; the role switcher for multi-role staff; user block at the bottom with initials avatar, full name, current role and a sign-out button. Top bar: page title, language switcher (KG | RU | EN), theme toggle. Below 900 px the sidebar becomes a drawer opened by a menu button (closes on navigation, on Escape and on backdrop click; focus is managed). The staff home becomes a simple overview inside this shell (cards linking to the sections the person can open).
5. **Student shell (phone-first).** No sidebar: a compact top bar (brand, language, theme, sign out) and the existing home content as cards in the new style.
6. **Login and change-password** screens: centred card, glow, brand above, language switcher and theme toggle reachable.
7. **Components**, used consistently on every existing screen (login, change password, home, directories, dialogs, import): buttons (primary, secondary, ghost, danger; busy state), inputs/selects/checkboxes, cards, tables, pill badges (active / inactive, must change password, roles), initials avatars (stable colour per name), dialogs, search field with icon, inline field errors, page-level messages, empty states.
8. **Dictionary:** add the few new keys (theme toggle labels, navigation group titles, menu button) to `ru.js`, `ky.js`, `en.js` — identical key sets, natural Kyrgyz.
9. **Print:** the passwords print-out stays black on white regardless of theme.
10. **Accessibility:** text contrast ≥ 4.5:1 in both themes (check muted text on cards and badges especially), visible focus ring in the primary colour, `prefers-reduced-motion` respected, `lang` on `<html>` still follows the language.

## Tests

- Keep every existing test green (`npm test`).
- Add Node tests for the new pure helpers: `pickTheme` (stored `light` → light; `dark`, missing, or junk → dark) and the initials/colour helper (two-word name → two letters, one-word name → one letter, empty → fallback; same name → same colour).
- The i18n key-set test already guards the three dictionaries.

## Browser checks (report each as done / not done)

Run a throwaway stand on a port other than 5173 and 5273 with a temporary data file, and stop it afterwards. For **both themes**: login, change password (student `S1002`), staff home as `dean` (both roles) and as `admin`, students directory (search, group filter, add dialog with a validation error, temp-password dialog), import screen through preview and apply with a real `.xlsx`, student home at 360 px wide. Also: no flash of the wrong theme on reload; the theme and language survive a reload; the drawer works below 900 px; the network panel shows only same-origin requests; the fonts load from `vendor/fonts/`; the console has no errors.

## Commit

`feat: restyle to the reference look with dark and light themes`

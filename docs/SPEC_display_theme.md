# SPEC — Display colours (three colour schemes, chosen per person)

**Status:** BUILT 2026-09-13 (Kevin's ask the same day). Sample mark-up he judged first:
`~/exchange/COLOR_SCHEME_SAMPLE_2026-09-13.html` / `.png`. Decision: all three as options, **standard is the default**.

## 1. What the user sees

The account menu (click the name, top right) carries a **Display** section above **Sign Out** with three choices:

| Key (wire) | Label | Description shown |
|---|---|---|
| `standard` | Standard colours | The regular look. |
| `hc-light` | High contrast, light | Black text and strong borders on white panels. |
| `hc-dark` | High contrast, dark | White text on dark panels; bright status colours. |

- The choice applies **at once**, is **remembered in the browser** (`localStorage.oq_theme`, so the login screen and
  the first paint already wear it) and is **saved on the account** (`users.ui_theme`, `PUT /auth/me/display`), so
  it follows the person to any machine they sign in from. Signing in applies the account's choice over the
  browser's.
- Standard is the **absence** of a theme: no `data-oq-theme` attribute on `<html>`, every variable resolves to
  the value the app had before. Nobody sees a change until they choose one (verified by pixel diff, §5).
- **The one deliberate exception (Kevin, 2026-09-14): the logo band.** The block at the top of the nav rail
  where the mark sits is a coloured band in every mode — `--oq-t-logoBg` = `#314AB6` standard · `#293D93`
  high contrast light · `#174EC0` high contrast dark — and the mark is drawn in `#F9FAFB` on it
  (`public/brand/optimumq-mark-light.png`, `optimumq-wordmark-light.png`: the same artwork with its black
  replaced). These are Kevin's own picks for the brand band, not swatch-folder colours.
- **Citizen-facing surfaces are excluded** — the public portal, wizard, library, map, status-check and
  record-verification modals, the paper form, the contribution page, and the Magic screen keep their own design
  and their own dark mode. Only staff screens theme.

## 2. The palette — Kevin's swatches (`~/exchange/colorsuploaded.zip`)

| Swatch | Hex | Light theme role | Dark theme role |
|---|---|---|---|
| white | `#ffffff` | panels, cards, fields; text on coloured buttons | text; lines around white-bordered elements |
| light gray | `#b8b8b8` | page ground, table headers, chips, selected rows, boxes | secondary text |
| light slate | `#777777` | — | hairlines, borders, disabled tracks, placeholders |
| medium slate | `#555555` | placeholder text; mid-gray fills (tracks, disabled buttons) with white text | tooltips and dark-gray fills |
| asphault | `#2a2a2a` | — | panels, cards, rail, header |
| nearly black | `#0c0c0c` | text, hairlines and borders; dark fills (tooltips) | page ground, fields, boxes, chips, selected rows |
| royal | `#3c28bc` | buttons, links, selected items, focus lines | — (2.1:1 on nearly black) |
| violet | `#8d33cc` | purple-family text and fills | buttons and coloured fills (white text, 6.0:1) |
| vday | `#ba1428` | destructive actions and mid-red text (6.5:1 on white) | — |
| dangerred | `#ff0206` | overdue / error fills (black text, 4.9:1) | red text and fills |
| warningyellow | `#ffe02c` | due-soon fills (black text, 14.9:1) | amber text and fills |
| gogreen | `#00cc05` | on-track fills (black text, 9.0:1) | green text and fills |
| muted white, carbon, wasabi, dijon | | **not used**: indistinguishable from white / nearly black; wasabi 2.6:1 and dijon 3.0:1 fail as text on white | |

### Mapping rules (`frontend/scripts/theme/build-tokens.js`)

Every colour is mapped by **value and role** (text `fg`, fill `bg`, line `ln`), classified by hue family and
lightness. The decisions that were not obvious:

- **Light: muted and faint gray text go black.** Medium slate on the light-gray ground reads 3.8:1; hierarchy
  comes from weight and size instead. Only placeholders keep a gray.
- **Light: status chips are solid fills with black text** (the mock-up look) — but only where the text that
  sits on the tint is a dark `-800` tone. A tint whose partner stays coloured (`#FEF2F2` under `#DC2626` error
  text) stays **white**, because red-on-red is unreadable. The partner is learned from the source (same-line
  fill/text pairs recorded by the codemod). Consequence: the `-800` reds, greens and ambers become black
  wherever they appear, including ~100 standalone uses; the fills carry the colour.
- **Light: no green or amber text.** Kevin's palette has no green or amber that passes 4.5:1 on white, so green
  and amber TEXT is black; their FILLS (gogreen, warningyellow) carry the meaning.
- **Light: the selected item is light gray with royal text, 3.3:1.** The palette has no pale tint of royal.
  It is the one known sub-AA text pair in the light theme (13px bold, selected nav row and active filter).
- **Dark: chips are dark boxes with bright text** (the inverse of the light theme, the natural dark idiom):
  every pale tint — status or neutral — becomes nearly black on the asphault panel, and the `-800` tones become
  the bright status colour (dangerred 4.9:1, warningyellow 14.9:1, gogreen 9.0:1 on nearly black). Chosen over
  bright fills because a value-keyed map cannot turn `-800` red text black without making the same red text
  invisible where it stands alone on a panel.
- **Dark: blue and purple text is white** (links, headings in the brand blue): royal and violet fail as text on
  asphault. Blue **fills** (buttons, avatars, selected) become violet with white text.
- **Dark: standalone red text on a panel is 3.6:1** (dangerred on asphault) — the one known sub-AA pair in the
  dark theme; it passes on fields and chips (nearly black ground).
- Shadows (`rgba`) and border widths are untouched; the map is colour only.

## 3. The mechanism — and the discipline it needs

- **Codemod (run once, kept):** `frontend/scripts/theme/codemod.js` rewrote 3,757 colour literals in 81 files
  into `var(--oq-<role>-<hex>)`. The role comes from the CSS property the literal feeds (`color:` → `fg`,
  `background:` → `bg`, `border…:` → `ln`), from JSX attributes (`fill=`, `stroke=`, `bg=`, `tc=`), from
  `el.style.x =` assignments, from named helper signatures (`btn(bg, fg, bd)`, `badge(bg, fg)`, `box(bg, bd,
  fg)`, …) and from variable names (`bannerBg`). A slot with no role (hue-named keys, positional arrays) is role
  `x`, which the generator aliases to that value's dominant role in the codebase.
- **Generator (runs again):** `build-tokens.js` scans the source for the variables in use and writes
  `frontend/src/theme/tokens.css` — `:root` (standard: each variable = the hex in its own name), then the two
  `[data-oq-theme=…]` blocks. It also writes a review table (`scripts/theme/out/mapping.tsv`) and the list of
  text-on-fill pairs that fall under 4.5:1 (`weak-pairs.json`). **After adding a colour, re-run it.**
- **Shared tokens:** `lib/theme.js` `C.*` are `var(--oq-t-<name>)`; the hex each meant is recorded beside it.
  Accent fills use the `*Bg` twins (`blueBg`, `greenBg`, `amberBg`, `critBg`) — same hex in standard, but a
  dark theme sends a fill and its text different ways.
- **Tailwind is inert:** react-scripts 4 never ran Tailwind 3, so `index.css`'s `@tailwind`/`@apply` rules ship
  raw and style nothing (discovered by the pixel diff, §5). The live `body` rule sets no colour; no JSX uses
  colour utility classes. Nothing there needs theming.
- **`verify_theme_tokens`** (static, reads source only) fails the suite if a raw colour literal returns to
  staff source, if a variable in use is undefined in any block, if the standard block stops being pixel-faithful,
  or if the menu and the API disagree on wire values. **`verify_display_theme`** proves the API contract.

## 4. Data and API

- `users.ui_theme TEXT` (NULL = standard). `sanitizeUser` returns `ui_theme` (`'standard'` when NULL), so
  `/auth/login`, `/auth/mfa/verify` and `/auth/me` all carry it.
- `PUT /auth/me/display { theme }` — signed-in user only; 400 unless `theme ∈ {standard, hc-light, hc-dark}`;
  returns `{ user }`.

## 5. Evidence (2026-09-13)

- Standard unchanged: ten staff routes (dashboard, queue, my tasks, org, admin, jurisdiction config, new request,
  mass redaction, reports, tickler) screenshotted at 1400×900 before and after the codemod and pixel-diffed: eight
  are 0 px different; the other two differ only in elapsed-time counters ("54d 3h" → "54d 4h"). A first build had
  made page headings #111827 instead of black — the `body` colour in `index.css` had never applied (react-scripts 4
  does not run Tailwind 3, so `@apply` ships raw); the rule was restored to colour-less and the diff went to zero.
- Three themes screenshotted on the Request Queue and My Tasks with the account menu open (dark: the page heading
  was black-on-black until the theme blocks set the inherited `color`; `color-scheme: dark` now also darkens
  native fields).
- `verify_theme_tokens` 13/13 (static). `verify_display_theme` and the full suite: see the handoff entry.

## 6. Open

- Kevin's palette gaps: a pale tint of royal (selected rows in the light theme), a dark green and a dark
  amber that pass as text on white, a light blue for links on dark. Adding swatches later is a generator change.
- The page-width sweep (handoff 2026-09-08) is still parked behind Kevin's mark-up pass.

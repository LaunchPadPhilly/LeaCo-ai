# Design

<!-- impeccable:design-schema 1 -->

The visual system for LeaCo AI: **direction A, "Overview"**, chosen on 2026-11-25 from the
three directions on the design canvas (claude.ai artifact "LeaCo Dashboard Directions").
Product truth lives in [PRODUCT.md](PRODUCT.md); this file says how it looks.

## Mode and posture

Every LeaCo screen is an **Operate** surface: people come to get a job done (see what's
broken, send a contractor, check a well). Ambition shows as precision and restraint, not
decoration. The look is calm, light and high-contrast, so it reads on a desk monitor and on a
phone in sunlight.

- **What needs action comes first.** The top of the Overview is "Needs a contractor".
- **Honest data is part of the look.** Missing values read "No data", gaps in charts are
  hatched, estimates carry an "Estimate" tag, and every map layer names its source.
- **Status is never color alone.** It is always a shape and a word as well (see Status).

## Color

Tokens live in `src/app.css` (app shell, admin, settings) and `src/lib/components/ops/ops.css`
(dashboard screens). Both use the same values.

| Role | Token (app / ops) | Light value | Use |
|---|---|---|---|
| Page | `--warm-50` / `--ops-bg` | `#F4F3EF` | Page background (warm paper) |
| Panel | `--surface` / `--ops-panel` | `#FFFFFF` | Cards, header, sheets |
| Sunken | `--ops-sunken` | `#FAF9F6` | Filter boxes, quiet wells |
| Line | `--border` / `--ops-line` | `#DDD9CF` | Card borders |
| Divider | — | `#ECE9E1` | Rows inside a card |
| Ink | `--ink-900` / `--ops-ink` | `#1B2127` | Text |
| Ink, secondary | `--ink-700` | `#3D454D` | Body text in dense areas |
| Muted | `--ink-500` / `--ops-muted` | `#59626B` | Labels, captions (passes AA on white and page) |
| Accent | `--warm-500` / `--ops-accent` | `#0B6A87` | Links, selected state, primary buttons, focus. Deep water blue: water is the business. |
| Accent, hover | `--warm-600` | `#084D63` | Hover and pressed |
| Accent, soft | `--warm-100` / `--ops-accent-soft` | `#E6F0F3` | Active nav item, selected rows |
| Danger | `--danger-fg` / `--ops-danger` | `#B42318` | Shut down, stuck, failed |
| Danger, soft | `--danger-bg` / `--ops-danger-soft` | `#FBE9E7` | Issue banners |
| Good | `--success-fg` / `--ops-good` | `#23733A` | Running, OK |
| Warning | `--ops-warn` | `#8A5A00` text, `#D99A1E` fill | Idle, tickets, late report |
| Water | `--ops-water` | `#1F5FBF` | Injectors taking water, water charts |
| Oil | `--ops-oil` | `#7A5A1E` | Oil charts |

Dark and Slate themes (Settings → Appearance) keep the same roles with darker neutrals and a
lighter teal accent (`#5FB3CC`).

## Type

- **Inter** for everything (400, 500, 600, 700).
- **IBM Plex Mono** (500, 600) for figures that line up: headline numbers, table numbers,
  times, API numbers and tokens. Every number also uses `font-variant-numeric: tabular-nums`.
- Scale: page title 28px/700 (24px on phones); section title 18–20px/600; card label 13px
  muted; small caps eyebrow 12–13px/600, uppercase, 0.06em tracking; body 15px; table 14px.

## Space, shape, elevation

- 4px base; cards pad 16–22px; sections 20–24px apart; page gutter 24px (16px on phones).
- Radius: cards 12px, buttons and inputs 6–8px, pills 999px, sheets 16px top corners.
- Elevation: flat cards with a 1px border; only floating things (map popups, the archive
  panel, bottom sheets) get a soft shadow `0 8px 24px rgb(27 33 39 / 16%)`.
- Touch targets at least 44px on phones, 40px on desktop.

## Status (shared with the status key)

Circles are producing wells, triangles are injectors. The status key (`StatusKey.svelte`, the
"?" button) explains every symbol in place.

| Thing | Symbol | Color | Word |
|---|---|---|---|
| Well running | filled circle | Good | Running |
| Well idle | half-filled circle | Warning | Idle (often a timer) |
| Well shut down | circle with ✕ | Danger | Shut down |
| Well, no reading | dashed hollow circle | grey `#6B7280` | No reading |
| Device offline | circle with ? | grey | Offline, may be out of date |
| Injector taking water | filled triangle | Water | Taking water |
| Injector stuck | triangle with ✕ | Danger | Not taking water |
| Injector idle | outlined triangle | `#5B8FD6` | Idle |
| Not reported that day | same shape, hollow | — | Not reported |
| Open ticket | rounded square with ! | Warning | Open ticket |
| Missing day in a chart | hatched bar, dashed outline | — | No data |

## Layout

- **App header:** white bar, 56px. Brand left; menu Overview · Issues · Map · Reports · Admin ·
  Settings (each shown only when the page exists and the person may open it); active item on
  the soft-accent pill. Phones collapse the menu behind a button.
- **Overview:** date and data freshness with the period picker; "Needs a contractor" beside
  "Right now · live from Amplified"; headline numbers with 14-day bars; property cards; map.
- **Lists of problems** are rows: symbol · name and property · what's wrong and its source ·
  how long · actions (Directions, Details).
- **Phones:** single column; wide tables become cards; filters and detail views open as
  bottom sheets; primary actions are full-width 48–54px buttons.

## Components

Cards (`.card`), segmented controls for periods and options, switches for on/off access,
pills for screen tabs on phones, banners for state messages (warning amber, danger red, info
accent-soft), and the status key popover. Charts are bars with hatched gaps; the selected
period is solid, the rest is the same color at about one-third strength.

## States

Every screen has: loading (grey blocks in the page's shape, never zeros), stale data (amber
banner with the data's age), a missing source (that number reads "No data" with the reason),
all clear (green check, calm copy), a report that doesn't add up (red banner, numbers shown as
reported), and not connected (plain explanation, nothing shown rather than something wrong).

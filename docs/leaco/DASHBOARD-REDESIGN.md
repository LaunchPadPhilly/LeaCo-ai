# `/dashboard` redesign plan: map-first operations view

Status: **R1 and R2 built** (2026-11-20). Light "field sheet" theme and map-first layout
approved; local Playwright test session approved and added (`pnpm run dev:session`).
Builds on [PLAN.md](PLAN.md) Phase 1 (prototype parity).

**Layout changed 2026-11-20 (owner request): numbers-first.** Graphs and all other information
are on top: a sticky period picker, headline numbers, four day-by-day graphs with a table view,
and property cards with the attention list beside them. The map is full width below. The map is
scroll-friendly: a plain wheel or one-finger swipe scrolls the page; Ctrl/⌘ + wheel, trackpad
pinch or two fingers zoom the map; its keyboard shortcuts work while it has focus. The rail and
bottom-sheet wireframes in §2 are superseded by this.

**Background map added 2026-11-20.** USGS The National Map tiles (Topo by default; Aerial photo or
None in the Layers panel; the choice is remembered per browser). They are free, need no key, and are
public-domain U.S. government data, so the map is filled at every zoom. Google Maps was considered:
showing Google's map inside the dashboard needs a billed Google Cloud project, the Map Tiles API and a
browser-visible key (conflicts with the brief's "no API keys" and CLAUDE.md's no-browser-credentials
rule), so it's not used. Sending people to a well uses Google/Apple "open in maps" links instead, which
need no key.

**Census "Public roads" layer removed 2026-11-20 (owner request).** The background map shows the
public roads, and the Census layer only covered a box around LeaCo's areas, which looked like a
dense patch once the background was in. This drops a prototype feature listed in the brief (§3
"public roads, highway/local/private-4WD styling"). The routes between areas and the Winkler unmapped
gap stay, under "Getting there" in the Layers panel.

Notes from the build:
- The app's global `button`, `a` and `table` rules in `src/app.css` are scoped with
  `:where(:not(.ops *))`, which adds no specificity, so other pages are unchanged and the
  dashboard keeps its own look.
- The map legend starts collapsed: open, it covered wells when zoomed in.
- R3, first part (built): layers panel (quick sets, all on/off, per-layer source, confidence,
  count and legend; the choice is remembered per browser) and the Roads group: public roads
  (U.S. Census TIGER, served from `/dashboard/roads.json` after first paint), routes between
  areas, and the Winkler 1.12 mi unmapped gap. The standalone legend moved into the panel.
- Still to come: R3 rest (pipelines, NM/TX wells, TX surveys, Winkler planned features, Oncor
  and ONEOK, XRI supply area: these will make "Operations" and "Everything" differ), R4 (phone
  bottom sheet), R5 (polish).

## Goal

Turn `/dashboard` from a page of four number cards into the working screen LeaCo opens every
morning. It has a **map of every well, injector and property**, with the headline numbers
and property cards beside it, and all of it follows one selected time period. It **doesn't
use the rest of the app's theme**. It's a full-screen tool with its own look, built for two
situations:

- **Owners at a desk**: wide screen, scanning numbers and spotting trouble.
- **Pumpers in a truck**: a phone at 380 px, often in bright sun, one hand free.

Nothing here changes the data rules: missing data shows "No data", every layer cites its
source, approximate things are labelled approximate, and discrepancies are shown (brief §4).

## 1. Look and feel

**Direction: "field sheet".** Calm, high-contrast and light, readable in sunlight. Big
numbers, plain words, color always paired with a shape or a word.

| Token | Value | Use |
|---|---|---|
| `--ops-bg` | `#ECE9E1` (warm paper, from the prototype) | Map background, page |
| `--ops-panel` | `#FFFFFF` | Rail, sheets, popovers |
| `--ops-ink` / `--ops-muted` | `#1B2127` / `#5F666D` | Text (muted still passes AA on white) |
| `--ops-line` | `#DEDAD1` | Borders, dividers |
| `--ops-accent` | `#0E6F8E` (deep water blue) | Selected period, focus ring, links. **Water is the business.** |
| Status: injector taking water | `#1F6FD1` blue, **filled triangle ▲** | |
| Status: injector stuck | `#C8322B` red, **▲ with ✕** | |
| Status: injector idle | `#8DB8E8` light blue, **▲ outlined** | |
| Status: well running | `#2E8B3E` green, **filled circle ●** | |
| Status: well down | `#C8322B` red, **● with ✕** | |
| No data | `#9AA0A6` gray, **dashed outline** | |
| Not reported that day | Same shape, **hollow** (as in the prototype) | |

- **Type:** Inter (already used by the prototype), with tabular numbers for every figure.
  KPI values 32 px / 700; labels 13 px / 600.
- **Shape tells the kind and the symbol tells the status**, so the map works in grayscale and
  for color-blind users. Brief §8: color is never the only signal.
- **Scoped theme:** every style lives under one `.ops` root class, with `--ops-*` tokens that
  have their own dark-mode values. The global `app.css` rules (`h1`, `.card`, `body`) are reset
  inside `.ops` so the app theme can't leak in and the dashboard theme can't leak out.

## 2. Layout

### Desktop (≥ 1024 px)

```
┌──────────────────────────────┬───────────────────────────────────────────────────────┐
│ LeaCo Operations      ← App  │ [🔍 Search well…] [Go to ▾]                [Layers ▾] │
│ Report: Thu Nov 19, 2026     │                                                       │
│ [Latest day|7 days|All] 📅   │                                                       │
│ ┌─────────┐ ┌─────────┐      │                    M A P                              │
│ │ 29,030  │ │  44.6   │      │       (wells ●, injectors ▲, area outlines,          │
│ │ bbl wtr │ │ bbl oil │      │        ranch boundaries, roads, routes)               │
│ │▲ 9,029  │ │▲ 7.0    │      │                                                       │
│ ├─────────┤ ├─────────┤      │                                   ┌───────────────┐   │
│ │ 42 / 78 │ │ 10 / 29 │      │                                   │ Well detail   │   │
│ │ running │ │ taking  │      │                                   │ (drawer, when │   │
│ └─────────┘ └─────────┘      │                                   │  one is open) │   │
│ ── Properties ─────────      │                                   └───────────────┘   │
│ ▸ Myers Langlie Mattix  ~~~  │ ⌖ scale ───┤                          [+][−][N][⤢]  │
│ ▸ East Eumont           ~~~  │                                                       │
│ ▸ Rhodes & Wills        ~~~  │                                                       │
│ ▸ Winkler Ranch (land)       │                                                       │
│ ▸ Crawford (unconfirmed)     │                                                       │
│ ── Needs attention (3) ──    │                                                       │
└──────────────────────────────┴───────────────────────────────────────────────────────┘
   380 px rail, scrolls on its own                 map fills the rest; controls float
```

- The **app header is hidden** on `/dashboard`. A small "← App" link in the rail goes back.
- **Property card:** name, operator of record, period water and oil, 30-day oil, water and
  oil sparklines with the selected period shaded, a running/down bar and an injector status
  bar. Clicking a card zooms the map to that area.
- **"Needs attention"** is a short preview of Phase 4 alerts, only showing what the data
  supports today: injectors not taking water, wells down, and the biggest water drop.

### Tablet (640–1023 px)

The rail becomes a **top band** (period control + 4 KPIs in one row), with the map below.
Property cards move into a collapsible drawer.

### Phone (< 640 px, designed at 380 px)

```
┌──────────────────────────┐
│ [🔍 Search well…]   [≡]  │  ≡ = layers + period
│                          │
│          M A P           │
│                          │
│                   [⌖][N] │
├──────────────────────────┤ ← bottom sheet, drag or tap
│ ▬▬                       │   peek: 4 KPIs in a 2×2 grid
│ 29,030 bbl │ 44.6 bbl    │   half: + property cards
│ 42/78 run  │ 10/29 inj   │   full: + needs attention
└──────────────────────────┘
```

- Tapping a well opens its detail in the same sheet, not a popup. A popup doesn't fit at
  380 px.
- Touch targets are at least 44 px. Pinch zooms and one finger pans. Rotation is a button
  only on phones: two-finger rotate gets triggered by accident in a moving truck.

## 3. The map

Stays on **d3 + SVG** (PLAN D6), ported from the prototype into Svelte components:

```
src/lib/components/ops/
  OpsShell.svelte        full-bleed layout, rail / band / sheet switching
  PeriodPicker.svelte    Latest / 7 days / All + From–To dates
  KpiStrip.svelte        the 4 headline numbers (replaces Kpi.svelte)
  PropertyCard.svelte    + Sparkline.svelte, StatusBar.svelte
  map/
    OpsMap.svelte        projection, zoom/pan/rotate, keyboard, scale bar
    AssetLayer.svelte    wells ● and injectors ▲, status per period
    AreaLayer.svelte     operating-area outlines ("approximate"), ranch, Crawford
    ContextLayers.svelte NM/TX wells, pipelines, surveys, roads, routes, unmapped gap
    LayersPanel.svelte   quick sets, all on/off, legends, counts, source per layer
    SearchBox.svelte, GoTo.svelte, MapControls.svelte
    DetailDrawer.svelte  latest note, per-day history, IDs, discrepancies
src/lib/leaco/
  period.ts            period selection → day indexes (one rule, used by every component)
  status.ts            status → color + shape + label (one table)
  sources.ts           layer → citation + confidence label
```

- **Keyboard (kept from the prototype):** arrow keys pan, `+`/`−` zoom, `0` shows all areas,
  `Q`/`E` rotate, `N` resets north, `/` focuses search, `Esc` closes the drawer. Right-drag
  rotates.
- **Rendering:** ~104 assets plus a few thousand context features is fine as SVG. Context
  layers render only when switched on, and roads are decoded once and cached.
- **Data delivery:** an authenticated `GET /dashboard/map.json` returns the map data
  (≈1 MB raw, much less gzipped). It loads after the numbers so the first paint is fast.
  Interim source: the kit's `combined_data.json` in `data/private/`. The **asset list and
  status** move to Amplified later (PLAN §2a) without the components changing. Locations
  and land layers stay ours, because Amplified doesn't hold them.

## 4. Build order

| Step | Delivers | Done when |
|---|---|---|
| R1 | Full-bleed shell, scoped theme, period picker, KPI strip, property cards with sparklines | Desktop + 380 px screenshots; every number follows the period |
| R2 | Map core: projection, wells/injectors with status shapes, hover, click → drawer, zoom/pan/rotate + keys, scale bar, search, Go-to | All prototype map interactions work |
| R3 | Layers: areas, ranch + Crawford, NM/TX wells, pipelines, surveys, roads, routes, unmapped gap, layers panel with legends, counts and sources | Feature-for-feature with the prototype, with a citation on every layer |
| R4 | Phone: bottom sheet, sheet-based detail, touch controls | Usable at 380 px in Playwright and on a real phone |
| R5 | Polish: loading skeletons, empty and error states, focus order, reduced motion, dark tokens | Zero console errors; keyboard-only run-through passes |

**Verification:** Playwright screenshots at 1440 × 900 and 380 × 800 after each step, plus a
console-error check. Playwright can't sign in through Google, so it needs a **local-only test
session**: a script that creates a session for a test user, which **refuses to run unless
`DATABASE_URL` points at localhost**. The cookie is written to a gitignored file.

## 5. Decisions needed

1. **Light "field sheet" theme** (above), or a **dark operations-console** look? Light is
   recommended for sunlight on phones. Dark is easier on the eyes for long desk sessions. The
   tokens support both later.
2. **Map-first** (the map fills the screen and the numbers sit in a rail), or
   **numbers-first** (KPIs and cards on top, the map as a large panel below)? Map-first is
   recommended; it's what the prototype proved.
3. **OK to add the local-only Playwright test session** (§4 verification)?

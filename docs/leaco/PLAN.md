# LeaCo Operations Dashboard — Build Plan

Status: **draft, awaiting approval** · Branch: `feat/leaco-dashboard-plan` · Written 2026-11-19

Source brief: `PROMPT.md` in `LeaCo_Dashboard_Starter_Kit.zip`. This plan is based on the kit's
actual contents (prototype, data, reference scripts), not only the brief. Findings that change
the brief's assumptions are in [§2](#2-what-the-kit-actually-shows).

---

## 1. Goal

Let LeaCo's owners and pumpers see wells, injectors, water volume and land more easily than in
Amplified. Turn the working single-file prototype into a maintainable app **without losing any
prototype feature or breaking any data rule** in the brief (§3 and §4 of `PROMPT.md`).

## 2. What the kit actually shows

Checked against `data/daily_parsed.json` (13 reports, Nov 7–19 2026) and `combined_data.json`
(104 assets).

| Check | Result |
|---|---|
| All-reports water total | **344,557 bbl** ✅ matches the brief |
| Average over the last 7 reports | **26,684 bbl/day water, 52.4 bbl/day oil** ✅ matches the brief |
| Injector rows + "all other" = total water | ⚠️ **Not exact.** Off by 0–2 bbl on 9 of 13 days (e.g. Nov 18: 20,003 vs 20,001) |
| Lease sum = total water | ⚠️ **Not exact.** Off by 1 bbl on 3 of 13 days (Nov 13, 18, 19) |
| Header "taking water" vs rows with volume > 0 | ⚠️ Differs by **up to 3** (Nov 9: header 10, rows 7). The brief says 1–2. The "all other injectors" group isn't broken out by well, which likely explains some of it. |
| Known ID problems in `id_note` | WHRB-20 (#20 vs #21, in the brief), **plus three not in the brief**: WF-8 (filed under the wrong lease?), WHRB-29 (odd name), **WHRB-24 (possible duplicate row)** |
| Daily-report PDFs in the kit | **None.** The parser can't be tested against real input yet. |
| Python on this machine | **Not installed** (only the Windows Store stub). `pdftotext` (poppler) *is* available through Git Bash. |
| Large drops in the data | Nov 10 (20,712) and Nov 18 (20,001) against roughly 27,500 normally. The Alerts view should catch both. |

The ⚠️ rows are flagged, not fixed. Decisions D3 and D4 below cover them.

### 2a. Change of direction: Amplified API is the data source (2026-11-19)

The project owner confirmed that data will come from the **Amplified Customer API**, not from
parsing the emailed PDFs. The API documentation is a private Notion page that hasn't been
read yet. **Every API-specific detail below is pending that read**: endpoints, auth, fields,
history depth and rate limits are unknown, and nothing here assumes them.

What this changes:

- **Main input:** a scheduled pull from the Amplified API replaces "drop a PDF in". The PDF
  parser is downgraded to a fallback and history backfill (only if the API's history doesn't
  reach Nov 7). It is not built unless that need is confirmed.
- **The reconciliation tests stay, but test API data.** The kit's `daily_parsed.json` figures
  (344,557 / 26,684 / 52.4) become the cross-check: API totals for Nov 7–19 should match what
  the reports said, and any gap is reported to LeaCo, not smoothed over.
- **Header vs row counts (D4) may disappear** if the API gives per-injector status directly.
  Re-decide once the fields are known.
- **IDs:** the API will presumably key on the Amplified ID (to confirm). That makes the
  `amp_id` ↔ state API number mapping the main join, and the WHRB-20/21, WHRB-24, WHRB-29 and
  WF-8 problems become blockers to resolve rather than notes.
- **Secrets:** the API key goes in `.env.local` locally and in the environment's Secrets
  Manager JSON when deployed. It is added to `web_secret_keys` (and to `mcp_secret_keys` only
  if the MCP process ever calls Amplified, which it shouldn't; it reads Postgres). The key is
  loaded server-side only, never `PUBLIC_*`, and never logged.
- **Python (D2) mostly stops mattering:** an HTTP client in TypeScript is the natural fit for
  the template. The Python reference scripts are needed only to specify the PDF fallback.

## 3. Decisions needed before building

| # | Decision | Recommendation |
|---|---|---|
| D1 | Build on this repo's SvelteKit + Prisma template, or a separate static site? | **Template.** It already has login (pumper notes and revenue shouldn't be public), a deploy pipeline and Postgres for idempotent ingest. |
| D2 | Pipeline language: Python (as the brief says) or TypeScript? | **TypeScript, still shelling out to `pdftotext -layout`.** One toolchain (Node 24 / pnpm) that already runs in CI and in the containers, and no Python to install here or in the images. The Python scripts stay in `reference/` as the specification, and their `daily_parsed.json` is the expected output the port must reproduce. *Alternative:* install Python 3.12 + `uv` and keep the brief's split. |
| D3 | How strict is "daily totals must reconcile"? | Allow a **±3 bbl rounding tolerance** (the largest gap seen is 3). Within tolerance: store the report and show a "rounding" note. Beyond it: **refuse the report** and show why. Exact equality would refuse 9 of the 13 known-good reports. |
| D4 | Injector KPI source | As the brief says, **use the header's count**. The well-by-well view shows the row count, with a note when the two differ. |
| D5 | What goes into git | Commit only **public** layers (NM OCD, RRC, EIA, Census, state line). LeaCo data (daily reports, notes, the KMZ-derived Winkler features, the Amplified ID list) goes in Postgres plus a gitignored `data/private/`. Keep the zip itself out of git. |
| D6 | Map library | **Stay on d3** (a change from the first draft, which suggested MapLibre). The prototype's custom symbols, counter-rotated labels and rotation already work in about 500 lines. `d3.zoom` handles touch pinch and pan for phones, and an optional imagery basemap can be added later with `d3-tile`. MapLibre would mean rebuilding every custom layer for a gain we don't need yet. Reconsider only if Phase 6 testing on real phones says otherwise. |
| D7 | How new data gets in once deployed | **Revised for the API (§2a):** a scheduled sync job, run as an ECS task on a schedule, the same pattern as the template's existing ingest schedule. It is idempotent by asset + date and has a manual "sync now" button in `/admin`. Frequency depends on the API's freshness and rate limits (pending docs). A PDF upload screen only if the fallback is needed. |

## 4. Architecture

```
PDF (emailed daily)
  │  upload in /admin  or  pnpm run leaco:ingest <pdf>
  ▼
src/lib/server/leaco/ingest/
  extract.ts      pdftotext -layout → text   (poppler; added to Dockerfile)
  parse.ts        port of parse_daily.py     → ParsedReport (Zod-validated)
  reconcile.ts    §4 rules; refuse or warn
  store.ts        upsert by report date (idempotent) in one transaction
  ▼
Postgres (Prisma)  Report · LeaseDay · InjectorDay · AssetDay · Note · Asset · AssetId
  ▼
src/lib/server/leaco/queries.ts   period-aware read model (latest / 7 days / range)
  ▼
SvelteKit routes (behind login)
  /                map + sidebar (KPIs, property cards, period picker)
  /wells/[key]     well page
  /alerts          alerts
  /revenue         revenue
  /admin?screen=reports   upload + ingest history (new screen)

Public layers: scripts/leaco/refresh-public.ts (monthly, by hand) → static/geo/*.json
```

Shared rules live in one place and are used by both the server and the UI:
`src/lib/leaco/` holds the status enums and colors, the percentage floor (99 not 100), the
period math, and the **sources/confidence table**. That table maps each layer to its citation
and confidence label, so a layer can't render without them.

## 5. Folder layout (additions)

```
reference/                     read-only copy of the kit (prototype, reference_scripts, PROMPT.md)
static/geo/                    public layers (committed)
data/private/                  LeaCo-only seed data (gitignored)
scripts/leaco/                 seed-from-kit.ts, refresh-public.ts
src/lib/leaco/                 shared types and rules (no server imports)
src/lib/server/leaco/          ingest/, queries.ts
src/lib/components/leaco/      Map/, Sidebar/, Kpi, PropertyCard, Spark, StatusBar, PeriodPicker
src/routes/(app)/              /, /wells/[key], /alerts, /revenue
tests/                         vitest (rules, parser, reconciliation) + Playwright (screens)
docs/leaco/                    this plan, open-questions.md, data-sources.md
```

## 6. Phases

Every phase must pass `db:validate`, `check`, both builds and the new test suites, with
Playwright screenshots at desktop and **380 px** width and **zero console errors**.

### Phase 0 — Groundwork *(done 2026-11-20 except Playwright, deferred until local sign-in exists)*

Delivered: kit split into `reference/` (committed) and `data/private/` (gitignored, also
excluded from Docker builds); vitest with `pnpm run test:unit` in CI; shared rules in
`src/lib/leaco/`; `docs/leaco/open-questions.md`; and a first `/dashboard` page (headline
KPIs, period averages, reconciliation notice) linked from the home page and the header.

Original scope:
- Unzip the kit into `reference/`; gitignore the zip and `data/private/`.
- Add **vitest** and **Playwright** (the repo has no test suite today).
- First tests: the known-good figures (344,557 / 26,684 / 52.4) and the reconciliation rules,
  run against the kit's `daily_parsed.json`.
- `docs/leaco/open-questions.md` with the five §9 questions, each tagged `TODO(LeaCo)`.
- **Done when** the tests run and pass in CI.

### Phase 1 — Prototype parity (read-only, served from the kit's JSON)
- Port the prototype into Svelte components, still using d3. Data comes from an
  authenticated server route that reads the kit JSON (no database yet).
- Keep every feature listed in `PROMPT.md` §3: layers panel and quick sets, period picker,
  status colors **plus shapes and text** (so color isn't the only signal), hollow "not
  reported" markers, tooltips and popups, search, Go-to, zoom/pan/rotate with all keyboard
  shortcuts, roads with routes and the Winkler unmapped gap, scale bar, header KPIs,
  property cards.
- Confidence labels and source citations on every layer, through the shared sources table.
- **Done when** a side-by-side screenshot review against `reference/prototype/leaco_map.html`
  shows feature parity.

### Phase 2 — Database and ingest
- Prisma models and migration. A `seed-from-kit` script loads the 13 known reports.
- Port the parser to TypeScript, keeping every known gotcha (`#` required before a well
  number, `(\d+)[A-Z]?` suffixes, the narrative starting 3 lines after `Source:`, skipped
  header rows, the lease-prefix map, the CSV BOM and leading `\r\n`).
- **Parser acceptance:** running it on the 13 original PDFs reproduces `daily_parsed.json`.
  *Blocked on the PDFs (see §8).*
- Idempotency test: ingest the same date twice and confirm one copy, with the latest version kept.
- `/admin?screen=reports` upload screen; add `poppler-utils` to the `Dockerfile`.
- Switch the app from the kit JSON to the database read model.

### Phase 3 — Well pages
- `/wells/[key]`: status history chart, every note with its report date, API / Amplified /
  customer IDs, and any `id_note` shown as a visible warning (WHRB-20, WHRB-24, WHRB-29, WF-8).

### Phase 4 — Alerts
- Injectors stuck more than N days, wells down more than N days, and day-over-day water drops
  over X%. N and X are set on the page and remembered per user.
- Revenue impact is shown as **"estimate at $0.265/bbl (supply rate; split unknown)"**.

### Phase 5 — Revenue
- Volume × rate by day and by area. The supply/disposal split stays an open question: no
  guessed split. Until LeaCo answers, every figure is labelled as an estimate at the supply rate.

### Phase 6 — Mobile pass
- Built responsively from Phase 1. This phase is the real-phone check on the map and well
  pages at 380 px: touch targets, a sheet-style sidebar, popups that fit the screen.

### Later (not scheduled)
- Monthly refresh of the public layers, an Amplified API or export loader (once access
  exists), and MCP tools so the owners can ask questions in Claude (read-only, scoped).

## 7. Non-negotiables carried into the code

- Missing values are `null` → displayed as "No data". There is no interpolation anywhere,
  including in charts (gaps are drawn as gaps). *Note:* `build_history.py` fills a missing
  injector day from the **next** report's "prior day" column. That is a real reported value,
  not an interpolation, but the UI should say where it came from ("from Nov 13 report, prior-day
  column").
- Discrepancies are shown, not fixed: WHRB-20/21, Oncor easement width (238 ft drawn vs 160 ft
  / 50.625 ac surveyed), header vs row injector counts, and rounding gaps.
- Lease roads are never traced from imagery. Hulls are "approximate"; routes are "shortest
  drive on public roads, not confirmed with LeaCo"; Crawford ownership is "unconfirmed".

## 8. Needed from LeaCo or the project owner

1. Answers to decisions **D1–D7**.
2. **The Amplified Customer API documentation** in a readable form (public Notion link, an
   export, or the Notion connector authorized), plus API access: a key for a non-production or
   read-only account if one exists. Phase 2 is rewritten around the API once this is read.
3. *(Only if the API history doesn't reach Nov 7)* the original daily-report PDFs for Nov 7–19.
3. The five open questions in `PROMPT.md` §9. They'll be tracked in `docs/leaco/open-questions.md`.

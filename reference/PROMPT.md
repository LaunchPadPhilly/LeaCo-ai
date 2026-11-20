# Build the LeaCo Operations Dashboard

You are helping me build a web app for **LeaCo**, a small oil and water operator in southeast New Mexico and west Texas. The goal is simple: LeaCo's owners and field staff should be able to see what is happening across their wells, injectors and land **more easily than they can in Amplified** (their current field-data platform).

A working prototype already exists. It is a single-page interactive map, and it proved out the framework. Your job is to turn it into a maintainable app, keeping everything that works and the data rules listed below.

Before writing code, read this whole file, then look at `prototype/leaco_map.html` in a browser and skim `data/` and `reference_scripts/`. Then propose a plan (stack, folder layout, phases) and wait for my OK before building.

---

## 1. Business context (read this, it drives the design)

- **LeaCo's main income is water, not oil.** XRI (a water company) pays LeaCo about **$0.265/bbl** for supply water and **$0.13/bbl** for disposal. Nearly all water goes into the **Myers Langlie Mattix (MLMU)** waterflood. Oil is a small side stream (about 45–55 bbl/day total).
- **bbl** = barrel = 42 US gallons.
- **Injectors** push water underground. An injector is either *taking water*, *stuck* (not taking), *idle*, or *no data*. Injector uptime is directly tied to revenue.
- **Producing wells** are mostly low-rate "stripper" wells: *running*, *down*, or *no data*.
- **Pumpers** are field staff who drive the leases each day and write notes. Their notes are the best ground truth.
- The users are not technical. Plain language, big numbers, few clicks. Avoid oilfield jargon in the UI unless it is explained (tooltips are fine).

### Properties

| Key | Name | State | What it is |
|---|---|---|---|
| `mlmu` | Myers Langlie Mattix Unit | NM, near Jal | The water hub. Takes ~99% of injected water. State records list **J R Oil, Ltd. Co.** as operator. |
| `eeu` | East Eumont Unit | NM, near Eunice | Oil producer, some injection. Also listed under J R Oil. |
| `rw` | Rhodes & Wills (Rhodes, Mary E Wills, Wills Fed, Rhodes Yates COOP Fed Com) | NM–TX line | Small oil leases. The XRI water delivery point is here. |
| `winkler` | Winkler Ranch | TX (Winkler Co.) | Surface ranch bought Jan 2023. Planned SWD (disposal) development, Oncor 345/765 kV easement, proposed ONEOK Lizard Loop pipeline. Abstracts A-1326, 1327, 1328, 1329, 1211. |
| `crawford` | Crawford Ranch | NM | ~2,403 ac, private surface per BLM. **Ownership not confirmed.** |

---

## 2. What's in this kit

```
PROMPT.md                     this file
prototype/leaco_map.html      the working prototype (open it in a browser)
prototype/map_template.html   same page with data placeholders (__FIELD__, __RANCH__, __CRAW__, __STATE__)
data/combined_data.json       all map data (schema below)
data/ranch_features.json      Winkler Ranch features from LeaCo's KMZ (boundary, planned roads/water/power, SWD pads, FW wells, ponds, Oncor, ONEOK)
data/crawford.json            Crawford Ranch boundary
data/stateline.json           TX/NM state line (Census TIGER)
data/daily_parsed.json        parsed LeaCo Daily Reports, Nov 7–19, 2026
data/amplified_asset_list.csv Amplified asset list with Amplified IDs and customer IDs
reference_scripts/            the Python that produced the data (hard-coded paths; treat as reference, rewrite as a proper pipeline)
```

### `combined_data.json` schema

- `assets[]` — LeaCo's 104 wells and injectors.
  - `n` display name, `key` short key (e.g. `EEU-1`, `MLMU-141`), `k` kind (`Well` / `Injector`), `api` state API number, `sn` state name, `op` operator of record, `lt` land type (State/Federal/Fee), `ar` area key, `x`/`y` lon/lat.
  - `st` latest status, `mode`, `rt`/`rt7`/`rt13` runtime %, `note` latest pumper note, `asof` snapshot date.
  - `amp_id` Amplified ID, `cust_id` customer ID, `id_note` known ID issues.
  - `ds[]` status per day, aligned to `dates_full`.
  - `hist[]` per-day records; `d` is the date, optional `n[]` holds that day's notes.
- `dates_full[]` report dates (ISO). `last` latest report date.
- `series` — `dates`, `total[]` (water, oil, own water, third-party water, `inj:[taking,total]`, `run:[running,total]`, `flag`), and `areas.{mlmu,eeu,rw}` per-area daily series.
- `hulls.{rw,mlmu,eeu}` — approximate operating-area polygons (convex hulls of well locations, **not** legal boundaries).
- `nmw[]` NM wells by other operators within ~5 mi (NM OCD). `txw[]` TX wells near Winkler (RRC).
- `pipes[]` RRC pipelines near Winkler, merged by system. `eia[]` EIA interstate/intrastate lines in NM, clipped.
- `surveys[]` Texas survey/abstract polygons (RRC/GLO).
- `roads` — Census TIGER roads, compact-encoded. Fields: `names[]`, `cls[]`, `r[] = [nameIdx, clsIdx, miles, [deltaEncodedLines]]`. Coordinates are integer deltas at 1e-4°.
- `routes[]` — shortest public-road drive between areas: `a`, `b`, `mi`, `via[[road, miles]]`, `g`.
- `rgaps[]` — stretches with no mapped public road (Winkler: 1.12 mi).

---

## 3. Features the prototype already has (keep all of them)

**Map**
- Layers panel with quick sets (Operations / Land & rights / Everything), All on / All off, and per-layer legends and counts.
- Time-period selector: Latest day / Last 7 days / All reports, plus From–To date pickers. Every number, card and popup follows the selected period.
- Status colors:
  - Injectors: taking water = blue, stuck = red, idle = light blue, no data = gray.
  - Wells: running = green, down = red, no data = gray.
  - Hollow marker = not reported that day.
- Hover tooltips and click detail popups, including the latest pumper note and per-day history for the period.
- Search ("MLMU 141") and a "Go to" area menu.
- Zoom (+/−, wheel), pan (left-drag, arrow keys), "show all areas" button (0 key).
- Rotation: right-click drag rotates about the screen center; Q/E rotate; N or the compass button resets to north. Labels and symbols counter-rotate so they stay upright.
- Roads group:
  - public roads (highway / local / private-4WD styling)
  - routes between areas with mileage tags and turn-by-road breakdown
  - a red dashed "unmapped" line for Winkler's 1.1 mi gap
- Scale bar.

**Sidebar**
- Header KPIs: water injected, oil, wells running, injectors taking water, each with change vs. the prior day.
- One card per property:
  - water and oil for the period, plus 30-day oil
  - water and oil sparklines with the selected period shaded
  - a running/down bar and an injector status bar
  - the operator of record

---

## 4. Data rules (non-negotiable)

1. **Never invent data.** If a value is missing, show "No data". Don't interpolate.
2. **Label confidence.** Anything approximate or unverified must say so in the UI. Examples:
   - operating-area hulls are "approximate"
   - routes are "shortest drive on public roads, not confirmed with LeaCo"
   - Crawford ownership is "unconfirmed"
3. **Cite the source on every layer** (tooltip or detail popup), e.g. "NM OCD", "Texas RRC", "U.S. Census TIGER", "LeaCo Daily Report Nov 19", "LeaCo KMZ".
4. **Daily totals must reconcile.** In the parsed Daily Reports, injector rows + "other" = total water, and the lease sums = total. Write a test that enforces this.
   - Known-good figures: 7-day average 26,684 bbl/day water and 52.4 bbl/day oil; all-reports water total 344,557 bbl.
5. **Known discrepancies to surface, not hide:**
   - WHRB #20 vs #21: the Amplified ID and the daily report disagree. This is in `id_note`.
   - Oncor easement width: the KMZ draws 238 ft (~73 ac), but Oncor's survey says 160 ft / 50.625 ac.
   - Injector "taking water" counts computed from rows can differ by 1–2 from the report header. Use the header's count for the KPI.
6. Percentages that would round to 100% but aren't exactly 100% display as 99% (floor).

---

## 5. Daily Report parsing (the main recurring input)

LeaCo emails a PDF "LeaCo Daily Report" each day. `reference_scripts/parse_daily.py` handles the current format. Gotchas it already solves:

- Well mentions in the narrative require `#` before the number. Without that, "East Eumont 13.1 bbl" would be read as well #13.
- Well numbers can have a letter suffix (`001F`): use `(\d+)[A-Z]?`.
- The narrative starts 3 lines after the `Source:` line. Some reports have no "Observations" heading.
- Skip table header lines like "Yesterday Prior day".
- State lease names map to area keys:
  - `MLMU` → mlmu
  - `EEU` → eeu
  - `WHRB` / `WHRA` / `RYCF#` / `RNCF1` / `RYU` / `MEWAF` / `MRWF` / `WF` → the Rhodes & Wills group
- "NCT" in state lease names comes from the state records. It conventionally means Non-Contiguous Tract.
- The Amplified asset list CSV has a UTF-8 BOM and a leading `\r\n`. Strip both.

Build this as an ingest step: drop a new PDF in, run one command, and the data updates. It must be idempotent: re-ingesting the same date replaces it rather than duplicating it.

---

## 6. Public data sources (all free ArcGIS REST)

- NM wells: `https://nhnm-gisweb.unm.edu/arcgis/rest/services/NMEDB/ActiveOilandGasWells/MapServer/3`
- Texas RRC: `https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer`
  - layer 1 = wells
  - layer 13 = pipelines
  - layer 24 = surveys
- BLM PLSS grid: `https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer`
- BLM NM surface ownership: `https://gis.blm.gov/nmarcgis/rest/services/Lands/BLM_NM_Lands_Surface_Management_Agency/FeatureServer/0`
- EIA gas pipelines: `https://geo.dot.gov/server/rest/services/hosted/Natural_Gas_Pipelines_US_EIA/FeatureServer/0`
- Census TIGER roads: `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer`
  - layers 6 and 8, bbox `-103.42,31.84,-102.98,32.80`
- USGS aerial imagery: `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer`
  - Usable as an optional basemap.
  - Gotcha: the `export` endpoint silently widens the bbox to fit the image aspect. Request `f=json` first and use the returned `extent`.

Public data refresh should be a separate, occasional job (monthly is fine), not part of the daily ingest.

**Important finding:** public road data misses almost all oilfield lease roads. Census roads cover highways, county roads and town streets only. Lease roads must come from LeaCo or the pumpers. Don't trace them from imagery and present them as fact.

---

## 7. What to build next (proposed phases; refine in your plan)

1. **Restructure.** Split the prototype into a real project:
   - data pipeline (Python): ingest daily reports, refresh public layers, build the JSON
   - front end: map + sidebar, keeping d3 or moving to MapLibre GL if you can justify it, with no API keys
   - tests for the reconciliation rules in §4
2. **Ingest.** One-command daily report ingest, plus Amplified CSV/exports when we get API or export access.
3. **Well pages.** Click a well → a full page with its history chart, every note, its IDs (API / Amplified / customer) and any discrepancies.
4. **Alerts view.**
   - Injectors stuck more than N days.
   - Wells down more than N days.
   - Big day-over-day water drops, with an estimated revenue impact at $0.265/bbl.
5. **Revenue view.** Water volume × rate by day and area. Supply and disposal shown separately once we know the split.
6. **Mobile.** Pumpers will open this on a phone in the truck. Make the map and well pages usable at 380 px wide.

## 8. Engineering expectations

- Keep it simple to host (static build + JSON is fine to start). No secrets in the repo. Put any API credentials in `.env`, gitignored.
- Keep it accessible:
  - labels on every control
  - keyboard shortcuts preserved
  - colors not the only signal (shape or text too)
- Verify visually: run the app and screenshot it (e.g. Playwright) after UI changes. Check there are no console errors.
- When something in the data looks wrong, flag it to me. Don't silently "fix" it.

## 9. Open questions (don't guess; leave a clearly marked TODO)

- How does LeaCo physically access Winkler Ranch? There is no public road for the last ~1.1 mi.
- Who owns the Crawford Ranch surface, and what is it used for?
- Does LeaCo have its own pipe/flowline maps for MLMU and the XRI delivery line?
- Can we get Amplified data by API or scheduled export instead of PDFs?
- Supply vs. disposal split of the water volumes (they're billed at different rates).

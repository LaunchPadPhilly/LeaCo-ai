# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: LeaCo's owners, at a desk.** On a wide screen, usually as a regular review of
  how operations are running. They decide what needs fixing and send contractors out to fix
  it. When the needs of the two audiences conflict, the owners' needs win.
- **Secondary: pumpers in the field.** On a phone (380 px wide), in a truck, often in bright
  sun with one hand free. The phone view must stay fully usable, but it is built on the
  desktop review rather than the other way round.
- **Admins** use `/admin` to manage users, groups, scopes and connected AI clients. That is
  supporting work, not the product's purpose.

## Product Purpose

LeaCo AI is LeaCo's internal operations dashboard (the signed-in home page) plus a read-only
MCP server that lets AI clients query the same data.

It exists so the owners can see **all the data LeaCo collects, and how current operations are
running, in one place**, then act on it, mainly by sending contractors out to fix broken
systems. The alternative is reading through everything Amplified reports, which takes too
long.

Success means that in one sitting an owner can answer, without opening Amplified:

1. **What's broken?** Down wells, stuck or idle injectors, open Amplified tickets: what
   needs a contractor.
2. **How's production?** Oil and produced water by lease over the chosen period.
3. **How much water?** Water injected against normal, and the revenue it implies.
4. **Where is it?** Where a well or property is, and how to drive there.

The owner asked for all four. Putting "What's broken?" first is inferred from the
send-contractors workflow; confirm it if the order matters for a layout decision.

## Positioning

One screen that joins every source LeaCo has (Amplified's sensors and tickets, the daily
reports' injection volumes, public New Mexico OCD and Texas RRC records, and LeaCo's land and
map layers) and summarizes it into "what is happening and what needs fixing". Amplified shows
its own sensors in full detail. LeaCo AI shows the operation as a whole, and it never
estimates, fills in or hides missing data.

## Operating Context

- **Owners' review:** pick a period (latest day, last 7 days or a date range), scan the
  headline numbers, day-by-day trends and property cards, check the attention list, then
  open the map to find a site. The result is a decision about who to send where.
- **Field use:** a pumper looks up a well, checks its status, and opens directions in
  Google or Apple Maps (the app links out; it does not embed a key-billed map).
- **Data freshness:** Amplified data is pulled on a 15-minute server timer. Injection volumes
  come only from the emailed daily reports; the Amplified API has no injection data. Local
  development can run on the daily reports ("report mode"). UAT and production run on
  Amplified alone ("Amplified mode"), with public state records filling in well locations.
- **AI clients:** the owners can also ask questions in Claude through the read-only MCP
  server. Its tools are scoped per user by an admin.

## Capabilities and Constraints

- **Data rules (non-negotiable):** missing values display as "No data", never as zero or an
  estimate. There is no interpolation, and gaps in charts are drawn as gaps. Discrepancies
  are shown, not corrected (for example WHRB-20 vs #21, report header vs per-injector counts,
  rounding gaps of up to 3 bbl). Approximate things are labelled approximate. Every map layer
  cites its source and a confidence label.
- **Status is never color alone.** It is always paired with a shape or a word.
- **Terminology:** wells, injectors, leases, properties (areas such as Winkler Ranch and
  Crawford Ranch), bbl (barrels), water injected, oil, produced water, Amplified tickets.
  The Amplified statuses are Running, Shutdown and Idle.
- **Stack (existing):** SvelteKit with Svelte 5 runes, plain CSS, d3 for charts and the map,
  and USGS National Map tiles for the background (free, public domain, no key). Credentials
  never reach the browser.
- **Undecided or pending with LeaCo** (see `docs/leaco/open-questions.md`): the supply vs
  disposal water split, so revenue is labelled "estimate at supply rate"; access to Winkler
  Ranch; Crawford Ranch ownership; LeaCo's own pipe maps; Amplified-to-LeaCo ID matching.
- **Planned, not yet built** (`docs/leaco/PLAN.md`): well pages, alerts with adjustable
  thresholds, a revenue view, and a real-phone mobile pass.

## Brand Commitments

- The product name is "LeaCo AI" (`src/lib/appConfig.ts`). No logo or brand guide exists in
  the repository.
- The visual direction is undecided. `docs/leaco/DASHBOARD-REDESIGN.md` records an earlier
  "field sheet" look, but it is not binding; the owner is still choosing.

## Evidence on Hand

- Daily reports for Nov 7–19, 2026: 13 reports, gitignored in `data/private/daily_parsed.json`.
  The known-good figures are 344,557 bbl total water, and 26,684 bbl/day water with 52.4 bbl/day
  oil averaged over the last 7 reports.
- 104 assets in the starter kit. Live Amplified data covers every well and the 11 leases, cached
  locally in gitignored `data/private/amplified/live.json`.
- Public reference data: `src/lib/leaco/reference/wells.json` and `layers.json`.
- The original prototype: `reference/prototype/map_template.html`; the brief: `reference/PROMPT.md`.
- No testimonials, customer quotes, benchmarks or usage metrics exist. Do not invent any.

## Product Principles

1. **Lead with what needs action.** The first thing on screen answers "what's broken and
   where", because the result of a visit is a contractor sent out.
2. **Summarize, don't mirror Amplified.** Show the operation as a whole. Detail is one step
   away, not on the first screen.
3. **Honest data over tidy data.** A gap, a discrepancy or an estimate is visible and
   labelled. Never hide one to make a chart look cleaner.
4. **Desk first, field-proof.** Optimize for the owner's wide-screen review, while staying
   readable in sunlight and usable one-handed on a phone.

## Accessibility & Inclusion

- Readable in bright sunlight on a phone: high contrast, and status shown by shape or word as
  well as color.
- Touch targets sized for one-handed use in a truck.
- Text meets WCAG AA contrast.

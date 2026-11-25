# Building direction A

Direction A ("Overview", [DESIGN.md](../../DESIGN.md)) was chosen on 2026-11-25 from the design
canvas (claude.ai artifact "LeaCo Dashboard Directions"). It is built in phases, one PR each;
each phase passes `db:validate`, `check`, `test:unit` and both builds before the next starts.

## Owner decisions (2026-11-25)

| # | Decision |
|---|---|
| A1 | Build everything in direction A **except the Revenue page**. |
| A2 | Deliver in phases, one PR per phase. |
| A3 | Issues: everyone can see them; **only admins** can mark "contractor sent", archive or bring back. |
| A4 | Map page: ship the full filter panel from the reference map now. Layers whose data isn't loaded say so; loading that data is a separate task. |
| A5 | Background map: **Topo by default**, changed in **Settings → Map**, not on the map. |
| A6 | Census "Public roads" stays removed (owner request, 2026-11-20). |

## Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Design tokens; header renamed to Overview with a phone menu; Overview with "Needs a contractor" beside live Amplified; in-place status key; sign-in; Settings → Map background; states restyled | Built 2026-11-25 |
| 2 | Issues page: open / contractor sent / archived / resolved, archive with reason and return date, issue rules; database tables and audit events | Not started |
| 3 | Well page (`/wells/[key]`) with saved status history; Daily reports page | Not started |
| 4 | Full map page with the reference map's filter panel | Not started |
| 5 | Admin screens: users with switches, agents, connected apps, activity log | Not started |

## Not built

- Revenue page (A1). The Overview has no revenue tile.
- The map's Go to, rotation and north arrow are unchanged from today's map until phase 4.

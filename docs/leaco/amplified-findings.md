# Amplified Customer API: what LeaCo's account returns

Checked 2026-11-20 with read-only requests (`pnpm run amplified:probe` plus follow-up scripts),
against the vendor's **Customer API - Technical Documentation** (provided by the project owner the
same day). Raw responses and the worksheet below are in gitignored `data/private/amplified/`
(LeaCo business data).

## What the documentation says that matters here

- **Identifiers.** Assets are looked up by `customer_asset_id`, a string **the customer sets** on the
  asset's *Properties* page in Amplified's dashboard. It's meant for "systems that manage their own
  asset identifiers". `/customer_api/assets` lists only assets that **have** one. Responses also
  carry `amplified_id`, `asset_name` and `lease_name`. There is no state API number.
- **Tags.** Wells: pressures, SPM, pump fillage, loads, last connection, `daily_runtime` (previous
  calendar day, **Central** time; LATEST only), `daily_cycles`, `well_run_status`
  (Running / Shutdown / Idle; LATEST only), open `tickets`, `dynacard`. Leases: `daily_oil_production`,
  `daily_water_production` (the lease ledger's Daily Production; **UTC days**; a missing day is absent,
  not zero), `tickets`. **No tag measures injection volume or rate.**
- **Quality.** `Bad` means missing, out of range, or failed. Treat it as "No data", never as a value.
- **Limits.** 20 assets per request; 100 requests/minute on `/customer_api` and `/customer_api/assets`.
  The existing connector (`src/lib/server/amplified/`) already follows these.

## What LeaCo's account returns

- **Counts:** 106 wells, 15 tanks, 11 leases.
- **Producing wells are live:** run status, runtime and tubing pressure, updated within minutes.
- **Injectors have no data:** every injector tag sampled (MLMU 141) returned `null` with quality `Bad`.
- **Lease "water" is produced water** (~700–1,000 bbl/day), not the ~27,000 bbl/day injected that XRI
  pays for.

## Matching Amplified to LeaCo's wells: the documented way

The current `customer_asset_id`s were typed in by hand and are inconsistent (`East_Eumont_Unit_21`,
`Well_WH_Rhodes_B_Fed_NCT_1_28`, `W_H_Rhodes_B_Federal_NCT-1_#21`). Because LeaCo controls this
field, the fix the documentation points to is **setting each asset's `customer_asset_id` to LeaCo's
own ID**. Matching then needs no name parsing.

LeaCo's asset list (`amplified_asset_list.csv`) already has that ID plan: 133 unique IDs such as
`EEU-021-PRD`, `MLMU-141-INJ`, `EEU-OT1`. (Its "amplified id" column is a different numbering from
the API's `amplified_id` and is not used.)

**Worksheet:** `data/private/amplified/customer-id-worksheet.csv` lists, for every asset, its current
`customer_asset_id`, its `amplified_id`, its name, the **new ID** to set, and a check column.

| | Total | Ready to set | Need a decision |
|---|---|---|---|
| Wells | 106 | 90 | 16 |
| Tanks | 15 | 15 | 0 |
| Leases | 11 | 10 | 1 |

No new ID is used twice.

### Needing a decision

1. **Amplified asset 6851:** its ID says `W_H_Rhodes_B_Federal_NCT-1_24` but its name says **#20**,
   and asset 6362 is also `..._24`. Likely the WHRB #20/#21 problem. **Which well is 6851?**
2. **12 wells Amplified names as plain wells but LeaCo's list calls injectors:** EEU 9, 11, 14, 18,
   20, 25, 28, 35, 36, 41 and MLMU 105, 244. The worksheet proposes the `-INJ` IDs. **Confirm.**
3. **In Amplified, not in LeaCo's list:** WHRB #30, Rhodes Yates Coop Fed Com 4 #2, and
   `Myers_Langlie_Mattix_Unit_Battery` (a facility). **Give them IDs, or leave them out?**
4. **Lease `WH_Rhodes_B_Federal_NCT-1`** has no matching lease in LeaCo's list. **What ID?**
5. **MLMU 204 Injector** is in LeaCo's list but not returned by the API, so it probably has no
   `customer_asset_id` set in Amplified. **Set `MLMU-204-INJ` on it.**

### Before changing IDs in Amplified

- It's done in Amplified's dashboard (asset → Properties) by someone at LeaCo.
- **Anything already calling the API with the current IDs breaks** until it's updated. That includes
  the `amplified_*` MCP tools on UAT if anyone has saved queries with the old IDs (the tools look up
  IDs live, so new queries are fine).
- Until the IDs are changed, the dashboard sync can use this worksheet as its lookup table and switch
  to exact matching once they are.

## Live sync (built 2026-11-20)

`pnpm run amplified:sync` (and the dashboard, every 15 minutes) pulls the current data for the **90
confirmed wells**, all 11 leases (30 days of oil and produced water) and open tickets into
`data/private/amplified/live.json`. The worksheet's `leaco_well` column says which of LeaCo's wells
each row is; rows with a CONFIRM note are not linked, and the dashboard shows the reason on that
well. A well whose device hasn't checked in for over 24 hours is flagged "status may be out of
date" (8 of the shut-down wells at the first sync).

## Other open questions

1. **Where does "water injected" come from?** The daily report's ~27,000 bbl/day and per-injector
   volumes aren't in the Customer API (the documentation lists no such tag). Is it from another
   system (XRI meters, SCADA)?
2. **Are injectors instrumented in Amplified at all?** Every injector tag returned `Bad`.
3. **Which day is which.** Amplified's lease figure for UTC day D matches the daily report dated
   D+1 (its "yesterday" column) within a few percent; `daily_runtime` uses Central-time days. Which
   figure is authoritative when they differ?

# LeaCo — open questions

Questions only LeaCo can answer. **Don't guess.** Code that depends on an answer carries a
`TODO(LeaCo): <question number>` marker so it can be found with `grep -rn "TODO(LeaCo)"`.

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | How does LeaCo physically reach Winkler Ranch? There is no mapped public road for the last ~1.1 mi. | The Winkler "unmapped" segment stays a red dashed line labelled unmapped. | Open |
| Q2 | Who owns the Crawford Ranch surface, and what is it used for? | Crawford shows "ownership unconfirmed". | Open |
| Q3 | Does LeaCo have its own pipe/flowline maps for MLMU and the XRI delivery line? | No LeaCo pipe layer is drawn until then. | Open |
| Q4 | Amplified API access: key, account, history depth, refresh rate. *(Docs exist as a private Notion page that hasn't been read yet.)* | Phase 2 sync. | Partly answered: the API is the chosen source |
| Q5 | Split between supply water ($0.265/bbl) and disposal water ($0.13/bbl). | Revenue is labelled "estimate at supply rate" until answered. | Open |
| Q6 | Where does "water injected" (~27,000 bbl/day, per injector) come from? It is not in the Amplified Customer API. | Water and injector figures can only come from the daily reports. | Open: see [amplified-findings.md](amplified-findings.md) |
| Q7 | Set each asset’s customer_asset_id in Amplified to LeaCo’s IDs (worksheet ready). Decisions needed first: Amplified asset 6851 (#20 or #24?), 12 wells Amplified labels as producers but LeaCo lists as injectors, 3 Amplified assets not in LeaCo’s list, one lease ID, and MLMU 204 missing an ID. | Exact Amplified-to-LeaCo matching for the sync. | Open: see [amplified-findings.md](amplified-findings.md) |

## Data issues to confirm with LeaCo

Found in the starter kit's `id_note` fields and Daily Reports. Shown in the UI as they are;
not corrected.

| Asset / item | Issue |
|---|---|
| WHRB-20 | Amplified's asset list has NCT-1 #21; the Nov 13 report names #20; the state has both. Which number is the sensor on? |
| WHRB-24 | Possible duplicate row with the same name. Which one to keep? |
| WHRB-29 | Named "23 B Federal", unlike the other WH Rhodes B wells. Confirm the lease. |
| WF-8 | Wills Federal well filed under the Mr Wills Federal lease. Confirm the lease. |
| Oncor easement | KMZ draws 238 ft (~73 ac); Oncor's survey says 160 ft / 50.625 ac. |
| Injector counts | Report header vs. per-injector rows differ by up to 3 (e.g. Nov 9: 10 vs 7). The header count is used for the KPI. |
| Totals rounding | Rows differ from the total by up to 3 bbl on 9 of 13 reports. Treated as rounding (PLAN D3). |

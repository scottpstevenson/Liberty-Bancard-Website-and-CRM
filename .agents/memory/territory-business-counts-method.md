---
name: Territory business counts method
description: How to count canonical businesses by SFP county with vertical/email facts on production, since county_fips is empty and the resolver is TypeScript.
---
- Canonical businesses = `businesses.record_class='canonical'` (about 100k; `production` and `unknown` record classes are not canonical). Program scope comes from the active `sfp_programs` row (taxonomy 2, five verticals, counties 12011/12086/12099).
- County cannot be computed in SQL: group in production SQL by geography signature (state, postal_code, city, ordered `business_locations` JSON) with a small integer bit-code of per-business facts, string_agg the `code:count` cells (about 4.8k groups, ~300 KB), then evaluate each group in a repo-local tsx script with the real `resolveBusinessCounty` (map location JSON to id/is_primary/city/state/postal_code/county_fips; order index stands in for id).
- `resolveBusinessCounty` returns "unresolved" for outside-territory too, so "not in the three counties" cannot be split into outside vs unresolved from its output.
- Accepted vertical = live `effectiveBusinessVerticalStatusSql`='mapped' and in program vertical_ids; the stored `businesses.effective_vertical_*` projection matched it on 2026-11-11 (8,300 mapped), but the backlog and launch gates use the live SQL.
- Email facts used by the backlog read model: usable linked contact, staged found email (free_discovery_candidates, not linked), `businesses.main_email`. State which of these a count includes.

**Why:** answering "how many canonical businesses in the SFP counties have an email / vertical" needed all of this; none of it is visible from the schema.
**How to apply:** reuse the bit-code + tsx evaluation recipe; keep temp scripts in a repo-local dir (node_modules resolution) and delete them afterwards.

## Location-spelling gap and neighbouring-county yield (2026-11-11)
- The city map is exact-match only: abbreviated/misspelled three-county cities ("W. Palm Beach", "Deerfield Bch", "Ft.Lauderdale", "N. Miami Beach") resolve as unknown, so at least ~1,300 canonical businesses that are really in territory count as unresolved; almost none have a vertical or email because classification and email search are geography-gated.
- Canonical businesses in nearby counties are few (city-based estimate: Lee ~190, Collier ~140, St. Lucie ~90, Martin ~55, Indian River ~45, Monroe ~30, Okeechobee ~13, Hendry ~6; about 70 with both vertical and email), so territory expansion adds little without new discovery.
**Why:** the user asked whether more counties should be included; the answer was driven by these counts, not by geography alone.

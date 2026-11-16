---
name: Vertical expansion audit
description: How to size "what if we added Restaurants/another vertical" and the ready-and-validated pool on production, plus the 2026-11-16 baseline.
---
- Ready-and-validated pool = ready_held intents run through `buildRecordedLaunchQuery(180, undefined, "set")` rendered with PgDialect and inlined params (temp tsx in repo), per-row output with a geography md5 key, plus a separate distinct-geography query; evaluate the county locally with `resolveBusinessCounty`. Per-row output stays under the 1 MiB result cap; a combined geography+row query does not. Contact-policy evaluation (consent/hygiene authority) is not reproduced by this method.
- One contact can hold several ready_held intents (older ones with retired sequences), so count distinct contacts, distinct email hashes and distinct businesses; never intents.
- Baseline 2026-11-16: ready_held 1,691 intents / 1,611 contacts / 1,242 businesses; passing recorded gates 1,574 contacts (1,490 distinct addresses) on 1,215 businesses, all lifecycle PROSPECT; 266 pending_validation contacts on 235 businesses would qualify once validated.
- Expansion sizing: only ~16% of canonical businesses carry a `vertical` label (classification is website-gated); the rest need name signals. Restaurants are explicitly non-target in the v2 classifier (curated labels, name-derived), so labelled restaurant businesses sit in `excluded` until reclassified under a new policy version; a bound live sequence/package is also required.
- `canonical_source_links` has zero DBPR-family rows in production (sources are sunbiz, outscraper, crm), so the DBPR exclusion currently removes no canonical business; it would only bite if DBPR links are ever added.
- Production contacts labelled restaurant/food (~21.7k) are almost all `unsupported / LEGACY_CONTACT_FIELDS_ONLY` with no business link (only 264 linked), so they are not addable by changing the vertical list alone.
- Only ~1,573 ZeroBounce 'valid' observations are inside the 180-day window overall (essentially the current SFP pool), so any new vertical starts with ~0 validated addresses.

**Why:** the owner asked how many businesses a Restaurants (plus one more) vertical would add; these facts decided what "addable now" meant.
**How to apply:** report labelled vs name-only separately, in-territory vs total, and "has email in hand" vs "needs discovery"; state that validation spend and a bound sequence are prerequisites.

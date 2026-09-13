---
name: CRO-08A source-scope allowlist and pilot-ladder gate pitfalls
description: Two gotchas found while activating the CRO-08A continuous enrichment factory — a wrong source-system allowlist, and test residue that can satisfy the production pilot-ladder gate.
---

## Source-system allowlist must come from the live table, not guessed from table names

When restricting CRO-08A (or any census-driven worker) to a set of allowed
`source_system` values, query `cro03a_census_cursors` for the real values in
use rather than assuming they match canonical table names. The actual set
seen in this codebase is `lead_discovery_results`, `master_leads`,
`prospects`, `sdr_merchants`, `sunbiz_entities` — NOT `businesses` or
`contacts`. `businesses` is a downstream canonical target table that
qualification writes into; it is not itself a census source. A first-draft
allowlist that assumed `businesses` was a source silently allowed nothing to
match if any typo'd/guessed name is used, or would perversely need to reject
every read source-system that actually exists.

**How to apply:** before adding any new source_system allowlist/blocklist,
run a one-off query against the live `cro03a_census_cursors` (or equivalent
cursor table) to enumerate real values first.

## `sourceRecipePolicyVersions` on a CRO-08A schedule definition is NOT a source-system list

Its keys are recipe/policy identifiers (e.g. a literal test key `"recipe"`),
not `source_system` values. Applying a source-system allowlist against
`Object.keys(input.sourceRecipePolicyVersions)` in
`createCro08aScheduleDefinition()` causes false-positive rejections. Any
source-scope enforcement belongs at the scheduler/processor layer, where the
code is actually walking real `source_system` values from frozen cursor
snapshots — not at schedule-definition-creation time.

## MI-09 pilot-ladder completion gate can be satisfied by test residue — mitigated only by DB separation

`scripts/test-cro08a-continuous-factory.ts` intentionally leaves real,
non-cleaned-up rows in `mi09_pilot_definitions`/`mi09_pilot_runs` (tagged via
`pilot_definition_hash LIKE 'cro08a-test-pilot-def-%'`) so its own DB-level
unit test can exercise `activateCro08aScheduleDefinition()`'s happy path
without running a genuine MI-09 pilot. `assertPilotLadderCompletion()` in
`server/services/cro08a/schedule-authority.ts` has no query-level filter to
exclude this residue — there is no `is_test` discriminator column on
`mi09_pilot_definitions`.

**Why this is not fixed at the query level:** adding a hash-prefix exclusion
breaks the test's own happy-path assertion, which relies on that exact
residue to pass. There's no cheap discriminator that both lets the unit test
validate a real activation AND blinds a genuine production gate to it.

**Why it's accepted as-is:** the operative safeguard is that dev and
production always use separate databases (see
`publish-vs-dev-environment-drift.md`) — this test must never be run with
`DATABASE_URL` pointed at production. If a dedicated `is_test` flag is ever
added to `mi09_pilot_definitions`, revisit this and filter on it explicitly
instead of relying solely on environment separation.

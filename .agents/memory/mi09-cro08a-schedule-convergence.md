---
name: MI-09/CRO-08A schedule-definition and pool-authority convergence
description: How operator-approved MI-09 config (pool authority, CRO-08A schedule definitions) gets into production despite read-only prod DB access, and a known gap in what those definitions actually control today.
---

Production DB access for this agent is read-only. Any operator-approved config that must land in production (pool authority decision, pricing artifacts, CRO-08A schedule definitions) is written through `server/services/production-seed-convergence.ts` as a new SEED_TARGETS entry, never directly. Each target must be safe to call on every boot:

- `mi09_pool_authority_decision` — write-once: only calls `setPoolAuthorityDecision()` if `getPoolAuthorityDecision()` currently returns null. Never overwrites an existing decision, including one a human later changes via the admin UI.
- `cro08a_candidate_enrichment_schedule` / `cro08a_candidate_freshness_refresh_schedule` — call `createCro08aScheduleDefinition()` directly; it's already idempotent by content hash (unchanged input reuses the row, a genuinely different input mints a new `definitionVersion`), so no extra write-once guard is needed. Created **inactive** — activation stays behind the separate MI-09 pilot-ladder gate in `schedule-authority.ts`, untouched by convergence.

**Known gap found while wiring this**: `cursorSemantics` and `sourceRecipePolicyVersions` are required fields on a CRO-08A schedule definition, but nothing downstream (`cro08a-scheduler.worker.ts`, `occurrence-service.ts`) actually parses them to scope which source system/records an occurrence processes — they're currently descriptive/inert. Tracked as follow-up task #1952. Don't assume setting these fields "correctly" actually constrains anything yet.

**Why:** keeps a single startup-time, insert-only, hash/null-guarded path as the only way operator-approved MI-09 config reaches production, consistent with the rest of the production-seed-convergence pattern (see `production-seed-convergence.md` equivalents for other domains — check MEMORY.md index).

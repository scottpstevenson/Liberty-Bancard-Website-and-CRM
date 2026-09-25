---
name: SFP campaign-staging corrective patch (Task #2001 post-merge audit)
description: What was actually fixed vs deferred in the SFP package-pinned campaign-staging system after its post-merge audit found 15 issues.
---

Audit found 15 issues (PM-01..PM-15) in the SFP campaign-staging system
(`server/services/cro03/sfp-campaign-staging-v2.ts`, `sfp-campaign-packages.ts`,
`sfp-outreach-policy.ts`, `sfp-paid-evidence-writer.ts`, `sfp-campaign-staging-worker.ts`).

**Fixed and verified (tsc clean + app restart clean):**
- PM-01: staging worker was suffixing `preview.commandKey` before calling `executeStagingV2()`, causing a self-inflicted mismatch error.
- PM-02: package convergence now runs each package's resolve/create/narrow/pin as one transaction (was separate autocommits — crash could orphan a campaign/sequence) and actually performs "narrow_campaign" (previously silently skipped, leaving shared multi-vertical campaigns un-narrowed).
- PM-03: plaintext-confinement — `openSfpCandidatePlaintext()` takes an `executor` param so its internal reads bind to the caller's tx; the `master_leads` insert now happens *inside* that callback using plaintext directly, never returned across the function boundary.
- PM-04: `executeStagingV2` command now has a real `pending -> executing -> completed` DB-persisted lifecycle (column added via migration 0292) instead of writing a receipt only after all rows succeed — crash recovery resumes into the same command row rather than mis-derived "snapshot drifted." Eligibility IDs are canonicalized (dedup-rejected + sorted) for deterministic ordering/hashing. Concurrent callers on the same commandKey converge on one canonical stored_result via a WHERE-guarded UPDATE, never two "winning" local results.
- PM-05: `evaluateSfpMutableSafetyGates`/`isCanonicallySuppressed`/`lookupConsentTierByEmailHash` in `sfp-outreach-policy.ts` now take an optional executor param so they can be bound to the staging transaction; `stageOneRowTransactional` uses them instead of a duplicated inline DBPR/existing-customer check, locks the active-policy singleton row inside the tx, and pins `activePolicy.documentHash` (not a locally re-derived `sha256(activePolicy)`).
- PM-06/PM-07: migration 0291 re-asserts the outreach-policy singleton CHECK and flips `sfp_programs.schedule_config.campaignStaging` default to `0` (off).
- PM-09: added a DB trigger making package-version payload columns (package_key/vertical/campaign_id/sequence_id/content_hash) immutable, a unique index enforcing one `current` package per vertical (migration 0293), and `getCurrentPackageForVertical`/`applyPackageConvergence` now validate vertical match + campaign/sequence state instead of trusting any "current" row.
- PM-11: retired the legacy `POST /api/lead-ops/sfp/runs/:runId/stage-for-campaign` route (410) instead of adapting it — it bypassed the whole v2 preview/commandKey/policy-pin contract.
- PM-14: fixed runbook route names (`campaign-staging-v2` not `staging-v2`), corrected the "backfilled to 10" claim to "0/off", softened telemetry/dead-letter-recovery claims to match actual (unbuilt) capability.

**Deferred as follow-up tasks (large, independent scopes — see project tasks #2015/#2016/#2017):**
- PM-08: certification suite needs to exercise the real recurring worker tick, real package convergence, injected crashes, and canonical concurrent-receipt checks — not source regexes and hand-seeded fixtures.
- PM-10: manual staging still creates no `sfp_stage_runs`/`sfp_stage_items` ledger row; run/item counters and the intent/master-lead/eligibility writes aren't one atomic commit; aggregate rejection reasons get misattributed to unrelated failed rows.
- PM-12/PM-13: preview/execute DTOs are missing several required per-row fields (payloadHash, package-version content hash, policy hash/version, validation age); execute doesn't require a confirmation token; no admin retry/cancel/pause UI exists (runbook's only recovery path is a raw SQL UPDATE); telemetry conflates capability-group membership with live worker health and is unscoped by program.
- PM-15: repo hygiene (stray attached_assets files) not addressed — low priority, not a correctness issue.

**Why this split:** PM-01/02/03/05/06/07/09/11/14 were each a bounded, verifiable fix within existing files/transactions. PM-04 also fit (a lifecycle column + logic change). PM-08/10/12/13 each require new schema (ledger tables), new UI surfaces, or a certification-harness rewrite — multi-file efforts each comparable in size to everything already done, better tracked and executed as their own scoped tasks than folded into one already-large session.

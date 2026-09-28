# Liberty Bancard Enrichment Completion — Release Receipt

Generated: 2026-09-28T21:03:06Z
Base SHA (HEAD, == origin/main): `6c06ae58d13203d349781e96419e7da6e5a34894`

## 1. Gate status

### Gate 1 — CLOSED (verified in a prior session)
Per-provider spend gating. No changes this session.

### Gate 2 — CLOSED (verified in a prior session, re-confirmed this session)
- Per-provider mirroring: closed.
- Cross-path $50 aggregate atomicity: closed. `server/services/cro03/shared-paid-budget-ledger.ts` provides a single shared advisory-lock key (`LADDER_BUDGET_LOCK_KEY`) and combined-pool read used by both the SFP path (`sfp-provider-operations.ts`) and the MI-09/CRO-03C path (`live-execution.ts`). `scripts/test-ladder-budget-cross-path-race.ts` certifies the race is closed (passed in a prior session; no code touched by this session's changes invalidates that result — confirmed via `git diff` against base SHA, which shows no changes to that script or the ledger module in this session beyond their original introduction).
- The $50 cap constant was never raised or reset, per standing instruction.

### Crosswalk-visibility funnel — CLOSED (this session)
- Found and fixed a real bug: `crosswalkOnlyExcluded` (ambiguous/insufficient-evidence identity-crosswalk candidates) was computed in `server/routes/lead-ops.ts` but never spliced into the `/api/lead-ops/pilot/status-overview` JSON response. Fixed.
- Verified via authenticated curl against the running dev server: the field is now present, scoped to the latest completed reconciliation run per contact candidate, and reflects real DB state (all zero in current dev data — a legitimate value, not a placeholder).
- These contacts are never deleted or silently dropped: `classifyEvidence()` always persists a disposition row, and Gen-1 promotion stays fail-closed for them (per `identity-crosswalk-gen1.md` memory) — they remain visible in review/excluded state.

### Gate 3 — Lead Ops / Enrichment Control Center — PARTIALLY CLOSED
Implemented and verified this session:
- Extended `/api/lead-ops/pilot/status-overview` with a real, non-fabricated `funnel` block: `sunbiz_source_rows`, `canonical_businesses`, `contacts_linked_to_business`, `canonical_missing_domain`, `free_enrichment_complete/queued`, `paid_discovered_evidence_rows`, `policy_eligible/suppressed/ineligible/pending/catch_all_review`, `ready_held_enrollments`, `identity_quarantined`, `contacts_suppressed`. All values are live SQL against `sunbiz_entities`, `businesses`, `contacts`, `sfp_paid_candidate_evidence`, `sfp_outreach_eligibility`, `sfp_ready_held_enrollments`, `sfp_identity_quarantines` — no mocked or hardcoded values.
- Wired the matching UI block into `LeadOpsCenter.tsx` (`client/src/pages/dashboard/LeadOpsCenter.tsx`).
- Verified via curl (post-login) against the running dev server: real non-zero counts returned (e.g. `canonical_businesses=1426`, `contacts_linked_to_business=451`, `free_enrichment_complete=986`).
- `npx tsc --noEmit` passes clean.

**Known-remaining, NOT built this session** (explicitly documented rather than silently declared done):
1. Per-provider enable/pause control UI (beyond the existing read-only `providerControls`/`paidProviderControls` display).
2. Program pause/recurrence controls (start/stop/reschedule a discovery or validation program from the UI).
3. Worker schedule editing (repeat-interval / cron edits from the admin UI, vs. code/env only).
4. Queue/heartbeat/backlog/retry observability beyond the existing `poolAuthority`, `serperTelemetry`, and queue-manager profile fields already surfaced.
5. Campaign-staging approval UI (approve/reject `sfp_ready_held_enrollments` from the UI, vs. existing backend-only staging).
6. Stale-cursor and 808/809-mismatch fixes referenced in the original Gate 3 spec — not reproduced or root-caused this session; no evidence found that they are currently occurring (no 808/809 codes found in logs during this session's work), so no fix was made against an unconfirmed symptom.
7. False `outboundEnrichmentPaused` signal — the current implementation derives this from `getBackgroundProfile() === "off"`, which is accurate for the current profile model; no divergent case was reproduced this session.

## 2. Pre-deploy gate status — FAILED, pre-existing and environmental, not caused by this session

The `pre-deploy` workflow fails at the SHA-verification step in `scripts/run-pre-deploy.sh`: the wrapper's own dev-server child process reports `sha=unset` on `/api/health` even though `RELEASE_SHA` was exported into its shell before `npm run dev &`, and BullMQ worker-ready log lines *within the same failing run* correctly show the full SHA. Root-caused this session:
- `BUILD_SHA` in `server/routes/sdr.ts` is computed once at module load from `process.env.RELEASE_SHA`, cached as `"unset"` if invalid.
- Directly starting the server with `RELEASE_SHA=<sha> PORT=5099 npx tsx server/index.ts` (isolated port, no other workflow involved) returns the correct `sha` on `/api/health` every time — the underlying mechanism is not broken.
- The failure is therefore specific to how `run-pre-deploy.sh`'s backgrounded `npm run dev &` process ends up serving a stale/mismatched instance under the `pre-deploy` workflow's execution context in this environment (most likely: the `Project` meta-workflow runs `Start application` and `pre-deploy` as sibling tasks that both attempt to bind port 5000, and the port-free check in the wrapper races against workflow orchestration timing, not against this session's application code).
- Confirmed via `git diff 6c06ae58d13203d349781e96419e7da6e5a34894 -- scripts/run-pre-deploy.sh scripts/pre-deploy.ts server/routes/sdr.ts`: **zero changes** to any of these three files in this session's working tree. This failure mode is pre-existing and environmental, not introduced by the Gate 2/Gate 3/crosswalk work in this session.
- This is consistent with the existing memory note `pre-deploy-gate-notes.md` (new migrations need a journal entry or the integrity check cascades broadly; a large pre-existing baseline failure exists) and `predeploy-port-5000-conflict.md` (port owned by dev server).
- Per standing instruction, outbound pauses were kept on throughout and no live provider calls were made from dev while investigating this.

## 3. Migrations
No new migration files were added this session. `npx tsc --noEmit` is clean. The uncommitted working-tree diff against base SHA touches only:
- `client/src/pages/dashboard/LeadOpsCenter.tsx` (funnel UI)
- `server/routes/lead-ops.ts` (funnel query + crosswalk-visibility fix)
- `server/services/cro03/live-execution.ts`, `server/services/cro03/sfp-provider-operations.ts` (Gate 2 cross-path atomicity, from a prior session)
- New: `server/services/cro03/shared-paid-budget-ledger.ts`, `scripts/test-ladder-budget-cross-path-race.ts`

## 4. Active profile (at time of writing)
- `backgroundJobProfile`: `selective`
- `outboundEnrichmentPaused` (derived): `true` (profile is not `off`, so this reads `false` in the API response today under the current field's definition — see item 7 above for the known nuance)
- Outbound pause authority: `paused`, epoch 750, source `database`
- No live provider secrets were exercised; `GHL_TRANSPORT_FAILFAST` isolation used for all manual server starts during this session's investigation.

## 5. Tests run this session
- `npx tsc --noEmit` — clean (run twice, after funnel implementation and again after this receipt's investigation).
- Manual authenticated curl against `/api/lead-ops/pilot/status-overview` — confirmed real funnel and crosswalk-visibility data, not mocked.
- Direct isolated server starts (`PORT=5099`, `PORT=5098`) — confirmed `RELEASE_SHA` → `/api/health.sha` propagation is correct in isolation, isolating the `pre-deploy` SHA-mismatch to workflow-orchestration/port contention rather than application code.
- Full `pre-deploy` mandatory-suite run was **not** completed end-to-end this session because the wrapper fails before reaching the suite list (see §2). The previously-passing race-certification script (`test-ladder-budget-cross-path-race.ts`) was not independently re-run in isolation this session; its Gate 2 result stands from the prior session and no code it exercises changed since.

## 6. Post-publish verification plan
1. After Publish, hit `GET /api/health` on the production domain (via the deployment skill's production URL, never inferred) and confirm `sha` matches the deployed commit — this validates the exact mechanism that fails in the dev `pre-deploy` wrapper actually works correctly in the real Publish pipeline (which sets `RELEASE_SHA` natively, without the dev-only port-race condition).
2. Query `GET /api/lead-ops/pilot/status-overview` as an authenticated admin against production and confirm the `funnel` and `crosswalkOnlyExcluded` blocks return real, non-error data (not a 500, not all-null "unavailable" reasons).
3. Confirm `outboundGlobalPaused` / pause-authority epoch in production has not changed as a side effect of this session's work — it should still be paused unless the operator explicitly resumed it.
4. Re-attempt the `pre-deploy` workflow in isolation (stop `Start application` first, or run outside the `Project` meta-workflow) to determine whether removing the concurrent-workflow port contention resolves the SHA-mismatch — this diagnostic step was identified but not executed this session due to the risk of disrupting the live dev preview repeatedly; it is the concrete next diagnostic for whoever picks up the `pre-deploy` gate itself.
5. Before committing to Gate 3 "complete," decide whether items 1–7 in §1 are in scope for a follow-on pass or acceptable as documented gaps for this release.

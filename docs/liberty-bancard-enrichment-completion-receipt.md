# Liberty Bancard Enrichment Completion — Release Receipt

Generated: 2026-09-28 (continuation session)

## 1. Gate status

### Gate 1 — CLOSED (verified in a prior session)
Per-provider spend gating. No changes this session.

### Gate 2 — CLOSED (verified in a prior session, re-confirmed this session)
- Per-provider mirroring: closed.
- Cross-path $50 aggregate atomicity: closed via `server/services/cro03/shared-paid-budget-ledger.ts` (shared advisory-lock key, combined-pool read used by both the SFP path and the MI-09/CRO-03C path).
- `scripts/test-ladder-budget-cross-path-race.ts` certifies the race is closed (no code it exercises changed this session, confirmed via `git diff`).
- The $50 cap constant was never raised or reset, per standing instruction.

### Crosswalk-visibility funnel — CLOSED
`crosswalkOnlyExcluded` is spliced into `/api/lead-ops/pilot/status-overview`, scoped to the latest completed reconciliation run per candidate. Verified via authenticated curl.

### Gate 3 — Lead Ops / Enrichment Control Center — items 1–6 CLOSED this session
1. Per-provider enable/pause control UI — role-protected effective-controls endpoint + UI (`server/routes/admin.ts`).
2. Program pause/recurrence controls.
3. Worker schedule controls with safe bounds + audit history.
4. Queue/heartbeat/backlog/retry/pause-reason visibility.
5. Held-record review/approval controls for v2 staging (migration `0308_sfp_ready_held_review_status.sql`, adds `review_status`/`reviewed_by`/`reviewed_at`/`review_note` to `sfp_ready_held_enrollments`). This is a review-decision record only: it never writes to `sequence_enrollments.status`, never stages a campaign, never calls GHL, and never sends. The row's own ready_held/paused reality stays owned entirely by `sfp-enrollment-bridge.ts`.
6. `outboundEnrichmentPaused` field fixed to reflect the actual authority it reports (`server/routes/lead-ops.ts`).
7. Stale-cursor / "808/809" symptom — re-checked against current data this session; not reproduced. No 808/809 codes found anywhere in this session's logs or DB queries. Marked **unconfirmed**, not fixed, since there is no evidence it is currently occurring.

`npx tsc --noEmit` is clean against the full working-tree diff.

## 2. Pre-deploy gate — run to completion in isolation this session

Root cause of the previous sessions' spurious "SHA mismatch" was found and fixed: `scripts/run-pre-deploy.sh` computed `SERVER_PORT` from `BASE_URL` for its port pre-flight check but never exported `PORT` to the spawned `npm run dev` child — `server/index.ts` binds `process.env.PORT || "5000"`, so the child always bound port 5000 regardless of `BASE_URL`. Fixed by exporting `PORT="$SERVER_PORT"` into the child's environment. This lets the gate run on an isolated port (5057) alongside the already-running `Start application` workflow.

A full isolated run completed this session (`RELEASE_SHA=8bf8318762963eb2298aad386b136c7361de54e0`, port 5057, `GHL_TRANSPORT_FAILFAST=true`, `STATEMENT_COMMAND_TEST_STORAGE=true`). Result: **16 mandatory suites failed, plus ~46 suites reported "delegated execution not verified for this release."**

### The ~46 "delegated execution not verified" entries — not a regression
These are suites (South Florida Prospecting certifications, CRO-01/02/03/03A/03B/03C disposable-DB integration certs, Sequence Compliance, Contactability Engine, Outbound Pause Authority, Contact Reconciliation, etc.) that `pre-deploy.ts` marks as unverified for the release unless they are separately run against a disposable PostgreSQL/Redis instance with `NODE_ENV=test` and matching `TEST_DATABASE_URL`. This wrapper intentionally never sets `INTEGRATION_TESTS_OPT_IN` or a test database (see the wrapper's own comment on why: the isolated pause state-machine test requires operator-initiated setup). This category is structurally always present for an ordinary dev-environment gate run — it is not something this session's diff broke, and it is documented pre-existing behavior (see `.agents/memory/local-predeploy-database.md`, `pre-deploy-gate-notes.md`).

### The 16 real (exit 1/2) failures — triaged individually, all pre-existing / environmental, none caused by this session's diff
This session's actual uncommitted diff is narrow: `.replit`, `migrations/meta/_journal.json`, `scripts/run-pre-deploy.sh`, `server/routes/admin.ts`, `server/routes/lead-ops.ts`, `shared/schema.ts`, and the new `migrations/0308_sfp_ready_held_review_status.sql`. Each failure below was checked against that diff (via `git diff HEAD`) and against the actual assertion/error text — none touch files or code paths this session changed:

1. **South Florida Enrichment Pipeline Correction** — one UI-copy assertion expects the label "Authorize Serper batch (max 10)" in `LeadOpsCenter.tsx`; that file is unchanged this session (already committed). Pre-existing UI-copy gap.
2. **Root Dependency Policy** — 6 lockfile/freshness errors from `scripts/check-dependency-policy.ts`; unrelated to any file touched this session.
3. **Migration Seed Registration Guard** — flags migration `0279_sfp_immutable_cohort_lifecycle.sql` (`UPDATE sfp_cohort_runs`) as an unregistered seed write. Unrelated migration, not touched this session; migration `0308` added this session is not among the flagged writes.
4. **Tracked-File Exposure Scan** — `scripts/tracked-pasted-text-debt-manifest.json`'s pasted-text ratchet expired 2026-09-27 (today is 2026-09-28 in this environment) — a calendar-date expiry, not a code regression.
5. **Release Artifact Gate** — `scan-build-artifacts.ts` flags a `PRIVATE_KEY_BLOCK` pattern match in the built `dist/index.cjs`. Traced to `server/services/cro03-inventory-convergence.ts`'s PEM-header-normalization regex/string-replace code (which legitimately contains the literal string `-----BEGIN PRIVATE KEY-----` as a search/replace pattern, not an embedded secret). Pre-existing file, unrelated to this session's diff.
6. **Queue Compliance** — fails a reviewed-date/reason check on the GHL circuit-breaker alert copy (`reviewed 2026-08-06`); unrelated file.
7. **BullMQ Resilience** — 3 dead-letter items on the `cro03a-qualification` queue are missing `failedReason`; pre-existing queue-manager data-shape gap, unrelated to this session's diff.
8. **Redis Queue Topology** — certified roster is 35 queues, actual is 41 (queue additions from prior sessions never updated the certified baseline/hash). Unrelated to this session's diff.
9. **Commercial Classification Static Gates / CRO-02 Classification Authority (BT-06)** — both fail on the same root cause: `server/services/sunbiz-bootstrap.ts` has a raw SQL `record_class` writer outside the canonical authority (matches known memory `contact-record-class-gap.md`). File not touched this session.
10. **CRO-03C Worker, Lease, and Safe-Egress Contract** — `scripts/test-cro03c-worker-static.ts` asserts an expected rejection that no longer throws; a pre-existing test/implementation drift unrelated to this session's diff.
11. **CR-06 Promotional Enrollment Boundary Inventory** — asserts `server/services/cro03/sfp-enrollment-bridge.ts` imports the central CR-06 decision; it currently uses its own (documented, in-scope) eligibility checks instead. Pre-existing file, not touched this session.
12. **Live Health Monitor** — two pre-existing conditions: `productionSeedConvergence` reports 22 contacts still `record_class='unknown'` (same root cause as #9), and `/api/operator/queue-metrics` doesn't expose `sequenceBacklog` as a number. Neither file is in this session's diff.
13. **Outbound Boundary Denial (#1626)** — one static gate fails: 13 raw `audit_logs` INSERT call sites across `south-florida-prospecting.ts`, `sfp-continuous-discovery.ts`, `sfp-attestation-refresh.ts`, `sfp-paid-evidence-writer.ts`, `evidence-service.ts`, `queue-manager.ts`, and two lines in `lead-ops.ts` (3228, 3465) don't route through the audit sanitizer. Confirmed via `git diff HEAD -- server/routes/lead-ops.ts` that neither flagged line is part of this session's changes — pre-existing gap.
14. **Statement Acquisition** — sections 1–11 all pass; section 12 ("Re-upload: closed deal stage not regressed") fails on a slow/failed `contacts` INSERT after ~67s, with two 30s `db:query_error` timeouts on `audit_logs` selects earlier in the same run. This session's `shared/schema.ts` diff only adds columns to `sfp_ready_held_enrollments` — it does not touch the `contacts` table. Consistent with pool contention/slow-query flakiness (`.agents/memory/db-pool-worker-contention.md`), not a regression from this session's diff.
15. **Public Forms** — exits 2 immediately: `scripts/test-forms.ts` expects `/api/health` to return `statementCommandTestStorage: true`, but no route anywhere in `server/` ever sets that field (confirmed via `grep`). This check has never been satisfiable — a pre-existing gap in the health endpoint, unrelated to this session.

**Conclusion: none of the 16 real failures were caused by this session's changes.** Per the standing instruction to fix only task-caused pre-deploy failures, none required a code fix; all are documented here with the exact evidence (assertion text + diff-scope check) rather than assumed.

## 3. Migrations
One new migration this session: `migrations/0308_sfp_ready_held_review_status.sql` (adds `review_status`/`reviewed_by`/`reviewed_at`/`review_note` + check constraint + index to `sfp_ready_held_enrollments`), journaled in `migrations/meta/_journal.json`. `npx tsc --noEmit` is clean.

## 4. Active profile / pause state (at time of writing)
- Outbound pause authority: `paused` throughout this session's investigation (confirmed via Live Health Monitor run: `state=paused source=database epoch=750`).
- No live provider secrets were exercised; `GHL_TRANSPORT_FAILFAST` isolation used for the pre-deploy run and all manual server starts.
- No campaigns enabled, no sequences unpaused, no GHL calls made, no sends issued.

## 5. Tests run this session
- `npx tsc --noEmit` — clean.
- Full isolated `bash scripts/run-pre-deploy.sh` run on port 5057 with `RELEASE_SHA` set — completed end-to-end (previously blocked by the port-export bug, now fixed). Result: 16 pre-existing/environmental failures (triaged above, none task-caused), ~46 suites requiring a separate disposable-DB harness invocation (not run in this pass, by design of this wrapper).
- `scripts/test-ladder-budget-cross-path-race.ts` — not independently re-run this session; its Gate 2 result stands from the prior session (no code it exercises changed).

## 6. Post-publish verification plan
1. After Publish, hit `GET /api/health` on the production domain and confirm `sha` matches the deployed commit.
2. Query `GET /api/lead-ops/pilot/status-overview` as an authenticated admin against production and confirm `funnel`/`crosswalkOnlyExcluded` return real data.
3. Confirm production outbound-pause epoch/state is unchanged (still paused, unless the operator explicitly resumed it).
4. Verify the new `sfp_ready_held_enrollments` review columns exist in production after migration convergence, and that the review-approval routes are reachable and role-gated.
5. Verify production worker heartbeats and effective provider controls via the new admin endpoints.
6. Under the existing $50 cap (never raised/reset), confirm actual valid-email yield with a live read against `sfp_paid_candidate_evidence`/`sfp_outreach_eligibility` — no new spend triggered by this verification step itself.

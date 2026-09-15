# CRO-03C → Master Lead Pipeline: Post-Publish Activation Runbook

This runbook covers turning on **real** provider I/O, worker capacity, and
downstream sync/outreach for the CRO-03C → `master_leads` reconnect pipeline
once its code is published. Nothing in this document has been executed —
Step 10's certification (`scripts/test-cro03c-master-lead-e2e-certification.ts`)
proved the receipt-to-`master_leads` chain end-to-end using fake transports
only, against a disposable database. No production DDL, bootstrap, relink,
real provider call, spend, worker activation, GHL mutation, or outreach was
performed as part of that work. The Task #1971 continuation's corrective
items (free-enrichment lane isolation, MI-09 preflight fixes, fail-closed
paid-completion evidence, frozen pricing authority, per-provider admin
control parity, production provider-control convergence, the pre-I/O
emergency stop, split pilot/recurrence authorization scopes, and mixed-lineage
DBPR telemetry) are also code-only as of this writing — see the "Corrective
hardening (Task #1971 continuation)" section below for what each changed and
what it means operationally before and during activation.

## Pre-flight checklist (verify before any step below)

- [ ] `scripts/test-cro03c-master-lead-e2e-certification.ts` passes in CI on
      the commit being published (22 assertions, 0 failures).
- [ ] `npx tsc --noEmit -p .` is clean except the pre-existing unrelated
      `server/services/health-monitor.ts` `channelOrchestrator` errors.
- [ ] Publish has been run and production schema matches `schema.ts`
      (see the `database` skill / `production-schema-ownership` memory —
      Publish owns prod DDL, the app must not replay Drizzle migrations
      against it).
- [ ] Production `provider_controls` rows exist for all five paid providers
      (`serper`, `outscraper`, `openai`, `apollo`, `zerobounce`) with the
      capabilities recorded in migration 0269. Confirm each row's
      `enabled`/`circuit_state` reflects the intended pre-activation state
      (should be `enabled=false` until the corresponding step below). Apollo
      now has the same admin GET/PUT parity as the other four
      (`/api/admin/provider-controls/apollo`) — see the corrective-hardening
      section.
- [ ] If any CRO-08A recurring schedule will carry a paid-provider budget key
      (`serper`/`outscraper`/`openai`/`apollo`/`zerobounce`), an admin must
      first call `POST /api/lead-ops/recurrence/authorize-paid-budget` with
      the exact typed confirmation `AUTHORIZE RECURRING PAID ENRICHMENT` —
      this is separate from, and not satisfied by, the pilot's own
      `AUTHORIZE $50 PAID PILOT` confirmation or by pilot-ladder completion.
      `activateCro08aScheduleDefinition()` will reject activation otherwise.

## Step 1 — Enable ZeroBounce spend for business validation

1. Confirm `ZEROBOUNCE_API_KEY` (or `ZEROBOUNCE_APi_KEY`) is set as a real
   production secret (see environment-secrets skill — do not paste the value
   anywhere).
2. Set `CRO03_PROVIDER_TRANSPORT_ENABLED=true` in production if not already
   set — this is the top-level kill switch checked before any ZeroBounce
   call in `business-validation-service.ts`.
3. Flip `provider_controls.zerobounce.enabled = TRUE` (and confirm
   `circuit_state = 'closed'`) via the existing admin path — do **not**
   hand-edit the row outside the app's control-plane if one exists; check
   `server/services/cro03/provider-manifest.ts` / the admin UI for provider
   controls first.
4. Confirm `cro03c_activation_policies` has a current row with
   `businessValidationMaxUnits` / `businessValidationMaxAmountMicros` caps
   set to intended production limits — these are enforced per-command by
   `authorizeCro03cBusinessValidation` and there is no fallback to a shared
   cap (deliberately, to avoid contact+business paths doubling the declared
   budget).
5. Watch the first live batch closely: confirm `cro03c_receipts`,
   `cro03c_dispatch_checkpoints` (`pre_io → dispatching → transport_started →
   dispatched → transport_returned → reconciled`), and `businesses.email_discovery_status`
   transition as expected, and that `master_lead_staging_intents` rows are
   only created for `provider_valid` results.

## Step 2 — Activate worker capacity

1. Confirm the BullMQ worker profile running in production includes the
   queues this pipeline depends on (`enrichment`, `post-enrichment`,
   `cro03a-qualification`, plus whichever queue backs `master-lead-stager.worker.ts`
   consumption of `master_lead_staging_intents`). The dev workflow currently
   runs a `selective` background profile — confirm production's profile is
   not similarly restricted before expecting staging intents to drain.
2. Confirm `QueueManager` initializes successfully at startup in production
   (see `queue-manager-init-failure.md` memory — a partially-initialized
   manager must not be cached; if staging intents pile up with no worker
   activity, check for a swallowed init error first).

## Step 3 — Free-enrichment / paid-provider recurrence (CRO-08A)

1. Confirm `cro08a_candidate_enrichment_schedule` and
   `cro08a_candidate_freshness_refresh_schedule` seed rows are present
   (startup logs already confirm `ProductionSeedConvergence` reports these
   as `already_present` — re-check after publish in case the target set
   changed).
2. If enabling additional paid sources (Outscraper, Apollo, ProxyCurl,
   Apify) alongside ZeroBounce, repeat Step 1's manifest/`provider_controls`
   activation per source — each paid source requires its own explicit
   `provider_controls` row and secret; there is no bulk "enable all paid"
   switch by design (`cro03c-provider-hardening-parity.md`).

## Step 4 — GHL sync authority

1. `master_leads` rows created by this pipeline start at
   `status='staged'`, `pipeline_origin='cro03_pipeline'`. Promotion to a
   canonical `contacts` row (via `checkPromotionPreconditions` /
   `server/services/master-leads/pipeline-promotion.ts`) is a **separate**,
   explicit action — it is not automatic on staging.
2. Confirm no open `canonical_conflict_evidence` row exists for the
   business before promoting (the shared promotion authority blocks on
   this regardless of validation state — confirmed by this cert's negative
   assertion).
3. Promoted contacts are created `local_only` / `consent_tier='cold_no_consent'`
   with **no** GHL sync, sequence enrollment, deal, or outbound effect as a
   side effect of promotion — GHL sync activation for these contacts (if
   desired) is a distinct, later decision outside this pipeline's scope.

## Step 5 — Outreach activation

Do **not** enable outreach (sequence enrollment, campaign sends) for
`cro03_pipeline`-origin contacts as part of this rollout. Promotion
deliberately leaves them `cold_no_consent` / local-only. Enrolling them into
outreach is a separate product decision requiring its own consent/compliance
review (see `pewc-consent-pattern.md`, `sender-policy-architecture.md`
memory) — not covered by this runbook.

## Step 6 — Sunbiz bootstrap + historical relink (production)

This is the highest-blast-radius step and should be scheduled separately
from the above, with its own dry run:

1. Confirm `sunbiz_bootstrap_claim_idempotency` behavior (filing_number claim
   row precedes org resolution — see `sunbiz-bootstrap-claim-idempotency.md`
   memory) is understood by whoever runs this.
2. Run against a small, bounded slice first (e.g. a single county or date
   range) and verify `canonical_source_links` / `businesses` counts move as
   expected before running the full historical relink.
3. Historical relink is a large-table operation — expect it to interact
   with `executeSql` DDL timeouts / migration lock contention concerns
   (`executesql-ddl-timeout.md`) if it needs any accompanying index work;
   plan index changes as separate, `CREATE INDEX CONCURRENTLY`-free
   migrations run outside a transaction per `concurrent-index-migration-fix.md`.
4. This step has **not** been rehearsed as part of Step 10's certification
   (which used a disposable DB and fake transports only) and should get its
   own sign-off before running in production.

## Corrective hardening (Task #1971 continuation)

The following changes landed after the certification in Step 10 and before
any activation step above has ever been run for real. They do not change
what this runbook tells you to do — they close gaps in the guardrails that
were already supposed to be in place.

- **Per-provider admin control parity (Apollo).** Serper has its own
  dedicated control surface (`/api/admin/serper/*`, `serper_control` table).
  Outscraper, OpenAI, and ZeroBounce were already reachable individually via
  `GET`/`PUT /api/admin/provider-controls/:provider`. Apollo was not — the
  only way to affect it was the blanket "disable all five paid providers"
  emergency stop. Apollo now has the same individual GET/PUT parity, same
  `requireRole('admin')` guard, same audit logging. If you need to enable or
  disable Apollo specifically (rather than all five at once), you can now do
  so without touching the other four.
- **Pre-network-I/O emergency stop.** Reserving a unit of paid-provider work
  (`reserveCro03ProviderOperation`) only checked `provider_controls`
  (enabled/circuit_state) once, at reservation time. The actual last
  checkpoint before every real fetch (`assertCro03cAuthorityBeforeIo`, used
  by every paid-provider call site) never re-checked it. Practically: if an
  operator hit emergency stop after a unit was reserved but before the
  queued work actually dispatched, the stale reservation could still have
  fired the real network call. That gap is closed — the same fail-closed
  gate is now re-checked immediately before every real transport call,
  regardless of how long ago the reservation was made. This does not change
  any step above; it means emergency stop is now trustworthy at the moment
  you press it, not just at the moment work was queued.
- **Split pilot vs recurrence authorization.** `activateCro08aScheduleDefinition()`
  (Step 3 above) was gated only by pilot-ladder completion — a one-time
  historical fact — plus each schedule's own per-occurrence unit budget.
  Once activated, recurring paid spend had no dollar ceiling and no distinct
  operator sign-off of its own; it silently rode on the pilot's now-historical
  ladder completion. Recurring schedules now require their own explicit,
  separately typed authorization (`AUTHORIZE RECURRING PAID ENRICHMENT`, via
  `POST /api/lead-ops/recurrence/authorize-paid-budget`) before any schedule
  naming a paid provider in its budgets can activate, and their own
  independently-tracked $50 aggregate cap
  (`GET /api/lead-ops/recurrence/budget-summary`), re-checked immediately
  before every recurring command is created. Hitting the existing "emergency
  stop all paid providers" button now also revokes this recurring
  authorization, so a future re-activation always requires an explicit
  re-confirmation rather than silently resuming. **This means Step 3 above
  now has an additional precondition** — see the pre-flight checklist.
- **Production provider-control convergence.** The five paid-provider
  `provider_controls` rows are now converged via a parameterized, idempotent
  seed-convergence target consistent with how other MI-09/CRO-08A schedule
  rows reach production (see `production-seed-convergence.md` /
  `mi09-cro08a-schedule-convergence.md` memory) rather than relying solely on
  manual row creation.

## Rollback

Every activation above is independently reversible:
- ZeroBounce spend: flip `provider_controls.zerobounce.enabled = FALSE`.
- Worker capacity: revert the BullMQ profile.
- Promotion: no automated bulk-undo exists; handle case-by-case.
- Sunbiz bootstrap/relink: has no bulk rollback — this is the reason for
  running it last, and separately, with its own review.

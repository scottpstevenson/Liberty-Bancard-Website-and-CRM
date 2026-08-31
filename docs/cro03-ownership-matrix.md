# CRO-03 enrichment ownership matrix

This matrix is the acceptance inventory for the durable enrichment factory. A
provider credential or application role never authorizes spend by itself.

| Surface | Subject | Disposition | Durable owner |
|---|---|---|---|
| `POST /api/cro03/batches` | canonical contacts | 202 durable command | QueueManager CRO-03 tick |
| `POST /api/contacts/enrich-batch` | canonical contacts | 202 durable command | QueueManager CRO-03 tick |
| `POST /api/contacts/:id/enrich` | canonical contact | 202 durable command; no offer routing | QueueManager CRO-03 tick |
| Apollo/Outscraper CSV imports | canonical contacts created by intake | evidence-only, no spend | import execution + CRO-03 import evidence |
| legacy prospect enrichment | staging prospect | stable 503 | none until canonical intake |
| Sunbiz single/batch/mass/deep enrichment | staging entity | stable 503 | none until canonical intake |
| Lead Ops bulk enrichment | staging entity | stable 503 | none until canonical intake |
| SDR re-enrichment route/interval | staging merchant | stable 503 / disabled | none until canonical intake |
| SLA worker enrichment sweep | mixed legacy | retired | none |
| QueueManager enrichment repeatable job | canonical CRO-03 items | canonical owner | QueueManager |
| Serper | search-gap evidence | existing SerperGateway budget/circuit authority | SerperGateway |
| ZeroBounce | final winning email only | existing validation-intent/readiness authority | provider readiness worker |
| Apollo | selected organization/person evidence | CRO-03 provider operation/control | CRO-03 worker adapter |
| Outscraper | selected business discovery evidence | CRO-03 provider operation/control | CRO-03 worker adapter |
| public web | free evidence | SafeEgress only | registered factory adapter |
| post-enrichment automation / offers / outreach / GHL | downstream effect | prohibited in CRO-03 | later authority |

Canary definitions are descriptive and non-executable. Apollo and Outscraper
ship with controls disabled and a zero local budget. Enabling them, changing
budgets, creating production batches, or running a production backfill is not
part of CRO-03.

## HTTP authorization certification (Task #1718)

The CRO-03 HTTP boundary is certified independently of worker and provider
execution. `scripts/test-cro03-http-authorization.ts` uses direct HTTP
requests against a server configured with an approved disposable test database;
its fixtures are local batch rows only and it never invokes a worker or provider.

| Route | Anonymous / agent | Owner Manager A | Non-owner Manager B | Admin |
|---|---|---|---|---|
| `POST /api/cro03/batches` | 401 / 403 | allowed | allowed | allowed |
| `GET /api/cro03/batches/:id` | 401 / 403 | 200 for own batch | exact minimal 404 | 200 for any batch |
| `POST /api/cro03/batches/:id/cancel` | 401 / 403 | allowed for own batch | exact minimal 404 | allowed for any batch |
| `GET /api/cro03/reconciliation` | 401 / 403 | 403 | 403 | 200 |
| `GET /api/cro03/policy` | 401 / 403 | 403 | 403 | 200 |

Malformed batch UUIDs return the same minimal 404 (`{"code":"not_found",
"message":"Not found"}`) to authorized admin/manager callers. A foreign batch
uses exactly that response too, so batch existence and owner identity are not
disclosed.

`scripts/scan-cro03-client-endpoints.ts` is a separate fail-closed static
client audit. It rejects retired request-detached enrichment endpoint usage and
requires retirement/disabled vocabulary where such a surface is presented; it
does not treat a legacy "enriched" success claim as truthful CRO-03 status.

## CRO-08A schedule ownership (Task #1735, Correction 3)

CRO-08A's versioned schedule-definition authority
(`cro08a_schedule_definitions`, migration `0213`) owns **exactly** the
discovery, enrichment, freshness-refresh, and approved-backfill logical keys
(`candidate_discovery`, `candidate_enrichment`, `candidate_freshness_refresh`,
`candidate_backfill` — enforced by a DB CHECK). Every other recurring job in
this codebase is explicitly out of CRO-08A's scope and must never be migrated,
fenced, or claimed by it. The full exclusion census
(`CRO08A_EXCLUDED_SCHEDULE_KEYS` in `server/services/cro08a/schedule-authority.ts`)
covers:

**BullMQ-managed (`server/services/queue-manager.ts` `QUEUE_CONFIGS` /
`NAMED_QUEUE_SCHEDULES`):** GHL sync, SLA checks, sequence enrollment worker,
weekly/partner-monthly digests, MID ingestion, onboarding reminder, activation
monitor, merchant success, win-back outreach, abandoned statement, executive
snapshot, system audit, DB backup, enrollment recovery, GHL enrollment
recovery, health monitor, pipeline silence check, proposal follow-up,
voicemail sync, and the CRO-03C live recovery / post-enrichment intent
recovery / ZeroBounce auto-run named schedules.

**Non-BullMQ interval/loop schedulers (elsewhere in `server/services/`):**
legacy GHL `startAutoSyncLoop` (`ghl-sync.ts`, dormant unless separately
claimed), the SLA/MID-ingestion worker loop (`sla-worker.ts`), daily-outreach
loops (`daily-outreach.ts`), the SDR orchestrator sweep
(`sdr/orchestrator.ts`), SDR funnel-metrics aggregation
(`sdr/funnel-metrics.ts`), the SDR lead-finder nightly loop
(`sdr/lead-finder.ts`), the weekly-digest loop (`weekly-digest.ts`),
content-scheduler ticks (`content-scheduler.ts`), and the deal-boarding /
merchant-application outbox pollers and wizard-flag-overrides refresh
interval.

There is no CRO-07 feedback/delivery recurring schedule and no CR-06
campaign-prep recurring schedule registered anywhere today (both are
event/workflow-driven, not cron-driven); this is recorded as a forward-looking
guard so a future cron-style CRO-07/CR-06 schedule is not mistakenly folded
into CRO-08A's authority either.

`scripts/test-cro08a-continuous-factory.ts` asserts the exclusion list and the
owned-key CHECK never intersect, and that a schedule definition outside the
four owned logical keys is rejected at creation time.

### Production activation gate (Correction 4)

CRO-08A ships **CODE COMPLETE / SCHEDULES PAUSED**. A schedule definition's
active pointer can only flip to `enabled` when a durable, current-release
`cro08a_certification_receipts` row exists (exact release SHA + migration
head, provider set, price-schedule hash, approval receipt IDs, fleet/runtime
attestation ID, outbound-pause epoch — see
`server/services/cro08a/certification-gate.ts`). No such receipt is issued by
any live ceremony yet; issuing one from the CRO-03D ceremony tooling
(`scripts/cro03d-ceremony.ts`) and running the live activation ceremony itself
(task #1739, still PROPOSED) are explicit follow-up work, not part of this
task.

### Provider budget rollover (Correction 5)

`provider_controls.consumed_units` never resets on its own — merged CRO-03C
infrastructure only supports a single cumulative cap for the life of a row,
which does not work for an indefinitely-recurring schedule. CRO-08A adds an
archive-then-reset period-rollover step
(`server/services/cro08a/provider-budget-rollover.ts`): the elapsed window's
spend is archived into the immutable `provider_budget_period_ledger` table
before `provider_controls` is reset and its window advanced under the same
optimistic-concurrency (`version` column) discipline already used for
reservation. No production caller invokes this yet — it is exercised only by
the CRO-08A test suite until a schedule is certified and activated.

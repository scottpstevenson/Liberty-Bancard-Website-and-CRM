# LIBERTY BANCARD CR-04 THROUGH CR-06 MASTER INDEX

**Audit date:** 2026-08-28  
**Inspected live-main planning SHA:** `bd36d65dfa635b0efd20e8c3f702754bdf66f71e`  
**Migration head inspected:** `0177_cro03_source_staging_evidence`  
**CI manifest inspected:** 82 suites  
**Repository state inspected:** clean detached worktree

## 1. Purpose

This index controls the next three consolidated CRM/outreach build tasks. Each linked prompt is a standalone mandatory preflight + build + isolated verification instruction in the Liberty format.

The prompts are grounded in the post-#1718 live repository and the project audits, master game plan, premium campaign playbook, runtime evidence, and prior task decisions. Historical database counts are not treated as current proof.

## 2. Numbering clarification

| Current task | Consolidated owner | Older roadmap equivalent |
|---|---|---|
| CR-04 | Channel-Qualified Cohort & Ready Authority | readiness/cohort work previously separated from operator CR-04 |
| CR-05 | CRM Operator Journey & Reconciled Reporting | older CR-04 |
| CR-06 | Premium Campaigns, Sequences & Sender/Provider Readiness | older CR-05 |
| CR-07 | Controlled pilot preparation/execution | older CR-06; intentionally not included here |

## 3. Required execution order

1. **CR-04** — build the channel-specific qualification/cohort authority.
2. **CR-05** — align operator work and reporting to the canonical objects and CR-04 decisions.
3. **CR-06** — govern campaign/sequence/content/sender readiness against CR-04/CR-05 contracts.
4. **CR-07 later** — separately authorized controlled pilot; no activation is authorized by these prompts.

Do not run CR-05 before CR-04 or CR-06 before CR-04/CR-05 unless the live preflight proves equivalent merged contracts.

## 4. Planning baseline

The inspected baseline contains:

- CRO-00 prerequisite safety controls;
- CRO-01 canonical revenue objects/read authority;
- CRO-02 classification, provenance, identity/resolution, quarantine, and commercial observations;
- CRO-03/#1718 durable source/provider/evidence/economics/projection controls;
- #1713 paused-by-default statement certification alignment;
- #1714 truthful backlog outage certification;
- 82 classified CI suites;
- disposable PostgreSQL 16 and Redis 7 services in CI;
- all live provider transport/campaign/outreach activation still denied.

Every task must recapture current `main`; this SHA is planning evidence, not an instruction to reset or implement on stale code.

## 5. Live findings that control the sequence

### CR-04

- Ready still means phone **or** acceptable email.
- Outreach Queue start directly creates sequence enrollment instead of using the shared eligibility/orchestration owner.
- campaign frozen membership is durable but not a reusable channel/ICP/offer qualification decision.
- send-time removal-only rechecks are already valuable and must remain.

### CR-05

- Pipeline server counts are canonical, but the board still fetches up to 2,000 rows and derives some aggregates from the loaded array.
- support analytics is capped at 500 rows; task analytics/list routes use broad populations.
- operations reporting uses legacy lifecycle/global populations.
- task and statement-review indirect-object authorization is incomplete.
- Inbox partial-source truth and Portfolio activated-MID truth already exist and must be preserved.

### CR-06

- campaign/sequence lifecycle does not distinguish templates/tests/review-ready/invalid history.
- paused/draft sequences can be hard-deleted without a complete no-history proof.
- rendering is duplicated and merge-field behavior differs.
- sender readiness is distributed across static policy, DB profiles, sending identities, probes, attestations, and UI.
- HTTP activation, enrollment, queue, and provider test-send are correctly denied and must stay denied.

## 6. Cross-task ownership fence

| Concern | Owner |
|---|---|
| Classification, provenance, identity, quarantine | CRO-02 |
| Source/provider evidence, candidates, receipts, economics, canonical projection | CRO-03 |
| Channel decision, cohort, promotional enrollment fence | CR-04 |
| Revenue/operator/task/reporting truth | CR-05 |
| Campaign/sequence/content/sender readiness | CR-06 |
| Live cohort approval, unpause, activation, canary/send | CR-07/external operations |

No task may create a competing owner.

## 7. External operations boundary

All three builds prohibit:

- production data cleanup/backfill/classification;
- paid-provider/live API calls;
- live ZeroBounce, SMTP, SMS, voice, Gmail, GHL, Apollo, Outscraper, or Serper transport;
- campaign/sequence activation or pause release;
- production cohort freeze, enrollment, export, assignment, or outreach;
- deployment or merge without explicit authorization.

## 8. Test infrastructure decision

These tasks require disposable PostgreSQL and isolated Redis for concurrency/recovery proof. The current repository CI already provisions PostgreSQL 16 and Redis 7. A Replit workspace lacking `TEST_DATABASE_URL` is not a reason to mark task-owned integration gates “not run” and still claim COMPLETE. Use the repository CI environment or configure a disposable local equivalent; never substitute production.

## 9. Content-source correction

The attached premium playbook v1.0 is the controlling CR-06 draft and specifies four touches on Days 1, 4, 8, and 14. An older consolidated roadmap said “five-touch.” CR-06 must implement the four-touch playbook draft; any fifth touch requires a separately versioned and explicitly approved revision. No production winner or cohort is selected in CR-06.

## 10. Task documents

1. `REPLIT_MASTER_PROMPT_CR04_CHANNEL_QUALIFIED_COHORT_READY_AUTHORITY.md`
2. `REPLIT_MASTER_PROMPT_CR05_OPERATOR_JOURNEY_RECONCILED_REPORTING.md`
3. `REPLIT_MASTER_PROMPT_CR06_PREMIUM_CAMPAIGNS_SEQUENCES_SENDER_READINESS.md`

Each includes baseline recapture, VFC, mandatory searches, root cause, authority contracts, schema/API/UI/auth/concurrency/external boundaries, P0/P1/P2 register, verdict, build plan, Done, kill lines, implementation rules, tests, smoke plan, gates, post-build searches, diff review, final VFC, and response format.

## 11. Handoff rule

Send one prompt per Replit task in order. Do not paste all three into one build task. Require the prior task’s final VFC and merge/equivalence evidence at the next task’s preflight. Do not fold task-owned failures into follow-ups or merge a “complete” task with required disposable gates unrun.


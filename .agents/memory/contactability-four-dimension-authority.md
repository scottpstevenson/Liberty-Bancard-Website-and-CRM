---
name: Contactability four-dimension decision authority
description: server/services/contactability.ts evaluateContactDecisions() pattern — one authority for data-hygiene/enrichment/promotion/send eligibility, and its consumers.
---

## What it is
`evaluateContactDecisions()` in `server/services/contactability.ts` is the single authority for whether a contact (or, pre-contact-creation, a business) may proceed through each of four independent lifecycle dimensions:
- **dataHygiene** — is the record clean enough to touch at all (DBPR-family exclusion, do-not-contact, etc.)
- **enrichment** — may we spend provider credits enriching it
- **promotion** — may it be promoted into an active pipeline/sequence
- **send** — may an actual message go out on a given channel (delegates to the pre-existing `evaluateContactability()` — outbound-pause enforcement stays at the transport boundary, not duplicated here)

Each dimension returns a `DimensionDecision` (status + reason codes), not a single boolean, so callers can distinguish *why* something is blocked.

For callers that need an eligibility check **before** a contact record exists (e.g. deciding whether to enrich/promote a `businesses` row), use the business-level-only `evaluateBusinessEnrichmentEligibility()` / `evaluateBusinessPromotionEligibility()` exports instead — they skip the contact-specific checks that don't yet apply.

## Why
Before this, DBPR exclusion, existing-customer exclusion, and do-not-contact checks were being re-implemented ad hoc at each call site with drifting logic. A single evaluator makes the four dimensions independently auditable and keeps new call sites from re-deriving the rules.

## Known consumers (as of introduction)
`master-leads/pipeline-promotion.ts`, `mi09-pilot-authority.ts`, `campaign-engine.ts`, `bulk-enrollment-job.ts`, `ghl-workflow-enrollment.ts`, `cr04-cohort-ready-authority.ts`. Deliberately NOT wired into `ghl-crm-sync-guard.ts` — that gate is inbound-direction (GHL → app), not a contactability decision.

A census script (`scripts/scan-contactability-authority-bypass.ts`) checks each known consumer still calls the authority and flags any *new* direct DBPR-predicate caller outside an explicit allowlist (which covers pre-existing direct callers from before this authority existed, e.g. `queue-manager.ts`, `provider-readiness-control.ts`, `cro08a-scheduler.worker.ts`, `cro08a/source-scope.ts`). Re-run it after adding any new consumer of contact/business eligibility.

## Gotcha
Drizzle's `ANY(${arr}::int[])` mis-binds with the node-postgres driver here (see `drizzle-array-param-bug.md`) — build `ARRAY[...]::int[]` by hand via `sql.join` in any test/script that filters by an ID array against this schema.

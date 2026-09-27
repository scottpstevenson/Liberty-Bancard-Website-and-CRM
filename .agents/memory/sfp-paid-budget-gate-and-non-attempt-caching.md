---
name: SFP paid-budget authorization gate & non-attempt evidence caching
description: Why OpenAI/Serper/etc. escalation calls in the SFP classification bridge can silently never fire, and why fixing the gate alone isn't enough once evidence rows exist.
---

## The gate
`assertPaidBudgetAuthorized()` (server/services/mi09-pilot-authority.ts) requires a
`system_settings` row keyed `mi09_pilot_paid_budget_authorization`, written only by
`POST /api/lead-ops/pilot/authorize-paid-budget` after an admin submits the exact typed
string `AUTHORIZE $50 PAID PILOT`. This sits in front of every paid-provider reservation
in `sfp-provider-operations.ts` (`reservePreCohortSfpProviderOperation` /
`reserveSfpProviderOperation`), independent of `provider_controls.enabled`/`circuit_state`
and independent of the provider-manifest `approvedCallers` check. All three gates must be
green (transport enabled, credential present, budget authorized) or the call never reaches
the provider — it fails at reservation time with a distinguishable `..._NOT_CONFIGURED`
reason code, not a real provider error.

**Why:** deliberate one-time human consent boundary for real money spend, separate from
the routine "no need to stop for sign-off" latitude — do not submit the typed confirmation
without asking the user first.

## The caching trap this exposed
Before the fix, `sfp-classification-bridge.ts` inserted evidence with
`terminal_state='completed'` even when the OpenAI escalation was never attempted
(reservation-time failure, reason codes `OPENAI_UNAVAILABLE` /
`OPENAI_ESCALATION_NOT_CONFIGURED`). The classification loop's own cache lookup
(`WHERE evidence_hash=... AND terminal_state='completed'`) then replays that non-attempt
forever — even after fixing the gate above — because the SQL match succeeds before any new
provider call is attempted.

**How to apply:** a review_required outcome caused by `OPENAI_UNAVAILABLE` or
`OPENAI_ESCALATION_NOT_CONFIGURED` must be written with `terminal_state='provisional'`
(not `'completed'`), so a later run with the same evidence_hash retries the escalation.

`sfp_classification_evidence` also has a DB trigger (`sfp_reject_evidence_mutation`,
migration 0288) that rejects ANY UPDATE/DELETE — it is insert-only by design. An admin
repair route that tries to `UPDATE ... SET terminal_state='provisional'` on existing bad
rows will always 500 in production with a generic "Failed query" message (the jsonb
operator, `?` vs `@>`, is a red herring — the trigger fires regardless of operator choice).
Check `pg_trigger` for a table before writing any repair route that mutates existing rows.
The correct fix for already-cached non-attempts is to exclude the bad shape from the
*cache lookup* query itself (`AND NOT (reason_codes @> '["OPENAI_UNAVAILABLE"]'::jsonb OR
...)`), never to try to mutate the historical rows — a later run then simply misses the
cache and inserts a fresh, correctly-terminal-stated row.

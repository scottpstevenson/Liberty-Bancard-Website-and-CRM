---
name: SFP paid-budget gate, non-attempt caching & shared-validator schema mismatch
description: sfp_classification_evidence is insert-only; non-attempt cache exclusion pattern; a shared OpenAI helper that hardcodes one caller's output validator silently breaks every other caller's schema.
---

# SFP paid-budget gate, non-attempt caching & OpenAI schema/validator binding

## sfp_classification_evidence is insert-only
A DB trigger rejects all UPDATE/DELETE on `sfp_classification_evidence`. A bad
cached row (e.g. one recorded when the OpenAI escalation was never actually
attempted) can never be repaired in place. The fix is always at the
cache-lookup query: exclude rows whose `reason_codes` show a non-attempt
(`OPENAI_UNAVAILABLE`, `OPENAI_ESCALATION_NOT_CONFIGURED`) from being treated
as a valid `terminal_state='completed'` hit, and record such rows as
`terminal_state='provisional'` going forward so a later run retries for real.

## Reservation-time gates vs. a shared transport bug
`OPENAI_ESCALATION_NOT_CONFIGURED` is thrown when `reservePreCohortSfpProviderOperation`
fails at reservation time (transport disabled via `CRO03_PROVIDER_TRANSPORT_ENABLED`,
missing credential, paid-budget authorization not granted, or provider_controls
budget/circuit gate). All of these are visible read-only in production:
`system_settings` key `mi09_pilot_paid_budget_authorization`, `provider_controls`
row keyed by the CONTROL_KEY mapping (e.g. `openai_classification` -> `openai`,
not the paid-provider's own name), and the `CRO03_PROVIDER_TRANSPORT_ENABLED` /
credential secret.

**But** the same reason code also fires when the OpenAI call itself never
"succeeds" for an unrelated reason and the caller (`sfp-classification-bridge.ts`)
folds that into the same non-attempt basket. Root cause found once: all four
real gates were green, yet every classification came back `invalid_output`.
The shared transport `performOpenAiClassification()` in `live-provider-executors.ts`
originally hardcoded server-side re-validation of the model's JSON output to
its own CRO03C shape (`{category, confidence, summary}`) regardless of which
`schema` was actually requested from the model via `response_format`. A
different caller (SFP's `{outcome, confidence, reasonCodes}`) got a
perfectly-shaped, correct completion back from OpenAI, but it was validated
against the wrong shape and always rejected as `invalid_output` -- silently
masquerading as either "OpenAI produced bad output" or, one layer up, as a
non-attempt/not-configured gate failure. **Fix: any shared OpenAI transport
helper that accepts a custom `schema` must also accept and use a matching
custom `validate` function from the same caller** -- never assume one
hardcoded validator is safe for every schema passed through it. When
diagnosing a "gate says not configured" mystery, reproduce the raw OpenAI
call standalone (real API key, real model, real schema) before assuming the
budget/transport/credential layer is at fault -- an `invalid_output` from a
shared transport can come from a validator mismatch instead of the gates.

## Failed provider_operations rows block retries forever by design
`provider_operations` (unlike the evidence table) has no immutability trigger,
but its idempotency key is deterministic (business + prompt hash), and a
`state='failed'` row for that exact key permanently blocks any future
reservation attempt with `SFP_PAID_BLOCKED:OPERATION_FAILED` -- there is no
automatic retry/reset. If a class of failures turns out to be a real code bug
(not a legitimate terminal failure), fixing the code alone is not enough;
existing `failed` rows for the affected idempotency keys still block retries
and need an explicit, deliberate remediation decision (not a blanket
mutation) once the underlying bug is confirmed fixed.

Remediating those rows must be an UPDATE (e.g. append a suffix to
`idempotency_key` to stop it colliding with a fresh attempt), not a DELETE:
several tables reference `provider_operations.id` with `onDelete: "restrict"`,
so deleting a row with any child reference fails outright. Also remember the
old `failed` row still matches later diagnostic queries filtered only on
`state`/`target_fingerprint` (its target_fingerprint doesn't change) — that's
expected noise from the stale row, not proof a fresh retry also failed;
confirm success from the actual run's own response (e.g. non-zero settled
cost) rather than by re-querying the old row.

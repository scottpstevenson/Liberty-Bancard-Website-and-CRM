---
name: CRO03C provider hardening parity (Serper vs Outscraper vs OpenAI vs ZeroBounce)
description: Two separate provider-execution pipelines exist; hardening comparisons must specify which one, and the durable per-provider control fix belongs at the shared reservation choke point.
---

## Two pipelines, not one
- **Legacy/MI-05 pipeline** (`enrichment-factory.ts` + `provider-context.ts`): generic `provider_controls` table (enabled/circuit_state/budget) via `reserveCro03ProviderOperation()`, typed for `"apollo" | "outscraper"` only.
- **CRO03C canary/continuous pipeline** (`live-worker.ts` + `live-execution.ts`): its own `reserveCro03cProviderOperation()`, keyed on command-level caps/price schedules, with per-generation stop conditions (`maxConsecutiveFailures`/`maxMalformed`/`maxConflicts` in `CRO03C_PROVIDER_CONTRACTS`). This pipeline did **not** consult `provider_controls` for any provider except zerobounce (checked inline in `live-execution.ts`'s authority-lock SQL and in `business-validation-service.ts`).
- Comparing "does provider X have protection Y" without naming the pipeline produces false parity/false gap conclusions — Outscraper's `isOutscraperExplicitlyApproved()` checks `provider_controls`, but only from the legacy `lead-finder.ts` path; the CRO03C canary executor (`executeCro03cOutscraper`) explicitly bypasses it by design comment.

## The confirmed, closed gap
Outscraper and OpenAI had no durable, admin-toggleable per-provider circuit breaker/emergency stop inside the CRO03C canary pipeline — only the blanket `CRO03_PROVIDER_TRANSPORT_ENABLED` flag, which cannot pause one provider without pausing all. Budget (command-level atomic caps) and idempotency (`operation_key` uniqueness) were already present uniformly for every CRO03C provider via `reserveCro03cProviderOperation`, so those were not gaps.

**Fix pattern**: reuse the *exact same* `provider_controls` table/columns zerobounce already uses (enabled + circuit_state), gated by an explicit allowlist set (`CRO03C_SHARED_CONTROL_GATED_PROVIDERS`), checked inside the shared reservation transaction — not a new per-provider table. Extracted the check into a standalone exported predicate (`assertCro03cSharedProviderControlOpen`) purely so it could be fixture-tested directly against `provider_controls` rows without needing to reconstruct the full command/run/generation/attestation authority chain, which has several non-obvious NOT NULL/append-only/check-constraint traps (see below). New gate is fail-closed: no control row = blocked, matching zerobounce's existing behavior.

## Fixture traps when building a CRO03C command/generation/attestation chain in a test script
- `cro03c_activation_policies.policy_hash` has a CHECK constraint requiring a 64-char lowercase hex string (`^[0-9a-f]{64}$`) — a placeholder string fails silently with a generic constraint error, not a clear "bad hash" message.
- `cro03c_activation_policies` has no `activated_at` column and requires a non-null `reason`.
- `cro03c_activation_policies` is **append-only** (a `cro03b_append_only_guard` trigger blocks UPDATE/DELETE) — test cleanup must never attempt to delete rows there; leave clearly-prefixed inert test rows behind instead.
- `cro03c_runtime_attestations.inventory_id` has a NOT NULL FK to `cro03c_deployment_inventories` — you cannot fabricate a full attestation without first creating (or looking up) a deployment inventory row.
- Given all these traps, prefer extracting the specific new predicate/gate under test into its own exported function and testing it directly against minimal fixture rows, rather than reconstructing the entire authority chain just to reach one check inside it.

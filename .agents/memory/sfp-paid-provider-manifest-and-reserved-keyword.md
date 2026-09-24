---
name: SFP paid-provider manifest gaps and reserved-keyword SQL gotcha
description: Two real bugs found wiring Apollo/Outscraper into a new orchestration boundary (SFP) that already had its own operations file.
---

## provider-manifest.ts approvedCallers must list every real caller in the chain
When a provider's reservation flow runs through a shared generic operations file (e.g. `sfp-provider-operations.ts`), `assertProviderActivation`'s caller check fires with that operations file as the caller, not the higher-level waterfall/adapter file that eventually invoked it. Adding a new adapter file to `approvedAdapters`/`approvedCallers` is not enough — the operations file AND the waterfall file that calls it both need entries, matching however an existing working provider (e.g. Serper) is already listed.

**Why:** Outscraper and Apollo were extended to a new SFP boundary by adding only the new adapter file to their `approvedCallers`. The reservation call from inside `sfp-provider-operations.ts` was then rejected because that file itself wasn't approved, even though the adapter that started the call chain was.

**How to apply:** When wiring a provider into an existing multi-file orchestration pattern, copy the exact set of approved-caller file paths from a provider that already works end-to-end through the same pattern (e.g. Serper's entries), not just the new adapter file. This applies per boundary: a new caller module added for a new use case (e.g. a pre-cohort/pre-orchestration bridge) needs its own explicit entry in every provider it calls, even if a sibling caller in the same directory is already approved.

## A shared per-call unit-reservation ceiling must be provider-aware, not one flat number
A single hardcoded `Math.min(N, units)` cap shared across all providers silently truncates the reservation for whichever provider's real billing unit is naturally larger than N (e.g. LLM tokens vs. per-request/per-result counts), which under-reserves and under-settles real spend against the cost ledger without erroring.

**Why:** A flat 100-unit reservation ceiling, correct for request/result-priced providers, silently capped a token-priced OpenAI classification call's real ~1200-token reservation at 100.

**How to apply:** Any reservation helper shared across multiple providers needs a per-provider ceiling table (keyed by provider id) sized to that provider's actual billing unit and worst-case single-call usage, not one constant reused for every provider.

## Raw SQL against a column named `authorization` needs quoting
`authorization` is a reserved PostgreSQL keyword. A raw `UPDATE table SET authorization = ...` (unquoted) throws a SQL syntax error — not silently, but the error message doesn't always make the reserved-keyword cause obvious at a glance.

**Why:** `sfp_stage_runs.authorization` triggered exactly this inside `reserveSfpProviderOperation`.

**How to apply:** Any raw SQL (not Drizzle's query builder) touching a column literally named `authorization` (or other reserved words) must quote it: `"authorization"`.

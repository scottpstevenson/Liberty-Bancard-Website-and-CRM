---
name: CI Migration & CSRF Authority
description: Durable lessons from the migration journal integrity gate and CSRF scanner design — patterns to follow for future changes.
---

# CI Migration & CSRF Authority — Durable Lessons

## Migration journal high-water enforcement

**Rule:** Every journal entry added after the baseline anchor (the last entry present before a task adds new migrations) must have `when` strictly above the baseline's `when` value. An entry with `when` at or below the cursor is silently skipped by Drizzle's migrator.

**Why:** Drizzle's `migrate()` processes entries in `when` order, not `idx` order. A new entry with a `when` value that falls at or below the baseline cursor will never be applied — no error, no warning.

**How to apply:**
- `check-migration-integrity.ts` enforces this via an immutable `BASELINE_LAST_IDX` / `BASELINE_LAST_TAG` anchor and `HIGH_WATER_WHEN` constant.
- When adding a new migration that should be enforced, update both the anchor and the constant.
- Out-of-order `when` values are a hard FAIL (not a warning) — any future migration must use a strictly increasing timestamp.

## CSRF scanner design — options-block scoping

**Rule:** CSRF coverage must be confirmed within the specific fetch call's options argument (or the named headers variable it references), not by scanning a broad surrounding line window.

**Why:** A broad window (e.g. ±30 lines) produces false passes: a nearby but unrelated `getCsrfToken()` call in an adjacent function satisfies the check even though the flagged fetch has no CSRF token. This makes the scanner unreliable as a binary gate.

**How to apply:**
- `extractFetchOptionsBlock()` extracts the second argument to `fetch()` by tracking string/brace depth. Mutation detection (`method: "POST"` etc.) is also scoped to this block, preventing false positives from adjacent fetch calls.
- `extractHeadersVarName()` identifies the actual variable name used in `headers: varName` (e.g. `uploadHeaders`, `rateReviewHeaders`) and `varDefHasCsrf()` confirms that named variable's definition contains CSRF — not just any variable named `headers`.
- EXEMPT_FILES is for entirely public/pre-auth/token-auth files. Per-call-site `// CSRF_EXEMPT: reason` is for individual calls in otherwise-authenticated files.

## Suite manifest registry comparison

**Rule:** The capability manifest must be verified against the actual MANDATORY_SUITES registry in `pre-deploy.ts` on every CI run. A manifest that only validates itself cannot detect coverage drift.

**Why:** If a new suite is added to `pre-deploy.ts` without a manifest entry, CI runs an unclassified suite with no documented provider denial boundary — the provider isolation contract is silently broken.

**How to apply:**
- `ci-suite-manifest.ts --check` reads `pre-deploy.ts`, extracts all `script: "..."` values from `MANDATORY_SUITES`, and fails if any script is absent from `SUITE_MANIFEST`.
- This step runs in the CI static job. Any new suite added to `pre-deploy.ts` MANDATORY_SUITES must also be classified in `SUITE_MANIFEST` with a `providerDenial` entry before CI passes.

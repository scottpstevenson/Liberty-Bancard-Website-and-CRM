---
name: Dependency-free CRO03C constants module
description: Which CRO03C module is safe to import from a DB-less tool, and which one silently requires a live database.
---

`server/services/cro03/contracts.ts` imports only `crypto` — no `server/db`, no queue connections. It already held `CRO03C_CURRENT_MIGRATION_HEAD` for this exact reason (per its own comment: so `provider-readiness-control` could verify it without importing an executor).

`server/services/cro03/live-execution.ts` imports `server/db` at module load time. `server/db` throws synchronously if `DATABASE_URL` is unset. Any tool that imports `live-execution.ts` — even just for a constant like `CRO03C_INITIAL_ROLLOUT_KEY` or `CRO03C_PROVIDER_CONTRACTS` — becomes unrunnable without a live database, even if all of its *own* logic uses injected/mocked dependencies.

**Why:** A code-review rejection on Task 1738 (CRO-03D) caught this: a "dependency-injected, DB-less" static test suite for an operator discovery tool still failed with `DATABASE_URL` unset, because the tool imported two constants from `live-execution.ts` instead of `contracts.ts`.

**How to apply:** `CRO03C_INITIAL_ROLLOUT_KEY` and `CRO03C_PROVIDER_KEYS` (the provider-id list) now live in `contracts.ts` too; `live-execution.ts` re-exports the rollout key and asserts its `CRO03C_PROVIDER_CONTRACTS` keys stay in sync with `CRO03C_PROVIDER_KEYS` (fails loudly on drift). Any new CLI/operator tool that needs a CRO03C constant but must stay runnable without a database should import from `contracts.ts`, never `live-execution.ts`. Verify with `env -u DATABASE_URL npx tsx <script>`.

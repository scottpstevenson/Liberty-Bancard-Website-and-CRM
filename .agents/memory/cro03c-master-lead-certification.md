---
name: CRO-03C master-lead E2E certification — technique and bugs found
description: How to build a fake-transport certification for the CRO03C → master_leads chain, plus four real production bugs this uncovered.
---

## Disposable-DB certification recipe

- Create a throwaway Postgres DB with `CREATE DATABASE <name> TEMPLATE
  template0`, then run `server/db-migrate.ts` against it directly (not the
  app's own startup path) to get a clean schema.
- Point the script at it via `DATABASE_URL`/`TEST_DATABASE_URL` env vars, and
  generate a fresh `TEST_REDIS_PREFIX` nonce (e.g.
  `test_<suite>_<randomHex>_:`) per run so `assertDisposableTestInfrastructure`
  (`requireRedis: true, reserveRedisNamespace: true`) reserves an isolated
  namespace instead of colliding with a prior run's keys.
- Because every run uses a fresh serial `businesses.id` and fresh per-run
  UUIDs, you generally don't need cleanup DELETEs between runs — trying to
  clean up append-only tables (guarded by `..._APPEND_ONLY` triggers) causes
  more problems (FK errors) than it solves. Only clean up genuinely
  cross-run-shared state (e.g. a specific `canonical_conflict_evidence` row
  you inserted for a negative assertion).
- Call `applyCertificationProviderDenyBoundary({ fatal: true })` early — it
  deletes real provider secrets (`ZEROBOUNCE_API_KEY` etc.) from
  `process.env` so no accidental real spend/network call is possible. Any
  code path that does a truthy-check on the key's *presence* (not its value)
  before consulting an injected fake transport will then need a dummy
  non-empty value set back into `process.env` immediately after the boundary
  call — the fake transport never reads it, but the presence check still
  fires.

## Dependency-injection pattern for exercising real code with fakes

Add an optional last-argument `Deps` object to the real production function
(e.g. `BusinessValidationWorkerDeps.validateEmail`,
`SelectEmailWinnerDeps.checkMx`), defaulting to the real implementation when
omitted. This is non-breaking for the one real call site and lets a
certification script inject a fake transport/DNS-check while still running
every other line of real production logic (authority checks, DB writes,
checkpoint state machine, etc.).

## Four real production bugs found building this certification

1. **`ANY(${arr}::uuid[])` array-param bug** in
   `server/services/cro03/candidate-selector.ts` — see
   `drizzle-array-param-bug.md`. Confirmed live, not just theoretical.
2. **`authority_hash` check-constraint violation**: a checkpoint insert used
   `md5(...)` (32 hex chars) where the column requires
   `^[0-9a-f]{64}$` (sha256). Also, Postgres's `digest()` function is not
   guaranteed available (needs the `pgcrypto` extension) — hash in JS with
   `node:crypto` instead of depending on a DB extension for this kind of
   checkpoint hash.
3. **Wrong join path** in `server/workers/master-lead-stager.worker.ts`'s
   `resolveProvenance()`: it joined through a nonexistent
   `cro03a_handoffs.source_observation_id` column to a nonexistent
   `cro03_source_observations.(source_system, source_type, stable_key)`
   triple. The correct path is direct: `cro03a_handoffs` already carries
   `(source_system, source_type, source_key)` and that triple IS
   `canonical_source_links`'s natural key (`stable_key == source_key`) — no
   join through `cro03_source_observations` is needed or valid.
4. **`require()` inside an ESM module**:
   `server/services/master-leads/pipeline-promotion.ts` had
   `const { createHash } = require("crypto")` inside a function — throws
   `ReferenceError: require is not defined` on every call in this ESM
   codebase. Fixed by importing `createHash` from `node:crypto` at the top
   of the file. This function (`checkPromotionPreconditions`) had apparently
   never been exercised end-to-end before this certification.

**Why this matters:** all four bugs were on paths with no prior test
coverage exercising them end-to-end with real DB writes — static/unit tests
and code review did not catch them. When building a new certification for a
previously-uncertified chain, expect to find real bugs, not just wiring
issues in the test script itself.

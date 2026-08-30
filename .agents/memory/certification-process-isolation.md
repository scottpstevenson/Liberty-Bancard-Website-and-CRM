---
name: Certification process isolation
description: Durable safety rules for read-only certification processes that must never inherit provider access or contact live endpoints.
---

Certification outer launchers may inspect inherited infrastructure settings only to prove disposable PostgreSQL and Redis. The migration, suite, or server application must run in a separately spawned child with an explicit replacement environment. Apply provider denial before importing application code, and validate readiness targets as credential-free loopback URLs before any fetch. Direct Node HTTP(S) checks must validate the effective URL-plus-options target and reject custom agents, lookup/connect hooks, and socket paths. Stateful wrappers must reserve UUID-qualified Redis namespaces atomically, reject collisions or stale keys, and release their own token-fenced reservation.

**Why:** In-process environment scrubbing leaves the application process initially created with real credentials. Replacing only global fetch misses direct Node HTTP(S) clients; checking only the first request argument misses option overrides; syntactic Redis prefixes can still collide across processes; and an unvalidated readiness URL can escape before the clean child starts.

**How to apply:** Keep the canonical operation in the clean child; omit provider credentials by allowlist rather than chasing names; deny and count effective global-fetch and direct HTTP(S) targets; allow only loopback fake transports without custom connection hooks; make blocked attempts immediately fatal; reserve Redis namespaces before application imports.

Deterministic-static classification applies to the complete transitive import graph, not the apparent assertions in a suite. If an imported service initializes `server/db`, reclassify the runtime assertions to disposable integration or extract a genuinely pure contract module while retaining equivalent source/owner checks in static certification. Tests that verify pre-import guards should invoke the guard with an injected environment instead of spawning nested package runners, because certification isolation settings can make nested launcher behavior environment-dependent.

**Why:** A red exact-SHA run exposed several suites described as source-only or mocked even though their service imports initialized the database. Nested `npx` checks also passed standalone but failed under the denied certification wrapper.

**How to apply:** Run deterministic-static with database variables absent or unreachable. Treat any database initialization as a classification defect, and make guard tests deterministic without child package resolution.
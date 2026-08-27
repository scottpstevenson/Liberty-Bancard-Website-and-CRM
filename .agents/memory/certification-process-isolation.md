---
name: Certification process isolation
description: Durable safety rules for read-only certification processes that must never inherit provider access or contact live endpoints.
---

Certification outer launchers may inspect inherited infrastructure settings only to prove disposable PostgreSQL and Redis. The migration, suite, or server application must run in a separately spawned child with an explicit replacement environment. Apply provider denial before importing application code, and validate readiness targets as credential-free loopback URLs before any fetch. Direct Node HTTP(S) checks must validate the effective URL-plus-options target and reject custom agents, lookup/connect hooks, and socket paths. Stateful wrappers must reserve UUID-qualified Redis namespaces atomically, reject collisions or stale keys, and release their own token-fenced reservation.

**Why:** In-process environment scrubbing leaves the application process initially created with real credentials. Replacing only global fetch misses direct Node HTTP(S) clients; checking only the first request argument misses option overrides; syntactic Redis prefixes can still collide across processes; and an unvalidated readiness URL can escape before the clean child starts.

**How to apply:** Keep the canonical operation in the clean child; omit provider credentials by allowlist rather than chasing names; deny and count effective global-fetch and direct HTTP(S) targets; allow only loopback fake transports without custom connection hooks; make blocked attempts immediately fatal; reserve Redis namespaces before application imports.
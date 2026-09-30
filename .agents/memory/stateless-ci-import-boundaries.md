---
name: Stateless CI import boundaries
description: Why pure certification suites must avoid eager database imports even when runtime calls inject fake dependencies
---

Static certification runs under an intentionally stateless, zero-egress environment. Importing a module that eagerly loads a database-backed singleton fails before an injected fake can run; providing a dummy database URL would conceal the breach. Keep pure decisions in dependency-free modules and resolve default database-backed gateways lazily only when the caller has not injected one.

**Why:** During reconciliation, multiple baseline static suites failed successively on import alone, even though their assertions were pure and did not query the database. Source-text guards also needed to follow a pure decision when it moved out of a DB-bound authority module.

**How to apply:** For new deterministic-static tests, audit the entire transitive import graph under scrubbed database credentials. When extracting a pure decision, update both its runtime re-export and structural tests to inspect the dependency-free source. Do not weaken the stateless test environment to make an eager import pass.
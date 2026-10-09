---
name: Migration and publication lessons
description: Index of migration evidence, lock, index, and production ownership lessons.
---

- [Journal ordering and integrity](migration-when-collision.md); [older journal context](drizzle-out-of-order-journal.md).
- [DDL timeout and lock contention](executesql-ddl-timeout.md).
- [Partial index rollout scopes](partial-index-new-rows-only.md); [generated predicates](generated-key-partial-index-predicates.md).
- [Orphaned migration files](drizzle-kit-orphaned-hang.md).
- [Dedicated migration timeout ownership](migration-statement-timeout.md).
- [Production schema ownership](production-schema-ownership.md).
- [Exact migration-ledger hash proof](migration-ledger-hash-proof.md).
- [Legacy CHECK-constraint fixture proof](legacy-check-constraint-migration.md).
- [NOT NULL convergence](contacts-notnull-convergence.md).
- [Publish-safe index round trips](publish-nested-expression-indexes.md); [CONCURRENTLY restriction](concurrent-index-migration-fix.md).
- [Pre-deploy cascades and baseline noise](pre-deploy-gate-notes.md).

---
name: Certification capability isolation
description: Durable rules for truthful disposable certification orchestration and fresh-snapshot replay.
---

Database-only suites must not probe a default HTTP port. Any suite that performs application HTTP calls belongs to the server-required capability and must use the denied server's explicit loopback URL and database identity.

**Why:** A misclassified integration suite reached an unrelated running server, producing results from a different database while appearing isolated.

**How to apply:** Audit new integration suites for HTTP clients and default base URLs. Promote mixed suites to server-required unless their HTTP portion is split into a separate owner.

Per-suite Redis isolation requires the parent to reserve the exact generated prefix that is passed through the declared child-environment override channel. Reservation, execution, descendant teardown, and token-fenced release happen in that order.

**Why:** Reserving a job prefix while passing a different suite prefix gives false ownership evidence and permits cross-suite state.

**How to apply:** Treat manifest Redis metadata as authority; never infer reservation from capability alone or pass unreserved prefixes.

Canonical snapshots must be fingerprinted against pre-snapshot migrations that they claim to represent. An omitted component may be completed only during that invocation's empty-database bootstrap; existing databases with the same drift fail closed.

**Why:** The canonical snapshot omitted an earlier deferred-enrollment table while the migrator baselined that migration, so migration replay reported success with an incomplete schema.

**How to apply:** Add focused empty-bootstrap and existing-drift tests whenever snapshot completion gains another required component; never edit applied migration SQL.
---
name: Live dev DB delta assertions are racy
description: Why global-population before/after count assertions flap against this project's dev database, and the fix.
---

This project's dev database is shared with actively-running background workers (contact/business backfills, canonicalization, enrichment). A test that computes a global population count, performs an action, then asserts the count changed by exactly N will flap — concurrent workers mutate the same tables during the test window.

**Why:** Confirmed directly: an isolated single-insert before/after count showed the correct delta, but the same assertion embedded in a longer-running test script (with other queries in between) saw the count move by an unrelated amount because background workers wrote rows during that window.

**How to apply:** When a real-Postgres test needs to prove a query predicate (eligibility filter, exclusion logic, etc.) is correct against a live shared dev DB, scope every assertion to uniquely-named fixture rows (e.g. a distinctive prefix) and count only those rows through the exact same predicate the production code uses — never assert on a global/unscoped count or a global delta. Reserve global-count assertions for genuinely disposable databases (`assertDisposableTestInfrastructure`).

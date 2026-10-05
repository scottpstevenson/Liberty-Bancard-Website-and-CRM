---
name: Checkout-safe PostgreSQL observability
description: Preserve pg-pool checkout/release ownership when adding explicit-transaction tracing.
---

Never intercept or replace `client.release()` for checkout instrumentation.
Use the pool's public release event. Acquisition may be observed through
callback/promise wrappers that return the original physical client and pass
the current release callback through unchanged.

**Why:** pg-pool owns a fresh release function for each checkout. Capturing or
reusing an earlier checkout's release can double-release or leak a recycled
connection. A previous observability implementation hung startup this way.
The blanket prohibition on observing acquisition was too broad: native tests
proved event-based release tracking preserves callback/promise behavior and
repeated physical-client reuse.

**How to apply:** Keep checkout records separate from physical connections.
Install a query observer once per physical connection, not once per checkout.
Test actual pg-pool reuse, callback release identity, query overloads,
acquisition failure and error-release disposal with a one-connection pool.
Do not derive pure SQL time from pool.query's combined acquire/execute duration.

Checked-out connections can emit an error while application code is idle in a
transaction. Handle that event without exposing error text, literals or
parameters, and prove that native idle-transaction termination leaves the pool
usable rather than crashing the process.

**Why:** Server-enforced idle bounds are not safe if the corresponding client
error is unhandled.

**How to apply:** Report bounded identifiers, phases and SQLSTATE only. Preserve
query rejection and transaction rollback semantics; never treat an uncertain
connection failure as a known-aborted retryable transaction.

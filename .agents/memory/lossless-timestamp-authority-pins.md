---
name: Lossless timestamp authority pins
description: Preserve PostgreSQL microseconds across review APIs and exact approval compare-and-swap checks.
---

Treat an exact PostgreSQL timestamp authority pin as an opaque, lossless string. Compare it in PostgreSQL and persist the locked row's authoritative timestamp, not a JavaScript Date round-trip.

**Why:** JavaScript Date truncates PostgreSQL microseconds to milliseconds. A review API can appear to approve the current row while storing a rounded timestamp that immediately fails the downstream exact SQL approval pin.

**How to apply:** For timestamp-based review CAS, return a lossless database representation, pass it through unchanged in the client, and perform exact SQL equality under the row lock. Reject stale or rounded tokens rather than silently widening equality.
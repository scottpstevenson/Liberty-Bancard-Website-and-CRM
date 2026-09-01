---
name: CRO03 safeError opaque redaction
description: Why a CRO03* route 400 can't be root-caused from logs alone
---
server/routes/cro03.ts wraps caught errors in a `safeError()` helper that only passes through
messages already prefixed `CRO03_`, `CRO03A_`, `CRO03B_`, or `CRO03C_`; anything else (including
raw Postgres errors like "invalid input syntax for type uuid") is replaced with a generic
"request could not be accepted" 400, and the original error is not logged server-side either.

**Why:** the route layer intentionally avoids leaking internal error detail (schema, driver,
stack) to API clients for this high-stakes surface, but this means a genuine bug can look
identical to a client-error 400 from the outside.

**How to apply:** when any CRO03* endpoint returns the generic redacted message, do not trust
that it's a client-side/validation problem. Trace the exact call chain in source (service →
adapters → DB layer) to find the real thrown error; do not add temporary debug logging to a
frozen/certified release without owner sign-off, since any code change invalidates SHA-based
release certification.

---
name: Statement upload idempotency contract
description: Statement-upload routes and merchant-app finalize require a UUIDv4 Idempotency-Key; contract for status mapping, one-way terminal transitions, and confirmation ownership.
---

# Statement upload idempotency contract

**Rule:** All statement upload routes (public, dashboard documents, merchant portal, rate review, SDR token, partner org) and merchant-app finalize reject requests lacking a client-generated UUIDv4 `Idempotency-Key` header with HTTP 400 before any business mutation. Test/smoke scripts must send `crypto.randomUUID()` per logical submission — reuse the same key only for transport retries of the identical request.

**Status mapping (uniform across all entry points):** replay → 200 with stored result; in-progress (claimed by other) → 202; fingerprint conflict → 409; scope mismatch → 403; prior recoverable failure → 422 (retry needs a NEW key).

**Terminal transitions are one-way:** a command can only be terminalized from `in_progress`; the first terminal writer (chain or route) wins and later writes are no-ops. Never add an unconditional status update — a late route error must not overwrite a chain success, or a retrying client is falsely told a completed upload failed.

**Confirmation ownership:** merchant confirmation delivery is owned solely by the chain's inbound-confirmation enrollment step, which returns a typed outcome. Never re-enroll from routes, and never record workflow-trigger acceptance as `sent` — trigger acceptance is `enrolled`, not delivery evidence.

**Why:** the durable command ledger replays results by key+fingerprint; inconsistent status codes or overwritable terminal state make replays nondeterministic, and config-inferred "sent" produced false delivery audit records (BT-04C root defect).

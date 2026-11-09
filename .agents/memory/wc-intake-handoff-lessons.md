---
name: Public intake retry and handoff rules
description: Durable rules for public form retries, idempotency keys, source policy and statement-chain operator truth.
---

- A visitor's idempotency key is released only by a refusal the server issues before it claims anything (field validation, file size/type) or by a confirmed save. A server fault, key conflict, unreadable body or lost answer may follow a saved request, so the key stays and the same submission is retried. A changed field or file while an earlier request is unconfirmed is blocked until the visitor explicitly starts a new request. This holds for every public form, including the multipart statement form; review each form separately because they use different client helpers.
- Once the required inbound work is durable, remaining route bookkeeping (timeline event, audit rows, analytics) must be nonfatal and the accepted receipt returned; a failure answer for a retained upload invites a duplicate.
- `inbound_requests.request_fingerprint` accepts only 64 lowercase hex; version a fingerprint by hashing the version into the digest, never by prefixing. Old stored fingerprints must still replay.
- New website inquiry modes are sales requests that stay out of the website warm lane, so they get no nurture or promotional admission just because they share a route.
- Held statement-chain steps are stored as `success:true`; operator views must derive held, manual-review and unavailable truth from durable command steps, request lifecycle and the exact-`true` setting, never from step success.

**Why:** each was found late (some only by code review) and none is obvious from reading one file.
**How to apply:** when changing public intake DTOs, source policies, form retry behavior, or the statement chain read model.

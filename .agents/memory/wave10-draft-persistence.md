---
name: Wave 10 draft persistence
description: Server-side merchant application draft persistence pattern, security constraints, and prefill token approach.
---

# Wave 10 Draft Persistence

## The rule
- `draftTokenHash` (migration 0041) stores a SHA256 hash of a 32-byte hex client token — the raw token never hits the DB.
- Autosave (`PATCH /:id/autosave`) uses a whitelist (`AUTOSAVE_ALLOWED_FIELDS`) — EIN, SSN, DOB, and bank fields are deliberately blocked from autosave to reduce risk of sensitive data being written mid-flow.
- Finalize (`PATCH /:id/finalize`) uses EIN-only duplicate check (not email) to avoid user enumeration.

**Why:** Email-based duplicate check reveals whether an address exists in the system (enumeration risk). EIN is always required at finalize time and is a safer deduplication key.

## Prefill token
- Stored in an in-memory `Map<string, PrefillEntry>` with 24-hour TTL — NOT persisted to DB.
- This means prefill tokens are lost on server restart. Acceptable tradeoff: they are short-lived one-time-use links.
- The token is a 32-byte hex string; the server stores the full token in memory (not just a hash) since it needs to look it up.
- Public `GET /prefill-token/:token` is rate-limited by `publicLeadRateLimit` (10 req/15 min per IP).

**How to apply:** If server restart causes issues with lost prefill tokens, move the store to a Redis-backed cache (use the existing BullMQ Redis connection).

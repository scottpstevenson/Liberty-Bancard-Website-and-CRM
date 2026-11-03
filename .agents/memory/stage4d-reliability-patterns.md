---
name: Stage 4D reliability patterns
description: Durable rules from the inbound-evidence, reply-stop pause, held-expiry, SMS identity and booking-create repairs.
---
- Inbound reply evidence is written through the effect-receipt transaction (receipt + communication event commit together); every webhook alias (generic, SDR message, SDR bounce) uses the same canonical identity key so aliases converge.
- Reply-stop/bounce pause and its audit commit in one transaction; audit only when rows really changed; the returned count is the real changed count.
- Held GHL enrollments expire through a non-sending sweep that also runs while the system is paused; it never claims, retry-counts or calls a provider. An old test that required the paused worker to leave an expired hold pending was intentionally replaced.
- Direct SMS transport re-reads the provider contact number every attempt and compares the full normalized number; unreadable = transient, mismatch = transport identity (never a consent withdrawal).
- Provider booking create requires an authorized local contact already linked to a provider id; the browser pending record keeps only command identity and reviewed numbers, never contact names or ids.
**Why:** Stage 4D closed narrow gaps left by 4C2; the booking pending-record rule is asserted by an older certification.
**How to apply:** keep these invariants when touching inbound webhooks, pause paths, deferred enrollments or the Calendar create console. Native acceptance stays blocked until an owner-authorized protected test path exists.

---
name: GHL data-sync authority
description: Standing scope and safety requirements for GHL CRM synchronization while communications are paused.
---

GHL CRM synchronization should work independently of paused outbound communications. Keep CRM data, opt-out/permission propagation, provider spending, and messaging/enrollment policies separate.

**Why:** The user wants CRM data synchronized without restarting outbound email. GHL field, tag, contact, and stage changes can themselves trigger native workflows, so “not a message API” does not establish safety.

**How to apply:** Permit only explicitly reviewed non-communicating native writes with exact operations, fields, tags, and stage IDs covered by a fresh, location-bound native-workflow safety review. Unsupported verification stays unverified and blocked; the agent must not approve its own native safety review or enable live writes.

Use explicit semantic pipeline/stage IDs, never title-only matching. Distinguish credential configuration, connection checks, enabled control, selected worker/owner, heartbeat, successful work, backlog/errors, and historical/current counts.

**Why:** The user requested truthful integration state rather than a single “healthy” indicator or historical totals presented as current synchronization coverage.

**How to apply:** Unknown or stale evidence must remain unknown or stale. GHL ownership and its isolated worker capability must not transfer SFP ownership, enable enrollment/voicemail, or change provider budgets or outbound pause.
---
name: Truthful success/failure state signals
description: Pattern for surfacing real delivery/provider state instead of collapsing outcomes into a single boolean
---

When an action depends on an external provider (SMS/email send, digest delivery), a single
`success: boolean` response hides *why* it failed (not configured vs. actually failed vs.
skipped due to missing consent/data). Callers then can't distinguish "nothing was wrong, we
just didn't try" from "we tried and it broke."

**Pattern:** check provider configuration (`isXConfigured()`) BEFORE attempting the call, and
return an explicit enum (`"sent" | "not_configured" | "failed" | "skipped"`) plus a
human-readable message, in addition to any legacy boolean field kept for backward compat.

**Why:** a UI showing "sent" (or silently nothing) when a message never left the building
misleads the operator into thinking a customer was contacted. This came up for Call Outcome
follow-up SMS (server/routes/activity.ts) and digest email delivery
(server/routes/notifications.ts digest-health endpoint) in the same session.

**How to apply:** any route that wraps a third-party send/deliver call should follow this
enum + message shape rather than a bare boolean, and any "preference saved" UI (e.g.
notification toggles) should be paired with a separate health/status check so saving a
preference is never conflated with the preference actually being deliverable.

**Two more lessons from the same session:**
- A "scheduler active" signal must come from a real runtime check (e.g. a job queue's
  paused/running state), not a hardcoded `true` — hardcoding it just relocates the same
  false-success problem into the health check itself. When the real check can't be
  determined, return `null`/"unknown" rather than defaulting to either true or false.
- Don't gate a truthful delivery-status signal behind an admin-only endpoint if regular
  users can trigger the same action (e.g. toggling a preference) — expose a minimal,
  non-privileged version (deliverable: boolean + reason) to everyone, and keep the
  detailed/sensitive version (which provider, internal config) admin-only.

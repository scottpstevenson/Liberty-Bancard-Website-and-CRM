---
name: Follow-up effect receipts and occurrence runs
description: Durable receipts, occurrence-keyed workflow runs and booking command rules for appointment/follow-up delivery
---
One receipt table (written BEFORE the provider call) serves workflow steps, statements, proposals, application reminders and booking commands. Accepted replays without sending; ambiguous/unknown is never re-sent; a definite refusal stays owed and may be re-claimed.

**Why:** audit-count success heuristics and always-"completed" runs consumed reminders that were never delivered.

**How to apply:** a reminder milestone, run or command counts as delivered only when a receipt is accepted. Put resource ids in the accepted receipt detail so a replay can read back. Never put raw tokens in receipt keys. Legacy runs/audit rows are read as historical, never rewritten. A blocked run is terminal (definition pin mismatch). Booking writer is default-denied (`ghl_booking_writer_enabled`), `toNotify` explicit, no slot-validation bypass.
A terminal failed/blocked run is retried only by a caller that owns a retry cadence (completed steps skipped, refused sends re-claimed); unknown outcomes and changed definitions stay parked for review. A run whose workflow is gone is parked blocked, never left due.

---
name: Multi-source cursor buffering
description: Cross-source pagination must retain fetched-but-not-emitted items when source cursors advance.
---

When independently paginated sources are merged into one page, advancing every
source cursor through its fetched batch can permanently skip items that lose the
global merge cutoff. Carry a bounded, integrity-protected remainder in the
composite cursor, or advance each source only through emitted items.

**Why:** A page that fetches 50 items from two sources but emits 50 globally
otherwise advances past 100 items and drops the 50 unreturned merge losers.

**How to apply:** Bind remainder, per-source continuation/high-water, normalized
filters, actor scope, and schema version in the signed cursor. Test that the
union of consecutive mixed-source pages has no gaps or duplicates.
---
name: SFP frozen classification snapshot
description: Why the SFP Phase A classification preview/run hash kept mismatching, and the bounded frozen-snapshot fix.
---

`previewPreCohortClassification`'s `snapshotHash` was derived from `eligibleForRun`, computed by scanning the ENTIRE canonical business pool (unless `businessIdFilter` narrowed the SQL query). Unrelated background churn elsewhere in the pool changed pool membership between preview and run calls, so the hash mismatched even when the target businesses were untouched. Compounding this, the GET preview route always called preview with no `businessIdFilter`, guaranteeing a mismatch for any run that passed an explicit filter.

**Fix pattern:** a frozen-snapshot mechanism (`sfp_classification_snapshots` table, `freezeClassificationSnapshot()` / `runFrozenClassificationSnapshot()` in `sfp-classification-bridge.ts`) that pins an exact bounded business-id set (1-25) plus per-business decision-relevant facts (identity fingerprint, geography/countyFips, rawVertical, hardExclusionReason, suppressed) at freeze time. Run time re-verifies only THOSE businesses against their frozen facts and drops (never substitutes) any that changed, then calls the underlying bridge with `businessIdFilter` and no `previewSnapshotHash` — bypassing the buggy full-pool hash check, since the snapshot's own recheck is the safety gate. One-time claim (pending→claimed) + TTL expiry make execution idempotent.

**Why this generalizes:** any "preview then run" flow whose integrity hash is derived from scanning a live, shared candidate pool (rather than the caller's own selected IDs) will falsely invalidate under unrelated background writes. The fix is always to freeze the caller's exact selection + its decision-relevant facts, not to scope the hash more tightly to the same live query.

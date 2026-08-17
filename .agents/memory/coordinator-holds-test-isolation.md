---
name: Coordinator holds test isolation
description: applyPauseMutation(false) leaves release_pending coordinator holds that still block canExecute(); tests must clear them explicitly.
---

# Coordinator Holds — Test Isolation Pattern

## Rule
After `applyPauseMutation({ outboundGlobalPaused: false, ... })`, the
`logical_job_control_holds` table still has `active=true` rows with
`reason_code='release_pending'`. The `canExecute("sequences")` check in the
sequence worker queries `WHERE active = true` and returns `false` if any rows
exist, making `isHeld = true` even though canonical pause is off. The worker
then writes `sequence_step_hold_deferred` instead of reaching downstream gates.

**Why:** Production unpausing uses a staged-release flow. On `applyPauseMutation(false)`,
`transitionGlobalHoldsToReleasePending()` sets holds to `release_pending`/`active=true`
rather than deleting them. An admin must call `approveStagedRelease()` to fully
clear them. Tests can't wait for this; they must clear directly.

**How to apply:**
In any test case that needs the sequence worker to proceed past the hold gate
(i.e. canonical pause is OFF and assertions check downstream gates like
contactability, daily cap, or ZB budget), call `clearCoordinatorHolds()` after
`applyPauseMutation(false)` and BEFORE `processSequenceEnrollments()`.

The helper used in `scripts/test-sequence-compliance.ts`:
```typescript
async function clearCoordinatorHolds(): Promise<void> {
  await pool.query(
    `UPDATE logical_job_control_holds
     SET active = false, released_at = NOW()
     WHERE active = true`,
  );
}
```

Also required: set `process.env.TEST_MODE = "true"` and `process.env.DRY_RUN = "true"`
before calling `processSequenceEnrollments()`. Without these, all 800+ active
enrollments try real GHL API calls and hit a 40-second rate-limit stall.

**Affected test cases:** 14, 23, 28, 29, 30, 31, 34B, 36 in
`scripts/test-sequence-compliance.ts`.

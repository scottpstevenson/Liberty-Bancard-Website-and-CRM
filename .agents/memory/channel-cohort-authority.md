---
name: Channel cohort authority
description: Durable CR-04 boundaries between qualification, frozen membership, execution attempts, and later activation.
---

Channel qualification decisions are immutable snapshots. Refresh them with a bounded evaluation epoch while keeping a separate substantive authority fingerprint so unexpired frozen membership survives a clock-bucket rollover when evidence is unchanged.

**Why:** Mutating an old decision destroys cohort auditability, while keying only by unchanged evidence makes a stable contact permanently stale after the first expiry.

**How to apply:** Freeze exact ordered members against immutable decisions. Compare substantive fingerprints during rechecks, not successor decision IDs.

CR-04 is not an activation authority. A denied execution attempt must not create an approved/promotable intent, activate a sequence, or mark a cohort consumed.

**Why:** Qualification can be true while global pause, coordinator holds, or pilot authorization still deny execution. Marking a denied attempt consumed also makes an unused cohort falsely final and non-cancellable.

**How to apply:** Keep denied runs frozen and cancellable. Only a later activation authority may consume a run atomically with its successful promotable action and complete mutable-gate recheck.